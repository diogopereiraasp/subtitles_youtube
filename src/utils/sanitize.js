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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { decodeHtmlEntities, escapeHtml, cleanUrl };
}
