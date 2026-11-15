import type React from 'react';
import { useLayoutEffect, useRef } from 'react';

interface RelativePos {
  left: number;
  top: number;
}

/**
 * Hardware-accelerated FLIP (First, Last, Invert, Play) layout animation hook
 * for lists/grids whose children declare `data-flip-id="..."`.
 * Measures positions relative to the container so scroll offsets never trigger false shifts.
 */
export function useFlipAnimation(
  containerRef: React.RefObject<HTMLElement | null>,
  orderSignature: string,
  resetKey?: string
): void {
  const prevPositionsRef = useRef<Map<string, RelativePos>>(new Map());
  const prevResetKeyRef = useRef<string | undefined>(resetKey);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const elements = container.querySelectorAll<HTMLElement>('[data-flip-id]');
    const nextPositions = new Map<string, RelativePos>();

    const shouldSkipAnimation =
      prevResetKeyRef.current !== resetKey ||
      (typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    prevResetKeyRef.current = resetKey;

    elements.forEach((el) => {
      const id = el.dataset.flipId;
      if (!id) return;

      const rect = el.getBoundingClientRect();
      const relPos: RelativePos = {
        left: rect.left - containerRect.left,
        top: rect.top - containerRect.top
      };
      nextPositions.set(id, relPos);

      if (shouldSkipAnimation || typeof el.animate !== 'function') return;
      if (rect.width === 0 && rect.height === 0) return;

      const prevPos = prevPositionsRef.current.get(id);
      if (!prevPos) return;

      const dx = prevPos.left - relPos.left;
      const dy = prevPos.top - relPos.top;

      if ((Math.abs(dx) > 1 || Math.abs(dy) > 1) && Math.abs(dx) < 420 && Math.abs(dy) < 420) {
        try {
          el.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: 'translate(0, 0)' }
            ],
            {
              duration: 180,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            }
          );
        } catch {
          // Ignore environments without full Web Animations API support
        }
      }
    });

    prevPositionsRef.current = nextPositions;
  }, [containerRef, orderSignature, resetKey]);
}
