import { useState, useEffect, useCallback, useRef } from 'react';
import type { TabBinding } from '../../types';
import { normalizeUrl, isUrlNavigatedAway } from '../utils/url';

export function useTabBindings() {
  const [bindingsByBookmarkId, setBindingsByBookmarkId] = useState<Record<string, TabBinding>>({});
  const [bookmarkIdByTabId, setBookmarkIdByTabId] = useState<Record<number, string>>({});
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const currentWindowIdRef = useRef<number | null>(null);

  /**
   * Read current session state from storage
   */
  const loadSessionState = useCallback(async () => {
    try {
      const data = await chrome.storage.session.get(['bindingsByBookmarkId', 'bookmarkIdByTabId']);
      const bindings: Record<string, TabBinding> = (data.bindingsByBookmarkId as Record<string, TabBinding>) || {};
      const byTab: Record<number, string> = (data.bookmarkIdByTabId as Record<number, string>) || {};

      // Verify open tabs to prune any dead bindings
      const allTabs = await chrome.tabs.query({});
      const openTabIdSet = new Set(allTabs.map((t) => t.id).filter((id): id is number => typeof id === 'number'));

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
    } catch (err) {
      console.warn('[Arctic] Failed to read session storage:', err);
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

  /**
   * Track current active tab
   */
  const syncActiveTab = useCallback(async () => {
    try {
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (currentTab?.id) {
        setActiveTabId(currentTab.id);
        currentWindowIdRef.current = currentTab.windowId;
      }
    } catch (err) {
      console.warn('[Arctic] Could not query active tab:', err);
    }
  }, []);

  // Initialize and register event listeners
  useEffect(() => {
    syncActiveTab();
    loadSessionState();

    // Listen to tab activation
    const handleActivated = (activeInfo: chrome.tabs.OnActivatedInfo) => {
      chrome.windows.getCurrent((currentWin) => {
        if (currentWin.id === activeInfo.windowId) {
          setActiveTabId(activeInfo.tabId);
          currentWindowIdRef.current = activeInfo.windowId;
        }
      });
    };

    // Listen to tab removal
    const handleRemoved = (tabId: number) => {
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

    // Listen to tab updates (URL change, navigation away)
    const handleUpdated = (
      tabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab
    ) => {
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

    // Listen to session storage changes from background or other contexts
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
        syncActiveTab();
      }
    };

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onRemoved.addListener(handleRemoved);
    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.windows.onFocusChanged.addListener(handleWindowFocus);
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.windows.onFocusChanged.removeListener(handleWindowFocus);
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [loadSessionState, syncActiveTab]);

  /**
   * Row Body Click Handler:
   * - If bound to an open tab: switch to that tab.
   * - If not bound: check if an unbound tab in current window matches bookmark.url.
   *   If so, bind and switch to it. Otherwise, create a new tab and bind it.
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
      }
    },
    [bindingsByBookmarkId, bookmarkIdByTabId, persistSession]
  );

  /**
   * Favicon Click Handler:
   * - Dedicated click handler (e.stopPropagation()).
   * - If bound to an open tab: switch to it AND immediately navigate back to bookmark.url.
   * - If not bound: opens and binds tab at bookmark.url.
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
            // Activate and reset URL to original bookmark URL
            await chrome.tabs.update(existingBinding.tabId, {
              url: bookmark.url,
              active: true
            });
            if (tab.windowId) {
              await chrome.windows.update(tab.windowId, { focused: true });
            }

            // Immediately clear navigated away state locally
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
            return;
          }
        } catch {
          // Tab dead, fall through
        }
      }

      // Not bound: open and bind
      await handleRowClick(bookmark);
    },
    [bindingsByBookmarkId, bookmarkIdByTabId, handleRowClick, persistSession]
  );

  /**
   * Quick Access Grid Tile Click:
   * - If bound & already active AND isNavigatedAway === true: reset tab to originalUrl.
   * - If bound & not active: focus tab.
   * - If not bound: open & bind.
   */
  const handleQuickAccessClick = useCallback(
    async (bookmark: chrome.bookmarks.BookmarkTreeNode) => {
      if (!bookmark.url) return;
      const binding = bindingsByBookmarkId[bookmark.id];

      if (binding && binding.tabId === activeTabId && binding.isNavigatedAway) {
        // Reset active tab back to original URL
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
        return;
      }

      await handleRowClick(bookmark);
    },
    [activeTabId, bindingsByBookmarkId, bookmarkIdByTabId, handleRowClick, persistSession]
  );

  /**
   * Close / Unbind tab:
   * - Closes the tab without removing the bookmark.
   */
  const handleCloseTab = useCallback(
    async (tabId: number, e: React.MouseEvent) => {
      e.stopPropagation();
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
    },
    [bindingsByBookmarkId, bookmarkIdByTabId, persistSession]
  );

  return {
    bindingsByBookmarkId,
    bookmarkIdByTabId,
    activeTabId,
    handleRowClick,
    handleFaviconClick,
    handleQuickAccessClick,
    handleCloseTab,
    refreshBindings: loadSessionState
  };
}
