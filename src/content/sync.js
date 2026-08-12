/**
 * Video playback synchronization and auto-scroll highlighting
 */
function bindVideoEvents(state) {
  const video = document.querySelector('video');
  if (!video) return;

  const onVideoTimeUpdate = () => {
    if (!video || !state.currentSubtitles || state.currentSubtitles.length === 0) return;

    const currentTime = video.currentTime;
    let newIndex = -1;

    for (let i = 0; i < state.currentSubtitles.length; i++) {
      const start = state.currentSubtitles[i].start;
      const nextStart = i < state.currentSubtitles.length - 1 ? state.currentSubtitles[i + 1].start : Infinity;
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

  const items = subList.querySelectorAll('.yt-sub-item');
  items.forEach((el) => el.classList.remove('active'));

  if (state.activeIndex >= 0) {
    const activeEl = subList.querySelector(`.yt-sub-item[data-index="${state.activeIndex}"]`);
    if (activeEl) {
      activeEl.classList.add('active');
      if (state.autoScrollEnabled) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { bindVideoEvents, updateActiveSubtitleHighlight };
}
