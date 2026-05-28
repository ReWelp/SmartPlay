class ChapterReader {
  constructor() {
    this.chapters = [];

    // ── Retry throttle ───────────────────────────────────────────────────────
    // getChapters() is called up to 10× per second via the popup's GET_STATUS
    // poll.  Without throttling, readChapters() (and its console.log) fire
    // hundreds of times per minute.
    //
    // Strategy: once chapters are found we set _resolvedOnce = true and stop
    // re-scanning.  Until they are found we wait at least RETRY_DELAY_MS
    // between actual scan attempts.
    this._resolvedOnce  = false;
    this._lastAttemptTs = 0;       // performance.now() of last readChapters call
    this._RETRY_DELAY   = 4000;    // ms — re-scan at most every 4 s
  }

  // ── Time string → seconds ──────────────────────────────────────────────────
  // Handles mm:ss (e.g. "4:20") and hh:mm:ss (e.g. "1:04:20").
  static _timeToSeconds(timeStr) {
    const parts = timeStr.split(':').map(Number).reverse();
    let secs = 0;
    for (let i = 0; i < parts.length; i++) {
      secs += parts[i] * Math.pow(60, i);
    }
    return secs;
  }

  // ── Tier 1: structured DOM elements ───────────────────────────────────────
  // YouTube renders chapter markers in ytd-macro-markers-list-item-renderer
  // ONLY after the user opens the description panel or the sidebar renders.
  // Returns [] when the panel hasn't been mounted yet.
  _readFromDOM() {
    const panels = document.querySelectorAll('ytd-macro-markers-list-item-renderer');
    if (panels.length === 0) return [];

    const chapters = [];
    panels.forEach(panel => {
      const timeStr = panel.querySelector('#time')?.innerText?.trim();
      const title   = panel.querySelector('#title')?.innerText?.trim();
      if (timeStr && title) {
        chapters.push({
          title,
          timeStr,
          seconds: ChapterReader._timeToSeconds(timeStr)
        });
      }
    });
    return chapters.sort((a, b) => a.seconds - b.seconds);
  }

  // ── Tier 2: description text regex fallback ────────────────────────────────
  //
  // When the chapter panel isn't in the DOM, we scrape the raw text of the
  // video description and parse chapter lines with a regex.
  //
  // The regex captures two groups:
  //   Group 1 — timestamp:  \d{1,2}:\d{2}(?::\d{2})?
  //     Matches mm:ss ("4:20") or hh:mm:ss ("1:04:20").
  //     Leading \d{1,2} allows single-digit minutes (0:30) and two-digit
  //     hours (10:30:00) without over-matching plain numbers.
  //
  //   Optional separator — [-–—|]? — dash / en-dash / em-dash / pipe, all
  //     optional so we handle every creator convention:
  //       "0:00 - Intro"   "0:00 – Intro"   "0:00 Intro"   "0:00 | Intro"
  //
  //   Group 2 — title:  (.+)
  //     Everything after the timestamp + separator on the same line.  We trim
  //     whitespace after extraction.
  //
  // Lines whose "title" is empty or purely numeric are discarded as false
  // positives (e.g. bare view counts that happen to contain a colon).
  _readFromDescription() {
    const descEl =
      document.querySelector('#description-inline-expander') ||
      document.querySelector('ytd-text-inline-expander')     ||
      document.querySelector('#description');

    if (!descEl) return [];

    const rawText = descEl.innerText || descEl.textContent || '';
    if (!rawText.trim()) return [];

    // /^                            — anchored to line start (m flag)
    //  \s*                          — optional leading whitespace
    //  (\d{1,2}:\d{2}(?::\d{2})?)  — timestamp group
    //  \s*[-–—|]?\s*               — optional separator
    //  (.+)                         — title group
    // /gm                           — global + multiline
    const CHAPTER_RX = /^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—|]?\s*(.+)/gm;

    const chapters = [];
    let match;
    while ((match = CHAPTER_RX.exec(rawText)) !== null) {
      const timeStr = match[1].trim();
      const title   = match[2].trim();

      // Discard lines where the "title" is just another number (false positive)
      if (!title || /^\d+$/.test(title)) continue;

      chapters.push({
        title,
        timeStr,
        seconds: ChapterReader._timeToSeconds(timeStr)
      });
    }

    // De-duplicate: same timestamp appearing twice (copy-paste artifacts)
    const seen = new Set();
    return chapters
      .filter(c => {
        if (seen.has(c.seconds)) return false;
        seen.add(c.seconds);
        return true;
      })
      .sort((a, b) => a.seconds - b.seconds);
  }

  // ── Public: readChapters() ─────────────────────────────────────────────────
  // Multi-tier with automatic fallback.  Caller (getChapters) handles the
  // retry-throttle so this method can focus purely on scraping logic.
  readChapters() {
    this._lastAttemptTs = performance.now();
    this.chapters = [];

    // Tier 1
    const domChapters = this._readFromDOM();
    if (domChapters.length > 0) {
      console.log(`[SmartPlay] ChapterReader: ${domChapters.length} chapters via DOM`);
      this.chapters     = domChapters;
      this._resolvedOnce = true;
      return this.chapters;
    }

    // Tier 2
    const descChapters = this._readFromDescription();
    if (descChapters.length > 0) {
      console.log(`[SmartPlay] ChapterReader: ${descChapters.length} chapters via description regex`);
      this.chapters      = descChapters;
      this._resolvedOnce = true;
      return this.chapters;
    }

    // Log only once per actual attempt, not once per getChapters() call.
    console.log('[SmartPlay] ChapterReader: no chapters found (will retry in 4s)');
    return this.chapters;
  }

  // ── Public: getChapters() ──────────────────────────────────────────────────
  // Called by index.js GET_STATUS handler up to 10× per second.
  //
  // Throttle rules:
  //   • Once chapters are found (_resolvedOnce), return them immediately — no
  //     more scanning needed.
  //   • Before they are found, allow a new scan only after _RETRY_DELAY ms
  //     have elapsed since the last attempt.  This eliminates the log spam
  //     that previously fired hundreds of times per minute.
  getChapters() {
    if (this._resolvedOnce) return this.chapters;

    const elapsed = performance.now() - this._lastAttemptTs;
    if (elapsed < this._RETRY_DELAY) return this.chapters; // too soon — wait

    return this.readChapters();
  }

  destroy() {
    this.chapters      = [];
    this._resolvedOnce = false;
  }
}
