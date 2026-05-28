class ChapterReader {
  constructor() {
    this.chapters = [];

    this.hasAttemptedRead = false;
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
  readChapters() {
    this.hasAttemptedRead = true;
    this.chapters = [];

    // Tier 1
    const domChapters = this._readFromDOM();
    if (domChapters.length > 0) {
      console.log(`[SmartPlay] ChapterReader: ${domChapters.length} chapters via DOM`);
      this.chapters     = domChapters;
      return this.chapters;
    }

    // Tier 2
    const descChapters = this._readFromDescription();
    if (descChapters.length > 0) {
      console.log(`[SmartPlay] ChapterReader: ${descChapters.length} chapters via description regex`);
      this.chapters      = descChapters;
      return this.chapters;
    }

    console.log('[SmartPlay] ChapterReader: no chapters found');
    return this.chapters;
  }

  // ── Public: getChapters() ──────────────────────────────────────────────────
  getChapters() {
    if (this.chapters.length === 0 && !this.hasAttemptedRead) {
      this.readChapters();
    }
    return this.chapters;
  }

  destroy() {
    this.chapters         = [];
    this.hasAttemptedRead = false;
  }
}
