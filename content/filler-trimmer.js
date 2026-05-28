
class FillerTrimmer {
  constructor(videoElement, settings) {
    this.video = videoElement;
    this.settings = settings;
    this.fetcher = new TranscriptFetcher();
    
    this.fillers = [];
    this.trimmedCount = 0;
    this.isSkipping = false;
    
    this.timeUpdateHandler = this._onTimeUpdate.bind(this);
  }
  
  async init() {
    if (!this.settings.enabled) return;
    
    const videoId = TranscriptFetcher.getCurrentVideoId();
    if (!videoId) return;
    
    const transcript = await this.fetcher.fetchTranscript(videoId);
    if (transcript && transcript.length > 0) {
      this.fillers = this.fetcher.findFillers(FILLER_WORDS, transcript);
      this.video.addEventListener('timeupdate', this.timeUpdateHandler);
    }
  }
  
  _onTimeUpdate() {
    if (!this.settings.enabled || this.isSkipping || this.fillers.length === 0) return;
    
    const currentMs = this.video.currentTime * 1000;
    
    // Check if we are inside a filler
    // Since fillers is sorted, we can just check the first few
    for (let i = 0; i < this.fillers.length; i++) {
      const f = this.fillers[i];
      if (currentMs >= f.startMs && currentMs < f.endMs) {
        this._skipFiller(f);
        break;
      }
      if (f.startMs > currentMs + 1000) break; // Optimization
    }
  }
  
  _skipFiller(fillerObj) {
    this.isSkipping = true;
    
    const originalVol = this.video.volume;
    this.video.volume = 0;
    this.video.currentTime = fillerObj.endMs / 1000;
    this.trimmedCount++;
    
    setTimeout(() => {
      this.video.volume = originalVol;
      this.isSkipping = false;
    }, 150); // slight fade in would be better, hard reset for now
    
    window.dispatchEvent(new CustomEvent('smartplay:filler-trimmed', {
      detail: { secondsSkipped: (fillerObj.endMs - fillerObj.startMs) / 1000 }
    }));
  }
  
  destroy() {
    this.video.removeEventListener('timeupdate', this.timeUpdateHandler);
  }
}
