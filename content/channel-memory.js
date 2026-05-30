
class ChannelMemory {
  static getChannelId() {
    // Try desktop selector first, then mobile (ytm-slim-owner-renderer),
    // then a generic href-based fallback that works on both layouts.
    // getSelectorResult() is defined in utils/compat.js and returns the first match.
    //
    // Note: per-channel settings (including chapterAwareThreshold) are saved as
    // the full settings blob in saveChannelSettings, so any new keys added to
    // settings are automatically persisted without changes here.
    const channelLink = getSelectorResult([
      'ytd-video-owner-renderer a.yt-simple-endpoint',  // desktop
      'ytm-slim-owner-renderer a',                      // mobile
      'a.yt-simple-endpoint[href*="/@"]',               // generic handle
      'a.yt-simple-endpoint[href*="/channel/"]',        // generic channel id
    ]);
    if (channelLink) {
      const href = channelLink.getAttribute('href');
      if (href) {
        // e.g. /channel/UCXXXX or /@channelname
        const parts = href.split('/');
        return parts[parts.length - 1];
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
