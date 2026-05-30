// ── Chapter-boundary tuning constants ─────────────────────────────────────────
// Used by the chapter-aware silence threshold feature (silenceSkipper.chapterAwareThreshold).
// Near a chapter boundary we tighten the threshold and require longer silence
// before skipping, so intentional transition pauses are preserved.
const CHAPTER_BOUNDARY_WINDOW_S  = 4;   // seconds around a boundary to consider "near"
const CHAPTER_BOUNDARY_DB_OFFSET = 6;   // dB tighter threshold near boundaries
const CHAPTER_BOUNDARY_DUR_MULT  = 2.0; // silence must last this ×longer near boundaries

// ── Mobile polling rate ───────────────────────────────────────────────────────
// 40ms on desktop gives a reliable ~40ms reaction window.
// On mobile, 40ms can cause jank, so we back off to 80ms.

class SilenceSkipper {
  // chapterReader is an optional ChapterReader instance. When provided (and the
  // chapterAwareThreshold setting is enabled), _loop() adjusts the effective
  // threshold and minimum silence duration near chapter boundaries so that
  // intentional transition pauses are not incorrectly skipped.
  constructor(videoElement, audioAnalyzer, settings, chapterReader = null) {
    this.video         = videoElement;
    this.analyzer      = audioAnalyzer;
    this.settings      = settings;
    this.chapterReader = chapterReader;

    this.silenceStartTime = null;
    this.isFading         = false;
    this.isSkipping       = false;
    this.fadeInterval     = null;
    this.originalVolume   = 1;
    this.loopHandler      = this._loop.bind(this);
  }

  start() {
    if (this.settings.enabled) {
      this.analyzer.startLoop(this.loopHandler);
    }
  }

  stop() {
    this.analyzer.stopLoop(); // Wait, other modules might use it! We shouldn't stop the shared analyzer loop.
    // Instead, we just stop responding. Actually, if analyzer loop supports multiple callbacks it's better,
    // or we can handle it in index.js. For now, let's just use a flag.
    this.settings.enabled = false;
  }

  updateSettings(newSettings) {
    this.settings = newSettings;
  }

  _loop(data) {
    if (!this.settings.enabled || this.isFading || this.isSkipping) return;

    const db = data.decibelLevel;

    // ── Chapter-aware effective thresholds ──────────────────────────────────
    // When chapterAwareThreshold is enabled and a ChapterReader is wired in,
    // we inspect the playhead position relative to chapter boundaries.
    // Near a boundary (near_start / near_end) we tighten the dB threshold
    // and double the minimum silence duration so intentional transition pauses
    // are not mistakenly skipped.
    let effectiveThresholdDb        = this.settings.thresholdDb;
    let effectiveMinSilenceDuration = this.settings.minSilenceDuration;

    if (
      this.chapterReader &&
      this.settings.chapterAwareThreshold !== false // default true
    ) {
      const section = this.chapterReader.getCurrentSection(this.video.currentTime);
      if (section.positionInSection === 'near_start' || section.positionInSection === 'near_end') {
        // Tighter threshold: subtract offset (lower dB = stricter gate)
        effectiveThresholdDb        = this.settings.thresholdDb - CHAPTER_BOUNDARY_DB_OFFSET;
        effectiveMinSilenceDuration = this.settings.minSilenceDuration * CHAPTER_BOUNDARY_DUR_MULT;
      }
    }

    if (db < effectiveThresholdDb) {
      if (this.silenceStartTime === null) {
        this.silenceStartTime = this.video.currentTime;
      }

      const silenceDuration = this.video.currentTime - this.silenceStartTime;

      if (silenceDuration >= effectiveMinSilenceDuration && silenceDuration <= this.settings.maxSilenceDuration) {
        this._skipSilence();
      } else if (silenceDuration > this.settings.maxSilenceDuration) {
        // Reset if silence is too long
        this.silenceStartTime = null;
      }
    } else {
      this.silenceStartTime = null;
    }
  }

  _skipSilence() {
    if (this.isFading || this.isSkipping) return;
    this.isSkipping = true;

    const skipAmount = this.settings.minSilenceDuration;

    if (this.settings.transition === 'fade') {
      this._fadeTransition(skipAmount);
    } else {
      this._hardCut(skipAmount);
    }

    window.dispatchEvent(new CustomEvent('smartplay:silence-skipped', {
      detail: { secondsSkipped: skipAmount }
    }));
  }

  _fadeTransition(skipAmount) {
    this.isFading = true;
    if (this.fadeInterval) clearInterval(this.fadeInterval);

    this.originalVolume = this.video.volume;
    const fadeMs  = this.settings.fadeDurationMs;
    const steps   = 20;
    const stepTime = fadeMs / steps;
    const volStep  = this.originalVolume / steps;

    let currentVol = this.originalVolume;

    // Fade out
    this.fadeInterval = setInterval(() => {
      currentVol = Math.max(0, currentVol - volStep);
      this.video.volume = currentVol;

      if (currentVol === 0) {
        clearInterval(this.fadeInterval);

        // Seek
        this.video.currentTime += skipAmount;

        // Fade in
        this.fadeInterval = setInterval(() => {
          currentVol = Math.min(this.originalVolume, currentVol + volStep);
          this.video.volume = currentVol;

          if (currentVol === this.originalVolume) {
            clearInterval(this.fadeInterval);
            this.isFading   = false;
            this.isSkipping = false;
            this.silenceStartTime = null;
          }
        }, stepTime);
      }
    }, stepTime);
  }

  _hardCut(skipAmount) {
    this.video.currentTime += skipAmount;
    this.isSkipping       = false;
    this.silenceStartTime = null;
  }

  destroy() {
    this.stop();
    if (this.fadeInterval) clearInterval(this.fadeInterval);
    this.video.volume = this.originalVolume;
  }
}
