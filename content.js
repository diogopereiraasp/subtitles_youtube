(function () {
  function log(...args) {
    console.log('[Subtitle Sidebar ContentScript]', ...args);
  }

  // --- src/utils/time.js ---
  /**
   * Utility function to format seconds into MM:SS or HH:MM:SS format
   * @param {number} seconds
   * @returns {string} Formatted timestamp string
   */
  function formatTime(seconds) {
    const s = Math.floor(seconds || 0);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  // --- src/utils/sanitize.js ---
  /**
   * Decodes HTML entities (like &#039;, &apos;, &quot;, &amp;) into normal text
   * @param {string} str
   * @returns {string} Decoded string
   */
  function decodeHtmlEntities(str) {
    if (!str) return '';
    if (typeof document !== 'undefined') {
      const txt = document.createElement('textarea');
      txt.innerHTML = str;
      return txt.value;
    }
    return String(str)
      .replace(/&#0*39;/g, "'")
      .replace(/&#0*34;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }
  
  /**
   * Escapes HTML characters for safe UI rendering
   * @param {string} str
   * @returns {string} Escaped string
   */
  function escapeHtml(str) {
    if (!str) return '';
    const decoded = decodeHtmlEntities(str);
    return String(decoded)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  
  /**
   * Cleans YouTube URL query parameters
   * @param {string} url
   * @returns {string} Cleaned URL string
   */
  function cleanUrl(url) {
    if (!url) return '';
    return url.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
  }

  // --- src/content/parsers/jsonParser.js ---
  /**
   * Parses JSON3 YouTube subtitle payload format
   * @param {string} trimmedText
   * @returns {Array<{start: number, duration: number, text: string}>}
   */
  function parseJsonSubtitles(trimmedText) {
    const parsed = [];
    if (!trimmedText.startsWith('{')) return parsed;
  
    try {
      const data = JSON.parse(trimmedText);
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
      console.warn('[Subtitle Sidebar] JSON parse error:', e);
    }
  
    return parsed;
  }

  // --- src/content/parsers/xmlParser.js ---
  /**
   * Parses XML & SRV3 YouTube subtitle payload formats (<text> and <p t="..." d="...">)
   * @param {string} rawText
   * @returns {Array<{start: number, duration: number, text: string}>}
   */
  function parseXmlSubtitles(rawText) {
    const parsed = [];
    if (!rawText.includes('<')) return parsed;
  
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(rawText, 'text/xml');
  
      // 1. Standard XML (<text start="1.5" dur="2.0">Hello</text>)
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
  
      // 2. SRV3 XML (<p t="1500" d="2000"><s>Hello</s></p>)
      if (parsed.length === 0) {
        const pNodes = xmlDoc.getElementsByTagName('p');
        for (let i = 0; i < pNodes.length; i++) {
          const node = pNodes[i];
          let start = 0;
          let duration = 0;
  
          if (node.hasAttribute('t')) {
            start = parseFloat(node.getAttribute('t') || '0') / 1000;
          } else if (node.hasAttribute('begin')) {
            start = parseFloat(node.getAttribute('begin') || '0');
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
      console.warn('[Subtitle Sidebar] XML parse error:', e);
    }
  
    return parsed;
  }

  // --- src/content/parsers/vttParser.js ---
  /**
   * Parses WebVTT subtitle payload format
   * @param {string} rawText
   * @returns {Array<{start: number, duration: number, text: string}>}
   */
  function parseVttSubtitles(rawText) {
    const parsed = [];
    if (!rawText.includes('WEBVTT')) return parsed;
  
    const lines = rawText.split(/\r?\n/);
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
  
    return parsed;
  }

  // --- src/content/parsers/index.js ---
  /**
   * Multi-format subtitle payload parser dispatcher (JSON3, Standard XML, SRV3 XML, WebVTT)
   * @param {string} rawText
   * @returns {Array<{start: number, duration: number, text: string}>}
   */
  function parseSubtitlesFromRawText(rawText) {
    if (!rawText) return [];
    const trimmed = rawText.trim();
  
    // 1. JSON3
    if (trimmed.startsWith('{')) {
      const jsonParsed = parseJsonSubtitles(trimmed);
      if (jsonParsed.length > 0) return jsonParsed;
    }
  
    // 2. XML / SRV3 / TTML
    if (trimmed.includes('<')) {
      const xmlParsed = parseXmlSubtitles(rawText);
      if (xmlParsed.length > 0) return xmlParsed;
    }
  
    // 3. WebVTT
    if (trimmed.includes('WEBVTT')) {
      const vttParsed = parseVttSubtitles(rawText);
      if (vttParsed.length > 0) return vttParsed;
    }
  
    return [];
  }

  // --- src/content/dom/domScraper.js ---
  /**
   * Scrapes captions directly from YouTube native transcript DOM if available
   * @returns {Array<{start: number, duration: number, text: string}>|null}
   */
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

  // --- src/content/dom/nativeTrigger.js ---
  let hasTriggeredTranscriptBtn = false;
  
  /**
   * Triggers YouTube native transcript button under video description if transcript panel is not open
   * @returns {boolean} True if button was clicked or panel is present
   */
  function triggerYouTubeNativeTranscript() {
    if (document.querySelector('ytd-transcript-renderer, ytd-transcript-search-panel-renderer, ytd-transcript-body-renderer')) {
      return true;
    }
  
    if (hasTriggeredTranscriptBtn) return false;
  
    const buttons = document.querySelectorAll('button, ytd-button-renderer');
    for (const btn of buttons) {
      const label = (btn.textContent || btn.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('mostrar transcri') || label.includes('show transcript') || label.includes('transcrição') || label.includes('transcript')) {
        hasTriggeredTranscriptBtn = true;
        btn.click();
        return true;
      }
    }
  
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

  // --- src/content/dom/sidebarUI.js ---
  /**
   * Creates or retrieves the main sidebar container DOM element
   * @param {boolean} isCollapsed
   * @returns {HTMLElement}
   */
  function ensureSidebarDOM(isCollapsed = false) {
    let root = document.getElementById('yt-subtitle-sidebar-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'yt-subtitle-sidebar-root';
      if (isCollapsed) root.classList.add('collapsed');
    }
  
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
  
  /**
   * Returns header HTML string
   * @param {boolean} autoScrollEnabled
   * @returns {string}
   */
  function getHeaderHTML(autoScrollEnabled = true) {
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
  
  /**
   * Wraps words into interactive spans while preserving existing HTML tags
   * @param {string} htmlText
   * @returns {string}
   */
  function formatWordsAsInteractiveSpans(htmlText) {
    const parts = htmlText.split(/(<[^>]+>)/g);
    return parts
      .map((part) => {
        if (part.startsWith('<') && part.endsWith('>')) return part;
        return part.replace(/([a-zA-Z0-9'-]+)/g, (w) => `<span class="yt-sub-word" data-word="${escapeHtml(w)}">${w}</span>`);
      })
      .join('');
  }
  
  /**
   * Renders list items HTML with interactive word spans
   * @param {Array} subtitles
   * @param {string} filterText
   * @returns {string}
   */
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
  
        const interactiveText = formatWordsAsInteractiveSpans(textHtml);
  
        return `
          <div class="yt-sub-item" data-index="${index}" data-start="${item.start}">
            <span class="yt-sub-time">${formatTime(item.start)}</span>
            <span class="yt-sub-text">${interactiveText}</span>
          </div>
        `;
      })
      .join('');
  }
  
  /**
   * Ensures modal DOM container exists
   * @returns {HTMLElement}
   */
  function ensureModalDOM() {
    let modal = document.getElementById('yt-sub-word-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'yt-sub-word-modal';
      modal.className = 'yt-sub-modal-backdrop';
      document.body.appendChild(modal);
    }
    return modal;
  }
  
  function closeWordModal(onResumePlayback) {
    const modal = document.getElementById('yt-sub-word-modal');
    if (modal) {
      modal.classList.remove('active');
      modal.innerHTML = '';
    }
    if (typeof onResumePlayback === 'function') {
      onResumePlayback();
    }
  }
  
  function renderWordModalLoading(word) {
    const modal = ensureModalDOM();
    modal.innerHTML = `
      <div class="yt-sub-modal-card">
        <div class="yt-sub-modal-header">
          <span class="yt-sub-modal-word">${escapeHtml(word)}</span>
          <button class="yt-sub-modal-close" id="yt-sub-modal-close-btn">&times;</button>
        </div>
        <div class="yt-sub-modal-body">
          <div class="yt-sub-spinner" style="margin: 20px auto;"></div>
          <div style="text-align:center; color:#aaa; font-size:13px;">Looking up definition in same language...</div>
        </div>
      </div>
    `;
    modal.classList.add('active');
  }
  
  function formatPartOfSpeech(pos) {
    const map = {
      noun: 'Substantivo (Noun)',
      verb: 'Verbo (Verb)',
      adjective: 'Adjetivo (Adjective)',
      adverb: 'Advérbio (Adverb)',
      pronoun: 'Pronome (Pronoun)',
      preposition: 'Preposição (Preposition)',
      conjunction: 'Conjunção (Conjunction)',
      interjection: 'Interjeição (Interjection)'
    };
    const key = (pos || '').toLowerCase().trim();
    return map[key] || pos.toUpperCase();
  }
  
  function renderWordModalContent(data, onResumePlayback) {
    const modal = ensureModalDOM();
    if (!data || !data.meanings || data.meanings.length === 0) {
      renderWordModalError(data?.word || 'Word', 'No definition found for this word.', onResumePlayback);
      return;
    }
  
    const meaningsHtml = data.meanings
      .map(
        (m) => `
        <div class="yt-sub-modal-meaning">
          <span class="yt-sub-modal-pos">${escapeHtml(formatPartOfSpeech(m.partOfSpeech))}</span>
          <ol class="yt-sub-modal-deflist">
            ${m.definitions
              .map(
                (d) => `
              <li>
                <div class="yt-sub-modal-def">${escapeHtml(d.definition)}</div>
                ${d.example ? `<div class="yt-sub-modal-example">"${escapeHtml(d.example)}"</div>` : ''}
              </li>
            `
              )
              .join('')}
          </ol>
        </div>
      `
      )
      .join('');
  
    modal.innerHTML = `
      <div class="yt-sub-modal-card">
        <div class="yt-sub-modal-header">
          <div style="display:flex; align-items:center; gap: 8px;">
            <span class="yt-sub-modal-word">${escapeHtml(data.word)}</span>
            ${data.baseWord ? `<span style="font-size:12px; color:#888;">(from <strong>${escapeHtml(data.baseWord)}</strong>)</span>` : ''}
            ${data.phonetic ? `<span class="yt-sub-modal-phonetic">${escapeHtml(data.phonetic)}</span>` : ''}
            <button class="yt-sub-audio-btn" id="yt-sub-audio-play-btn" title="Listen to pronunciation">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            </button>
          </div>
          <button class="yt-sub-modal-close" id="yt-sub-modal-close-btn">&times;</button>
        </div>
        <div class="yt-sub-modal-body">
          ${meaningsHtml}
        </div>
      </div>
    `;
  
    modal.classList.add('active');
  
    const closeBtn = document.getElementById('yt-sub-modal-close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => closeWordModal(onResumePlayback);
    }
  
    modal.onclick = (e) => {
      if (e.target === modal) {
        closeWordModal(onResumePlayback);
      }
    };
  
    const audioBtn = document.getElementById('yt-sub-audio-play-btn');
    if (audioBtn) {
      audioBtn.onclick = () => {
        const speakWordFallback = () => {
          if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel(); // Stop any ongoing speech
            const utter = new SpeechSynthesisUtterance(data.word);
            utter.lang = 'en-US';
            utter.rate = 0.9;
            window.speechSynthesis.speak(utter);
          }
        };
  
        if (data.audioUrl) {
          let fullUrl = data.audioUrl;
          if (fullUrl.startsWith('//')) fullUrl = 'https:' + fullUrl;
          const audio = new Audio(fullUrl);
          audio.play().catch(() => {
            speakWordFallback();
          });
        } else {
          speakWordFallback();
        }
      };
    }
  }
  
  function renderWordModalError(word, msg, onResumePlayback) {
    const modal = ensureModalDOM();
    modal.innerHTML = `
      <div class="yt-sub-modal-card">
        <div class="yt-sub-modal-header">
          <span class="yt-sub-modal-word">${escapeHtml(word)}</span>
          <button class="yt-sub-modal-close" id="yt-sub-modal-close-btn">&times;</button>
        </div>
        <div class="yt-sub-modal-body" style="text-align:center; padding: 20px; color:#ff6b6b;">
          <div>${escapeHtml(msg)}</div>
        </div>
      </div>
    `;
    modal.classList.add('active');
  
    const closeBtn = document.getElementById('yt-sub-modal-close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => closeWordModal(onResumePlayback);
    }
    modal.onclick = (e) => {
      if (e.target === modal) closeWordModal(onResumePlayback);
    };
  }

  // --- src/content/dictionary.js ---
  /**
   * Monolingual Dictionary API Service
   * Fetches primary definitions, phonetics, audio, and parts of speech for words.
   */
  
  /**
   * Cleans definition text by filtering out non-definitions or meta notes
   * @param {string} text
   * @returns {string}
   */
  function cleanDefinitionText(text) {
    if (!text) return '';
    const trimmed = text.trim();
    if (trimmed.startsWith('Used ') || trimmed.startsWith('Attributive') || trimmed.length < 4) return '';
  
    return trimmed
      .replace(/\s*\([^)]*archaic[^)]*\)/gi, '')
      .replace(/\s*\([^)]*obsolete[^)]*\)/gi, '')
      .trim();
  }
  
  /**
   * Fetches definition for a given word
   * @param {string} word
   * @returns {Promise<Object|null>}
   */
  async function fetchWordDefinition(word) {
    const cleanWord = (word || '').toLowerCase().replace(/[^a-z0-9'-]/gi, '').trim();
    if (!cleanWord) return null;
  
    // 1. Primary API: Free Dictionary API
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const entry = data[0];
          const phonetic = entry.phonetic || entry.phonetics?.find((p) => p.text)?.text || '';
          const audioUrl = entry.phonetics?.find((p) => p.audio && p.audio.length > 0)?.audio || '';
  
          const meaningMap = new Map();
          (entry.meanings || []).forEach((m) => {
            const pos = (m.partOfSpeech || 'definition').toLowerCase();
            if (!meaningMap.has(pos)) meaningMap.set(pos, []);
  
            (m.definitions || []).forEach((d) => {
              const cleanDef = cleanDefinitionText(d.definition);
              if (cleanDef) {
                meaningMap.get(pos).push({
                  definition: cleanDef,
                  example: d.example || null
                });
              }
            });
          });
  
          const meanings = [];
          meaningMap.forEach((defs, pos) => {
            if (defs.length > 0) {
              meanings.push({
                partOfSpeech: pos,
                definitions: defs.slice(0, 2)
              });
            }
          });
  
          if (meanings.length > 0) {
            return {
              word: cleanWord,
              phonetic: phonetic,
              audioUrl: audioUrl,
              meanings: meanings
            };
          }
        }
      }
    } catch (e) {}
  
    // 2. Fallback API: Simple Wiktionary
    try {
      const res = await fetch(`https://simple.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(cleanWord)}&format=json&origin=*`);
      if (res.ok) {
        const wikiData = await res.json();
        const pages = wikiData.query?.pages;
        if (pages) {
          const pageId = Object.keys(pages)[0];
          const extract = pages[pageId]?.extract || '';
          if (extract && !extract.includes('does not have an article')) {
            const lines = extract.split('\n').map((l) => l.trim()).filter(Boolean);
            let pos = 'definition';
            let defs = [];
  
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].startsWith('== ') && lines[i].endsWith(' ==')) {
                pos = lines[i].replace(/=/g, '').trim().toLowerCase();
              } else if (lines[i].length > 15 && !lines[i].startsWith('===') && !lines[i].startsWith('IPA') && !lines[i].startsWith('SAMPA')) {
                const c = cleanDefinitionText(lines[i]);
                if (c) defs.push(c);
              }
            }
  
            if (defs.length > 0) {
              return {
                word: cleanWord,
                phonetic: '',
                audioUrl: '',
                meanings: [
                  {
                    partOfSpeech: pos,
                    definitions: [{ definition: defs[0], example: defs[1] || null }]
                  }
                ]
              };
            }
          }
        }
      }
    } catch (e) {}
  
    return null;
  }

  // --- src/content/state.js ---
  /**
   * Centralized State Manager for YouTube Subtitle Extension
   */
  const state = {
    currentVideoId: null,
    captionTracks: [],
    currentSubtitles: [], // { start: number, duration: number, text: string }
    activeTrack: null,
    autoScrollEnabled: true,
    isCollapsed: false,
    activeIndex: -1,
    hasTriggeredTranscriptBtn: false
  };

  // --- src/content/sync.js ---
  /**
   * Video playback synchronization and auto-scroll highlighting
   */
  function bindVideoEvents(state) {
    const video = document.querySelector('video');
    if (!video) return;
  
    const onVideoTimeUpdate = () => {
      if (!video || !state.currentSubtitles || state.currentSubtitles.length === 0) return;
  
      const currentTime = video.currentTime;
      let newIndex = -1;
  
      for (let i = 0; i < state.currentSubtitles.length; i++) {
        const start = state.currentSubtitles[i].start;
        const nextStart = i < state.currentSubtitles.length - 1 ? state.currentSubtitles[i + 1].start : Infinity;
        if (currentTime >= start && currentTime < nextStart) {
          newIndex = i;
          break;
        }
      }
  
      if (newIndex !== state.activeIndex) {
        state.activeIndex = newIndex;
        updateActiveSubtitleHighlight(state);
      }
    };
  
    video.removeEventListener('timeupdate', onVideoTimeUpdate);
    video.addEventListener('timeupdate', onVideoTimeUpdate);
  }
  
  function updateActiveSubtitleHighlight(state) {
    const subList = document.getElementById('yt-sub-list');
    if (!subList) return;
  
    const items = subList.querySelectorAll('.yt-sub-item');
    items.forEach((el) => el.classList.remove('active'));
  
    if (state.activeIndex >= 0) {
      const activeEl = subList.querySelector(`.yt-sub-item[data-index="${state.activeIndex}"]`);
      if (activeEl) {
        activeEl.classList.add('active');
        if (state.autoScrollEnabled) {
          activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
  }

  window.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'YT_SUBTITLES_CAPTION_DATA') {
      const { videoId, captionTracks: tracks } = event.data;
      if (!videoId) return;
      log(`Received caption data: videoId=${videoId}, tracks=${tracks ? tracks.length : 0}`);
      if (videoId !== state.currentVideoId || JSON.stringify(tracks) !== JSON.stringify(state.captionTracks)) {
        state.currentVideoId = videoId;
        state.captionTracks = tracks || [];
        onCaptionTracksUpdated();
      }
    } else if (event.data.type === 'YT_SUBTITLES_TRACK_RAW_PAYLOAD') {
      const { rawText, error } = event.data;
      log(`Received raw payload: length=${rawText ? rawText.length : 0}, error=${error}`);
      onRawTrackPayloadReceived(rawText, error);
    } else if (event.data.type === 'YT_SUBTITLES_PARSED_PAYLOAD') {
      const { subtitles } = event.data;
      log(`Received pre-parsed payload: count=${subtitles ? subtitles.length : 0}`);
      if (subtitles && subtitles.length > 0) {
        state.currentSubtitles = subtitles;
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

  function requestCaptionData() {
    window.postMessage({ type: 'FETCH_YT_SUBTITLES_DATA' }, '*');
  }

  function requestTrackPayload(track) {
    window.postMessage({ type: 'FETCH_YT_SUBTITLES_RAW_PAYLOAD', track: track }, '*');
  }

  function loadSubtitleTrack(track) {
    state.activeTrack = track;
    renderSidebarLoading();
    log(`Requesting track payload for language: ${track.displayName || track.languageCode}`);
    requestTrackPayload(track);
  }

  function onRawTrackPayloadReceived(rawText, error) {
    let parsedSubtitles = parseSubtitlesFromRawText(rawText);
    log(`Parsed ${parsedSubtitles.length} subtitle items from raw payload`);
    if (parsedSubtitles.length === 0) {
      const domSubs = tryScrapeDOMTranscript();
      if (domSubs) parsedSubtitles = domSubs;
    }
    if (parsedSubtitles.length === 0) {
      if (state.currentSubtitles && state.currentSubtitles.length > 0) {
        log(`Retaining ${state.currentSubtitles.length} existing subtitles, ignoring empty payload.`);
        return;
      }
      renderSidebarError(error ? `Error: ${error}` : 'No subtitles found for this track.');
      return;
    }
    state.currentSubtitles = parsedSubtitles;
    renderSidebarContent();
  }

  function onCaptionTracksUpdated() {
    if (state.currentSubtitles && state.currentSubtitles.length > 0) {
      log(`onCaptionTracksUpdated: Retaining ${state.currentSubtitles.length} already loaded subtitles.`);
      return;
    }
    if (!state.captionTracks || state.captionTracks.length === 0) {
      log('No captionTracks found via API. Triggering YouTube native transcript...');
      triggerYouTubeNativeTranscript();
      setTimeout(() => {
        const domSubs = tryScrapeDOMTranscript();
        if (domSubs && domSubs.length > 0) {
          state.currentSubtitles = domSubs;
          renderSidebarContent();
        } else {
          state.currentSubtitles = [];
          renderSidebarNoCaptions();
        }
      }, 1200);
      return;
    }
    let defaultTrack = state.captionTracks.find(t => t.languageCode === 'en' || t.languageCode === 'pt' || (t.displayName && (t.displayName.toLowerCase().includes('english') || t.displayName.toLowerCase().includes('portuguê'))));
    if (!defaultTrack) defaultTrack = state.captionTracks[0];
    loadSubtitleTrack(defaultTrack);
  }

  function renderSidebarLoading() {
    const root = ensureSidebarDOM(state.isCollapsed);
    root.innerHTML = getHeaderHTML(state.autoScrollEnabled) + '<div class="yt-sub-state"><div class="yt-sub-spinner"></div><div>Fetching subtitles...</div></div>';
    attachHeaderListeners();
  }

  function renderSidebarNoCaptions() {
    const root = ensureSidebarDOM(state.isCollapsed);
    root.innerHTML = getHeaderHTML(state.autoScrollEnabled) + '<div class="yt-sub-state"><div>No subtitles available for this video.</div></div>';
    attachHeaderListeners();
  }

  function renderSidebarError(msg) {
    const root = ensureSidebarDOM(state.isCollapsed);
    root.innerHTML = getHeaderHTML(state.autoScrollEnabled) + `<div class="yt-sub-state"><div style="color: #ff4e4e;">${escapeHtml(msg)}</div></div>`;
    attachHeaderListeners();
  }

  function renderSidebarContent() {
    const root = ensureSidebarDOM(state.isCollapsed);
    const selectOptions = (state.captionTracks || []).map((t, idx) => {
      const langName = t.displayName || t.languageCode || `Track ${idx + 1}`;
      const selected = state.activeTrack && state.activeTrack.baseUrl === t.baseUrl ? 'selected' : '';
      return `<option value="${idx}" ${selected}>${escapeHtml(langName)}</option>`;
    }).join('');

    root.innerHTML = `${getHeaderHTML(state.autoScrollEnabled)}<div class="yt-sub-controls"><div class="yt-sub-search-box"><input type="text" class="yt-sub-search-input" id="yt-sub-search" placeholder="Search transcript..." /></div>${selectOptions ? `<div class="yt-sub-select-wrapper"><select class="yt-sub-select" id="yt-sub-track-select">${selectOptions}</select></div>` : ''}</div><div class="yt-sub-list" id="yt-sub-list">${renderSubtitleItems(state.currentSubtitles)}</div>`;
    attachHeaderListeners();
    attachContentListeners();
    bindVideoEvents(state);
  }

  function attachHeaderListeners() {
    const autoScrollBtn = document.getElementById('yt-sub-toggle-autoscroll');
    if (autoScrollBtn) {
      autoScrollBtn.onclick = () => {
        state.autoScrollEnabled = !state.autoScrollEnabled;
        autoScrollBtn.classList.toggle('active', state.autoScrollEnabled);
      };
    }
    const copyBtn = document.getElementById('yt-sub-copy-btn');
    if (copyBtn) {
      copyBtn.onclick = () => {
        if (!state.currentSubtitles || state.currentSubtitles.length === 0) return;
        const textToCopy = state.currentSubtitles.map(i => `[${formatTime(i.start)}] ${i.text}`).join('\n');
        navigator.clipboard.writeText(textToCopy).then(() => {
          const orig = copyBtn.innerText;
          copyBtn.innerText = 'Copied!';
          setTimeout(() => { copyBtn.innerText = orig; }, 1500);
        });
      };
    }
    const collapseBtn = document.getElementById('yt-sub-toggle-collapse');
    const root = document.getElementById('yt-subtitle-sidebar-root');
    if (collapseBtn && root) {
      collapseBtn.onclick = () => {
        state.isCollapsed = !state.isCollapsed;
        root.classList.toggle('collapsed', state.isCollapsed);
        collapseBtn.style.transform = state.isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
      };
    }
  }

  function attachContentListeners() {
    const trackSelect = document.getElementById('yt-sub-track-select');
    if (trackSelect) {
      trackSelect.onchange = (e) => {
        const idx = parseInt(e.target.value, 10);
        if (state.captionTracks[idx]) loadSubtitleTrack(state.captionTracks[idx]);
      };
    }
    const searchInput = document.getElementById('yt-sub-search');
    const subList = document.getElementById('yt-sub-list');
    if (searchInput && subList) {
      searchInput.oninput = (e) => {
        const val = e.target.value;
        const filtered = state.currentSubtitles.filter(i => i.text.toLowerCase().includes(val.toLowerCase().trim()));
        subList.innerHTML = renderSubtitleItems(filtered, val);
        bindItemClicks();
      };
    }
    bindItemClicks();
  }

  function bindItemClicks() {
    const subList = document.getElementById('yt-sub-list');
    if (!subList) return;
    subList.querySelectorAll('.yt-sub-word').forEach(wordSpan => {
      wordSpan.onclick = async (e) => {
        e.stopPropagation();
        const word = wordSpan.getAttribute('data-word');
        if (!word) return;
        const video = document.querySelector('video');
        if (video) video.pause();
        const langCode = state.activeTrack?.languageCode || 'en';
        renderWordModalLoading(word);
        const defData = await fetchWordDefinition(word, langCode);
        const onResume = () => { if (video) video.play(); };
        if (defData) renderWordModalContent(defData, onResume);
        else renderWordModalError(word, 'No monolingual definition found for this word.', onResume);
      };
    });
    subList.querySelectorAll('.yt-sub-item').forEach(item => {
      item.onclick = (e) => {
        const start = parseFloat(item.getAttribute('data-start'));
        const video = document.querySelector('video');
        if (video && !isNaN(start)) {
          video.currentTime = start;
          video.play();
        }
      };
    });
  }

  function init() {
    setInterval(() => {
      if (window.location.pathname.includes('/watch')) {
        ensureSidebarDOM(state.isCollapsed);
        if (!state.currentSubtitles || state.currentSubtitles.length === 0) {
          const domSubs = tryScrapeDOMTranscript();
          if (domSubs && domSubs.length > 0) {
            state.currentSubtitles = domSubs;
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
