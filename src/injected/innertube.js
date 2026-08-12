/**
 * Innertube API fallback handler to query player endpoint directly
 * @param {string} currentVideoId
 * @returns {Promise<Array<{start: number, duration: number, text: string}>|null>}
 */
async function fetchInnertubeTranscript(currentVideoId) {
  const apiKey = window.yt?.config_?.INNERTUBE_API_KEY || window.ytcfg?.get?.('INNERTUBE_API_KEY');
  const context = window.yt?.config_?.INNERTUBE_CONTEXT || window.ytcfg?.get?.('INNERTUBE_CONTEXT');

  if (!apiKey || !context) return null;

  try {
    const res = await fetch(`/youtubei/v1/player?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: context, videoId: currentVideoId })
    });

    if (!res.ok) return null;
    const playerResp = await res.json();
    const tracks = playerResp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks || tracks.length === 0) return null;

    const firstTrackUrl = (tracks[0].baseUrl || '').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
    if (!firstTrackUrl) return null;

    const jsonUrl = firstTrackUrl.includes('?') ? firstTrackUrl + '&fmt=json3' : firstTrackUrl + '?fmt=json3';
    const subRes = await fetch(jsonUrl, { credentials: 'include' });
    if (!subRes.ok) return null;

    const data = await subRes.json();
    if (!data || !data.events) return null;

    const parsed = [];
    for (const ev of data.events) {
      if (!ev.segs) continue;
      const text = ev.segs
        .map((s) => s.utf8)
        .join('')
        .replace(/\n/g, ' ')
        .trim();
      if (!text) continue;

      const start = (ev.tStartMs || 0) / 1000;
      const duration = (ev.dDurationMs || 0) / 1000;
      parsed.push({ start, duration, text });
    }

    return parsed;
  } catch (e) {
    return null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fetchInnertubeTranscript };
}
