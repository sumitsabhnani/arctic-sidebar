import { useRef } from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFlipAnimation } from './useFlipAnimation';

interface MockAnimRecord {
  el: HTMLElement;
  dx: number;
  dy: number;
  playState: AnimationPlayState;
  cancel: ReturnType<typeof vi.fn>;
  onfinish: ((this: Animation, ev: AnimationPlaybackEvent) => unknown) | null;
  oncancel: ((this: Animation, ev: AnimationPlaybackEvent) => unknown) | null;
}

const ROW_HEIGHT = 36;

/**
 * Harness that simulates real Chromium FLIP physics:
 * - Each row's resting top is `index * ROW_HEIGHT`.
 * - While a row has an active (uncancelled, unfinished) WAAPI animation starting at `translate(dx, dy)`,
 *   `getBoundingClientRect()` returns `restingTop + activeOffsetY` (matching how browsers include
 *   active CSS transforms in `getBoundingClientRect()`).
 */
function setupMockFlipDom(container: HTMLElement) {
  const animRecords: MockAnimRecord[] = [];
  const activeTransformY = new WeakMap<HTMLElement, number>();
  const activeAnimByEl = new WeakMap<HTMLElement, MockAnimRecord>();

  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        left: 0,
        top: 100,
        right: 300,
        bottom: 500,
        width: 300,
        height: 400,
        x: 0,
        y: 100,
        toJSON: () => ({})
      }) as DOMRect
  );

  const attachRowMocks = () => {
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-flip-id]'));
    rows.forEach((row) => {
      if ((row as unknown as { __flipMocked?: boolean }).__flipMocked) return;
      (row as unknown as { __flipMocked?: boolean }).__flipMocked = true;

      vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => {
        const siblings = Array.from(container.querySelectorAll<HTMLElement>('[data-flip-id]'));
        const idx = siblings.indexOf(row);
        const restingTop = 100 + Math.max(0, idx) * ROW_HEIGHT;
        const offsetY = activeTransformY.get(row) ?? 0;
        return {
          left: 0,
          top: restingTop + offsetY,
          right: 300,
          bottom: restingTop + offsetY + ROW_HEIGHT,
          width: 300,
          height: ROW_HEIGHT,
          x: 0,
          y: restingTop + offsetY,
          toJSON: () => ({})
        } as DOMRect;
      });

      row.animate = vi.fn((keyframes: Keyframe[] | PropertyIndexedKeyframes | null) => {
        const first = Array.isArray(keyframes) ? keyframes[0] : null;
        const transformStr = typeof first?.transform === 'string' ? first.transform : '';
        const match = transformStr.match(/translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/);
        const dx = match ? Number(match[1]) : 0;
        const dy = match ? Number(match[2]) : 0;

        activeTransformY.set(row, dy);

        const rec: MockAnimRecord = {
          el: row,
          dx,
          dy,
          playState: 'running',
          onfinish: null,
          oncancel: null,
          cancel: vi.fn()
        };

        rec.cancel.mockImplementation(() => {
          rec.playState = 'idle';
          if (activeAnimByEl.get(row) === rec) {
            activeTransformY.delete(row);
            activeAnimByEl.delete(row);
          }
          rec.oncancel?.call(rec as unknown as Animation, {} as AnimationPlaybackEvent);
        });

        activeAnimByEl.set(row, rec);
        animRecords.push(rec);
        return rec as unknown as Animation;
      });
    });
  };

  const finishAllAnimations = () => {
    animRecords.forEach((rec) => {
      if (rec.playState === 'running') {
        rec.playState = 'finished';
        if (activeAnimByEl.get(rec.el) === rec) {
          activeTransformY.delete(rec.el);
          activeAnimByEl.delete(rec.el);
        }
        rec.onfinish?.call(rec as unknown as Animation, {} as AnimationPlaybackEvent);
      }
    });
  };

  const setAnimationProgress = (fraction: number) => {
    animRecords.forEach((rec) => {
      if (rec.playState === 'running' && activeAnimByEl.get(rec.el) === rec) {
        activeTransformY.set(rec.el, rec.dy * (1 - fraction));
      }
    });
  };

  return { animRecords, attachRowMocks, finishAllAnimations, setAnimationProgress };
}

function FlipListHarness({ items, resetKey }: { items: string[]; resetKey?: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const signature = items.join(',');
  useFlipAnimation(listRef, signature, resetKey);

  return (
    <div ref={listRef} data-testid="flip-list">
      {items.map((id) => (
        <div key={id} data-flip-id={id} data-testid={`row-${id}`}>
          {id}
        </div>
      ))}
    </div>
  );
}

describe('useFlipAnimation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('cancels active animations and avoids overshoot or drift across rapid A -> B -> A updates', () => {
    const { rerender, getByTestId } = render(
      <FlipListHarness items={['H', 'K', 'T', 'A']} resetKey="home" />
    );
    const container = getByTestId('flip-list');
    const mock = setupMockFlipDom(container);
    mock.attachRowMocks();

    // Re-baseline via resetKey so initial resting positions are captured from our mocked rects
    rerender(<FlipListHarness items={['H', 'K', 'T', 'A']} resetKey="home:init" />);
    mock.attachRowMocks();
    expect(mock.animRecords).toHaveLength(0);

    // 1. Rapid insert of a transient row X at index 0 (shifts H, K, T, A down by +36px -> dy = -36px)
    rerender(<FlipListHarness items={['X', 'H', 'K', 'T', 'A']} resetKey="home:init" />);
    mock.attachRowMocks();

    const firstPassH = mock.animRecords.filter((r) => r.el.dataset.flipId === 'H');
    expect(firstPassH).toHaveLength(1);
    expect(firstPassH[0].dy).toBe(-ROW_HEIGHT);

    // 2. Immediately remove X (at t=0 while -36px transform is still active) -> back to [H, K, T, A]
    const prevCount = mock.animRecords.length;
    rerender(<FlipListHarness items={['H', 'K', 'T', 'A']} resetKey="home:init" />);

    // Previous in-flight animations must have been cancelled
    expect(firstPassH[0].cancel).toHaveBeenCalledTimes(1);

    // Because H was visually still at 0 and its resting layout returned to 0, no overshoot (+72px) animation should run
    const secondPassAnims = mock.animRecords.slice(prevCount);
    expect(secondPassAnims).toHaveLength(0);

    // 3. Subsequent normal update after animations settle must NOT suffer accumulated drift
    mock.finishAllAnimations();
    const beforeThirdPass = mock.animRecords.length;
    rerender(<FlipListHarness items={['K', 'H', 'T', 'A']} resetKey="home:init" />);

    const thirdPassAnims = mock.animRecords.slice(beforeThirdPass);
    const hMove = thirdPassAnims.find((r) => r.el.dataset.flipId === 'H');
    const kMove = thirdPassAnims.find((r) => r.el.dataset.flipId === 'K');
    const tMove = thirdPassAnims.find((r) => r.el.dataset.flipId === 'T');
    expect(hMove?.dy).toBe(-ROW_HEIGHT);
    expect(kMove?.dy).toBe(ROW_HEIGHT);
    expect(tMove).toBeUndefined();
  });

  it('continues smoothly from mid-flight visual position when interrupted halfway', () => {
    const { rerender, getByTestId } = render(
      <FlipListHarness items={['H', 'K']} resetKey="s1" />
    );
    const container = getByTestId('flip-list');
    const mock = setupMockFlipDom(container);
    mock.attachRowMocks();

    rerender(<FlipListHarness items={['H', 'K']} resetKey="s2" />);
    mock.attachRowMocks();

    // Move H down 1 row (0 -> 36): starts animate(-36 -> 0)
    rerender(<FlipListHarness items={['X', 'H', 'K']} resetKey="s2" />);
    mock.attachRowMocks();

    // Advance animation 50% (H is visually at 18px, transform offset is -18px)
    mock.setAnimationProgress(0.5);

    // Move H down another row (36 -> 72) while still mid-flight
    const beforeInterrupt = mock.animRecords.length;
    rerender(<FlipListHarness items={['Y', 'X', 'H', 'K']} resetKey="s2" />);
    mock.attachRowMocks();

    const interruptH = mock.animRecords
      .slice(beforeInterrupt)
      .find((r) => r.el.dataset.flipId === 'H');
    // H was visually at 18px and now rests at 72px -> delta must be 18 - 72 = -54px
    expect(interruptH?.dy).toBe(-54);
  });

  it('cancels active animations and skips animating when resetKey changes', () => {
    const { rerender, getByTestId } = render(
      <FlipListHarness items={['H', 'K']} resetKey="home:compact:0" />
    );
    const container = getByTestId('flip-list');
    const mock = setupMockFlipDom(container);
    mock.attachRowMocks();

    rerender(<FlipListHarness items={['H', 'K']} resetKey="home:compact:ready" />);
    mock.attachRowMocks();

    // Trigger an animation
    rerender(<FlipListHarness items={['K', 'H']} resetKey="home:compact:ready" />);
    const runningCount = mock.animRecords.length;
    expect(runningCount).toBe(2);

    // Switch space / density via resetKey while animations are running
    rerender(<FlipListHarness items={['H', 'K']} resetKey="work:relaxed:0" />);

    expect(mock.animRecords[0].cancel).toHaveBeenCalledTimes(1);
    expect(mock.animRecords[1].cancel).toHaveBeenCalledTimes(1);
    expect(mock.animRecords).toHaveLength(runningCount);
  });
});
