class TranscriptFetcher {
  constructor() {
    // Cache transcript results keyed by videoId to avoid redundant fetches.
    this.cache = new Map();
  }

  static getCurrentVideoId() {
    return new URLSearchParams(window.location.search).get('v');
  }

  // ── Language track resolution ──────────────────────────────────────────────
  //
  // YouTube exposes available caption tracks inside the page's inline JSON
  // (window.ytInitialPlayerResponse). We parse that to find the best English
  // track, preferring manual captions over auto-generated, and supporting
  // locale variants (en, en-US, en-GB, en-AU, a.en, etc.)
  //
  // Returns the baseUrl string for the best-matching track, or null if none.
  _findBestEnglishTrackUrl() {
    try {
      const playerResponse = window.ytInitialPlayerResponse;
      if (!playerResponse) return null;

      const trackList =
        playerResponse?.captions
          ?.playerCaptionsTracklistRenderer
          ?.captionTracks;

      if (!Array.isArray(trackList) || trackList.length === 0) return null;

      // Score tracks: prefer manual (kind !== 'asr') over auto-generated.
      // Within each tier, prefer shorter language codes (en > en-US > a.en).
      const scored = trackList
        .filter(t => t.languageCode && t.languageCode.toLowerCase().includes('en'))
        .map(t => ({
          url: t.baseUrl,
          // Auto-generated tracks have kind === 'asr'; deprioritise them.
          score: (t.kind === 'asr' ? 0 : 10) - t.languageCode.length
        }))
        .sort((a, b) => b.score - a.score);

      return scored.length > 0 ? scored[0].url : null;
    } catch {
      return null;
    }
  }

  // ── Main fetch ─────────────────────────────────────────────────────────────
  //
  // Fetches and parses the JSON3 timed-text for a video.
  //
  // JSON3 format (abbreviated):
  //   { events: [
  //       { tStartMs: 1200, dDurationMs: 800,
  //         segs: [
  //           { utf8: "So " },                       // no offset = starts at tStartMs
  //           { utf8: "basically", tOffsetMs: 320 }, // 320ms after tStartMs
  //           { utf8: " um",       tOffsetMs: 740 }  // 740ms after tStartMs
  //         ]
  //       }, ...
  //   ]}
  //
  // We expand each event into individual word-level tokens with precise
  // startMs / endMs so FillerTrimmer can skip the exact word, not the
  // whole sentence it lives in.
  async fetchTranscript(videoId) {
    if (this.cache.has(videoId)) return this.cache.get(videoId);

    try {
      // ── Step 1: Resolve the best caption track URL ─────────────────────────
      let json3Url = this._findBestEnglishTrackUrl();

      if (json3Url) {
        // Append fmt=json3 if not already present (baseUrl already has params)
        json3Url += (json3Url.includes('?') ? '&' : '?') + 'fmt=json3';
      } else {
        // Hard fallback: direct timedtext endpoint with lang=en.
        // Still useful if ytInitialPlayerResponse is absent (e.g. SPA nav).
        json3Url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`;
      }

      const resp = await fetch(json3Url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      const words = this._parseWordTokens(data.events || []);
      this.cache.set(videoId, words);
      return words;

    } catch (err) {
      console.warn('[SmartPlay] TranscriptFetcher: fetch failed', err);
      return [];
    }
  }

  // ── Word-level parser ──────────────────────────────────────────────────────
  //
  // Each caption "event" contains a segs array of fragments.
  // A segment's absolute start time is:
  //
  //   segStartMs = event.tStartMs + (seg.tOffsetMs || 0)
  //
  // Some tracks also include aOffsetMs (an alternative/adjusted offset) on
  // individual segs; we prefer tOffsetMs when present.
  //
  // The end time of a segment is the start time of the NEXT segment in the
  // same event (or the event's own end time for the last segment).
  //
  // Returns a flat array of { text, startMs, endMs } objects sorted by time.
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

        // Absolute start: event start + this segment's offset within the event.
        // tOffsetMs is the offset of this word's start from tStartMs.
        const segStart = eventStart + (seg.tOffsetMs || 0);

        // End time: use the next segment's offset as the boundary, or fall
        // back to the event's end for the last segment in the event.
        let segEnd;
        if (i + 1 < segs.length) {
          segEnd = eventStart + (segs[i + 1].tOffsetMs || 0);
        } else {
          segEnd = eventEnd;
        }

        // Guard: end must be strictly after start (degenerate segs exist).
        if (segEnd <= segStart) segEnd = segStart + 300;

        tokens.push({ text, startMs: segStart, endMs: segEnd });
      }
    }

    return tokens.sort((a, b) => a.startMs - b.startMs);
  }

  // ── Keyword search (unchanged API, works on word tokens too) ───────────────
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
  // Old approach: matched fillers against whole sentence blocks and returned
  // crude ±400ms windows — often skipping surrounding real speech.
  //
  // New approach: we now have word-level tokens. We match each filler word
  // against individual tokens and return the token's exact startMs/endMs.
  // This is as precise as the caption track allows (~100–300ms per word).
  //
  // We also enforce a minimum duration floor of 80ms (avoids zero-length
  // skips on degenerate tokens) and a maximum cap of 1500ms (avoids nuking
  // legitimate words that happen to match "right" or "like").
  findFillers(fillerWords, transcript) {
    const fillers   = [];
    const lowerList = fillerWords.map(w => w.toLowerCase());
    const MIN_MS    = 80;
    const MAX_MS    = 1500;

    for (const token of transcript) {
      const tokenText = token.text.toLowerCase().trim();
      if (!tokenText) continue;

      for (const filler of lowerList) {
        // Word-boundary match: "like" should not match "likelihood"
        const rx = new RegExp(`^${filler}$|\\b${filler}\\b`, 'i');
        if (rx.test(tokenText)) {
          const duration = token.endMs - token.startMs;
          // Clamp duration to reasonable filler bounds
          const endMs = token.startMs + Math.max(MIN_MS, Math.min(duration, MAX_MS));
          fillers.push({ startMs: token.startMs, endMs });
          break; // one filler per token is enough
        }
      }
    }

    return fillers.sort((a, b) => a.startMs - b.startMs);
  }
}
