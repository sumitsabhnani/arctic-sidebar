import { describe, it, expect, beforeEach } from 'vitest';
import {
  PERSISTED_BINDINGS_STORAGE_KEY,
  clearAllPersistedBindings,
  collectBookmarkLeaves,
  fetchAllArcticBookmarkNodes,
  findMatchingUnboundTabForBookmark,
  getPersistedBindings,
  isArcticCommandTab,
  reconcileTabsAndBookmarksState,
  removePersistedBindings,
  upsertPersistedBindings
} from './reconcileBindings';
import { mockChrome } from '../../test/setup';
import type { TabBinding } from '../../types';

describe('reconcileBindings utilities', () => {
  beforeEach(() => {
    mockChrome.__resetAll();
  });

  describe('isArcticCommandTab', () => {
    it('identifies newtab and Arctic Command tabs while excluding tabs navigating to real URLs', () => {
      expect(
        isArcticCommandTab({
          url: 'chrome://newtab/',
          title: 'New Tab'
        } as chrome.tabs.Tab)
      ).toBe(true);

      expect(
        isArcticCommandTab({
          url: 'chrome-extension://mock-extension-id/command.html',
          title: 'Arctic Command'
        } as chrome.tabs.Tab)
      ).toBe(true);

      expect(
        isArcticCommandTab({
          url: 'about:blank',
          title: 'Arctic Command'
        } as chrome.tabs.Tab)
      ).toBe(true);

      // Once pendingUrl or url points to a real web destination, it is no longer an empty Command tab
      expect(
        isArcticCommandTab({
          url: 'chrome-extension://mock-extension-id/command.html',
          pendingUrl: 'https://github.com',
          title: 'Arctic Command'
        } as chrome.tabs.Tab)
      ).toBe(false);

      expect(
        isArcticCommandTab({
          url: 'https://linear.app',
          title: 'Linear'
        } as chrome.tabs.Tab)
      ).toBe(false);
    });
  });

  describe('persisted bindings storage helpers', () => {
    it('serializes concurrent upserts and removals and clears all persisted bindings cleanly', async () => {
      const bindingA: TabBinding = {
        bookmarkId: 'bm-a',
        tabId: 10,
        windowId: 10,
        originalUrl: 'https://github.com',
        currentUrl: 'https://github.com/pulls',
        currentTitle: 'Pull Requests',
        isNavigatedAway: true
      };
      const bindingB: TabBinding = {
        bookmarkId: 'bm-b',
        tabId: 11,
        windowId: 10,
        originalUrl: 'https://linear.app',
        currentUrl: 'https://linear.app/issue/42',
        currentTitle: 'Issue 42',
        isNavigatedAway: true
      };

      // Concurrent upserts must not clobber each other
      await Promise.all([
        upsertPersistedBindings({ 'bm-a': bindingA }),
        upsertPersistedBindings({ 'bm-b': bindingB })
      ]);

      let stored = await getPersistedBindings();
      expect(Object.keys(stored).sort()).toEqual(['bm-a', 'bm-b']);
      expect(stored['bm-a'].currentUrl).toBe('https://github.com/pulls');
      expect(stored['bm-b'].currentUrl).toBe('https://linear.app/issue/42');

      // Remove only bm-a
      await removePersistedBindings(['bm-a']);
      stored = await getPersistedBindings();
      expect(stored['bm-a']).toBeUndefined();
      expect(stored['bm-b']).toBeDefined();

      // Clear all persisted bindings
      await clearAllPersistedBindings();
      expect(mockChrome.__getLocalStorage()[PERSISTED_BINDINGS_STORAGE_KEY]).toBeUndefined();
      expect(await getPersistedBindings()).toEqual({});
    });
  });

  describe('collectBookmarkLeaves and fetchAllArcticBookmarkNodes', () => {
    it('deduplicates overlapping subtrees, excludes scratchpad bookmarks, and respects excludedBookmarkIds', () => {
      const qaSubtree: chrome.bookmarks.BookmarkTreeNode = {
        id: 'qa-1',
        title: 'Quick Access',
        children: [
          { id: 'bm-1', title: 'Gmail', url: 'https://gmail.com' },
          { id: 'bm-scratch', title: 'Scratchpad Backup', url: 'https://arctic.local/scratchpad#1' }
        ]
      };
      const homeSubtree: chrome.bookmarks.BookmarkTreeNode = {
        id: 'home-1',
        title: 'Home',
        children: [
          qaSubtree, // nested duplicate reference
          { id: 'bm-2', title: 'Docs', url: 'https://docs.google.com' },
          { id: 'bm-excluded', title: 'Excluded', url: 'https://excluded.com' }
        ]
      };

      const leaves = collectBookmarkLeaves(
        [qaSubtree, homeSubtree],
        new Set(['bm-excluded'])
      );

      expect(leaves.map((l) => l.id)).toEqual(['bm-1', 'bm-2']);
    });

    it('orders activeSpaceId folders first and includes all Arctic Space folders plus custom external Space folders', async () => {
      mockChrome.__setBookmarksTree([
        {
          id: '0',
          title: 'Root',
          children: [
            {
              id: '1',
              title: 'Bookmarks Bar',
              children: [
                {
                  id: 'ext-custom',
                  title: 'External Client Space',
                  children: [{ id: 'bm-ext', title: 'Client Portal', url: 'https://client.com' }]
                }
              ]
            },
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
                      children: [{ id: 'bm-home', title: 'Home Link', url: 'https://home.com' }]
                    },
                    {
                      id: '20',
                      title: 'Work',
                      children: [
                        {
                          id: '21',
                          title: 'Quick Access',
                          children: [{ id: 'bm-work-qa', title: 'Linear', url: 'https://linear.app' }]
                        },
                        { id: 'bm-work', title: 'Jira', url: 'https://jira.com' }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]);

      mockChrome.__setLocalStorage({
        activeSpaceId: 'space-work',
        spaces: [
          { id: 'home', name: 'Home', folderId: '12' },
          {
            id: 'space-work',
            name: 'Work',
            folderId: '20',
            quickAccessFolderId: '21'
          },
          {
            id: 'space-ext',
            name: 'External',
            folderId: 'ext-custom'
          }
        ]
      });

      const nodes = await fetchAllArcticBookmarkNodes();
      // Active space ('21' Quick Access, '20' Work) comes BEFORE Home ('12') and External ('ext-custom')
      expect(nodes.map((n) => n.id)).toEqual(['21', '20', '12', 'ext-custom']);
    });
  });

  describe('reconcileTabsAndBookmarksState & findMatchingUnboundTabForBookmark', () => {
    it('prioritizes preferredWindowId, enforces 3-pass priority (exact > canonical > persisted), and prunes dead bindings', () => {
      const bookmarkNodes: chrome.bookmarks.BookmarkTreeNode[] = [
        {
          id: 'folder-1',
          title: 'Home',
          children: [
            { id: 'bm-exact', title: 'GitHub', url: 'https://github.com' },
            { id: 'bm-gmail', title: 'Gmail', url: 'https://gmail.com' },
            { id: 'bm-nav', title: 'Hacker News', url: 'https://news.ycombinator.com' }
          ]
        }
      ];

      const allOpenTabs: chrome.tabs.Tab[] = [
        // Secondary window tab for github.com (windowId 99)
        {
          id: 1,
          windowId: 99,
          url: 'https://github.com',
          title: 'GitHub Win 99'
        } as chrome.tabs.Tab,
        // Preferred window tab for github.com (windowId 10) -> should win over tab 1!
        {
          id: 2,
          windowId: 10,
          url: 'https://github.com',
          title: 'GitHub Win 10'
        } as chrome.tabs.Tab,
        // Sleeping canonical redirect tab with pendingUrl
        {
          id: 3,
          windowId: 10,
          url: '',
          pendingUrl: 'https://mail.google.com/mail/u/0/#inbox',
          title: 'Gmail',
          discarded: true
        } as chrome.tabs.Tab,
        // Navigated-away tab matching persistedBindings
        {
          id: 4,
          windowId: 10,
          url: 'https://news.ycombinator.com/item?id=12345',
          title: 'HN Thread'
        } as chrome.tabs.Tab
      ];

      const result = reconcileTabsAndBookmarksState({
        bookmarkNodes,
        allOpenTabs,
        preferredWindowId: 10,
        currentBindings: {
          'bm-dead': {
            bookmarkId: 'bm-dead',
            tabId: 999,
            windowId: 10,
            originalUrl: 'https://dead.com',
            currentUrl: 'https://dead.com',
            currentTitle: 'Dead',
            isNavigatedAway: false
          }
        },
        currentByTab: { 999: 'bm-dead', 888: 'orphan' },
        persistedBindings: {
          'bm-nav': {
            bookmarkId: 'bm-nav',
            originalUrl: 'https://news.ycombinator.com',
            currentUrl: 'https://news.ycombinator.com/item?id=12345',
            currentTitle: 'HN Thread',
            isNavigatedAway: true,
            updatedAt: Date.now()
          }
        }
      });

      expect(result.changed).toBe(true);
      expect(result.bindingsByBookmarkId['bm-dead']).toBeUndefined();
      expect(result.bookmarkIdByTabId[999]).toBeUndefined();
      expect(result.bookmarkIdByTabId[888]).toBeUndefined();

      // Tab 2 (window 10) won over Tab 1 (window 99)
      expect(result.bindingsByBookmarkId['bm-exact']?.tabId).toBe(2);
      expect(result.bookmarkIdByTabId[1]).toBeUndefined();

      // Sleeping canonical redirect tab 3 bound to bm-gmail
      expect(result.bindingsByBookmarkId['bm-gmail']?.tabId).toBe(3);

      // Persisted navigated-away tab 4 bound to bm-nav with isNavigatedAway = true
      expect(result.bindingsByBookmarkId['bm-nav']?.tabId).toBe(4);
      expect(result.bindingsByBookmarkId['bm-nav']?.isNavigatedAway).toBe(true);
    });

    it('findMatchingUnboundTabForBookmark skips already-bound and excluded tabs and matches exact, canonical, or persisted tabs', () => {
      const tabs: chrome.tabs.Tab[] = [
        { id: 10, windowId: 10, url: 'https://gmail.com', title: 'Bound Gmail' } as chrome.tabs.Tab,
        {
          id: 11,
          windowId: 10,
          url: 'https://github.com/org/repo/issues/7',
          title: 'Issue 7',
          discarded: true
        } as chrome.tabs.Tab
      ];

      // Tab 10 is already bound to another bookmark, so it must NOT be stolen
      const noSteal = findMatchingUnboundTabForBookmark({
        bookmark: { id: 'bm-gmail-2', url: 'https://gmail.com' },
        tabs,
        boundTabIds: { 10: 'bm-gmail-1' }
      });
      expect(noSteal).toBeUndefined();

      // Tab 11 matches persisted navigated-away URL for bm-gh
      const persistedMatch = findMatchingUnboundTabForBookmark({
        bookmark: { id: 'bm-gh', url: 'https://github.com' },
        tabs,
        boundTabIds: { 10: 'bm-gmail-1' },
        persistedBindings: {
          'bm-gh': {
            bookmarkId: 'bm-gh',
            originalUrl: 'https://github.com',
            currentUrl: 'https://github.com/org/repo/issues/7',
            currentTitle: 'Issue 7',
            isNavigatedAway: true,
            updatedAt: Date.now()
          }
        }
      });
      expect(persistedMatch?.id).toBe(11);
    });
  });
});
