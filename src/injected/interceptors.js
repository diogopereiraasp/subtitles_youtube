/**
 * Sets up network (XHR & Fetch) and property getters/setters to intercept YouTube timedtext payloads
 * @param {Function} onCaptionTrackFound
 * @param {Function} onLiveTextReceived
 */
function setupInterceptors(onCaptionTrackFound, onLiveTextReceived) {
  let globalCaptionsTrack = null;

  // Intercept window.ytInitialPlayerResponse assignments
  let rawYtInitialPlayerResponse = window.ytInitialPlayerResponse;
  Object.defineProperty(window, 'ytInitialPlayerResponse', {
    get() {
      return rawYtInitialPlayerResponse;
    },
    set(val) {
      rawYtInitialPlayerResponse = val;
      if (val?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        globalCaptionsTrack = val.captions.playerCaptionsTracklistRenderer.captionTracks;
        onCaptionTrackFound(globalCaptionsTrack);
      }
    },
    configurable: true,
    enumerable: true
  });

  // Intercept XHR response text for timedtext
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (typeof url === 'string' && url.includes('/api/timedtext')) {
      this.addEventListener('load', function () {
        if (this.responseText && this.responseText.trim().length > 0) {
          onLiveTextReceived(this.responseText);
        }
      });
      setTimeout(() => onCaptionTrackFound(null, url), 200);
    }
    return origOpen.call(this, method, url, ...rest);
  };

  // Intercept Fetch response text for timedtext
  const origFetch = window.fetch;
  window.fetch = async function (resource, init) {
    const url = typeof resource === 'string' ? resource : resource?.url;
    const response = await origFetch.call(this, resource, init);
    if (typeof url === 'string' && url.includes('/api/timedtext')) {
      try {
        const clone = response.clone();
        const text = await clone.text();
        if (text && text.trim().length > 0) {
          onLiveTextReceived(text);
        }
      } catch (e) {}
      setTimeout(() => onCaptionTrackFound(null, url), 200);
    }
    return response;
  };

  return { origFetch, getGlobalCaptionsTrack: () => globalCaptionsTrack };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { setupInterceptors };
}
