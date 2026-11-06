import { useState, useEffect, useCallback, useRef } from 'react';
import type { TabBinding, LocalSettings } from '../../types';
import { normalizeUrl, isUrlNavigatedAway, isScratchpadUrl } from '../utils/url';

export function useTabBindings(activeSpaceId: string = 'home') {
  const [bindingsByBookmarkId, setBindingsByBookmarkId] = useState<Record<string, TabBinding>>({});
  const [bookmarkIdByTabId, setBookmarkIdByTabId] = useState<Record<number, string>>({});
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [windowTabs, setWindowTabs] = useState<chrome.tabs.Tab[]>([]);
  const [tabSpaceByTabId, setTabSpaceByTabId] = useState<Record<number, string>>({});
  const [customTabTitles, setCustomTabTitles] = useState<Record<number, string>>({});
  const customTabTitlesRef = useRef<Record<number, string>>({});
  customTabTitlesRef.current = customTabTitles;
  const [autoArchiveInterval, setAutoArchiveIntervalState] = useState<'never' | '12h' | '24h' | '7d'>('24h');
  const currentWindowIdRef = useRef<number | null>(null);
  const currentActiveSpaceIdRef = useRef<string>(activeSpaceId);
  currentActiveSpaceIdRef.current = activeSpaceId;

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

      // Verify open tabs to prune any dead bindings
      const allTabs = await chrome.tabs.query({});
      const openTabIdSet = new Set(
        allTabs.map((t) => t.id).filter((id): id is number => typeof id === 'number')
      );

      let dirty = false;
      const cleanBindings: Record<string, TabBinding> = {};
      const cleanByTab: Record<number, string> = {};

      for (const [tabIdStr, bId] of Object.entries(byTab)) {
        const tId = Number(tabIdStr);
        if (openTabIdSet.has(tId)) {
          cleanByTab[tId] = bId;
        } else {
          dirty = true;
        }
      }

      for (const [bId, binding] of Object.entries(bindings)) {
        if (openTabIdSet.has(binding.tabId)) {
          cleanBindings[bId] = binding;
        } else {
          dirty = true;
        }
      }

      if (dirty) {
        await chrome.storage.session.set({
          bindingsByBookmarkId: cleanBindings,
          bookmarkIdByTabId: cleanByTab
        });
      }

      setBindingsByBookmarkId(cleanBindings);
      setBookmarkIdByTabId(cleanByTab);

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
          timestampsUpdated = false;
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

      // Perform auto-archive check if configured
      const intervalSetting = localData.autoArchiveInterval || '24h';
      if (intervalSetting !== 'never') {
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
   * Helper to write state to chrome.storage.session
   */
  const persistSession = useCallback(
    async (
      newBindings: Record<string, TabBinding>,
      newByTab: Record<number, string>
    ) => {
      setBindingsByBookmarkId(newBindings);
      setBookmarkIdByTabId(newByTab);
      try {
        await chrome.storage.session.set({
          bindingsByBookmarkId: newBindings,
          bookmarkIdByTabId: newByTab
        });
      } catch (err) {
        console.error('[Arctic] Error persisting session state:', err);
      }
    },
    []
  );

  // Initialize and register event listeners
  useEffect(() => {
    refreshWindowTabs();
    loadSessionState();

    // Listen to tab activation
    const handleActivated: Parameters<typeof chrome.tabs.onActivated.addListener>[0] = (activeInfo) => {
      chrome.windows.getCurrent((currentWin) => {
        if (currentWin.id === activeInfo.windowId) {
          setActiveTabId(activeInfo.tabId);
          currentWindowIdRef.current = activeInfo.windowId;
          refreshWindowTabs();
        }
      });
    };

    // Listen to tab creation (e.g. Ctrl+T, link clicked)
    const handleCreated = (tab: chrome.tabs.Tab) => {
      chrome.windows.getCurrent((currentWin) => {
        if (currentWin.id === tab.windowId) {
          refreshWindowTabs();
          if (typeof tab.id === 'number') {
            const currentSpace = currentActiveSpaceIdRef.current || 'home';
            setTabSpaceByTabId((prev) => {
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
          }
        }
      });
    };

    // Listen to tab removal
    const handleRemoved = (tabId: number) => {
      refreshWindowTabs();

      setTabSpaceByTabId((prev) => {
        if (!prev[tabId]) return prev;
        const next = { ...prev };
        delete next[tabId];
        chrome.storage.local.set({ tabSpaceByTabId: next });
        return next;
      });

      setCustomTabTitles((prev) => {
        if (!prev[tabId]) return prev;
        const next = { ...prev };
        delete next[tabId];
        chrome.storage.session.set({ customTabTitles: next });
        return next;
      });

      setBookmarkIdByTabId((prevByTab) => {
        const bookmarkId = prevByTab[tabId];
        if (!bookmarkId) return prevByTab;

        const nextByTab = { ...prevByTab };
        delete nextByTab[tabId];

        setBindingsByBookmarkId((prevBindings) => {
          const nextBindings = { ...prevBindings };
          delete nextBindings[bookmarkId];
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
        prev.map((t) =>
          t.id === tabId
            ? {
                ...t,
                ...tab,
                ...changeInfo,
                title: customTabTitlesRef.current[tabId] || changeInfo.title || tab.title || t.title
              }
            : t
        )
      );

      if (!changeInfo.url && changeInfo.status !== 'complete' && !changeInfo.title) {
        return;
      }

      setBookmarkIdByTabId((prevByTab) => {
        const bookmarkId = prevByTab[tabId];
        if (!bookmarkId) return prevByTab;

        setBindingsByBookmarkId((prevBindings) => {
          const existing = prevBindings[bookmarkId];
          if (!existing) return prevBindings;

          const currentUrl = tab.url || existing.currentUrl;
          const currentTitle = tab.title || existing.currentTitle;
          const isNavAway = isUrlNavigatedAway(currentUrl, existing.originalUrl);

          // If this was a docs.new link and it redirected to an active Google Doc, update bookmark URL
          if (
            existing.originalUrl === 'https://docs.new' &&
            currentUrl &&
            currentUrl.startsWith('https://docs.google.com/document/d/')
          ) {
            existing.originalUrl = currentUrl;
            chrome.bookmarks.update(bookmarkId, {
              url: currentUrl,
              ...(tab.title && !tab.title.includes('docs.new') && tab.title !== 'New Google Doc'
                ? { title: tab.title.replace(' - Google Docs', '').trim() }
                : {})
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

          chrome.storage.session.set({
            bindingsByBookmarkId: nextBindings,
            bookmarkIdByTabId: prevByTab
          });

          return nextBindings;
        });

        return prevByTab;
      });
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
          setBindingsByBookmarkId(
            (changes.bindingsByBookmarkId.newValue as Record<string, TabBinding>) || {}
          );
        }
        if (changes.bookmarkIdByTabId) {
          setBookmarkIdByTabId(
            (changes.bookmarkIdByTabId.newValue as Record<number, string>) || {}
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
          chrome.storage.session.set({ bindingsByBookmarkId: next });
          return next;
        });
      }
    };

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onCreated.addListener(handleCreated);
    chrome.tabs.onRemoved.addListener(handleRemoved);
    chrome.tabs.onUpdated.addListener(handleUpdated);
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
      clearInterval(cleanupInterval);
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onCreated.removeListener(handleCreated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
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
  }, [loadSessionState, refreshWindowTabs]);

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
   */
  const unpinnedTabs = windowTabs.filter(
    (tab) => typeof tab.id === 'number' && !bookmarkIdByTabId[tab.id]
  );

  /**
   * Create a new tab (e.g. Ctrl+T or '+ New Tab' button)
   */
  const createNewTab = useCallback(async (url?: string, spaceId?: string) => {
    const newTab = await chrome.tabs.create({ url, active: true });
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
      try {
        const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
        if (currentWindowTabs.length <= 1) {
          await chrome.tabs.create({ active: true });
        }
        await chrome.tabs.remove(tabId);
      } catch (err) {
        console.warn('[Arctic] Could not remove tab:', err);
      }

      const bookmarkId = bookmarkIdByTabId[tabId];
      const nextByTab = { ...bookmarkIdByTabId };
      delete nextByTab[tabId];

      const nextBindings = { ...bindingsByBookmarkId };
      if (bookmarkId) {
        delete nextBindings[bookmarkId];
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
      await chrome.tabs.create({ active: true });
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
      await chrome.tabs.create({ active: true });
      await chrome.tabs.remove(tabIdsToClose);
    } catch (err) {
      console.warn('[Arctic] Could not close all window tabs:', err);
    }

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
        await chrome.tabs.create({ active: true });
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
   * Reconciles open browser tabs with saved bookmarks on startup/reload.
   * If an open tab matches a bookmark's normalized URL and is not yet bound,
   * it binds the tab to that bookmark so it appears as a running pinned tab
   * instead of polluting Today's Tabs!
   */
  const reconcileTabsWithBookmarks = useCallback(
    async (bookmarkNodes: chrome.bookmarks.BookmarkTreeNode[]) => {
      try {
        const currentTabs = await chrome.tabs.query({ currentWindow: true });
        const session = await chrome.storage.session.get(['bindingsByBookmarkId', 'bookmarkIdByTabId']);
        const currentBindings: Record<string, TabBinding> =
          (session.bindingsByBookmarkId as Record<string, TabBinding>) || {};
        const currentByTab: Record<number, string> =
          (session.bookmarkIdByTabId as Record<number, string>) || {};

        const allBookmarkLeaves: chrome.bookmarks.BookmarkTreeNode[] = [];
        const collect = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
          for (const node of nodes) {
            if (node.url && !isScratchpadUrl(node.url)) {
              allBookmarkLeaves.push(node);
            }
            if (node.children) {
              collect(node.children);
            }
          }
        };
        collect(bookmarkNodes);

        if (allBookmarkLeaves.length === 0 || currentTabs.length === 0) return;

        let hasNewBindings = false;
        const nextBindings = { ...bindingsByBookmarkId, ...currentBindings };
        const nextByTab = { ...bookmarkIdByTabId, ...currentByTab };

        const boundTabIds = new Set(Object.keys(nextByTab).map(Number));
        const boundBookmarkIds = new Set(Object.keys(nextBindings));

        for (const tab of currentTabs) {
          if (typeof tab.id !== 'number' || !tab.url) continue;
          if (boundTabIds.has(tab.id)) continue;

          if (
            tab.url.startsWith('chrome://newtab') ||
            tab.url === 'about:blank' ||
            tab.url.includes('/newtab.html') ||
            tab.url.includes('/command.html')
          ) {
            continue;
          }

          const tabNormalized = normalizeUrl(tab.url);
          const matchingBookmark = allBookmarkLeaves.find(
            (b) =>
              !boundBookmarkIds.has(b.id) &&
              b.url &&
              normalizeUrl(b.url) === tabNormalized
          );

          if (matchingBookmark) {
            const newBinding: TabBinding = {
              bookmarkId: matchingBookmark.id,
              tabId: tab.id,
              windowId: tab.windowId,
              originalUrl: matchingBookmark.url!,
              currentUrl: tab.url,
              currentTitle: tab.title || matchingBookmark.title || '',
              isNavigatedAway: isUrlNavigatedAway(tab.url, matchingBookmark.url!)
            };

            nextBindings[matchingBookmark.id] = newBinding;
            nextByTab[tab.id] = matchingBookmark.id;
            boundTabIds.add(tab.id);
            boundBookmarkIds.add(matchingBookmark.id);
            hasNewBindings = true;
          }
        }

        if (hasNewBindings) {
          await persistSession(nextBindings, nextByTab);
          await refreshWindowTabs();
        }
      } catch (err) {
        console.warn('[Arctic] Could not reconcile tabs with bookmarks:', err);
      }
    },
    [bindingsByBookmarkId, bookmarkIdByTabId, persistSession, refreshWindowTabs]
  );

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
        ...bindingsByBookmarkId,
        ...storedBindings
      };
      const nextByTab: Record<number, string> = {
        ...bookmarkIdByTabId,
        ...storedByTab
      };

      let curIndex = targetIndex;
      for (const tab of tabs) {
        if (typeof tab.id !== 'number' || !tab.url) continue;

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

        const title = tab.title || tab.url || 'Pinned Tab';
        const newBookmark = await chrome.bookmarks.create({
          parentId: targetFolderId,
          title,
          url: tab.url,
          ...(typeof curIndex === 'number' ? { index: curIndex } : {})
        });
        if (typeof curIndex === 'number') curIndex += 1;

        const newBinding: TabBinding = {
          bookmarkId: newBookmark.id,
          tabId: tab.id,
          windowId: tab.windowId,
          originalUrl: tab.url,
          currentUrl: tab.url,
          currentTitle: title,
          isNavigatedAway: false
        };

        nextBindings[newBookmark.id] = newBinding;
        nextByTab[tab.id] = newBookmark.id;
      }

      await persistSession(nextBindings, nextByTab);
      await refreshWindowTabs();
    },
    [bindingsByBookmarkId, bookmarkIdByTabId, persistSession, refreshWindowTabs]
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
        await chrome.tabs.discard(tabId);
        await refreshWindowTabs();
      } catch (err) {
        console.warn('[Arctic] Could not discard tab:', err);
      }
    },
    [refreshWindowTabs]
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
            await chrome.tabs.discard(tab.id);
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
  }, [refreshWindowTabs]);

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
      } else {
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
      }

      if (typeof activeTabId === 'number') {
        await chrome.tabs.update(activeTabId, { url: finalUrl, active: true });
      } else {
        await chrome.tabs.create({ url: finalUrl, active: true });
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

      const existingBinding = bindingsByBookmarkId[bookmark.id];

      // If already bound, verify if the tab is still alive
      if (existingBinding) {
        try {
          const tab = await chrome.tabs.get(existingBinding.tabId);
          if (tab) {
            await chrome.tabs.update(existingBinding.tabId, { active: true });
            if (tab.windowId) {
              await chrome.windows.update(tab.windowId, { focused: true });
            }
            setActiveTabId(existingBinding.tabId);
            return;
          }
        } catch {
          // Tab was closed, fall through to rebind/create
        }
      }

      // Check current window tabs for an unbound tab already at bookmark.url
      const currentTabs = await chrome.tabs.query({ currentWindow: true });
      const targetNormalized = normalizeUrl(bookmark.url);

      const unboundMatch = currentTabs.find(
        (t) =>
          typeof t.id === 'number' &&
          !bookmarkIdByTabId[t.id] &&
          t.url &&
          normalizeUrl(t.url) === targetNormalized
      );

      if (unboundMatch && typeof unboundMatch.id === 'number') {
        const tabId = unboundMatch.id;
        const newBinding: TabBinding = {
          bookmarkId: bookmark.id,
          tabId,
          windowId: unboundMatch.windowId,
          originalUrl: bookmark.url,
          currentUrl: unboundMatch.url || bookmark.url,
          currentTitle: unboundMatch.title || bookmark.title || '',
          isNavigatedAway: isUrlNavigatedAway(unboundMatch.url || '', bookmark.url)
        };

        const newBindings = { ...bindingsByBookmarkId, [bookmark.id]: newBinding };
        const newByTab = { ...bookmarkIdByTabId, [tabId]: bookmark.id };

        await persistSession(newBindings, newByTab);
        await chrome.tabs.update(tabId, { active: true });
        setActiveTabId(tabId);
        await refreshWindowTabs();
        return;
      }

      // Otherwise, open a new tab and bind it
      const createdTab = await chrome.tabs.create({
        url: bookmark.url,
        active: true
      });

      if (typeof createdTab.id === 'number') {
        const tabId = createdTab.id;
        const newBinding: TabBinding = {
          bookmarkId: bookmark.id,
          tabId,
          windowId: createdTab.windowId,
          originalUrl: bookmark.url,
          currentUrl: bookmark.url,
          currentTitle: bookmark.title || '',
          isNavigatedAway: false
        };

        const newBindings = { ...bindingsByBookmarkId, [bookmark.id]: newBinding };
        const newByTab = { ...bookmarkIdByTabId, [tabId]: bookmark.id };

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

      const existingBinding = bindingsByBookmarkId[bookmark.id];

      if (existingBinding) {
        try {
          const tab = await chrome.tabs.get(existingBinding.tabId);
          if (tab) {
            await chrome.tabs.update(existingBinding.tabId, {
              url: bookmark.url,
              active: true
            });
            if (tab.windowId) {
              await chrome.windows.update(tab.windowId, { focused: true });
            }

            const updatedBinding: TabBinding = {
              ...existingBinding,
              currentUrl: bookmark.url,
              isNavigatedAway: false
            };
            const nextBindings = {
              ...bindingsByBookmarkId,
              [bookmark.id]: updatedBinding
            };
            await persistSession(nextBindings, bookmarkIdByTabId);
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
      const binding = bindingsByBookmarkId[bookmark.id];

      if (binding && binding.tabId === activeTabId && binding.isNavigatedAway) {
        await chrome.tabs.update(binding.tabId, { url: bookmark.url, active: true });
        const updatedBinding: TabBinding = {
          ...binding,
          currentUrl: bookmark.url,
          isNavigatedAway: false
        };
        const nextBindings = {
          ...bindingsByBookmarkId,
          [bookmark.id]: updatedBinding
        };
        await persistSession(nextBindings, bookmarkIdByTabId);
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

      const existingBinding = bindingsByBookmarkId[bookmark.id];
      if (existingBinding) {
        try {
          const tab = await chrome.tabs.get(existingBinding.tabId);
          if (tab) {
            // Force navigate to original bookmark URL
            await chrome.tabs.update(existingBinding.tabId, { url: bookmark.url, active: true });
            const updatedBinding: TabBinding = {
              ...existingBinding,
              currentUrl: bookmark.url,
              currentTitle: bookmark.title || bookmark.url,
              isNavigatedAway: false
            };
            const nextBindings = {
              ...bindingsByBookmarkId,
              [bookmark.id]: updatedBinding
            };
            await persistSession(nextBindings, bookmarkIdByTabId);
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
        chrome.storage.session.set({ bindingsByBookmarkId: next });
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
