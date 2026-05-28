document.addEventListener('DOMContentLoaded', () => {
  const els = {
    globalEnabled: document.getElementById('opt-global-enabled'),
    minSilence:    document.getElementById('opt-min-silence'),
    maxSilence:    document.getElementById('opt-max-silence'),
    fadeDuration:  document.getElementById('opt-fade-duration'),
    rampInterval:  document.getElementById('opt-ramp-interval'),
    baseSpeed:     document.getElementById('opt-base-speed'),
    apiKey:        document.getElementById('opt-api-key'),
    btnSave:       document.getElementById('btn-save'),
    status:        document.getElementById('save-status'),

    // Today stat cards
    todayTotal:   document.getElementById('stat-today-total'),
    todaySilence: document.getElementById('stat-today-silence'),
    todaySpeed:   document.getElementById('stat-today-speed'),
    todayFiller:  document.getElementById('stat-today-filler'),

    // Lifetime stat cards
    ltTotal:   document.getElementById('stat-lt-total'),
    ltSilence: document.getElementById('stat-lt-silence'),
    ltSpeed:   document.getElementById('stat-lt-speed'),
    ltFiller:  document.getElementById('stat-lt-filler'),
  };

  // ── Time formatter ──────────────────────────────────────────────────────────
  // Converts raw seconds (possibly fractional) into a tidy "Xh Ym Zs" string.
  // Hours only shown when the value is large enough to warrant it.
  function formatSecs(totalSecs) {
    const s = Math.floor(totalSecs || 0);
    if (s < 3600) {
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${m}m ${sec}s`;
    }
    const h   = Math.floor(s / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${m}m ${sec}s`;
  }

  // ── Load stats ──────────────────────────────────────────────────────────────
  function loadStats() {
    chrome.storage.local.get(['savedStats', 'lifetimeStats'], (res) => {
      const today    = res.savedStats    || { silence: 0, speed: 0, filler: 0 };
      const lifetime = res.lifetimeStats || { silence: 0, speed: 0, filler: 0 };

      const todayTotal = (today.silence || 0) + (today.speed || 0) + (today.filler || 0);
      const ltTotal    = (lifetime.silence || 0) + (lifetime.speed || 0) + (lifetime.filler || 0);

      // Today
      els.todayTotal.textContent   = formatSecs(todayTotal);
      els.todaySilence.textContent = formatSecs(today.silence);
      els.todaySpeed.textContent   = formatSecs(today.speed);
      els.todayFiller.textContent  = formatSecs(today.filler);

      // Lifetime
      els.ltTotal.textContent   = formatSecs(ltTotal);
      els.ltSilence.textContent = formatSecs(lifetime.silence);
      els.ltSpeed.textContent   = formatSecs(lifetime.speed);
      els.ltFiller.textContent  = formatSecs(lifetime.filler);
    });
  }

  // Load stats on open and refresh every 2 seconds so values stay live
  loadStats();
  setInterval(loadStats, 2000);

  // ── Load settings ───────────────────────────────────────────────────────────
  chrome.storage.sync.get(null, (settings) => {
    if (settings.enabled !== undefined) els.globalEnabled.checked = settings.enabled;
    if (settings.silenceSkipper) {
      els.minSilence.value   = settings.silenceSkipper.minSilenceDuration;
      els.maxSilence.value   = settings.silenceSkipper.maxSilenceDuration;
      els.fadeDuration.value = settings.silenceSkipper.fadeDurationMs;
    }
    if (settings.adaptiveSpeed) {
      els.rampInterval.value = settings.adaptiveSpeed.rampIntervalSeconds;
      els.baseSpeed.value    = settings.adaptiveSpeed.baseSpeed;
    }
    if (settings.apiKey) {
      els.apiKey.value = settings.apiKey;
    }
  });

  // ── Save settings ───────────────────────────────────────────────────────────
  els.btnSave.addEventListener('click', () => {
    chrome.storage.sync.get(null, (settings) => {
      if (!settings.silenceSkipper) settings.silenceSkipper = {};
      if (!settings.adaptiveSpeed)  settings.adaptiveSpeed  = {};

      settings.enabled = els.globalEnabled.checked;

      settings.silenceSkipper.minSilenceDuration = Number(els.minSilence.value);
      settings.silenceSkipper.maxSilenceDuration = Number(els.maxSilence.value);
      settings.silenceSkipper.fadeDurationMs     = Number(els.fadeDuration.value);

      settings.adaptiveSpeed.rampIntervalSeconds = Number(els.rampInterval.value);
      settings.adaptiveSpeed.baseSpeed           = Number(els.baseSpeed.value);

      settings.apiKey = els.apiKey.value;

      chrome.storage.sync.set(settings, () => {
        els.status.innerText = 'Saved successfully!';
        setTimeout(() => els.status.innerText = '', 2000);
      });
    });
  });
});
