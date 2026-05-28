class SpeedController {
  constructor(videoElement, audioAnalyzer, settings) {
    this.video = videoElement;
    this.analyzer = audioAnalyzer;
    this.settings = settings;

    this.currentSpeed = settings.baseSpeed || 1.0;
    this.targetSpeed = this.currentSpeed;
    this.rampInterval = null;

    // Rolling energy history to smooth speed decisions (2s of 100ms samples = 20 samples)
    this.energyHistory = [];
    this.HISTORY_SIZE = 20;

    // Calibration: track min/max energy seen over time to auto-calibrate thresholds
    this.energyMin = 0.02;
    this.energyMax = 0.3;

    console.log('[SmartPlay] SpeedController created, mode:', settings.mode);
  }

  start() {
    if (this.rampInterval) return;
    this.video.playbackRate = this.currentSpeed;
    // Run every 100ms for responsive adaptation
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

  _tick() {
    if (!this.settings.enabled || this.video.paused) return;

    const minSpeed = this.settings.minSpeed || 0.8;
    const maxSpeed = this.settings.maxSpeed || 2.0;
    const baseSpeed = this.settings.baseSpeed || 1.0;

    if (this.settings.mode === 'max_always') {
      this.targetSpeed = maxSpeed;
    } else {
      // Get real-time RMS amplitude from the audio analyser
      const energy = this.analyzer.getAverageAmplitude();

      // Push to rolling history
      this.energyHistory.push(energy);
      if (this.energyHistory.length > this.HISTORY_SIZE) {
        this.energyHistory.shift();
      }

      // Auto-calibrate min/max slowly (helps adapt to different microphone/video levels)
      const calibrationRate = 0.001;
      if (energy > 0.001) { // ignore near-silence for calibration
        this.energyMin = this.energyMin * (1 - calibrationRate) + Math.min(energy, this.energyMin + 0.01) * calibrationRate;
        this.energyMax = this.energyMax * (1 - calibrationRate) + Math.max(energy, this.energyMax - 0.01) * calibrationRate;
      }

      // Smooth: average last 20 samples (~2s)
      const smoothedEnergy = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;

      // Dead zone: if no audio at all, don't ramp up (silence/music break)
      const SILENCE_THRESHOLD = 0.005;
      if (smoothedEnergy < SILENCE_THRESHOLD) {
        // Don't change speed during silence — let silence skipper handle that
        return;
      }

      // Map energy to speed using a normalized ratio
      // energyMin → minSpeed, energyMax → maxSpeed, with baseSpeed in the middle
      const range = Math.max(this.energyMax - this.energyMin, 0.01);
      const normalized = Math.max(0, Math.min(1, (smoothedEnergy - this.energyMin) / range));

      // Map the normalized [0..1] to [minSpeed..maxSpeed]
      this.targetSpeed = minSpeed + normalized * (maxSpeed - minSpeed);

      // Clamp to settings bounds
      this.targetSpeed = Math.max(minSpeed, Math.min(maxSpeed, this.targetSpeed));

      // Debug log every 30 ticks (~3s)
      if (!this._debugCount) this._debugCount = 0;
      this._debugCount++;
      if (this._debugCount % 30 === 0) {
        console.log(`[SmartPlay] energy=${smoothedEnergy.toFixed(4)} norm=${normalized.toFixed(2)} target=${this.targetSpeed.toFixed(2)}x current=${this.currentSpeed.toFixed(2)}x`);
      }
    }

    // Smooth ramp: move 10% towards target each tick (soft step)
    const RAMP_RATE = 0.08;
    if (Math.abs(this.currentSpeed - this.targetSpeed) > 0.01) {
      this.currentSpeed += (this.targetSpeed - this.currentSpeed) * RAMP_RATE;
      this.currentSpeed = Math.max(
        this.settings.minSpeed || 0.8,
        Math.min(this.currentSpeed, this.settings.maxSpeed || 2.0)
      );
      this.video.playbackRate = this.currentSpeed;

      window.dispatchEvent(new CustomEvent('smartplay:speed-changed', {
        detail: { speed: this.currentSpeed }
      }));
    }
  }

  setMaxSpeed(n) {
    this.settings.maxSpeed = n;
  }

  setMinSpeed(n) {
    this.settings.minSpeed = n;
  }

  setMode(mode) {
    this.settings.mode = mode;
    console.log('[SmartPlay] SpeedController mode set to:', mode);
  }

  getCurrentSpeed() {
    return this.currentSpeed;
  }

  destroy() {
    this.stop();
  }
}
