import type { CachedFaviconEntry } from '../../types';
import {
  doesTabUrlMatchBookmark,
  getCanonicalUrlKey,
  getEffectiveTabUrl
} from './url';

// @chrome-workaround(content-script-favicon-isolation): Content scripts (edgeTrigger.ts) cannot load chrome-extension://_favicon/ URLs directly due to cross-origin restrictions, so we cache verified base64 data URLs.
export const FAVICON_CACHE_STORAGE_KEY = 'cachedFaviconsByKey';
export const MAX_CACHED_FAVICONS = 250;
export const MAX_FAVICON_DATA_URL_LENGTH = 24576;
export const DEFAULT_FAVICON_CAPTURE_SIZE = 32;
export const FAVICON_PROBE_URL = 'https://arctic-favicon-probe.invalid/';

const BASE64_CHUNK_SIZE = 8192;

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
const subscribersByKey = new Map<string, Set<() => void>>();
const defaultGlobeBySize = new Map<number, string>();
const inFlightDefaultProbeBySize = new Map<number, Promise<string>>();
const inFlightFaviconFetchByKey = new Map<string, Promise<string>>();
const pendingDelayedRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

let hasHydratedFromStorage = false;
let hydrationPromise: Promise<Record<string, CachedFaviconEntry>> | null = null;
let pendingStorageFlush = false;
let activeFlushPromise: Promise<void> | null = null;
let attachedStorageOnChangedRef: typeof chrome.storage.onChanged | null = null;

/**
 * Subscribes a listener only to specific canonical favicon cache keys so updates
 * to one tab/bookmark never trigger O(N) re-renders across unrelated rows.
 */
export function subscribeToFaviconKeys(
  keys: readonly string[],
  listener: () => void
): () => void {
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
  if (uniqueKeys.length === 0) {
    return () => {};
  }

  for (const key of uniqueKeys) {
    let set = subscribersByKey.get(key);
    if (!set) {
      set = new Set();
      subscribersByKey.set(key, set);
    }
    set.add(listener);
  }

  return () => {
    for (const key of uniqueKeys) {
      const set = subscribersByKey.get(key);
      if (!set) continue;
      set.delete(listener);
      if (set.size === 0) {
        subscribersByKey.delete(key);
      }
    }
  };
}

function notifyKeys(changedKeys: Iterable<string>): void {
  const listenersToNotify = new Set<() => void>();
  for (const key of changedKeys) {
    if (!key) continue;
    const set = subscribersByKey.get(key);
    if (!set) continue;
    for (const listener of set) {
      listenersToNotify.add(listener);
    }
  }

  for (const listener of listenersToNotify) {
    try {
      listener();
    } catch {
      // ignore subscriber errors
    }
  }
}

function enforceMemoryCacheCapacity(): string[] {
  if (memoryCache.size <= MAX_CACHED_FAVICONS) {
    return [];
  }
  const sorted = Array.from(memoryCache.entries()).sort(
    (a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)
  );
  const evictedKeys: string[] = [];
  for (let i = MAX_CACHED_FAVICONS; i < sorted.length; i++) {
    const evictedKey = sorted[i][0];
    memoryCache.delete(evictedKey);
    evictedKeys.push(evictedKey);
  }
  return evictedKeys;
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
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    const slice = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
    chunks.push(String.fromCharCode.apply(null, slice as unknown as number[]));
  }
  return `data:${mime};base64,${btoa(chunks.join(''))}`;
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
 * automatically filtering out Chrome's built-in missing-icon grey wireframe globe
 * and deduplicating concurrent requests for the same URL and size.
 */
export async function fetchRealChromeFaviconDataUrl(
  pageUrl: string,
  size: number = DEFAULT_FAVICON_CAPTURE_SIZE
): Promise<string> {
  if (!pageUrl) return '';
  const resolvedUrl = normalizeFaviconPageUrl(pageUrl);
  if (!resolvedUrl) return '';

  const dedupeKey = `${getCanonicalUrlKey(resolvedUrl) || resolvedUrl}|${size}`;
  const inFlight = inFlightFaviconFetchByKey.get(dedupeKey);
  if (inFlight) {
    return inFlight;
  }

  const requestPromise = Promise.all([
    fetchChromeFaviconRawDataUrl(resolvedUrl, size),
    getDefaultChromeGlobeDataUrl(size)
  ])
    .then(([targetDataUrl, defaultGlobeDataUrl]) => {
      if (!targetDataUrl) return '';
      if (defaultGlobeDataUrl && targetDataUrl === defaultGlobeDataUrl) {
        return '';
      }
      return targetDataUrl;
    })
    .finally(() => {
      inFlightFaviconFetchByKey.delete(dedupeKey);
    });

  inFlightFaviconFetchByKey.set(dedupeKey, requestPromise);
  return requestPromise;
}

const handleStorageChanged = (
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string
) => {
  if (areaName !== 'local' || !changes[FAVICON_CACHE_STORAGE_KEY]) return;
  const incoming =
    (changes[FAVICON_CACHE_STORAGE_KEY].newValue as Record<string, CachedFaviconEntry> | undefined) ||
    {};
  const changedKeys: string[] = [];

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
      changedKeys.push(key);
    }
  }

  const evicted = enforceMemoryCacheCapacity();
  for (const k of evicted) {
    changedKeys.push(k);
  }

  if (changedKeys.length > 0) {
    notifyKeys(changedKeys);
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
        const changedKeys: string[] = [];
        for (const [key, entry] of Object.entries(stored)) {
          if (!key || !entry) continue;
          const existing = memoryCache.get(key);
          if (!existing || (entry.updatedAt || 0) >= (existing.updatedAt || 0)) {
            if (
              !existing ||
              existing.dataUrl !== entry.dataUrl ||
              existing.iconUrl !== entry.iconUrl ||
              existing.pageUrl !== entry.pageUrl
            ) {
              changedKeys.push(key);
            }
            memoryCache.set(key, entry);
          }
        }
        const evicted = enforceMemoryCacheCapacity();
        for (const k of evicted) {
          changedKeys.push(k);
        }
        hasHydratedFromStorage = true;
        if (changedKeys.length > 0) {
          notifyKeys(changedKeys);
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

export function getCachedFaviconEntryByKey(key?: string): CachedFaviconEntry | undefined {
  if (!key) return undefined;
  return memoryCache.get(key);
}

export function getCachedFaviconEntry(pageUrl?: string): CachedFaviconEntry | undefined {
  const key = getFaviconCacheKey(pageUrl);
  if (!key) return undefined;
  return memoryCache.get(key);
}

function doesFinalRecordDifferFromStored(
  finalRecord: Record<string, CachedFaviconEntry>,
  stored: Record<string, CachedFaviconEntry>
): boolean {
  const finalKeys = Object.keys(finalRecord);
  const storedKeys = Object.keys(stored);
  if (finalKeys.length !== storedKeys.length) {
    return true;
  }
  for (const key of finalKeys) {
    const a = finalRecord[key];
    const b = stored[key];
    if (!b) return true;
    if (
      (a.dataUrl || '') !== (b.dataUrl || '') ||
      (a.iconUrl || '') !== (b.iconUrl || '') ||
      (a.pageUrl || '') !== (b.pageUrl || '')
    ) {
      return true;
    }
  }
  return false;
}

async function performSingleStorageFlush(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) {
    return;
  }
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
    }

    // Synchronize memoryCache with merged/evicted record so cold isolates stay hydrated
    const backfilledKeys: string[] = [];
    const nextKeySet = new Set(Object.keys(finalRecord));
    for (const existingKey of Array.from(memoryCache.keys())) {
      if (!nextKeySet.has(existingKey)) {
        memoryCache.delete(existingKey);
        backfilledKeys.push(existingKey);
      }
    }
    for (const [k, v] of Object.entries(finalRecord)) {
      const current = memoryCache.get(k);
      if (
        !current ||
        current.dataUrl !== v.dataUrl ||
        current.iconUrl !== v.iconUrl ||
        current.pageUrl !== v.pageUrl
      ) {
        memoryCache.set(k, v);
        backfilledKeys.push(k);
      }
    }
    hasHydratedFromStorage = true;
    if (backfilledKeys.length > 0) {
      notifyKeys(backfilledKeys);
    }

    if (doesFinalRecordDifferFromStored(finalRecord, stored)) {
      await chrome.storage.local.set({ [FAVICON_CACHE_STORAGE_KEY]: finalRecord });
    }
  } catch {
    // ignore storage quota or transient errors
  }
}

function scheduleCoalescedStorageFlush(): Promise<void> {
  pendingStorageFlush = true;
  if (!activeFlushPromise) {
    activeFlushPromise = (async () => {
      // Yield one microtask so synchronous bursts (e.g. 50 <img> onLoad events) collapse into 1 I/O pass
      await Promise.resolve();
      while (pendingStorageFlush) {
        pendingStorageFlush = false;
        await performSingleStorageFlush();
      }
    })().finally(() => {
      activeFlushPromise = null;
    });
  }
  return activeFlushPromise;
}

export async function upsertCachedFaviconEntries(
  updatesByKey: Record<string, Partial<CachedFaviconEntry>>
): Promise<void> {
  const updateKeys = Object.keys(updatesByKey).filter(Boolean);
  if (updateKeys.length === 0) return;

  ensureStorageListener();

  // Optimistically merge into memoryCache so mounted UI components reflect changes immediately
  const now = Date.now();
  const changedKeys: string[] = [];

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
      changedKeys.push(key);
    }
  }

  const evicted = enforceMemoryCacheCapacity();
  for (const k of evicted) {
    changedKeys.push(k);
  }

  if (changedKeys.length > 0) {
    notifyKeys(changedKeys);
  }

  if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) {
    return;
  }

  // Fast exit: avoid full-blob storage read/clone/write when memory is already hydrated and nothing changed
  if (changedKeys.length === 0 && hasHydratedFromStorage) {
    if (activeFlushPromise) {
      await activeFlushPromise;
    }
    return;
  }

  await scheduleCoalescedStorageFlush();
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

  const size = options?.size ?? DEFAULT_FAVICON_CAPTURE_SIZE;
  const tabEffectiveUrl = getEffectiveTabUrl(tab);
  const targetKeys = collectTargetKeys(tabEffectiveUrl, bookmarkUrl);
  if (targetKeys.length === 0) return '';

  const effectivePageUrl = tabEffectiveUrl || bookmarkUrl || '';
  const isDataUrl = rawFavIconUrl.toLowerCase().startsWith('data:image/');

  // Fast-path: if all target keys already hold a verified dataUrl for this exact favIconUrl, skip network/canvas/storage churn
  if (hasHydratedFromStorage) {
    let sharedDataUrl = '';
    const allAlreadyVerified = targetKeys.every((k) => {
      const existing = memoryCache.get(k);
      if (!existing?.dataUrl) return false;
      if (isDataUrl && existing.dataUrl !== rawFavIconUrl) return false;
      if (!isDataUrl && existing.iconUrl !== rawFavIconUrl) return false;
      sharedDataUrl = existing.dataUrl;
      return true;
    });
    if (allAlreadyVerified && sharedDataUrl) {
      return sharedDataUrl;
    }
  }

  if (isDataUrl) {
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
  const { faviconSrc, pageUrl, tabUrl, size = DEFAULT_FAVICON_CAPTURE_SIZE } = params;
  if (!isLoadableTabFaviconUrl(faviconSrc) || isChromeInternalFaviconEndpointUrl(faviconSrc)) {
    return;
  }

  const targetKeys = collectTargetKeys(tabUrl, pageUrl);
  if (targetKeys.length === 0) return;

  const isDataUrl = faviconSrc.toLowerCase().startsWith('data:image/');

  // Fast-path: <img> onLoad fires every time folders expand or spaces switch; exit in O(1) when already cached
  if (hasHydratedFromStorage) {
    const allUpToDate = targetKeys.every((k) => {
      const existing = memoryCache.get(k);
      if (!existing?.dataUrl) return false;
      return isDataUrl ? existing.dataUrl === faviconSrc : existing.iconUrl === faviconSrc;
    });
    if (allUpToDate) {
      return;
    }
  }

  const effectivePageUrl =
    tabUrl && (!pageUrl || isSameSiteForFavicon(tabUrl, pageUrl))
      ? tabUrl
      : pageUrl || tabUrl || '';

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
    const needsDataUrlUpgrade = targetKeys.some((k) => !memoryCache.get(k)?.dataUrl);
    if (needsDataUrlUpgrade) {
      const extracted = await fetchRealChromeFaviconDataUrl(effectivePageUrl, size);
      if (extracted) {
        const upgradeUpdates: Record<string, Partial<CachedFaviconEntry>> = {};
        const upgradeNow = Date.now();
        for (const k of targetKeys) {
          upgradeUpdates[k] = {
            dataUrl: extracted,
            pageUrl: effectivePageUrl,
            updatedAt: upgradeNow
          };
        }
        await upsertCachedFaviconEntries(upgradeUpdates);
      }
    }
  }
}

/**
 * Resets module-level favicon caches and timers between unit tests.
 */
export function resetFaviconCacheForTests(): void {
  memoryCache.clear();
  subscribersByKey.clear();
  defaultGlobeBySize.clear();
  inFlightDefaultProbeBySize.clear();
  inFlightFaviconFetchByKey.clear();
  for (const timer of pendingDelayedRetryTimers.values()) {
    clearTimeout(timer);
  }
  pendingDelayedRetryTimers.clear();
  hasHydratedFromStorage = false;
  hydrationPromise = null;
  pendingStorageFlush = false;
  activeFlushPromise = null;
  attachedStorageOnChangedRef = null;
}
