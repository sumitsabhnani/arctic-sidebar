import type React from 'react';
import { useEffect, useLayoutEffect, useRef } from 'react';

interface RelativePos {
  left: number;
  top: number;
}

/**
 * Hardware-accelerated FLIP (First, Last, Invert, Play) layout animation hook
 * for lists/grids whose children declare `data-flip-id="..."`.
 * Measures positions relative to the container so scroll offsets never trigger false shifts.
 * Cancels active FLIP animations before measuring resting layout coordinates so rapid
 * back-to-back updates never corrupt stored positions or accumulate transform drift.
 */
export function useFlipAnimation(
  containerRef: React.RefObject<HTMLElement | null>,
  orderSignature: string,
  resetKey?: string
): void {
  const prevPositionsRef = useRef<Map<string, RelativePos>>(new Map());
  const prevResetKeyRef = useRef<string | undefined>(resetKey);
  const prevContainerWidthRef = useRef<number | null>(null);
  const activeAnimationsRef = useRef<Map<HTMLElement, Animation>>(new Map());

  useEffect(() => {
    const activeAnimations = activeAnimationsRef.current;
    return () => {
      activeAnimations.forEach((anim) => {
        try {
          anim.cancel();
        } catch {
          // Ignore environments without full Web Animations API support
        }
      });
      activeAnimations.clear();
    };
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const activeAnimations = activeAnimationsRef.current;

    if (!container) {
      activeAnimations.forEach((anim) => {
        try {
          anim.cancel();
        } catch {
          // Ignore
        }
      });
      activeAnimations.clear();
      prevPositionsRef.current = new Map();
      prevContainerWidthRef.current = null;
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

    const scrollLeft = container.scrollLeft || 0;
    const scrollTop = container.scrollTop || 0;

    // 1. Batch-read visual rects of elements that currently have an active FLIP animation
    //    so we can extract their in-flight transform offset before cancelling.
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

    // 2. Batch-cancel all active FLIP animations so layout reads capture true resting positions.
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

    // 3. Batch-read true, untransformed resting layout positions relative to container content box.
    const containerRect = container.getBoundingClientRect();
    const hasContainerResized =
      prevContainerWidthRef.current !== null &&
      Math.abs(containerRect.width - prevContainerWidthRef.current) > 0.5;
    prevContainerWidthRef.current = containerRect.width;

    const shouldSkipAnimation = isResetOrReducedMotion || hasContainerResized;
    const nextPositions = new Map<string, RelativePos>();
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

    // 4. Batch-start new FLIP animations.
    pendingAnimations.forEach(({ el, dx, dy }) => {
      try {
        const anim = el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: 'translate(0, 0)' }
          ],
          {
            duration: 180,
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

    prevPositionsRef.current = nextPositions;
  }, [containerRef, orderSignature, resetKey]);
}
