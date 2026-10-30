import { useState, useEffect, useCallback, useRef } from 'react';
import type { TabBinding, LocalSettings } from '../../types';
import { normalizeUrl, isUrlNavigatedAway } from '../utils/url';

export function useTabBindings() {
  const [bindingsByBookmarkId, setBindingsByBookmarkId] = useState<Record<string, TabBinding>>({});
  const [bookmarkIdByTabId, setBookmarkIdByTabId] = useState<Record<number, string>>({});
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [windowTabs, setWindowTabs] = useState<chrome.tabs.Tab[]>([]);
  const [autoArchiveInterval, setAutoArchiveIntervalState] = useState<'never' | '12h' | '24h' | '7d'>('24h');
  const currentWindowIdRef = useRef<number | null>(null);

  /**
   * Refresh all tabs in the current window
   */
  const refreshWindowTabs = useCallback(async () => {
    try {
      const currentWin = await chrome.windows.getCurrent();
      if (currentWin.id) {
        currentWindowIdRef.current = currentWin.id;
        const tabs = await chrome.tabs.query({ windowId: currentWin.id });
        setWindowTabs(tabs);

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
        chrome.storage.session.get(['bindingsByBookmarkId', 'bookmarkIdByTabId']),
        chrome.storage.local.get(['autoArchiveInterval', 'tabOpenedAt'])
      ]);

      const bindings: Record<string, TabBinding> =
        (sessionData.bindingsByBookmarkId as Record<string, TabBinding>) || {};
      const byTab: Record<number, string> =
        (sessionData.bookmarkIdByTabId as Record<number, string>) || {};

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
          // Record timestamp for new tab
          if (typeof tab.id === 'number') {
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

    // Listen to tab updates (URL change, navigation away, favicon, title, muted)
    const handleUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (
      tabId,
      changeInfo,
      tab
    ) => {
      // Update in-place to avoid expensive query on every micro status event
      setWindowTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, ...tab, ...changeInfo } : t))
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

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onCreated.addListener(handleCreated);
    chrome.tabs.onRemoved.addListener(handleRemoved);
    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.onMoved.addListener(handleMoved);
    chrome.tabs.onAttached.addListener(handleAttached);
    chrome.tabs.onDetached.addListener(handleDetached);
    chrome.windows.onFocusChanged.addListener(handleWindowFocus);
    chrome.storage.onChanged.addListener(handleStorageChange);

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
    };
  }, [loadSessionState, refreshWindowTabs]);

  /**
   * Filter window tabs that are NOT bound to any bookmark (unpinned / temp tabs)
   */
  const unpinnedTabs = windowTabs.filter(
    (tab) => typeof tab.id === 'number' && !bookmarkIdByTabId[tab.id]
  );

  /**
   * Create a new tab (e.g. Ctrl+T or '+ New Tab' button)
   */
  const createNewTab = useCallback(async (url?: string) => {
    const newTab = await chrome.tabs.create({ url, active: true });
    if (newTab.id) {
      setActiveTabId(newTab.id);
    }
    await refreshWindowTabs();
    return newTab;
  }, [refreshWindowTabs]);

  /**
   * Focus a tab
   */
  const focusTab = useCallback(async (tabId: number) => {
    await chrome.tabs.update(tabId, { active: true });
    setActiveTabId(tabId);
  }, []);

  /**
   * Close a tab
   */
  const handleCloseTab = useCallback(
    async (tabId: number, e?: React.MouseEvent) => {
      if (e) {
        e.stopPropagation();
      }
      try {
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
    if (tabIdsToClose.length === windowTabs.length) {
      await chrome.tabs.create({ active: true });
    }

    await chrome.tabs.remove(tabIdsToClose);
    await refreshWindowTabs();
  }, [unpinnedTabs, windowTabs.length, refreshWindowTabs]);

  /**
   * Pin an unpinned tab to a bookmark folder (Quick Access or Workspace)
   */
  const pinTab = useCallback(
    async (tab: chrome.tabs.Tab, targetFolderId: string) => {
      if (typeof tab.id !== 'number' || !tab.url) return;

      const title = tab.title || tab.url || 'Pinned Tab';
      const newBookmark = await chrome.bookmarks.create({
        parentId: targetFolderId,
        title,
        url: tab.url
      });

      const newBinding: TabBinding = {
        bookmarkId: newBookmark.id,
        tabId: tab.id,
        windowId: tab.windowId,
        originalUrl: tab.url,
        currentUrl: tab.url,
        currentTitle: title,
        isNavigatedAway: false
      };

      const newBindings = { ...bindingsByBookmarkId, [newBookmark.id]: newBinding };
      const newByTab = { ...bookmarkIdByTabId, [tab.id]: newBookmark.id };

      await persistSession(newBindings, newByTab);
      await refreshWindowTabs();
    },
    [bindingsByBookmarkId, bookmarkIdByTabId, persistSession, refreshWindowTabs]
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
  const reloadTab = useCallback(async (tabId: number) => {
    try {
      await chrome.tabs.reload(tabId);
    } catch (err) {
      console.warn('[Arctic] Could not reload tab:', err);
    }
  }, []);

  /**
   * Reload currently active tab
   */
  const reloadActiveTab = useCallback(async () => {
    if (typeof activeTabId === 'number') {
      try {
        await chrome.tabs.reload(activeTabId);
      } catch (err) {
        console.warn('[Arctic] Could not reload active tab:', err);
      }
    } else {
      try {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (currentTab?.id) {
          await chrome.tabs.reload(currentTab.id);
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
    for (const tab of windowTabs) {
      if (typeof tab.id === 'number' && !tab.active && !tab.discarded) {
        try {
          await chrome.tabs.discard(tab.id);
          count++;
        } catch {
          // ignore tabs that cannot be discarded
        }
      }
    }
    await refreshWindowTabs();
    return count;
  }, [windowTabs, refreshWindowTabs]);

  const activeTab = windowTabs.find((t) => t.id === activeTabId);
  const isActiveTabLoading = activeTab?.status === 'loading';

  // Map of discarded tabs by tabId
  const discardedTabsByTabId = windowTabs.reduce<Record<number, boolean>>((acc, tab) => {
    if (typeof tab.id === 'number' && tab.discarded) {
      acc[tab.id] = true;
    }
    return acc;
  }, {});

  /**
   * Toggle audio mute on a tab
   */
  const toggleMuteTab = useCallback(async (tab: chrome.tabs.Tab) => {
    if (typeof tab.id !== 'number') return;
    const isMuted = Boolean(tab.mutedInfo?.muted);
    await chrome.tabs.update(tab.id, { muted: !isMuted });
  }, []);

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

  return {
    bindingsByBookmarkId,
    bookmarkIdByTabId,
    activeTabId,
    unpinnedTabs,
    createNewTab,
    focusTab,
    handleRowClick,
    handleFaviconClick,
    handleQuickAccessClick,
    handleCloseTab,
    closeAllUnpinnedTabs,
    pinTab,
    duplicateTab,
    reloadTab,
    reloadActiveTab,
    isActiveTabLoading,
    discardTab,
    discardAllBackgroundTabs,
    discardedTabsByTabId,
    moveOpenTab,
    toggleMuteTab,
    autoArchiveInterval,
    setAutoArchiveInterval,
    refreshBindings: loadSessionState,
    refreshWindowTabs
  };
}
