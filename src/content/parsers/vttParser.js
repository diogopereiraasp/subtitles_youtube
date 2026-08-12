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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseVttSubtitles };
}
