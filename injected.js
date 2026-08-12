(function () {
  let currentVideoId = null;
  let interceptedTimedTextUrl = null;

  function log(...args) {
    console.log('[Subtitle Sidebar PageScript]', ...args);
  }

  // --- src/injected/interceptors.js ---
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

  // --- src/injected/trackExtractor.js ---
  /**
   * Extracts YouTube caption tracks from various page objects
   * @param {Array|null} globalCaptionsTrack
   * @param {string|null} interceptedTimedTextUrl
   * @returns {{videoId: string, cleanTracks: Array}}
   */
  function extractCaptionTracks(globalCaptionsTrack = null, interceptedTimedTextUrl = null) {
    let captionTracks = null;
    let videoId = null;
  
    // 1. Check movie_player API
    try {
      const player = document.getElementById('movie_player');
      if (player) {
        if (typeof player.getPlayerResponse === 'function') {
          const resp = player.getPlayerResponse();
          videoId = resp?.videoDetails?.videoId;
          captionTracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        }
        if (!captionTracks && typeof player.getOption === 'function') {
          captionTracks = player.getOption('captions', 'tracklist');
        }
      }
    } catch (e) {}
  
    // 2. Check window.ytInitialPlayerResponse & globalCaptionsTrack
    if (!captionTracks) {
      if (globalCaptionsTrack) {
        captionTracks = globalCaptionsTrack;
      } else if (window.ytInitialPlayerResponse) {
        try {
          videoId = videoId || window.ytInitialPlayerResponse?.videoDetails?.videoId;
          captionTracks = window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        } catch (e) {}
      }
    }
  
    // 3. Check ytInitialData and inline script tags
    if (!captionTracks) {
      try {
        if (window.ytInitialData) {
          const str = JSON.stringify(window.ytInitialData);
          const m = str.match(/"captionTracks":\s*(\[[^\]]+\])/);
          if (m) captionTracks = JSON.parse(m[1]);
        }
      } catch (e) {}
    }
  
    if (!captionTracks) {
      try {
        const scripts = document.getElementsByTagName('script');
        for (let s of scripts) {
          if (s.textContent && s.textContent.includes('captionTracks')) {
            const m = s.textContent.match(/"captionTracks":\s*(\[[^\]]+\])/);
            if (m) {
              captionTracks = JSON.parse(m[1]);
              break;
            }
          }
        }
      } catch (e) {}
    }
  
    // 4. Use intercepted timedtext URL if available
    if (!captionTracks && interceptedTimedTextUrl) {
      captionTracks = [
        {
          baseUrl: interceptedTimedTextUrl,
          languageCode: 'auto',
          displayName: 'Auto / Intercepted Subtitles'
        }
      ];
    }
  
    // Fallback to URL videoId
    if (!videoId) {
      const urlParams = new URLSearchParams(window.location.search);
      videoId = urlParams.get('v');
    }
  
    let cleanTracks = [];
    if (Array.isArray(captionTracks)) {
      cleanTracks = captionTracks.map((t) => {
        let url = t.baseUrl || t.url || '';
        url = url.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
        const langName = t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode || t.languageName || 'Default';
        return {
          ...t,
          baseUrl: url,
          displayName: langName
        };
      });
    }
  
    // Auto trigger CC player button if 0 tracks found
    if (cleanTracks.length === 0) {
      const ccBtn = document.querySelector('.ytp-subtitles-button');
      if (ccBtn) ccBtn.click();
    }
  
    return { videoId, cleanTracks };
  }

  // --- src/injected/innertube.js ---
  /**
   * Innertube API fallback handler to query player endpoint directly
   * @param {string} currentVideoId
   * @returns {Promise<Array<{start: number, duration: number, text: string}>|null>}
   */
  async function fetchInnertubeTranscript(currentVideoId) {
    const apiKey = window.yt?.config_?.INNERTUBE_API_KEY || window.ytcfg?.get?.('INNERTUBE_API_KEY');
    const context = window.yt?.config_?.INNERTUBE_CONTEXT || window.ytcfg?.get?.('INNERTUBE_CONTEXT');
  
    if (!apiKey || !context) return null;
  
    try {
      const res = await fetch(`/youtubei/v1/player?key=${apiKey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context: context, videoId: currentVideoId })
      });
  
      if (!res.ok) return null;
      const playerResp = await res.json();
      const tracks = playerResp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!tracks || tracks.length === 0) return null;
  
      const firstTrackUrl = (tracks[0].baseUrl || '').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
      if (!firstTrackUrl) return null;
  
      const jsonUrl = firstTrackUrl.includes('?') ? firstTrackUrl + '&fmt=json3' : firstTrackUrl + '?fmt=json3';
      const subRes = await fetch(jsonUrl, { credentials: 'include' });
      if (!subRes.ok) return null;
  
      const data = await subRes.json();
      if (!data || !data.events) return null;
  
      const parsed = [];
      for (const ev of data.events) {
        if (!ev.segs) continue;
        const text = ev.segs
          .map((s) => s.utf8)
          .join('')
          .replace(/\n/g, ' ')
          .trim();
        if (!text) continue;
  
        const start = (ev.tStartMs || 0) / 1000;
        const duration = (ev.dDurationMs || 0) / 1000;
        parsed.push({ start, duration, text });
      }
  
      return parsed;
    } catch (e) {
      return null;
    }
  }

  const { origFetch, getGlobalCaptionsTrack } = setupInterceptors(
    (globalCaptionsTrack, timedTextUrl) => {
      if (timedTextUrl) interceptedTimedTextUrl = timedTextUrl;
      triggerCaptionCheck();
    },
    (liveRawText) => {
      window.postMessage({ type: 'YT_SUBTITLES_LIVE_CAPTIONS_TEXT', rawText: liveRawText }, '*');
    }
  );

  function triggerCaptionCheck() {
    const globalCaptionsTrack = getGlobalCaptionsTrack();
    const { videoId, cleanTracks } = extractCaptionTracks(globalCaptionsTrack, interceptedTimedTextUrl);
    if (videoId) currentVideoId = videoId;
    log(`Found ${cleanTracks.length} caption tracks for video ${currentVideoId}`);
    window.postMessage({ type: 'YT_SUBTITLES_CAPTION_DATA', videoId: currentVideoId, captionTracks: cleanTracks }, '*');
  }

  async function fetchTrackContent(track) {
    if (!track || !track.baseUrl) return;
    let baseUrl = track.baseUrl.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
    let cleanBaseUrl = baseUrl;
    try {
      const parsedUrl = new URL(baseUrl, window.location.origin);
      parsedUrl.searchParams.delete('fmt');
      cleanBaseUrl = parsedUrl.toString();
    } catch (e) {
      cleanBaseUrl = baseUrl.replace(/([?&])fmt=[^&]*(&|$)/, '$1').replace(/[?&]$/, '');
    }
    const sep = cleanBaseUrl.includes('?') ? '&' : '?';
    log(`Fetching track content for video ${currentVideoId}, language: ${track.displayName}`);
    const formatsToTry = [cleanBaseUrl + sep + 'fmt=json3', baseUrl, cleanBaseUrl + sep + 'fmt=srv3', cleanBaseUrl + sep + 'fmt=vtt'];
    let rawText = '';
    let fetchError = null;
    for (const url of formatsToTry) {
      try {
        log(`Trying fetch: ${url.substring(0, 110)}...`);
        const res = await origFetch.call(window, url, { credentials: 'include' });
        if (res.ok) {
          const text = await res.text();
          if (text && text.trim().length > 0) {
            rawText = text;
            log(`Success! Received ${rawText.length} bytes using format URL`);
            break;
          }
        }
      } catch (e) {
        fetchError = e.message;
      }
    }
    if (!rawText) {
      log('Trying YouTube Innertube transcript API...');
      const innertubeSubs = await fetchInnertubeTranscript(currentVideoId);
      if (innertubeSubs && innertubeSubs.length > 0) {
        window.postMessage({ type: 'YT_SUBTITLES_PARSED_PAYLOAD', videoId: currentVideoId, subtitles: innertubeSubs }, '*');
        return;
      }
    }
    window.postMessage({ type: 'YT_SUBTITLES_TRACK_RAW_PAYLOAD', videoId: currentVideoId, trackUrl: baseUrl, rawText: rawText, error: fetchError }, '*');
  }

  window.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'FETCH_YT_SUBTITLES_DATA') triggerCaptionCheck();
    else if (event.data.type === 'FETCH_YT_SUBTITLES_RAW_PAYLOAD') fetchTrackContent(event.data.track);
  });

  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(triggerCaptionCheck, 500);
    setTimeout(triggerCaptionCheck, 1500);
  });

  setTimeout(triggerCaptionCheck, 500);
})();
