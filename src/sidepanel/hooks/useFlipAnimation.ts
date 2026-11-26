import type React from 'react';
import { useEffect, useLayoutEffect, useRef } from 'react';

interface RelativePos {
  left: number;
  top: number;
}

interface ElementSnapshot {
  el: HTMLElement;
  pos: RelativePos;
  width: number;
  height: number;
}

interface ExitGhostEntry {
  ghost: HTMLElement;
  anim: Animation;
}

function parseFolderCollapseMap(orderSignature: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!orderSignature) return map;
  const parts = orderSignature.split(',');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const colonIdx = part.indexOf(':');
    if (colonIdx > 0) {
      map.set(part.slice(0, colonIdx), part.slice(colonIdx + 1));
    }
  }
  return map;
}

function didAnyFolderCollapseToggle(
  prevMap: Map<string, string>,
  nextMap: Map<string, string>
): boolean {
  for (const [folderId, prevState] of prevMap.entries()) {
    const nextState = nextMap.get(folderId);
    if (nextState !== undefined && nextState !== prevState) {
      return true;
    }
  }
  return false;
}

/**
 * Hardware-accelerated FLIP (First, Last, Invert, Play) layout animation hook
 * for lists/grids whose children declare `data-flip-id="..."`.
 * Measures positions relative to the container so scroll offsets never trigger false shifts,
 * fades/scales out exiting items via lightweight non-interactive ghosts, and smoothly
 * contracts container height on removal so sibling sections below glide without snapping.
 * Cancels active FLIP animations before measuring resting layout coordinates so rapid
 * back-to-back updates never corrupt stored positions or accumulate transform drift.
 */
export function useFlipAnimation(
  containerRef: React.RefObject<HTMLElement | null>,
  orderSignature: string,
  resetKey?: string
): void {
  const prevPositionsRef = useRef<Map<string, RelativePos>>(new Map());
  const prevSnapshotsRef = useRef<Map<string, ElementSnapshot>>(new Map());
  const prevFolderStatesRef = useRef<Map<string, string>>(new Map());
  const prevResetKeyRef = useRef<string | undefined>(resetKey);
  const prevContainerWidthRef = useRef<number | null>(null);
  const prevContainerHeightRef = useRef<number | null>(null);
  const activeAnimationsRef = useRef<Map<HTMLElement, Animation>>(new Map());
  const activeExitGhostsRef = useRef<Set<ExitGhostEntry>>(new Set());
  const containerHeightAnimRef = useRef<Animation | null>(null);
  const savedContainerPosRef = useRef<string | null>(null);

  useEffect(() => {
    const activeAnimations = activeAnimationsRef.current;
    const activeExitGhosts = activeExitGhostsRef.current;
    const containerEl = containerRef.current;
    return () => {
      activeAnimations.forEach((anim) => {
        try {
          anim.cancel();
        } catch {
          // Ignore environments without full Web Animations API support
        }
      });
      activeAnimations.clear();

      activeExitGhosts.forEach((entry) => {
        try {
          entry.anim.cancel();
        } catch {
          // Ignore
        }
        entry.ghost.remove();
      });
      activeExitGhosts.clear();

      if (containerHeightAnimRef.current) {
        try {
          containerHeightAnimRef.current.cancel();
        } catch {
          // Ignore
        }
        containerHeightAnimRef.current = null;
      }

      if (containerEl && savedContainerPosRef.current !== null) {
        if (savedContainerPosRef.current) {
          containerEl.style.position = savedContainerPosRef.current;
        } else {
          containerEl.style.removeProperty('position');
        }
        savedContainerPosRef.current = null;
      }
    };
  }, [containerRef]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const activeAnimations = activeAnimationsRef.current;
    const activeExitGhosts = activeExitGhostsRef.current;

    const clearAllExitGhosts = () => {
      if (activeExitGhosts.size === 0) return;
      activeExitGhosts.forEach((entry) => {
        try {
          entry.anim.cancel();
        } catch {
          // Ignore
        }
        entry.ghost.remove();
      });
      activeExitGhosts.clear();
      if (container && savedContainerPosRef.current !== null) {
        if (savedContainerPosRef.current) {
          container.style.position = savedContainerPosRef.current;
        } else {
          container.style.removeProperty('position');
        }
        savedContainerPosRef.current = null;
      }
    };

    if (!container) {
      activeAnimations.forEach((anim) => {
        try {
          anim.cancel();
        } catch {
          // Ignore
        }
      });
      activeAnimations.clear();
      clearAllExitGhosts();
      if (containerHeightAnimRef.current) {
        try {
          containerHeightAnimRef.current.cancel();
        } catch {
          // Ignore
        }
        containerHeightAnimRef.current = null;
      }
      prevPositionsRef.current = new Map();
      prevSnapshotsRef.current = new Map();
      prevFolderStatesRef.current = new Map();
      prevContainerWidthRef.current = null;
      prevContainerHeightRef.current = null;
      prevResetKeyRef.current = resetKey;
      return;
    }

    const elements = Array.from(
      container.querySelectorAll<HTMLElement>('[data-flip-id]')
    );

    const isResetOrReducedMotion =
      prevResetKeyRef.current !== resetKey ||
      (typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    prevResetKeyRef.current = resetKey;

    const nextFolderStates = parseFolderCollapseMap(orderSignature);
    const folderToggled = didAnyFolderCollapseToggle(
      prevFolderStatesRef.current,
      nextFolderStates
    );
    prevFolderStatesRef.current = nextFolderStates;

    if (isResetOrReducedMotion) {
      clearAllExitGhosts();
    }

    const scrollLeft = container.scrollLeft || 0;
    const scrollTop = container.scrollTop || 0;

    // 1. Batch-read visual rects of elements (and container height) that currently have an active
    //    animation so we can extract their in-flight offset before cancelling.
    let inFlightContainerHeight: number | null = null;
    if (
      !isResetOrReducedMotion &&
      containerHeightAnimRef.current &&
      containerHeightAnimRef.current.playState !== 'idle' &&
      containerHeightAnimRef.current.playState !== 'finished'
    ) {
      inFlightContainerHeight = container.getBoundingClientRect().height;
    }

    const animatedRects = new Map<HTMLElement, RelativePos>();
    if (!isResetOrReducedMotion && activeAnimations.size > 0) {
      const preCancelContainerRect = container.getBoundingClientRect();
      elements.forEach((el) => {
        const anim = activeAnimations.get(el);
        if (anim && anim.playState !== 'idle' && anim.playState !== 'finished') {
          const rect = el.getBoundingClientRect();
          animatedRects.set(el, {
            left: rect.left - preCancelContainerRect.left + scrollLeft,
            top: rect.top - preCancelContainerRect.top + scrollTop
          });
        }
      });
    }

    // 2. Batch-cancel all active FLIP & height animations so layout reads capture true resting positions.
    if (activeAnimations.size > 0) {
      activeAnimations.forEach((anim) => {
        try {
          anim.cancel();
        } catch {
          // Ignore
        }
      });
      activeAnimations.clear();
    }
    if (containerHeightAnimRef.current) {
      try {
        containerHeightAnimRef.current.cancel();
      } catch {
        // Ignore
      }
      containerHeightAnimRef.current = null;
    }

    // 3. Batch-read true, untransformed resting layout positions relative to container content box.
    const containerRect = container.getBoundingClientRect();
    const hasContainerResized =
      prevContainerWidthRef.current !== null &&
      Math.abs(containerRect.width - prevContainerWidthRef.current) > 0.5;
    prevContainerWidthRef.current = containerRect.width;

    const shouldSkipAnimation = isResetOrReducedMotion || hasContainerResized;
    if (hasContainerResized) {
      clearAllExitGhosts();
    }

    const nextPositions = new Map<string, RelativePos>();
    const nextSnapshots = new Map<string, ElementSnapshot>();
    const pendingAnimations: Array<{ el: HTMLElement; dx: number; dy: number }> = [];

    elements.forEach((el) => {
      const id = el.dataset.flipId;
      if (!id) return;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const restingPos: RelativePos = {
        left: rect.left - containerRect.left + scrollLeft,
        top: rect.top - containerRect.top + scrollTop
      };
      nextPositions.set(id, restingPos);
      nextSnapshots.set(id, {
        el,
        pos: restingPos,
        width: rect.width,
        height: rect.height
      });

      if (shouldSkipAnimation || typeof el.animate !== 'function') return;

      const prevPos = prevPositionsRef.current.get(id);
      if (!prevPos) return;

      // Reconstruct the element's pre-render visual position:
      // prevRestingPos + currentTransformOffset, where currentTransformOffset = animatedPos - restingPos.
      const animatedPos = animatedRects.get(el);
      const startLeft = animatedPos
        ? prevPos.left + (animatedPos.left - restingPos.left)
        : prevPos.left;
      const startTop = animatedPos
        ? prevPos.top + (animatedPos.top - restingPos.top)
        : prevPos.top;

      const dx = startLeft - restingPos.left;
      const dy = startTop - restingPos.top;

      if ((Math.abs(dx) > 1 || Math.abs(dy) > 1) && Math.abs(dx) < 420 && Math.abs(dy) < 420) {
        pendingAnimations.push({ el, dx, dy });
      }
    });

    // 4. Spawn smooth fade-and-shrink exit ghosts for removed rows (when not collapsing a folder).
    if (!shouldSkipAnimation && !folderToggled && prevSnapshotsRef.current.size > 0) {
      const removedSnapshots: ElementSnapshot[] = [];
      prevSnapshotsRef.current.forEach((snap, id) => {
        if (!nextPositions.has(id) && snap.width > 0 && snap.height > 0) {
          removedSnapshots.push(snap);
        }
      });

      if (removedSnapshots.length > 0 && removedSnapshots.length <= 6) {
        removedSnapshots.forEach((snap) => {
          try {
            const ghost = snap.el.cloneNode(true) as HTMLElement;
            if (typeof ghost.animate !== 'function') return;

            ghost.removeAttribute('data-flip-id');
            ghost.removeAttribute('data-testid');
            ghost.removeAttribute('data-tab-id');
            ghost.removeAttribute('data-bookmark-id');
            ghost.removeAttribute('id');
            ghost.removeAttribute('role');
            ghost.removeAttribute('tabindex');
            ghost.dataset.flipExitGhost = 'true';
            ghost.setAttribute('aria-hidden', 'true');
            ghost
              .querySelectorAll('[data-flip-id],[data-testid],[data-tab-id],[data-bookmark-id],[id]')
              .forEach((child) => {
                child.removeAttribute('data-flip-id');
                child.removeAttribute('data-testid');
                child.removeAttribute('data-tab-id');
                child.removeAttribute('data-bookmark-id');
                child.removeAttribute('id');
              });

            ghost.style.position = 'absolute';
            ghost.style.left = `${snap.pos.left}px`;
            ghost.style.top = `${snap.pos.top}px`;
            ghost.style.width = `${snap.width}px`;
            ghost.style.height = `${snap.height}px`;
            ghost.style.margin = '0';
            ghost.style.pointerEvents = 'none';
            ghost.style.zIndex = '0';
            ghost.style.transformOrigin = 'left center';

            if (
              activeExitGhosts.size === 0 &&
              typeof window !== 'undefined' &&
              typeof window.getComputedStyle === 'function' &&
              window.getComputedStyle(container).position === 'static'
            ) {
              savedContainerPosRef.current = container.style.position || '';
              container.style.position = 'relative';
            }

            container.appendChild(ghost);
            const ghostAnim = ghost.animate(
              [
                { opacity: 1, transform: 'scale(1) translateX(0px)' },
                { opacity: 0, transform: 'scale(0.96) translateX(-6px)' }
              ],
              {
                duration: 150,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                fill: 'forwards'
              }
            );

            if (ghostAnim) {
              const entry: ExitGhostEntry = { ghost, anim: ghostAnim };
              activeExitGhosts.add(entry);
              const cleanupGhost = () => {
                if (!activeExitGhosts.has(entry)) return;
                activeExitGhosts.delete(entry);
                ghost.remove();
                if (activeExitGhosts.size === 0 && savedContainerPosRef.current !== null) {
                  if (savedContainerPosRef.current) {
                    container.style.position = savedContainerPosRef.current;
                  } else {
                    container.style.removeProperty('position');
                  }
                  savedContainerPosRef.current = null;
                }
              };
              ghostAnim.onfinish = cleanupGhost;
              ghostAnim.oncancel = cleanupGhost;
            } else {
              ghost.remove();
            }
          } catch {
            // Ignore environments without full DOM / WAAPI support
          }
        });
      }
    }

    // 5. Batch-start new FLIP item animations.
    pendingAnimations.forEach(({ el, dx, dy }) => {
      try {
        const anim = el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: 'translate(0, 0)' }
          ],
          {
            duration: 190,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
          }
        );
        if (anim) {
          activeAnimations.set(el, anim);
          const clearIfCurrent = () => {
            if (activeAnimations.get(el) === anim) {
              activeAnimations.delete(el);
            }
          };
          anim.onfinish = clearIfCurrent;
          anim.oncancel = clearIfCurrent;
        }
      } catch {
        // Ignore environments without full Web Animations API support
      }
    });

    // 6. Smoothly contract container height when items are removed or collapsed so sections below
    //    glide upward in lockstep instead of snapping 1 frame ahead of moving rows.
    const startHeight = inFlightContainerHeight ?? prevContainerHeightRef.current;
    if (
      !shouldSkipAnimation &&
      typeof container.animate === 'function' &&
      startHeight !== null &&
      containerRect.width > 0 &&
      startHeight > containerRect.height + 1 &&
      startHeight - containerRect.height < 420
    ) {
      try {
        const heightAnim = container.animate(
          [
            { height: `${startHeight}px`, overflow: 'hidden' },
            { height: `${containerRect.height}px`, overflow: 'hidden' }
          ],
          {
            duration: 190,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
          }
        );
        if (heightAnim) {
          containerHeightAnimRef.current = heightAnim;
          const clearHeightAnim = () => {
            if (containerHeightAnimRef.current === heightAnim) {
              containerHeightAnimRef.current = null;
            }
          };
          heightAnim.onfinish = clearHeightAnim;
          heightAnim.oncancel = clearHeightAnim;
        }
      } catch {
        // Ignore environments without full Web Animations API support
      }
    }

    if (containerRect.width > 0 || containerRect.height > 0) {
      prevContainerHeightRef.current = containerRect.height;
    }
    prevPositionsRef.current = nextPositions;
    prevSnapshotsRef.current = nextSnapshots;
  }, [containerRef, orderSignature, resetKey]);
}
