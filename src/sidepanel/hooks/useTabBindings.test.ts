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

  it('reloads bound tab via chrome.tabs.reload on handleFaviconDoubleClick and resets URL if navigated away', async () => {
    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    const mockBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: 'bm-reload',
      title: 'GitHub',
      url: 'https://github.com'
    };

    await act(async () => {
      await result.current.handleRowClick(mockBookmark);
    });

    const boundTabId = result.current.bindingsByBookmarkId['bm-reload'].tabId;
    mockChrome.tabs.reload.mockClear();

    // 1. Double-click when on original URL reloads tab via chrome.tabs.reload
    await act(async () => {
      await result.current.handleFaviconDoubleClick(mockBookmark);
    });

    expect(mockChrome.tabs.reload).toHaveBeenCalledWith(boundTabId);
    expect(result.current.tabsByTabId[boundTabId]?.status).toBe('loading');

    // 2. Double-click when navigated away resets URL back to original bookmark URL
    await act(async () => {
      await mockChrome.tabs.update(boundTabId, { url: 'https://github.com/Explore' });
    });
    expect(result.current.bindingsByBookmarkId['bm-reload'].isNavigatedAway).toBe(true);

    await act(async () => {
      await result.current.handleFaviconDoubleClick(mockBookmark);
    });

    const tabAfterDoubleClick = await mockChrome.tabs.get(boundTabId);
    expect(tabAfterDoubleClick.url).toBe('https://github.com');
    expect(result.current.bindingsByBookmarkId['bm-reload'].isNavigatedAway).toBe(false);
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

    // Positive: Search query input uses browser default search engine via chrome.search.query
    await act(async () => {
      await result.current.navigateActiveTab('react component testing');
    });

    expect(mockChrome.search.query).toHaveBeenCalledWith({
      text: 'react component testing',
      tabId: 1
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

  it('navigates active tab back in history via goBackActiveTab', async () => {
    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.goBackActiveTab();
    });

    expect(mockChrome.tabs.goBack).toHaveBeenCalledWith(1);
  });

  it('closes all window tabs while keeping the browser window open with a new blank tab', async () => {
    await mockChrome.tabs.create({ url: 'https://site1.com', active: false });
    await mockChrome.tabs.create({ url: 'https://site2.com', active: false });

    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockChrome.__getTabs().length).toBe(3);

    await act(async () => {
      await result.current.closeAllWindowTabs();
    });

    const remainingTabs = mockChrome.__getTabs();
    expect(remainingTabs.length).toBe(1);
    expect(remainingTabs[0].active).toBe(true);
  });

  it('reloads active tab with and without cache bypass', async () => {
    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    // Normal reload
    await act(async () => {
      await result.current.reloadActiveTab(false);
    });
    expect(mockChrome.tabs.reload).toHaveBeenCalledWith(1, { bypassCache: false });

    // Hard reload (clear cache)
    await act(async () => {
      await result.current.reloadActiveTab(true);
    });
    expect(mockChrome.tabs.reload).toHaveBeenCalledWith(1, { bypassCache: true });
  });

  it('reloads specific tab with and without cache bypass via reloadTab', async () => {
    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.reloadTab(42, true);
    });
    expect(mockChrome.tabs.reload).toHaveBeenCalledWith(42, { bypassCache: true });
  });

  it('pinMultipleTabs pins multiple tabs to target folder and preserves/moves existing bookmarks', async () => {
    mockChrome.__setBookmarksTree([
      {
        id: '0',
        title: 'Root',
        children: [
          {
            id: '2',
            title: 'Other Bookmarks',
            children: [
              {
                id: '10',
                title: 'Arctic',
                children: [
                  { id: '11', title: 'Quick Access', children: [] },
                  { id: '12', title: 'Home', children: [] }
                ]
              }
            ]
          }
        ]
      }
    ]);

    const tabA = { id: 101, url: 'https://site-a.com', title: 'Site A', windowId: 1 } as chrome.tabs.Tab;
    const tabB = { id: 102, url: 'https://site-b.com', title: 'Site B', windowId: 1 } as chrome.tabs.Tab;
    mockChrome.__setTabs([tabA, tabB]);

    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.pinMultipleTabs([tabA, tabB], '12');
    });

    const tree = mockChrome.__getBookmarksTree();
    const home = tree[0].children?.[0].children?.[0].children?.find((c) => c.id === '12');
    expect(home?.children?.length).toBe(2);
    expect(home?.children?.map((c) => c.url)).toEqual(['https://site-a.com', 'https://site-b.com']);

    // Now pin them again to Quick Access (id: '11') - should move rather than create duplicates
    await act(async () => {
      await result.current.pinMultipleTabs([tabA, tabB], '11');
    });

    const updatedTree = mockChrome.__getBookmarksTree();
    const updatedHome = updatedTree[0].children?.[0].children?.[0].children?.find((c) => c.id === '12');
    const updatedQA = updatedTree[0].children?.[0].children?.[0].children?.find((c) => c.id === '11');

    expect(updatedHome?.children?.length).toBe(0);
    expect(updatedQA?.children?.length).toBe(2);
  });

  it('updates bookmark URL and title when docs.new redirects to a Google Document', async () => {
    mockChrome.__setBookmarksTree([
      {
        id: '0',
        title: 'Root',
        children: [
          {
            id: '2',
            title: 'Other Bookmarks',
            children: [
              {
                id: '10',
                title: 'Arctic',
                children: [
                  {
                    id: '12',
                    title: 'Home',
                    children: [
                      { id: 'doc-bm', title: 'New Google Doc', url: 'https://docs.new' }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);

    mockChrome.__setSessionStorage({
      bindingsByBookmarkId: {
        'doc-bm': {
          bookmarkId: 'doc-bm',
          tabId: 50,
          windowId: 1,
          originalUrl: 'https://docs.new',
          currentUrl: 'https://docs.new',
          currentTitle: 'New Google Doc',
          isNavigatedAway: false
        }
      },
      bookmarkIdByTabId: { 50: 'doc-bm' }
    });

    mockChrome.__setTabs([
      {
        id: 50,
        windowId: 1,
        url: 'https://docs.new',
        title: 'New Google Doc',
        active: true
      } as chrome.tabs.Tab
    ]);

    renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await mockChrome.tabs.update(50, {
        url: 'https://docs.google.com/document/d/1a2b3c/edit',
        title: 'Sprint Planning - Google Docs'
      } as any);
    });

    expect(mockChrome.bookmarks.update).toHaveBeenCalledWith('doc-bm', {
      url: 'https://docs.google.com/document/d/1a2b3c/edit',
      title: 'Sprint Planning'
    });
  });

  it('reconciles open browser tabs with bookmarks on startup when session is empty (reinstall scenario)', async () => {
    mockChrome.__setTabs([
      {
        id: 77,
        windowId: 10,
        url: 'https://github.com/my-repo',
        title: 'My Repo',
        active: false
      } as chrome.tabs.Tab,
      {
        id: 88,
        windowId: 10,
        url: 'https://random-article.com',
        title: 'Random Article',
        active: true
      } as chrome.tabs.Tab
    ]);

    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    // Before reconciliation, both tabs are unpinned
    expect(result.current.unpinnedTabs.length).toBe(2);

    const mockBookmarkTree: chrome.bookmarks.BookmarkTreeNode[] = [
      {
        id: 'folder-qa',
        title: 'Quick Access',
        children: [
          {
            id: 'bm-github',
            title: 'My GitHub Repo',
            url: 'https://github.com/my-repo/'
          }
        ]
      }
    ];

    await act(async () => {
      await result.current.reconcileTabsWithBookmarks(mockBookmarkTree);
    });

    // Tab 77 is now bound to 'bm-github'
    expect(result.current.bookmarkIdByTabId[77]).toBe('bm-github');
    expect(result.current.bindingsByBookmarkId['bm-github']).toBeDefined();
    expect(result.current.bindingsByBookmarkId['bm-github'].tabId).toBe(77);

    // Only tab 88 remains in unpinnedTabs
    expect(result.current.unpinnedTabs.length).toBe(1);
    expect(result.current.unpinnedTabs[0].id).toBe(88);
  });

  it('manages space scoping with setTabSpace and moveTabsToSpace', async () => {
    mockChrome.__setTabs([
      {
        id: 101,
        windowId: 10,
        url: 'https://work.slack.com',
        title: 'Slack',
        active: true
      } as chrome.tabs.Tab,
      {
        id: 102,
        windowId: 10,
        url: 'https://youtube.com',
        title: 'YouTube',
        active: false
      } as chrome.tabs.Tab
    ]);

    const { result } = renderHook(() => useTabBindings('space-work'));
    await act(async () => {
      await Promise.resolve();
    });

    // Explicitly set space for tab 101
    await act(async () => {
      await result.current.setTabSpace(101, 'space-work');
    });

    expect(result.current.tabSpaceByTabId[101]).toBe('space-work');

    // Move multiple tabs to personal space
    await act(async () => {
      await result.current.moveTabsToSpace([101, 102], 'space-personal');
    });

    expect(result.current.tabSpaceByTabId[101]).toBe('space-personal');
    expect(result.current.tabSpaceByTabId[102]).toBe('space-personal');
  });

  it('closes only the specified space unpinned tabs via closeSpaceUnpinnedTabs', async () => {
    mockChrome.__setTabs([
      {
        id: 201,
        windowId: 10,
        url: 'https://tab1.com',
        title: 'Tab 1',
        active: false
      } as chrome.tabs.Tab,
      {
        id: 202,
        windowId: 10,
        url: 'https://tab2.com',
        title: 'Tab 2',
        active: true
      } as chrome.tabs.Tab
    ]);

    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    // Close only tab 201
    await act(async () => {
      await result.current.closeSpaceUnpinnedTabs([201]);
    });

    expect(mockChrome.tabs.remove).toHaveBeenCalledWith([201]);
  });

  it('excludes Arctic Command / newtab tabs from unpinnedTabs until the user searches or navigates', async () => {
    mockChrome.__setTabs([
      {
        id: 301,
        windowId: 10,
        url: 'https://news.ycombinator.com',
        title: 'Hacker News',
        active: false
      } as chrome.tabs.Tab,
      {
        id: 302,
        windowId: 10,
        url: 'chrome-extension://mock-extension-id/command.html',
        title: 'Arctic Command',
        active: true
      } as chrome.tabs.Tab
    ]);

    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    // While Arctic Command is open, tab 302 is NOT in Today's Tabs (unpinnedTabs)
    expect(result.current.unpinnedTabs.map((t) => t.id)).toEqual([301]);

    // Once user searches for something and tab 302 navigates to a search URL, it appears in Today's Tabs
    await act(async () => {
      await mockChrome.tabs.update(302, {
        url: 'https://www.youtube.com/results?search_query=music',
        title: 'music - YouTube'
      } as any);
    });

    expect(result.current.unpinnedTabs.map((t) => t.id)).toEqual([301, 302]);
    expect(result.current.unpinnedTabs.find((t) => t.id === 302)?.title).toBe('music - YouTube');
  });

  it('unpins an open bound tab via unpinBookmarkTab so it immediately appears in unpinnedTabs and is not re-bound by reconcileTabsWithBookmarks', async () => {
    mockChrome.__setTabs([
      {
        id: 401,
        windowId: 10,
        url: 'https://linear.app/issue/123',
        title: 'Linear Issue 123',
        active: true
      } as chrome.tabs.Tab
    ]);
    mockChrome.__setSessionStorage({
      bindingsByBookmarkId: {
        'bm-linear': {
          bookmarkId: 'bm-linear',
          tabId: 401,
          windowId: 10,
          originalUrl: 'https://linear.app/issue/123',
          currentUrl: 'https://linear.app/issue/123',
          currentTitle: 'Linear Issue 123',
          isNavigatedAway: false
        }
      },
      bookmarkIdByTabId: { 401: 'bm-linear' }
    });

    const { result } = renderHook(() => useTabBindings('space-work'));
    await act(async () => {
      await Promise.resolve();
    });

    // Initially bound to bm-linear, so unpinnedTabs is empty
    expect(result.current.unpinnedTabs).toHaveLength(0);

    // Unpin the bookmark in space-work
    await act(async () => {
      await result.current.unpinBookmarkTab(
        {
          id: 'bm-linear',
          title: 'Linear Issue 123',
          url: 'https://linear.app/issue/123'
        },
        'space-work'
      );
    });

    // Tab 401 is now unbound and assigned to space-work
    expect(result.current.bindingsByBookmarkId['bm-linear']).toBeUndefined();
    expect(result.current.bookmarkIdByTabId[401]).toBeUndefined();
    expect(result.current.tabSpaceByTabId[401]).toBe('space-work');
    expect(result.current.unpinnedTabs.map((t) => t.id)).toEqual([401]);

    // Even if reconcileTabsWithBookmarks runs while bookmark tree still has bm-linear, it must NOT re-bind tab 401
    await act(async () => {
      await result.current.reconcileTabsWithBookmarks([
        {
          id: 'folder-work',
          title: 'Work',
          children: [
            {
              id: 'bm-linear',
              title: 'Linear Issue 123',
              url: 'https://linear.app/issue/123'
            }
          ]
        }
      ]);
    });

    expect(result.current.bookmarkIdByTabId[401]).toBeUndefined();
    expect(result.current.unpinnedTabs.map((t) => t.id)).toEqual([401]);
  });

  it('closes opened empty Arctic Command tabs when focus switches to another tab or Cmd+T is pressed repeatedly', async () => {
    mockChrome.__setTabs([
      {
        id: 501,
        windowId: 10,
        url: 'https://news.ycombinator.com',
        title: 'Hacker News',
        active: false
      } as chrome.tabs.Tab,
      {
        id: 502,
        windowId: 10,
        url: 'chrome-extension://mock-extension-id/command.html',
        title: 'Arctic Command',
        active: true
      } as chrome.tabs.Tab
    ]);

    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    // Pressing Cmd+T opens another empty Arctic Command tab (id: 503) and focuses it
    await act(async () => {
      await mockChrome.tabs.create({
        url: 'chrome-extension://mock-extension-id/command.html',
        active: true,
        windowId: 10
      });
    });

    // Previous empty Arctic Command tab (502) should be closed automatically, leaving 501 and 503
    expect(mockChrome.__getTabs().map((t) => t.id)).toEqual([501, 503]);

    // Now switch focus to the existing Hacker News tab (501)
    await act(async () => {
      await result.current.focusTab(501);
    });

    // The unfocused empty Arctic Command tab (503) is also closed automatically
    expect(mockChrome.__getTabs().map((t) => t.id)).toEqual([501]);
    expect(result.current.activeTabId).toBe(501);
  });

  it('reconciles sleeping tabs with pendingUrl and session-restored tabs whose URL arrives asynchronously via onUpdated', async () => {
    mockChrome.__setTabs([
      {
        id: 601,
        windowId: 10,
        url: '',
        pendingUrl: 'https://linear.app/team/inbox',
        title: 'Linear Inbox',
        discarded: true,
        active: false
      } as chrome.tabs.Tab,
      {
        id: 602,
        windowId: 10,
        url: '',
        pendingUrl: '',
        title: '',
        discarded: true,
        status: 'loading',
        active: false
      } as chrome.tabs.Tab,
      {
        id: 603,
        windowId: 10,
        url: 'https://news.ycombinator.com',
        title: 'Hacker News',
        active: true
      } as chrome.tabs.Tab
    ]);
    mockChrome.__setSessionStorage({});

    const bookmarkTree: chrome.bookmarks.BookmarkTreeNode[] = [
      {
        id: 'folder-work',
        title: 'Work',
        children: [
          {
            id: 'bm-linear',
            title: 'Linear',
            url: 'https://linear.app/team/inbox'
          },
          {
            id: 'bm-figma',
            title: 'Figma Design',
            url: 'https://figma.com/file/abc'
          }
        ]
      }
    ];

    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await result.current.reconcileTabsWithBookmarks(bookmarkTree);
    });

    // Sleeping tab 601 (with pendingUrl) is bound immediately
    expect(result.current.bookmarkIdByTabId[601]).toBe('bm-linear');
    expect(result.current.bindingsByBookmarkId['bm-linear']?.tabId).toBe(601);

    // Tab 602 did not have its URL yet; now simulate Chrome populating its URL during session restore
    await act(async () => {
      await mockChrome.__triggerTabUpdated(602, {
        url: 'https://www.figma.com/file/abc',
        title: 'Figma Design',
        status: 'complete'
      });
      await Promise.resolve();
    });

    // Tab 602 is automatically reconciled to bm-figma and removed from Today's Tabs
    expect(result.current.bookmarkIdByTabId[602]).toBe('bm-figma');
    expect(result.current.bindingsByBookmarkId['bm-figma']?.tabId).toBe(602);
    expect(result.current.unpinnedTabs.map((t) => t.id)).toEqual([603]);
  });

  it('persists navigated-away bindings across browser restarts (isWindowClosing: true) and cleans them up on normal tab close', async () => {
    mockChrome.__setTabs([
      {
        id: 701,
        windowId: 10,
        url: 'https://github.com',
        title: 'GitHub',
        active: true
      } as chrome.tabs.Tab
    ]);
    mockChrome.__setSessionStorage({});

    const bookmarkTree: chrome.bookmarks.BookmarkTreeNode[] = [
      {
        id: 'folder-home',
        title: 'Home',
        children: [
          {
            id: 'bm-gh',
            title: 'GitHub',
            url: 'https://github.com'
          }
        ]
      }
    ];

    const firstMount = renderHook(() => useTabBindings());
    await act(async () => {
      await firstMount.result.current.reconcileTabsWithBookmarks(bookmarkTree);
    });
    expect(firstMount.result.current.bookmarkIdByTabId[701]).toBe('bm-gh');

    // Navigate the bound GitHub tab deep into a pull request page
    await act(async () => {
      await mockChrome.__triggerTabUpdated(701, {
        url: 'https://github.com/facebook/react/pull/9999',
        title: 'PR #9999',
        status: 'complete'
      });
    });
    expect(firstMount.result.current.bindingsByBookmarkId['bm-gh']?.isNavigatedAway).toBe(true);

    // Simulate browser quit: Chrome fires onRemoved with isWindowClosing: true and wipes session storage
    await act(async () => {
      await mockChrome.__triggerTabRemoved(701, true);
    });
    firstMount.unmount();

    // Verify persistedBindingsByBookmarkId survived window closing!
    expect(
      (mockChrome.__getLocalStorage().persistedBindingsByBookmarkId as Record<string, any>)?.[
        'bm-gh'
      ]?.currentUrl
    ).toBe('https://github.com/facebook/react/pull/9999');

    // Simulate browser restart: session storage is empty, and restored tab gets a brand-new tabId (850) in sleeping state
    mockChrome.__setSessionStorage({});
    mockChrome.__setTabs([
      {
        id: 850,
        windowId: 10,
        url: 'https://github.com/facebook/react/pull/9999',
        title: 'PR #9999',
        discarded: true,
        active: false
      } as chrome.tabs.Tab
    ]);

    const afterRestart = renderHook(() => useTabBindings());
    await act(async () => {
      await afterRestart.result.current.reconcileTabsWithBookmarks(bookmarkTree);
    });

    // Sleeping navigated-away tab 850 is re-linked to bm-gh instead of falling into Today's Tabs!
    expect(afterRestart.result.current.bookmarkIdByTabId[850]).toBe('bm-gh');
    expect(afterRestart.result.current.bindingsByBookmarkId['bm-gh']?.isNavigatedAway).toBe(true);
    expect(afterRestart.result.current.unpinnedTabs).toHaveLength(0);

    // Now close tab 850 normally (isWindowClosing: false) -> persisted binding should be removed
    await act(async () => {
      await mockChrome.__triggerTabRemoved(850, false);
    });
    expect(
      (mockChrome.__getLocalStorage().persistedBindingsByBookmarkId as Record<string, any>)?.[
        'bm-gh'
      ]
    ).toBeUndefined();
  });

  it('wakes and binds canonical-redirected sleeping tabs (e.g. Gmail, Google Docs ?tab=t.0) without opening duplicate tabs', async () => {
    mockChrome.__setSessionStorage({});
    mockChrome.__setLocalStorage({});
    mockChrome.__setTabs([
      {
        id: 901,
        windowId: 10,
        url: 'https://mail.google.com/mail/u/0/#inbox',
        title: 'Inbox - Gmail',
        discarded: true,
        active: false
      } as chrome.tabs.Tab,
      {
        id: 902,
        windowId: 10,
        url: 'https://docs.google.com/document/d/1DocAbcXYZ/edit?tab=t.0',
        title: 'Project Spec - Google Docs',
        discarded: true,
        active: false
      } as chrome.tabs.Tab
    ]);

    const gmailBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: 'bm-gmail',
      title: 'Gmail',
      url: 'https://gmail.com'
    };
    const docBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: 'bm-doc',
      title: 'Project Spec',
      url: 'https://docs.google.com/document/d/1DocAbcXYZ/edit?usp=sharing'
    };

    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    mockChrome.tabs.create.mockClear();

    // Even BEFORE reconcileTabsWithBookmarks runs, clicking the Gmail bookmark wakes sleeping tab 901 instead of creating a duplicate!
    await act(async () => {
      await result.current.handleRowClick(gmailBookmark);
    });

    expect(mockChrome.tabs.create).not.toHaveBeenCalled();
    expect(result.current.bookmarkIdByTabId[901]).toBe('bm-gmail');
    expect(result.current.activeTabId).toBe(901);

    // Running reconcileTabsWithBookmarks also links the redirected sleeping Google Doc tab 902
    await act(async () => {
      await result.current.reconcileTabsWithBookmarks([
        { id: 'folder-qa', title: 'Quick Access', children: [gmailBookmark, docBookmark] }
      ]);
    });

    expect(result.current.bookmarkIdByTabId[902]).toBe('bm-doc');
    expect(result.current.unpinnedTabs).toHaveLength(0);
  });

  it('migrates bookmark bindings and tab space assignments when Chrome replaces a sleeping/discarded tab ID via onReplaced', async () => {
    mockChrome.__setTabs([
      {
        id: 950,
        windowId: 10,
        url: 'https://notion.so/workspace',
        title: 'Notion',
        discarded: true,
        active: false
      } as chrome.tabs.Tab
    ]);
    mockChrome.__setSessionStorage({
      bindingsByBookmarkId: {
        'bm-notion': {
          bookmarkId: 'bm-notion',
          tabId: 950,
          windowId: 10,
          originalUrl: 'https://notion.so/workspace',
          currentUrl: 'https://notion.so/workspace',
          currentTitle: 'Notion',
          isNavigatedAway: false
        }
      },
      bookmarkIdByTabId: { 950: 'bm-notion' }
    });

    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.bookmarkIdByTabId[950]).toBe('bm-notion');

    // Simulate Chrome replacing discarded tab 950 with tab 951 on wake
    await act(async () => {
      await mockChrome.__triggerTabReplaced(951, 950);
    });

    expect(result.current.bookmarkIdByTabId[950]).toBeUndefined();
    expect(result.current.bookmarkIdByTabId[951]).toBe('bm-notion');
    expect(result.current.bindingsByBookmarkId['bm-notion']?.tabId).toBe(951);
    expect(result.current.unpinnedTabs).toHaveLength(0);
  });

  it('gates auto-archive tab closing until after bookmark reconciliation runs so sleeping pinned tabs are never closed prematurely', async () => {
    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
    mockChrome.__setTabs([
      {
        id: 1,
        windowId: 10,
        url: 'https://active.com',
        title: 'Active Tab',
        active: true
      } as chrome.tabs.Tab,
      {
        id: 2,
        windowId: 10,
        url: 'https://linear.app',
        title: 'Sleeping Pinned Linear',
        discarded: true,
        active: false
      } as chrome.tabs.Tab,
      {
        id: 3,
        windowId: 10,
        url: 'https://old-temp.com',
        title: 'Old Unpinned Tab',
        discarded: true,
        active: false
      } as chrome.tabs.Tab
    ]);
    mockChrome.__setSessionStorage({});
    mockChrome.__setLocalStorage({
      autoArchiveInterval: '12h',
      tabOpenedAt: {
        1: twoDaysAgo,
        2: twoDaysAgo,
        3: twoDaysAgo
      }
    });

    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    // Before reconcileTabsWithBookmarks runs, NEITHER tab 2 nor tab 3 was closed prematurely!
    expect(mockChrome.__getTabs().map((t) => t.id)).toEqual([1, 2, 3]);

    // Now reconcile bookmarks (binding tab 2 to bm-linear) and re-run session/archive check
    await act(async () => {
      await result.current.reconcileTabsWithBookmarks([
        {
          id: 'folder-work',
          title: 'Work',
          children: [{ id: 'bm-linear', title: 'Linear', url: 'https://linear.app' }]
        }
      ]);
      await result.current.refreshBindings();
    });

    // Bound sleeping tab 2 is preserved, while expired unpinned tab 3 is archived!
    expect(mockChrome.__getTabs().map((t) => t.id)).toEqual([1, 2]);
    expect(result.current.bookmarkIdByTabId[2]).toBe('bm-linear');
  });

  it('migrates bookmark bindings when chrome.tabs.discard returns a new tab ID in discardTab and discardAllBackgroundTabs', async () => {
    mockChrome.__setTabs([
      {
        id: 1,
        windowId: 10,
        url: 'https://active.com',
        title: 'Active',
        active: true,
        discarded: false
      } as chrome.tabs.Tab,
      {
        id: 10,
        windowId: 10,
        url: 'https://github.com',
        title: 'GitHub',
        active: false,
        discarded: false
      } as chrome.tabs.Tab,
      {
        id: 20,
        windowId: 10,
        url: 'https://figma.com',
        title: 'Figma',
        active: false,
        discarded: false
      } as chrome.tabs.Tab
    ]);
    mockChrome.__setSessionStorage({
      bindingsByBookmarkId: {
        'bm-gh': {
          bookmarkId: 'bm-gh',
          tabId: 10,
          windowId: 10,
          originalUrl: 'https://github.com',
          currentUrl: 'https://github.com',
          currentTitle: 'GitHub',
          isNavigatedAway: false
        },
        'bm-figma': {
          bookmarkId: 'bm-figma',
          tabId: 20,
          windowId: 10,
          originalUrl: 'https://figma.com',
          currentUrl: 'https://figma.com',
          currentTitle: 'Figma',
          isNavigatedAway: false
        }
      },
      bookmarkIdByTabId: { 10: 'bm-gh', 20: 'bm-figma' }
    });

    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    // Mock chrome.tabs.discard to swap tab IDs (10 -> 110, 20 -> 120) as older/certain Chromium builds do
    mockChrome.tabs.discard
      .mockImplementationOnce(async () => {
        const tabs = mockChrome.__getTabs();
        const t = tabs.find((x) => x.id === 10)!;
        t.id = 110;
        t.discarded = true;
        return { ...t };
      })
      .mockImplementationOnce(async () => {
        const tabs = mockChrome.__getTabs();
        const t = tabs.find((x) => x.id === 20)!;
        t.id = 120;
        t.discarded = true;
        return { ...t };
      });

    await act(async () => {
      await result.current.discardTab(10);
    });
    expect(result.current.bookmarkIdByTabId[110]).toBe('bm-gh');
    expect(result.current.bindingsByBookmarkId['bm-gh']?.tabId).toBe(110);

    await act(async () => {
      await result.current.discardAllBackgroundTabs();
    });
    expect(result.current.bookmarkIdByTabId[120]).toBe('bm-figma');
    expect(result.current.bindingsByBookmarkId['bm-figma']?.tabId).toBe(120);
  });

  it('does not open duplicate tabs when chrome.windows.update rejects during handleRowClick, handleFaviconClick, or handleFaviconDoubleClick', async () => {
    mockChrome.__setTabs([
      {
        id: 42,
        windowId: 10,
        url: 'https://github.com/pulls',
        title: 'Pull Requests',
        active: false
      } as chrome.tabs.Tab
    ]);
    mockChrome.__setSessionStorage({
      bindingsByBookmarkId: {
        'bm-gh': {
          bookmarkId: 'bm-gh',
          tabId: 42,
          windowId: 10,
          originalUrl: 'https://github.com',
          currentUrl: 'https://github.com/pulls',
          currentTitle: 'Pull Requests',
          isNavigatedAway: true
        }
      },
      bookmarkIdByTabId: { 42: 'bm-gh' }
    });

    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    mockChrome.windows.update.mockRejectedValue(new Error('Window focus temporarily unavailable'));
    mockChrome.tabs.create.mockClear();

    const ghBm: chrome.bookmarks.BookmarkTreeNode = {
      id: 'bm-gh',
      title: 'GitHub',
      url: 'https://github.com'
    };

    await act(async () => {
      await result.current.handleRowClick(ghBm);
      await result.current.handleFaviconClick(ghBm);
      await result.current.handleFaviconDoubleClick(ghBm);
    });

    // Must NEVER fall through to creating a duplicate tab when windows.update throws!
    expect(mockChrome.tabs.create).not.toHaveBeenCalled();

    // Reset mock implementation for subsequent tests
    mockChrome.windows.update.mockResolvedValue(undefined);
  });

  it('cleans up persistedBindingsByBookmarkId on handleCloseTab, unpinBookmarkTab, and closeAllWindowTabs', async () => {
    mockChrome.__setTabs([
      {
        id: 11,
        windowId: 10,
        url: 'https://a.com/sub',
        title: 'A',
        active: true
      } as chrome.tabs.Tab,
      {
        id: 12,
        windowId: 10,
        url: 'https://b.com/sub',
        title: 'B',
        active: false
      } as chrome.tabs.Tab,
      {
        id: 13,
        windowId: 10,
        url: 'https://c.com/sub',
        title: 'C',
        active: false
      } as chrome.tabs.Tab
    ]);

    const initialBindings = {
      'bm-a': {
        bookmarkId: 'bm-a',
        tabId: 11,
        windowId: 10,
        originalUrl: 'https://a.com',
        currentUrl: 'https://a.com/sub',
        currentTitle: 'A',
        isNavigatedAway: true
      },
      'bm-b': {
        bookmarkId: 'bm-b',
        tabId: 12,
        windowId: 10,
        originalUrl: 'https://b.com',
        currentUrl: 'https://b.com/sub',
        currentTitle: 'B',
        isNavigatedAway: true
      },
      'bm-c': {
        bookmarkId: 'bm-c',
        tabId: 13,
        windowId: 10,
        originalUrl: 'https://c.com',
        currentUrl: 'https://c.com/sub',
        currentTitle: 'C',
        isNavigatedAway: true
      }
    };

    mockChrome.__setSessionStorage({
      bindingsByBookmarkId: initialBindings,
      bookmarkIdByTabId: { 11: 'bm-a', 12: 'bm-b', 13: 'bm-c' }
    });
    mockChrome.__setLocalStorage({
      persistedBindingsByBookmarkId: {
        'bm-a': { ...initialBindings['bm-a'], updatedAt: 1 },
        'bm-b': { ...initialBindings['bm-b'], updatedAt: 1 },
        'bm-c': { ...initialBindings['bm-c'], updatedAt: 1 }
      }
    });

    const { result } = renderHook(() => useTabBindings());
    await act(async () => {
      await Promise.resolve();
    });

    // 1. handleCloseTab removes bm-a from persistedBindingsByBookmarkId
    await act(async () => {
      await result.current.handleCloseTab(11);
    });
    expect(
      (mockChrome.__getLocalStorage().persistedBindingsByBookmarkId as Record<string, any>)?.[
        'bm-a'
      ]
    ).toBeUndefined();
    expect(
      (mockChrome.__getLocalStorage().persistedBindingsByBookmarkId as Record<string, any>)?.[
        'bm-b'
      ]
    ).toBeDefined();

    // 2. unpinBookmarkTab removes bm-b from persistedBindingsByBookmarkId
    await act(async () => {
      await result.current.unpinBookmarkTab({ id: 'bm-b', title: 'B', url: 'https://b.com' });
    });
    expect(
      (mockChrome.__getLocalStorage().persistedBindingsByBookmarkId as Record<string, any>)?.[
        'bm-b'
      ]
    ).toBeUndefined();
    expect(
      (mockChrome.__getLocalStorage().persistedBindingsByBookmarkId as Record<string, any>)?.[
        'bm-c'
      ]
    ).toBeDefined();

    // 3. closeAllWindowTabs clears all remaining persistedBindingsByBookmarkId
    await act(async () => {
      await result.current.closeAllWindowTabs();
    });
    expect(mockChrome.__getLocalStorage().persistedBindingsByBookmarkId).toBeUndefined();
  });
});
