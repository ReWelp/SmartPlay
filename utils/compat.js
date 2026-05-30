// ── SmartPlay Browser Compatibility Shim ──────────────────────────────────────
//
// Normalises the Chrome `chrome.*` (callback-based) and Firefox `browser.*`
// (promise-based) extension APIs into a single `browserAPI` global that always
// returns Promises.
//
// Usage: just call `browserAPI.storage.sync.get(...)` etc. anywhere in the
// extension.  Chrome and Firefox both work transparently.
//
// This file must be loaded FIRST — before any other extension script.
// ─────────────────────────────────────────────────────────────────────────────

(() => {
  // Chrome 109+ ships its own `browser.*` namespace, but it still triggers
  // "Unchecked runtime.lastError" warnings when using promise-based APIs and
  // does NOT fully behave like Firefox's native `browser` object.
  //
  // We therefore ONLY use the native `browser` object on Firefox, and always
  // run our own promisify wrapper on Chrome. Firefox is detected via userAgent.
  const _isFirefox = navigator.userAgent.includes('Firefox');
  const _native = (_isFirefox && typeof browser !== 'undefined' && browser.runtime) ? browser : null;
  const _chrome  = (typeof chrome  !== 'undefined' && chrome.runtime)  ? chrome  : null;

  if (!_chrome && !_native) {
    // Should never happen inside an extension context.
    console.error('SmartPlay: No extension API found!');
    return;
  }

  // On Firefox: use the native promise-based `browser` object directly.
  // On Chrome: fall through to build the promisify polyfill below.
  if (_native) {
    window.browserAPI = _native;
    return;
  }

  // ── Promise-wrapping helper ────────────────────────────────────────────────
  // Wraps a Chrome callback-based API call into a Promise.
  // fn  : the Chrome API function to call (e.g. chrome.storage.sync.get)
  // ctx : the `this` context to call it with
  // args: arguments to pass (excluding the callback)
  function promisify(fn, ctx, ...args) {
    return new Promise((resolve, reject) => {
      fn.call(ctx, ...args, (...results) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          // Chrome callbacks with multiple results → resolve with array;
          // single result → resolve with the value directly.
          resolve(results.length === 1 ? results[0] : results);
        }
      });
    });
  }

  // ── Storage ───────────────────────────────────────────────────────────────
  function makeStorageArea(area) {
    return {
      get:    (...a) => promisify(area.get,    area, ...a),
      set:    (...a) => promisify(area.set,    area, ...a),
      remove: (...a) => promisify(area.remove, area, ...a),
      clear:  (...a) => promisify(area.clear,  area, ...a),
    };
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const tabs = _chrome.tabs ? {
    query:       (...a) => promisify(_chrome.tabs.query,       _chrome.tabs, ...a),
    get:         (...a) => promisify(_chrome.tabs.get,         _chrome.tabs, ...a),
    create:      (...a) => promisify(_chrome.tabs.create,      _chrome.tabs, ...a),
    // sendMessage: returns a Promise; rejects on lastError (e.g. no receiver).
    sendMessage: (tabId, msg, opts) => {
      const args = opts ? [tabId, msg, opts] : [tabId, msg];
      return promisify(_chrome.tabs.sendMessage, _chrome.tabs, ...args);
    },
    onActivated: _chrome.tabs.onActivated,
    onUpdated:   _chrome.tabs.onUpdated,
  } : {};

  // ── Runtime ───────────────────────────────────────────────────────────────
  const runtime = {
    sendMessage:    (...a) => promisify(_chrome.runtime.sendMessage, _chrome.runtime, ...a),
    openOptionsPage:()    => promisify(_chrome.runtime.openOptionsPage, _chrome.runtime),
    onMessage:      _chrome.runtime.onMessage,
    onInstalled:    _chrome.runtime.onInstalled,
    get lastError() { return _chrome.runtime.lastError; },
    get id()        { return _chrome.runtime.id; },
  };

  // ── Assemble ──────────────────────────────────────────────────────────────
  window.browserAPI = {
    storage: {
      sync:  makeStorageArea(_chrome.storage.sync),
      local: makeStorageArea(_chrome.storage.local),
      onChanged: _chrome.storage.onChanged,
    },
    tabs,
    runtime,
  };
})();

// ── Mobile YouTube detection ───────────────────────────────────────────────
// True when the extension is running on m.youtube.com (mobile web).
// All mobile-specific code paths should be gated behind this flag so that
// desktop behaviour is completely unchanged.
window.IS_MOBILE_YT = location.hostname === 'm.youtube.com';

// ── getSelectorResult(selectors) ──────────────────────────────────────────
// Tries each CSS selector in order and returns the first non-null Element.
// Use this instead of duplicating desktop/mobile selector fallback chains
// across multiple files.
//
// Example:
//   const el = getSelectorResult([
//     'ytd-video-owner-renderer a.yt-simple-endpoint', // desktop
//     'ytm-slim-owner-renderer a',                     // mobile
//   ]);
window.getSelectorResult = function getSelectorResult(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
};
