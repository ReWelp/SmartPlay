
class ChannelMemory {
  static getChannelId() {
    // 1. Fastest path — always present in the page source, not lazy-loaded.
    const metaChannelId = document.querySelector('meta[itemprop="channelId"]');
    if (metaChannelId?.content) return metaChannelId.content;

    // 2. DOM selectors — inlined so there is no dependency on getSelectorResult().
    const selectors = [
      'ytd-video-owner-renderer a.yt-simple-endpoint',  // desktop
      'ytm-slim-owner-renderer a',                      // mobile
      'a.yt-simple-endpoint[href*="/@"]',               // generic handle
      'a.yt-simple-endpoint[href*="/channel/"]',        // generic channel id
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const href = el.getAttribute('href');
        if (href) return href.split('/').pop();
      }
    }
    return null;
  }

  static async getChannelSettings(channelId) {
    if (!channelId) return null;
    const key = `channels.${channelId}`;
    const result = await getStorage([key]);
    return result[key] || null;
  }

  static async saveChannelSettings(channelId, settings) {
    if (!channelId) return;
    const key = `channels.${channelId}`;
    await setStorage({ [key]: settings });
  }
}
