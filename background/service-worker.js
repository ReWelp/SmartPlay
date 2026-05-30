// ── SmartPlay Service Worker ──────────────────────────────────────────────────
// Works in both Chrome (MV3 service worker) and Firefox (background script).
// Uses the browserAPI compat shim loaded via background.scripts in manifest.
// ─────────────────────────────────────────────────────────────────────────────
import '../utils/compat.js';

const DEFAULT_SETTINGS = {
  enabled: true,
  mode: 'auto',
  silenceSkipper: {
    enabled: true,
    thresholdDb: -45,
    minSilenceDuration: 0.3,
    maxSilenceDuration: 10,
    transition: 'fade',
    fadeDurationMs: 150,
    chapterAwareThreshold: true  // tighten threshold near chapter boundaries
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

browserAPI.runtime.onInstalled.addListener(() => {
  browserAPI.storage.sync.get(null).then((items) => {
    if (Object.keys(items).length === 0) {
      browserAPI.storage.sync.set(DEFAULT_SETTINGS);
    }
  });
});

const categoryCache = new Map();

browserAPI.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TIME_SAVED_UPDATE') {
    const today = new Date().toISOString().split('T')[0];

    // ── Read both savedStats (today) and lifetimeStats in one call ────────────
    browserAPI.storage.local.get(['savedStats', 'lifetimeStats']).then((res) => {
      // ── Daily stats ──────────────────────────────────────────────────────────
      let stats = res.savedStats || { date: today, silence: 0, speed: 0, filler: 0 };

      // ── Lifetime stats — never reset, only ever grow ─────────────────────────
      let lifetime = res.lifetimeStats || { silence: 0, speed: 0, filler: 0 };

      if (stats.date !== today) {
        // Day rolled over → flush today's totals into lifetime before resetting.
        lifetime.silence += stats.silence;
        lifetime.speed   += stats.speed;
        lifetime.filler  += stats.filler;

        // Reset daily counters.
        stats.date    = today;
        stats.silence = 0;
        stats.speed   = 0;
        stats.filler  = 0;
      }

      // Increment the source bucket in both today and lifetime.
      if (msg.source === 'silence') { stats.silence += msg.secondsSaved; lifetime.silence += msg.secondsSaved; }
      if (msg.source === 'speed')   { stats.speed   += msg.secondsSaved; lifetime.speed   += msg.secondsSaved; }
      if (msg.source === 'filler')  { stats.filler  += msg.secondsSaved; lifetime.filler  += msg.secondsSaved; }

      browserAPI.storage.local.set({ savedStats: stats, lifetimeStats: lifetime });
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

browserAPI.tabs.onActivated.addListener(activeInfo => {
  browserAPI.tabs.get(activeInfo.tabId).then(tab => {
    if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
      // Use try/catch instead of .catch() — Firefox's chrome shim doesn't
      // support chaining .catch() on the callback-based sendMessage form.
      browserAPI.tabs.sendMessage(tab.id, { type: 'TAB_ACTIVATED' }).catch(() => {});
    }
  }).catch(() => {});
});

browserAPI.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('youtube.com/watch')) {
    browserAPI.tabs.sendMessage(tabId, { type: 'TAB_ACTIVATED' }).catch(() => {});
  }
});
