
class ChannelMemory {
  static getChannelId() {
    // YouTube channel link is usually available in the owner container
    const channelLink = document.querySelector('ytd-video-owner-renderer a.yt-simple-endpoint');
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
