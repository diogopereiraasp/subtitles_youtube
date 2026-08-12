/**
 * Utility function to format seconds into MM:SS or HH:MM:SS format
 * @param {number} seconds
 * @returns {string} Formatted timestamp string
 */
function formatTime(seconds) {
  const s = Math.floor(seconds || 0);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatTime };
}
