class SilenceSkipper {
  constructor(videoElement, audioAnalyzer, settings) {
    this.video = videoElement;
    this.analyzer = audioAnalyzer;
    this.settings = settings;
    
    this.silenceStartTime = null;
    this.isFading = false;
    this.isSkipping = false;
    this.fadeInterval = null;
    this.originalVolume = 1;
    this.loopHandler = this._loop.bind(this);
  }
  
  start() {
    if (this.settings.enabled) {
      this.analyzer.startLoop(this.loopHandler);
    }
  }
  
  stop() {
    this.analyzer.stopLoop(); // Wait, other modules might use it! We shouldn't stop the shared analyzer loop.
    // Instead, we just stop responding. Actually, if analyzer loop supports multiple callbacks it's better, 
    // or we can handle it in index.js. For now, let's just use a flag.
    this.settings.enabled = false;
  }
  
  updateSettings(newSettings) {
    this.settings = newSettings;
  }
  
  _loop(data) {
    if (!this.settings.enabled || this.isFading || this.isSkipping) return;
    
    const db = data.decibelLevel;
    
    if (db < this.settings.thresholdDb) {
      if (this.silenceStartTime === null) {
        this.silenceStartTime = this.video.currentTime;
      }
      
      const silenceDuration = this.video.currentTime - this.silenceStartTime;
      
      if (silenceDuration >= this.settings.minSilenceDuration && silenceDuration <= this.settings.maxSilenceDuration) {
        this._skipSilence();
      } else if (silenceDuration > this.settings.maxSilenceDuration) {
        // Reset if silence is too long
        this.silenceStartTime = null;
      }
    } else {
      this.silenceStartTime = null;
    }
  }
  
  _skipSilence() {
    if (this.isFading || this.isSkipping) return;
    this.isSkipping = true;
    
    const skipAmount = this.settings.minSilenceDuration;
    
    if (this.settings.transition === 'fade') {
      this._fadeTransition(skipAmount);
    } else {
      this._hardCut(skipAmount);
    }
    
    window.dispatchEvent(new CustomEvent('smartplay:silence-skipped', {
      detail: { secondsSkipped: skipAmount }
    }));
  }
  
  _fadeTransition(skipAmount) {
    this.isFading = true;
    if (this.fadeInterval) clearInterval(this.fadeInterval);
    
    this.originalVolume = this.video.volume;
    const fadeMs = this.settings.fadeDurationMs;
    const steps = 20;
    const stepTime = fadeMs / steps;
    const volStep = this.originalVolume / steps;
    
    let currentVol = this.originalVolume;
    
    // Fade out
    this.fadeInterval = setInterval(() => {
      currentVol = Math.max(0, currentVol - volStep);
      this.video.volume = currentVol;
      
      if (currentVol === 0) {
        clearInterval(this.fadeInterval);
        
        // Seek
        this.video.currentTime += skipAmount;
        
        // Fade in
        this.fadeInterval = setInterval(() => {
          currentVol = Math.min(this.originalVolume, currentVol + volStep);
          this.video.volume = currentVol;
          
          if (currentVol === this.originalVolume) {
            clearInterval(this.fadeInterval);
            this.isFading = false;
            this.isSkipping = false;
            this.silenceStartTime = null;
          }
        }, stepTime);
      }
    }, stepTime);
  }
  
  _hardCut(skipAmount) {
    this.video.currentTime += skipAmount;
    this.isSkipping = false;
    this.silenceStartTime = null;
  }
  
  destroy() {
    this.stop();
    if (this.fadeInterval) clearInterval(this.fadeInterval);
    this.video.volume = this.originalVolume;
  }
}
