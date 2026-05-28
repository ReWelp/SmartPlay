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

const FILLER_WORDS = ['um', 'uh', 'you know', 'basically', 'literally', 'actually', 'right', 'like'];
