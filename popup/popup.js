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
  chrome.storage.sync.get(null, (items) => {
    settings = items;
    updateUIFromSettings();
  });

  // Request live stats from content script
  function fetchStats() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com/watch')) {
        elements.banner.classList.add('hidden');
        chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' }, (response) => {
          if (chrome.runtime.lastError || !response) return;
          
          if (response.settings) {
            settings = response.settings; // content script might have applied channel mode/heuristics
            updateUIFromSettings();
          }
          
          if (response.stats) {
            updateLiveStats(response.stats);
          }
        });
      } else {
        elements.banner.classList.remove('hidden');
      }
    });
  }

  fetchStats();
  setInterval(fetchStats, 500);

  // Load time saved from local storage
  chrome.storage.local.get(['savedStats'], (res) => {
    if (res.savedStats) {
      const totalSecs = Math.floor(res.savedStats.silence + res.savedStats.speed + res.savedStats.filler);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      elements.timeSavedText.innerText = `⏱ ${mins}m ${secs}s saved today`;
    }
  });

  // Helpers
  function sendUpdate(key, value) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'UPDATE_SETTING', key, value }).catch(() => {});
      }
    });
    
    // Also save to storage
    chrome.storage.sync.get(null, (items) => {
      const keys = key.split('.');
      let current = items;
      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      chrome.storage.sync.set(items);
    });
  }

  function updateUIFromSettings() {
    if (!settings.enabled) return; // Might be undefined initially

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
    // Speed
    elements.liveSpeedVal.innerHTML = `${Number(stats.speed).toFixed(2)}x <span class="dot"></span>`;
    
    // Audio Level Meter
    let db = stats.audioLevel;
    if (db === -Infinity) db = -100;
    elements.liveVal.innerText = `${Math.round(db)} dB`;
    
    // Map -70 to -20 dB to 0% to 100% width
    const minDb = -70;
    const maxDb = -20;
    let pct = ((db - minDb) / (maxDb - minDb)) * 100;
    pct = Math.max(0, Math.min(100, pct));
    elements.liveMeter.style.width = `${pct}%`;
  }

  // Events
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
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'KEYWORD_JUMP', keyword: kw }, (res) => {
            if (res && res.success) elements.keywordInput.value = ''; // clear on success
          });
        }
      });
    }
  });

  elements.btnSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  
  elements.btnHelp.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://github.com/ReWelp/SmartPlay' });
  });
  
  elements.btnSaveChannel.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SAVE_CHANNEL_DEFAULTS' }, (res) => {
          if (res && res.success) {
            const orig = elements.btnSaveChannel.innerText;
            elements.btnSaveChannel.innerText = 'Saved ✓';
            elements.btnSaveChannel.style.color = '#00E5A0';
            setTimeout(() => {
              elements.btnSaveChannel.innerText = orig;
              elements.btnSaveChannel.style.color = '';
            }, 2000);
          }
        });
      }
    });
  });
});
