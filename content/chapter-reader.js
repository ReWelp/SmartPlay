class ChapterReader {
  constructor() {
    this.chapters = [];
  }

  // ── Time string → seconds ──────────────────────────────────────────────────
  // Handles both mm:ss and hh:mm:ss formats.
  static _timeToSeconds(timeStr) {
    const parts = timeStr.split(':').map(Number).reverse();
    let secs = 0;
    for (let i = 0; i < parts.length; i++) {
      secs += parts[i] * Math.pow(60, i);
    }
    return secs;
  }

  // ── Tier 1: structured DOM elements ──────────────────────────────────────
  // YouTube renders chapter markers in ytd-macro-markers-list-item-renderer
  // elements, BUT only after the user expands the description or the sidebar
  // renders them. Returns [] when the panel hasn't been mounted yet.
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

  // ── Tier 2: description text regex fallback ───────────────────────────────
  //
  // When the chapter panel isn't in the DOM yet, we scrape the raw text of
  // the video description and parse chapter lines with a regex.
  //
  // The regex captures two groups:
  //   Group 1 — timestamp:  \d{1,2}:\d{2}(:\d{2})?
  //     Matches mm:ss (e.g. "4:20") or hh:mm:ss (e.g. "1:04:20").
  //     The leading \d{1,2} allows single-digit minutes (0:30) as well as
  //     two-digit hours (10:30:00) without over-matching random numbers.
  //
  //   Separator — [-–—|]? — optional dash / en-dash / em-dash / pipe.
  //     Creators use many conventions: "0:00 - Intro", "0:00 – Intro",
  //     "0:00 Intro", "0:00 | Intro". The separator is optional so we
  //     handle the no-separator case too.
  //
  //   Group 2 — title:  (.+)
  //     Everything after the timestamp and separator on the same line.
  //     We trim whitespace after extraction.
  //
  // Lines that contain a timestamp but whose "title" part is empty or
  // purely numeric are discarded as false positives.
  _readFromDescription() {
    // Try multiple selectors in preference order (YouTube DOM varies by
    // country, experiment bucket, and whether the page has been SPA-navigated).
    const descEl =
      document.querySelector('#description-inline-expander') ||
      document.querySelector('ytd-text-inline-expander')     ||
      document.querySelector('#description');

    if (!descEl) return [];

    const rawText = descEl.innerText || descEl.textContent || '';
    if (!rawText.trim()) return [];

    // ── Chapter-line regex ───────────────────────────────────────────────────
    // /^                       — anchored to start of line (multiline flag)
    //  \s*                     — optional leading whitespace (indented lists)
    //  (\d{1,2}:\d{2}(?::\d{2})?)  — timestamp group (mm:ss or hh:mm:ss)
    //  \s*[-–—|]?\s*           — optional separator with surrounding spaces
    //  (.+)                    — title group: rest of the line (trimmed below)
    // /gm                      — global + multiline so we process every line
    const CHAPTER_RX = /^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—|]?\s*(.+)/gm;

    const chapters = [];
    let match;
    while ((match = CHAPTER_RX.exec(rawText)) !== null) {
      const timeStr = match[1].trim();
      const title   = match[2].trim();

      // Discard lines where the "title" is just another number (false positive).
      if (!title || /^\d+$/.test(title)) continue;

      chapters.push({
        title,
        timeStr,
        seconds: ChapterReader._timeToSeconds(timeStr)
      });
    }

    // De-duplicate: same timestamp appearing twice (copy-paste artifacts).
    const seen = new Set();
    return chapters
      .filter(c => {
        if (seen.has(c.seconds)) return false;
        seen.add(c.seconds);
        return true;
      })
      .sort((a, b) => a.seconds - b.seconds);
  }

  // ── Public: readChapters() ────────────────────────────────────────────────
  // Multi-tier with automatic fallback:
  //   Tier 1 → structured DOM (best accuracy, requires panel to be mounted)
  //   Tier 2 → description regex  (always available, slightly less reliable)
  readChapters() {
    this.chapters = [];

    // Tier 1
    const domChapters = this._readFromDOM();
    if (domChapters.length > 0) {
      console.log(`[SmartPlay] ChapterReader: ${domChapters.length} chapters via DOM`);
      this.chapters = domChapters;
      return this.chapters;
    }

    // Tier 2
    const descChapters = this._readFromDescription();
    if (descChapters.length > 0) {
      console.log(`[SmartPlay] ChapterReader: ${descChapters.length} chapters via description regex`);
      this.chapters = descChapters;
      return this.chapters;
    }

    console.log('[SmartPlay] ChapterReader: no chapters found');
    return this.chapters;
  }

  getChapters() {
    return this.chapters.length > 0 ? this.chapters : this.readChapters();
  }

  destroy() {
    this.chapters = [];
  }
}
