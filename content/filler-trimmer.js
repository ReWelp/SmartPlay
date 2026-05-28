class FillerTrimmer {
  constructor(videoElement, settings) {
    this.video    = videoElement;
    this.settings = settings;
    this.fetcher  = new TranscriptFetcher();

    this.fillers      = []; // sorted array of { startMs, endMs }
    this.trimmedCount = 0;
    this.isSkipping   = false;

    // Index cursor: because fillers[] is sorted by startMs and we play forward,
    // we can skip already-passed entries rather than scanning from 0 every tick.
    // This keeps the hot-path O(1) in the common case.
    this._cursorIndex = 0;

    // Polling interval handle (replaces the old timeupdate listener).
    this._pollInterval = null;
  }

  async init() {
    if (!this.settings.fillerTrimmer) return;

    const videoId = TranscriptFetcher.getCurrentVideoId();
    if (!videoId) return;

    const transcript = await this.fetcher.fetchTranscript(videoId);
    if (!transcript || transcript.length === 0) {
      console.warn('[SmartPlay] FillerTrimmer: no transcript available');
      return;
    }

    this.fillers = this.fetcher.findFillers(FILLER_WORDS, transcript);
    console.log(`[SmartPlay] FillerTrimmer: ${this.fillers.length} fillers indexed`);

    // ── High-frequency polling loop ──────────────────────────────────────────
    //
    // The old code used the browser's 'timeupdate' event which fires every
    // ~250ms. A filler word can be as short as 100–200ms — the event simply
    // doesn't fire often enough to reliably catch them.
    //
    // We replace it with setInterval at 40ms (25 checks/second). This
    // guarantees we detect any filler window ≥ 80ms before it ends, giving
    // us a reliable ~40ms reaction window even on the shortest fillers.
    this._pollInterval = setInterval(() => this._poll(), 40);
  }

  // ── Poll tick (called every 40ms) ─────────────────────────────────────────
  _poll() {
    if (!this.settings.fillerTrimmer || this.isSkipping || this.fillers.length === 0) return;
    if (this.video.paused || this.video.ended) return;

    const nowMs = this.video.currentTime * 1000;

    // Advance cursor past any fillers we've already passed.
    // This is safe because playback is monotonically forward (seeking is
    // handled by the cursor reset below).
    while (
      this._cursorIndex < this.fillers.length &&
      this.fillers[this._cursorIndex].endMs < nowMs
    ) {
      this._cursorIndex++;
    }

    // Check the current and next few fillers for overlap with nowMs.
    // We look ahead a small window (3 entries) to handle tight clusters.
    const LOOKAHEAD = 3;
    for (let i = this._cursorIndex; i < Math.min(this._cursorIndex + LOOKAHEAD, this.fillers.length); i++) {
      const f = this.fillers[i];

      // If the next filler hasn't started yet, nothing to do this tick.
      if (f.startMs > nowMs) break;

      // We are inside [startMs, endMs] — skip it.
      if (nowMs >= f.startMs && nowMs < f.endMs) {
        this._skipFiller(f);
        break;
      }
    }
  }

  // ── Seeking reset ─────────────────────────────────────────────────────────
  // Call this if the video seeks backwards so the cursor re-scans from the
  // correct position. Hooked via index.js on 'seeked' if needed.
  resetCursor() {
    this._cursorIndex = 0;
  }

  // ── Skip execution ────────────────────────────────────────────────────────
  _skipFiller(fillerObj) {
    this.isSkipping = true;

    // Mute briefly to mask the seek click, then restore volume with a short
    // fade-in to avoid a jarring pop.
    const originalVol = this.video.volume;
    this.video.volume = 0;
    this.video.currentTime = fillerObj.endMs / 1000;
    this.trimmedCount++;

    // Short mute window covers the seek + one browser render frame.
    // 120ms is enough for the audio graph to stabilise post-seek.
    setTimeout(() => {
      // Fade volume back in over 80ms (4 steps × 20ms) for a soft re-entry.
      let step = 0;
      const STEPS = 4;
      const fadeIn = setInterval(() => {
        step++;
        this.video.volume = originalVol * (step / STEPS);
        if (step >= STEPS) {
          this.video.volume = originalVol;
          clearInterval(fadeIn);
          this.isSkipping = false;
        }
      }, 20);
    }, 120);

    window.dispatchEvent(new CustomEvent('smartplay:filler-trimmed', {
      detail: { secondsSkipped: (fillerObj.endMs - fillerObj.startMs) / 1000 }
    }));
  }

  destroy() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }
}
