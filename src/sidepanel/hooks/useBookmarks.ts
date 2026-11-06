import { useState, useEffect, useCallback, useRef } from 'react';
import {
  QUICK_ACCESS_FOLDER_NAME,
  type BookmarkFolderOption,
  type LocalSettings,
  type SpaceItem
} from '../../types';
import { isScratchpadUrl, getScratchpadNoteId, extractNoteContentFromUrl } from '../utils/url';

function inferSpaceIcon(name: string): string {
  const lower = name.trim().toLowerCase();
  if (lower === 'home') return 'home';
  if (lower === 'work' || lower.includes('work')) return 'briefcase';
  if (lower === 'personal' || lower.includes('personal')) return 'user';
  if (
    lower.includes('learn') ||
    lower.includes('study') ||
    lower.includes('read') ||
    lower.includes('book') ||
    lower.includes('course')
  ) {
    return 'book';
  }
  if (lower.includes('dev') || lower.includes('code') || lower.includes('tech')) {
    return 'code';
  }
  return 'folder';
}

export function useBookmarks() {
  const [quickAccessNode, setQuickAccessNode] = useState<chrome.bookmarks.BookmarkTreeNode | null>(null);
  const [workspaceNode, setWorkspaceNode] = useState<chrome.bookmarks.BookmarkTreeNode | null>(null);
  const [allFolders, setAllFolders] = useState<BookmarkFolderOption[]>([]);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Record<string, boolean>>({});
  const [spaces, setSpaces] = useState<SpaceItem[]>([
    { id: 'home', name: 'Home', folderId: '', icon: 'home' }
  ]);
  const [activeSpaceId, setActiveSpaceId] = useState<string>('home');
  const [activeFolderIds, setActiveFolderIds] = useState<{
    quickAccessId: string | null;
    workspaceId: string | null;
    defaultRootId: string | null;
  }>({
    quickAccessId: null,
    workspaceId: null,
    defaultRootId: null
  });
  const [loading, setLoading] = useState<boolean>(true);

  const isInternalMutationRef = useRef<boolean>(false);
  const isLoadingRef = useRef<boolean>(false);
  const pendingReloadRef = useRef<boolean>(false);
  const bookmarkDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistSpaces = async (newSpaces: SpaceItem[], newActiveSpaceId?: string) => {
    const payload: Record<string, unknown> = { spaces: newSpaces };
    if (newActiveSpaceId) {
      payload.activeSpaceId = newActiveSpaceId;
    }
    await chrome.storage.local.set(payload);
    if (chrome.storage && chrome.storage.sync) {
      try {
        await chrome.storage.sync.set(payload);
      } catch (e) {
        console.warn('[Arctic] Could not sync spaces to storage.sync:', e);
      }
    }
  };

  // Load collapsed folders from storage.local
  useEffect(() => {
    chrome.storage.local.get(['collapsedFolderIds'], (res) => {
      if (res.collapsedFolderIds) {
        setCollapsedFolderIds(res.collapsedFolderIds as Record<string, boolean>);
      }
    });
  }, []);

  const toggleFolderCollapse = useCallback((folderId: string) => {
    setCollapsedFolderIds((prev) => {
      const currentCollapsed = prev[folderId] !== undefined ? prev[folderId] : true;
      const updated = {
        ...prev,
        [folderId]: !currentCollapsed
      };
      chrome.storage.local.set({ collapsedFolderIds: updated });
      return updated;
    });
  }, []);

  const setAllFoldersCollapsed = useCallback((collapsed: boolean) => {
    setCollapsedFolderIds((prev) => {
      const updated = { ...prev };
      for (const folder of allFolders) {
        updated[folder.id] = collapsed;
      }
      chrome.storage.local.set({ collapsedFolderIds: updated });
      return updated;
    });
  }, [allFolders]);

  /**
   * Traverse bookmark tree to collect all folders with path names for dropdown
   */
  const collectFolderOptions = (tree: chrome.bookmarks.BookmarkTreeNode[]): BookmarkFolderOption[] => {
    const list: BookmarkFolderOption[] = [];

    const traverse = (node: chrome.bookmarks.BookmarkTreeNode, currentPath: string) => {
      // It's a folder if it has no url (or has children)
      if (!node.url) {
        const title = node.title || (node.id === '0' ? 'Root' : 'Folder');
        const nextPath = currentPath ? `${currentPath} / ${title}` : title;

        // Skip root container node 0 from the dropdown list itself
        if (node.id !== '0') {
          list.push({
            id: node.id,
            title: node.title || 'Untitled Folder',
            path: nextPath
          });
        }

        if (node.children) {
          for (const child of node.children) {
            traverse(child, nextPath);
          }
        }
      }
    };

    for (const root of tree) {
      traverse(root, '');
    }

    return list;
  };

  /**
   * Merge all children (bookmarks and subfolders) from sourceFolder into targetFolder,
   * avoiding duplicate bookmarks with the same URL or duplicate subfolders with the same title,
   * and then remove sourceFolder.
   */
  const mergeAndRemoveFolder = async (
    targetFolder: chrome.bookmarks.BookmarkTreeNode,
    sourceFolder: chrome.bookmarks.BookmarkTreeNode
  ) => {
    if (targetFolder.id === sourceFolder.id) return;
    const sourceChildren =
      sourceFolder.children || (await chrome.bookmarks.getChildren(sourceFolder.id));
    let targetChildren =
      targetFolder.children || (await chrome.bookmarks.getChildren(targetFolder.id));

    for (const child of sourceChildren) {
      if (child.url) {
        const alreadyExists = targetChildren.some(
          (tc) => tc.url && tc.url.toLowerCase() === child.url!.toLowerCase()
        );
        if (!alreadyExists) {
          const moved = await chrome.bookmarks.move(child.id, { parentId: targetFolder.id });
          targetChildren = [...targetChildren, moved];
        }
      } else {
        const matchingTargetSub = targetChildren.find(
          (tc) => !tc.url && tc.title.toLowerCase() === child.title.toLowerCase()
        );
        if (matchingTargetSub) {
          await mergeAndRemoveFolder(matchingTargetSub, child);
        } else {
          const moved = await chrome.bookmarks.move(child.id, { parentId: targetFolder.id });
          targetChildren = [...targetChildren, moved];
        }
      }
    }

    try {
      await chrome.bookmarks.removeTree(sourceFolder.id);
    } catch {
      // ignore if already removed
    }
  };

  /**
   * Ensure a `Quick Access` subfolder exists directly inside `spaceFolder`,
   * migrating any legacy root-level `Quick Access` or `Quick Access (<SpaceName>)` folder into it.
   */
  const ensureSpaceQuickAccessChild = async (
    spaceFolder: chrome.bookmarks.BookmarkTreeNode,
    legacyRootQaFolders: chrome.bookmarks.BookmarkTreeNode[],
    populateStarterBookmarks: boolean = false
  ): Promise<chrome.bookmarks.BookmarkTreeNode> => {
    const spaceChildren =
      spaceFolder.children || (await chrome.bookmarks.getChildren(spaceFolder.id));
    const existingQaSubfolders = spaceChildren.filter(
      (c) => !c.url && c.title.trim().toLowerCase() === QUICK_ACCESS_FOLDER_NAME.toLowerCase()
    );

    let qaFolder = existingQaSubfolders[0];
    if (!qaFolder) {
      qaFolder = await chrome.bookmarks.create({
        parentId: spaceFolder.id,
        title: QUICK_ACCESS_FOLDER_NAME,
        index: 0
      });

      if (populateStarterBookmarks && legacyRootQaFolders.length === 0) {
        await Promise.all([
          chrome.bookmarks.create({
            parentId: qaFolder.id,
            title: 'Google',
            url: 'https://www.google.com'
          }),
          chrome.bookmarks.create({
            parentId: qaFolder.id,
            title: 'GitHub',
            url: 'https://github.com'
          }),
          chrome.bookmarks.create({
            parentId: qaFolder.id,
            title: 'YouTube',
            url: 'https://www.youtube.com'
          }),
          chrome.bookmarks.create({
            parentId: qaFolder.id,
            title: 'Reddit',
            url: 'https://www.reddit.com'
          })
        ]);
      }
    } else if (qaFolder.title !== QUICK_ACCESS_FOLDER_NAME) {
      try {
        await chrome.bookmarks.update(qaFolder.id, { title: QUICK_ACCESS_FOLDER_NAME });
        qaFolder.title = QUICK_ACCESS_FOLDER_NAME;
      } catch {
        // ignore
      }
    }

    // Merge any duplicate Quick Access subfolders inside the same space
    for (let i = 1; i < existingQaSubfolders.length; i++) {
      try {
        await mergeAndRemoveFolder(qaFolder, existingQaSubfolders[i]);
      } catch {
        // ignore
      }
    }

    // Migrate and remove any legacy root-level Quick Access folders for this space
    for (const legacyQa of legacyRootQaFolders) {
      if (legacyQa.id === qaFolder.id) continue;
      try {
        await mergeAndRemoveFolder(qaFolder, legacyQa);
      } catch {
        // ignore
      }
    }

    const [updatedQa] = await chrome.bookmarks.getSubTree(qaFolder.id);
    return updatedQa || qaFolder;
  };

  /**
   * Find or create the default 'Arctic' structure in 'Other Bookmarks'
   * and automatically clean up / consolidate any duplicate or empty legacy folders.
   */
  const ensureDefaultFolders = async (
    activeSpaceNamesLower: Set<string> = new Set()
  ): Promise<{
    rootId: string;
    quickAccessId: string;
    workspaceId: string;
    arcticSidebarSubtree: chrome.bookmarks.BookmarkTreeNode;
    quickAccessSubtree: chrome.bookmarks.BookmarkTreeNode;
    homeSubtree: chrome.bookmarks.BookmarkTreeNode;
    isNewSidebar: boolean;
  }> => {
    // Only fetch top children of root ('0') first instead of the entire bookmark tree
    const rootChildren = await chrome.bookmarks.getChildren('0');

    // Find "Other Bookmarks" node (standard ID is '2', or match title)
    let otherBookmarksNode = rootChildren.find(
      (c) => c.id === '2' || c.title.toLowerCase().includes('other')
    );

    if (!otherBookmarksNode && rootChildren.length > 1) {
      otherBookmarksNode = rootChildren[1];
    } else if (!otherBookmarksNode && rootChildren.length > 0) {
      otherBookmarksNode = rootChildren[0];
    }

    const otherId = otherBookmarksNode ? otherBookmarksNode.id : '1';
    const otherChildren = await chrome.bookmarks.getChildren(otherId);

    // Check if 'Arctic' or 'Arctic Sidebar' exists inside Other Bookmarks
    const legacyPrefix = 'Ar' + 'c Sidebar';
    const arcticFolders = otherChildren.filter(
      (c) =>
        !c.url &&
        (c.title === 'Arctic' || c.title === 'Arctic Sidebar' || c.title === legacyPrefix)
    );

    let arcticSidebar = arcticFolders[0];
    let isNewSidebar = false;
    if (!arcticSidebar) {
      arcticSidebar = await chrome.bookmarks.create({
        parentId: otherId,
        title: 'Arctic'
      });
      isNewSidebar = true;
    } else {
      if (arcticSidebar.title !== 'Arctic') {
        await chrome.bookmarks.update(arcticSidebar.id, { title: 'Arctic' });
        arcticSidebar.title = 'Arctic';
      }
      // If multiple Arctic root folders exist, merge them into the primary one
      for (let i = 1; i < arcticFolders.length; i++) {
        try {
          const [dupRootSub] = await chrome.bookmarks.getSubTree(arcticFolders[i].id);
          const [primaryRootSub] = await chrome.bookmarks.getSubTree(arcticSidebar.id);
          await mergeAndRemoveFolder(primaryRootSub, dupRootSub);
        } catch {
          // ignore
        }
      }
    }

    // Fetch sub-tree of Arctic Sidebar to inspect and deduplicate children
    const [arcticSidebarSubtree] = await chrome.bookmarks.getSubTree(arcticSidebar.id);
    const rawChildren = arcticSidebarSubtree.children || [];

    // 1. Consolidate & deduplicate all child folders under Arctic by normalized title
    // ('workspace' is normalized to 'home' so Home and legacy Workspace merge cleanly)
    const groupsByKey = new Map<string, chrome.bookmarks.BookmarkTreeNode[]>();
    for (const child of rawChildren) {
      if (child.url) continue;
      const lower = child.title.trim().toLowerCase();
      const key = lower === 'workspace' ? 'home' : lower;
      const list = groupsByKey.get(key) || [];
      list.push(child);
      groupsByKey.set(key, list);
    }

    for (const [key, group] of groupsByKey.entries()) {
      if (group.length > 1) {
        // Prefer the folder that actually has children (or 'Home' over 'Workspace'), otherwise the first
        const primary =
          group.find(
            (g) =>
              (key === 'home' ? g.title.toLowerCase() === 'home' : true) &&
              g.children &&
              g.children.length > 0
          ) ||
          group.find((g) => g.children && g.children.length > 0) ||
          group[0];

        if (key === 'home' && primary.title !== 'Home') {
          try {
            await chrome.bookmarks.update(primary.id, { title: 'Home' });
            primary.title = 'Home';
          } catch {
            // ignore
          }
        }

        for (const dup of group) {
          if (dup.id === primary.id) continue;
          try {
            await mergeAndRemoveFolder(primary, dup);
          } catch {
            // ignore
          }
        }
      } else if (key === 'home' && group[0].title.toLowerCase() === 'workspace') {
        try {
          await chrome.bookmarks.update(group[0].id, { title: 'Home' });
          group[0].title = 'Home';
        } catch {
          // ignore
        }
      }
    }

    // Re-fetch subtree after deduplicating same-named folders
    const [dedupedSubtree] = await chrome.bookmarks.getSubTree(arcticSidebar.id);
    const dedupedChildren = dedupedSubtree.children || [];

    // 2. Remove empty legacy 'Work', 'Personal', and orphaned empty 'Quick Access (...)' folders
    // that do not belong to any currently active space
    const removedIds = new Set<string>();
    const isSpaceFolderEffectivelyEmpty = (folder?: chrome.bookmarks.BookmarkTreeNode): boolean => {
      if (!folder || !folder.children || folder.children.length === 0) return true;
      return folder.children.every((ch) => {
        if (!ch.url && ch.title.trim().toLowerCase() === QUICK_ACCESS_FOLDER_NAME.toLowerCase()) {
          return !ch.children || ch.children.length === 0;
        }
        return false;
      });
    };

    for (const child of dedupedChildren) {
      if (child.url || removedIds.has(child.id)) continue;
      const lower = child.title.trim().toLowerCase();
      const isEmpty = !child.children || child.children.length === 0;

      if (lower.startsWith('quick access (')) {
        const spaceNameLower = lower.slice('quick access ('.length, -1).trim();
        if (activeSpaceNamesLower.has(spaceNameLower)) continue;

        const matchingSpaceFolder = dedupedChildren.find(
          (c) => !c.url && c.title.trim().toLowerCase() === spaceNameLower
        );
        const spaceFolderEmpty = isSpaceFolderEffectivelyEmpty(matchingSpaceFolder);

        if (
          isEmpty &&
          (!matchingSpaceFolder ||
            ((spaceNameLower === 'work' || spaceNameLower === 'personal') && spaceFolderEmpty))
        ) {
          try {
            await chrome.bookmarks.removeTree(child.id);
            removedIds.add(child.id);
          } catch {
            // ignore
          }
        }
      } else if (
        (lower === 'work' || lower === 'personal') &&
        isSpaceFolderEffectivelyEmpty(child) &&
        !activeSpaceNamesLower.has(lower)
      ) {
        const matchingQa = dedupedChildren.find(
          (c) => !c.url && c.title.trim().toLowerCase() === `quick access (${lower})`
        );
        const qaEmpty = !matchingQa || !matchingQa.children || matchingQa.children.length === 0;
        if (qaEmpty) {
          try {
            await chrome.bookmarks.removeTree(child.id);
            removedIds.add(child.id);
          } catch {
            // ignore
          }
          if (matchingQa) {
            try {
              await chrome.bookmarks.removeTree(matchingQa.id);
              removedIds.add(matchingQa.id);
            } catch {
              // ignore
            }
          }
        }
      }
    }

    // Find or create 'Home'
    let homeFolder = dedupedChildren.find(
      (c) =>
        !c.url &&
        !removedIds.has(c.id) &&
        (c.title.trim().toLowerCase() === 'home' || c.title.trim().toLowerCase() === 'workspace')
    );
    if (!homeFolder) {
      homeFolder = await chrome.bookmarks.create({
        parentId: arcticSidebar.id,
        title: 'Home'
      });
    }

    // Ensure 'Home / Quick Access' exists and migrate any root-level 'Quick Access' or 'Quick Access (Home)' into it
    const legacyHomeQaFolders = dedupedChildren.filter(
      (c) =>
        !c.url &&
        !removedIds.has(c.id) &&
        c.id !== homeFolder!.id &&
        (c.title.trim().toLowerCase() === 'quick access' ||
          c.title.trim().toLowerCase() === 'quick access (home)')
    );
    const homeQuickAccess = await ensureSpaceQuickAccessChild(
      homeFolder,
      legacyHomeQaFolders,
      isNewSidebar
    );
    for (const lqa of legacyHomeQaFolders) {
      removedIds.add(lqa.id);
    }

    // Ensure every other space folder under Arctic has its own '<Space> / Quick Access' subfolder,
    // migrating any root-level 'Quick Access (<Space>)' into '<Space> / Quick Access'
    const remainingSpaceFolders = dedupedChildren.filter(
      (c) =>
        !c.url &&
        !removedIds.has(c.id) &&
        c.id !== homeFolder!.id &&
        c.title.trim().toLowerCase() !== 'quick access' &&
        !c.title.trim().toLowerCase().startsWith('quick access (')
    );

    for (const spFolder of remainingSpaceFolders) {
      const spLower = spFolder.title.trim().toLowerCase();
      const matchingLegacyQa = dedupedChildren.filter(
        (c) =>
          !c.url &&
          !removedIds.has(c.id) &&
          c.title.trim().toLowerCase() === `quick access (${spLower})`
      );
      await ensureSpaceQuickAccessChild(spFolder, matchingLegacyQa, false);
      for (const mqa of matchingLegacyQa) {
        removedIds.add(mqa.id);
      }
    }

    // Clean up any leftover orphaned 'Quick Access (<Space>)' folders at root that had no space folder
    const leftoverQaFolders = dedupedChildren.filter(
      (c) =>
        !c.url &&
        !removedIds.has(c.id) &&
        c.title.trim().toLowerCase().startsWith('quick access (')
    );
    for (const orphanQa of leftoverQaFolders) {
      const lowerTitle = orphanQa.title.trim().toLowerCase();
      const spaceName = orphanQa.title.trim().slice('quick access ('.length, -1).trim();
      const hasItems = orphanQa.children && orphanQa.children.length > 0;
      if (hasItems && spaceName && lowerTitle !== 'quick access (work)' && lowerTitle !== 'quick access (personal)') {
        try {
          const recoveredSpaceFolder = await chrome.bookmarks.create({
            parentId: arcticSidebar.id,
            title: spaceName
          });
          await ensureSpaceQuickAccessChild(recoveredSpaceFolder, [orphanQa], false);
          removedIds.add(orphanQa.id);
        } catch {
          // ignore
        }
      } else {
        try {
          await chrome.bookmarks.removeTree(orphanQa.id);
          removedIds.add(orphanQa.id);
        } catch {
          // ignore
        }
      }
    }

    // Re-fetch sub-tree of Arctic Sidebar to include cleaned & migrated nodes
    const [finalSubtree] = await chrome.bookmarks.getSubTree(arcticSidebar.id);
    const finalHome =
      finalSubtree.children?.find((c) => c.id === homeFolder!.id) || homeFolder;
    const finalQa =
      finalHome.children?.find(
        (c) =>
          c.id === homeQuickAccess.id ||
          (!c.url && c.title.trim().toLowerCase() === QUICK_ACCESS_FOLDER_NAME.toLowerCase())
      ) || homeQuickAccess;

    return {
      rootId: arcticSidebar.id,
      quickAccessId: finalQa.id,
      workspaceId: finalHome.id,
      arcticSidebarSubtree: finalSubtree,
      quickAccessSubtree: finalQa,
      homeSubtree: finalHome,
      isNewSidebar
    };
  };

  /**
   * Core function to reload bookmarks from Chrome
   */
  const loadBookmarks = useCallback(async () => {
    if (isLoadingRef.current) {
      pendingReloadRef.current = true;
      return;
    }
    isLoadingRef.current = true;

    try {
      isInternalMutationRef.current = true;
      // Check stored custom settings in storage.local first so ensureDefaultFolders knows which spaces are active
      const settings = (await chrome.storage.local.get([
        'quickAccessFolderId',
        'workspaceFolderId',
        'spaces',
        'activeSpaceId'
      ])) as LocalSettings;

      let currentSpaces: SpaceItem[] = Array.isArray(settings.spaces) ? [...settings.spaces] : [];
      const activeSpaceNamesLower = new Set(
        currentSpaces.map((s) => s.name.trim().toLowerCase())
      );

      const defaultIds = await ensureDefaultFolders(activeSpaceNamesLower);
      const homeFolderId = settings.workspaceFolderId || defaultIds.workspaceId;
      const children = defaultIds.arcticSidebarSubtree.children || [];

      // Restore any folder notes from their bookmark URL hash if local storage was wiped (reinstall scenario)
      try {
        const notesToRestore: Record<string, string> = {};
        const scanNotes = (node: chrome.bookmarks.BookmarkTreeNode) => {
          if (node.url && isScratchpadUrl(node.url)) {
            const nId = getScratchpadNoteId(node.url);
            const content = extractNoteContentFromUrl(node.url);
            if (nId && content) {
              notesToRestore[`arctic_note_${nId}`] = content;
            }
          }
          if (node.children) {
            for (const c of node.children) scanNotes(c);
          }
        };
        scanNotes(defaultIds.arcticSidebarSubtree);
        const noteKeys = Object.keys(notesToRestore);
        if (noteKeys.length > 0) {
          const currentStorage = await chrome.storage.local.get(noteKeys);
          const missingPayload: Record<string, string> = {};
          for (const k of noteKeys) {
            if (!currentStorage[k]) {
              missingPayload[k] = notesToRestore[k];
            }
          }
          if (Object.keys(missingPayload).length > 0) {
            await chrome.storage.local.set(missingPayload);
          }
        }
      } catch (noteRestoreErr) {
        console.warn('[Arctic] Could not auto-restore notes from bookmarks:', noteRestoreErr);
      }

      // Ensure home space is present and valid, and automatically discover any Space folders under Arctic root
      let hasHome = false;
      const ensuredSpaces: SpaceItem[] = [];
      const seenSpaceIds = new Set<string>();
      const seenSpaceNamesLower = new Set<string>();

      for (const s of currentSpaces) {
        let updated = { ...s };
        if (s.id === 'home' || s.name.toLowerCase() === 'home' || s.name.toLowerCase() === 'workspace') {
          if (hasHome) continue; // deduplicate multiple home entries
          hasHome = true;
          updated = {
            ...updated,
            id: 'home',
            name: 'Home',
            folderId: homeFolderId,
            icon: 'home',
            quickAccessFolderId: defaultIds.quickAccessId
          };
          seenSpaceIds.add('home');
          seenSpaceNamesLower.add('home');
          ensuredSpaces.push(updated);
        } else {
          // Ensure unique space ID
          if (seenSpaceIds.has(updated.id)) {
            updated.id = `space-${updated.folderId || Date.now()}-${ensuredSpaces.length}`;
          }

          // Reconcile folderId with actual bookmark tree, and merge any duplicate folders with the same space name
          const matchingFolders = children.filter(
            (c) => !c.url && c.title.toLowerCase() === updated.name.toLowerCase()
          );
          let primaryFolder: chrome.bookmarks.BookmarkTreeNode | undefined;
          if (matchingFolders.length > 0) {
            primaryFolder =
              matchingFolders.find((c) => c.id === updated.folderId) || matchingFolders[0];
            updated.folderId = primaryFolder.id;

            // Merge any duplicate folders of the same space name into primaryFolder
            for (const dup of matchingFolders) {
              if (dup.id === primaryFolder.id) continue;
              try {
                await mergeAndRemoveFolder(primaryFolder, dup);
              } catch {
                // ignore
              }
            }
          } else {
            let folderExists = false;
            if (updated.folderId) {
              try {
                const sub = await chrome.bookmarks.getSubTree(updated.folderId);
                if (sub && sub.length > 0) {
                  folderExists = true;
                  primaryFolder = sub[0];
                }
              } catch {
                folderExists = false;
              }
            }
            if (!folderExists) {
              // Stale space entry whose bookmark folder was already deleted — skip it!
              continue;
            }
          }

          // Each space has its own Quick Access subfolder directly inside its space folder (<Space> / Quick Access)
          const qaChild = primaryFolder?.children?.find(
            (c) => !c.url && c.title.trim().toLowerCase() === QUICK_ACCESS_FOLDER_NAME.toLowerCase()
          );
          if (qaChild) {
            updated.quickAccessFolderId = qaChild.id;
          } else if (primaryFolder) {
            try {
              const ensuredQa = await ensureSpaceQuickAccessChild(primaryFolder, [], false);
              updated.quickAccessFolderId = ensuredQa.id;
            } catch {
              updated.quickAccessFolderId = defaultIds.quickAccessId;
            }
          }

          seenSpaceIds.add(updated.id);
          seenSpaceNamesLower.add(updated.name.trim().toLowerCase());
          ensuredSpaces.push(updated);
        }
      }

      if (!hasHome) {
        ensuredSpaces.unshift({
          id: 'home',
          name: 'Home',
          folderId: homeFolderId,
          icon: 'home',
          quickAccessFolderId: defaultIds.quickAccessId
        });
        seenSpaceIds.add('home');
        seenSpaceNamesLower.add('home');
      }

      // Automatically discover any non-Home space folders present under Arctic root
      for (const child of children) {
        if (child.url) continue;
        const lower = child.title.trim().toLowerCase();
        if (
          lower === 'home' ||
          lower === 'workspace' ||
          lower === 'quick access' ||
          lower.startsWith('quick access (') ||
          seenSpaceNamesLower.has(lower)
        ) {
          continue;
        }

        const qaChild = child.children?.find(
          (c) => !c.url && c.title.trim().toLowerCase() === QUICK_ACCESS_FOLDER_NAME.toLowerCase()
        );
        let qaId = qaChild?.id;
        if (!qaId) {
          try {
            const ensuredQa = await ensureSpaceQuickAccessChild(child, [], false);
            qaId = ensuredQa.id;
          } catch {
            qaId = defaultIds.quickAccessId;
          }
        }

        const discoveredId = seenSpaceIds.has(`space-${child.id}`)
          ? `space-${child.id}-${ensuredSpaces.length}`
          : `space-${child.id}`;

        seenSpaceIds.add(discoveredId);
        seenSpaceNamesLower.add(lower);
        ensuredSpaces.push({
          id: discoveredId,
          name: child.title.trim(),
          folderId: child.id,
          icon: inferSpaceIcon(child.title),
          quickAccessFolderId: qaId
        });
      }

      currentSpaces = ensuredSpaces;

      const currentActiveSpaceId =
        settings.activeSpaceId && currentSpaces.some((s) => s.id === settings.activeSpaceId)
          ? settings.activeSpaceId
          : currentSpaces[0].id;

      // Persist spaces to both storage.local and storage.sync
      await persistSpaces(currentSpaces, currentActiveSpaceId);

      const activeSpace =
        currentSpaces.find((s) => s.id === currentActiveSpaceId) || currentSpaces[0];

      const workspaceId = activeSpace.folderId || homeFolderId;
      const activeQaId =
        activeSpace.id === 'home' && settings.quickAccessFolderId
          ? settings.quickAccessFolderId
          : activeSpace.quickAccessFolderId || defaultIds.quickAccessId;

      setSpaces(currentSpaces);
      setActiveSpaceId(currentActiveSpaceId);
      setActiveFolderIds({
        quickAccessId: activeQaId,
        workspaceId,
        defaultRootId: defaultIds.rootId
      });

      // Load Quick Access sub-tree (reuse already fetched node when matching default)
      if (activeQaId === defaultIds.quickAccessId && defaultIds.quickAccessSubtree) {
        setQuickAccessNode(defaultIds.quickAccessSubtree);
      } else {
        try {
          const [qa] = await chrome.bookmarks.getSubTree(activeQaId);
          setQuickAccessNode(qa);
        } catch (err) {
          console.warn('[Arctic] Quick Access folder not found, falling back to default:', err);
          setQuickAccessNode(defaultIds.quickAccessSubtree);
          if (activeSpace.id === 'home') {
            await chrome.storage.local.remove('quickAccessFolderId');
          }
        }
      }

      // Load active Space / Home sub-tree (reuse already fetched node when matching default)
      if (workspaceId === defaultIds.workspaceId && defaultIds.homeSubtree) {
        setWorkspaceNode(defaultIds.homeSubtree);
      } else {
        try {
          const [ws] = await chrome.bookmarks.getSubTree(workspaceId);
          setWorkspaceNode(ws);
        } catch (err) {
          console.warn('[Arctic] Space folder not found, falling back to default Home:', err);
          setWorkspaceNode(defaultIds.homeSubtree);
        }
      }

      // Unblock UI immediately before loading full bookmark folder dropdown options in background
      setLoading(false);

      // Asynchronously load all folders for Settings dropdown selection
      chrome.bookmarks
        .getTree()
        .then((fullTree) => {
          setAllFolders(collectFolderOptions(fullTree));
        })
        .catch((err) => {
          console.warn('[Arctic] Could not load full folder list:', err);
        });
    } catch (err) {
      console.error('[Arctic] Error loading bookmarks:', err);
    } finally {
      isInternalMutationRef.current = false;
      isLoadingRef.current = false;
      setLoading(false);
      if (pendingReloadRef.current) {
        pendingReloadRef.current = false;
        loadBookmarks();
      }
    }
  }, []);

  // Switch active Space
  const selectSpace = useCallback(
    async (spaceId: string) => {
      await chrome.storage.local.set({ activeSpaceId: spaceId });
      setActiveSpaceId(spaceId);
      await loadBookmarks();
    },
    [loadBookmarks]
  );

  // Create a new Space (reuses or merges any existing folder with the same name under Arctic root, or creates a new one)
  const createSpace = useCallback(
    async (name: string, icon: string = 'folder', existingFolderId?: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      isInternalMutationRef.current = true;
      try {
        const parentId = activeFolderIds.defaultRootId || '2';
        const trimmedLower = trimmed.toLowerCase();
        const targetQaTitle = `Quick Access (${trimmed})`;
        const targetQaLower = targetQaTitle.toLowerCase();

        // Check existing children under Arctic root to reuse/merge any folder with the same space name
        let rootChildren: chrome.bookmarks.BookmarkTreeNode[] = [];
        try {
          rootChildren = await chrome.bookmarks.getChildren(parentId);
        } catch {
          rootChildren = [];
        }

        let folderId = existingFolderId;
        if (!folderId) {
          const matchingFolders = rootChildren.filter(
            (c) => !c.url && c.title.toLowerCase() === trimmedLower
          );
          if (matchingFolders.length > 0) {
            folderId = matchingFolders[0].id;
            // If duplicate folders with the same name exist (e.g. from prior reinstalls), merge their contents into the primary folder
            for (let i = 1; i < matchingFolders.length; i++) {
              try {
                const dupChildren = await chrome.bookmarks.getChildren(matchingFolders[i].id);
                for (const item of dupChildren) {
                  await chrome.bookmarks.move(item.id, { parentId: folderId });
                }
                await chrome.bookmarks.removeTree(matchingFolders[i].id);
              } catch {
                // ignore
              }
            }
          } else {
            const newFolder = await chrome.bookmarks.create({
              parentId,
              title: trimmed
            });
            folderId = newFolder.id;
          }
        }

        // Ensure space-specific Quick Access subfolder exists directly inside the space folder (<Space> / Quick Access)
        let qaFolderId: string;
        try {
          const [spaceSubtree] = await chrome.bookmarks.getSubTree(folderId);
          const legacyQaFolders = rootChildren.filter(
            (c) =>
              !c.url &&
              c.id !== activeFolderIds.quickAccessId &&
              c.title.toLowerCase() === targetQaLower
          );
          const ensuredQa = await ensureSpaceQuickAccessChild(
            spaceSubtree || { id: folderId, title: trimmed },
            legacyQaFolders,
            false
          );
          qaFolderId = ensuredQa.id;
        } catch {
          qaFolderId = activeFolderIds.quickAccessId || parentId;
        }

        const stored = (await chrome.storage.local.get(['spaces'])) as LocalSettings;
        const baseSpaces = Array.isArray(stored.spaces) && stored.spaces.length > 0 ? stored.spaces : spaces;

        const existingSpaceIdx = baseSpaces.findIndex(
          (s) => s.name.toLowerCase() === trimmedLower && s.id !== 'home'
        );

        let updatedSpaces: SpaceItem[];
        let targetSpaceId: string;

        if (existingSpaceIdx !== -1) {
          targetSpaceId = baseSpaces[existingSpaceIdx].id;
          updatedSpaces = baseSpaces.map((s, idx) =>
            idx === existingSpaceIdx
              ? { ...s, name: trimmed, folderId: folderId!, icon, quickAccessFolderId: qaFolderId }
              : s
          );
        } else {
          targetSpaceId = `space-${Date.now()}`;
          const newSpace: SpaceItem = {
            id: targetSpaceId,
            name: trimmed,
            folderId,
            icon,
            quickAccessFolderId: qaFolderId
          };
          updatedSpaces = [...baseSpaces, newSpace];
        }

        await persistSpaces(updatedSpaces, targetSpaceId);
      } finally {
        isInternalMutationRef.current = false;
      }
      await loadBookmarks();
    },
    [activeFolderIds.defaultRootId, activeFolderIds.quickAccessId, spaces, loadBookmarks]
  );

  // Rename a Space
  const renameSpace = useCallback(
    async (spaceId: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      isInternalMutationRef.current = true;
      try {
        const stored = (await chrome.storage.local.get(['spaces'])) as LocalSettings;
        const baseSpaces = Array.isArray(stored.spaces) && stored.spaces.length > 0 ? stored.spaces : spaces;
        const target = baseSpaces.find((s) => s.id === spaceId) || spaces.find((s) => s.id === spaceId);
        if (target) {
          try {
            await chrome.bookmarks.update(target.folderId, { title: trimmed });
          } catch {
            // ignore if bookmark folder cannot be updated
          }
        }
        const updated = baseSpaces.map((s) => (s.id === spaceId ? { ...s, name: trimmed } : s));
        await persistSpaces(updated);
      } finally {
        isInternalMutationRef.current = false;
      }
      await loadBookmarks();
    },
    [spaces, loadBookmarks]
  );

  // Delete a Space (keeps at least 1 space)
  const deleteSpace = useCallback(
    async (spaceId: string) => {
      const stored = (await chrome.storage.local.get(['spaces', 'activeSpaceId'])) as LocalSettings;
      const baseSpaces = Array.isArray(stored.spaces) && stored.spaces.length > 0 ? stored.spaces : spaces;
      if (baseSpaces.length <= 1) return;

      isInternalMutationRef.current = true;
      try {
        const target = baseSpaces.find((s) => s.id === spaceId) || spaces.find((s) => s.id === spaceId);
        const homeId = baseSpaces.find((s) => s.id === 'home')?.folderId;
        const homeQaId = baseSpaces.find((s) => s.id === 'home')?.quickAccessFolderId;

        if (target && target.id !== 'home') {
          const removedIds = new Set<string>();
          if (target.quickAccessFolderId && target.quickAccessFolderId !== homeQaId) {
            try {
              await chrome.bookmarks.removeTree(target.quickAccessFolderId);
              removedIds.add(target.quickAccessFolderId);
            } catch {
              // ignore
            }
          }
          if (target.folderId && target.folderId !== homeId) {
            try {
              await chrome.bookmarks.removeTree(target.folderId);
              removedIds.add(target.folderId);
            } catch {
              // ignore
            }
          }

          // Also clean up any matching folder by title under the Arctic root in case folderId was stale
          if (activeFolderIds.defaultRootId) {
            try {
              const rootChildren = await chrome.bookmarks.getChildren(activeFolderIds.defaultRootId);
              const targetTitleLower = target.name.toLowerCase();
              const targetQaTitleLower = `quick access (${targetTitleLower})`;
              for (const child of rootChildren) {
                if (child.url || removedIds.has(child.id)) continue;
                const cLower = child.title.toLowerCase();
                if (
                  (cLower === targetTitleLower || cLower === targetQaTitleLower) &&
                  child.id !== homeId &&
                  child.id !== homeQaId
                ) {
                  try {
                    await chrome.bookmarks.removeTree(child.id);
                    removedIds.add(child.id);
                  } catch {
                    // ignore
                  }
                }
              }
            } catch {
              // ignore
            }
          }
        }

        const updated = baseSpaces.filter(
          (s) =>
            s.id !== spaceId &&
            !(target && target.id !== 'home' && s.name.toLowerCase() === target.name.toLowerCase())
        );
        const finalSpaces =
          updated.length > 0
            ? updated
            : [baseSpaces.find((s) => s.id === 'home') || baseSpaces[0]];
        const currentAct = stored.activeSpaceId || activeSpaceId;
        const nextActive =
          finalSpaces.some((s) => s.id === currentAct) ? currentAct : finalSpaces[0].id;

        setSpaces(finalSpaces);
        setActiveSpaceId(nextActive);
        await persistSpaces(finalSpaces, nextActive);
      } finally {
        isInternalMutationRef.current = false;
      }
      await loadBookmarks();
    },
    [spaces, activeSpaceId, activeFolderIds.defaultRootId, loadBookmarks]
  );

  // Set custom folder IDs
  const setQuickAccessFolderId = async (id: string) => {
    const updatedSpaces = spaces.map((s) =>
      s.id === activeSpaceId ? { ...s, quickAccessFolderId: id } : s
    );
    await chrome.storage.local.set({ quickAccessFolderId: id });
    await persistSpaces(updatedSpaces);
    loadBookmarks();
  };

  const setWorkspaceFolderId = async (id: string) => {
    // Update the currently active space's folderId (and workspaceFolderId if home)
    const updatedSpaces = spaces.map((s) =>
      s.id === activeSpaceId ? { ...s, folderId: id } : s
    );
    await chrome.storage.local.set({ workspaceFolderId: id });
    await persistSpaces(updatedSpaces);
    loadBookmarks();
  };

  const resetToDefaultFolders = async () => {
    isInternalMutationRef.current = true;
    try {
      await chrome.storage.local.remove([
        'quickAccessFolderId',
        'workspaceFolderId',
        'spaces',
        'activeSpaceId'
      ]);
      if (chrome.storage && chrome.storage.sync) {
        await chrome.storage.sync.remove([
          'quickAccessFolderId',
          'workspaceFolderId',
          'spaces',
          'activeSpaceId'
        ]);
      }
    } finally {
      isInternalMutationRef.current = false;
    }
    loadBookmarks();
  };

  // Add bookmark
  const createBookmark = async (parentId: string, title: string, url: string) => {
    await chrome.bookmarks.create({ parentId, title, url });
    loadBookmarks();
  };

  // Add folder (if a folder named 'Quick Access' already exists in parent, reuse it instead of duplicating)
  const createFolder = async (parentId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (trimmed.toLowerCase() === QUICK_ACCESS_FOLDER_NAME.toLowerCase()) {
      try {
        const siblings = await chrome.bookmarks.getChildren(parentId);
        const existingQa = siblings.find(
          (c) => !c.url && c.title.trim().toLowerCase() === QUICK_ACCESS_FOLDER_NAME.toLowerCase()
        );
        if (existingQa) {
          loadBookmarks();
          return;
        }
      } catch {
        // ignore
      }
    }
    await chrome.bookmarks.create({ parentId, title: trimmed });
    loadBookmarks();
  };

  // Rename bookmark or folder
  const renameBookmarkOrFolder = async (id: string, title: string) => {
    try {
      await chrome.bookmarks.update(id, { title });
      // Also sync space name if this folder is a space root
      const matchingSpace = spaces.find((s) => s.folderId === id);
      if (matchingSpace) {
        const updatedSpaces = spaces.map((s) =>
          s.folderId === id ? { ...s, name: title } : s
        );
        await persistSpaces(updatedSpaces);
      }
    } catch (err) {
      console.warn('[Arctic] Could not rename bookmark/folder:', err);
    }
    loadBookmarks();
  };

  // Update bookmark URL & title (replace bookmarked URL)
  const updateBookmarkUrl = async (bookmarkId: string, newUrl: string, newTitle?: string) => {
    try {
      await chrome.bookmarks.update(bookmarkId, {
        url: newUrl,
        ...(newTitle ? { title: newTitle } : {})
      });
      loadBookmarks();
    } catch (err) {
      console.warn('[Arctic] Could not update bookmark URL:', err);
    }
  };

  // Remove bookmark or folder
  const removeBookmarkOrFolder = async (id: string) => {
    try {
      await chrome.bookmarks.removeTree(id);
    } catch {
      await chrome.bookmarks.remove(id);
    }
    loadBookmarks();
  };

  // Move a bookmark or folder to another Space's root folder
  const moveNodeToSpace = useCallback(
    async (nodeId: string, targetSpaceFolderId: string) => {
      try {
        await chrome.bookmarks.move(nodeId, { parentId: targetSpaceFolderId });
        await loadBookmarks();
      } catch (err) {
        console.warn('[Arctic] Could not move item to space:', err);
      }
    },
    [loadBookmarks]
  );

  // Move one or more bookmarks/folders to a target folder (with optional index) and refresh
  const moveBookmarks = useCallback(
    async (ids: string[], targetParentId: string, targetIndex?: number) => {
      if (!ids.length || !targetParentId) return;
      isInternalMutationRef.current = true;
      try {
        let curIndex = targetIndex;
        for (const id of ids) {
          if (id === targetParentId) continue;
          try {
            if (typeof curIndex === 'number') {
              const children = await chrome.bookmarks.getChildren(targetParentId);
              const isAlreadyChild = children.some((c) => c.id === id);
              const maxIndex = isAlreadyChild ? Math.max(0, children.length - 1) : children.length;
              const safeIndex = Math.min(Math.max(0, curIndex), maxIndex);
              await chrome.bookmarks.move(id, {
                parentId: targetParentId,
                index: safeIndex
              });
              curIndex = safeIndex + 1;
            } else {
              await chrome.bookmarks.move(id, { parentId: targetParentId });
            }
          } catch (moveErr) {
            console.warn('[Arctic] Error moving individual bookmark with index, retrying without index:', moveErr);
            await chrome.bookmarks.move(id, { parentId: targetParentId });
          }
        }
      } catch (err) {
        console.warn('[Arctic] Could not move bookmarks:', err);
      } finally {
        isInternalMutationRef.current = false;
      }
      await loadBookmarks();
    },
    [loadBookmarks]
  );

  // Set up listeners for real-time Chrome bookmark sync
  useEffect(() => {
    loadBookmarks();

    const handleBookmarkChange = () => {
      if (isInternalMutationRef.current) return;
      if (bookmarkDebounceTimerRef.current) {
        clearTimeout(bookmarkDebounceTimerRef.current);
      }
      bookmarkDebounceTimerRef.current = setTimeout(() => {
        loadBookmarks();
      }, 50);
    };

    chrome.bookmarks.onCreated.addListener(handleBookmarkChange);
    chrome.bookmarks.onRemoved.addListener(handleBookmarkChange);
    chrome.bookmarks.onChanged.addListener(handleBookmarkChange);
    chrome.bookmarks.onMoved.addListener(handleBookmarkChange);
    chrome.bookmarks.onChildrenReordered.addListener(handleBookmarkChange);

    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (isInternalMutationRef.current) return;
      if (areaName === 'local' && (changes.activeSpaceId || changes.spaces || changes.workspaceFolderId)) {
        if (storageDebounceTimerRef.current) {
          clearTimeout(storageDebounceTimerRef.current);
        }
        storageDebounceTimerRef.current = setTimeout(() => {
          loadBookmarks();
        }, 50);
      }
    };

    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }

    return () => {
      if (bookmarkDebounceTimerRef.current) {
        clearTimeout(bookmarkDebounceTimerRef.current);
      }
      if (storageDebounceTimerRef.current) {
        clearTimeout(storageDebounceTimerRef.current);
      }
      chrome.bookmarks.onCreated.removeListener(handleBookmarkChange);
      chrome.bookmarks.onRemoved.removeListener(handleBookmarkChange);
      chrome.bookmarks.onChanged.removeListener(handleBookmarkChange);
      chrome.bookmarks.onMoved.removeListener(handleBookmarkChange);
      chrome.bookmarks.onChildrenReordered.removeListener(handleBookmarkChange);
      if (chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      }
    };
  }, [loadBookmarks]);

  return {
    quickAccessNode,
    workspaceNode,
    allFolders,
    collapsedFolderIds,
    toggleFolderCollapse,
    setAllFoldersCollapsed,
    spaces,
    activeSpaceId,
    selectSpace,
    createSpace,
    renameSpace,
    deleteSpace,
    moveNodeToSpace,
    moveBookmarks,
    activeFolderIds,
    setQuickAccessFolderId,
    setWorkspaceFolderId,
    resetToDefaultFolders,
    createBookmark,
    createFolder,
    renameBookmarkOrFolder,
    updateBookmarkUrl,
    removeBookmarkOrFolder,
    refreshBookmarks: loadBookmarks,
    loading
  };
}
