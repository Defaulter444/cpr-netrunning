/** Controls which should keep their draft while live world updates arrive. */
export function blocksLiveRefresh(element) {
  return !!element?.matches?.('input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"]');
}
