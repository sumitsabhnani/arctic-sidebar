import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TabBinding, LocalSettings, TabWithFaviconMeta } from '../../types';
import {
  doesTabUrlMatchBookmark,
  getEffectiveTabUrl,
  isFileUrl,
  isUrlNavigatedAway,
  normalizeNavigationInput,
  normalizeUrl
} from '../utils/url';
import { captureVerifiedTabFavicon } from '../utils/faviconCache';
import {
  blurSidebarActiveElementIfPointer,
  focusActiveMediaOrPageInTab
} from '../utils/tabPageFocus';
import { hasTextFragment, scrollToHighlightInTab } from '../utils/highlight';
import { markRecentlyMoved } from '../utils/dnd';
import {
  clearAllPersistedBindings,
  findMatchingUnboundTabForBookmark,
  getPersistedBindings,
  isArcticCommandTab,
  reconcileTabsAndBookmarksState,
  removePersistedBindings,
  upsertPersistedBindings
} from '../utils/reconcileBindings';

export { isArcticCommandTab };

const TAB_RESET_DEDUPE_WINDOW_MS = 500;

/**
 * Returns true for expected, recoverable Chrome tab navigation rejections
 * (e.g. user canceled a `beforeunload` dialog, superseded double-click navigation,
 * tab closed mid-action, tab-strip drag lock, or empty history back navigation)
 * so we handle them gracefully without polluting `chrome://extensions` with warnings.
 */
export function isExpectedTabNavigationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /navigation rejected|no tab with id|tab .* not found|cannot be edited right now|cannot find a (?:next|previous) page/i.test(
    msg
  );
}

/**
 * @chrome-workaround(newtab-omnibox-focus): Clean up unfocused command.html / newtab.html tabs spawned by the focus.js redirect workaround.
 * Closes any unfocused empty Arctic Command / New Tab tabs in the given window
 * when focus switches to another tab (e.g. pressing Cmd+T repeatedly or clicking another tab).
 */
export async function closeInactiveArcticCommandTabs(
  windowId: number,
  activeTabId: number,
  boundTabIds?: Record<number, string>
): Promise<number[]> {
  if (!chrome?.tabs?.query || !chrome?.tabs?.remove) return [];

  try {
    const tabs = await chrome.tabs.query({ windowId });
    if (tabs.length <= 1) return [];

    const currentActiveTab = tabs.find((t) => t.active);
    const effectiveActiveTab =
      tabs.find((t) => t.id === activeTabId) || currentActiveTab;

    // Check if the activated tab is the transient newtab.html redirect stub (focus.js),
    // which spawns command.html with a higher tab ID
    const activeRawUrl = (
      effectiveActiveTab?.url ||
      effectiveActiveTab?.pendingUrl ||
      ''
    )
      .trim()
      .toLowerCase();
    const isTransientNewTabRedirect =
      activeRawUrl.startsWith('chrome://newtab') ||
      activeRawUrl.startsWith('edge://newtab') ||
      activeRawUrl === 'about:newtab' ||
      activeRawUrl.includes('/newtab.html');

    let bookmarkIdByTabId = boundTabIds;
    if (!bookmarkIdByTabId && chrome?.storage?.session?.get) {
      try {
        const session = await chrome.storage.session.get(['bookmarkIdByTabId']);
        bookmarkIdByTabId = (session.bookmarkIdByTabId as Record<number, string>) || {};
      } catch {
        bookmarkIdByTabId = {};
      }
    }

    const candidates = tabs.filter((t) => {
      if (typeof t.id !== 'number') return false;
      if (t.id === activeTabId || t.id === currentActiveTab?.id || t.active) {
        return false;
      }
      if (t.pinned || bookmarkIdByTabId?.[t.id]) {
        return false;
      }
      if (isTransientNewTabRedirect && t.id > activeTabId) {
        return false;
      }
      return isArcticCommandTab(t);
    });

    if (candidates.length === 0) return [];

    // Always keep at least 1 tab open in the window
    const maxToClose = Math.max(0, tabs.length - 1);
    const tabIdsToClose = candidates
      .slice(0, maxToClose)
      .map((t) => t.id as number);

    if (tabIdsToClose.length > 0) {
      await Promise.allSettled(
        tabIdsToClose.map((id) =>
          Promise.resolve(chrome.tabs.remove(id)).catch(() => {})
        )
      );
    }

    return tabIdsToClose;
  } catch {
    return [];
  }
}

export function useTabBindings(activeSpaceId: string = 'home') {
  const [bindingsByBookmarkId, setBindingsByBookmarkId] = useState<Record<string, TabBinding>>({});
  const [bookmarkIdByTabId, setBookmarkIdByTabId] = useState<Record<number, string>>({});
  const bindingsByBookmarkIdRef = useRef<Record<string, TabBinding>>({});
  bindingsByBookmarkIdRef.current = bindingsByBookmarkId;
  const bookmarkIdByTabIdRef = useRef<Record<number, string>>({});
  bookmarkIdByTabIdRef.current = bookmarkIdByTabId;
  const unpinnedTabIdsRef = useRef<Set<number>>(new Set());
  const unpinnedBookmarkIdsRef = useRef<Set<string>>(new Set());
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [windowTabs, setWindowTabs] = useState<chrome.tabs.Tab[]>([]);
  const windowTabsRef = useRef<chrome.tabs.Tab[]>([]);
  windowTabsRef.current = windowTabs;
  const [isInitialTabsLoaded, setIsInitialTabsLoaded] = useState<boolean>(false);
  const [tabSpaceByTabId, setTabSpaceByTabId] = useState<Record<number, string>>({});
  const [customTabTitles, setCustomTabTitles] = useState<Record<number, string>>({});
  const customTabTitlesRef = useRef<Record<number, string>>({});
  customTabTitlesRef.current = customTabTitles;
  const [autoArchiveInterval, setAutoArchiveIntervalState] = useState<'never' | '12h' | '24h' | '7d'>('24h');
  const currentWindowIdRef = useRef<number | null>(null);
  const currentActiveSpaceIdRef = useRef<string>(activeSpaceId);
  currentActiveSpaceIdRef.current = activeSpaceId;
  const latestBookmarkNodesRef = useRef<chrome.bookmarks.BookmarkTreeNode[]>([]);
  const hasReconciledBookmarksRef = useRef<boolean>(false);
  const reconcileLockRef = useRef<Promise<void>>(Promise.resolve());
  const reconcileQueuedRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const creatingManualTabCountRef = useRef<number>(0);
  const tabsAwaitingRestoreUrlRef = useRef<Set<number>>(new Set());
  const closingTabIdsRef = useRef<Set<number>>(new Set());
  const faviconRevByTabIdRef = useRef<Record<number, number>>({});
  const tabOpenedAtRef = useRef<Record<number, number>>({});
  const recentTabResetRef = useRef<Map<number, { url: string; at: number }>>(new Map());
  const refreshTabsSeqRef = useRef<number>(0);
  const [fileAccessNoticeVisible, setFileAccessNoticeVisible] = useState<boolean>(false);

  const markRecentTabReset = useCallback((tabId: number, url: string) => {
    const now = Date.now();
    recentTabResetRef.current.set(tabId, { url, at: now });
    if (recentTabResetRef.current.size > 32) {
      for (const [id, entry] of recentTabResetRef.current.entries()) {
        if (now - entry.at > TAB_RESET_DEDUPE_WINDOW_MS * 2) {
          recentTabResetRef.current.delete(id);
        }
      }
    }
  }, []);

  const hasRecentTabReset = useCallback((tabId: number, url: string): boolean => {
    const entry = recentTabResetRef.current.get(tabId);
    if (!entry) return false;
    if (Date.now() - entry.at > TAB_RESET_DEDUPE_WINDOW_MS) {
      recentTabResetRef.current.delete(tabId);
      return false;
    }
    return entry.url === url;
  }, []);

  const dismissFileAccessNotice = useCallback(() => {
    setFileAccessNoticeVisible(false);
  }, []);

  const checkAndNotifyFileAccessNeeded = useCallback(async (err?: unknown): Promise<boolean> => {
    const msg = err instanceof Error ? err.message : String(err || '');
    const looksLikeFileAccessError =
      /file url|local file|not allowed to load local resource|cannot access/i.test(msg);

    let isAllowed: boolean | null = null;
    if (
      typeof chrome !== 'undefined' &&
      typeof chrome.extension?.isAllowedFileSchemeAccess === 'function'
    ) {
      try {
        isAllowed = await new Promise<boolean>((resolve) => {
          let settled = false;
          const finish = (val: boolean) => {
            if (!settled) {
              settled = true;
              resolve(Boolean(val));
            }
          };
          const maybePromise = chrome.extension.isAllowedFileSchemeAccess(
            finish
          ) as unknown as Promise<boolean> | undefined;
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(finish, () => finish(false));
          }
        });
      } catch {
        isAllowed = null;
      }
    }

    if (isAllowed === false || looksLikeFileAccessError) {
      setFileAccessNoticeVisible(true);
      return true;
    }
    return false;
  }, []);

  /**
   * Synchronously prune closed tab ID(s) from windowTabs and invalidate any in-flight
   * refreshWindowTabs() query so a closing bound tab never transiently leaks into unpinnedTabs.
   */
  const pruneClosedTabsFromWindow = useCallback((tabIds: number[]) => {
    if (tabIds.length === 0) return;
    const removedSet = new Set(tabIds);
    refreshTabsSeqRef.current += 1;
    setWindowTabs((prev) => {
      if (!prev.some((t) => typeof t.id === 'number' && removedSet.has(t.id))) {
        return prev;
      }
      const next = prev.filter((t) => typeof t.id !== 'number' || !removedSet.has(t.id));
      windowTabsRef.current = next;
      return next;
    });
  }, []);

  /**
   * Refresh all tabs in the current window
   */
  const refreshWindowTabs = useCallback(async () => {
    const reqSeq = ++refreshTabsSeqRef.current;
    try {
      const currentWin = await chrome.windows.getCurrent();
      if (reqSeq !== refreshTabsSeqRef.current || !isMountedRef.current) return;
      if (currentWin.id) {
        currentWindowIdRef.current = currentWin.id;
        const rawTabs = await chrome.tabs.query({ windowId: currentWin.id });
        if (reqSeq !== refreshTabsSeqRef.current || !isMountedRef.current) return;
        const tabs =
          closingTabIdsRef.current.size > 0
            ? rawTabs.filter((t) => typeof t.id !== 'number' || !closingTabIdsRef.current.has(t.id))
            : rawTabs;
        const tabsWithCustom: TabWithFaviconMeta[] = tabs.map((t) => {
          if (typeof t.id !== 'number') return t;
          const customTitle = customTabTitlesRef.current[t.id];
          const favRev = faviconRevByTabIdRef.current[t.id];
          if (customTitle || favRev) {
            return {
              ...t,
              ...(customTitle ? { title: customTitle } : {}),
              ...(favRev ? { _faviconRev: favRev } : {})
            };
          }
          return t;
        });
        windowTabsRef.current = tabsWithCustom;
        setWindowTabs(tabsWithCustom);

        const active = tabs.find((t) => t.active);
        if (active?.id) {
          setActiveTabId(active.id);
        }
      }
    } catch (err) {
      console.warn('[Arctic] Could not query window tabs:', err);
    }
  }, []);

  const syncUnpinnedTabIdsSession = useCallback(async () => {
    if (!chrome?.storage?.session?.set) return;
    try {
      await chrome.storage.session.set({
        unpinnedTabIds: Array.from(unpinnedTabIdsRef.current)
      });
    } catch {
      // ignore
    }
  }, []);

  /**
   * Read current session state and local settings
   */
  const loadSessionState = useCallback(async () => {
    try {
      const [sessionData, localData] = await Promise.all([
        chrome.storage.session.get([
          'bindingsByBookmarkId',
          'bookmarkIdByTabId',
          'customTabTitles',
          'unpinnedTabIds'
        ]),
        chrome.storage.local.get(['autoArchiveInterval', 'tabOpenedAt', 'tabSpaceByTabId'])
      ]);

      if (sessionData.customTabTitles) {
        setCustomTabTitles(sessionData.customTabTitles as Record<number, string>);
      }

      const bindings: Record<string, TabBinding> =
        (sessionData.bindingsByBookmarkId as Record<string, TabBinding>) || {};
      const byTab: Record<number, string> =
        (sessionData.bookmarkIdByTabId as Record<number, string>) || {};

      if (localData.tabSpaceByTabId) {
        setTabSpaceByTabId(localData.tabSpaceByTabId as Record<number, string>);
      }

      if (localData.autoArchiveInterval) {
        setAutoArchiveIntervalState(localData.autoArchiveInterval as 'never' | '12h' | '24h' | '7d');
      }

      // Verify open tabs to prune any dead bindings while preserving any bindings reconciled in parallel
      const allTabs = await chrome.tabs.query({});
      const openTabIdSet = new Set(
        allTabs.map((t) => t.id).filter((id): id is number => typeof id === 'number')
      );

      if (Array.isArray(sessionData.unpinnedTabIds)) {
        for (const rawId of sessionData.unpinnedTabIds) {
          if (typeof rawId === 'number' && openTabIdSet.has(rawId)) {
            unpinnedTabIdsRef.current.add(rawId);
          }
        }
      }
      let unpinnedPruned = false;
      for (const uid of Array.from(unpinnedTabIdsRef.current)) {
        if (!openTabIdSet.has(uid)) {
          unpinnedTabIdsRef.current.delete(uid);
          unpinnedPruned = true;
        }
      }
      if (unpinnedPruned) {
        void syncUnpinnedTabIdsSession();
      }

      // Re-merge with latest in-memory refs so a concurrent reconcileTabsWithBookmarks / handleRowClick is never overwritten
      const mergedBindings: Record<string, TabBinding> = {
        ...bindings,
        ...bindingsByBookmarkIdRef.current
      };
      const mergedByTab: Record<number, string> = {
        ...byTab,
        ...bookmarkIdByTabIdRef.current
      };

      let dirty = false;
      const cleanBindings: Record<string, TabBinding> = {};
      const cleanByTab: Record<number, string> = {};

      for (const [bId, binding] of Object.entries(mergedBindings)) {
        if (
          binding &&
          typeof binding.tabId === 'number' &&
          openTabIdSet.has(binding.tabId) &&
          !unpinnedBookmarkIdsRef.current.has(bId) &&
          !unpinnedTabIdsRef.current.has(binding.tabId) &&
          cleanByTab[binding.tabId] === undefined
        ) {
          cleanBindings[bId] = binding;
          cleanByTab[binding.tabId] = bId;
        } else {
          dirty = true;
        }
      }

      if (
        !dirty &&
        Object.keys(mergedByTab).some(
          (tIdStr) => mergedByTab[Number(tIdStr)] !== cleanByTab[Number(tIdStr)]
        )
      ) {
        dirty = true;
      }

      if (dirty) {
        await chrome.storage.session.set({
          bindingsByBookmarkId: cleanBindings,
          bookmarkIdByTabId: cleanByTab
        });
      }

      setBindingsByBookmarkId(cleanBindings);
      setBookmarkIdByTabId(cleanByTab);
      bindingsByBookmarkIdRef.current = cleanBindings;
      bookmarkIdByTabIdRef.current = cleanByTab;

      // Prune dead tab spaces
      const existingSpaces: Record<number, string> =
        (localData.tabSpaceByTabId as Record<number, string>) || {};
      let spacesUpdated = false;
      const cleanSpaces: Record<number, string> = {};
      for (const [tIdStr, spId] of Object.entries(existingSpaces)) {
        const tId = Number(tIdStr);
        if (openTabIdSet.has(tId)) {
          cleanSpaces[tId] = spId;
        } else {
          spacesUpdated = true;
        }
      }
      if (spacesUpdated) {
        await chrome.storage.local.set({ tabSpaceByTabId: cleanSpaces });
      }
      setTabSpaceByTabId(cleanSpaces);

      // Track tab creation timestamps for auto-archive
      const now = Date.now();
      const existingTimestamps: Record<number, number> = {
        ...((localData.tabOpenedAt as Record<number, number>) || {}),
        ...tabOpenedAtRef.current
      };
      let timestampsUpdated = false;

      for (const tab of allTabs) {
        if (typeof tab.id === 'number' && !existingTimestamps[tab.id]) {
          existingTimestamps[tab.id] = now;
          timestampsUpdated = true;
        }
      }

      // Remove timestamps of closed tabs
      for (const tIdStr of Object.keys(existingTimestamps)) {
        const tId = Number(tIdStr);
        if (!openTabIdSet.has(tId)) {
          delete existingTimestamps[tId];
          timestampsUpdated = true;
        }
      }

      tabOpenedAtRef.current = existingTimestamps;
      if (timestampsUpdated) {
        await chrome.storage.local.set({ tabOpenedAt: existingTimestamps });
      }

      // Perform auto-archive check ONLY after bookmark reconciliation has run so pinned tabs are never closed prematurely
      const intervalSetting = localData.autoArchiveInterval || '24h';
      if (intervalSetting !== 'never' && hasReconciledBookmarksRef.current) {
        const thresholdMs =
          intervalSetting === '12h'
            ? 12 * 60 * 60 * 1000
            : intervalSetting === '24h'
            ? 24 * 60 * 60 * 1000
            : 7 * 24 * 60 * 60 * 1000;

        // Track total tabs per window so auto-archive never closes the last tab in any window
        const remainingTabsByWin = new Map<number, number>();
        for (const tab of allTabs) {
          const wId = typeof tab.windowId === 'number' ? tab.windowId : -1;
          remainingTabsByWin.set(wId, (remainingTabsByWin.get(wId) || 0) + 1);
        }

        const tabsToClose: number[] = [];

        for (const tab of allTabs) {
          if (
            typeof tab.id === 'number' &&
            !cleanByTab[tab.id] &&
            !tab.active &&
            !tab.pinned &&
            !tab.audible &&
            !isArcticCommandTab(tab)
          ) {
            const wId = typeof tab.windowId === 'number' ? tab.windowId : -1;
            const remainingInWin = remainingTabsByWin.get(wId) || 1;
            if (remainingInWin <= 1) continue;

            const openedAt = existingTimestamps[tab.id];
            if (openedAt && now - openedAt > thresholdMs) {
              tabsToClose.push(tab.id);
              remainingTabsByWin.set(wId, remainingInWin - 1);
            }
          }
        }

        if (tabsToClose.length > 0) {
          await chrome.tabs.remove(tabsToClose);
        }
      }
    } catch (err) {
      console.warn('[Arctic] Failed to read session/local storage:', err);
    }
  }, []);

  /**
   * Helper to write state to chrome.storage.session and persist last-known bindings locally
   */
  const persistSession = useCallback(
    async (
      newBindings: Record<string, TabBinding>,
      newByTab: Record<number, string>
    ) => {
      bindingsByBookmarkIdRef.current = newBindings;
      bookmarkIdByTabIdRef.current = newByTab;
      setBindingsByBookmarkId(newBindings);
      setBookmarkIdByTabId(newByTab);
      try {
        await chrome.storage.session.set({
          bindingsByBookmarkId: newBindings,
          bookmarkIdByTabId: newByTab
        });
        await upsertPersistedBindings(newBindings);
      } catch (err) {
        console.error('[Arctic] Error persisting session state:', err);
      }
    },
    []
  );

  /**
   * Migrate all state/bindings when Chrome replaces a sleeping/discarded/prerendered tab ID
   */
  const migrateReplacedTabId = useCallback(
    (addedTabId: number, removedTabId: number) => {
      if (addedTabId === removedTabId) return;

      if (unpinnedTabIdsRef.current.has(removedTabId)) {
        unpinnedTabIdsRef.current.delete(removedTabId);
        unpinnedTabIdsRef.current.add(addedTabId);
        void syncUnpinnedTabIdsSession();
      }

      if (tabsAwaitingRestoreUrlRef.current.has(removedTabId)) {
        tabsAwaitingRestoreUrlRef.current.delete(removedTabId);
        tabsAwaitingRestoreUrlRef.current.add(addedTabId);
      }

      if (faviconRevByTabIdRef.current[removedTabId] !== undefined) {
        faviconRevByTabIdRef.current[addedTabId] = faviconRevByTabIdRef.current[removedTabId];
        delete faviconRevByTabIdRef.current[removedTabId];
      }

      if (tabOpenedAtRef.current[removedTabId] !== undefined) {
        tabOpenedAtRef.current[addedTabId] = tabOpenedAtRef.current[removedTabId];
        delete tabOpenedAtRef.current[removedTabId];
        chrome.storage.local.set({ tabOpenedAt: { ...tabOpenedAtRef.current } });
      }

      setActiveTabId((prev) => (prev === removedTabId ? addedTabId : prev));

      setTabSpaceByTabId((prev) => {
        if (!prev[removedTabId]) return prev;
        const next = { ...prev, [addedTabId]: prev[removedTabId] };
        delete next[removedTabId];
        chrome.storage.local.set({ tabSpaceByTabId: next });
        return next;
      });

      setCustomTabTitles((prev) => {
        if (!prev[removedTabId]) return prev;
        const next = { ...prev, [addedTabId]: prev[removedTabId] };
        delete next[removedTabId];
        chrome.storage.session.set({ customTabTitles: next });
        return next;
      });

      const bookmarkId = bookmarkIdByTabIdRef.current[removedTabId];
      if (bookmarkId) {
        const nextByTab = { ...bookmarkIdByTabIdRef.current };
        delete nextByTab[removedTabId];
        nextByTab[addedTabId] = bookmarkId;

        const nextBindings = { ...bindingsByBookmarkIdRef.current };
        if (nextBindings[bookmarkId]) {
          nextBindings[bookmarkId] = {
            ...nextBindings[bookmarkId],
            tabId: addedTabId
          };
        }

        bookmarkIdByTabIdRef.current = nextByTab;
        bindingsByBookmarkIdRef.current = nextBindings;
        setBookmarkIdByTabId(nextByTab);
        setBindingsByBookmarkId(nextBindings);
        chrome.storage.session.set({
          bindingsByBookmarkId: nextBindings,
          bookmarkIdByTabId: nextByTab
        });
      }
    },
    []
  );

  /**
   * Reconciles open/sleeping browser tabs with saved bookmarks across all Spaces on startup/reload.
   * Handles exact URL matches, deterministic canonical redirects, sleeping/pendingUrl tabs,
   * and persisted navigated-away bindings across browser restarts & extension updates.
   */
  const reconcileTabsWithBookmarks = useCallback(
    async (bookmarkNodes: chrome.bookmarks.BookmarkTreeNode[]) => {
      latestBookmarkNodesRef.current = bookmarkNodes;

      const runReconcile = async () => {
        try {
          if (currentWindowIdRef.current === null && chrome.windows?.getCurrent) {
            try {
              const win = await chrome.windows.getCurrent();
              if (typeof win?.id === 'number') {
                currentWindowIdRef.current = win.id;
              }
            } catch {
              // ignore
            }
          }

          const [rawAllOpenTabs, session, persistedBindings] = await Promise.all([
            chrome.tabs.query({}),
            chrome.storage.session.get([
              'bindingsByBookmarkId',
              'bookmarkIdByTabId',
              'unpinnedTabIds'
            ]),
            getPersistedBindings()
          ]);
          const allOpenTabs =
            closingTabIdsRef.current.size > 0
              ? rawAllOpenTabs.filter(
                  (t) => typeof t.id !== 'number' || !closingTabIdsRef.current.has(t.id)
                )
              : rawAllOpenTabs;

          if (Array.isArray(session.unpinnedTabIds)) {
            const liveTabIds = new Set(
              allOpenTabs
                .map((t) => t.id)
                .filter((id): id is number => typeof id === 'number')
            );
            for (const rawId of session.unpinnedTabIds) {
              if (typeof rawId === 'number' && liveTabIds.has(rawId)) {
                unpinnedTabIdsRef.current.add(rawId);
              }
            }
          }

          // Track any session-restoring tabs that do not have their URL populated yet
          for (const tab of allOpenTabs) {
            if (
              typeof tab.id === 'number' &&
              !bookmarkIdByTabIdRef.current[tab.id] &&
              !unpinnedTabIdsRef.current.has(tab.id) &&
              tab.openerTabId === undefined &&
              !isArcticCommandTab(tab)
            ) {
              const effUrl = getEffectiveTabUrl(tab);
              if (!effUrl || effUrl.toLowerCase() === 'about:blank') {
                tabsAwaitingRestoreUrlRef.current.add(tab.id);
              }
            }
          }

          const sessionBindings =
            (session.bindingsByBookmarkId as Record<string, TabBinding>) || {};
          const sessionByTab =
            (session.bookmarkIdByTabId as Record<number, string>) || {};

          const currentBindings: Record<string, TabBinding> = {
            ...sessionBindings,
            ...bindingsByBookmarkIdRef.current
          };
          const currentByTab: Record<number, string> = {
            ...sessionByTab,
            ...bookmarkIdByTabIdRef.current
          };

          const result = reconcileTabsAndBookmarksState({
            bookmarkNodes,
            allOpenTabs,
            preferredWindowId: currentWindowIdRef.current,
            currentBindings,
            currentByTab,
            persistedBindings,
            excludedTabIds: unpinnedTabIdsRef.current,
            excludedBookmarkIds: unpinnedBookmarkIdsRef.current
          });

          hasReconciledBookmarksRef.current = true;

          // Clear restore-tracking for any tab now bound
          for (const tIdStr of Object.keys(result.bookmarkIdByTabId)) {
            tabsAwaitingRestoreUrlRef.current.delete(Number(tIdStr));
          }

          if (result.changed && isMountedRef.current) {
            await persistSession(result.bindingsByBookmarkId, result.bookmarkIdByTabId);
            await refreshWindowTabs();
          }
        } catch (err) {
          console.warn('[Arctic] Could not reconcile tabs with bookmarks:', err);
        }
      };

      const next = reconcileLockRef.current.then(runReconcile, runReconcile);
      reconcileLockRef.current = next.then(
        () => undefined,
        () => undefined
      );

      await next;
    },
    [persistSession, refreshWindowTabs]
  );

  const scheduleReconcile = useCallback(() => {
    if (reconcileQueuedRef.current || latestBookmarkNodesRef.current.length === 0) {
      return;
    }
    reconcileQueuedRef.current = true;
    Promise.resolve().then(() => {
      reconcileQueuedRef.current = false;
      if (isMountedRef.current && latestBookmarkNodesRef.current.length > 0) {
        void reconcileTabsWithBookmarks(latestBookmarkNodesRef.current);
      }
    });
  }, [reconcileTabsWithBookmarks]);

  // Initialize and register event listeners
  useEffect(() => {
    isMountedRef.current = true;
    Promise.all([refreshWindowTabs(), loadSessionState()]).finally(() => {
      if (isMountedRef.current) {
        setIsInitialTabsLoaded(true);
      }
    });

    // Listen to tab activation
    const handleActivated: Parameters<typeof chrome.tabs.onActivated.addListener>[0] = (activeInfo) => {
      chrome.windows.getCurrent(async (currentWin) => {
        if (currentWin.id === activeInfo.windowId) {
          setActiveTabId(activeInfo.tabId);
          currentWindowIdRef.current = activeInfo.windowId;
          await closeInactiveArcticCommandTabs(
            activeInfo.windowId,
            activeInfo.tabId,
            bookmarkIdByTabIdRef.current
          );
          await refreshWindowTabs();
        }
      });
    };

    // Listen to tab creation (e.g. Ctrl+T, link clicked, or browser session restore)
    const handleCreated = (tab: chrome.tabs.Tab) => {
      if (
        typeof tab.id === 'number' &&
        creatingManualTabCountRef.current === 0 &&
        !bookmarkIdByTabIdRef.current[tab.id] &&
        !unpinnedTabIdsRef.current.has(tab.id) &&
        tab.openerTabId === undefined &&
        !isArcticCommandTab(tab)
      ) {
        const effUrl = getEffectiveTabUrl(tab);
        if (!effUrl || effUrl.toLowerCase() === 'about:blank') {
          tabsAwaitingRestoreUrlRef.current.add(tab.id);
        } else if (latestBookmarkNodesRef.current.length > 0) {
          scheduleReconcile();
        }
      }

      chrome.windows.getCurrent(async (currentWin) => {
        if (currentWin.id === tab.windowId) {
          if (typeof tab.id === 'number') {
            const currentSpace = currentActiveSpaceIdRef.current || 'home';
            setTabSpaceByTabId((prev) => {
              if (prev[tab.id!]) return prev;
              const next = { ...prev, [tab.id!]: currentSpace };
              chrome.storage.local.set({ tabSpaceByTabId: next });
              return next;
            });
            // Record timestamp for new tab without racing concurrent tab creations
            tabOpenedAtRef.current[tab.id] = Date.now();
            chrome.storage.local.set({ tabOpenedAt: { ...tabOpenedAtRef.current } });
            if (tab.active && typeof tab.windowId === 'number') {
              await closeInactiveArcticCommandTabs(
                tab.windowId,
                tab.id,
                bookmarkIdByTabIdRef.current
              );
            }
          }
          await refreshWindowTabs();
        }
      });
    };

    // Listen to tab removal
    const handleRemoved = (tabId: number, removeInfo?: chrome.tabs.TabRemoveInfo) => {
      closingTabIdsRef.current.delete(tabId);
      tabsAwaitingRestoreUrlRef.current.delete(tabId);
      recentTabResetRef.current.delete(tabId);
      if (unpinnedTabIdsRef.current.delete(tabId)) {
        void syncUnpinnedTabIdsSession();
      }
      delete faviconRevByTabIdRef.current[tabId];
      pruneClosedTabsFromWindow([tabId]);
      void refreshWindowTabs();

      if (!removeInfo?.isWindowClosing) {
        if (tabOpenedAtRef.current[tabId] !== undefined) {
          delete tabOpenedAtRef.current[tabId];
          chrome.storage.local.set({ tabOpenedAt: { ...tabOpenedAtRef.current } });
        }
        setTabSpaceByTabId((prev) => {
          if (!prev[tabId]) return prev;
          const next = { ...prev };
          delete next[tabId];
          chrome.storage.local.set({ tabSpaceByTabId: next });
          return next;
        });
      }

      setCustomTabTitles((prev) => {
        if (!prev[tabId]) return prev;
        const next = { ...prev };
        delete next[tabId];
        chrome.storage.session.set({ customTabTitles: next });
        return next;
      });

      const knownBookmarkId = bookmarkIdByTabIdRef.current[tabId];
      if (knownBookmarkId && !removeInfo?.isWindowClosing) {
        void removePersistedBindings([knownBookmarkId]);
      }

      setBookmarkIdByTabId((prevByTab) => {
        const bookmarkId = prevByTab[tabId];
        if (!bookmarkId) return prevByTab;

        if (!removeInfo?.isWindowClosing && bookmarkId !== knownBookmarkId) {
          void removePersistedBindings([bookmarkId]);
        }

        const nextByTab = { ...prevByTab };
        delete nextByTab[tabId];
        bookmarkIdByTabIdRef.current = nextByTab;

        setBindingsByBookmarkId((prevBindings) => {
          const nextBindings = { ...prevBindings };
          delete nextBindings[bookmarkId];
          bindingsByBookmarkIdRef.current = nextBindings;
          chrome.storage.session.set({
            bindingsByBookmarkId: nextBindings,
            bookmarkIdByTabId: nextByTab
          });
          return nextBindings;
        });

        return nextByTab;
      });
    };

    // Listen to tab updates (URL change, navigation away, favicon, title, muted, audible)
    const handleUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (
      tabId,
      changeInfo,
      tab
    ) => {
      if (closingTabIdsRef.current.has(tabId)) return;
      const shouldBumpFaviconRev =
        changeInfo.favIconUrl !== undefined ||
        changeInfo.status === 'loading' ||
        changeInfo.status === 'complete' ||
        changeInfo.url !== undefined;
      if (shouldBumpFaviconRev) {
        faviconRevByTabIdRef.current[tabId] = (faviconRevByTabIdRef.current[tabId] || 0) + 1;
      }
      const nextFavRev = faviconRevByTabIdRef.current[tabId];

      const candidateFavIconUrl =
        changeInfo.favIconUrl !== undefined ? changeInfo.favIconUrl : tab.favIconUrl;
      if (
        candidateFavIconUrl &&
        (changeInfo.favIconUrl !== undefined || changeInfo.status === 'complete')
      ) {
        const boundBmId = bookmarkIdByTabIdRef.current[tabId];
        const boundOriginalUrl = boundBmId
          ? bindingsByBookmarkIdRef.current[boundBmId]?.originalUrl
          : undefined;
        void captureVerifiedTabFavicon(
          {
            ...tab,
            ...(changeInfo.url ? { url: changeInfo.url } : {}),
            favIconUrl: candidateFavIconUrl
          },
          boundOriginalUrl
        );
      }

      // Update in-place to avoid expensive query on every micro status event
      setWindowTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t;
          const resolvedFavIconUrl =
            changeInfo.favIconUrl !== undefined
              ? changeInfo.favIconUrl
              : 'favIconUrl' in tab
              ? tab.favIconUrl
              : changeInfo.status === 'complete' || Boolean(changeInfo.url)
              ? undefined
              : t.favIconUrl;
          const merged: TabWithFaviconMeta = {
            ...t,
            ...tab,
            ...changeInfo,
            favIconUrl: resolvedFavIconUrl,
            pendingUrl: changeInfo.url ? undefined : tab.pendingUrl,
            ...(nextFavRev ? { _faviconRev: nextFavRev } : {})
          };
          const rawCandidateTitle = changeInfo.title || tab.title || t.title;
          const cleanTitle =
            !isArcticCommandTab(merged) && rawCandidateTitle === 'Arctic Command'
              ? changeInfo.url || tab.url || 'Loading...'
              : rawCandidateTitle;
          return {
            ...merged,
            title: customTabTitlesRef.current[tabId] || cleanTitle
          };
        })
      );

      // If a session-restored or sleeping tab just received its URL after initial load, reconcile it
      if (
        !bookmarkIdByTabIdRef.current[tabId] &&
        !unpinnedTabIdsRef.current.has(tabId) &&
        (tabsAwaitingRestoreUrlRef.current.has(tabId) || Boolean(tab.discarded))
      ) {
        const effectiveUnboundUrl = changeInfo.url || getEffectiveTabUrl(tab);
        if (
          effectiveUnboundUrl &&
          effectiveUnboundUrl.toLowerCase() !== 'about:blank' &&
          !isArcticCommandTab({ ...tab, ...(changeInfo.url ? { url: changeInfo.url } : {}) })
        ) {
          tabsAwaitingRestoreUrlRef.current.delete(tabId);
          scheduleReconcile();
        }
      }

      if (!changeInfo.url && changeInfo.status !== 'complete' && !changeInfo.title) {
        return;
      }

      setBookmarkIdByTabId((prevByTab) => {
        const bookmarkId = prevByTab[tabId];
        if (!bookmarkId) return prevByTab;

        setBindingsByBookmarkId((prevBindings) => {
          const existing = prevBindings[bookmarkId];
          if (!existing) return prevBindings;

          const currentUrl = changeInfo.url || getEffectiveTabUrl(tab) || existing.currentUrl;
          const currentTitle = changeInfo.title || tab.title || existing.currentTitle;
          let nextOriginalUrl = existing.originalUrl;
          let isNavAway = isUrlNavigatedAway(currentUrl, nextOriginalUrl);

          // If this was a .new document shortcut and it redirected to the created document, update bookmark URL
          const isDotNewRedirect =
            (existing.originalUrl === 'https://docs.new' && currentUrl?.startsWith('https://docs.google.com/document/d/')) ||
            (existing.originalUrl === 'https://sheets.new' && currentUrl?.startsWith('https://docs.google.com/spreadsheets/d/')) ||
            (existing.originalUrl === 'https://slides.new' && currentUrl?.startsWith('https://docs.google.com/presentation/d/')) ||
            (existing.originalUrl === 'https://notion.new' && currentUrl?.startsWith('https://www.notion.so/') && !currentUrl.includes('/login')) ||
            (existing.originalUrl === 'https://gist.new' && currentUrl?.startsWith('https://gist.github.com/'));

          if (isDotNewRedirect && currentUrl) {
            nextOriginalUrl = currentUrl;
            isNavAway = false;
            const cleanedTitle = tab.title
              ? tab.title
                  .replace(/ - Google (Docs|Sheets|Slides)$/i, '')
                  .trim()
              : '';
            const isDefaultPlaceholderTitle =
              !cleanedTitle ||
              cleanedTitle.includes('.new') ||
              cleanedTitle.startsWith('New Google ') ||
              cleanedTitle === 'New Notion Page' ||
              cleanedTitle === 'New GitHub Gist';

            chrome.bookmarks.update(bookmarkId, {
              url: currentUrl,
              ...(!isDefaultPlaceholderTitle ? { title: cleanedTitle } : {})
            }).catch(() => {});
          }

          if (
            nextOriginalUrl === existing.originalUrl &&
            currentUrl === existing.currentUrl &&
            currentTitle === existing.currentTitle &&
            isNavAway === existing.isNavigatedAway
          ) {
            return prevBindings;
          }

          const updatedBinding: TabBinding = {
            ...existing,
            originalUrl: nextOriginalUrl,
            currentUrl,
            currentTitle,
            isNavigatedAway: isNavAway
          };

          const nextBindings = {
            ...prevBindings,
            [bookmarkId]: updatedBinding
          };
          bindingsByBookmarkIdRef.current = nextBindings;

          chrome.storage.session.set({
            bindingsByBookmarkId: nextBindings,
            bookmarkIdByTabId: prevByTab
          });
          void upsertPersistedBindings({ [bookmarkId]: updatedBinding });

          return nextBindings;
        });

        return prevByTab;
      });
    };

    // Listen to sleeping/discarded/prerendered tab ID replacements
    const handleReplaced = (addedTabId: number, removedTabId: number) => {
      migrateReplacedTabId(addedTabId, removedTabId);
      void refreshWindowTabs();
    };

    // Listen to tab moves or attaches
    const handleMoved = () => refreshWindowTabs();
    const handleAttached = () => refreshWindowTabs();
    const handleDetached = () => refreshWindowTabs();

    // Listen to session storage changes
    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'session') {
        if (changes.bindingsByBookmarkId) {
          const nextBindings =
            (changes.bindingsByBookmarkId.newValue as Record<string, TabBinding>) || {};
          bindingsByBookmarkIdRef.current = nextBindings;
          setBindingsByBookmarkId(nextBindings);
        }
        if (changes.bookmarkIdByTabId) {
          const nextByTab =
            (changes.bookmarkIdByTabId.newValue as Record<number, string>) || {};
          bookmarkIdByTabIdRef.current = nextByTab;
          setBookmarkIdByTabId(nextByTab);
        }
        if (changes.unpinnedTabIds && Array.isArray(changes.unpinnedTabIds.newValue)) {
          unpinnedTabIdsRef.current = new Set(
            (changes.unpinnedTabIds.newValue as unknown[]).filter(
              (id): id is number => typeof id === 'number'
            )
          );
        }
      }
    };

    // Listen to window focus
    const handleWindowFocus = (winId: number) => {
      if (winId !== chrome.windows.WINDOW_ID_NONE) {
        refreshWindowTabs();
      }
    };

    // Listen to bookmark changes (e.g. URL replaced or modified)
    const handleBookmarkChanged = (id: string, changeInfo: { title?: string; url?: string }) => {
      if (changeInfo.url) {
        setBindingsByBookmarkId((prevBindings) => {
          const existing = prevBindings[id];
          if (!existing) return prevBindings;

          const isNavAway = isUrlNavigatedAway(existing.currentUrl, changeInfo.url!);
          const updatedBinding: TabBinding = {
            ...existing,
            originalUrl: changeInfo.url!,
            isNavigatedAway: isNavAway
          };

          const next = { ...prevBindings, [id]: updatedBinding };
          bindingsByBookmarkIdRef.current = next;
          chrome.storage.session.set({ bindingsByBookmarkId: next });
          void upsertPersistedBindings({ [id]: updatedBinding });
          return next;
        });
      }
    };

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onCreated.addListener(handleCreated);
    chrome.tabs.onRemoved.addListener(handleRemoved);
    chrome.tabs.onUpdated.addListener(handleUpdated);
    if (chrome.tabs.onReplaced) {
      chrome.tabs.onReplaced.addListener(handleReplaced);
    }
    chrome.tabs.onMoved.addListener(handleMoved);
    chrome.tabs.onAttached.addListener(handleAttached);
    chrome.tabs.onDetached.addListener(handleDetached);
    chrome.windows.onFocusChanged.addListener(handleWindowFocus);
    chrome.storage.onChanged.addListener(handleStorageChange);
    if (chrome?.bookmarks?.onChanged) {
      chrome.bookmarks.onChanged.addListener(handleBookmarkChanged);
    }

    const handleRuntimeMessage = (msg: { type?: string }) => {
      if (msg && (msg.type === 'REFRESH_TABS' || msg.type === 'TABS_DISCARDED')) {
        refreshWindowTabs();
      }
    };
    if (chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    }

    const cleanupInterval = setInterval(() => {
      loadSessionState();
    }, 5 * 60 * 1000);

    return () => {
      isMountedRef.current = false;
      clearInterval(cleanupInterval);
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onCreated.removeListener(handleCreated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      if (chrome.tabs.onReplaced) {
        chrome.tabs.onReplaced.removeListener(handleReplaced);
      }
      chrome.tabs.onMoved.removeListener(handleMoved);
      chrome.tabs.onAttached.removeListener(handleAttached);
      chrome.tabs.onDetached.removeListener(handleDetached);
      chrome.windows.onFocusChanged.removeListener(handleWindowFocus);
      chrome.storage.onChanged.removeListener(handleStorageChange);
      if (chrome?.bookmarks?.onChanged) {
        chrome.bookmarks.onChanged.removeListener(handleBookmarkChanged);
      }
      if (chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
      }
    };
  }, [loadSessionState, migrateReplacedTabId, pruneClosedTabsFromWindow, refreshWindowTabs, scheduleReconcile]);

  /**
   * Map of all window tabs by tabId for instant lookup (audible, mutedInfo, discarded, etc.)
   */
  const tabsByTabId = useMemo(
    () =>
      windowTabs.reduce<Record<number, chrome.tabs.Tab>>((acc, tab) => {
        if (typeof tab.id === 'number') {
          acc[tab.id] = tab;
        }
        return acc;
      }, {}),
    [windowTabs]
  );

  /**
   * Filter window tabs that are NOT bound to any bookmark (unpinned / temp tabs)
   * and exclude the Arctic Command / New Tab launcher until it navigates to a real page
   */
  const unpinnedTabs = useMemo(
    () =>
      windowTabs.filter(
        (tab) =>
          typeof tab.id === 'number' &&
          !bookmarkIdByTabId[tab.id] &&
          !isArcticCommandTab(tab)
      ),
    [windowTabs, bookmarkIdByTabId]
  );

  /**
   * Create a new tab (e.g. Ctrl+T, '+ New Tab' button, 'Open in New Tab', or 'Duplicate Tab' on an unopened bookmark)
   */
  const createNewTab = useCallback(
    async (url?: string, spaceId?: string) => {
      creatingManualTabCountRef.current += 1;
      let newTab: chrome.tabs.Tab;
      try {
        newTab = await chrome.tabs.create({ url, active: true });
      } catch (err) {
        if (url && isFileUrl(url)) {
          await checkAndNotifyFileAccessNeeded(err);
        } else if (!isExpectedTabNavigationError(err)) {
          console.warn('[Arctic] Could not create new tab:', err);
        }
        return undefined;
      } finally {
        creatingManualTabCountRef.current -= 1;
      }
      const targetSpace = spaceId || currentActiveSpaceIdRef.current || 'home';
      if (typeof newTab?.id === 'number') {
        if (url) {
          unpinnedTabIdsRef.current.add(newTab.id);
          tabsAwaitingRestoreUrlRef.current.delete(newTab.id);
          void syncUnpinnedTabIdsSession();
          if (hasTextFragment(url)) {
            void scrollToHighlightInTab(newTab.id, url);
          }
        }
        setActiveTabId(newTab.id);
        setTabSpaceByTabId((prev) => {
          const next = { ...prev, [newTab.id!]: targetSpace };
          chrome.storage.local.set({ tabSpaceByTabId: next });
          return next;
        });
      }
      await refreshWindowTabs();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      return newTab;
    },
    [checkAndNotifyFileAccessNeeded, refreshWindowTabs, syncUnpinnedTabIdsSession]
  );

  /**
   * Focus a tab
   */
  const focusTab = useCallback(async (tabId: number) => {
    blurSidebarActiveElementIfPointer();
    setActiveTabId(tabId);
    try {
      const updatedTab = await chrome.tabs.update(tabId, { active: true });
      const targetUrl = getEffectiveTabUrl(updatedTab) || updatedTab?.url;
      void focusActiveMediaOrPageInTab(tabId, targetUrl);
    } catch (err) {
      console.warn('[Arctic] Could not activate tab:', err);
    }
  }, []);

  /**
   * Close one or more tabs optimistically in a single synchronous UI batch.
   * If closing all tabs in the window, creates a fresh tab first to keep the browser window & sidebar alive.
   */
  const closeMultipleTabs = useCallback(
    async (tabIds: number[]) => {
      const uniqueIds = Array.from(
        new Set(tabIds.filter((id): id is number => typeof id === 'number'))
      );
      if (uniqueIds.length === 0) return;

      const closedSet = new Set(uniqueIds);
      const currentKnownTabs = windowTabsRef.current;
      const mightCloseEntireWindow =
        currentKnownTabs.length === 0 ||
        currentKnownTabs.every((t) => typeof t.id === 'number' && closedSet.has(t.id));

      // 1. Synchronously mark tabs as closing, prune windowTabs, and clear bindings at t=0ms
      //    so React commits a single instant frame without waiting on Chrome IPC roundtrips.
      for (const id of uniqueIds) {
        closingTabIdsRef.current.add(id);
      }
      pruneClosedTabsFromWindow(uniqueIds);

      const nextByTab = { ...bookmarkIdByTabIdRef.current };
      const nextBindings = { ...bindingsByBookmarkIdRef.current };
      const unboundBookmarkIds: string[] = [];
      let bindingsChanged = false;

      for (const id of uniqueIds) {
        const bId = nextByTab[id];
        if (bId) {
          unboundBookmarkIds.push(bId);
          delete nextByTab[id];
          delete nextBindings[bId];
          bindingsChanged = true;
        }
      }
      for (const [bId, binding] of Object.entries(nextBindings)) {
        if (closedSet.has(binding.tabId)) {
          unboundBookmarkIds.push(bId);
          delete nextBindings[bId];
          bindingsChanged = true;
        }
      }

      if (bindingsChanged) {
        bindingsByBookmarkIdRef.current = nextBindings;
        bookmarkIdByTabIdRef.current = nextByTab;
        setBindingsByBookmarkId(nextBindings);
        setBookmarkIdByTabId(nextByTab);
      }

      // 2. Execute Chrome tab removal & storage persistence asynchronously in the background
      try {
        if (mightCloseEntireWindow) {
          const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
          const isClosingAllInWindow =
            currentWindowTabs.length > 0 &&
            currentWindowTabs.every((t) => typeof t.id === 'number' && closedSet.has(t.id));
          if (isClosingAllInWindow) {
            creatingManualTabCountRef.current += 1;
            try {
              await chrome.tabs.create({ active: true });
            } finally {
              creatingManualTabCountRef.current -= 1;
            }
          }
        }
        if (uniqueIds.length === 1) {
          await chrome.tabs.remove(uniqueIds[0]);
        } else {
          await chrome.tabs.remove(uniqueIds);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err || '');
        if (!/no tab with id|tab .* not found/i.test(msg)) {
          console.warn('[Arctic] Could not remove tab:', err);
        }
      } finally {
        for (const id of uniqueIds) {
          closingTabIdsRef.current.delete(id);
        }
      }

      if (unboundBookmarkIds.length > 0) {
        await removePersistedBindings(unboundBookmarkIds);
      }
      if (bindingsChanged) {
        try {
          await chrome.storage.session.set({
            bindingsByBookmarkId: bindingsByBookmarkIdRef.current,
            bookmarkIdByTabId: bookmarkIdByTabIdRef.current
          });
          await upsertPersistedBindings(bindingsByBookmarkIdRef.current);
        } catch (err) {
          console.error('[Arctic] Error persisting session state:', err);
        }
      }
      await refreshWindowTabs();
    },
    [pruneClosedTabsFromWindow, refreshWindowTabs]
  );

  /**
   * Close a tab (If closing the last tab in the window, create a fresh tab first to keep the browser window & sidebar alive)
   */
  const handleCloseTab = useCallback(
    async (tabId: number, e?: React.MouseEvent) => {
      if (e) {
        e.stopPropagation();
      }
      await closeMultipleTabs([tabId]);
    },
    [closeMultipleTabs]
  );

  /**
   * Close all unpinned tabs in the current window (Clear / Archive action)
   */
  const closeAllUnpinnedTabs = useCallback(async () => {
    const tabIdsToClose = unpinnedTabs
      .map((t) => t.id)
      .filter((id): id is number => typeof id === 'number');

    if (tabIdsToClose.length === 0) return;

    // If closing all tabs in window, create a blank tab first to prevent window closure
    if (tabIdsToClose.length >= windowTabs.length) {
      creatingManualTabCountRef.current += 1;
      try {
        await chrome.tabs.create({ active: true });
      } finally {
        creatingManualTabCountRef.current -= 1;
      }
    }

    await chrome.tabs.remove(tabIdsToClose);
    pruneClosedTabsFromWindow(tabIdsToClose);
    await refreshWindowTabs();
  }, [unpinnedTabs, windowTabs.length, pruneClosedTabsFromWindow, refreshWindowTabs]);

  /**
   * Close all active tabs in the current window (Clear All action).
   * Creates a fresh tab first to keep the browser window & sidebar alive, then removes all existing tabs in this window
   * and clears only the bindings belonging to this window's closed tabs.
   */
  const closeAllWindowTabs = useCallback(async () => {
    const tabIdsToClose = windowTabsRef.current
      .map((t) => t.id)
      .filter((id): id is number => typeof id === 'number');

    if (tabIdsToClose.length === 0) return;

    try {
      creatingManualTabCountRef.current += 1;
      try {
        await chrome.tabs.create({ active: true });
      } finally {
        creatingManualTabCountRef.current -= 1;
      }
      await chrome.tabs.remove(tabIdsToClose);
    } catch (err) {
      console.warn('[Arctic] Could not close all window tabs:', err);
    }

    pruneClosedTabsFromWindow(tabIdsToClose);

    const closedTabSet = new Set<number>(tabIdsToClose);
    const nextByTab = { ...bookmarkIdByTabIdRef.current };
    const nextBindings = { ...bindingsByBookmarkIdRef.current };
    const bookmarkIdsToRemove: string[] = [];

    for (const tabId of closedTabSet) {
      const bId = nextByTab[tabId];
      if (bId) {
        bookmarkIdsToRemove.push(bId);
        delete nextBindings[bId];
      }
      delete nextByTab[tabId];
    }

    for (const [bId, binding] of Object.entries(nextBindings)) {
      if (closedTabSet.has(binding.tabId)) {
        bookmarkIdsToRemove.push(bId);
        delete nextBindings[bId];
      }
    }

    if (Object.keys(nextBindings).length === 0) {
      await clearAllPersistedBindings();
    } else if (bookmarkIdsToRemove.length > 0) {
      await removePersistedBindings(bookmarkIdsToRemove);
    }
    await persistSession(nextBindings, nextByTab);
    await refreshWindowTabs();
  }, [persistSession, pruneClosedTabsFromWindow, refreshWindowTabs]);

  /**
   * Close a specific list of unpinned tabs (e.g. from the active space)
   */
  const closeSpaceUnpinnedTabs = useCallback(
    async (tabIdsToClose: number[]) => {
      if (!tabIdsToClose.length) return;
      if (tabIdsToClose.length >= windowTabs.length) {
        creatingManualTabCountRef.current += 1;
        try {
          await chrome.tabs.create({ active: true });
        } finally {
          creatingManualTabCountRef.current -= 1;
        }
      }
      await chrome.tabs.remove(tabIdsToClose);
      pruneClosedTabsFromWindow(tabIdsToClose);
      await refreshWindowTabs();
    },
    [windowTabs.length, pruneClosedTabsFromWindow, refreshWindowTabs]
  );

  /**
   * Set space for an individual tab
   */
  const setTabSpace = useCallback(async (tabId: number, spaceId: string) => {
    setTabSpaceByTabId((prev) => {
      const next = { ...prev, [tabId]: spaceId };
      chrome.storage.local.set({ tabSpaceByTabId: next });
      return next;
    });
  }, []);

  /**
   * Move multiple tabs to a space
   */
  const moveTabsToSpace = useCallback(async (tabIds: number[], spaceId: string) => {
    setTabSpaceByTabId((prev) => {
      const next = { ...prev };
      for (const id of tabIds) {
        next[id] = spaceId;
      }
      chrome.storage.local.set({ tabSpaceByTabId: next });
      return next;
    });
  }, []);

  /**
   * Pin one or more unpinned tabs to a bookmark folder (Quick Access or Home/Space).
   * If a tab is already bound to a bookmark (e.g. in another space), moves that bookmark instead of duplicating it.
   */
  const pinMultipleTabs = useCallback(
    async (
      tabs: chrome.tabs.Tab[],
      targetFolderId: string,
      targetIndex?: number,
      onBeforeCommit?: (nodes: chrome.bookmarks.BookmarkTreeNode[]) => void
    ): Promise<chrome.bookmarks.BookmarkTreeNode[]> => {
      if (!tabs.length || !targetFolderId) return [];

      let storedBindings: Record<string, TabBinding> = {};
      let storedByTab: Record<number, string> = {};
      try {
        const session = await chrome.storage.session.get(['bindingsByBookmarkId', 'bookmarkIdByTabId']);
        storedBindings = (session.bindingsByBookmarkId as Record<string, TabBinding>) || {};
        storedByTab = (session.bookmarkIdByTabId as Record<number, string>) || {};
      } catch {
        // ignore
      }

      const nextBindings: Record<string, TabBinding> = {
        ...storedBindings,
        ...bindingsByBookmarkIdRef.current
      };
      const nextByTab: Record<number, string> = {
        ...storedByTab,
        ...bookmarkIdByTabIdRef.current
      };

      // Clean out any bookmarks that were previously unpinned/deleted
      for (const bId of unpinnedBookmarkIdsRef.current) {
        delete nextBindings[bId];
      }
      for (const [tIdStr, bId] of Object.entries(nextByTab)) {
        if (unpinnedBookmarkIdsRef.current.has(bId)) {
          delete nextByTab[Number(tIdStr)];
        }
      }

      let childCount: number | null = null;
      const existingChildIds = new Set<string>();
      if (typeof targetIndex === 'number' && chrome?.bookmarks?.getChildren) {
        try {
          const children = await chrome.bookmarks.getChildren(targetFolderId);
          childCount = children.length;
          for (const c of children) {
            existingChildIds.add(c.id);
          }
        } catch {
          childCount = null;
        }
      }

      const createdOrMovedNodes: chrome.bookmarks.BookmarkTreeNode[] = [];
      let curIndex = targetIndex;
      let unpinnedChanged = false;
      for (const tab of tabs) {
        const tabUrl = getEffectiveTabUrl(tab);
        if (typeof tab.id !== 'number' || !tabUrl) continue;
        if (unpinnedTabIdsRef.current.delete(tab.id)) {
          unpinnedChanged = true;
        }
        void captureVerifiedTabFavicon(tab, tabUrl);

        const existingBookmarkId = nextByTab[tab.id];
        if (existingBookmarkId) {
          try {
            const shouldPassIndex =
              typeof curIndex === 'number' && (childCount === null || curIndex < childCount);
            const movedNode = await chrome.bookmarks.move(existingBookmarkId, {
              parentId: targetFolderId,
              ...(shouldPassIndex ? { index: Math.max(0, curIndex!) } : {})
            });
            if (movedNode) {
              createdOrMovedNodes.push(movedNode);
            }
            if (!existingChildIds.has(existingBookmarkId) && childCount !== null) {
              childCount += 1;
              existingChildIds.add(existingBookmarkId);
            }
            if (typeof curIndex === 'number') curIndex += 1;
            continue;
          } catch {
            delete nextBindings[existingBookmarkId];
            delete nextByTab[tab.id];
          }
        }

        const title = tab.title || tabUrl || 'Pinned Tab';
        const shouldPassIndex =
          typeof curIndex === 'number' && (childCount === null || curIndex < childCount);
        const newBookmark = await chrome.bookmarks.create({
          parentId: targetFolderId,
          title,
          url: tabUrl,
          ...(shouldPassIndex ? { index: Math.max(0, curIndex!) } : {})
        });
        createdOrMovedNodes.push(newBookmark);
        if (childCount !== null) {
          childCount += 1;
          existingChildIds.add(newBookmark.id);
        }
        if (typeof curIndex === 'number') curIndex += 1;

        const newBinding: TabBinding = {
          bookmarkId: newBookmark.id,
          tabId: tab.id,
          windowId: tab.windowId,
          originalUrl: tabUrl,
          currentUrl: tabUrl,
          currentTitle: title,
          isNavigatedAway: false
        };

        nextBindings[newBookmark.id] = newBinding;
        nextByTab[tab.id] = newBookmark.id;
      }

      if (unpinnedChanged) {
        void syncUnpinnedTabIdsSession();
      }
      if (onBeforeCommit && createdOrMovedNodes.length > 0) {
        onBeforeCommit(createdOrMovedNodes);
      }
      await persistSession(nextBindings, nextByTab);
      await refreshWindowTabs();
      return createdOrMovedNodes;
    },
    [persistSession, refreshWindowTabs, syncUnpinnedTabIdsSession]
  );

  /**
   * Pin an unpinned tab to a bookmark folder (Quick Access or Home/Space)
   */
  const pinTab = useCallback(
    async (
      tab: chrome.tabs.Tab,
      targetFolderId: string,
      targetIndex?: number,
      onBeforeCommit?: (nodes: chrome.bookmarks.BookmarkTreeNode[]) => void
    ) => {
      return pinMultipleTabs([tab], targetFolderId, targetIndex, onBeforeCommit);
    },
    [pinMultipleTabs]
  );

  /**
   * Unpin a bookmark so its open tab (or a newly opened tab if not currently open)
   * moves cleanly into Today's Tabs for the active space and is never auto-rebound.
   */
  const unpinBookmarkTab = useCallback(
    async (bookmark: chrome.bookmarks.BookmarkTreeNode, spaceId?: string) => {
      const targetSpace = spaceId || currentActiveSpaceIdRef.current || 'home';
      unpinnedBookmarkIdsRef.current.add(bookmark.id);

      const nextBindings = { ...bindingsByBookmarkIdRef.current };
      const nextByTab = { ...bookmarkIdByTabIdRef.current };
      const binding = nextBindings[bookmark.id];
      const targetTabId = binding?.tabId ?? null;

      delete nextBindings[bookmark.id];
      if (typeof targetTabId === 'number') {
        delete nextByTab[targetTabId];
      }
      for (const [tIdStr, bId] of Object.entries(nextByTab)) {
        if (bId === bookmark.id) {
          delete nextByTab[Number(tIdStr)];
        }
      }

      await removePersistedBindings([bookmark.id]);
      await persistSession(nextBindings, nextByTab);

      if (typeof targetTabId === 'number') {
        unpinnedTabIdsRef.current.add(targetTabId);
        void syncUnpinnedTabIdsSession();
        setTabSpaceByTabId((prev) => {
          const next = { ...prev, [targetTabId]: targetSpace };
          chrome.storage.local.set({ tabSpaceByTabId: next });
          return next;
        });
      } else if (bookmark.url) {
        creatingManualTabCountRef.current += 1;
        let newTab: chrome.tabs.Tab;
        try {
          newTab = await chrome.tabs.create({ url: bookmark.url, active: true });
        } finally {
          creatingManualTabCountRef.current -= 1;
        }
        if (typeof newTab.id === 'number') {
          unpinnedTabIdsRef.current.add(newTab.id);
          tabsAwaitingRestoreUrlRef.current.delete(newTab.id);
          void syncUnpinnedTabIdsSession();
          setActiveTabId(newTab.id);
          setTabSpaceByTabId((prev) => {
            const next = { ...prev, [newTab.id!]: targetSpace };
            chrome.storage.local.set({ tabSpaceByTabId: next });
            return next;
          });
        }
      }

      await refreshWindowTabs();
    },
    [persistSession, refreshWindowTabs, syncUnpinnedTabIdsSession]
  );

  /**
   * Duplicate a tab into Temporary Tabs without auto-reconciling it to any unopened bookmark
   */
  const duplicateTab = useCallback(
    async (tabId: number) => {
      const targetSpace = currentActiveSpaceIdRef.current || 'home';
      creatingManualTabCountRef.current += 1;
      let duplicatedTab: chrome.tabs.Tab | undefined;
      try {
        duplicatedTab = await chrome.tabs.duplicate(tabId);
      } catch (err) {
        const boundBmId = bookmarkIdByTabIdRef.current[tabId];
        const fallbackBinding = boundBmId ? bindingsByBookmarkIdRef.current[boundBmId] : undefined;
        const fallbackUrl =
          fallbackBinding?.currentUrl ||
          fallbackBinding?.originalUrl ||
          windowTabsRef.current.find((t) => t.id === tabId)?.url;
        if (fallbackUrl) {
          try {
            duplicatedTab = await chrome.tabs.create({ url: fallbackUrl, active: true });
          } catch {
            // ignore
          }
        } else if (!isExpectedTabNavigationError(err)) {
          console.warn('[Arctic] Could not duplicate tab:', err);
        }
      } finally {
        creatingManualTabCountRef.current -= 1;
      }

      if (duplicatedTab && typeof duplicatedTab.id === 'number') {
        const dupId = duplicatedTab.id;
        unpinnedTabIdsRef.current.add(dupId);
        tabsAwaitingRestoreUrlRef.current.delete(dupId);
        void syncUnpinnedTabIdsSession();
        if (duplicatedTab.active) {
          setActiveTabId(dupId);
        }
        setTabSpaceByTabId((prev) => {
          const next = { ...prev, [dupId]: targetSpace };
          chrome.storage.local.set({ tabSpaceByTabId: next });
          return next;
        });
      }

      await refreshWindowTabs();
    },
    [refreshWindowTabs, syncUnpinnedTabIdsSession]
  );

  /**
   * Reload a tab
   */
  const reloadTab = useCallback(
    async (tabId: number, bypassCache: boolean = false) => {
      const targetTab = windowTabsRef.current.find((t) => t.id === tabId);
      const tabUrl = getEffectiveTabUrl(targetTab) || targetTab?.url || '';
      const isLocalFile = isFileUrl(tabUrl);
      const effectiveBypassCache = bypassCache || isLocalFile;

      const nextFavRev = (faviconRevByTabIdRef.current[tabId] || 0) + 1;
      faviconRevByTabIdRef.current[tabId] = nextFavRev;
      setWindowTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? ({ ...t, status: 'loading', _faviconRev: nextFavRev } as TabWithFaviconMeta)
            : t
        )
      );

      try {
        await chrome.tabs.reload(tabId, { bypassCache: effectiveBypassCache });
      } catch (err) {
        if (isLocalFile && tabUrl) {
          try {
            await chrome.tabs.update(tabId, { url: tabUrl });
            return;
          } catch (fallbackErr) {
            const notified = await checkAndNotifyFileAccessNeeded(fallbackErr);
            if (!notified && !isExpectedTabNavigationError(fallbackErr)) {
              console.warn('[Arctic] Could not reload local file tab:', fallbackErr);
            }
            await refreshWindowTabs();
            return;
          }
        }
        if (!isExpectedTabNavigationError(err)) {
          console.warn('[Arctic] Could not reload tab:', err);
        }
        await refreshWindowTabs();
      }
    },
    [checkAndNotifyFileAccessNeeded, refreshWindowTabs]
  );

  /**
   * Reload currently active tab
   */
  const reloadActiveTab = useCallback(
    async (bypassCache: boolean = false) => {
      let targetTabId = activeTabId;
      let targetTab =
        typeof targetTabId === 'number'
          ? windowTabsRef.current.find((t) => t.id === targetTabId)
          : undefined;

      if (typeof targetTabId !== 'number') {
        try {
          const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (currentTab?.id) {
            targetTabId = currentTab.id;
            targetTab = currentTab;
          }
        } catch (err) {
          console.warn('[Arctic] Could not query and reload tab:', err);
          return;
        }
      }

      if (typeof targetTabId !== 'number') return;

      const tabUrl = getEffectiveTabUrl(targetTab) || targetTab?.url || '';
      const isLocalFile = isFileUrl(tabUrl);
      const effectiveBypassCache = bypassCache || isLocalFile;

      try {
        await chrome.tabs.reload(targetTabId, { bypassCache: effectiveBypassCache });
      } catch (err) {
        if (isLocalFile && tabUrl) {
          try {
            await chrome.tabs.update(targetTabId, { url: tabUrl });
            return;
          } catch (fallbackErr) {
            const notified = await checkAndNotifyFileAccessNeeded(fallbackErr);
            if (!notified && !isExpectedTabNavigationError(fallbackErr)) {
              console.warn('[Arctic] Could not reload active local file tab:', fallbackErr);
            }
            return;
          }
        }
        if (!isExpectedTabNavigationError(err)) {
          console.warn('[Arctic] Could not reload active tab:', err);
        }
      }
    },
    [activeTabId, checkAndNotifyFileAccessNeeded]
  );

  /**
   * Move / reorder one or more open tabs within window using pre-removal visual slot index
   */
  const moveOpenTabs = useCallback(
    async (tabIds: number[], targetSlotIndex: number) => {
      if (!tabIds.length) return;
      const currentTabs = windowTabsRef.current;

      if (currentTabs.length === 0) {
        try {
          for (let i = 0; i < tabIds.length; i++) {
            await chrome.tabs.move(tabIds[i], { index: Math.max(0, targetSlotIndex + i) });
          }
          await refreshWindowTabs();
        } catch (err) {
          console.warn('[Arctic] Could not move tabs:', err);
        }
        return;
      }

      const idSet = new Set(tabIds);
      const orderedIds = currentTabs
        .map((t) => t.id)
        .filter((id): id is number => typeof id === 'number' && idSet.has(id));
      const targetIds = orderedIds.length > 0 ? orderedIds : tabIds;

      const workingTabs = [...currentTabs];
      const movesToExecute: Array<{ tabId: number; postRemovalIndex: number }> = [];
      let curSlot = targetSlotIndex;

      for (const tabId of targetIds) {
        const oldIdx = workingTabs.findIndex((t) => t.id === tabId);
        if (oldIdx === -1) continue;

        const clampedSlot = Math.max(0, Math.min(curSlot, workingTabs.length));
        if (clampedSlot === oldIdx || clampedSlot === oldIdx + 1) {
          curSlot = oldIdx + 1;
          continue;
        }

        const postRemovalIndex = oldIdx < clampedSlot ? clampedSlot - 1 : clampedSlot;
        const [movedTab] = workingTabs.splice(oldIdx, 1);
        workingTabs.splice(postRemovalIndex, 0, movedTab);
        movesToExecute.push({ tabId, postRemovalIndex });
        curSlot = oldIdx < clampedSlot ? clampedSlot : clampedSlot + 1;
      }

      if (movesToExecute.length === 0) return;

      const reindexedTabs = workingTabs.map((t, idx) => ({ ...t, index: idx }));
      setWindowTabs(reindexedTabs);
      markRecentlyMoved(movesToExecute.map((m) => `tab-${m.tabId}`));

      try {
        for (const step of movesToExecute) {
          await chrome.tabs.move(step.tabId, { index: step.postRemovalIndex });
        }
        await refreshWindowTabs();
      } catch (err) {
        console.warn('[Arctic] Could not move tab:', err);
        await refreshWindowTabs();
      }
    },
    [refreshWindowTabs]
  );

  /**
   * Move / reorder single open tab within window
   */
  const moveOpenTab = useCallback(
    async (tabId: number, targetIndex: number) => {
      await moveOpenTabs([tabId], targetIndex);
    },
    [moveOpenTabs]
  );

  /**
   * Hibernate / Discard a background tab to save memory
   */
  const discardTab = useCallback(
    async (tabId: number) => {
      try {
        const discardedTab = await chrome.tabs.discard(tabId);
        if (discardedTab && typeof discardedTab.id === 'number' && discardedTab.id !== tabId) {
          migrateReplacedTabId(discardedTab.id, tabId);
        }
        await refreshWindowTabs();
      } catch (err) {
        console.warn('[Arctic] Could not discard tab:', err);
      }
    },
    [migrateReplacedTabId, refreshWindowTabs]
  );

  /**
   * Hibernate all background tabs in current window
   */
  const discardAllBackgroundTabs = useCallback(async () => {
    let count = 0;
    try {
      const currentTabs = await chrome.tabs.query({ currentWindow: true });
      for (const tab of currentTabs) {
        if (typeof tab.id === 'number' && !tab.active && !tab.discarded) {
          try {
            const discardedTab = await chrome.tabs.discard(tab.id);
            if (discardedTab && typeof discardedTab.id === 'number' && discardedTab.id !== tab.id) {
              migrateReplacedTabId(discardedTab.id, tab.id);
            }
            count++;
          } catch {
            // ignore tabs that cannot be discarded
          }
        }
      }
    } catch (err) {
      console.warn('[Arctic] Could not query tabs to discard:', err);
    }
    await refreshWindowTabs();
    return count;
  }, [migrateReplacedTabId, refreshWindowTabs]);

  const activeTab = windowTabs.find((t) => t.id === activeTabId);
  const isActiveTabLoading = activeTab?.status === 'loading';
  const activeTabUrl = getEffectiveTabUrl(activeTab) || activeTab?.url || '';
  const activeTabTitle = activeTab?.title || '';

  const navigateActiveTab = useCallback(
    async (rawInput: string) => {
      const trimmed = rawInput.trim();
      if (!trimmed) return;

      const resolvedUrl = normalizeNavigationInput(trimmed);

      if (resolvedUrl) {
        const isLocalFile = isFileUrl(resolvedUrl);
        if (typeof activeTabId === 'number') {
          const currentTab = windowTabsRef.current.find((t) => t.id === activeTabId);
          const currentUrl = getEffectiveTabUrl(currentTab) || currentTab?.url || '';
          const isSameExactUrl = Boolean(currentUrl) && currentUrl === resolvedUrl;

          if (isSameExactUrl) {
            await reloadTab(activeTabId, isLocalFile);
            return;
          }

          try {
            await chrome.tabs.update(activeTabId, { url: resolvedUrl, active: true });
            if (hasTextFragment(resolvedUrl)) {
              void scrollToHighlightInTab(activeTabId, resolvedUrl);
            }
          } catch (err) {
            const notified = isLocalFile ? await checkAndNotifyFileAccessNeeded(err) : false;
            if (!notified && !isExpectedTabNavigationError(err)) {
              console.warn('[Arctic] Could not navigate active tab:', err);
            }
          }
        } else {
          try {
            const created = await chrome.tabs.create({ url: resolvedUrl, active: true });
            if (typeof created?.id === 'number' && hasTextFragment(resolvedUrl)) {
              void scrollToHighlightInTab(created.id, resolvedUrl);
            }
          } catch (err) {
            const notified = isLocalFile ? await checkAndNotifyFileAccessNeeded(err) : false;
            if (!notified && !isExpectedTabNavigationError(err)) {
              console.warn('[Arctic] Could not open URL in new tab:', err);
            }
          }
        }
      } else if (typeof chrome !== 'undefined' && typeof chrome.search?.query === 'function') {
        try {
          if (typeof activeTabId === 'number') {
            await chrome.search.query({ text: trimmed, tabId: activeTabId });
          } else {
            await chrome.search.query({ text: trimmed, disposition: 'NEW_TAB' });
          }
        } catch {
          const fallbackSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
          if (typeof activeTabId === 'number') {
            await chrome.tabs.update(activeTabId, { url: fallbackSearchUrl, active: true });
          } else {
            await chrome.tabs.create({ url: fallbackSearchUrl, active: true });
          }
        }
      } else {
        const fallbackSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
        if (typeof activeTabId === 'number') {
          await chrome.tabs.update(activeTabId, { url: fallbackSearchUrl, active: true });
        } else {
          await chrome.tabs.create({ url: fallbackSearchUrl, active: true });
        }
      }
      await refreshWindowTabs();
    },
    [activeTabId, checkAndNotifyFileAccessNeeded, refreshWindowTabs, reloadTab]
  );

  /**
   * Navigate active tab backward in history
   */
  const goBackActiveTab = useCallback(async () => {
    if (typeof activeTabId === 'number') {
      try {
        await chrome.tabs.goBack(activeTabId);
      } catch (err) {
        if (!isExpectedTabNavigationError(err)) {
          console.warn('[Arctic] Could not go back in active tab:', err);
        }
      }
    }
  }, [activeTabId]);

  // Map of discarded tabs by tabId
  const discardedTabsByTabId = useMemo(
    () =>
      windowTabs.reduce<Record<number, boolean>>((acc, tab) => {
        if (typeof tab.id === 'number' && tab.discarded) {
          acc[tab.id] = true;
        }
        return acc;
      }, {}),
    [windowTabs]
  );

  /**
   * Toggle audio mute on a tab (by tab object or tabId)
   */
  const toggleMuteTab = useCallback(
    async (tabOrId: chrome.tabs.Tab | number) => {
      try {
        if (typeof tabOrId === 'number') {
          const existing =
            windowTabsRef.current.find((t) => t.id === tabOrId) ||
            (await chrome.tabs.get(tabOrId));
          if (!existing || typeof existing.id !== 'number') return;
          const isMuted = Boolean(existing.mutedInfo?.muted);
          await chrome.tabs.update(existing.id, { muted: !isMuted });
        } else {
          if (typeof tabOrId.id !== 'number') return;
          const isMuted = Boolean(tabOrId.mutedInfo?.muted);
          await chrome.tabs.update(tabOrId.id, { muted: !isMuted });
        }
        await refreshWindowTabs();
      } catch (err) {
        console.warn('[Arctic] Could not toggle mute on tab:', err);
      }
    },
    [refreshWindowTabs]
  );

  /**
   * Update auto-archive interval setting
   */
  const setAutoArchiveInterval = useCallback(
    async (interval: 'never' | '12h' | '24h' | '7d') => {
      setAutoArchiveIntervalState(interval);
      await chrome.storage.local.set({ autoArchiveInterval: interval } as LocalSettings);
    },
    []
  );

  /**
   * Row Body Click Handler for Bookmarks
   */
  const handleRowClick = useCallback(
    async (bookmark: chrome.bookmarks.BookmarkTreeNode) => {
      if (!bookmark.url) return;
      blurSidebarActiveElementIfPointer();

      const latestBindings: Record<string, TabBinding> = {
        ...bindingsByBookmarkIdRef.current
      };
      const latestByTab: Record<number, string> = {
        ...bookmarkIdByTabIdRef.current
      };

      if (!latestBindings[bookmark.id] && chrome.storage?.session?.get) {
        try {
          const session = await chrome.storage.session.get([
            'bindingsByBookmarkId',
            'bookmarkIdByTabId'
          ]);
          const sessionBindings =
            (session.bindingsByBookmarkId as Record<string, TabBinding>) || {};
          const sessionByTab =
            (session.bookmarkIdByTabId as Record<number, string>) || {};
          for (const [bId, bVal] of Object.entries(sessionBindings)) {
            if (
              bVal &&
              typeof bVal.tabId === 'number' &&
              !unpinnedBookmarkIdsRef.current.has(bId) &&
              !unpinnedTabIdsRef.current.has(bVal.tabId) &&
              !latestBindings[bId]
            ) {
              latestBindings[bId] = bVal;
            }
          }
          for (const [tIdStr, bId] of Object.entries(sessionByTab)) {
            const tId = Number(tIdStr);
            if (
              !unpinnedBookmarkIdsRef.current.has(bId) &&
              !unpinnedTabIdsRef.current.has(tId) &&
              !latestByTab[tId]
            ) {
              latestByTab[tId] = bId;
            }
          }
        } catch {
          // ignore
        }
      }

      const existingBinding = latestBindings[bookmark.id];

      // If already bound, verify if the tab is still alive
      if (existingBinding) {
        try {
          const tab = await chrome.tabs.get(existingBinding.tabId);
          if (tab) {
            await chrome.tabs.update(existingBinding.tabId, { active: true });
            if (tab.windowId) {
              try {
                await chrome.windows.update(tab.windowId, { focused: true });
              } catch {
                // Ignore window focus errors so we never fall through to creating a duplicate tab
              }
            }
            setActiveTabId(existingBinding.tabId);
            void focusActiveMediaOrPageInTab(
              existingBinding.tabId,
              getEffectiveTabUrl(tab) || existingBinding.currentUrl || bookmark.url
            );
            if (hasTextFragment(bookmark.url)) {
              void scrollToHighlightInTab(existingBinding.tabId, bookmark.url);
            }
            return;
          }
        } catch {
          // Tab was closed; clean up dead binding before falling through
          delete latestByTab[existingBinding.tabId];
          delete latestBindings[bookmark.id];
        }
      }

      // Check open tabs (preferring current window first) for an unbound sleeping/redirected/matching tab
      const [allTabs, persistedBindings] = await Promise.all([
        chrome.tabs.query({}),
        getPersistedBindings()
      ]);

      const preferredWinId = currentWindowIdRef.current;
      const orderedTabs =
        typeof preferredWinId === 'number'
          ? [
              ...allTabs.filter((t) => t.windowId === preferredWinId),
              ...allTabs.filter((t) => t.windowId !== preferredWinId)
            ]
          : allTabs;

      const unboundMatch = findMatchingUnboundTabForBookmark({
        bookmark: { id: bookmark.id, url: bookmark.url },
        tabs: orderedTabs,
        boundTabIds: latestByTab,
        persistedBindings,
        excludedTabIds: unpinnedTabIdsRef.current
      });

      if (unboundMatch && typeof unboundMatch.id === 'number') {
        const tabId = unboundMatch.id;
        unpinnedTabIdsRef.current.delete(tabId);
        unpinnedBookmarkIdsRef.current.delete(bookmark.id);
        const matchUrl = getEffectiveTabUrl(unboundMatch) || bookmark.url;
        const newBinding: TabBinding = {
          bookmarkId: bookmark.id,
          tabId,
          windowId: unboundMatch.windowId,
          originalUrl: bookmark.url,
          currentUrl: matchUrl,
          currentTitle: unboundMatch.title || bookmark.title || '',
          isNavigatedAway: isUrlNavigatedAway(matchUrl, bookmark.url)
        };

        const newBindings = { ...latestBindings, [bookmark.id]: newBinding };
        const newByTab = { ...latestByTab, [tabId]: bookmark.id };

        await persistSession(newBindings, newByTab);
        await chrome.tabs.update(tabId, { active: true });
        if (unboundMatch.windowId) {
          try {
            await chrome.windows.update(unboundMatch.windowId, { focused: true });
          } catch {
            // ignore
          }
        }
        setActiveTabId(tabId);
        void focusActiveMediaOrPageInTab(tabId, matchUrl);
        if (hasTextFragment(bookmark.url)) {
          void scrollToHighlightInTab(tabId, bookmark.url);
        }
        await refreshWindowTabs();
        return;
      }

      // If this is a Highlight Bookmark (`#:~:text=...`) and another bookmark on the same base page
      // already has an open tab in the window, reuse that open tab and jump directly to this highlight
      if (hasTextFragment(bookmark.url)) {
        const sharedPageTab = orderedTabs.find(
          (t) =>
            typeof t.id === 'number' &&
            !unpinnedTabIdsRef.current.has(t.id) &&
            !isArcticCommandTab(t) &&
            doesTabUrlMatchBookmark(getEffectiveTabUrl(t), bookmark.url!)
        );
        if (sharedPageTab && typeof sharedPageTab.id === 'number') {
          const tabId = sharedPageTab.id;
          const prevBoundBmId = latestByTab[tabId];
          const newBindings = { ...latestBindings };
          if (prevBoundBmId && prevBoundBmId !== bookmark.id) {
            delete newBindings[prevBoundBmId];
          }
          const matchUrl = getEffectiveTabUrl(sharedPageTab) || bookmark.url;
          const newBinding: TabBinding = {
            bookmarkId: bookmark.id,
            tabId,
            windowId: sharedPageTab.windowId,
            originalUrl: bookmark.url,
            currentUrl: matchUrl,
            currentTitle: sharedPageTab.title || bookmark.title || '',
            isNavigatedAway: false
          };
          newBindings[bookmark.id] = newBinding;
          const newByTab = { ...latestByTab, [tabId]: bookmark.id };

          await persistSession(newBindings, newByTab);
          await chrome.tabs.update(tabId, { active: true });
          if (sharedPageTab.windowId) {
            try {
              await chrome.windows.update(sharedPageTab.windowId, { focused: true });
            } catch {
              // ignore
            }
          }
          setActiveTabId(tabId);
          void focusActiveMediaOrPageInTab(tabId, matchUrl);
          void scrollToHighlightInTab(tabId, bookmark.url);
          await refreshWindowTabs();
          return;
        }
      }

      // Otherwise, open a new tab and bind it
      creatingManualTabCountRef.current += 1;
      let createdTab: chrome.tabs.Tab;
      try {
        createdTab = await chrome.tabs.create({
          url: bookmark.url,
          active: true
        });
      } catch (err) {
        console.warn('[Arctic] Could not open bookmark URL:', err);
        if (isFileUrl(bookmark.url)) {
          await checkAndNotifyFileAccessNeeded(err);
        }
        return;
      } finally {
        creatingManualTabCountRef.current -= 1;
      }

      if (typeof createdTab.id === 'number') {
        const tabId = createdTab.id;
        unpinnedTabIdsRef.current.delete(tabId);
        unpinnedBookmarkIdsRef.current.delete(bookmark.id);
        const newBinding: TabBinding = {
          bookmarkId: bookmark.id,
          tabId,
          windowId: createdTab.windowId,
          originalUrl: bookmark.url,
          currentUrl: bookmark.url,
          currentTitle: bookmark.title || '',
          isNavigatedAway: false
        };

        const newBindings = { ...latestBindings, [bookmark.id]: newBinding };
        const newByTab = { ...latestByTab, [tabId]: bookmark.id };

        await persistSession(newBindings, newByTab);
        setActiveTabId(tabId);
        void focusActiveMediaOrPageInTab(tabId, bookmark.url);
        await refreshWindowTabs();
      }
    },
    [checkAndNotifyFileAccessNeeded, persistSession, refreshWindowTabs]
  );

  /**
   * Favicon Click Handler for Bookmarks
   */
  const handleFaviconClick = useCallback(
    async (bookmark: chrome.bookmarks.BookmarkTreeNode, e?: React.MouseEvent) => {
      if (e) {
        e.stopPropagation();
      }
      if (!bookmark.url) return;
      blurSidebarActiveElementIfPointer();

      const existingBinding = bindingsByBookmarkIdRef.current[bookmark.id];

      if (existingBinding) {
        let tab: chrome.tabs.Tab | undefined;
        try {
          tab = await chrome.tabs.get(existingBinding.tabId);
        } catch {
          // Tab dead, fall through to handleRowClick
          tab = undefined;
        }

        if (tab) {
          const liveUrl = getEffectiveTabUrl(tab) || existingBinding.currentUrl || '';
          const isLocalFile = isFileUrl(bookmark.url) || isFileUrl(liveUrl);
          const needsUrlReset =
            existingBinding.isNavigatedAway ||
            isUrlNavigatedAway(liveUrl, bookmark.url) ||
            (isLocalFile && Boolean(liveUrl) && liveUrl !== bookmark.url);

          if (needsUrlReset) {
            if (hasRecentTabReset(existingBinding.tabId, bookmark.url)) {
              return;
            }
            markRecentTabReset(existingBinding.tabId, bookmark.url);
            try {
              await chrome.tabs.update(existingBinding.tabId, {
                url: bookmark.url,
                active: true
              });
              // Hash-only difference on a local file won't re-read from disk on tabs.update
              if (
                isLocalFile &&
                liveUrl !== bookmark.url &&
                normalizeUrl(liveUrl) === normalizeUrl(bookmark.url)
              ) {
                await chrome.tabs.reload(existingBinding.tabId, { bypassCache: true });
              }
            } catch (err) {
              recentTabResetRef.current.delete(existingBinding.tabId);
              const notified = isLocalFile ? await checkAndNotifyFileAccessNeeded(err) : false;
              if (!notified && !isExpectedTabNavigationError(err)) {
                console.warn('[Arctic] Could not reset tab URL:', err);
              }
              try {
                await chrome.tabs.update(existingBinding.tabId, { active: true });
              } catch {
                // ignore
              }
              return;
            }

            if (tab.windowId) {
              try {
                await chrome.windows.update(tab.windowId, { focused: true });
              } catch {
                // ignore
              }
            }

            const updatedBinding: TabBinding = {
              ...existingBinding,
              currentUrl: bookmark.url,
              isNavigatedAway: false
            };
            const nextBindings = {
              ...bindingsByBookmarkIdRef.current,
              [bookmark.id]: updatedBinding
            };
            const nextByTab = {
              ...bookmarkIdByTabIdRef.current
            };
            await persistSession(nextBindings, nextByTab);
            setActiveTabId(existingBinding.tabId);
            void focusActiveMediaOrPageInTab(existingBinding.tabId, bookmark.url);
            await refreshWindowTabs();
            return;
          }
        }
      }

      await handleRowClick(bookmark);
    },
    [
      checkAndNotifyFileAccessNeeded,
      handleRowClick,
      hasRecentTabReset,
      markRecentTabReset,
      persistSession,
      refreshWindowTabs
    ]
  );

  /**
   * Quick Access Grid Tile Click
   */
  const handleQuickAccessClick = useCallback(
    async (bookmark: chrome.bookmarks.BookmarkTreeNode) => {
      if (!bookmark.url) return;
      blurSidebarActiveElementIfPointer();
      const binding = bindingsByBookmarkIdRef.current[bookmark.id];

      if (binding && binding.tabId === activeTabId) {
        const liveTab = windowTabsRef.current.find((t) => t.id === binding.tabId);
        const liveUrl = getEffectiveTabUrl(liveTab) || binding.currentUrl || '';
        const isLocalFile = isFileUrl(bookmark.url) || isFileUrl(liveUrl);
        const needsUrlReset =
          binding.isNavigatedAway ||
          isUrlNavigatedAway(liveUrl, bookmark.url) ||
          (isLocalFile && Boolean(liveUrl) && liveUrl !== bookmark.url);

        if (needsUrlReset) {
          if (hasRecentTabReset(binding.tabId, bookmark.url)) {
            return;
          }
          markRecentTabReset(binding.tabId, bookmark.url);
          try {
            await chrome.tabs.update(binding.tabId, { url: bookmark.url, active: true });
            if (
              isLocalFile &&
              liveUrl !== bookmark.url &&
              normalizeUrl(liveUrl) === normalizeUrl(bookmark.url)
            ) {
              await chrome.tabs.reload(binding.tabId, { bypassCache: true });
            }
          } catch (err) {
            recentTabResetRef.current.delete(binding.tabId);
            const notified = isLocalFile ? await checkAndNotifyFileAccessNeeded(err) : false;
            if (!notified && !isExpectedTabNavigationError(err)) {
              console.warn('[Arctic] Could not reset Quick Access tab URL:', err);
            }
            return;
          }
          const updatedBinding: TabBinding = {
            ...binding,
            currentUrl: bookmark.url,
            isNavigatedAway: false
          };
          const nextBindings = {
            ...bindingsByBookmarkIdRef.current,
            [bookmark.id]: updatedBinding
          };
          const nextByTab = {
            ...bookmarkIdByTabIdRef.current
          };
          await persistSession(nextBindings, nextByTab);
          void focusActiveMediaOrPageInTab(binding.tabId, bookmark.url);
          await refreshWindowTabs();
          return;
        }
      }

      await handleRowClick(bookmark);
    },
    [
      activeTabId,
      checkAndNotifyFileAccessNeeded,
      handleRowClick,
      hasRecentTabReset,
      markRecentTabReset,
      persistSession,
      refreshWindowTabs
    ]
  );

  /**
   * Double click favicon/icon: reload the actual bookmarked page (not current navigated page)
   */
  const handleFaviconDoubleClick = useCallback(
    async (bookmark: chrome.bookmarks.BookmarkTreeNode, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      if (!bookmark.url) return;
      blurSidebarActiveElementIfPointer();

      const existingBinding = bindingsByBookmarkIdRef.current[bookmark.id];
      if (existingBinding) {
        let tab: chrome.tabs.Tab | undefined;
        try {
          tab = await chrome.tabs.get(existingBinding.tabId);
        } catch {
          // Tab dead, fall through to handleRowClick
          tab = undefined;
        }

        if (tab) {
          const liveUrl = getEffectiveTabUrl(tab) || existingBinding.currentUrl || '';
          const isLocalFile = isFileUrl(bookmark.url) || isFileUrl(liveUrl);
          const needsUrlReset =
            existingBinding.isNavigatedAway ||
            isUrlNavigatedAway(liveUrl, bookmark.url) ||
            (isLocalFile && Boolean(liveUrl) && liveUrl !== bookmark.url);

          // If the first click of this double-click just initiated an identical reset navigation,
          // let that navigation finish instead of firing a competing chrome.tabs.update that aborts it.
          if (needsUrlReset && hasRecentTabReset(existingBinding.tabId, bookmark.url)) {
            return;
          }

          // Set optimistic loading state BEFORE awaiting reload/update so fast local HTML files
          // finishing before the promise resolves do not get stuck in 'loading'.
          const nextFavRev = (faviconRevByTabIdRef.current[existingBinding.tabId] || 0) + 1;
          faviconRevByTabIdRef.current[existingBinding.tabId] = nextFavRev;
          setWindowTabs((prev) =>
            prev.map((t) =>
              t.id === existingBinding.tabId
                ? ({ ...t, status: 'loading', _faviconRev: nextFavRev } as TabWithFaviconMeta)
                : t
            )
          );

          try {
            if (needsUrlReset) {
              markRecentTabReset(existingBinding.tabId, bookmark.url);
              // Force navigate to original bookmark URL
              await chrome.tabs.update(existingBinding.tabId, {
                url: bookmark.url,
                active: true
              });
              if (
                isLocalFile &&
                liveUrl !== bookmark.url &&
                normalizeUrl(liveUrl) === normalizeUrl(bookmark.url)
              ) {
                await chrome.tabs.reload(existingBinding.tabId, { bypassCache: true });
              }
            } else {
              if (!tab.active) {
                await chrome.tabs.update(existingBinding.tabId, { active: true });
              }
              if (isLocalFile) {
                try {
                  await chrome.tabs.reload(existingBinding.tabId, { bypassCache: true });
                } catch (reloadErr) {
                  await chrome.tabs.update(existingBinding.tabId, {
                    url: bookmark.url,
                    active: true
                  });
                  void reloadErr;
                }
              } else {
                await chrome.tabs.reload(existingBinding.tabId);
              }
            }
          } catch (err) {
            if (needsUrlReset) {
              recentTabResetRef.current.delete(existingBinding.tabId);
            }
            await refreshWindowTabs();
            const notified = isLocalFile ? await checkAndNotifyFileAccessNeeded(err) : false;
            if (!notified && !isExpectedTabNavigationError(err)) {
              console.warn('[Arctic] Could not reset/reload bookmark tab:', err);
            }
            return;
          }

          if (tab.windowId) {
            try {
              await chrome.windows.update(tab.windowId, { focused: true });
            } catch {
              // ignore
            }
          }

          const updatedBinding: TabBinding = {
            ...existingBinding,
            currentUrl: bookmark.url,
            currentTitle: bookmark.title || bookmark.url,
            isNavigatedAway: false
          };
          const nextBindings = {
            ...bindingsByBookmarkIdRef.current,
            [bookmark.id]: updatedBinding
          };
          const nextByTab = {
            ...bookmarkIdByTabIdRef.current
          };
          await persistSession(nextBindings, nextByTab);
          setActiveTabId(existingBinding.tabId);
          void focusActiveMediaOrPageInTab(existingBinding.tabId, bookmark.url);
          return;
        }
      }

      await handleRowClick(bookmark);
    },
    [
      checkAndNotifyFileAccessNeeded,
      handleRowClick,
      hasRecentTabReset,
      markRecentTabReset,
      persistSession,
      refreshWindowTabs
    ]
  );

  /**
   * Rename an open tab (sets custom tab title)
   */
  const renameOpenTab = useCallback(async (tabId: number, title: string) => {
    setCustomTabTitles((prev) => {
      const next = { ...prev, [tabId]: title };
      chrome.storage.session.set({ customTabTitles: next });
      return next;
    });

    setWindowTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, title } : t))
    );
  }, []);

  /**
   * Update the original URL for a bookmark's binding and clear isNavigatedAway
   */
  const updateBookmarkBindingUrl = useCallback(
    async (bookmarkId: string, newUrl: string) => {
      setBindingsByBookmarkId((prev) => {
        const existing = prev[bookmarkId];
        if (!existing) return prev;

        const updated: TabBinding = {
          ...existing,
          originalUrl: newUrl,
          currentUrl: newUrl,
          isNavigatedAway: false
        };

        const next = { ...prev, [bookmarkId]: updated };
        bindingsByBookmarkIdRef.current = next;
        chrome.storage.session.set({ bindingsByBookmarkId: next });
        void upsertPersistedBindings({ [bookmarkId]: updated });
        return next;
      });
    },
    []
  );

  return {
    bindingsByBookmarkId,
    bookmarkIdByTabId,
    tabsByTabId,
    activeTabId,
    unpinnedTabs,
    isInitialTabsLoaded,
    tabSpaceByTabId,
    setTabSpace,
    moveTabsToSpace,
    closeSpaceUnpinnedTabs,
    reconcileTabsWithBookmarks,
    createNewTab,
    focusTab,
    handleRowClick,
    handleFaviconClick,
    handleFaviconDoubleClick,
    handleQuickAccessClick,
    handleCloseTab,
    closeMultipleTabs,
    closeAllUnpinnedTabs,
    closeAllWindowTabs,
    pinTab,
    pinMultipleTabs,
    unpinBookmarkTab,
    duplicateTab,
    reloadTab,
    reloadActiveTab,
    isActiveTabLoading,
    activeTabUrl,
    activeTabTitle,
    navigateActiveTab,
    goBackActiveTab,
    discardTab,
    discardAllBackgroundTabs,
    discardedTabsByTabId,
    moveOpenTab,
    moveOpenTabs,
    renameOpenTab,
    toggleMuteTab,
    autoArchiveInterval,
    setAutoArchiveInterval,
    updateBookmarkBindingUrl,
    fileAccessNoticeVisible,
    dismissFileAccessNotice,
    refreshBindings: loadSessionState,
    refreshWindowTabs
  };
}
