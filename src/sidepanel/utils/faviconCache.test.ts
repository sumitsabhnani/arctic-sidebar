import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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
  recordVerifiedImgFavicon,
  resetFaviconCacheForTests,
  upsertCachedFaviconEntries,
  useResolvedFavicon
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

  it('notifies only key-scoped useResolvedFavicon subscribers without re-rendering unrelated rows', async () => {
    await hydrateFaviconCache();

    let alphaRenders = 0;
    let bravoRenders = 0;

    const alphaHook = renderHook(() => {
      alphaRenders += 1;
      return useResolvedFavicon({ pageUrl: 'https://alpha.example.com' });
    });

    const bravoHook = renderHook(() => {
      bravoRenders += 1;
      return useResolvedFavicon({ pageUrl: 'https://bravo.example.com' });
    });

    const initialAlphaRenders = alphaRenders;
    const initialBravoRenders = bravoRenders;

    const alphaDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    await act(async () => {
      await upsertCachedFaviconEntries({
        [getFaviconCacheKey('https://alpha.example.com')]: {
          dataUrl: alphaDataUrl,
          iconUrl: 'https://alpha.example.com/favicon.png',
          pageUrl: 'https://alpha.example.com',
          updatedAt: Date.now()
        }
      });
    });

    expect(alphaHook.result.current.faviconSrc).toBe(alphaDataUrl);
    expect(alphaRenders).toBeGreaterThan(initialAlphaRenders);
    // Unrelated row must NOT re-render when alpha's favicon updates
    expect(bravoRenders).toBe(initialBravoRenders);

    alphaHook.unmount();
    bravoHook.unmount();
  });

  it('coalesces synchronous upsert bursts into a single storage.local write and skips no-op rewrites', async () => {
    await hydrateFaviconCache();
    const setSpy = vi.spyOn(chrome.storage.local, 'set');
    setSpy.mockClear();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(encodeURIComponent(FAVICON_PROBE_URL))) {
        return makePngResponse([1, 2, 3, 4]);
      }
      return makePngResponse([9, 8, 7, 6]);
    });
    globalThis.fetch = fetchSpy;

    // 1. Fire 20 concurrent upserts in the same synchronous turn -> coalesced into 1 storage write
    await Promise.all(
      Array.from({ length: 20 }, (_, idx) => {
        const url = `https://burst-${idx}.example.com`;
        return upsertCachedFaviconEntries({
          [getFaviconCacheKey(url)]: {
            dataUrl: 'data:image/png;base64,AAAA',
            iconUrl: `${url}/favicon.ico`,
            pageUrl: url,
            updatedAt: 5000 + idx
          }
        });
      })
    );

    expect(setSpy).toHaveBeenCalledTimes(1);

    // 2. Repeatedly firing onLoad / tab capture for an already-verified entry performs 0 storage writes & 0 fetches
    setSpy.mockClear();
    fetchSpy.mockClear();

    const cachedUrl = 'https://burst-0.example.com';
    for (let i = 0; i < 15; i++) {
      await recordVerifiedImgFavicon({
        faviconSrc: `${cachedUrl}/favicon.ico`,
        pageUrl: cachedUrl
      });
      const res = await captureVerifiedTabFavicon(
        { url: cachedUrl, favIconUrl: `${cachedUrl}/favicon.ico` },
        cachedUrl
      );
      expect(res).toBe('data:image/png;base64,AAAA');
    }

    expect(setSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent fetchRealChromeFaviconDataUrl calls for the same URL and size', async () => {
    let targetFetches = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      await new Promise((r) => setTimeout(r, 15));
      if (url.includes(encodeURIComponent(FAVICON_PROBE_URL))) {
        return makePngResponse([1, 1, 1]);
      }
      targetFetches += 1;
      return makePngResponse([2, 2, 2]);
    });

    const results = await Promise.all([
      fetchRealChromeFaviconDataUrl('https://concurrent.example.com', 32),
      fetchRealChromeFaviconDataUrl('https://concurrent.example.com', 32),
      fetchRealChromeFaviconDataUrl('https://www.concurrent.example.com', 32)
    ]);

    expect(targetFetches).toBe(1);
    expect(results[0]).toMatch(/^data:image\/png;base64,/);
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
  });
});
