// Uses the browserAPI compat shim (utils/compat.js) so both Chrome and Firefox
// get consistent promise-based messaging without callback inconsistencies.

const sendToContent = async (tabId, message) => {
  try {
    return await browserAPI.tabs.sendMessage(tabId, message);
  } catch (err) {
    // No content script on that tab yet — swallow silently.
    throw err;
  }
};

const sendToBackground = async (message) => {
  try {
    return await browserAPI.runtime.sendMessage(message);
  } catch (err) {
    throw err;
  }
};
