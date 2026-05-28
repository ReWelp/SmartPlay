class ModeDetector {
  async detectMode(videoId, apiKey = null) {
    // 1. API Check if key provided
    if (apiKey) {
      try {
        const response = await new Promise(resolve => {
          chrome.runtime.sendMessage({ type: 'GET_VIDEO_CATEGORY', videoId, apiKey }, resolve);
        });
        if (response && response.categoryId) {
          if (response.categoryId == 10) return 'music';
          if (response.categoryId == 1 || response.categoryId == 30) return 'movie';
        }
      } catch (err) {
        console.warn('SmartPlay: Category API failed', err);
      }
    }

    // 2. Title/description heuristics
    const title = document.title.toLowerCase();
    const metaDesc = document.querySelector('meta[name="description"]')?.content?.toLowerCase() || '';
    const text = title + ' ' + metaDesc;

    if (/official audio|official video|official mv|lyrics| ft\. | feat\. |\(mv\)|\(m\/v\)|music video/.test(text)) {
      return 'music';
    }
    if (/full movie|full episode|season \d|episode \d|documentary/.test(text)) {
      return 'movie';
    }
    if (/podcast|interview| ep\.|#\d+/.test(text)) {
      return 'podcast';
    }
    if (/lecture|tutorial|course|lesson|how to|explained|university/.test(text)) {
      return 'lecture';
    }

    // 3. Channel heuristics
    const channelName = document.querySelector('#channel-name')?.innerText?.toLowerCase() || '';
    if (channelName.includes('records') || channelName.includes('music') || channelName.includes('vevo')) {
      return 'music';
    }

    // 4. Video duration heuristics
    const video = document.querySelector('video');
    if (video && !isNaN(video.duration)) {
      if (video.duration > 3600) return 'movie'; // > 60 mins
      if (video.duration < 240) return 'music'; // < 4 mins
    }

    return 'auto';
  }

  applyMode(mode, settingsObject) {
    // Deep clone to avoid mutating default reference
    const settings = JSON.parse(JSON.stringify(settingsObject));
    settings.mode = mode;

    switch (mode) {
      case 'music':
        settings.silenceSkipper.enabled = false;
        settings.adaptiveSpeed.enabled = false;
        break;
      case 'movie':
        settings.silenceSkipper.enabled = false;
        settings.adaptiveSpeed.enabled = false;
        settings.smartFeatures.fillerTrimmer = false;
        break;
      case 'podcast':
        settings.silenceSkipper.minSilenceDuration = 1.0;
        settings.adaptiveSpeed.maxSpeed = 1.5;
        break;
      case 'lecture':
        settings.adaptiveSpeed.maxSpeed = 1.3;
        break;
      case 'auto':
      default:
        break;
    }

    return settings;
  }
}
