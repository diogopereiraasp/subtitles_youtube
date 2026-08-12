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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ensureSidebarDOM,
    getHeaderHTML,
    renderSubtitleItems,
    formatWordsAsInteractiveSpans,
    ensureModalDOM,
    closeWordModal,
    renderWordModalLoading,
    renderWordModalContent,
    renderWordModalError
  };
}
