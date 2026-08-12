/**
 * Video playback synchronization and active line highlighting
 */
function bindVideoEvents(state) {
  const video = document.querySelector('video');
  if (!video) return;

  const onVideoTimeUpdate = () => {
    if (!video || !state.currentSubtitles || state.currentSubtitles.length === 0) return;

    const currentTime = video.currentTime;
    let newIndex = -1;

    for (let i = 0; i < state.currentSubtitles.length; i++) {
      const seg = state.currentSubtitles[i];
      const start = seg.start;
      const nextStart = i < state.currentSubtitles.length - 1 ? state.currentSubtitles[i + 1].start : start + (seg.duration || 4);

      if (currentTime >= start && currentTime < nextStart) {
        newIndex = i;
        break;
      }
    }

    if (newIndex !== state.activeIndex) {
      state.activeIndex = newIndex;
      updateActiveSubtitleHighlight(state);
    }
  };

  video.removeEventListener('timeupdate', onVideoTimeUpdate);
  video.addEventListener('timeupdate', onVideoTimeUpdate);
}

function updateActiveSubtitleHighlight(state) {
  const subList = document.getElementById('yt-sub-list');
  if (!subList) return;

  // Clear previous active segment highlights
  subList.querySelectorAll('.yt-sub-item, .yt-sub-block-item, .yt-sub-inline-segment').forEach((el) => el.classList.remove('active'));

  if (state.activeIndex >= 0) {
    const activeSegEl = subList.querySelector(`.yt-sub-item[data-index="${state.activeIndex}"], .yt-sub-inline-segment[data-index="${state.activeIndex}"]`);
    if (activeSegEl) {
      activeSegEl.classList.add('active');
      const parentBlock = activeSegEl.closest('.yt-sub-block-item');
      if (parentBlock) parentBlock.classList.add('active');

      if (state.autoScrollEnabled) {
        activeSegEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { bindVideoEvents, updateActiveSubtitleHighlight };
}
