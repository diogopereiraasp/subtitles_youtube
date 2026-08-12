(function () {
  let currentTracks = [];
  let currentVideoId = null;
  let interceptedTimedTextUrl = null;
  let globalCaptionsTrack = null;

  function log(...args) {
    console.log('[Subtitle Sidebar PageScript]', ...args);
  }

  // Intercept window.ytInitialPlayerResponse assignments
  let rawYtInitialPlayerResponse = window.ytInitialPlayerResponse;
  Object.defineProperty(window, 'ytInitialPlayerResponse', {
    get() {
      return rawYtInitialPlayerResponse;
    },
    set(val) {
      rawYtInitialPlayerResponse = val;
      if (val?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        log('Intercepted captionTracks on window.ytInitialPlayerResponse assignment!');
        globalCaptionsTrack = val.captions.playerCaptionsTracklistRenderer.captionTracks;
        setTimeout(extractCaptionTracks, 100);
      }
    },
    configurable: true,
    enumerable: true
  });

  // Intercept XHR response text for timedtext
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (typeof url === 'string' && url.includes('/api/timedtext')) {
      log('Intercepted timedtext XHR request:', url.substring(0, 100));
      interceptedTimedTextUrl = url;
      this.addEventListener('load', function () {
        if (this.responseText && this.responseText.trim().length > 0) {
          log(`Intercepted XHR response payload: ${this.responseText.length} bytes`);
          window.postMessage(
            {
              type: 'YT_SUBTITLES_LIVE_CAPTIONS_TEXT',
              rawText: this.responseText
            },
            '*'
          );
        }
      });
      setTimeout(extractCaptionTracks, 200);
    }
    return origOpen.call(this, method, url, ...rest);
  };

  // Intercept Fetch response text for timedtext
  const origFetch = window.fetch;
  window.fetch = async function (resource, init) {
    const url = typeof resource === 'string' ? resource : resource?.url;
    const response = await origFetch.call(this, resource, init);
    if (typeof url === 'string' && url.includes('/api/timedtext')) {
      log('Intercepted timedtext Fetch request:', url.substring(0, 100));
      interceptedTimedTextUrl = url;
      try {
        const clone = response.clone();
        const text = await clone.text();
        if (text && text.trim().length > 0) {
          log(`Intercepted Fetch response payload: ${text.length} bytes`);
          window.postMessage(
            {
              type: 'YT_SUBTITLES_LIVE_CAPTIONS_TEXT',
              rawText: text
            },
            '*'
          );
        }
      } catch (e) {
        log('Error cloning fetch response:', e);
      }
      setTimeout(extractCaptionTracks, 200);
    }
    return response;
  };

  function extractCaptionTracks() {
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
    } catch (e) {
      log('Error reading movie_player API:', e);
    }

    // 2. Check window.ytInitialPlayerResponse & globalCaptionsTrack
    if (!captionTracks) {
      if (globalCaptionsTrack) {
        captionTracks = globalCaptionsTrack;
      } else if (window.ytInitialPlayerResponse) {
        try {
          videoId = videoId || window.ytInitialPlayerResponse?.videoDetails?.videoId;
          captionTracks = window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        } catch (e) {
          log('Error reading ytInitialPlayerResponse:', e);
        }
      }
    }

    // 3. Check ytInitialData and ytplayer config or custom objects
    if (!captionTracks) {
      try {
        if (window.ytInitialData) {
          const str = JSON.stringify(window.ytInitialData);
          const m = str.match(/"captionTracks":\s*(\[[^\]]+\])/);
          if (m) {
            captionTracks = JSON.parse(m[1]);
            log('Extracted captionTracks from window.ytInitialData JSON string');
          }
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
              log('Extracted captionTracks from inline script tag');
              break;
            }
          }
        }
      } catch (e) {}
    }

    // 4. Use intercepted timedtext URL if available
    if (!captionTracks && interceptedTimedTextUrl) {
      log('Constructing captionTrack from intercepted XHR/Fetch URL');
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

    currentTracks = cleanTracks;
    currentVideoId = videoId;

    // If 0 tracks found, try toggling CC player button automatically to trigger network timedtext
    if (cleanTracks.length === 0) {
      const ccBtn = document.querySelector('.ytp-subtitles-button');
      if (ccBtn) {
        log('0 tracks found. Auto-triggering YouTube CC player button...');
        ccBtn.click();
      }
    }

    window.postMessage(
      {
        type: 'YT_SUBTITLES_CAPTION_DATA',
        videoId: videoId,
        captionTracks: cleanTracks
      },
      '*'
    );
  }

  // Fetch track raw text from inside YouTube page context (MAIN world)
  async function fetchTrackContent(track) {
    if (!track || !track.baseUrl) {
      log('Invalid track object passed to fetchTrackContent');
      return;
    }

    let baseUrl = track.baseUrl.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');

    // Clean existing fmt parameter to build URL variants cleanly
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

    const formatsToTry = [
      cleanBaseUrl + sep + 'fmt=json3',
      baseUrl,
      cleanBaseUrl + sep + 'fmt=srv3',
      cleanBaseUrl + sep + 'fmt=vtt'
    ];

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
        } else {
          log(`Fetch returned HTTP ${res.status}`);
        }
      } catch (e) {
        log(`Fetch attempt error:`, e);
        fetchError = e.message;
      }
    }

    if (!rawText) {
      log('All fetch attempts returned empty string. Trying YouTube Innertube transcript API...');
      try {
        const innertubeSubs = await fetchInnertubeTranscript();
        if (innertubeSubs && innertubeSubs.length > 0) {
          log(`Innertube transcript API returned ${innertubeSubs.length} lines`);
          window.postMessage(
            {
              type: 'YT_SUBTITLES_PARSED_PAYLOAD',
              videoId: currentVideoId,
              subtitles: innertubeSubs
            },
            '*'
          );
          return;
        }
      } catch (e) {
        log('Innertube transcript fetch error:', e);
      }
    }

    window.postMessage(
      {
        type: 'YT_SUBTITLES_TRACK_RAW_PAYLOAD',
        videoId: currentVideoId,
        trackUrl: baseUrl,
        rawText: rawText,
        error: fetchError
      },
      '*'
    );
  }

  // Secondary fallback: YouTube Innertube Transcript API
  async function fetchInnertubeTranscript() {
    const apiKey = window.yt?.config_?.INNERTUBE_API_KEY || window.ytcfg?.get?.('INNERTUBE_API_KEY');
    const context = window.yt?.config_?.INNERTUBE_CONTEXT || window.ytcfg?.get?.('INNERTUBE_CONTEXT');

    if (!apiKey || !context) return null;

    const res = await fetch(`/youtubei/v1/player?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        context: context,
        videoId: currentVideoId
      })
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
  }

  // Handle messages from content script
  window.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'FETCH_YT_SUBTITLES_DATA') {
      extractCaptionTracks();
    } else if (event.data.type === 'FETCH_YT_SUBTITLES_RAW_PAYLOAD') {
      fetchTrackContent(event.data.track);
    }
  });

  // YouTube SPA navigation finish listener
  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(extractCaptionTracks, 500);
    setTimeout(extractCaptionTracks, 1500);
  });

  // Initial immediate check
  setTimeout(extractCaptionTracks, 500);
})();
