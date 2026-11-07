import { beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import { createMockChrome } from './mockChrome';

export const mockChrome = createMockChrome();

// Attach mockChrome globally
(globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

beforeEach(() => {
  mockChrome.__resetAll();
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ['', []]
  } as unknown as Response);
});
