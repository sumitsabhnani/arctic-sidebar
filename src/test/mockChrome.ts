import { vi } from 'vitest';

export interface MockBookmarkNode {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  children?: MockBookmarkNode[];
  index?: number;
}

export function createMockChrome() {
  let localStorageState: Record<string, unknown> = {};
  let sessionStorageState: Record<string, unknown> = {};

  let bookmarksTree: MockBookmarkNode[] = [
    {
      id: '0',
      title: 'Root',
      children: [
        {
          id: '1',
          parentId: '0',
          title: 'Bookmarks Bar',
          children: []
        },
        {
          id: '2',
          parentId: '0',
          title: 'Other Bookmarks',
          children: []
        }
      ]
    }
  ];

  let nextBookmarkId = 100;
  let tabsState: chrome.tabs.Tab[] = [
    {
      id: 1,
      index: 0,
      windowId: 10,
      highlighted: true,
      active: true,
      pinned: false,
      incognito: false,
      url: 'https://example.com',
      title: 'Example Domain',
      status: 'complete',
      audible: false,
      discarded: false,
      autoDiscardable: true,
      mutedInfo: { muted: false }
    } as chrome.tabs.Tab
  ];

  let windowsState: chrome.windows.Window[] = [
    {
      id: 10,
      focused: true,
      top: 0,
      left: 0,
      width: 1200,
      height: 800,
      type: 'normal',
      state: 'normal',
      incognito: false,
      alwaysOnTop: false
    } as chrome.windows.Window
  ];

  // Listener collections
  const storageListeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void>();
  const tabActivatedListeners = new Set<(activeInfo: chrome.tabs.TabActiveInfo) => void>();
  const tabCreatedListeners = new Set<(tab: chrome.tabs.Tab) => void>();
  const tabRemovedListeners = new Set<(tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void>();
  const tabUpdatedListeners = new Set<(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void>();
  const tabMovedListeners = new Set<() => void>();
  const windowFocusListeners = new Set<(winId: number) => void>();
  const bookmarkCreatedListeners = new Set<(id: string, bookmark: chrome.bookmarks.BookmarkTreeNode) => void>();
  const bookmarkRemovedListeners = new Set<(id: string, removeInfo: { parentId: string; index: number }) => void>();
  const bookmarkChangedListeners = new Set<(id: string, changeInfo: { title: string; url?: string }) => void>();
  const bookmarkMovedListeners = new Set<(id: string, moveInfo: { parentId: string; index: number; oldParentId: string; oldIndex: number }) => void>();

  function findNode(nodes: MockBookmarkNode[], id: string): MockBookmarkNode | null {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) {
        const found = findNode(n.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  function removeNodeRecursive(nodes: MockBookmarkNode[], id: string): MockBookmarkNode | null {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) {
        const [removed] = nodes.splice(i, 1);
        return removed;
      }
      if (nodes[i].children) {
        const removed = removeNodeRecursive(nodes[i].children!, id);
        if (removed) return removed;
      }
    }
    return null;
  }

  function cloneTree<T>(val: T): T {
    return JSON.parse(JSON.stringify(val));
  }

  const mock = {
    runtime: {
      id: 'mock-extension-id',
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() }
    },
    sidePanel: {
      setPanelBehavior: vi.fn().mockResolvedValue(undefined)
    },
    storage: {
      local: {
        get: vi.fn((keys: string | string[] | Record<string, unknown> | null, cb?: (items: Record<string, unknown>) => void) => {
          const result: Record<string, unknown> = {};
          if (typeof keys === 'string') {
            result[keys] = localStorageState[keys];
          } else if (Array.isArray(keys)) {
            for (const k of keys) result[k] = localStorageState[k];
          } else if (keys && typeof keys === 'object') {
            for (const k of Object.keys(keys)) {
              result[k] = localStorageState[k] !== undefined ? localStorageState[k] : keys[k];
            }
          } else {
            Object.assign(result, localStorageState);
          }
          if (cb) cb(result);
          return Promise.resolve(result);
        }),
        set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
          const changes: Record<string, chrome.storage.StorageChange> = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: localStorageState[k], newValue: v };
            localStorageState[k] = v;
          }
          for (const listener of storageListeners) {
            listener(changes, 'local');
          }
          if (cb) cb();
          return Promise.resolve();
        }),
        remove: vi.fn((keys: string | string[], cb?: () => void) => {
          const keyArr = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArr) delete localStorageState[k];
          if (cb) cb();
          return Promise.resolve();
        })
      },
      session: {
        setAccessLevel: vi.fn().mockResolvedValue(undefined),
        get: vi.fn((keys: string | string[] | Record<string, unknown> | null, cb?: (items: Record<string, unknown>) => void) => {
          const result: Record<string, unknown> = {};
          if (typeof keys === 'string') {
            result[keys] = sessionStorageState[keys];
          } else if (Array.isArray(keys)) {
            for (const k of keys) result[k] = sessionStorageState[k];
          } else {
            Object.assign(result, sessionStorageState);
          }
          if (cb) cb(result);
          return Promise.resolve(result);
        }),
        set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
          const changes: Record<string, chrome.storage.StorageChange> = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: sessionStorageState[k], newValue: v };
            sessionStorageState[k] = v;
          }
          for (const listener of storageListeners) {
            listener(changes, 'session');
          }
          if (cb) cb();
          return Promise.resolve();
        }),
        remove: vi.fn((keys: string | string[], cb?: () => void) => {
          const keyArr = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArr) delete sessionStorageState[k];
          if (cb) cb();
          return Promise.resolve();
        })
      },
      onChanged: {
        addListener: vi.fn((fn) => storageListeners.add(fn)),
        removeListener: vi.fn((fn) => storageListeners.delete(fn))
      }
    },
    bookmarks: {
      getTree: vi.fn(async () => cloneTree(bookmarksTree)),
      getSubTree: vi.fn(async (id: string) => {
        const node = findNode(bookmarksTree, id);
        if (!node) throw new Error(`Bookmark node ${id} not found`);
        return [cloneTree(node)] as chrome.bookmarks.BookmarkTreeNode[];
      }),
      create: vi.fn(async (details: { parentId?: string; title?: string; url?: string; index?: number }) => {
        const id = String(nextBookmarkId++);
        const parentId = details.parentId || '2';
        const parent = findNode(bookmarksTree, parentId);
        if (!parent) throw new Error(`Parent node ${parentId} not found`);
        if (!parent.children) parent.children = [];

        const newNode: MockBookmarkNode = {
          id,
          parentId,
          title: details.title || '',
          url: details.url,
          children: details.url ? undefined : []
        };

        if (typeof details.index === 'number') {
          parent.children.splice(details.index, 0, newNode);
        } else {
          parent.children.push(newNode);
        }

        const res = cloneTree(newNode) as chrome.bookmarks.BookmarkTreeNode;
        for (const listener of bookmarkCreatedListeners) {
          listener(id, res);
        }
        return res;
      }),
      update: vi.fn(async (id: string, changes: { title?: string; url?: string }) => {
        const node = findNode(bookmarksTree, id);
        if (!node) throw new Error(`Bookmark node ${id} not found`);
        if (changes.title !== undefined) node.title = changes.title;
        if (changes.url !== undefined) node.url = changes.url;
        for (const listener of bookmarkChangedListeners) {
          listener(id, { title: node.title, url: node.url });
        }
        return cloneTree(node) as chrome.bookmarks.BookmarkTreeNode;
      }),
      move: vi.fn(async (id: string, destination: { parentId?: string; index?: number }) => {
        const node = removeNodeRecursive(bookmarksTree, id);
        if (!node) throw new Error(`Bookmark node ${id} not found`);
        const targetParentId = destination.parentId || node.parentId || '2';
        const targetParent = findNode(bookmarksTree, targetParentId);
        if (!targetParent) throw new Error(`Target parent ${targetParentId} not found`);
        if (!targetParent.children) targetParent.children = [];
        node.parentId = targetParentId;
        if (typeof destination.index === 'number') {
          targetParent.children.splice(destination.index, 0, node);
        } else {
          targetParent.children.push(node);
        }
        for (const listener of bookmarkMovedListeners) {
          listener(id, {
            parentId: targetParentId,
            index: destination.index ?? targetParent.children.length - 1,
            oldParentId: node.parentId || '',
            oldIndex: 0
          });
        }
        return cloneTree(node) as chrome.bookmarks.BookmarkTreeNode;
      }),
      remove: vi.fn(async (id: string) => {
        const removed = removeNodeRecursive(bookmarksTree, id);
        if (removed) {
          for (const listener of bookmarkRemovedListeners) {
            listener(id, { parentId: removed.parentId || '', index: 0 });
          }
        }
      }),
      removeTree: vi.fn(async (id: string) => {
        const removed = removeNodeRecursive(bookmarksTree, id);
        if (removed) {
          for (const listener of bookmarkRemovedListeners) {
            listener(id, { parentId: removed.parentId || '', index: 0 });
          }
        }
      }),
      search: vi.fn(async (query: string) => {
        const q = query.toLowerCase();
        const matches: MockBookmarkNode[] = [];
        function traverse(node: MockBookmarkNode) {
          if (node.title?.toLowerCase().includes(q) || node.url?.toLowerCase().includes(q)) {
            matches.push(node);
          }
          if (node.children) {
            for (const c of node.children) traverse(c);
          }
        }
        for (const root of bookmarksTree) traverse(root);
        return cloneTree(matches) as chrome.bookmarks.BookmarkTreeNode[];
      }),
      onCreated: {
        addListener: vi.fn((fn) => bookmarkCreatedListeners.add(fn)),
        removeListener: vi.fn((fn) => bookmarkCreatedListeners.delete(fn))
      },
      onRemoved: {
        addListener: vi.fn((fn) => bookmarkRemovedListeners.add(fn)),
        removeListener: vi.fn((fn) => bookmarkRemovedListeners.delete(fn))
      },
      onChanged: {
        addListener: vi.fn((fn) => bookmarkChangedListeners.add(fn)),
        removeListener: vi.fn((fn) => bookmarkChangedListeners.delete(fn))
      },
      onMoved: {
        addListener: vi.fn((fn) => bookmarkMovedListeners.add(fn)),
        removeListener: vi.fn((fn) => bookmarkMovedListeners.delete(fn))
      },
      onChildrenReordered: {
        addListener: vi.fn(),
        removeListener: vi.fn()
      }
    },
    tabs: {
      query: vi.fn(async (queryInfo: chrome.tabs.QueryInfo) => {
        let result = [...tabsState];
        if (typeof queryInfo.active === 'boolean') {
          result = result.filter((t) => t.active === queryInfo.active);
        }
        if (typeof queryInfo.windowId === 'number') {
          result = result.filter((t) => t.windowId === queryInfo.windowId);
        }
        if (queryInfo.currentWindow) {
          result = result.filter((t) => t.windowId === windowsState[0]?.id);
        }
        return cloneTree(result);
      }),
      get: vi.fn(async (tabId: number) => {
        const tab = tabsState.find((t) => t.id === tabId);
        if (!tab) throw new Error(`Tab ${tabId} not found`);
        return cloneTree(tab);
      }),
      create: vi.fn(async (props: chrome.tabs.CreateProperties) => {
        const newId = tabsState.length ? Math.max(...tabsState.map((t) => t.id || 0)) + 1 : 1;
        if (props.active) {
          for (const t of tabsState) t.active = false;
        }
        const newTab: chrome.tabs.Tab = {
          id: newId,
          index: tabsState.length,
          windowId: props.windowId || windowsState[0]?.id || 10,
          highlighted: Boolean(props.active),
          active: props.active !== false,
          pinned: Boolean(props.pinned),
          incognito: false,
          url: props.url || 'about:blank',
          title: props.url || 'New Tab',
          status: 'complete',
          audible: false,
          discarded: false,
          autoDiscardable: true,
          mutedInfo: { muted: false }
        } as chrome.tabs.Tab;

        tabsState.push(newTab);
        for (const listener of tabCreatedListeners) listener(cloneTree(newTab));
        return cloneTree(newTab);
      }),
      update: vi.fn(async (tabId: number, props: chrome.tabs.UpdateProperties) => {
        const tab = tabsState.find((t) => t.id === tabId);
        if (!tab) throw new Error(`Tab ${tabId} not found`);
        if (props.active) {
          for (const t of tabsState) {
            if (t.windowId === tab.windowId) t.active = false;
          }
          tab.active = true;
          for (const listener of tabActivatedListeners) {
            listener({ tabId, windowId: tab.windowId });
          }
        }
        if (props.url !== undefined) tab.url = props.url;
        if (props.muted !== undefined) {
          tab.mutedInfo = { muted: props.muted };
        }
        const changeInfo: chrome.tabs.TabChangeInfo = {};
        if (props.url) changeInfo.url = props.url;
        for (const listener of tabUpdatedListeners) {
          listener(tabId, changeInfo, cloneTree(tab));
        }
        return cloneTree(tab);
      }),
      remove: vi.fn(async (tabIds: number | number[]) => {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        for (const id of ids) {
          const idx = tabsState.findIndex((t) => t.id === id);
          if (idx !== -1) {
            const [removed] = tabsState.splice(idx, 1);
            for (const listener of tabRemovedListeners) {
              listener(id, { windowId: removed.windowId, isWindowClosing: false });
            }
          }
        }
      }),
      reload: vi.fn(async (tabId?: number) => {
        const targetId = tabId || tabsState.find((t) => t.active)?.id;
        const tab = tabsState.find((t) => t.id === targetId);
        if (tab) {
          for (const listener of tabUpdatedListeners) {
            listener(tab.id!, { status: 'loading' }, cloneTree(tab));
          }
        }
      }),
      duplicate: vi.fn(async (tabId: number) => {
        const tab = tabsState.find((t) => t.id === tabId);
        if (!tab) throw new Error(`Tab ${tabId} not found`);
        const newTab = cloneTree(tab);
        newTab.id = Math.max(...tabsState.map((t) => t.id || 0)) + 1;
        tabsState.push(newTab);
        return newTab;
      }),
      discard: vi.fn(async (tabId: number) => {
        const tab = tabsState.find((t) => t.id === tabId);
        if (tab) tab.discarded = true;
        return tab ? cloneTree(tab) : undefined;
      }),
      move: vi.fn(async (tabId: number, moveProperties: chrome.tabs.MoveProperties) => {
        const idx = tabsState.findIndex((t) => t.id === tabId);
        if (idx !== -1) {
          const [tab] = tabsState.splice(idx, 1);
          tabsState.splice(moveProperties.index, 0, tab);
          for (const listener of tabMovedListeners) listener();
          return cloneTree(tab);
        }
        return undefined;
      }),
      getCurrent: vi.fn(async () => cloneTree(tabsState[0])),
      onActivated: {
        addListener: vi.fn((fn) => tabActivatedListeners.add(fn)),
        removeListener: vi.fn((fn) => tabActivatedListeners.delete(fn))
      },
      onCreated: {
        addListener: vi.fn((fn) => tabCreatedListeners.add(fn)),
        removeListener: vi.fn((fn) => tabCreatedListeners.delete(fn))
      },
      onRemoved: {
        addListener: vi.fn((fn) => tabRemovedListeners.add(fn)),
        removeListener: vi.fn((fn) => tabRemovedListeners.delete(fn))
      },
      onUpdated: {
        addListener: vi.fn((fn) => tabUpdatedListeners.add(fn)),
        removeListener: vi.fn((fn) => tabUpdatedListeners.delete(fn))
      },
      onMoved: {
        addListener: vi.fn((fn) => tabMovedListeners.add(fn)),
        removeListener: vi.fn((fn) => tabMovedListeners.delete(fn))
      },
      onAttached: { addListener: vi.fn(), removeListener: vi.fn() },
      onDetached: { addListener: vi.fn(), removeListener: vi.fn() },
      onReplaced: { addListener: vi.fn(), removeListener: vi.fn() }
    },
    windows: {
      WINDOW_ID_NONE: -1,
      getCurrent: vi.fn(async () => cloneTree(windowsState[0])),
      get: vi.fn(async (winId: number) => {
        const win = windowsState.find((w) => w.id === winId);
        return win ? cloneTree(win) : cloneTree(windowsState[0]);
      }),
      getAll: vi.fn(async () => cloneTree(windowsState)),
      update: vi.fn(async (winId: number, info: chrome.windows.UpdateInfo) => {
        const win = windowsState.find((w) => w.id === winId);
        if (win) {
          if (info.left !== undefined) win.left = info.left;
          if (info.top !== undefined) win.top = info.top;
          if (info.width !== undefined) win.width = info.width;
          if (info.height !== undefined) win.height = info.height;
          if (info.state !== undefined) win.state = info.state;
          return cloneTree(win);
        }
        return undefined;
      }),
      create: vi.fn(async (createData: chrome.windows.CreateData) => {
        const newWin: chrome.windows.Window = {
          id: windowsState.length + 10,
          focused: Boolean(createData.focused),
          top: createData.top || 0,
          left: createData.left || 0,
          width: createData.width || 800,
          height: createData.height || 600,
          type: createData.type || 'normal',
          state: 'normal',
          incognito: false,
          alwaysOnTop: false
        } as chrome.windows.Window;
        windowsState.push(newWin);
        return cloneTree(newWin);
      }),
      onFocusChanged: {
        addListener: vi.fn((fn) => windowFocusListeners.add(fn)),
        removeListener: vi.fn((fn) => windowFocusListeners.delete(fn))
      }
    },
    history: {
      search: vi.fn(async (query: chrome.history.HistoryQuery, cb?: (results: chrome.history.HistoryItem[]) => void) => {
        const results: chrome.history.HistoryItem[] = [
          {
            id: 'h1',
            url: 'https://github.com',
            title: 'GitHub: Let’s build from here',
            lastVisitTime: Date.now() - 1000,
            visitCount: 15
          },
          {
            id: 'h2',
            url: 'https://news.ycombinator.com',
            title: 'Hacker News',
            lastVisitTime: Date.now() - 2000,
            visitCount: 8
          }
        ];
        const filtered = query.text
          ? results.filter((r) => r.title?.toLowerCase().includes(query.text.toLowerCase()) || r.url?.toLowerCase().includes(query.text.toLowerCase()))
          : results;
        if (cb) cb(filtered);
        return filtered;
      })
    },

    // Test helpers to inspect or reset internal states
    __setLocalStorage: (state: Record<string, unknown>) => {
      localStorageState = { ...state };
    },
    __setSessionStorage: (state: Record<string, unknown>) => {
      sessionStorageState = { ...state };
    },
    __getLocalStorage: () => localStorageState,
    __getSessionStorage: () => sessionStorageState,
    __setTabs: (tabs: chrome.tabs.Tab[]) => {
      tabsState = [...tabs];
    },
    __getTabs: () => tabsState,
    __setBookmarksTree: (tree: MockBookmarkNode[]) => {
      bookmarksTree = cloneTree(tree);
    },
    __getBookmarksTree: () => cloneTree(bookmarksTree),
    __resetAll: () => {
      localStorageState = {};
      sessionStorageState = {};
      nextBookmarkId = 100;
      bookmarksTree = [
        {
          id: '0',
          title: 'Root',
          children: [
            { id: '1', parentId: '0', title: 'Bookmarks Bar', children: [] },
            { id: '2', parentId: '0', title: 'Other Bookmarks', children: [] }
          ]
        }
      ];
      tabsState = [
        {
          id: 1,
          index: 0,
          windowId: 10,
          highlighted: true,
          active: true,
          pinned: false,
          incognito: false,
          url: 'https://example.com',
          title: 'Example Domain',
          status: 'complete',
          audible: false,
          discarded: false,
          autoDiscardable: true,
          mutedInfo: { muted: false }
        } as chrome.tabs.Tab
      ];
      windowsState = [
        {
          id: 10,
          focused: true,
          top: 0,
          left: 0,
          width: 1200,
          height: 800,
          type: 'normal',
          state: 'normal',
          incognito: false,
          alwaysOnTop: false
        } as chrome.windows.Window
      ];
      storageListeners.clear();
      tabActivatedListeners.clear();
      tabCreatedListeners.clear();
      tabRemovedListeners.clear();
      tabUpdatedListeners.clear();
      tabMovedListeners.clear();
      windowFocusListeners.clear();
      bookmarkCreatedListeners.clear();
      bookmarkRemovedListeners.clear();
      bookmarkChangedListeners.clear();
      bookmarkMovedListeners.clear();
    }
  };

  return mock;
}
