(function () {
  let currentVideoId = null;
  let captionTracks = [];
  let currentSubtitles = []; // { start: number, duration: number, text: string }
  let activeTrack = null;
  let autoScrollEnabled = true;
  let isCollapsed = false;
  let activeIndex = -1;

  function log(...args) {
    console.log('[Subtitle Sidebar ContentScript]', ...args);
  }

  // Listen for messages from injected.js (MAIN world)
  window.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'YT_SUBTITLES_CAPTION_DATA') {
      const { videoId, captionTracks: tracks } = event.data;
      if (!videoId) return;

      log(`Received caption data: videoId=${videoId}, tracks=${tracks ? tracks.length : 0}`);

      if (videoId !== currentVideoId || JSON.stringify(tracks) !== JSON.stringify(captionTracks)) {
        currentVideoId = videoId;
        captionTracks = tracks || [];
        onCaptionTracksUpdated();
      }
    } else if (event.data.type === 'YT_SUBTITLES_TRACK_RAW_PAYLOAD') {
      const { videoId, rawText, error } = event.data;
      log(`Received raw payload: length=${rawText ? rawText.length : 0}, error=${error}`);
      onRawTrackPayloadReceived(rawText, error);
    } else if (event.data.type === 'YT_SUBTITLES_PARSED_PAYLOAD') {
      const { subtitles } = event.data;
      log(`Received pre-parsed payload: count=${subtitles ? subtitles.length : 0}`);
      if (subtitles && subtitles.length > 0) {
        currentSubtitles = subtitles;
        renderSidebarContent();
      }
    } else if (event.data.type === 'YT_SUBTITLES_LIVE_CAPTIONS_TEXT') {
      const { rawText } = event.data;
      log(`Received live intercepted captions payload: length=${rawText ? rawText.length : 0}`);
      if (rawText) {
        onRawTrackPayloadReceived(rawText, null);
      }
    }
  });

  // Request caption tracks list
  function requestCaptionData() {
    window.postMessage({ type: 'FETCH_YT_SUBTITLES_DATA' }, '*');
  }

  // Request raw payload for selected track
  function requestTrackPayload(track) {
    window.postMessage({ type: 'FETCH_YT_SUBTITLES_RAW_PAYLOAD', track: track }, '*');
  }

  // Format seconds into MM:SS or HH:MM:SS
  function formatTime(seconds) {
    const s = Math.floor(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  // Helper to escape HTML characters
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Scrape captions directly from YouTube native transcript DOM if available
  function tryScrapeDOMTranscript() {
    const selectors = [
      'ytd-transcript-segment-renderer',
      'ytd-transcript-body-renderer ytd-transcript-segment-renderer',
      'ytd-transcript-search-panel-renderer ytd-transcript-segment-renderer',
      'ytd-transcript-segment-list-renderer div'
    ];

    let segments = [];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els && els.length > 0) {
        segments = Array.from(els);
        break;
      }
    }

    if (segments.length === 0) return null;

    log(`Scraping ${segments.length} segments from YouTube DOM transcript`);
    const parsed = [];
    segments.forEach((seg) => {
      const timeEl =
        seg.querySelector('.segment-timestamp') ||
        seg.querySelector('#timestamp') ||
        seg.querySelector('[class*="timestamp"]');
      const textEl =
        seg.querySelector('.segment-text') ||
        seg.querySelector('#text') ||
        seg.querySelector('[class*="segment-text"]');
      if (timeEl && textEl) {
        const timeStr = timeEl.textContent.trim();
        const textStr = textEl.textContent.trim();
        const parts = timeStr.split(':').map(Number);
        let seconds = 0;
        if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];

        if (textStr) {
          parsed.push({ start: seconds, duration: 2, text: textStr });
        }
      }
    });

    return parsed.length > 0 ? parsed : null;
  }

  // Multi-format subtitle payload parser
  function parseSubtitlesFromRawText(rawText) {
    if (!rawText) return [];
    const trimmed = rawText.trim();
    const parsed = [];

    // A. JSON3 Format ({ events: [ { tStartMs, dDurationMs, segs: [...] } ] })
    if (trimmed.startsWith('{')) {
      try {
        const data = JSON.parse(trimmed);
        if (data && data.events) {
          for (const ev of data.events) {
            let text = '';
            if (ev.segs && Array.isArray(ev.segs)) {
              text = ev.segs
                .map((s) => s.utf8 || s.w || '')
                .join('')
                .replace(/\n/g, ' ')
                .trim();
            } else if (ev.text) {
              text = ev.text.trim();
            } else if (ev.w) {
              text = ev.w.trim();
            }

            if (!text) continue;

            const start = (ev.tStartMs || ev.start || 0) / 1000;
            const duration = (ev.dDurationMs || ev.dur || 0) / 1000;
            parsed.push({ start, duration, text });
          }
        }
      } catch (e) {
        log('JSON parse error:', e);
      }
      if (parsed.length > 0) return parsed;
    }

    // B. XML / SRV3 / TTML Formats
    if (trimmed.includes('<')) {
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(rawText, 'text/xml');

        // B1. Standard XML (<text start="1.5" dur="2.0">Hello</text>)
        const textNodes = xmlDoc.getElementsByTagName('text');
        for (let i = 0; i < textNodes.length; i++) {
          const node = textNodes[i];
          const start = parseFloat(node.getAttribute('start') || '0');
          const duration = parseFloat(node.getAttribute('dur') || '0');
          const rawContent = node.textContent || '';
          const decodedText = new DOMParser().parseFromString(rawContent, 'text/html').body.textContent || rawContent;
          const cleanText = decodedText.replace(/\n/g, ' ').trim();
          if (cleanText) {
            parsed.push({ start, duration, text: cleanText });
          }
        }

        // B2. SRV3 XML (<p t="1500" d="2000"><s>Hello</s></p>)
        if (parsed.length === 0) {
          const pNodes = xmlDoc.getElementsByTagName('p');
          for (let i = 0; i < pNodes.length; i++) {
            const node = pNodes[i];
            let start = 0;
            let duration = 0;

            if (node.hasAttribute('t')) {
              start = parseFloat(node.getAttribute('t') || '0') / 1000;
            } else if (node.hasAttribute('begin')) {
              const b = node.getAttribute('begin');
              start = parseFloat(b) || 0;
            }

            if (node.hasAttribute('d')) {
              duration = parseFloat(node.getAttribute('d') || '0') / 1000;
            }

            const rawContent = node.textContent || '';
            const decodedText = new DOMParser().parseFromString(rawContent, 'text/html').body.textContent || rawContent;
            const cleanText = decodedText.replace(/\n/g, ' ').trim();
            if (cleanText) {
              parsed.push({ start, duration, text: cleanText });
            }
          }
        }
      } catch (e) {
        log('XML parse error:', e);
      }
      if (parsed.length > 0) return parsed;
    }

    // C. WebVTT Format
    if (trimmed.includes('WEBVTT')) {
      const lines = trimmed.split(/\r?\n/);
      let currentStart = null;
      let currentDur = 0;

      for (let line of lines) {
        line = line.trim();
        if (line.includes('-->')) {
          const parts = line.split('-->').map((p) => p.trim());
          const parseVttTime = (tStr) => {
            const p = tStr.split(':');
            if (p.length === 3) return parseFloat(p[0]) * 3600 + parseFloat(p[1]) * 60 + parseFloat(p[2]);
            if (p.length === 2) return parseFloat(p[0]) * 60 + parseFloat(p[1]);
            return 0;
          };
          currentStart = parseVttTime(parts[0]);
          const end = parseVttTime(parts[1]);
          currentDur = end - currentStart;
        } else if (currentStart !== null && line && !line.startsWith('WEBVTT') && !line.match(/^\d+$/)) {
          const cleanText = line.replace(/<[^>]*>/g, '').trim();
          if (cleanText) {
            parsed.push({ start: currentStart, duration: currentDur, text: cleanText });
            currentStart = null;
          }
        }
      }
    }

    return parsed;
  }

  // Load selected subtitle track
  function loadSubtitleTrack(track) {
    activeTrack = track;
    renderSidebarLoading();
    log(`Requesting track payload for language: ${track.displayName || track.languageCode}`);
    requestTrackPayload(track);
  }

  // Handler when raw payload arrives from injected.js
  function onRawTrackPayloadReceived(rawText, error) {
    let parsedSubtitles = parseSubtitlesFromRawText(rawText);
    log(`Parsed ${parsedSubtitles.length} subtitle items from raw payload`);

    // Fallback to DOM Scraper if empty
    if (parsedSubtitles.length === 0) {
      const domSubs = tryScrapeDOMTranscript();
      if (domSubs) {
        log(`DOM scraper fallback retrieved ${domSubs.length} items`);
        parsedSubtitles = domSubs;
      }
    }

    if (parsedSubtitles.length === 0) {
      if (currentSubtitles && currentSubtitles.length > 0) {
        log(`Retaining ${currentSubtitles.length} existing subtitles, ignoring empty payload.`);
        return;
      }
      renderSidebarError(error ? `Error: ${error}` : 'No subtitles found for this track.');
      return;
    }

    currentSubtitles = parsedSubtitles;
    renderSidebarContent();
  }

  let hasTriggeredTranscriptBtn = false;

  function triggerYouTubeNativeTranscript() {
    // If transcript panel is already in DOM, do not click button again
    if (document.querySelector('ytd-transcript-renderer, ytd-transcript-search-panel-renderer, ytd-transcript-body-renderer')) {
      log('Transcript panel already present in DOM.');
      return true;
    }

    if (hasTriggeredTranscriptBtn) return false;

    log('Attempting to trigger YouTube native transcript panel...');

    // 1. Check if transcript section button exists below video description
    const buttons = document.querySelectorAll('button, ytd-button-renderer');
    for (const btn of buttons) {
      const label = (btn.textContent || btn.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('mostrar transcri') || label.includes('show transcript') || label.includes('transcrição') || label.includes('transcript')) {
        log('Found YouTube native transcript button, clicking once...');
        hasTriggeredTranscriptBtn = true;
        btn.click();
        return true;
      }
    }

    // 2. Try clicking video description "More / Mais" button first to expose transcript button
    const expandBtn = document.querySelector('#expand') || document.querySelector('tp-yt-paper-button#expand');
    if (expandBtn) {
      expandBtn.click();
      setTimeout(() => {
        const transBtn = Array.from(document.querySelectorAll('button')).find((b) => {
          const txt = (b.textContent || '').toLowerCase();
          return txt.includes('transcrip') || txt.includes('transcri');
        });
        if (transBtn) {
          hasTriggeredTranscriptBtn = true;
          transBtn.click();
        }
      }, 400);
    }
    return false;
  }

  function onCaptionTracksUpdated() {
    if (currentSubtitles && currentSubtitles.length > 0) {
      log(`onCaptionTracksUpdated: Retaining ${currentSubtitles.length} already loaded subtitles.`);
      return;
    }

    if (!captionTracks || captionTracks.length === 0) {
      log('No captionTracks found via API. Triggering YouTube native transcript...');
      triggerYouTubeNativeTranscript();

      setTimeout(() => {
        const domSubs = tryScrapeDOMTranscript();
        if (domSubs && domSubs.length > 0) {
          currentSubtitles = domSubs;
          renderSidebarContent();
        } else {
          currentSubtitles = [];
          renderSidebarNoCaptions();
        }
      }, 1200);
      return;
    }

    // Select default track (prefer English or Portuguese or first track)
    let defaultTrack = captionTracks.find(
      (t) =>
        t.languageCode === 'en' ||
        t.languageCode === 'pt' ||
        (t.displayName && (t.displayName.toLowerCase().includes('english') || t.displayName.toLowerCase().includes('portuguê')))
    );
    if (!defaultTrack) {
      defaultTrack = captionTracks[0];
    }

    loadSubtitleTrack(defaultTrack);
  }

  // Ensure DOM container for sidebar
  function ensureSidebarDOM() {
    let root = document.getElementById('yt-subtitle-sidebar-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'yt-subtitle-sidebar-root';
      if (isCollapsed) root.classList.add('collapsed');
    }

    // Try YouTube containers in priority order
    const container =
      document.querySelector('#secondary-inner') ||
      document.querySelector('#secondary') ||
      document.querySelector('#columns #secondary') ||
      document.querySelector('#primary-inner') ||
      document.querySelector('#primary');

    if (container && root.parentNode !== container) {
      container.insertBefore(root, container.firstChild);
    }
    return root;
  }

  // Header HTML
  function getHeaderHTML() {
    return `
      <div class="yt-sub-header">
        <div class="yt-sub-title-group">
          <svg viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/></svg>
          <span>Subtitles</span>
        </div>
        <div class="yt-sub-header-actions">
          <button class="yt-sub-btn ${autoScrollEnabled ? 'active' : ''}" id="yt-sub-toggle-autoscroll" title="Toggle Auto-Scroll">
            Auto-Scroll
          </button>
          <button class="yt-sub-btn" id="yt-sub-copy-btn" title="Copy full transcript to clipboard">
            Copy All
          </button>
          <button class="yt-sub-icon-btn" id="yt-sub-toggle-collapse" title="Collapse / Expand">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"/></svg>
          </button>
        </div>
      </div>
    `;
  }

  function renderSidebarLoading() {
    const root = ensureSidebarDOM();
    root.innerHTML = `
      ${getHeaderHTML()}
      <div class="yt-sub-state">
        <div class="yt-sub-spinner"></div>
        <div>Fetching subtitles...</div>
      </div>
    `;
    attachHeaderListeners();
  }

  function renderSidebarNoCaptions() {
    const root = ensureSidebarDOM();
    root.innerHTML = `
      ${getHeaderHTML()}
      <div class="yt-sub-state">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="#666"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/></svg>
        <div>No subtitles available for this video.</div>
      </div>
    `;
    attachHeaderListeners();
  }

  function renderSidebarError(msg) {
    const root = ensureSidebarDOM();
    root.innerHTML = `
      ${getHeaderHTML()}
      <div class="yt-sub-state">
        <div style="color: #ff4e4e;">${escapeHtml(msg)}</div>
      </div>
    `;
    attachHeaderListeners();
  }

  // Render Subtitle List & Controls
  function renderSidebarContent() {
    const root = ensureSidebarDOM();

    const selectOptions = (captionTracks || [])
      .map((t, idx) => {
        const langName = t.displayName || t.languageCode || `Track ${idx + 1}`;
        const selected = activeTrack && activeTrack.baseUrl === t.baseUrl ? 'selected' : '';
        return `<option value="${idx}" ${selected}>${escapeHtml(langName)}</option>`;
      })
      .join('');

    root.innerHTML = `
      ${getHeaderHTML()}
      <div class="yt-sub-controls">
        <div class="yt-sub-search-box">
          <svg class="yt-sub-search-icon" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
          <input type="text" class="yt-sub-search-input" id="yt-sub-search" placeholder="Search transcript..." />
        </div>
        ${
          selectOptions
            ? `<div class="yt-sub-select-wrapper">
                 <select class="yt-sub-select" id="yt-sub-track-select">${selectOptions}</select>
               </div>`
            : ''
        }
      </div>
      <div class="yt-sub-list" id="yt-sub-list">
        ${renderSubtitleItems(currentSubtitles)}
      </div>
    `;

    attachHeaderListeners();
    attachContentListeners();
    bindVideoEvents();
  }

  function renderSubtitleItems(subtitles, filterText = '') {
    if (!subtitles || subtitles.length === 0) {
      return `<div class="yt-sub-state">No matching captions found.</div>`;
    }

    const query = filterText.toLowerCase().trim();

    return subtitles
      .map((item, index) => {
        let textHtml = escapeHtml(item.text);
        if (query) {
          const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
          textHtml = textHtml.replace(regex, '<mark class="yt-sub-highlight">$1</mark>');
        }

        return `
          <div class="yt-sub-item" data-index="${index}" data-start="${item.start}">
            <span class="yt-sub-time">${formatTime(item.start)}</span>
            <span class="yt-sub-text">${textHtml}</span>
          </div>
        `;
      })
      .join('');
  }

  function attachHeaderListeners() {
    const autoScrollBtn = document.getElementById('yt-sub-toggle-autoscroll');
    if (autoScrollBtn) {
      autoScrollBtn.onclick = () => {
        autoScrollEnabled = !autoScrollEnabled;
        autoScrollBtn.classList.toggle('active', autoScrollEnabled);
      };
    }

    const copyBtn = document.getElementById('yt-sub-copy-btn');
    if (copyBtn) {
      copyBtn.onclick = () => {
        if (!currentSubtitles || currentSubtitles.length === 0) return;
        const textToCopy = currentSubtitles
          .map((item) => `[${formatTime(item.start)}] ${item.text}`)
          .join('\n');
        navigator.clipboard.writeText(textToCopy).then(() => {
          const originalText = copyBtn.innerText;
          copyBtn.innerText = 'Copied!';
          setTimeout(() => {
            copyBtn.innerText = originalText;
          }, 1500);
        });
      };
    }

    const collapseBtn = document.getElementById('yt-sub-toggle-collapse');
    const root = document.getElementById('yt-subtitle-sidebar-root');
    if (collapseBtn && root) {
      collapseBtn.onclick = () => {
        isCollapsed = !isCollapsed;
        root.classList.toggle('collapsed', isCollapsed);
        collapseBtn.style.transform = isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
      };
    }
  }

  function attachContentListeners() {
    const trackSelect = document.getElementById('yt-sub-track-select');
    if (trackSelect) {
      trackSelect.onchange = (e) => {
        const selectedIdx = parseInt(e.target.value, 10);
        if (captionTracks[selectedIdx]) {
          loadSubtitleTrack(captionTracks[selectedIdx]);
        }
      };
    }

    const searchInput = document.getElementById('yt-sub-search');
    const subList = document.getElementById('yt-sub-list');
    if (searchInput && subList) {
      searchInput.oninput = (e) => {
        const val = e.target.value;
        const filtered = currentSubtitles.filter((item) => item.text.toLowerCase().includes(val.toLowerCase().trim()));
        subList.innerHTML = renderSubtitleItems(filtered, val);
        bindItemClicks();
      };
    }

    bindItemClicks();
  }

  function bindItemClicks() {
    const subList = document.getElementById('yt-sub-list');
    if (!subList) return;
    const items = subList.querySelectorAll('.yt-sub-item');
    items.forEach((item) => {
      item.onclick = () => {
        const start = parseFloat(item.getAttribute('data-start'));
        const video = document.querySelector('video');
        if (video && !isNaN(start)) {
          video.currentTime = start;
          video.play();
        }
      };
    });
  }

  function bindVideoEvents() {
    const video = document.querySelector('video');
    if (!video) return;

    video.removeEventListener('timeupdate', onVideoTimeUpdate);
    video.addEventListener('timeupdate', onVideoTimeUpdate);
  }

  function onVideoTimeUpdate() {
    const video = document.querySelector('video');
    if (!video || !currentSubtitles || currentSubtitles.length === 0) return;

    const currentTime = video.currentTime;

    let newIndex = -1;
    for (let i = 0; i < currentSubtitles.length; i++) {
      const start = currentSubtitles[i].start;
      const nextStart = i < currentSubtitles.length - 1 ? currentSubtitles[i + 1].start : Infinity;
      if (currentTime >= start && currentTime < nextStart) {
        newIndex = i;
        break;
      }
    }

    if (newIndex !== activeIndex) {
      activeIndex = newIndex;
      updateActiveSubtitleHighlight();
    }
  }

  function updateActiveSubtitleHighlight() {
    const subList = document.getElementById('yt-sub-list');
    if (!subList) return;

    const items = subList.querySelectorAll('.yt-sub-item');
    items.forEach((el) => el.classList.remove('active'));

    if (activeIndex >= 0) {
      const activeEl = subList.querySelector(`.yt-sub-item[data-index="${activeIndex}"]`);
      if (activeEl) {
        activeEl.classList.add('active');
        if (autoScrollEnabled) {
          activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
  }

  function init() {
    setInterval(() => {
      if (window.location.pathname.includes('/watch')) {
        const root = document.getElementById('yt-subtitle-sidebar-root');
        ensureSidebarDOM();

        // If sidebar exists but no subtitles rendered yet, try scraping DOM or requesting captions
        if (!currentSubtitles || currentSubtitles.length === 0) {
          const domSubs = tryScrapeDOMTranscript();
          if (domSubs && domSubs.length > 0) {
            log(`Periodic check scraped ${domSubs.length} lines from YouTube DOM transcript!`);
            currentSubtitles = domSubs;
            renderSidebarContent();
          } else {
            triggerYouTubeNativeTranscript();
            requestCaptionData();
          }
        }
      }
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
