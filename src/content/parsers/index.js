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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseSubtitlesFromRawText };
}
