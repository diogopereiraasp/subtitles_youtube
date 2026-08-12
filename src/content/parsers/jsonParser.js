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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseJsonSubtitles };
}
