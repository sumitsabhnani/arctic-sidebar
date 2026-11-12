import type { LocalSettings, PersistedTabBinding, SpaceItem, TabBinding } from '../../types';
import {
  doesTabUrlMatchBookmark,
  getEffectiveTabUrl,
  isScratchpadUrl,
   isUrlNavigatedAway,
  normalizeUrl
} from './url';

export const PERSISTED_BINDINGS_STORAGE_KEY = 'persistedBindingsByBookmarkId';

export function isArcticCommandTab(tab: chrome.tabs.Tab): boolean {
  const actualUrl = (tab.url || '').trim().toLowerCase();
  const pendingUrl = (tab.pendingUrl || '').trim().toLowerCase();
  const rawUrl = actualUrl || pendingUrl;
  const rawTitle = (tab.title || '').trim();

  const isCommandOrNewTabUrl = (u: string) =>
    u.startsWith('chrome://newtab') ||
    u.startsWith('edge://newtab') ||
    u === 'about:newtab' ||
    u.includes('/newtab.html') ||
    u.includes('/command.html');

  // If the tab is already navigating to a real non-newtab URL, it is no longer an empty Arctic Command tab
  if (pendingUrl && pendingUrl !== 'about:blank' && !isCommandOrNewTabUrl(pendingUrl)) {
    return false;
  }

  // Once a tab has navigated to a real non-newtab URL, it is no longer an Arctic Command tab
  if (actualUrl && actualUrl !== 'about:blank' && !isCommandOrNewTabUrl(actualUrl)) {
    if (rawTitle === 'Arctic Command' && actualUrl.startsWith('chrome-extension://')) {
      return true;
    }
    return false;
  }

  if (isCommandOrNewTabUrl(rawUrl) || isCommandOrNewTabUrl(pendingUrl)) {
    return true;
  }

  if (
    rawTitle === 'Arctic Command' &&
    (!rawUrl || rawUrl === 'about:blank' || rawUrl.startsWith('chrome-extension://'))
  ) {
    return true;
  }

  return false;
}

let persistedBindingsLock: Promise<void> = Promise.resolve();

export async function getPersistedBindings(): Promise<Record<string, PersistedTabBinding>> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) return {};
  try {
    const data = await chrome.storage.local.get([PERSISTED_BINDINGS_STORAGE_KEY]);
    return (
      (data[PERSISTED_BINDINGS_STORAGE_KEY] as Record<string, PersistedTabBinding>) || {}
    );
  } catch {
    return {};
  }
}

export async function upsertPersistedBindings(
  bindingsByBookmarkId: Record<string, TabBinding>
): Promise<void> {
  const entries = Object.values(bindingsByBookmarkId);
  if (entries.length === 0 || typeof chrome === 'undefined' || !chrome.storage?.local?.set) {
    return;
  }

  persistedBindingsLock = persistedBindingsLock.then(async () => {
    try {
      const existing = await getPersistedBindings();
      const next: Record<string, PersistedTabBinding> = { ...existing };
      let hasChanges = false;
      const now = Date.now();

      for (const b of entries) {
        if (!b.bookmarkId || !b.currentUrl) continue;
        const prev = next[b.bookmarkId];
        if (
          !prev ||
          prev.originalUrl !== b.originalUrl ||
          prev.currentUrl !== b.currentUrl ||
          prev.currentTitle !== b.currentTitle ||
          prev.isNavigatedAway !== b.isNavigatedAway
        ) {
          next[b.bookmarkId] = {
            bookmarkId: b.bookmarkId,
            originalUrl: b.originalUrl,
            currentUrl: b.currentUrl,
            currentTitle: b.currentTitle,
            isNavigatedAway: b.isNavigatedAway,
            updatedAt: now
          };
          hasChanges = true;
        }
      }

      if (hasChanges) {
        await chrome.storage.local.set({ [PERSISTED_BINDINGS_STORAGE_KEY]: next });
      }
    } catch {
      // ignore storage errors
    }
  });

  await persistedBindingsLock;
}

export async function removePersistedBindings(bookmarkIds: string[]): Promise<void> {
  if (
    bookmarkIds.length === 0 ||
    typeof chrome === 'undefined' ||
    !chrome.storage?.local?.set
  ) {
    return;
  }

  persistedBindingsLock = persistedBindingsLock.then(async () => {
    try {
      const existing = await getPersistedBindings();
      let hasChanges = false;
      const next = { ...existing };

      for (const id of bookmarkIds) {
        if (id && next[id]) {
          delete next[id];
          hasChanges = true;
        }
      }

      if (hasChanges) {
        await chrome.storage.local.set({ [PERSISTED_BINDINGS_STORAGE_KEY]: next });
      }
    } catch {
      // ignore
    }
  });

  await persistedBindingsLock;
}

export async function clearAllPersistedBindings(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local?.remove) return;
  persistedBindingsLock = persistedBindingsLock.then(async () => {
    try {
      await chrome.storage.local.remove(PERSISTED_BINDINGS_STORAGE_KEY);
    } catch {
      // ignore
    }
  });
  await persistedBindingsLock;
}

export function collectBookmarkLeaves(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  excludedBookmarkIds?: Set<string>
): chrome.bookmarks.BookmarkTreeNode[] {
  const leaves: chrome.bookmarks.BookmarkTreeNode[] = [];
  const seenIds = new Set<string>();

  const walk = (list: chrome.bookmarks.BookmarkTreeNode[]) => {
    for (const node of list) {
      if (!node) continue;
      if (
        node.url &&
        !seenIds.has(node.id) &&
        !isScratchpadUrl(node.url) &&
        node.title !== 'Scratchpad Backup' &&
        !excludedBookmarkIds?.has(node.id)
      ) {
        seenIds.add(node.id);
        leaves.push(node);
      }
      if (node.children) {
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return leaves;
}

/**
 * Fetches all Arctic bookmark subtrees across ALL Spaces (ordered with activeSpaceId first)
 * for background startup/install reconciliation.
 */
export async function fetchAllArcticBookmarkNodes(): Promise<
  chrome.bookmarks.BookmarkTreeNode[]
> {
  if (typeof chrome === 'undefined' || !chrome.bookmarks?.getChildren) return [];

  try {
    const settings = ((await chrome.storage?.local?.get([
      'spaces',
      'activeSpaceId',
      'quickAccessFolderId',
      'workspaceFolderId'
    ])) || {}) as LocalSettings;

    const storedSpaces: SpaceItem[] = Array.isArray(settings.spaces) ? settings.spaces : [];
    const activeSpaceId = settings.activeSpaceId || 'home';

    const rootChildren = await chrome.bookmarks.getChildren('0');
    const otherNode =
      rootChildren.find(
        (c) => c.id === '2' || c.title.toLowerCase().includes('other')
      ) ||
      rootChildren[1] ||
      rootChildren[0];

    const nodes: chrome.bookmarks.BookmarkTreeNode[] = [];
    const visitedIds = new Set<string>();

    const addNode = (node?: chrome.bookmarks.BookmarkTreeNode | null) => {
      if (node && !visitedIds.has(node.id)) {
        visitedIds.add(node.id);
        nodes.push(node);
      }
    };

    let arcticSubtree: chrome.bookmarks.BookmarkTreeNode | null = null;
    if (otherNode?.id) {
      const otherChildren = await chrome.bookmarks.getChildren(otherNode.id);
      const legacyPrefix = 'Ar' + 'c Sidebar';
      const arcticRoot = otherChildren.find(
        (c) =>
          !c.url &&
          (c.title === 'Arctic' ||
            c.title === 'Arctic Sidebar' ||
            c.title === legacyPrefix)
      );
      if (arcticRoot?.id) {
        const [sub] = await chrome.bookmarks.getSubTree(arcticRoot.id);
        arcticSubtree = sub || null;
      }
    }

    const arcticChildren = arcticSubtree?.children || [];

    // 1. Add active space's folders first so active space wins ties on identical URLs
    const activeSpace = storedSpaces.find((s) => s.id === activeSpaceId);
    const prioritizedFolderIds = [
      activeSpace?.quickAccessFolderId,
      activeSpaceId === 'home' ? settings.quickAccessFolderId : undefined,
      activeSpace?.folderId,
      activeSpaceId === 'home' ? settings.workspaceFolderId : undefined
    ].filter((id): id is string => Boolean(id));

    for (const fId of prioritizedFolderIds) {
      if (visitedIds.has(fId)) continue;
      const inArctic = arcticChildren.find((c) => c.id === fId);
      if (inArctic) {
        addNode(inArctic);
      } else {
        try {
          const [sub] = await chrome.bookmarks.getSubTree(fId);
          addNode(sub);
        } catch {
          // ignore missing custom folder
        }
      }
    }

    // 2. Add all remaining Arctic root child folders (covering Home, Work, Personal, and all Spaces)
    if (arcticChildren.length > 0) {
      // Put Home first if activeSpace wasn't stored yet
      const homeChild = arcticChildren.find((c) => {
        const lower = c.title.trim().toLowerCase();
        return !c.url && (lower === 'home' || lower === 'workspace');
      });
      if (homeChild) addNode(homeChild);

      for (const child of arcticChildren) {
        if (child.url) continue;
        addNode(child);
      }
    }

    // 3. Add any custom space folders configured outside the Arctic root folder
    for (const sp of storedSpaces) {
      for (const fId of [sp.quickAccessFolderId, sp.folderId]) {
        if (fId && !visitedIds.has(fId)) {
          try {
            const [sub] = await chrome.bookmarks.getSubTree(fId);
            addNode(sub);
          } catch {
            // ignore
          }
        }
      }
    }

    return nodes;
  } catch {
    return [];
  }
}

export interface ReconcileStateOptions {
  bookmarkNodes: chrome.bookmarks.BookmarkTreeNode[];
  allOpenTabs: chrome.tabs.Tab[];
  preferredWindowId?: number | null;
  currentBindings: Record<string, TabBinding>;
  currentByTab: Record<number, string>;
  persistedBindings?: Record<string, PersistedTabBinding>;
  excludedTabIds?: Set<number>;
  excludedBookmarkIds?: Set<string>;
}

export interface ReconcileStateResult {
  bindingsByBookmarkId: Record<string, TabBinding>;
  bookmarkIdByTabId: Record<number, string>;
  changed: boolean;
}

/**
 * Pure 3-pass reconciliation between open/sleeping browser tabs and bookmarks:
 * Pass 1: Exact normalized URL match (`normalizeUrl`)
 * Pass 2: Deterministic canonical redirect match (`doesTabUrlMatchBookmark`, e.g. Gmail, Calendar, Docs `?tab=t.0`)
 * Pass 3: Persisted navigated-away URL match (`persistedBindingsByBookmarkId` across browser restarts / extension reloads)
 */
export function reconcileTabsAndBookmarksState({
  bookmarkNodes,
  allOpenTabs,
  preferredWindowId,
  currentBindings,
  currentByTab,
  persistedBindings = {},
  excludedTabIds,
  excludedBookmarkIds
}: ReconcileStateOptions): ReconcileStateResult {
  const openTabsById = new Map<number, chrome.tabs.Tab>();
  for (const t of allOpenTabs) {
    if (typeof t.id === 'number') {
      openTabsById.set(t.id, t);
    }
  }

  const nextBindings: Record<string, TabBinding> = {};
  const nextByTab: Record<number, string> = {};
  let changed = false;

  // 1. Validate & clean existing bindings against live open tabs (enforcing 1-to-1 bijection)
  for (const [bId, binding] of Object.entries(currentBindings)) {
    if (!binding || typeof binding.tabId !== 'number') {
      changed = true;
      continue;
    }
    if (excludedBookmarkIds?.has(bId) || excludedTabIds?.has(binding.tabId)) {
      changed = true;
      continue;
    }
    const liveTab = openTabsById.get(binding.tabId);
    if (!liveTab || nextByTab[binding.tabId] !== undefined) {
      changed = true;
      continue;
    }

    const liveUrl = getEffectiveTabUrl(liveTab) || binding.currentUrl;
    const liveTitle = liveTab.title || binding.currentTitle;
    const liveNavAway = isUrlNavigatedAway(liveUrl, binding.originalUrl);

    if (
      liveUrl !== binding.currentUrl ||
      liveTitle !== binding.currentTitle ||
      liveNavAway !== binding.isNavigatedAway
    ) {
      nextBindings[bId] = {
        ...binding,
        currentUrl: liveUrl,
        currentTitle: liveTitle,
        isNavigatedAway: liveNavAway
      };
      changed = true;
    } else {
      nextBindings[bId] = binding;
    }
    nextByTab[binding.tabId] = bId;
  }

  // Check if currentByTab had any orphaned entries not in nextByTab
  if (!changed) {
    const origByTabKeys = Object.keys(currentByTab);
    const nextByTabKeys = Object.keys(nextByTab);
    if (
      origByTabKeys.length !== nextByTabKeys.length ||
      origByTabKeys.some((k) => currentByTab[Number(k)] !== nextByTab[Number(k)])
    ) {
      changed = true;
    }
  }

  const allBookmarkLeaves = collectBookmarkLeaves(bookmarkNodes, excludedBookmarkIds);
  if (allBookmarkLeaves.length === 0 || allOpenTabs.length === 0) {
    return {
      bindingsByBookmarkId: nextBindings,
      bookmarkIdByTabId: nextByTab,
      changed
    };
  }

  const boundTabIds = new Set<number>(Object.keys(nextByTab).map(Number));
  const boundBookmarkIds = new Set<string>(Object.keys(nextBindings));

  // Prioritize tabs in preferredWindowId first, then other windows
  const orderedTabs =
    typeof preferredWindowId === 'number'
      ? [
          ...allOpenTabs.filter((t) => t.windowId === preferredWindowId),
          ...allOpenTabs.filter((t) => t.windowId !== preferredWindowId)
        ]
      : allOpenTabs;

  const isSkipUrl = (u: string) => {
    const lower = u.toLowerCase();
    return (
      !lower ||
      lower === 'about:blank' ||
      lower.startsWith('chrome://newtab') ||
      lower.startsWith('edge://newtab') ||
      lower === 'about:newtab' ||
      lower.includes('/newtab.html') ||
      lower.includes('/command.html')
    );
  };

  const eligibleTabs: Array<{ tab: chrome.tabs.Tab; effectiveUrl: string }> = [];
  for (const tab of orderedTabs) {
    if (typeof tab.id !== 'number') continue;
    if (boundTabIds.has(tab.id)) continue;
    if (excludedTabIds?.has(tab.id)) continue;
    if (isArcticCommandTab(tab)) continue;

    const effectiveUrl = getEffectiveTabUrl(tab);
    if (isSkipUrl(effectiveUrl)) continue;

    eligibleTabs.push({ tab, effectiveUrl });
  }

  const bindPair = (
    tab: chrome.tabs.Tab,
    effectiveUrl: string,
    bookmark: chrome.bookmarks.BookmarkTreeNode,
    fallbackTitle?: string
  ) => {
    const tabId = tab.id as number;
    const newBinding: TabBinding = {
      bookmarkId: bookmark.id,
      tabId,
      windowId: tab.windowId,
      originalUrl: bookmark.url!,
      currentUrl: effectiveUrl,
      currentTitle: tab.title || fallbackTitle || bookmark.title || '',
      isNavigatedAway: isUrlNavigatedAway(effectiveUrl, bookmark.url!)
    };
    nextBindings[bookmark.id] = newBinding;
    nextByTab[tabId] = bookmark.id;
    boundTabIds.add(tabId);
    boundBookmarkIds.add(bookmark.id);
    changed = true;
  };

  // Pass 1: Exact normalized URL match
  for (const { tab, effectiveUrl } of eligibleTabs) {
    const tabId = tab.id as number;
    if (boundTabIds.has(tabId)) continue;
    const tabNorm = normalizeUrl(effectiveUrl);

    const match = allBookmarkLeaves.find(
      (b) =>
        !boundBookmarkIds.has(b.id) &&
        !excludedBookmarkIds?.has(b.id) &&
        Boolean(b.url) &&
        normalizeUrl(b.url!) === tabNorm
    );
    if (match) {
      bindPair(tab, effectiveUrl, match);
    }
  }

  // Pass 2: Canonical redirect match (e.g. gmail.com -> mail.google.com/mail/u/0, Docs ?tab=t.0)
  for (const { tab, effectiveUrl } of eligibleTabs) {
    const tabId = tab.id as number;
    if (boundTabIds.has(tabId)) continue;

    const match = allBookmarkLeaves.find(
      (b) =>
        !boundBookmarkIds.has(b.id) &&
        !excludedBookmarkIds?.has(b.id) &&
        Boolean(b.url) &&
        doesTabUrlMatchBookmark(effectiveUrl, b.url!)
    );
    if (match) {
      bindPair(tab, effectiveUrl, match);
    }
  }

  // Pass 3: Persisted navigated-away URL match (survives browser restarts & extension reloads)
  for (const { tab, effectiveUrl } of eligibleTabs) {
    const tabId = tab.id as number;
    if (boundTabIds.has(tabId)) continue;

    const match = allBookmarkLeaves.find((b) => {
      if (boundBookmarkIds.has(b.id) || excludedBookmarkIds?.has(b.id) || !b.url) {
        return false;
      }
      const persisted = persistedBindings[b.id];
      if (!persisted || !persisted.currentUrl) return false;
      if (!doesTabUrlMatchBookmark(persisted.originalUrl, b.url)) return false;
      return doesTabUrlMatchBookmark(effectiveUrl, persisted.currentUrl);
    });

    if (match) {
      bindPair(tab, effectiveUrl, match, persistedBindings[match.id]?.currentTitle);
    }
  }

  return {
    bindingsByBookmarkId: nextBindings,
    bookmarkIdByTabId: nextByTab,
    changed
  };
}

/**
 * Finds an already-open (or sleeping/discarded) unbound tab matching a bookmark so
 * clicking a bookmark wakes and binds the existing tab instead of opening a duplicate.
 */
export function findMatchingUnboundTabForBookmark(options: {
  bookmark: { id: string; url: string };
  tabs: chrome.tabs.Tab[];
  boundTabIds: Record<number, string>;
  persistedBindings?: Record<string, PersistedTabBinding>;
  excludedTabIds?: Set<number>;
  excludeTabId?: number;
}): chrome.tabs.Tab | undefined {
  const {
    bookmark,
    tabs,
    boundTabIds,
    persistedBindings = {},
    excludedTabIds,
    excludeTabId
  } = options;

  if (!bookmark.url) return undefined;

  const candidates = tabs.filter(
    (t) =>
      typeof t.id === 'number' &&
      t.id !== excludeTabId &&
      !boundTabIds[t.id] &&
      !excludedTabIds?.has(t.id) &&
      !isArcticCommandTab(t) &&
      Boolean(getEffectiveTabUrl(t))
  );

  if (candidates.length === 0) return undefined;

  const targetNormalized = normalizeUrl(bookmark.url);

  // 1. Exact normalized URL match
  const exactMatch = candidates.find(
    (t) => normalizeUrl(getEffectiveTabUrl(t)) === targetNormalized
  );
  if (exactMatch) return exactMatch;

  // 2. Canonical redirect match
  const canonicalMatch = candidates.find((t) =>
    doesTabUrlMatchBookmark(getEffectiveTabUrl(t), bookmark.url)
  );
  if (canonicalMatch) return canonicalMatch;

  // 3. Persisted navigated-away URL match
  const persisted = persistedBindings[bookmark.id];
  if (
    persisted?.currentUrl &&
    doesTabUrlMatchBookmark(persisted.originalUrl, bookmark.url)
  ) {
    const persistedMatch = candidates.find((t) =>
      doesTabUrlMatchBookmark(getEffectiveTabUrl(t), persisted.currentUrl)
    );
    if (persistedMatch) return persistedMatch;
  }

  return undefined;
}
