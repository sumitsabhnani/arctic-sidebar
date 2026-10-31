import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTabBindings } from './useTabBindings';
import { mockChrome } from '../../test/setup';

describe('useTabBindings hook', () => {
  beforeEach(() => {
    mockChrome.__resetAll();
  });

  it('tracks open window tabs and identifies active tab and unpinned tabs', async () => {
    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.activeTabId).toBe(1);
    expect(result.current.unpinnedTabs.length).toBe(1);
    expect(result.current.unpinnedTabs[0].url).toBe('https://example.com');
  });

  it('binds a bookmark to a newly created tab on row click (positive)', async () => {
    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    const mockBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: 'bm-1',
      title: 'GitHub',
      url: 'https://github.com'
    };

    await act(async () => {
      await result.current.handleRowClick(mockBookmark);
    });

    // Check binding was created in session storage and state
    const binding = result.current.bindingsByBookmarkId['bm-1'];
    expect(binding).toBeDefined();
    expect(binding.originalUrl).toBe('https://github.com');
    expect(binding.isNavigatedAway).toBe(false);
    expect(result.current.bookmarkIdByTabId[binding.tabId]).toBe('bm-1');
  });

  it('switches to existing tab if already bound to that bookmark', async () => {
    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    const mockBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: 'bm-1',
      title: 'GitHub',
      url: 'https://github.com'
    };

    // First click creates tab and binds it
    await act(async () => {
      await result.current.handleRowClick(mockBookmark);
    });

    const boundTabId = result.current.bindingsByBookmarkId['bm-1'].tabId;
    const initialTabsCount = mockChrome.__getTabs().length;

    // Second click on the same bookmark focuses existing tab without opening a duplicate tab
    await act(async () => {
      await result.current.handleRowClick(mockBookmark);
    });

    expect(mockChrome.__getTabs().length).toBe(initialTabsCount);
    expect(result.current.activeTabId).toBe(boundTabId);
  });

  it('detects when a bound tab has navigated away from original bookmarked URL', async () => {
    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    const mockBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: 'bm-linear',
      title: 'Linear Dashboard',
      url: 'https://linear.app/dashboard'
    };

    await act(async () => {
      await result.current.handleRowClick(mockBookmark);
    });

    const boundTabId = result.current.bindingsByBookmarkId['bm-linear'].tabId;

    // Simulate tab navigating to another page
    await act(async () => {
      await mockChrome.tabs.update(boundTabId, { url: 'https://linear.app/issues/100' });
    });

    const updatedBinding = result.current.bindingsByBookmarkId['bm-linear'];
    expect(updatedBinding.isNavigatedAway).toBe(true);
    expect(updatedBinding.currentUrl).toBe('https://linear.app/issues/100');
  });

  it('resets navigated tab back to original bookmarked URL on favicon click', async () => {
    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    const mockBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: 'bm-linear',
      title: 'Linear Dashboard',
      url: 'https://linear.app/dashboard'
    };

    await act(async () => {
      await result.current.handleRowClick(mockBookmark);
    });

    const boundTabId = result.current.bindingsByBookmarkId['bm-linear'].tabId;

    await act(async () => {
      await mockChrome.tabs.update(boundTabId, { url: 'https://linear.app/issues/100' });
    });

    expect(result.current.bindingsByBookmarkId['bm-linear'].isNavigatedAway).toBe(true);

    // Favicon click resets tab URL back to original bookmarked URL
    await act(async () => {
      await result.current.handleFaviconClick(mockBookmark);
    });

    const tabAfterReset = await mockChrome.tabs.get(boundTabId);
    expect(tabAfterReset.url).toBe('https://linear.app/dashboard');
    expect(result.current.bindingsByBookmarkId['bm-linear'].isNavigatedAway).toBe(false);
  });

  it('cleans up tab binding when tab is closed via handleCloseTab or onRemoved listener', async () => {
    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    const mockBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: 'bm-close',
      title: 'Twitter',
      url: 'https://x.com'
    };

    await act(async () => {
      await result.current.handleRowClick(mockBookmark);
    });

    const tabId = result.current.bindingsByBookmarkId['bm-close'].tabId;
    expect(result.current.bindingsByBookmarkId['bm-close']).toBeDefined();

    // Close tab
    await act(async () => {
      await result.current.handleCloseTab(tabId);
    });

    expect(result.current.bindingsByBookmarkId['bm-close']).toBeUndefined();
    expect(result.current.bookmarkIdByTabId[tabId]).toBeUndefined();
  });

  it('toggles tab audio mute status for both tab object and tab ID (positive)', async () => {
    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    const activeTab = result.current.unpinnedTabs[0];
    expect(activeTab.mutedInfo?.muted).toBe(false);

    // Mute via tab object
    await act(async () => {
      await result.current.toggleMuteTab(activeTab);
    });
    let updatedTab = await mockChrome.tabs.get(activeTab.id!);
    expect(updatedTab.mutedInfo?.muted).toBe(true);

    // Unmute via tab ID
    await act(async () => {
      await result.current.toggleMuteTab(activeTab.id!);
    });
    updatedTab = await mockChrome.tabs.get(activeTab.id!);
    expect(updatedTab.mutedInfo?.muted).toBe(false);
  });

  it('navigates active tab from top address bar with URL or Google search fallback', async () => {
    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    // Positive: Direct URL input
    await act(async () => {
      await result.current.navigateActiveTab('github.com/trending');
    });

    let tab = await mockChrome.tabs.get(1);
    expect(tab.url).toBe('https://github.com/trending');

    // Positive: Search query input fallback
    await act(async () => {
      await result.current.navigateActiveTab('react component testing');
    });

    tab = await mockChrome.tabs.get(1);
    expect(tab.url).toBe('https://www.google.com/search?q=react%20component%20testing');

    // Negative: Empty input does nothing
    await act(async () => {
      await result.current.navigateActiveTab('   ');
    });
    expect(tab.url).toBe('https://www.google.com/search?q=react%20component%20testing');
  });

  it('discards background tabs to save memory', async () => {
    // Add two background tabs
    await mockChrome.tabs.create({ url: 'https://reddit.com', active: false });
    await mockChrome.tabs.create({ url: 'https://youtube.com', active: false });

    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      const count = await result.current.discardAllBackgroundTabs();
      expect(count).toBe(2);
    });

    const allTabs = mockChrome.__getTabs();
    const backgroundTabs = allTabs.filter((t) => !t.active);
    expect(backgroundTabs.every((t) => t.discarded)).toBe(true);
  });
});
