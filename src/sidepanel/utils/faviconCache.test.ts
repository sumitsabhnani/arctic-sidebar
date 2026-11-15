import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  FAVICON_CACHE_STORAGE_KEY,
  FAVICON_PROBE_URL,
  MAX_CACHED_FAVICONS,
  captureVerifiedTabFavicon,
  fetchRealChromeFaviconDataUrl,
  getCachedFaviconEntry,
  getFaviconCacheKey,
  hydrateFaviconCache,
  isLoadableTabFaviconUrl,
  isSameSiteForFavicon,
  normalizeFaviconPageUrl,
  resetFaviconCacheForTests,
  upsertCachedFaviconEntries
} from './faviconCache';
import { mockChrome } from '../../test/setup';

function makePngResponse(bytes: number[]): Response {
  const buf = new Uint8Array(bytes).buffer;
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'image/png' : null)
    },
    arrayBuffer: () => Promise.resolve(buf)
  } as unknown as Response;
}

describe('faviconCache utilities', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('validates loadable tab favIconUrl schemes and rejects blocked internal browser schemes', () => {
    expect(isLoadableTabFaviconUrl('https://github.githubassets.com/favicons/favicon.svg')).toBe(
      true
    );
    expect(isLoadableTabFaviconUrl('http://localhost:3000/favicon.ico')).toBe(true);
    expect(isLoadableTabFaviconUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(
      isLoadableTabFaviconUrl(`chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=x`)
    ).toBe(true);

    // Blocked schemes emitted during slow/error/internal loads
    expect(isLoadableTabFaviconUrl('chrome://theme/IDR_ERROR_NETWORK_GENERIC')).toBe(false);
    expect(isLoadableTabFaviconUrl('chrome://favicon/size/16@2x/https://example.com')).toBe(false);
    expect(isLoadableTabFaviconUrl('chrome-error://chromewebdata/')).toBe(false);
    expect(isLoadableTabFaviconUrl('about:blank')).toBe(false);
    expect(isLoadableTabFaviconUrl('chrome-extension://other-extension-id/icon.png')).toBe(false);
    expect(isLoadableTabFaviconUrl('')).toBe(false);
    expect(isLoadableTabFaviconUrl(undefined)).toBe(false);
  });

  it('matches same-site redirects while rejecting drifted external domains and shared-hosting tenants', () => {
    expect(normalizeFaviconPageUrl('https://docs.new')).toBe('https://docs.google.com/document/');
    expect(
      isSameSiteForFavicon('https://docs.google.com/document/d/abc/edit', 'https://docs.new')
    ).toBe(true);
    expect(
      isSameSiteForFavicon('https://app.acme.com/dashboard', 'https://acme.com')
    ).toBe(true);
    expect(
      isSameSiteForFavicon('https://portal.nhs.co.uk/home', 'https://login.nhs.co.uk/')
    ).toBe(true);

    // Different tenants on shared hosting / multi-part TLDs must NOT share favicons
    expect(isSameSiteForFavicon('https://alice.vercel.app', 'https://bob.vercel.app')).toBe(false);
    expect(isSameSiteForFavicon('https://alice.github.io/app', 'https://bob.github.io/app')).toBe(
      false
    );
    expect(isSameSiteForFavicon('https://alpha.co.uk', 'https://beta.co.uk')).toBe(false);
    expect(isSameSiteForFavicon('https://youtube.com/watch?v=1', 'https://github.com/org/repo')).toBe(
      false
    );
  });

  it('filters out Chrome default grey wireframe globe bytes from /_favicon/ while accepting real site icons', async () => {
    const defaultGlobeBytes = [137, 80, 78, 71, 1, 1, 1, 1];
    const realSiteIconBytes = [137, 80, 78, 71, 99, 88, 77, 66];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(encodeURIComponent(FAVICON_PROBE_URL))) {
        return makePngResponse(defaultGlobeBytes);
      }
      if (url.includes(encodeURIComponent('https://missing-icon.example.com'))) {
        return makePngResponse(defaultGlobeBytes);
      }
      if (url.includes(encodeURIComponent('https://real-icon.example.com'))) {
        return makePngResponse(realSiteIconBytes);
      }
      return makePngResponse([]);
    });

    const filteredOut = await fetchRealChromeFaviconDataUrl(
      'https://missing-icon.example.com',
      48
    );
    expect(filteredOut).toBe('');

    const realDataUrl = await fetchRealChromeFaviconDataUrl('https://real-icon.example.com', 48);
    expect(realDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('captures verified favicons on redirect, retries delayed FaviconService commits, and avoids drifted tab pollution', async () => {
    vi.useFakeTimers();
    const defaultGlobeBytes = [10, 20, 30, 40];
    const realDashboardBytes = [90, 91, 92, 93];
    let faviconServiceCommitted = false;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(encodeURIComponent(FAVICON_PROBE_URL))) {
        return makePngResponse(defaultGlobeBytes);
      }
      if (
        faviconServiceCommitted &&
        url.includes(encodeURIComponent('https://app.company.com/home'))
      ) {
        return makePngResponse(realDashboardBytes);
      }
      return makePngResponse(defaultGlobeBytes);
    });

    const redirectedTab = {
      id: 77,
      url: 'https://app.company.com/home',
      favIconUrl: 'https://app.company.com/favicon.ico',
      status: 'complete'
    } as chrome.tabs.Tab;

    // Initial call happens before Chromium commits the PNG to Favicons DB -> does not overwrite cache yet and schedules 750ms retry
    const firstAttempt = await captureVerifiedTabFavicon(redirectedTab, 'https://company.com', {
      size: 48
    });
    expect(firstAttempt).toBe('');
    expect(getCachedFaviconEntry('https://company.com')).toBeUndefined();

    // Chromium commits the favicon 300ms later; 750ms retry captures and persists both dataUrl and iconUrl
    faviconServiceCommitted = true;
    await vi.advanceTimersByTimeAsync(800);

    const cachedBookmark = getCachedFaviconEntry('https://company.com');
    expect(cachedBookmark?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(cachedBookmark?.iconUrl).toBe('https://app.company.com/favicon.ico');
    expect(getCachedFaviconEntry('https://app.company.com/home')?.dataUrl).toBe(
      cachedBookmark?.dataUrl
    );

    // Verify cold start hydration from chrome.storage.local
    resetFaviconCacheForTests();
    expect(getCachedFaviconEntry('https://company.com')).toBeUndefined();
    await hydrateFaviconCache();
    expect(getCachedFaviconEntry('https://company.com')?.dataUrl).toMatch(
      /^data:image\/png;base64,/
    );

    // Navigated-away external tab must NOT overwrite company.com's cached icon
    const driftedTab = {
      id: 77,
      url: 'https://youtube.com/watch?v=xyz',
      favIconUrl: 'https://youtube.com/s/desktop/favicon.ico',
      status: 'complete'
    } as chrome.tabs.Tab;
    await captureVerifiedTabFavicon(driftedTab, 'https://company.com', {
      size: 48,
      allowDelayedRetry: false
    });
    expect(getCachedFaviconEntry('https://company.com')?.iconUrl).toBe(
      'https://app.company.com/favicon.ico'
    );
  });

  it('enforces bounded LRU eviction at MAX_CACHED_FAVICONS in chrome.storage.local', async () => {
    const bulk: Record<string, { iconUrl: string; pageUrl: string; updatedAt: number }> = {};
    for (let i = 0; i < MAX_CACHED_FAVICONS + 15; i++) {
      const url = `https://site-${i}.example.com`;
      bulk[getFaviconCacheKey(url)] = {
        iconUrl: `${url}/favicon.ico`,
        pageUrl: url,
        updatedAt: 1000 + i
      };
    }

    await upsertCachedFaviconEntries(bulk);
    await new Promise((r) => setTimeout(r, 10));

    const stored = mockChrome.__getLocalStorage()[FAVICON_CACHE_STORAGE_KEY] as Record<
      string,
      unknown
    >;
    const keys = Object.keys(stored);
    expect(keys.length).toBe(MAX_CACHED_FAVICONS);
    // Oldest 15 (0..14) evicted; newest kept
    expect(stored[getFaviconCacheKey('https://site-0.example.com')]).toBeUndefined();
    expect(stored[getFaviconCacheKey('https://site-14.example.com')]).toBeUndefined();
    expect(stored[getFaviconCacheKey('https://site-15.example.com')]).toBeDefined();
    expect(
      stored[getFaviconCacheKey(`https://site-${MAX_CACHED_FAVICONS + 14}.example.com`)]
    ).toBeDefined();
  });
});
