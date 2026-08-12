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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractCaptionTracks };
}
