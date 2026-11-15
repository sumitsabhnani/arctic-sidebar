import { beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import { createMockChrome } from './mockChrome';

export const mockChrome = createMockChrome();

// Attach mockChrome globally
(globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

// Polyfill DragEvent in JSDOM so MouseEvent coordinates (clientX/clientY) and dataTransfer work as in Chromium
if (typeof window !== 'undefined' && typeof window.DragEvent === 'undefined') {
  class JSDOMDragEvent extends MouseEvent {
    dataTransfer: DataTransfer | null;
    constructor(type: string, eventInitDict?: DragEventInit) {
      super(type, eventInitDict);
      this.dataTransfer = eventInitDict?.dataTransfer ?? null;
    }
  }
  (window as unknown as { DragEvent: unknown }).DragEvent = JSDOMDragEvent;
  (globalThis as unknown as { DragEvent: unknown }).DragEvent = JSDOMDragEvent;
}

beforeEach(() => {
  mockChrome.__resetAll();
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ['', []]
  } as unknown as Response);
});
