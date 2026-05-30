document.addEventListener('DOMContentLoaded', async () => {
  const elements = {
    globalToggle: document.getElementById('global-on'),
    timeSavedText: document.getElementById('time-saved-text'),
    modePills: document.querySelectorAll('.mode-pill'),

    silenceCard: document.getElementById('silence-card'),
    silenceToggle: document.getElementById('silence-toggle'),
    transFade: document.getElementById('trans-fade'),
    transHard: document.getElementById('trans-hard'),
    thresholdSlider: document.getElementById('threshold-slider'),
    thresholdVal: document.getElementById('threshold-val'),
    liveMeter: document.getElementById('live-meter'),
    liveVal: document.getElementById('live-val'),

    speedCard: document.getElementById('speed-card'),
    speedToggle: document.getElementById('speed-toggle'),
    liveSpeedVal: document.getElementById('live-speed-val'),
    speedAdaptive: document.getElementById('speed-adaptive'),
    speedMaxBtn: document.getElementById('speed-max'),
    maxSpeedSlider: document.getElementById('max-speed-slider'),
    maxSpeedVal: document.getElementById('max-speed-val'),
    minSpeedSlider: document.getElementById('min-speed-slider'),
    minSpeedVal: document.getElementById('min-speed-val'),

    smartCard: document.getElementById('smart-card'),
    smartHeader: document.getElementById('smart-header'),
    fillerToggle: document.getElementById('filler-toggle'),
    chapterToggle: document.getElementById('chapter-toggle'),
    autopauseToggle: document.getElementById('autopause-toggle'),
    keywordInput: document.getElementById('keyword-input'),
    keywordGo: document.getElementById('keyword-go'),

    btnSettings: document.getElementById('btn-settings'),
    btnSaveChannel: document.getElementById('btn-save-channel'),
    btnHelp: document.getElementById('btn-help'),
    banner: document.getElementById('banner')
  };

  let settings = {};

  // Load initial settings
  browserAPI.storage.sync.get(null).then((items) => {
    const stored = items || {};
    settings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      silenceSkipper: { ...DEFAULT_SETTINGS.silenceSkipper, ...(stored.silenceSkipper || {}) },
      adaptiveSpeed: { ...DEFAULT_SETTINGS.adaptiveSpeed, ...(stored.adaptiveSpeed || {}) },
      smartFeatures: { ...DEFAULT_SETTINGS.smartFeatures, ...(stored.smartFeatures || {}) }
    };
    updateUIFromSettings();
  });

  // ── Shared time formatter ─────────────────────────────────────────────────
  // Converts a raw millisecond value into a human-readable "Xm Ys ZZZms" string.
  function formatMs(ms) {
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    const msec = Math.floor(ms % 1000);
    return `${mins}m ${secs}s ${String(msec).padStart(3, '0')}ms`;
  }

  // Converts seconds (possibly fractional) to ms for display.
  function secsToMs(s) { return (s || 0) * 1000; }

  // ── Today counter ─────────────────────────────────────────────────────────
  // extraMs = live buffered ms from content script (not yet flushed to storage).
  function updateTimeSaved(extraMs = 0) {
    browserAPI.storage.local.get(['savedStats']).then((res) => {
      const saved = res.savedStats || { silence: 0, speed: 0, filler: 0 };
      const totalMs = secsToMs(saved.silence) + secsToMs(saved.speed) + secsToMs(saved.filler) + extraMs;
      elements.timeSavedText.innerText = `⏱ ${formatMs(totalMs)} saved today`;
    });
  }

  // ── Request live stats from content script ────────────────────────────────
  function fetchStats() {
    browserAPI.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com/watch')) {
        elements.banner.classList.add('hidden');
        browserAPI.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' })
          .then((response) => {
            if (!response) { updateTimeSaved(0); return; }

            if (response.settings) {
              settings = response.settings;
              updateUIFromSettings();
            }

            if (response.stats) {
              updateLiveStats(response.stats);
              // Pass the live unflushed speed buffer so the today counter ticks
              updateTimeSaved(response.stats.bufferedMs || 0);
            }
          })
          .catch(() => updateTimeSaved(0));
      } else {
        elements.banner.classList.remove('hidden');
        updateTimeSaved(0);
      }
    });
  }

  // Initial paint — show stored totals immediately while first message round-trips
  updateTimeSaved(0);
  fetchStats();
  setInterval(fetchStats, 100); // 100ms — smooth live counter

  // ── Settings helpers ──────────────────────────────────────────────────────
  function sendUpdate(key, value) {
    browserAPI.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]) {
        browserAPI.tabs.sendMessage(tabs[0].id, { type: 'UPDATE_SETTING', key, value }).catch(() => {});
      }
    });

    // Also persist to storage
    browserAPI.storage.sync.get(null).then((items) => {
      const keys = key.split('.');
      let current = items;
      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      browserAPI.storage.sync.set(items);
    });
  }

  function updateUIFromSettings() {
    if (!settings.enabled) return;

    elements.globalToggle.checked = settings.enabled;

    elements.modePills.forEach(p => p.classList.remove('active'));
    document.querySelector(`.mode-pill[data-mode="${settings.mode}"]`)?.classList.add('active');

    // Silence Skipper
    elements.silenceToggle.checked = settings.silenceSkipper.enabled;
    if (settings.silenceSkipper.enabled && settings.enabled) elements.silenceCard.classList.remove('off');
    else elements.silenceCard.classList.add('off');

    if (settings.silenceSkipper.transition === 'fade') {
      elements.transFade.classList.add('active');
      elements.transHard.classList.remove('active');
    } else {
      elements.transHard.classList.add('active');
      elements.transFade.classList.remove('active');
    }
    if (document.activeElement !== elements.thresholdSlider) {
      elements.thresholdSlider.value = settings.silenceSkipper.thresholdDb;
      elements.thresholdVal.innerText = `${settings.silenceSkipper.thresholdDb} dB`;
    }

    // Adaptive Speed
    if (document.activeElement !== elements.speedToggle) elements.speedToggle.checked = settings.adaptiveSpeed.enabled;
    if (settings.adaptiveSpeed.enabled && settings.enabled) elements.speedCard.classList.remove('off');
    else elements.speedCard.classList.add('off');

    if (settings.adaptiveSpeed.mode === 'adaptive') {
      elements.speedAdaptive.classList.add('active');
      elements.speedMaxBtn.classList.remove('active');
    } else {
      elements.speedMaxBtn.classList.add('active');
      elements.speedAdaptive.classList.remove('active');
    }

    if (document.activeElement !== elements.maxSpeedSlider) {
      elements.maxSpeedSlider.value = settings.adaptiveSpeed.maxSpeed;
      elements.maxSpeedVal.innerText = `${Number(settings.adaptiveSpeed.maxSpeed).toFixed(2)}x`;
    }
    if (document.activeElement !== elements.minSpeedSlider) {
      elements.minSpeedSlider.value = settings.adaptiveSpeed.minSpeed;
      elements.minSpeedVal.innerText = `${Number(settings.adaptiveSpeed.minSpeed).toFixed(2)}x`;
    }

    // Smart Features
    elements.fillerToggle.checked = settings.smartFeatures.fillerTrimmer;
    elements.chapterToggle.checked = settings.smartFeatures.chapterNavigator;
    elements.autopauseToggle.checked = settings.smartFeatures.autoPauseOnTabSwitch;
  }

  function updateLiveStats(stats) {
    elements.liveSpeedVal.innerHTML = `${Number(stats.speed).toFixed(2)}x <span class="dot"></span>`;

    let db = stats.audioLevel;
    if (db === -Infinity) db = -100;
    elements.liveVal.innerText = `${Math.round(db)} dB`;

    const minDb = -70, maxDb = -20;
    let pct = ((db - minDb) / (maxDb - minDb)) * 100;
    pct = Math.max(0, Math.min(100, pct));
    elements.liveMeter.style.width = `${pct}%`;
  }

  // ── Event bindings ────────────────────────────────────────────────────────
  elements.globalToggle.addEventListener('change', (e) => sendUpdate('enabled', e.target.checked));

  elements.modePills.forEach(p => {
    p.addEventListener('click', () => sendUpdate('mode', p.dataset.mode));
  });

  elements.silenceToggle.addEventListener('change', (e) => sendUpdate('silenceSkipper.enabled', e.target.checked));
  elements.transFade.addEventListener('click', () => sendUpdate('silenceSkipper.transition', 'fade'));
  elements.transHard.addEventListener('click', () => sendUpdate('silenceSkipper.transition', 'hard'));

  elements.thresholdSlider.addEventListener('input', (e) => {
    elements.thresholdVal.innerText = `${e.target.value} dB`;
  });
  elements.thresholdSlider.addEventListener('change', (e) => {
    sendUpdate('silenceSkipper.thresholdDb', Number(e.target.value));
  });

  elements.speedToggle.addEventListener('change', (e) => sendUpdate('adaptiveSpeed.enabled', e.target.checked));
  elements.speedAdaptive.addEventListener('click', () => sendUpdate('adaptiveSpeed.mode', 'adaptive'));
  elements.speedMaxBtn.addEventListener('click', () => sendUpdate('adaptiveSpeed.mode', 'max_always'));

  elements.maxSpeedSlider.addEventListener('input', (e) => elements.maxSpeedVal.innerText = `${Number(e.target.value).toFixed(2)}x`);
  elements.maxSpeedSlider.addEventListener('change', (e) => sendUpdate('adaptiveSpeed.maxSpeed', Number(e.target.value)));

  elements.minSpeedSlider.addEventListener('input', (e) => elements.minSpeedVal.innerText = `${Number(e.target.value).toFixed(2)}x`);
  elements.minSpeedSlider.addEventListener('change', (e) => sendUpdate('adaptiveSpeed.minSpeed', Number(e.target.value)));

  elements.smartHeader.addEventListener('click', () => elements.smartCard.classList.toggle('collapsed'));
  elements.fillerToggle.addEventListener('change', (e) => sendUpdate('smartFeatures.fillerTrimmer', e.target.checked));
  elements.chapterToggle.addEventListener('change', (e) => sendUpdate('smartFeatures.chapterNavigator', e.target.checked));
  elements.autopauseToggle.addEventListener('change', (e) => sendUpdate('smartFeatures.autoPauseOnTabSwitch', e.target.checked));

  elements.keywordGo.addEventListener('click', () => {
    const kw = elements.keywordInput.value.trim();
    if (kw) {
      browserAPI.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs[0]) {
          browserAPI.tabs.sendMessage(tabs[0].id, { type: 'KEYWORD_JUMP', keyword: kw })
            .then((res) => { if (res && res.success) elements.keywordInput.value = ''; })
            .catch(() => {});
        }
      });
    }
  });

  elements.btnSettings.addEventListener('click', () => browserAPI.runtime.openOptionsPage());

  elements.btnHelp.addEventListener('click', () => {
    browserAPI.tabs.create({ url: 'https://github.com/ReWelp/SmartPlay' });
  });

  elements.btnSaveChannel.addEventListener('click', () => {
    browserAPI.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      // Only attempt if the active tab is actually a YouTube watch page.
      // Without this guard, clicking on any other tab fires sendMessage to a
      // tab with no content script, producing "Receiving end does not exist".
      if (tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com/watch')) {
        browserAPI.tabs.sendMessage(tabs[0].id, { type: 'SAVE_CHANNEL_DEFAULTS' })
          .then((res) => {
            const orig = elements.btnSaveChannel.innerText;
            if (res && res.success) {
              elements.btnSaveChannel.innerText = 'Saved ✓';
              elements.btnSaveChannel.style.color = '#00E5A0';
            } else {
              elements.btnSaveChannel.innerText = 'Failed ❌';
              elements.btnSaveChannel.style.color = '#FF4444';
            }
            setTimeout(() => {
              elements.btnSaveChannel.innerText = orig;
              elements.btnSaveChannel.style.color = '';
            }, 2000);
          })
          .catch(() => {
            const orig = elements.btnSaveChannel.innerText;
            elements.btnSaveChannel.innerText = 'Error ❌';
            elements.btnSaveChannel.style.color = '#FF4444';
            setTimeout(() => {
              elements.btnSaveChannel.innerText = orig;
              elements.btnSaveChannel.style.color = '';
            }, 2000);
          });
      }
    });
  });
});
