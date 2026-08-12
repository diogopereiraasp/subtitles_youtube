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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fetchWordDefinition };
}
