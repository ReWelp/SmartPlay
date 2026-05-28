class TranscriptFetcher {
  constructor() {
    this.cache = new Map();
  }

  static getCurrentVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
  }

  async fetchTranscript(videoId, lang = 'en') {
    if (this.cache.has(videoId)) {
      return this.cache.get(videoId);
    }

    try {
      const response = await fetch(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`);
      if (!response.ok) throw new Error("Transcript fetch failed");
      
      const data = await response.json();
      const events = data.events || [];
      
      const transcript = events.map(event => {
        const startMs = event.tStartMs || 0;
        const endMs = startMs + (event.dDurationMs || 0);
        const text = (event.segs || []).map(seg => seg.utf8).join('').replace(/\n/g, ' ');
        return { startMs, endMs, text };
      }).filter(item => item.text.trim() !== '');
      
      this.cache.set(videoId, transcript);
      return transcript;
    } catch (err) {
      console.warn("SmartPlay: Could not fetch JSON3 transcript", err);
      return [];
    }
  }

  searchKeyword(keyword, transcript) {
    if (!keyword || !transcript) return [];
    const lowerKeyword = keyword.toLowerCase();
    
    return transcript
      .filter(item => item.text.toLowerCase().includes(lowerKeyword))
      .map(item => {
        const regex = new RegExp(`(${keyword})`, 'gi');
        const snippetHtml = item.text.replace(regex, '<mark>$1</mark>');
        return { ...item, snippetHtml };
      })
      .sort((a, b) => a.startMs - b.startMs);
  }

  findFillers(fillerWords, transcript) {
    const fillers = [];
    const lowerWords = fillerWords.map(w => w.toLowerCase());
    
    for (const item of transcript) {
      const textLower = item.text.toLowerCase();
      let hasFiller = false;
      
      for (const word of lowerWords) {
        // Basic word boundary check
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        if (regex.test(textLower)) {
          hasFiller = true;
          break;
        }
      }
      
      if (hasFiller) {
        if (item.endMs - item.startMs <= 600) {
          fillers.push({ startMs: item.startMs, endMs: item.endMs });
        } else {
          fillers.push({ startMs: item.startMs, endMs: item.startMs + 400 });
        }
      }
    }
    
    return fillers.sort((a, b) => a.startMs - b.startMs);
  }
}
