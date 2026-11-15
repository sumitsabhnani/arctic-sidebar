import { useState, useEffect, useCallback, useMemo } from 'react';
import type React from 'react';
import type { CachedFaviconEntry, TabWithFaviconMeta } from '../../types';
import {
  doesTabUrlMatchBookmark,
  getCanonicalUrlKey,
  getEffectiveTabUrl,
  getFaviconUrl
} from './url';

export const FAVICON_CACHE_STORAGE_KEY = 'cachedFaviconsByKey';
export const MAX_CACHED_FAVICONS = 250;
export const MAX_FAVICON_DATA_URL_LENGTH = 65536;
export const FAVICON_PROBE_URL = 'https://arctic-favicon-probe.invalid/';

const MULTI_PART_PUBLIC_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'co.in',
  'com.br',
  'com.sg',
  'co.nz',
  'co.za',
  'com.mx',
  'co.kr',
  'com.tw',
  'com.hk'
]);

const SHARED_HOSTING_SUFFIXES = new Set([
  'github.io',
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'web.app',
  'firebaseapp.com',
  'appspot.com',
  'herokuapp.com',
  'onrender.com',
  'workers.dev',
  'cloudfront.net',
  'azurewebsites.net'
]);

const memoryCache = new Map<string, CachedFaviconEntry>();
const subscribers = new Set<() => void>();
const defaultGlobeBySize = new Map<number, string>();
const inFlightDefaultProbeBySize = new Map<number, Promise<string>>();
const pendingDelayedRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

let hasHydratedFromStorage = false;
let hydrationPromise: Promise<Record<string, CachedFaviconEntry>> | null = null;
let storageWriteLock: Promise<void> = Promise.resolve();
let attachedStorageOnChangedRef: typeof chrome.storage.onChanged | null = null;

function notifySubscribers(): void {
  for (const listener of subscribers) {
    try {
      listener();
    } catch {
      // ignore subscriber errors
    }
  }
}

/**
 * Maps `.new` shortcut URLs to their canonical origins so favicon resolution
 * and caching match the actual web application.
 */
export function normalizeFaviconPageUrl(pageUrl: string): string {
  if (!pageUrl) return '';
  const trimmed = pageUrl.trim();
  if (!trimmed) return '';
  try {
    const host = new URL(trimmed).hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'docs.new' || host === 'document.new') {
      return 'https://docs.google.com/document/';
    }
    if (host === 'sheets.new' || host === 'spreadsheet.new') {
      return 'https://docs.google.com/spreadsheets/';
    }
    if (host === 'slides.new' || host === 'presentation.new') {
      return 'https://docs.google.com/presentation/';
    }
    if (host === 'notion.new') {
      return 'https://www.notion.so/';
    }
    if (host === 'gist.new') {
      return 'https://gist.github.com/';
    }
  } catch {
    // keep raw trimmed URL
  }
  return trimmed;
}

export function getFaviconCacheKey(pageUrl?: string): string {
  if (!pageUrl) return '';
  const normalized = normalizeFaviconPageUrl(pageUrl);
  if (!normalized) return '';
  return getCanonicalUrlKey(normalized);
}

/**
 * Returns true when `favIconUrl` uses a scheme that an extension page (`chrome-extension://`)
 * is permitted to load inside an `<img>` element without triggering a security block.
 */
export function isLoadableTabFaviconUrl(favIconUrl?: string): boolean {
  if (!favIconUrl) return false;
  const trimmed = favIconUrl.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('https://') || lower.startsWith('http://')) {
    return true;
  }
  if (lower.startsWith('data:image/')) {
    return trimmed.length <= MAX_FAVICON_DATA_URL_LENGTH;
  }
  if (lower.startsWith('chrome-extension://')) {
    const ownId = typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined;
    if (ownId) {
      return lower.startsWith(`chrome-extension://${ownId.toLowerCase()}/`);
    }
    return true;
  }
  return false;
}

export function isChromeInternalFaviconEndpointUrl(url?: string): boolean {
  if (!url) return false;
  const lower = url.trim().toLowerCase();
  return lower.startsWith('chrome-extension://') && lower.includes('/_favicon/');
}

function getRegistrableDomain(rawHostname: string): string {
  const host = rawHostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!host) return '';
  if (
    host === 'localhost' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.includes(':')
  ) {
    return host;
  }

  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return host;

  const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (SHARED_HOSTING_SUFFIXES.has(lastTwo) || MULTI_PART_PUBLIC_SUFFIXES.has(lastTwo)) {
    return parts.length >= 3 ? parts.slice(-3).join('.') : host;
  }

  return lastTwo;
}

/**
 * Checks whether a tab's current URL belongs to the same site/application as a bookmark's URL,
 * allowing automatic entry redirects (`company.com` -> `app.company.com/home`, `gmail.com` -> `mail.google.com`)
 * while preventing drifted external navigations (`github.com` -> `youtube.com`) from polluting the bookmark's cached icon.
 */
export function isSameSiteForFavicon(tabUrl?: string, bookmarkUrl?: string): boolean {
  if (!tabUrl || !bookmarkUrl) return false;
  const normTab = normalizeFaviconPageUrl(tabUrl);
  const normBm = normalizeFaviconPageUrl(bookmarkUrl);
  if (!normTab || !normBm) return false;

  if (doesTabUrlMatchBookmark(normTab, normBm)) {
    return true;
  }

  try {
    const parsedTab = new URL(normTab);
    const parsedBm = new URL(normBm);
    const isTabWeb = parsedTab.protocol === 'http:' || parsedTab.protocol === 'https:';
    const isBmWeb = parsedBm.protocol === 'http:' || parsedBm.protocol === 'https:';
    if (!isTabWeb || !isBmWeb) {
      return parsedTab.origin === parsedBm.origin;
    }

    const hostTab = parsedTab.hostname.toLowerCase().replace(/^www\./, '');
    const hostBm = parsedBm.hostname.toLowerCase().replace(/^www\./, '');
    if (hostTab === hostBm) {
      return true;
    }

    const regTab = getRegistrableDomain(hostTab);
    const regBm = getRegistrableDomain(hostBm);
    return Boolean(regTab && regTab === regBm);
  } catch {
    return false;
  }
}

function arrayBufferToDataUrl(buf: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function fetchChromeFaviconRawDataUrl(pageUrl: string, size: number): Promise<string> {
  if (!pageUrl || typeof fetch !== 'function' || typeof chrome === 'undefined' || !chrome.runtime?.id) {
    return '';
  }
  const resolvedUrl = normalizeFaviconPageUrl(pageUrl);
  if (!resolvedUrl) return '';

  try {
    const endpoint = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(
      resolvedUrl
    )}&size=${size}`;
    const resp = await fetch(endpoint, { cache: 'no-store' });
    if (!resp || !resp.ok || typeof resp.arrayBuffer !== 'function') {
      return '';
    }
    const buf = await resp.arrayBuffer();
    if (!buf || buf.byteLength === 0) {
      return '';
    }
    const mime = resp.headers?.get?.('content-type') || 'image/png';
    const dataUrl = arrayBufferToDataUrl(buf, mime);
    if (dataUrl.length > MAX_FAVICON_DATA_URL_LENGTH) {
      return '';
    }
    return dataUrl;
  } catch {
    return '';
  }
}

async function getDefaultChromeGlobeDataUrl(size: number): Promise<string> {
  const cached = defaultGlobeBySize.get(size);
  if (cached) return cached;

  const existingPromise = inFlightDefaultProbeBySize.get(size);
  if (existingPromise) return existingPromise;

  const probePromise = fetchChromeFaviconRawDataUrl(FAVICON_PROBE_URL, size)
    .then((dataUrl) => {
      if (dataUrl) {
        defaultGlobeBySize.set(size, dataUrl);
      }
      return dataUrl;
    })
    .finally(() => {
      inFlightDefaultProbeBySize.delete(size);
    });

  inFlightDefaultProbeBySize.set(size, probePromise);
  return probePromise;
}

/**
 * Fetches a site's favicon from Chrome's internal `/_favicon/` service as a `data:` URL,
 * automatically filtering out Chrome's built-in missing-icon grey wireframe globe.
 */
export async function fetchRealChromeFaviconDataUrl(
  pageUrl: string,
  size: number = 48
): Promise<string> {
  if (!pageUrl) return '';
  const [targetDataUrl, defaultGlobeDataUrl] = await Promise.all([
    fetchChromeFaviconRawDataUrl(pageUrl, size),
    getDefaultChromeGlobeDataUrl(size)
  ]);

  if (!targetDataUrl) return '';
  if (defaultGlobeDataUrl && targetDataUrl === defaultGlobeDataUrl) {
    return '';
  }
  return targetDataUrl;
}

const handleStorageChanged = (
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string
) => {
  if (areaName !== 'local' || !changes[FAVICON_CACHE_STORAGE_KEY]) return;
  const incoming =
    (changes[FAVICON_CACHE_STORAGE_KEY].newValue as Record<string, CachedFaviconEntry> | undefined) ||
    {};
  let mutated = false;
  for (const [key, entry] of Object.entries(incoming)) {
    if (!key || !entry) continue;
    const prev = memoryCache.get(key);
    if (
      !prev ||
      entry.updatedAt > prev.updatedAt ||
      (entry.dataUrl && entry.dataUrl !== prev.dataUrl) ||
      (entry.iconUrl && entry.iconUrl !== prev.iconUrl)
    ) {
      memoryCache.set(key, entry);
      mutated = true;
    }
  }
  if (mutated) {
    notifySubscribers();
  }
};

function ensureStorageListener(): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged?.addListener) return;
  if (attachedStorageOnChangedRef === chrome.storage.onChanged) return;
  attachedStorageOnChangedRef = chrome.storage.onChanged;
  chrome.storage.onChanged.addListener(handleStorageChanged);
}

export async function hydrateFaviconCache(): Promise<Record<string, CachedFaviconEntry>> {
  ensureStorageListener();
  if (hasHydratedFromStorage) {
    return Object.fromEntries(memoryCache.entries());
  }
  if (hydrationPromise) {
    return hydrationPromise;
  }

  hydrationPromise = (async () => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
        const res = await chrome.storage.local.get([FAVICON_CACHE_STORAGE_KEY]);
        const stored =
          (res?.[FAVICON_CACHE_STORAGE_KEY] as Record<string, CachedFaviconEntry> | undefined) || {};
        let changed = false;
        for (const [key, entry] of Object.entries(stored)) {
          if (!key || !entry) continue;
          const existing = memoryCache.get(key);
          if (!existing || (entry.updatedAt || 0) >= (existing.updatedAt || 0)) {
            memoryCache.set(key, entry);
            changed = true;
          }
        }
        hasHydratedFromStorage = true;
        if (changed) {
          notifySubscribers();
        }
      } else {
        hasHydratedFromStorage = true;
      }
    } catch {
      hasHydratedFromStorage = true;
    } finally {
      hydrationPromise = null;
    }
    return Object.fromEntries(memoryCache.entries());
  })();

  return hydrationPromise;
}

export function getCachedFaviconEntry(pageUrl?: string): CachedFaviconEntry | undefined {
  const key = getFaviconCacheKey(pageUrl);
  if (!key) return undefined;
  return memoryCache.get(key);
}

export async function upsertCachedFaviconEntries(
  updatesByKey: Record<string, Partial<CachedFaviconEntry>>
): Promise<void> {
  const updateKeys = Object.keys(updatesByKey).filter(Boolean);
  if (updateKeys.length === 0) return;

  ensureStorageListener();

  // Optimistically merge into memoryCache so mounted UI components reflect it immediately
  const now = Date.now();
  let memoryChanged = false;

  for (const key of updateKeys) {
    const patch = updatesByKey[key];
    if (!patch) continue;
    const prev = memoryCache.get(key);
    const nextDataUrl = patch.dataUrl || prev?.dataUrl;
    const nextIconUrl = patch.iconUrl || prev?.iconUrl;
    const nextPageUrl = patch.pageUrl || prev?.pageUrl;
    if (!nextDataUrl && !nextIconUrl) continue;

    if (
      !prev ||
      prev.dataUrl !== nextDataUrl ||
      prev.iconUrl !== nextIconUrl ||
      prev.pageUrl !== nextPageUrl
    ) {
      memoryCache.set(key, {
        ...(nextDataUrl ? { dataUrl: nextDataUrl } : {}),
        ...(nextIconUrl ? { iconUrl: nextIconUrl } : {}),
        ...(nextPageUrl ? { pageUrl: nextPageUrl } : {}),
        updatedAt: patch.updatedAt ?? now
      });
      memoryChanged = true;
    }
  }

  if (memoryChanged) {
    notifySubscribers();
  }

  if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) {
    return;
  }

  storageWriteLock = storageWriteLock.then(async () => {
    try {
      const existingData = chrome.storage?.local?.get
        ? await chrome.storage.local.get([FAVICON_CACHE_STORAGE_KEY])
        : {};
      const stored =
        (existingData?.[FAVICON_CACHE_STORAGE_KEY] as Record<string, CachedFaviconEntry> | undefined) ||
        {};

      const merged: Record<string, CachedFaviconEntry> = { ...stored };
      for (const [k, memEntry] of memoryCache.entries()) {
        const prev = merged[k];
        if (!prev || memEntry.updatedAt >= (prev.updatedAt || 0)) {
          merged[k] = {
            ...(memEntry.dataUrl || prev?.dataUrl
              ? { dataUrl: memEntry.dataUrl || prev?.dataUrl }
              : {}),
            ...(memEntry.iconUrl || prev?.iconUrl
              ? { iconUrl: memEntry.iconUrl || prev?.iconUrl }
              : {}),
            ...(memEntry.pageUrl || prev?.pageUrl
              ? { pageUrl: memEntry.pageUrl || prev?.pageUrl }
              : {}),
            updatedAt: Math.max(memEntry.updatedAt || 0, prev?.updatedAt || 0)
          };
        }
      }

      // Enforce bounded LRU capacity
      const allEntries = Object.entries(merged);
      let finalRecord = merged;
      if (allEntries.length > MAX_CACHED_FAVICONS) {
        allEntries.sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
        finalRecord = Object.fromEntries(allEntries.slice(0, MAX_CACHED_FAVICONS));
        memoryCache.clear();
        for (const [k, v] of Object.entries(finalRecord)) {
          memoryCache.set(k, v);
        }
      }

      await chrome.storage.local.set({ [FAVICON_CACHE_STORAGE_KEY]: finalRecord });
    } catch {
      // ignore storage quota or transient errors
    }
  });

  await storageWriteLock;
}

function collectTargetKeys(tabEffectiveUrl?: string, bookmarkUrl?: string): string[] {
  const keys = new Set<string>();
  const tabKey = getFaviconCacheKey(tabEffectiveUrl);
  if (tabKey) keys.add(tabKey);

  if (bookmarkUrl) {
    if (!tabEffectiveUrl || isSameSiteForFavicon(tabEffectiveUrl, bookmarkUrl)) {
      const bmKey = getFaviconCacheKey(bookmarkUrl);
      if (bmKey) keys.add(bmKey);
    }
  }
  return Array.from(keys);
}

/**
 * Captures and persists a verified favicon from a live tab (either an inline `data:image/` URL
 * or a real non-globe bitmap extracted from Chrome's `/_favicon/` cache).
 * Never overwrites a known-good icon with a broken URL or Chrome's default grey globe.
 */
export async function captureVerifiedTabFavicon(
  tab?: Pick<chrome.tabs.Tab, 'url' | 'pendingUrl' | 'favIconUrl'> | null,
  bookmarkUrl?: string,
  options?: { size?: number; allowDelayedRetry?: boolean }
): Promise<string> {
  if (!tab) return '';
  const rawFavIconUrl = (tab.favIconUrl || '').trim();
  if (!isLoadableTabFaviconUrl(rawFavIconUrl) || isChromeInternalFaviconEndpointUrl(rawFavIconUrl)) {
    return '';
  }

  const size = options?.size ?? 48;
  const tabEffectiveUrl = getEffectiveTabUrl(tab);
  const targetKeys = collectTargetKeys(tabEffectiveUrl, bookmarkUrl);
  if (targetKeys.length === 0) return '';

  const effectivePageUrl = tabEffectiveUrl || bookmarkUrl || '';

  if (rawFavIconUrl.toLowerCase().startsWith('data:image/')) {
    const now = Date.now();
    const updates: Record<string, Partial<CachedFaviconEntry>> = {};
    for (const k of targetKeys) {
      updates[k] = {
        dataUrl: rawFavIconUrl,
        iconUrl: rawFavIconUrl,
        pageUrl: effectivePageUrl,
        updatedAt: now
      };
    }
    await upsertCachedFaviconEntries(updates);
    return rawFavIconUrl;
  }

  let dataUrl = '';
  if (tabEffectiveUrl) {
    dataUrl = await fetchRealChromeFaviconDataUrl(tabEffectiveUrl, size);
  }
  if (!dataUrl && bookmarkUrl && (!tabEffectiveUrl || isSameSiteForFavicon(tabEffectiveUrl, bookmarkUrl))) {
    dataUrl = await fetchRealChromeFaviconDataUrl(bookmarkUrl, size);
  }

  if (dataUrl) {
    const now = Date.now();
    const updates: Record<string, Partial<CachedFaviconEntry>> = {};
    for (const k of targetKeys) {
      updates[k] = {
        dataUrl,
        iconUrl: rawFavIconUrl,
        pageUrl: effectivePageUrl,
        updatedAt: now
      };
    }
    await upsertCachedFaviconEntries(updates);
    return dataUrl;
  }

  // Chromium commits downloaded tab favicons to FaviconService slightly asynchronously after `favIconUrl` fires
  if (options?.allowDelayedRetry !== false) {
    const retryId = targetKeys[0];
    if (retryId && !pendingDelayedRetryTimers.has(retryId)) {
      const timer = setTimeout(() => {
        pendingDelayedRetryTimers.delete(retryId);
        void captureVerifiedTabFavicon(tab, bookmarkUrl, {
          size,
          allowDelayedRetry: false
        });
      }, 750);
      pendingDelayedRetryTimers.set(retryId, timer);
    }
  }

  return '';
}

/**
 * Records a favicon URL that has been proven valid by a successful `<img>` `onLoad` event,
 * and upgrades it to a self-contained `dataUrl` via Chrome's `/_favicon/` service when available.
 */
export async function recordVerifiedImgFavicon(params: {
  faviconSrc: string;
  pageUrl?: string;
  tabUrl?: string;
  size?: number;
}): Promise<void> {
  const { faviconSrc, pageUrl, tabUrl, size = 48 } = params;
  if (!isLoadableTabFaviconUrl(faviconSrc) || isChromeInternalFaviconEndpointUrl(faviconSrc)) {
    return;
  }

  const targetKeys = collectTargetKeys(tabUrl, pageUrl);
  if (targetKeys.length === 0) return;

  const effectivePageUrl =
    tabUrl && (!pageUrl || isSameSiteForFavicon(tabUrl, pageUrl))
      ? tabUrl
      : pageUrl || tabUrl || '';

  const isDataUrl = faviconSrc.toLowerCase().startsWith('data:image/');
  const now = Date.now();
  const initialUpdates: Record<string, Partial<CachedFaviconEntry>> = {};
  for (const k of targetKeys) {
    initialUpdates[k] = {
      ...(isDataUrl ? { dataUrl: faviconSrc } : {}),
      iconUrl: faviconSrc,
      pageUrl: effectivePageUrl,
      updatedAt: now
    };
  }
  await upsertCachedFaviconEntries(initialUpdates);

  if (!isDataUrl && effectivePageUrl) {
    const existing = memoryCache.get(targetKeys[0]);
    if (!existing?.dataUrl) {
      const extracted = await fetchRealChromeFaviconDataUrl(effectivePageUrl, size);
      if (extracted) {
        const upgradeUpdates: Record<string, Partial<CachedFaviconEntry>> = {};
        for (const k of targetKeys) {
          upgradeUpdates[k] = {
            dataUrl: extracted,
            pageUrl: effectivePageUrl,
            updatedAt: Date.now()
          };
        }
        await upsertCachedFaviconEntries(upgradeUpdates);
      }
    }
  }
}

export interface UseResolvedFaviconOptions {
  pageUrl?: string;
  tab?: TabWithFaviconMeta;
  size?: number;
}

export interface UseResolvedFaviconResult {
  faviconSrc: string;
  handleFaviconError: () => void;
  handleFaviconLoad: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}

/**
 * Multi-candidate favicon resolver hook with automatic recovery across reloads.
 * Steps gracefully through:
 *   1. Live `tab.favIconUrl` (if loadable scheme)
 *   2. Persisted verified `dataUrl`
 *   3. Persisted verified `iconUrl`
 *   4. Chrome `/_favicon/` for same-site redirected tab/cached page URL
 *   5. Chrome `/_favicon/` for `pageUrl`
 * Resets transient error state whenever the tab reloads, finishes loading, or updates its URL/favicon.
 */
export function useResolvedFavicon({
  pageUrl,
  tab,
  size = 32
}: UseResolvedFaviconOptions): UseResolvedFaviconResult {
  const [cacheTick, setCacheTick] = useState(0);

  useEffect(() => {
    const listener = () => setCacheTick((n) => n + 1);
    subscribers.add(listener);
    void hydrateFaviconCache();
    return () => {
      subscribers.delete(listener);
    };
  }, []);

  const tabEffectiveUrl = getEffectiveTabUrl(tab);

  const cachedEntry = useMemo(() => {
    void cacheTick;
    const byPage = getCachedFaviconEntry(pageUrl);
    if (byPage) return byPage;
    if (tabEffectiveUrl && (!pageUrl || isSameSiteForFavicon(tabEffectiveUrl, pageUrl))) {
      return getCachedFaviconEntry(tabEffectiveUrl);
    }
    return undefined;
  }, [pageUrl, tabEffectiveUrl, cacheTick]);

  const candidates = useMemo(() => {
    const list: string[] = [];
    const pushUnique = (url?: string) => {
      if (!url) return;
      const trimmed = url.trim();
      if (trimmed && !list.includes(trimmed)) {
        list.push(trimmed);
      }
    };

    if (tab?.favIconUrl && isLoadableTabFaviconUrl(tab.favIconUrl)) {
      pushUnique(tab.favIconUrl);
    }

    if (cachedEntry?.dataUrl && isLoadableTabFaviconUrl(cachedEntry.dataUrl)) {
      pushUnique(cachedEntry.dataUrl);
    }

    if (cachedEntry?.iconUrl && isLoadableTabFaviconUrl(cachedEntry.iconUrl)) {
      pushUnique(cachedEntry.iconUrl);
    }

    const sameSiteLiveOrCachedUrl =
      tabEffectiveUrl && (!pageUrl || isSameSiteForFavicon(tabEffectiveUrl, pageUrl))
        ? tabEffectiveUrl
        : cachedEntry?.pageUrl && (!pageUrl || isSameSiteForFavicon(cachedEntry.pageUrl, pageUrl))
        ? cachedEntry.pageUrl
        : '';

    if (sameSiteLiveOrCachedUrl && sameSiteLiveOrCachedUrl !== pageUrl) {
      pushUnique(getFaviconUrl(sameSiteLiveOrCachedUrl, size));
    }

    if (pageUrl) {
      pushUnique(getFaviconUrl(pageUrl, size));
    }

    return list;
  }, [tab?.favIconUrl, cachedEntry, tabEffectiveUrl, pageUrl, size]);

  const revKey = `${pageUrl || ''}|${tab?.id ?? 'none'}|${tab?.status || ''}|${
    tab?.favIconUrl || ''
  }|${tabEffectiveUrl}|${tab?._faviconRev ?? 0}`;

  const [failureState, setFailureState] = useState<{
    revKey: string;
    failedUrls: string[];
  }>({
    revKey,
    failedUrls: []
  });

  const activeFailedUrls =
    failureState.revKey === revKey ? failureState.failedUrls : [];

  const faviconSrc =
    candidates.find((candidate) => !activeFailedUrls.includes(candidate)) || '';

  const handleFaviconError = useCallback(() => {
    if (!faviconSrc) return;
    setFailureState((prev) => {
      const base = prev.revKey === revKey ? prev.failedUrls : [];
      if (base.includes(faviconSrc)) return prev;
      return {
        revKey,
        failedUrls: [...base, faviconSrc]
      };
    });
  }, [faviconSrc, revKey]);

  const handleFaviconLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (!faviconSrc || isChromeInternalFaviconEndpointUrl(faviconSrc)) {
        return;
      }
      const img = e.currentTarget;
      const isJsdom =
        typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
      if (!isJsdom && img && img.naturalWidth === 0) {
        return;
      }
      void recordVerifiedImgFavicon({
        faviconSrc,
        pageUrl,
        tabUrl: tabEffectiveUrl,
        size
      });
    },
    [faviconSrc, pageUrl, tabEffectiveUrl, size]
  );

  return {
    faviconSrc,
    handleFaviconError,
    handleFaviconLoad
  };
}

/**
 * Resets module-level favicon caches and timers between unit tests.
 */
export function resetFaviconCacheForTests(): void {
  memoryCache.clear();
  defaultGlobeBySize.clear();
  inFlightDefaultProbeBySize.clear();
  for (const timer of pendingDelayedRetryTimers.values()) {
    clearTimeout(timer);
  }
  pendingDelayedRetryTimers.clear();
  hasHydratedFromStorage = false;
  hydrationPromise = null;
  attachedStorageOnChangedRef = null;
}
