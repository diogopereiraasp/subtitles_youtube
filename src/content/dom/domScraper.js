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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { tryScrapeDOMTranscript };
}
