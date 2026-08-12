/**
 * Escapes HTML characters for safe UI rendering
 * @param {string} str
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escapeHtml, cleanUrl };
}
