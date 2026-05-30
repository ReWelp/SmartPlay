class ChapterReader {
  constructor() {
    this.chapters = [];
    this.readAttempts = 0;
    this.MAX_ATTEMPTS = 10;
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
  // Desktop: ytd-macro-markers-list-item-renderer
  // Mobile:  ytm-macro-markers-list-item-renderer
  // Both are queried; results are merged and deduplicated by seconds.
  _readFromDOM() {
    const panels = [
      ...document.querySelectorAll('ytd-macro-markers-list-item-renderer'), // desktop
      ...document.querySelectorAll('ytm-macro-markers-list-item-renderer'), // mobile
    ];
    if (panels.length === 0) return [];

    const seen = new Set();
    const chapters = [];
    panels.forEach(panel => {
      const timeStr = panel.querySelector('#time')?.innerText?.trim();
      const title   = panel.querySelector('#title')?.innerText?.trim();
      if (timeStr && title) {
        const seconds = ChapterReader._timeToSeconds(timeStr);
        if (!seen.has(seconds)) {
          seen.add(seconds);
          chapters.push({ title, timeStr, seconds });
        }
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
    // Desktop selectors first, then mobile equivalents.
    const descEl =
      document.querySelector('#description-inline-expander') ||
      document.querySelector('ytd-text-inline-expander')     ||
      document.querySelector('#description')                 ||
      document.querySelector('ytm-text-inline-expander')     ||  // mobile
      document.querySelector('#snippet-text')                ||  // mobile
      document.querySelector('.ytm-formatted-string');            // mobile

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
    this.readAttempts++;
    this.chapters = [];

    // Tier 1
    const domChapters = this._readFromDOM();
    if (domChapters.length > 0) {
      console.log(`[SmartPlay] ChapterReader: ${domChapters.length} chapters via DOM`);
      this.chapters     = domChapters;
      this.readAttempts = this.MAX_ATTEMPTS;
      return this.chapters;
    }

    // Tier 2
    const descChapters = this._readFromDescription();
    if (descChapters.length > 0) {
      console.log(`[SmartPlay] ChapterReader: ${descChapters.length} chapters via description regex`);
      this.chapters      = descChapters;
      this.readAttempts = this.MAX_ATTEMPTS;
      return this.chapters;
    }

    console.log(`[SmartPlay] ChapterReader: no chapters found (Attempt ${this.readAttempts}/${this.MAX_ATTEMPTS})`);
    return this.chapters;
  }

  // ── Public: getChapters() ──────────────────────────────────────────────────
  getChapters() {
    if (this.chapters.length === 0 && this.readAttempts < this.MAX_ATTEMPTS) {
      this.readChapters();
    }
    return this.chapters;
  }

  // ── Public: getCurrentSection(currentTimeSecs) ────────────────────────────
  // Returns context about where in the chapter structure the playhead sits.
  //
  // Return shape:
  //   {
  //     chapter:           { title, seconds } | null   — current chapter
  //     nextChapter:       { title, seconds } | null   — immediately following chapter
  //     positionInSection: 'near_start' | 'near_end' | 'mid'
  //   }
  //
  // Position semantics (used by SilenceSkipper for chapter-aware thresholds):
  //   near_start — within CHAPTER_BOUNDARY_WINDOW_S seconds after a chapter boundary
  //   near_end   — within CHAPTER_BOUNDARY_WINDOW_S seconds before the next boundary
  //   mid        — everything else
  //
  // The boundary window constant lives in silence-skipper.js so the two files
  // share the same value without creating a separate constants file.
  getCurrentSection(currentTimeSecs) {
    const chapters = this.getChapters();
    if (chapters.length === 0) {
      return { chapter: null, nextChapter: null, positionInSection: 'mid' };
    }

    // Find the current chapter (last one whose start <= currentTimeSecs).
    let chapterIdx = -1;
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].seconds <= currentTimeSecs) chapterIdx = i;
      else break;
    }

    const chapter     = chapterIdx >= 0 ? chapters[chapterIdx] : null;
    const nextChapter = chapterIdx + 1 < chapters.length ? chapters[chapterIdx + 1] : null;

    // Determine position — the window value is set on SilenceSkipper as a
    // named constant; we use 4 s here to stay in sync.
    const WINDOW_S = 4;
    let positionInSection = 'mid';

    if (chapter && (currentTimeSecs - chapter.seconds) < WINDOW_S) {
      positionInSection = 'near_start';
    } else if (nextChapter && (nextChapter.seconds - currentTimeSecs) < WINDOW_S) {
      positionInSection = 'near_end';
    }

    return { chapter, nextChapter, positionInSection };
  }

  destroy() {
    this.chapters     = [];
    this.readAttempts = 0;
  }
}
