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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseXmlSubtitles };
}
