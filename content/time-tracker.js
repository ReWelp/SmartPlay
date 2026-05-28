class TimeTracker {
  constructor() {
    this.sessionSaved = {
      silence: 0,
      speed: 0,
      filler: 0
    };
    
    this.lastTime = 0;
    this.speedSavedBuffer = 0;
    
    this.silenceHandler = (e) => this._track('silence', e.detail.secondsSkipped);
    this.fillerHandler = (e) => this._track('filler', e.detail.secondsSkipped);
    
    window.addEventListener('smartplay:silence-skipped', this.silenceHandler);
    window.addEventListener('smartplay:filler-trimmed', this.fillerHandler);
  }
  
  updateSpeedTime(videoElement, currentSpeed) {
    if (!videoElement.paused && currentSpeed > 1.0) {
      const now = performance.now();
      if (this.lastTime > 0) {
        const deltaMs = now - this.lastTime;
        // Time saved = Real time watched * (speed - 1)
        // If watched 1s at 1.5x, we saved 0.5s of time
        const savedMs = deltaMs * (currentSpeed - 1.0);
        this.speedSavedBuffer += savedMs;
        
        if (this.speedSavedBuffer >= 1000) {
          const secs = Math.floor(this.speedSavedBuffer / 1000);
          this._track('speed', secs);
          this.speedSavedBuffer -= (secs * 1000);
        }
      }
      this.lastTime = now;
    } else {
      this.lastTime = 0;
    }
  }
  
  _track(source, seconds) {
    this.sessionSaved[source] += seconds;
    try {
      chrome.runtime.sendMessage({
        type: 'TIME_SAVED_UPDATE',
        secondsSaved: seconds,
        source: source
      });
    } catch (e) {
      // Ignore if disconnected
    }
  }
  
  destroy() {
    window.removeEventListener('smartplay:silence-skipped', this.silenceHandler);
    window.removeEventListener('smartplay:filler-trimmed', this.fillerHandler);
  }
}
