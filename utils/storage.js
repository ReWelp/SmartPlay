// Uses the browserAPI compat shim (utils/compat.js) so both Chrome and Firefox
// get consistent promise-based storage access.

const getStorage = async (keys) => {
  return browserAPI.storage.sync.get(keys);
};

const setStorage = async (items) => {
  return browserAPI.storage.sync.set(items);
};

const removeStorage = async (keys) => {
  return browserAPI.storage.sync.remove(keys);
};
