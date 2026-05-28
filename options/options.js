document.addEventListener('DOMContentLoaded', () => {
  const els = {
    globalEnabled: document.getElementById('opt-global-enabled'),
    minSilence: document.getElementById('opt-min-silence'),
    maxSilence: document.getElementById('opt-max-silence'),
    fadeDuration: document.getElementById('opt-fade-duration'),
    rampInterval: document.getElementById('opt-ramp-interval'),
    baseSpeed: document.getElementById('opt-base-speed'),
    apiKey: document.getElementById('opt-api-key'),
    btnSave: document.getElementById('btn-save'),
    status: document.getElementById('save-status')
  };

  // Load
  chrome.storage.sync.get(null, (settings) => {
    if (settings.enabled !== undefined) els.globalEnabled.checked = settings.enabled;
    if (settings.silenceSkipper) {
      els.minSilence.value = settings.silenceSkipper.minSilenceDuration;
      els.maxSilence.value = settings.silenceSkipper.maxSilenceDuration;
      els.fadeDuration.value = settings.silenceSkipper.fadeDurationMs;
    }
    if (settings.adaptiveSpeed) {
      els.rampInterval.value = settings.adaptiveSpeed.rampIntervalSeconds;
      els.baseSpeed.value = settings.adaptiveSpeed.baseSpeed;
    }
    if (settings.apiKey) {
      els.apiKey.value = settings.apiKey;
    }
  });

  // Save
  els.btnSave.addEventListener('click', () => {
    chrome.storage.sync.get(null, (settings) => {
      if (!settings.silenceSkipper) settings.silenceSkipper = {};
      if (!settings.adaptiveSpeed) settings.adaptiveSpeed = {};
      
      settings.enabled = els.globalEnabled.checked;
      
      settings.silenceSkipper.minSilenceDuration = Number(els.minSilence.value);
      settings.silenceSkipper.maxSilenceDuration = Number(els.maxSilence.value);
      settings.silenceSkipper.fadeDurationMs = Number(els.fadeDuration.value);
      
      settings.adaptiveSpeed.rampIntervalSeconds = Number(els.rampInterval.value);
      settings.adaptiveSpeed.baseSpeed = Number(els.baseSpeed.value);
      
      settings.apiKey = els.apiKey.value;

      chrome.storage.sync.set(settings, () => {
        els.status.innerText = "Saved successfully!";
        setTimeout(() => els.status.innerText = "", 2000);
      });
    });
  });
});
