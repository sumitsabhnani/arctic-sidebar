import { beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import { createMockChrome } from './mockChrome';
import { resetFaviconCacheForTests } from '../sidepanel/utils/faviconCache';
import { resetThemeBootstrapForTests } from '../sidepanel/utils/theme';

export const mockChrome = createMockChrome();

// Attach mockChrome globally
(globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

// Polyfill window.localStorage when Node 22+ experimental --localstorage-file stubs an incomplete object
if (typeof window !== 'undefined' && typeof window.localStorage?.getItem !== 'function') {
  const store = new Map<string, string>();
  const storagePolyfill: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    }
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: storagePolyfill
  });
}

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
  resetFaviconCacheForTests();
  resetThemeBootstrapForTests();
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ['', []]
  } as unknown as Response);
});
