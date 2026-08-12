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
 * Renders list items HTML
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

      return `
        <div class="yt-sub-item" data-index="${index}" data-start="${item.start}">
          <span class="yt-sub-time">${formatTime(item.start)}</span>
          <span class="yt-sub-text">${textHtml}</span>
        </div>
      `;
    })
    .join('');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ensureSidebarDOM, getHeaderHTML, renderSubtitleItems };
}
