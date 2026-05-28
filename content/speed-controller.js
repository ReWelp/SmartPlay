class SpeedController {
  constructor(videoElement, audioAnalyzer, settings) {
    this.video    = videoElement;
    this.analyzer = audioAnalyzer;
    this.settings = settings;

    this.currentSpeed = settings.baseSpeed || 1.0;
    this.targetSpeed  = this.currentSpeed;
    this.rampInterval = null;

    // Rolling history arrays — 100ms ticks × 20 samples = 2s smoothing window
    this.fluxHistory   = []; // spectral flux values (true onset detection)
    this.energyHistory = []; // RMS energy values (VAD gate)
    this.HISTORY_SIZE  = 20;

    // ── Auto-calibration ────────────────────────────────────────────────────
    // Slowly drifts toward the speaker's natural flux baseline so that
    // "fast" and "slow" are always relative to THIS speaker / video,
    // not a hardcoded constant.
    // Initial guess of 500 stabilizes within ~30–60s of actual speech.
    this.fluxBaseline  = 500;
    this.baselineAlpha = 0.002; // 0.2% drift per 100ms tick

    // ── Spectral flux state ──────────────────────────────────────────────────
    // Flux requires comparing the current FFT frame to the PREVIOUS frame.
    // Initialized lazily on first _measureSpectralFlux() call because
    // we don't know bufferLen until the analyser is live.
    this.prevFreqData = null;

    this._debugCount = 0;
    console.log('[SmartPlay] SpeedController v3 created, mode:', settings.mode);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start() {
    if (this.rampInterval) return;
    this.video.playbackRate = this.currentSpeed;
    this.rampInterval = setInterval(() => this._tick(), 100);
    console.log('[SmartPlay] SpeedController started');
  }

  stop() {
    if (this.rampInterval) {
      clearInterval(this.rampInterval);
      this.rampInterval = null;
    }
    this.video.playbackRate = 1.0;
    this.currentSpeed = 1.0;
  }

  // ── Main tick (called every 100ms) ────────────────────────────────────────

  _tick() {
    if (!this.settings.enabled || this.video.paused) return;

    const minSpeed  = this.settings.minSpeed  || 0.8;
    const maxSpeed  = this.settings.maxSpeed  || 2.0;
    const baseSpeed = this.settings.baseSpeed || 1.0;

    // "Max Always" mode: ignore all analysis, just pin to maxSpeed
    if (this.settings.mode === 'max_always') {
      this.targetSpeed = maxSpeed;
      this._applyRamp(minSpeed, maxSpeed);
      return;
    }

    // ── Phase 1: VAD Gate (RMS energy) ──────────────────────────────────────
    //
    // RMS tells us WHETHER someone is speaking — not HOW FAST.
    // We use it purely as a binary gate.
    //
    // BUG FIX: The old code returned early here, leaving the video frozen
    // at whatever speed it had built up to. Now we explicitly set
    // targetSpeed = baseSpeed and still call _applyRamp() so the video
    // glides smoothly back to 1.0x during silence or music.
    const energy = this.analyzer.getAverageAmplitude();
    this.energyHistory.push(energy);
    if (this.energyHistory.length > this.HISTORY_SIZE) this.energyHistory.shift();

    const smoothedEnergy = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;

    // ~-42 dB RMS — rejects silence and very quiet background noise
    const SPEECH_GATE = 0.008;

    if (smoothedEnergy < SPEECH_GATE) {
      // Gate closed: no speech detected. Glide back to baseSpeed, never freeze.
      this.targetSpeed = baseSpeed;
      this._applyRamp(minSpeed, maxSpeed);
      return;
    }

    // ── Phase 2: Spectral Flux (true syllable onset detection) ──────────────
    //
    // Spectral flux measures how much the frequency spectrum RISES between
    // consecutive 100ms frames in the speech band (300–3000 Hz).
    //
    // Why this works:
    //   Each syllable onset (consonant release or vowel attack) produces a
    //   sharp burst of rising energy across multiple speech-band bins.
    //   By summing only the POSITIVE bin-to-bin deltas (attacks), we count
    //   syllable-like events per frame — a reliable proxy for talking speed.
    //
    // This is categorically different from the old approach of counting bins
    // above the band average in a single frame (which measured spectral
    // complexity, not temporal change).
    const flux = this._measureSpectralFlux();
    this.fluxHistory.push(flux);
    if (this.fluxHistory.length > this.HISTORY_SIZE) this.fluxHistory.shift();

    const smoothedFlux = this.fluxHistory.reduce((a, b) => a + b, 0) / this.fluxHistory.length;

    // ── Phase 3: Auto-calibrate baseline flux for this speaker ──────────────
    //
    // The baseline drifts toward the speaker's natural pace.
    // A lecture speaker and a podcast host have very different syllable rates.
    // After ~60s of speech the baseline reflects the current speaker's rhythm,
    // so speed adjustments are always relative — never absolute.
    if (smoothedFlux > 0) {
      this.fluxBaseline += (smoothedFlux - this.fluxBaseline) * this.baselineAlpha;
    }

    // ── Phase 4: Inverse flux→speed mapping ─────────────────────────────────
    //
    // BUG FIX: The old code mapped HIGH flux → HIGH speed, which is backwards.
    // A fast talker already has dense information — speeding them up further
    // is harmful. A slow talker has sparse content — that's where we save time.
    //
    // Correct (inverted) logic:
    //   ratio < 1  →  speaker is slower than their baseline
    //              →  normalized approaches 1.0  →  targetSpeed → maxSpeed
    //   ratio = 1  →  speaker is at their natural pace
    //              →  normalized = 0.5  →  targetSpeed = midpoint
    //   ratio > 1  →  speaker is faster than their baseline
    //              →  normalized approaches 0.0  →  targetSpeed → minSpeed
    //
    // Map flux ratio [0.5 .. 1.5] → inverted [0.0 .. 1.0]
    const ratio      = smoothedFlux / Math.max(this.fluxBaseline, 1);
    const normalized = 1 - Math.max(0, Math.min(1, (ratio - 0.5) / 1.0));

    this.targetSpeed = minSpeed + normalized * (maxSpeed - minSpeed);
    this.targetSpeed = Math.max(minSpeed, Math.min(maxSpeed, this.targetSpeed));

    // ── Debug log every 30 ticks (~3s) ──────────────────────────────────────
    this._debugCount++;
    if (this._debugCount % 30 === 0) {
      console.log(
        `[SmartPlay Speed] energy=${smoothedEnergy.toFixed(4)} ` +
        `flux=${smoothedFlux.toFixed(1)} ` +
        `baseline=${this.fluxBaseline.toFixed(1)} ` +
        `ratio=${ratio.toFixed(2)} ` +
        `normalized=${normalized.toFixed(2)} ` +
        `→ target=${this.targetSpeed.toFixed(2)}x current=${this.currentSpeed.toFixed(2)}x`
      );
    }

    this._applyRamp(minSpeed, maxSpeed);
  }

  /**
   * _measureSpectralFlux()
   *
   * Computes the one-sided (positive-only) spectral flux in the speech band.
   *
   * Algorithm:
   *   1. Get the current FFT magnitude spectrum (Uint8Array, 0–255 per bin).
   *   2. For each bin in the speech band (300–3000 Hz):
   *        delta = currentFrame[bin] - previousFrame[bin]
   *        flux += max(0, delta)   ← only count rising energy (attacks)
   *   3. Store currentFrame as previousFrame for the next tick.
   *   4. Return the total flux.
   *
   * Why positive-only?
   *   Rising energy corresponds to syllable onsets (consonant bursts, vowel
   *   attacks). Falling energy is just decay — it tells us nothing about rate.
   *   One-sided flux cleanly isolates attacks from sustain and decay.
   *
   * Why 300–3000 Hz?
   *   Human speech fundamentals sit between 80–300 Hz, but the first and second
   *   formants (F1/F2) that carry most intelligibility are in 300–3000 Hz.
   *   This range also excludes most bass music and high-frequency noise.
   *
   * @returns {number} Raw flux value. Higher = more onset energy this frame.
   */
  _measureSpectralFlux() {
    if (!this.analyzer.isConnected) return 0;

    const analyser   = this.analyzer.analyser;
    const sampleRate = this.analyzer.ctx.sampleRate;
    const bufferLen  = analyser.frequencyBinCount;

    // Lazy-init: we don't know bufferLen until the analyser is live.
    // Re-init if bufferLen ever changes (e.g. fftSize reconfigured).
    if (!this.prevFreqData || this.prevFreqData.length !== bufferLen) {
      this.prevFreqData = new Uint8Array(bufferLen);
    }

    // Hz per FFT bin (Nyquist theorem: sampleRate / fftSize = sampleRate / (bufferLen*2))
    const binHz = sampleRate / (bufferLen * 2);

    // Speech band bin indices
    const lowBin  = Math.floor(300  / binHz);
    const highBin = Math.min(Math.floor(3000 / binHz), bufferLen - 1);

    const freqData = new Uint8Array(bufferLen);
    analyser.getByteFrequencyData(freqData);

    // Sum positive-only spectral deltas in the speech band
    let flux = 0;
    for (let i = lowBin; i <= highBin; i++) {
      // Math.max(0, ...) discards decay, keeps only rising attacks
      flux += Math.max(0, freqData[i] - this.prevFreqData[i]);
    }

    // Save current frame for comparison on the next tick
    this.prevFreqData.set(freqData);

    return flux;
  }

  /**
   * _applyRamp()
   *
   * Exponential smoothing toward targetSpeed at 8% per 100ms tick.
   * This prevents jarring jumps — the speed glides smoothly instead.
   * A 1% dead-band (0.01) avoids micro-jitter when already close to target.
   */
  _applyRamp(minSpeed, maxSpeed) {
    const RAMP_RATE = 0.08;
    if (Math.abs(this.currentSpeed - this.targetSpeed) > 0.01) {
      this.currentSpeed += (this.targetSpeed - this.currentSpeed) * RAMP_RATE;
      this.currentSpeed  = Math.max(minSpeed, Math.min(this.currentSpeed, maxSpeed));
      this.video.playbackRate = this.currentSpeed;

      window.dispatchEvent(new CustomEvent('smartplay:speed-changed', {
        detail: { speed: this.currentSpeed }
      }));
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setMaxSpeed(n) { this.settings.maxSpeed = n; }
  setMinSpeed(n) { this.settings.minSpeed = n; }
  setMode(mode)  {
    this.settings.mode = mode;
    console.log('[SmartPlay] SpeedController mode:', mode);
  }
  getCurrentSpeed() { return this.currentSpeed; }
  destroy() { this.stop(); }
}
