const DEFAULT_SETTINGS = {
  enabled: true,
  mode: 'auto',
  silenceSkipper: {
    enabled: true,
    thresholdDb: -45,
    minSilenceDuration: 0.3,
    maxSilenceDuration: 10,
    transition: 'fade',
    fadeDurationMs: 150
  },
  adaptiveSpeed: {
    enabled: true,
    mode: 'adaptive',
    maxSpeed: 1.5,
    minSpeed: 0.85,
    baseSpeed: 1.0,
    rampIntervalSeconds: 3
  },
  smartFeatures: {
    fillerTrimmer: true,
    chapterNavigator: true,
    autoPauseOnTabSwitch: false,
    autoPauseResumeDelay: 0
  }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(null, (items) => {
    if (Object.keys(items).length === 0) {
      chrome.storage.sync.set(DEFAULT_SETTINGS);
    }
  });
});

const categoryCache = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TIME_SAVED_UPDATE') {
    const today = new Date().toISOString().split('T')[0];
    chrome.storage.local.get(['savedStats'], (res) => {
      let stats = res.savedStats || { date: today, silence: 0, speed: 0, filler: 0, week: 0 };
      
      if (stats.date !== today) {
        // Reset daily, accumulate weekly
        stats.week += (stats.silence + stats.speed + stats.filler);
        stats.date = today;
        stats.silence = 0;
        stats.speed = 0;
        stats.filler = 0;
      }
      
      if (msg.source === 'silence') stats.silence += msg.secondsSaved;
      if (msg.source === 'speed') stats.speed += msg.secondsSaved;
      if (msg.source === 'filler') stats.filler += msg.secondsSaved;
      
      chrome.storage.local.set({ savedStats: stats });
    });
    return true;
  }
  
  if (msg.type === 'GET_VIDEO_CATEGORY') {
    if (categoryCache.has(msg.videoId)) {
      sendResponse({ categoryId: categoryCache.get(msg.videoId) });
    } else {
      fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${msg.videoId}&key=${msg.apiKey}`)
        .then(r => r.json())
        .then(data => {
          if (data.items && data.items.length > 0) {
            const categoryId = data.items[0].snippet.categoryId;
            categoryCache.set(msg.videoId, categoryId);
            sendResponse({ categoryId });
          } else {
            sendResponse({ categoryId: null });
          }
        })
        .catch(() => sendResponse({ categoryId: null }));
      return true; // async
    }
  }
});

chrome.tabs.onActivated.addListener(activeInfo => {
  chrome.tabs.get(activeInfo.tabId, tab => {
    if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
      chrome.tabs.sendMessage(tab.id, { type: 'TAB_ACTIVATED' }).catch(() => {});
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('youtube.com/watch')) {
    chrome.tabs.sendMessage(tabId, { type: 'TAB_ACTIVATED' }).catch(() => {});
  }
});
