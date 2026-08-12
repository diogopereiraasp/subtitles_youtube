/**
 * Centralized State Manager for YouTube Subtitle Extension
 */
const state = {
  currentVideoId: null,
  captionTracks: [],
  currentSubtitles: [], // { start: number, duration: number, text: string }
  activeTrack: null,
  autoScrollEnabled: true,
  isCollapsed: false,
  viewMode: 'inline', // 'inline' | 'block'
  activeIndex: -1,
  activeWordIndex: -1,
  hasTriggeredTranscriptBtn: false
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { state };
}
