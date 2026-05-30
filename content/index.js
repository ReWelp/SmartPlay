
let modules = {};
let settings = null;
let currentVideoId = null;
let navObserver = null;
let autoPauseHandler = null;
let statInterval = null;

async function init() {
  const video = await waitForVideo();
  if (!video) return;

  const videoId = TranscriptFetcher.getCurrentVideoId();
  if (videoId === currentVideoId && modules.analyzer) return; // already initialized for this video
  currentVideoId = videoId;

  console.log("SmartPlay: Initializing for video", videoId);
  cleanup(); // Clean up previous instance

  // Load settings
  const stored = await getStorage(null);
  settings = { ...DEFAULT_SETTINGS, ...stored };

  // Detect mode & apply channel memory
  const modeDetector = new ModeDetector();
  let activeMode = settings.mode;
  
  // Try channel memory first
  const channelId = ChannelMemory.getChannelId();
  if (channelId) {
    const channelSettings = await ChannelMemory.getChannelSettings(channelId);
    if (channelSettings) {
      settings = { ...settings, ...channelSettings };
      activeMode = settings.mode;
      console.log("SmartPlay: Loaded channel memory for", channelId);
      // Ensure we clear youtube's own speed localStorage
      localStorage.removeItem('yt-player-playback-rate');
    }
  }
  
  if (activeMode === 'auto') {
    // We don't have API key configured here, so rely on heuristics
    activeMode = await modeDetector.detectMode(videoId);
    console.log("SmartPlay: Detected auto mode:", activeMode);
  }
  
  const appliedSettings = modeDetector.applyMode(activeMode, settings);

  // Initialize modules
  modules.analyzer = new AudioAnalyzer(video);
  modules.skipper = new SilenceSkipper(
    video,
    modules.analyzer,
    appliedSettings.silenceSkipper,
    modules.chapterReader  // enables chapter-aware silence thresholds
  );
  modules.speedController = new SpeedController(video, modules.analyzer, appliedSettings.adaptiveSpeed);
  modules.timeTracker = new TimeTracker();
  modules.fillerTrimmer = new FillerTrimmer(video, appliedSettings.smartFeatures);
  modules.chapterReader = new ChapterReader();

  if (appliedSettings.enabled) {
    modules.skipper.start();
    modules.speedController.start();
    modules.fillerTrimmer.init();
  }

  // Auto pause logic
  if (appliedSettings.smartFeatures.autoPauseOnTabSwitch) {
    autoPauseHandler = () => {
      if (document.hidden) {
        if (!video.paused) video.pause();
      } else {
        setTimeout(() => {
          if (video.paused) video.play();
        }, appliedSettings.smartFeatures.autoPauseResumeDelay || 0);
      }
    };
    document.addEventListener('visibilitychange', autoPauseHandler);
  }

  // Speed tracking loop
  statInterval = setInterval(() => {
    if (modules.speedController && modules.timeTracker) {
      modules.timeTracker.updateSpeedTime(video, modules.speedController.getCurrentSpeed());
    }
  }, 100);

  console.log("SmartPlay: Fully initialized.");
}

function waitForVideo() {
  return new Promise(resolve => {
    const video = document.querySelector('video');
    if (video) return resolve(video);
    
    let retries = 0;
    const interval = setInterval(() => {
      const v = document.querySelector('video');
      if (v) {
        clearInterval(interval);
        resolve(v);
      }
      if (++retries > 50) { // 10 seconds (50 * 200ms)
        clearInterval(interval);
        resolve(null);
      }
    }, 200);
  });
}

function cleanup() {
  if (modules.skipper) modules.skipper.destroy();
  if (modules.speedController) modules.speedController.destroy();
  if (modules.analyzer) modules.analyzer.destroy();
  if (modules.fillerTrimmer) modules.fillerTrimmer.destroy();
  if (modules.timeTracker) modules.timeTracker.destroy();
  if (modules.chapterReader) modules.chapterReader.destroy();
  
  if (autoPauseHandler) {
    document.removeEventListener('visibilitychange', autoPauseHandler);
    autoPauseHandler = null;
  }
  if (statInterval) {
    clearInterval(statInterval);
    statInterval = null;
  }
  
  modules = {};
}

function setupSpaNavigation() {
  let lastUrl = location.href;
  navObserver = new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      if (url.includes('/watch')) {
        setTimeout(init, 500); // Give YT time to load video element
      } else {
        cleanup();
        currentVideoId = null;
      }
    }
  });
  navObserver.observe(document, {subtree: true, childList: true});

  // Mobile YouTube fires 'yt-navigate-finish' on SPA navigation in addition
  // to (or sometimes instead of) triggering DOM mutations. We listen to both
  // so that desktop and mobile navigation are handled reliably.
  window.addEventListener('yt-navigate-finish', () => {
    if (location.href.includes('/watch')) {
      setTimeout(init, 500);
    } else {
      cleanup();
      currentVideoId = null;
    }
  });
}

// Message Listener
browserAPI.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATUS') {
    const stats = {
      speed: modules.speedController ? modules.speedController.getCurrentSpeed() : 1.0,
      audioLevel: modules.analyzer ? modules.analyzer.getDecibelLevel() : -Infinity,
      chapters: modules.chapterReader ? modules.chapterReader.getChapters() : [],
      bufferedMs: modules.timeTracker ? modules.timeTracker.getBufferedMs() : 0
    };
    sendResponse({ settings, stats });
    return true;
  }
  
  if (msg.type === 'UPDATE_SETTING') {
    // msg.key might be nested like 'silenceSkipper.enabled'
    const keys = msg.key.split('.');
    let current = settings;
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = msg.value;
    
    // Live apply
    if (msg.key === 'enabled') {
      if (msg.value) {
        modules.skipper?.start();
        modules.speedController?.start();
      } else {
        modules.skipper?.stop();
        if (modules.speedController) modules.speedController.video.playbackRate = 1.0;
      }
    }
    if (msg.key.startsWith('silenceSkipper')) {
      modules.skipper?.updateSettings(settings.silenceSkipper);
    }
    if (msg.key === 'adaptiveSpeed.maxSpeed') modules.speedController?.setMaxSpeed(msg.value);
    if (msg.key === 'adaptiveSpeed.minSpeed') modules.speedController?.setMinSpeed(msg.value);
    if (msg.key === 'adaptiveSpeed.mode') modules.speedController?.setMode(msg.value);
    
    if (msg.key === 'mode') {
      const modeDetector = new ModeDetector();
      const appliedSettings = modeDetector.applyMode(msg.value, settings);
      
      modules.skipper?.updateSettings(appliedSettings.silenceSkipper);
      if (modules.speedController) {
        modules.speedController.settings = appliedSettings.adaptiveSpeed;
        modules.speedController.setMode(appliedSettings.adaptiveSpeed.mode);
      }
      
      if (!appliedSettings.enabled) {
        modules.skipper?.stop();
        if (modules.speedController) modules.speedController.video.playbackRate = 1.0;
      }
    }
    
    sendResponse({ success: true });
    return true;
  }
  
  if (msg.type === 'SEEK_TO') {
    const video = document.querySelector('video');
    if (video && msg.timestamp !== undefined) {
      video.currentTime = msg.timestamp;
    }
    sendResponse({ success: true });
    return true;
  }
  
  if (msg.type === 'KEYWORD_JUMP') {
    if (!modules.fetcher) modules.fetcher = new TranscriptFetcher();
    modules.fetcher.fetchTranscript(currentVideoId).then(t => {
      const matches = modules.fetcher.searchKeyword(msg.keyword, t);
      if (matches.length > 0) {
        const video = document.querySelector('video');
        if (video) video.currentTime = matches[0].startMs / 1000;
        sendResponse({ success: true, count: matches.length, match: matches[0] });
      } else {
        sendResponse({ success: false, count: 0 });
      }
    });
    return true; // async
  }
  
  if (msg.type === 'SAVE_CHANNEL_DEFAULTS') {
    const channelId = ChannelMemory.getChannelId();
    if (channelId) {
      ChannelMemory.saveChannelSettings(channelId, settings);
      sendResponse({ success: true, channelId });
    } else {
      sendResponse({ success: false });
    }
    return true;
  }
  
  if (msg.type === 'TAB_ACTIVATED') {
    // Maybe show a toast or nothing
  }
});

if (location.href.includes('/watch')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
setupSpaNavigation();
