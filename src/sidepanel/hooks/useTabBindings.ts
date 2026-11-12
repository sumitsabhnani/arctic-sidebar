import { useState, useEffect, useCallback, useRef } from 'react';
import type { TabBinding, LocalSettings } from '../../types';
import { getEffectiveTabUrl, isUrlNavigatedAway } from '../utils/url';
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

/**
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

  /**
   * Refresh all tabs in the current window
   */
  const refreshWindowTabs = useCallback(async () => {
    try {
      const currentWin = await chrome.windows.getCurrent();
      if (currentWin.id) {
        currentWindowIdRef.current = currentWin.id;
        const tabs = await chrome.tabs.query({ windowId: currentWin.id });
        const tabsWithCustom = tabs.map((t) => {
          if (typeof t.id === 'number' && customTabTitlesRef.current[t.id]) {
            return { ...t, title: customTabTitlesRef.current[t.id] };
          }
          return t;
        });
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

  /**
   * Read current session state and local settings
   */
  const loadSessionState = useCallback(async () => {
    try {
      const [sessionData, localData] = await Promise.all([
        chrome.storage.session.get(['bindingsByBookmarkId', 'bookmarkIdByTabId', 'customTabTitles']),
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
      const existingTimestamps: Record<number, number> =
        (localData.tabOpenedAt as Record<number, number>) || {};
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

        const currentActiveTab = allTabs.find((t) => t.active);
        const tabsToClose: number[] = [];

        for (const tab of allTabs) {
          if (
            typeof tab.id === 'number' &&
            !cleanByTab[tab.id] &&
            tab.id !== currentActiveTab?.id
          ) {
            const openedAt = existingTimestamps[tab.id];
            if (openedAt && now - openedAt > thresholdMs) {
              tabsToClose.push(tab.id);
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
      }

      if (tabsAwaitingRestoreUrlRef.current.has(removedTabId)) {
        tabsAwaitingRestoreUrlRef.current.delete(removedTabId);
        tabsAwaitingRestoreUrlRef.current.add(addedTabId);
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

      reconcileLockRef.current = reconcileLockRef.current.then(async () => {
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

          const [allOpenTabs, session, persistedBindings] = await Promise.all([
            chrome.tabs.query({}),
            chrome.storage.session.get(['bindingsByBookmarkId', 'bookmarkIdByTabId']),
            getPersistedBindings()
          ]);

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
      });

      await reconcileLockRef.current;
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
            // Record timestamp for new tab
            chrome.storage.local.get(['tabOpenedAt'], (res) => {
              const timestamps = (res.tabOpenedAt as Record<number, number>) || {};
              timestamps[tab.id!] = Date.now();
              chrome.storage.local.set({ tabOpenedAt: timestamps });
            });
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
      tabsAwaitingRestoreUrlRef.current.delete(tabId);
      refreshWindowTabs();

      if (!removeInfo?.isWindowClosing) {
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
      // Update in-place to avoid expensive query on every micro status event
      setWindowTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t;
          const merged = {
            ...t,
            ...tab,
            ...changeInfo,
            pendingUrl: changeInfo.url ? undefined : tab.pendingUrl
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
          let isNavAway = isUrlNavigatedAway(currentUrl, existing.originalUrl);

          // If this was a .new document shortcut and it redirected to the created document, update bookmark URL
          const isDotNewRedirect =
            (existing.originalUrl === 'https://docs.new' && currentUrl?.startsWith('https://docs.google.com/document/d/')) ||
            (existing.originalUrl === 'https://sheets.new' && currentUrl?.startsWith('https://docs.google.com/spreadsheets/d/')) ||
            (existing.originalUrl === 'https://slides.new' && currentUrl?.startsWith('https://docs.google.com/presentation/d/')) ||
            (existing.originalUrl === 'https://notion.new' && currentUrl?.startsWith('https://www.notion.so/') && !currentUrl.includes('/login')) ||
            (existing.originalUrl === 'https://gist.new' && currentUrl?.startsWith('https://gist.github.com/'));

          if (isDotNewRedirect && currentUrl) {
            existing.originalUrl = currentUrl;
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
            currentUrl === existing.currentUrl &&
            currentTitle === existing.currentTitle &&
            isNavAway === existing.isNavigatedAway
          ) {
            return prevBindings;
          }

          const updatedBinding: TabBinding = {
            ...existing,
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
  }, [loadSessionState, migrateReplacedTabId, refreshWindowTabs, scheduleReconcile]);

  /**
   * Map of all window tabs by tabId for instant lookup (audible, mutedInfo, discarded, etc.)
   */
  const tabsByTabId = windowTabs.reduce<Record<number, chrome.tabs.Tab>>((acc, tab) => {
    if (typeof tab.id === 'number') {
      acc[tab.id] = tab;
    }
    return acc;
  }, {});

  /**
   * Filter window tabs that are NOT bound to any bookmark (unpinned / temp tabs)
   * and exclude the Arctic Command / New Tab launcher until it navigates to a real page
   */
  const unpinnedTabs = windowTabs.filter(
    (tab) =>
      typeof tab.id === 'number' &&
      !bookmarkIdByTabId[tab.id] &&
      !isArcticCommandTab(tab)
  );

  /**
   * Create a new tab (e.g. Ctrl+T or '+ New Tab' button)
   */
  const createNewTab = useCallback(async (url?: string, spaceId?: string) => {
    creatingManualTabCountRef.current += 1;
    let newTab: chrome.tabs.Tab;
    try {
      newTab = await chrome.tabs.create({ url, active: true });
    } finally {
      creatingManualTabCountRef.current -= 1;
    }
    const targetSpace = spaceId || currentActiveSpaceIdRef.current || 'home';
    if (typeof newTab.id === 'number') {
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
  }, [refreshWindowTabs]);

  /**
   * Focus a tab
   */
  const focusTab = useCallback(async (tabId: number) => {
    setActiveTabId(tabId);
    try {
      await chrome.tabs.update(tabId, { active: true });
    } catch (err) {
      console.warn('[Arctic] Could not activate tab:', err);
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  /**
   * Close a tab (If closing the last tab in the window, create a fresh tab first to keep the browser window & sidebar alive)
   */
  const handleCloseTab = useCallback(
    async (tabId: number, e?: React.MouseEvent) => {
      if (e) {
        e.stopPropagation();
      }
      const bookmarkId = bookmarkIdByTabIdRef.current[tabId] || bookmarkIdByTabId[tabId];
      try {
        const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
        if (currentWindowTabs.length <= 1) {
          creatingManualTabCountRef.current += 1;
          try {
            await chrome.tabs.create({ active: true });
          } finally {
            creatingManualTabCountRef.current -= 1;
          }
        }
        await chrome.tabs.remove(tabId);
      } catch (err) {
        console.warn('[Arctic] Could not remove tab:', err);
      }

      const nextByTab = { ...bookmarkIdByTabId, ...bookmarkIdByTabIdRef.current };
      delete nextByTab[tabId];

      const nextBindings = { ...bindingsByBookmarkId, ...bindingsByBookmarkIdRef.current };
      if (bookmarkId) {
        delete nextBindings[bookmarkId];
        await removePersistedBindings([bookmarkId]);
      }

      await persistSession(nextBindings, nextByTab);
      await refreshWindowTabs();
    },
    [bindingsByBookmarkId, bookmarkIdByTabId, persistSession, refreshWindowTabs]
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
    await refreshWindowTabs();
  }, [unpinnedTabs, windowTabs.length, refreshWindowTabs]);

  /**
   * Close all active tabs in the current window (Clear All action).
   * Creates a fresh tab first to keep the browser window & sidebar alive, then removes all existing tabs and clears session bindings.
   */
  const closeAllWindowTabs = useCallback(async () => {
    const tabIdsToClose = windowTabs
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

    await clearAllPersistedBindings();
    await persistSession({}, {});
    await refreshWindowTabs();
  }, [windowTabs, persistSession, refreshWindowTabs]);

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
      await refreshWindowTabs();
    },
    [windowTabs.length, refreshWindowTabs]
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
    async (tabs: chrome.tabs.Tab[], targetFolderId: string, targetIndex?: number) => {
      if (!tabs.length || !targetFolderId) return;

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

      let curIndex = targetIndex;
      for (const tab of tabs) {
        const tabUrl = getEffectiveTabUrl(tab);
        if (typeof tab.id !== 'number' || !tabUrl) continue;
        unpinnedTabIdsRef.current.delete(tab.id);

        const existingBookmarkId = nextByTab[tab.id];
        if (existingBookmarkId) {
          try {
            await chrome.bookmarks.move(existingBookmarkId, {
              parentId: targetFolderId,
              ...(typeof curIndex === 'number' ? { index: curIndex } : {})
            });
            if (typeof curIndex === 'number') curIndex += 1;
            continue;
          } catch {
            delete nextBindings[existingBookmarkId];
            delete nextByTab[tab.id];
          }
        }

        const title = tab.title || tabUrl || 'Pinned Tab';
        const newBookmark = await chrome.bookmarks.create({
          parentId: targetFolderId,
          title,
          url: tabUrl,
          ...(typeof curIndex === 'number' ? { index: curIndex } : {})
        });
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

      await persistSession(nextBindings, nextByTab);
      await refreshWindowTabs();
    },
    [persistSession, refreshWindowTabs]
  );

  /**
   * Pin an unpinned tab to a bookmark folder (Quick Access or Home/Space)
   */
  const pinTab = useCallback(
    async (tab: chrome.tabs.Tab, targetFolderId: string, targetIndex?: number) => {
      await pinMultipleTabs([tab], targetFolderId, targetIndex);
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
    [persistSession, refreshWindowTabs]
  );

  /**
   * Duplicate a tab
   */
  const duplicateTab = useCallback(
    async (tabId: number) => {
      await chrome.tabs.duplicate(tabId);
      await refreshWindowTabs();
    },
    [refreshWindowTabs]
  );

  /**
   * Reload a tab
   */
  const reloadTab = useCallback(async (tabId: number, bypassCache: boolean = false) => {
    try {
      setWindowTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, status: 'loading' } : t))
      );
      await chrome.tabs.reload(tabId, { bypassCache });
    } catch (err) {
      console.warn('[Arctic] Could not reload tab:', err);
    }
  }, []);

  /**
   * Reload currently active tab
   */
  const reloadActiveTab = useCallback(async (bypassCache: boolean = false) => {
    if (typeof activeTabId === 'number') {
      try {
        await chrome.tabs.reload(activeTabId, { bypassCache });
      } catch (err) {
        console.warn('[Arctic] Could not reload active tab:', err);
      }
    } else {
      try {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (currentTab?.id) {
          await chrome.tabs.reload(currentTab.id, { bypassCache });
        }
      } catch (err) {
        console.warn('[Arctic] Could not query and reload tab:', err);
      }
    }
  }, [activeTabId]);

  /**
   * Move / reorder open tab within window
   */
  const moveOpenTab = useCallback(
    async (tabId: number, targetIndex: number) => {
      try {
        await chrome.tabs.move(tabId, { index: targetIndex });
        await refreshWindowTabs();
      } catch (err) {
        console.warn('[Arctic] Could not move tab:', err);
      }
    },
    [refreshWindowTabs]
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
  const activeTabUrl = activeTab?.url || '';
  const activeTabTitle = activeTab?.title || '';

  const navigateActiveTab = useCallback(
    async (rawInput: string) => {
      const trimmed = rawInput.trim();
      if (!trimmed) return;

      let finalUrl = trimmed;
      const isLikelyUrl =
        /^https?:\/\//i.test(trimmed) ||
        /^chrome:\/\//i.test(trimmed) ||
        /^localhost(:\d+)?(\/.*)?$/i.test(trimmed) ||
        /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?(\/.*)?$/.test(trimmed) ||
        (!/\s/.test(trimmed) && /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/i.test(trimmed));

      if (isLikelyUrl) {
        if (!/^https?:\/\//i.test(trimmed) && !/^chrome:\/\//i.test(trimmed)) {
          finalUrl = `https://${trimmed}`;
        }
        if (typeof activeTabId === 'number') {
          await chrome.tabs.update(activeTabId, { url: finalUrl, active: true });
        } else {
          await chrome.tabs.create({ url: finalUrl, active: true });
        }
      } else if (typeof chrome !== 'undefined' && typeof chrome.search?.query === 'function') {
        try {
          if (typeof activeTabId === 'number') {
            await chrome.search.query({ text: trimmed, tabId: activeTabId });
          } else {
            await chrome.search.query({ text: trimmed, disposition: 'NEW_TAB' });
          }
        } catch {
          finalUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
          if (typeof activeTabId === 'number') {
            await chrome.tabs.update(activeTabId, { url: finalUrl, active: true });
          } else {
            await chrome.tabs.create({ url: finalUrl, active: true });
          }
        }
      } else {
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
        if (typeof activeTabId === 'number') {
          await chrome.tabs.update(activeTabId, { url: finalUrl, active: true });
        } else {
          await chrome.tabs.create({ url: finalUrl, active: true });
        }
      }
      await refreshWindowTabs();
    },
    [activeTabId, refreshWindowTabs]
  );

  /**
   * Navigate active tab backward in history
   */
  const goBackActiveTab = useCallback(async () => {
    if (typeof activeTabId === 'number') {
      try {
        await chrome.tabs.goBack(activeTabId);
      } catch (err) {
        console.warn('[Arctic] Could not go back in active tab:', err);
      }
    }
  }, [activeTabId]);

  // Map of discarded tabs by tabId
  const discardedTabsByTabId = windowTabs.reduce<Record<number, boolean>>((acc, tab) => {
    if (typeof tab.id === 'number' && tab.discarded) {
      acc[tab.id] = true;
    }
    return acc;
  }, {});

  /**
   * Toggle audio mute on a tab (by tab object or tabId)
   */
  const toggleMuteTab = useCallback(
    async (tabOrId: chrome.tabs.Tab | number) => {
      try {
        if (typeof tabOrId === 'number') {
          const existing = tabsByTabId[tabOrId] || (await chrome.tabs.get(tabOrId));
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
    [tabsByTabId, refreshWindowTabs]
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

      let latestBindings: Record<string, TabBinding> = {
        ...bindingsByBookmarkId,
        ...bindingsByBookmarkIdRef.current
      };
      let latestByTab: Record<number, string> = {
        ...bookmarkIdByTabId,
        ...bookmarkIdByTabIdRef.current
      };

      if (!latestBindings[bookmark.id] && chrome.storage?.session?.get) {
        try {
          const session = await chrome.storage.session.get([
            'bindingsByBookmarkId',
            'bookmarkIdByTabId'
          ]);
          latestBindings = {
            ...((session.bindingsByBookmarkId as Record<string, TabBinding>) || {}),
            ...latestBindings
          };
          latestByTab = {
            ...((session.bookmarkIdByTabId as Record<number, string>) || {}),
            ...latestByTab
          };
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
        persistedBindings
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
        await refreshWindowTabs();
        return;
      }

      // Otherwise, open a new tab and bind it
      creatingManualTabCountRef.current += 1;
      let createdTab: chrome.tabs.Tab;
      try {
        createdTab = await chrome.tabs.create({
          url: bookmark.url,
          active: true
        });
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
        await refreshWindowTabs();
      }
    },
    [bindingsByBookmarkId, bookmarkIdByTabId, persistSession, refreshWindowTabs]
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

      const existingBinding =
        bindingsByBookmarkIdRef.current[bookmark.id] || bindingsByBookmarkId[bookmark.id];

      if (existingBinding && existingBinding.isNavigatedAway) {
        try {
          const tab = await chrome.tabs.get(existingBinding.tabId);
          if (tab) {
            await chrome.tabs.update(existingBinding.tabId, {
              url: bookmark.url,
              active: true
            });
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
              ...bindingsByBookmarkId,
              ...bindingsByBookmarkIdRef.current,
              [bookmark.id]: updatedBinding
            };
            const nextByTab = {
              ...bookmarkIdByTabId,
              ...bookmarkIdByTabIdRef.current
            };
            await persistSession(nextBindings, nextByTab);
            setActiveTabId(existingBinding.tabId);
            await refreshWindowTabs();
            return;
          }
        } catch {
          // Tab dead, fall through
        }
      }

      await handleRowClick(bookmark);
    },
    [bindingsByBookmarkId, bookmarkIdByTabId, handleRowClick, persistSession, refreshWindowTabs]
  );

  /**
   * Quick Access Grid Tile Click
   */
  const handleQuickAccessClick = useCallback(
    async (bookmark: chrome.bookmarks.BookmarkTreeNode) => {
      if (!bookmark.url) return;
      const binding =
        bindingsByBookmarkIdRef.current[bookmark.id] || bindingsByBookmarkId[bookmark.id];

      if (binding && binding.tabId === activeTabId && binding.isNavigatedAway) {
        await chrome.tabs.update(binding.tabId, { url: bookmark.url, active: true });
        const updatedBinding: TabBinding = {
          ...binding,
          currentUrl: bookmark.url,
          isNavigatedAway: false
        };
        const nextBindings = {
          ...bindingsByBookmarkId,
          ...bindingsByBookmarkIdRef.current,
          [bookmark.id]: updatedBinding
        };
        const nextByTab = {
          ...bookmarkIdByTabId,
          ...bookmarkIdByTabIdRef.current
        };
        await persistSession(nextBindings, nextByTab);
        await refreshWindowTabs();
        return;
      }

      await handleRowClick(bookmark);
    },
    [activeTabId, bindingsByBookmarkId, bookmarkIdByTabId, handleRowClick, persistSession, refreshWindowTabs]
  );

  /**
   * Double click favicon/icon: reload the actual bookmarked page (not current navigated page)
   */
  const handleFaviconDoubleClick = useCallback(
    async (bookmark: chrome.bookmarks.BookmarkTreeNode, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      if (!bookmark.url) return;

      const existingBinding =
        bindingsByBookmarkIdRef.current[bookmark.id] || bindingsByBookmarkId[bookmark.id];
      if (existingBinding) {
        try {
          const tab = await chrome.tabs.get(existingBinding.tabId);
          if (tab) {
            const needsUrlReset =
              existingBinding.isNavigatedAway ||
              isUrlNavigatedAway(
                getEffectiveTabUrl(tab) || existingBinding.currentUrl || '',
                bookmark.url
              );

            if (needsUrlReset) {
              // Force navigate to original bookmark URL
              await chrome.tabs.update(existingBinding.tabId, {
                url: bookmark.url,
                active: true
              });
            } else {
              if (!tab.active) {
                await chrome.tabs.update(existingBinding.tabId, { active: true });
              }
              await chrome.tabs.reload(existingBinding.tabId);
            }
            setWindowTabs((prev) =>
              prev.map((t) =>
                t.id === existingBinding.tabId ? { ...t, status: 'loading' } : t
              )
            );

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
              ...bindingsByBookmarkId,
              ...bindingsByBookmarkIdRef.current,
              [bookmark.id]: updatedBinding
            };
            const nextByTab = {
              ...bookmarkIdByTabId,
              ...bookmarkIdByTabIdRef.current
            };
            await persistSession(nextBindings, nextByTab);
            setActiveTabId(existingBinding.tabId);
            return;
          }
        } catch {
          // Tab dead, fall through
        }
      }

      await handleRowClick(bookmark);
    },
    [bindingsByBookmarkId, bookmarkIdByTabId, handleRowClick, persistSession]
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
    renameOpenTab,
    toggleMuteTab,
    autoArchiveInterval,
    setAutoArchiveInterval,
    updateBookmarkBindingUrl,
    refreshBindings: loadSessionState,
    refreshWindowTabs
  };
}
