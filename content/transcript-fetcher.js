class TranscriptFetcher {
  constructor() {
    // Cache transcript results keyed by videoId to avoid redundant fetches.
    this.cache = new Map();
  }

  static getCurrentVideoId() {
    return new URLSearchParams(window.location.search).get('v');
  }

  // ── Caption-track resolver ─────────────────────────────────────────────────
  //
  // Content scripts in Manifest V3 run in an ISOLATED WORLD.  That means
  // `window.ytInitialPlayerResponse` — set by YouTube's own page script — is
  // NOT accessible directly.  We use two strategies in priority order:
  //
  //   1. Try the window property anyway (works when run_at=document_start or
  //      in some edge cases where the MV3 sandbox is lenient).
  //   2. Scan every inline <script> tag's textContent for the captionTracks
  //      JSON array and extract it with a bracket-balanced parser.  This is
  //      always available because DOM content (including script text) IS
  //      readable from the isolated world.
  //
  // Returns the baseUrl of the best-scoring English caption track, or null.
  _findBestEnglishTrackUrl() {
    let trackList = null;

    // ── Strategy 1: direct window access (usually fails in isolated world) ──
    try {
      const pr = window.ytInitialPlayerResponse;
      const tl = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tl) && tl.length > 0) trackList = tl;
    } catch { /* falls through to Strategy 2 */ }

    // ── Strategy 2: scan inline <script> tags ───────────────────────────────
    //
    // YouTube embeds ytInitialPlayerResponse as a raw JS assignment inside a
    // <script> tag without a src attribute.  We read .textContent (which IS
    // accessible from the isolated world) and extract just the captionTracks
    // array using a bracket-balanced scan that correctly handles nested objects
    // and quoted strings.
    if (!trackList) {
      try {
        const KEY = '"captionTracks":';
        for (const sc of document.querySelectorAll('script:not([src])')) {
          const t = sc.textContent;
          if (!t.includes(KEY)) continue;

          const ki = t.indexOf(KEY);
          const arrStart = t.indexOf('[', ki + KEY.length);
          if (arrStart === -1) continue;

          // Walk forward, counting [ / ] while skipping quoted strings so that
          // brackets inside string values don't corrupt the depth counter.
          let depth = 0, i = arrStart;
          scan: for (; i < t.length; i++) {
            switch (t[i]) {
              case '"':
                // Skip over the entire quoted string (handle \\" escapes).
                i++;
                while (i < t.length) {
                  if (t[i] === '\\') { i++; }       // escaped char — skip both
                  else if (t[i] === '"') break;      // end of string
                  i++;
                }
                break;
              case '[': depth++; break;
              case ']': if (--depth === 0) break scan; break;
            }
          }

          try {
            const parsed = JSON.parse(t.slice(arrStart, i + 1));
            if (Array.isArray(parsed) && parsed.length > 0) {
              trackList = parsed;
              break; // found — stop scanning further <script> tags
            }
          } catch { /* malformed JSON in this tag — try next */ }
        }
      } catch { /* safety net */ }
    }

    if (!Array.isArray(trackList) || trackList.length === 0) return null;

    // ── Score & pick the best English track ─────────────────────────────────
    // Priority: manual captions (kind !== 'asr') beat auto-generated ones.
    // Within the same tier, prefer the shortest language code (en > en-US >
    // en-GB > a.en) as shorter codes tend to be cleaner manual tracks.
    const scored = trackList
      .filter(t => t.languageCode && t.languageCode.toLowerCase().includes('en'))
      .map(t => ({
        url:   t.baseUrl,
        score: (t.kind === 'asr' ? 0 : 10) - t.languageCode.length
      }))
      .sort((a, b) => b.score - a.score);

    return scored.length > 0 ? scored[0].url : null;
  }

  // ── Main fetch ─────────────────────────────────────────────────────────────
  //
  // JSON3 timed-text format (abbreviated):
  //   { events: [
  //       { tStartMs: 1200, dDurationMs: 800,
  //         segs: [
  //           { utf8: "So " },                       // no offset → starts at tStartMs
  //           { utf8: "basically", tOffsetMs: 320 }, // 320 ms after tStartMs
  //           { utf8: " um",       tOffsetMs: 740 }  // 740 ms after tStartMs
  //         ]
  //       }, ...
  //   ]}
  //
  // We expand each event into individual word-level tokens with precise
  // startMs / endMs so FillerTrimmer can skip the exact word only.
  async fetchTranscript(videoId) {
    if (this.cache.has(videoId)) return this.cache.get(videoId);

    try {
      // ── Step 1: resolve best caption track URL ─────────────────────────────
      let json3Url = this._findBestEnglishTrackUrl();

      if (json3Url) {
        // baseUrl from ytInitialPlayerResponse already has query params — append
        // fmt=json3 to request structured word-segment data instead of SRV3/XML.
        json3Url += (json3Url.includes('?') ? '&' : '?') + 'fmt=json3';
      }

      // ── Step 2: multi-lang fallback chain when track resolver failed ───────
      //
      // We try a sequence of language codes.  YouTube returns an EMPTY body
      // (not a 404) when a specific lang code has no captions, so we must
      // check the body length rather than just the HTTP status code.
      //
      // Order: en → en-US → en-GB → a.en (auto-generated any-English)
      const FALLBACK_LANGS = ['en', 'en-US', 'en-GB', 'a.en'];

      const tryFetch = async (url) => {
        const resp = await fetch(url);
        if (!resp.ok) return null;

        // YouTube returns an empty string (0 bytes) when a language track
        // doesn't exist — calling .json() on that throws "Unexpected end of
        // JSON input".  Read as text first so we can guard against it.
        const text = await resp.text();
        if (!text || text.trim().length < 2) return null; // empty / whitespace

        try {
          return JSON.parse(text);
        } catch (e) {
          return null;
        }
      };

      let data = null;

      if (json3Url) {
        data = await tryFetch(json3Url);
      }

      if (!data) {
        // Track resolver failed or returned empty — walk through fallback langs.
        for (const lang of FALLBACK_LANGS) {
          const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`;
          data = await tryFetch(url);
          if (data) break;
        }
      }

      if (!data) throw new Error('No usable caption track found');

      const words = this._parseWordTokens(data.events || []);
      this.cache.set(videoId, words);
      return words;

    } catch (err) {
      console.warn('[SmartPlay] TranscriptFetcher: fetch failed', err.message);
      return [];
    }
  }

  // ── Word-level parser ──────────────────────────────────────────────────────
  //
  // Each caption "event" contains a segs array of word fragments.
  //
  // Offset math:
  //   segStartMs = event.tStartMs + (seg.tOffsetMs || 0)
  //
  //   The first segment in an event has no tOffsetMs (defaults to 0), meaning
  //   it starts exactly at event.tStartMs.
  //
  //   The end of a segment is the start of the NEXT segment in the same event
  //   (they share the event's timeline).  For the last segment in an event we
  //   use the event's own end time (tStartMs + dDurationMs).
  //
  //   Guard: if segEnd ≤ segStart (degenerate / zero-duration segment),
  //   we add a 300 ms floor so FillerTrimmer always has a non-zero window.
  //
  // Returns a flat array of { text, startMs, endMs } sorted by startMs.
  _parseWordTokens(events) {
    const tokens = [];

    for (const event of events) {
      const eventStart = event.tStartMs || 0;
      const eventEnd   = eventStart + (event.dDurationMs || 0);
      const segs       = event.segs || [];

      for (let i = 0; i < segs.length; i++) {
        const seg  = segs[i];
        const text = (seg.utf8 || '').replace(/\n/g, ' ').trim();
        if (!text) continue;

        // segStartMs: absolute time this word begins.
        const segStart = eventStart + (seg.tOffsetMs || 0);

        // segEndMs: use the next segment's offset as the boundary, or the
        // event's end time for the last segment in this event.
        let segEnd;
        if (i + 1 < segs.length) {
          segEnd = eventStart + (segs[i + 1].tOffsetMs || 0);
        } else {
          segEnd = eventEnd;
        }

        if (segEnd <= segStart) segEnd = segStart + 300; // degenerate guard

        tokens.push({ text, startMs: segStart, endMs: segEnd });
      }
    }

    return tokens.sort((a, b) => a.startMs - b.startMs);
  }

  // ── Keyword search ─────────────────────────────────────────────────────────
  searchKeyword(keyword, transcript) {
    if (!keyword || !transcript) return [];
    const lower = keyword.toLowerCase();

    return transcript
      .filter(t => t.text.toLowerCase().includes(lower))
      .map(t => {
        const rx = new RegExp(`(${keyword})`, 'gi');
        return { ...t, snippetHtml: t.text.replace(rx, '<mark>$1</mark>') };
      })
      .sort((a, b) => a.startMs - b.startMs);
  }

  // ── Filler finder ─────────────────────────────────────────────────────────
  //
  // Because we now have word-level tokens (not sentence blobs), each filler
  // match returns the exact [startMs, endMs] window of that individual word.
  //
  // Word-boundary regex (`\bfiller\b`) prevents "like" from matching
  // "likelihood".  We also enforce:
  //   MIN_MS = 80  ms — avoids zero-length skips on degenerate tokens.
  //   MAX_MS = 1500 ms — avoids nuking real speech that happens to match.
  findFillers(fillerWords, transcript) {
    const fillers   = [];
    const lowerList = fillerWords.map(w => w.toLowerCase());
    const MIN_MS    = 80;
    const MAX_MS    = 1500;

    for (const token of transcript) {
      const tokenText = token.text.toLowerCase().trim();
      if (!tokenText) continue;

      for (const filler of lowerList) {
        const rx = new RegExp(`^${filler}$|\\b${filler}\\b`, 'i');
        if (rx.test(tokenText)) {
          const duration = token.endMs - token.startMs;
          const endMs = token.startMs + Math.max(MIN_MS, Math.min(duration, MAX_MS));
          fillers.push({ startMs: token.startMs, endMs });
          break; // one filler label per token
        }
      }
    }

    return fillers.sort((a, b) => a.startMs - b.startMs);
  }
}
