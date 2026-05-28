const getStorage = async (keys) => {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (result) => {
      resolve(result);
    });
  });
};

const setStorage = async (items) => {
  return new Promise((resolve) => {
    chrome.storage.sync.set(items, () => {
      resolve();
    });
  });
};

const removeStorage = async (keys) => {
  return new Promise((resolve) => {
    chrome.storage.sync.remove(keys, () => {
      resolve();
    });
  });
};
