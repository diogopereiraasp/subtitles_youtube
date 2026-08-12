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
  activeIndex: -1,
  hasTriggeredTranscriptBtn: false
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { state };
}
