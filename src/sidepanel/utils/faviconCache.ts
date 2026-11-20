import { useState, useCallback, useMemo, useSyncExternalStore } from 'react';
import type React from 'react';
import type { CachedFaviconEntry, TabWithFaviconMeta } from '../../types';
import { getEffectiveTabUrl, getFaviconUrl } from './url';
import {
  DEFAULT_FAVICON_CAPTURE_SIZE,
  getCachedFaviconEntryByKey,
  getFaviconCacheKey,
  hydrateFaviconCache,
  isChromeInternalFaviconEndpointUrl,
  isLoadableTabFaviconUrl,
  isSameSiteForFavicon,
  recordVerifiedImgFavicon,
  subscribeToFaviconKeys
} from './faviconStore';

export * from './faviconStore';

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
 * Multi-candidate favicon resolver hook with key-scoped subscriptions and automatic recovery across reloads.
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
  size = DEFAULT_FAVICON_CAPTURE_SIZE
}: UseResolvedFaviconOptions): UseResolvedFaviconResult {
  const tabEffectiveUrl = getEffectiveTabUrl(tab);

  const pageKey = useMemo(() => getFaviconCacheKey(pageUrl), [pageUrl]);
  const tabKey = useMemo(
    () =>
      tabEffectiveUrl && (!pageUrl || isSameSiteForFavicon(tabEffectiveUrl, pageUrl))
        ? getFaviconCacheKey(tabEffectiveUrl)
        : '',
    [tabEffectiveUrl, pageUrl]
  );

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const keys = pageKey && tabKey && pageKey !== tabKey
        ? [pageKey, tabKey]
        : pageKey
        ? [pageKey]
        : tabKey
        ? [tabKey]
        : [];
      const unsubscribe = subscribeToFaviconKeys(keys, onStoreChange);
      void hydrateFaviconCache();
      return unsubscribe;
    },
    [pageKey, tabKey]
  );

  const getSnapshot = useCallback((): CachedFaviconEntry | undefined => {
    if (pageKey) {
      const byPage = getCachedFaviconEntryByKey(pageKey);
      if (byPage) return byPage;
    }
    if (tabKey) {
      return getCachedFaviconEntryByKey(tabKey);
    }
    return undefined;
  }, [pageKey, tabKey]);

  const cachedEntry = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

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
