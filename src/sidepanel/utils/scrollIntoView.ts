/**
 * Smoothly scrolls a sidebar row element into view inside its nearest `.overflow-y-auto`
 * container only if the element is currently clipped or out of view.
 *
 * Returns `true` if a scroll action was initiated, or `false` if the element was already
 * comfortably visible (preventing unwanted jumps when clicking visible rows).
 */
export function scrollElementIntoContainerView(
  el: HTMLElement | null,
  options: { margin?: number; behavior?: ScrollBehavior } = {}
): boolean {
  if (!el) return false;

  const margin = options.margin ?? 12;
  const behavior = options.behavior ?? 'smooth';
  const scrollContainer = el.closest('.overflow-y-auto') as HTMLElement | null;

  if (scrollContainer) {
    const containerRect = scrollContainer.getBoundingClientRect();
    const rowRect = el.getBoundingClientRect();

    // Real browser layout (non-zero bounding rects)
    if (containerRect.height > 0 && rowRect.height > 0) {
      const isVisible =
        rowRect.top >= containerRect.top + 2 &&
        rowRect.bottom <= containerRect.bottom - 2;

      if (isVisible) {
        return false;
      }

      const maxScrollTop = Math.max(
        0,
        scrollContainer.scrollHeight - scrollContainer.clientHeight
      );
      let targetTop = scrollContainer.scrollTop;

      if (rowRect.bottom > containerRect.bottom - 2) {
        const deltaDown = rowRect.bottom - containerRect.bottom + margin;
        targetTop = Math.min(maxScrollTop, scrollContainer.scrollTop + deltaDown);
      } else if (rowRect.top < containerRect.top + 2) {
        const deltaUp = containerRect.top - rowRect.top + margin;
        targetTop = Math.max(0, scrollContainer.scrollTop - deltaUp);
      }

      const initialScrollTop = scrollContainer.scrollTop;

      if (typeof scrollContainer.scrollTo === 'function') {
        scrollContainer.scrollTo({ top: targetTop, behavior });
      } else {
        scrollContainer.scrollTop = targetTop;
      }

      // Safety fallback: if smooth scroll did not start (e.g. backgrounded sidepanel or reduced motion),
      // snap scrollTop directly so the active tab is guaranteed to become visible.
      if (behavior === 'smooth' && typeof window !== 'undefined') {
        window.setTimeout(() => {
          if (!el.isConnected || !scrollContainer.isConnected) return;
          const nextContainerRect = scrollContainer.getBoundingClientRect();
          const nextRowRect = el.getBoundingClientRect();
          if (nextContainerRect.height <= 0 || nextRowRect.height <= 0) return;

          const stillOutOfView =
            nextRowRect.top < nextContainerRect.top + 2 ||
            nextRowRect.bottom > nextContainerRect.bottom - 2;

          if (
            stillOutOfView &&
            Math.abs(scrollContainer.scrollTop - initialScrollTop) < 2
          ) {
            const nextMax = Math.max(
              0,
              scrollContainer.scrollHeight - scrollContainer.clientHeight
            );
            if (nextRowRect.bottom > nextContainerRect.bottom - 2) {
              scrollContainer.scrollTop = Math.min(
                nextMax,
                scrollContainer.scrollTop +
                  (nextRowRect.bottom - nextContainerRect.bottom + margin)
              );
            } else if (nextRowRect.top < nextContainerRect.top + 2) {
              scrollContainer.scrollTop = Math.max(
                0,
                scrollContainer.scrollTop -
                  (nextContainerRect.top - nextRowRect.top + margin)
              );
            }
          }
        }, 140);
      }

      return true;
    }
  }

  // Fallback (e.g. JSDOM zero-rect environment or non-container usage)
  if (typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior, block: 'nearest' });
    return true;
  }

  return false;
}
