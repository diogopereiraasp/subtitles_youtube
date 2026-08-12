let hasTriggeredTranscriptBtn = false;

/**
 * Triggers YouTube native transcript button under video description if transcript panel is not open
 * @returns {boolean} True if button was clicked or panel is present
 */
function triggerYouTubeNativeTranscript() {
  if (document.querySelector('ytd-transcript-renderer, ytd-transcript-search-panel-renderer, ytd-transcript-body-renderer')) {
    return true;
  }

  if (hasTriggeredTranscriptBtn) return false;

  const buttons = document.querySelectorAll('button, ytd-button-renderer');
  for (const btn of buttons) {
    const label = (btn.textContent || btn.getAttribute('aria-label') || '').toLowerCase();
    if (label.includes('mostrar transcri') || label.includes('show transcript') || label.includes('transcrição') || label.includes('transcript')) {
      hasTriggeredTranscriptBtn = true;
      btn.click();
      return true;
    }
  }

  const expandBtn = document.querySelector('#expand') || document.querySelector('tp-yt-paper-button#expand');
  if (expandBtn) {
    expandBtn.click();
    setTimeout(() => {
      const transBtn = Array.from(document.querySelectorAll('button')).find((b) => {
        const txt = (b.textContent || '').toLowerCase();
        return txt.includes('transcrip') || txt.includes('transcri');
      });
      if (transBtn) {
        hasTriggeredTranscriptBtn = true;
        transBtn.click();
      }
    }, 400);
  }
  return false;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { triggerYouTubeNativeTranscript };
}
