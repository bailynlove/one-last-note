chrome.runtime.onInstalled.addListener(() => {
  // The popup owns capture state; the worker exists so Chromium assigns the extension an origin.
});
