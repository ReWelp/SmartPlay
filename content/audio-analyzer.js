class AudioAnalyzer {
  constructor(videoElement) {
    this.videoElement = videoElement;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    
    this.source = null;
    this.isConnected = false;
    this.animationFrameId = null;
    this.onsetHistory = [];
    
    this._connect();
    
    if (this.ctx.state === 'suspended') {
      const resumeAudio = () => {
        this.ctx.resume();
        document.removeEventListener('click', resumeAudio);
      };
      document.addEventListener('click', resumeAudio, { once: true });
    }
  }
  
  _connect() {
    try {
      // Find existing source if any (Web Audio API limitation workaround if needed)
      // For now, create a new one
      this.source = this.ctx.createMediaElementSource(this.videoElement);
      this.source.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.isConnected = true;
    } catch (err) {
      console.warn("SmartPlay AudioAnalyzer: Failed to connect to video element.", err);
    }
  }

  getAverageAmplitude() {
    if (!this.isConnected) return 0;
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(dataArray);
    
    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const norm = (dataArray[i] / 128.0) - 1.0;
      sumSquares += norm * norm;
    }
    return Math.sqrt(sumSquares / dataArray.length);
  }

  getDecibelLevel() {
    const rms = this.getAverageAmplitude();
    if (rms === 0) return -Infinity;
    return 20 * Math.log10(rms);
  }

  getSpeechOnsetRate() {
    if (!this.isConnected) return 0;
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(dataArray);
    
    let onsets = 0;
    const threshold = 0.1;
    for (let i = 1; i < dataArray.length; i++) {
      const prevNorm = (dataArray[i - 1] / 128.0) - 1.0;
      const currNorm = (dataArray[i] / 128.0) - 1.0;
      if (Math.abs(currNorm - prevNorm) > threshold) {
        onsets++;
      }
    }
    
    // Normalize to estimate per second based on buffer length and sample rate
    // This is a proxy for syllables
    const duration = dataArray.length / this.ctx.sampleRate;
    const onsetRate = onsets / duration;
    
    // Smooth using rolling window
    const now = performance.now();
    this.onsetHistory.push({ time: now, rate: onsetRate });
    this.onsetHistory = this.onsetHistory.filter(o => now - o.time <= 2000);
    
    if (this.onsetHistory.length === 0) return 0;
    const sum = this.onsetHistory.reduce((acc, curr) => acc + curr.rate, 0);
    return (sum / this.onsetHistory.length) / 100; // Scale down to a reasonable number
  }

  startLoop(callback) {
    const loop = () => {
      callback({
        amplitudeRms: this.getAverageAmplitude(),
        decibelLevel: this.getDecibelLevel(),
        onsetRate: this.getSpeechOnsetRate()
      });
      this.animationFrameId = requestAnimationFrame(loop);
    };
    loop();
  }

  stopLoop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  destroy() {
    this.stopLoop();
    if (this.source) {
      this.source.disconnect();
    }
    this.analyser.disconnect();
    this.ctx.close();
  }
}
