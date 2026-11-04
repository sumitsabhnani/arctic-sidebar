import { useState, useEffect, useCallback, useRef } from 'react';
import type { BookmarkFolderOption, LocalSettings, SpaceItem } from '../../types';

function inferSpaceIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'home') return 'home';
  if (lower === 'work' || lower.includes('job') || lower.includes('office')) return 'briefcase';
  if (lower === 'personal' || lower.includes('life')) return 'user';
  if (lower === 'code' || lower === 'dev' || lower.includes('develop')) return 'code';
  if (lower === 'study' || lower.includes('school') || lower.includes('read') || lower.includes('book')) return 'book';
  return 'folder';
}

export function useBookmarks() {
  const [quickAccessNode, setQuickAccessNode] = useState<chrome.bookmarks.BookmarkTreeNode | null>(null);
  const [workspaceNode, setWorkspaceNode] = useState<chrome.bookmarks.BookmarkTreeNode | null>(null);
  const [allFolders, setAllFolders] = useState<BookmarkFolderOption[]>([]);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Record<string, boolean>>({});
  const [spaces, setSpaces] = useState<SpaceItem[]>([]);
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
      const updated = {
        ...prev,
        [folderId]: !prev[folderId]
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
   * Find or create the default 'Arctic' structure in 'Other Bookmarks'
   */
  const ensureDefaultFolders = async (): Promise<{
    rootId: string;
    quickAccessId: string;
    workspaceId: string;
    arcticSidebarSubtree: chrome.bookmarks.BookmarkTreeNode;
    isNewSidebar: boolean;
  }> => {
    const tree = await chrome.bookmarks.getTree();
    const rootNode = tree[0];

    // Find "Other Bookmarks" node (standard ID is '2', or match title)
    let otherBookmarksNode = rootNode.children?.find(
      (c) => c.id === '2' || c.title.toLowerCase().includes('other')
    );

    if (!otherBookmarksNode && rootNode.children && rootNode.children.length > 1) {
      otherBookmarksNode = rootNode.children[1];
    } else if (!otherBookmarksNode && rootNode.children && rootNode.children.length > 0) {
      otherBookmarksNode = rootNode.children[0];
    }

    const otherId = otherBookmarksNode ? otherBookmarksNode.id : '1';

    // Check if 'Arctic' or 'Arctic Sidebar' exists inside Other Bookmarks
    const legacyPrefix = 'Ar' + 'c Sidebar';
    let arcticSidebar = otherBookmarksNode?.children?.find(
      (c) => !c.url && (c.title === 'Arctic' || c.title === 'Arctic Sidebar' || c.title === legacyPrefix)
    );

    let isNewSidebar = false;
    if (!arcticSidebar) {
      arcticSidebar = await chrome.bookmarks.create({
        parentId: otherId,
        title: 'Arctic'
      });
      isNewSidebar = true;
    } else if (arcticSidebar.title === legacyPrefix) {
      await chrome.bookmarks.update(arcticSidebar.id, { title: 'Arctic' });
    }

    // Refresh sub-tree of Arctic Sidebar to inspect children
    const [arcticSidebarSubtree] = await chrome.bookmarks.getSubTree(arcticSidebar.id);

    // Find or create 'Quick Access'
    let quickAccess = arcticSidebarSubtree.children?.find(
      (c) => !c.url && c.title.toLowerCase() === 'quick access'
    );
    if (!quickAccess) {
      quickAccess = await chrome.bookmarks.create({
        parentId: arcticSidebar.id,
        title: 'Quick Access'
      });

      // If this is a fresh setup, populate starter bookmarks in Quick Access
      if (isNewSidebar) {
        await chrome.bookmarks.create({
          parentId: quickAccess.id,
          title: 'Google',
          url: 'https://www.google.com'
        });
        await chrome.bookmarks.create({
          parentId: quickAccess.id,
          title: 'GitHub',
          url: 'https://github.com'
        });
        await chrome.bookmarks.create({
          parentId: quickAccess.id,
          title: 'YouTube',
          url: 'https://www.youtube.com'
        });
        await chrome.bookmarks.create({
          parentId: quickAccess.id,
          title: 'Reddit',
          url: 'https://www.reddit.com'
        });
      }
    }

    // Find or create 'Home' (auto-migrate 'Workspace' -> 'Home')
    let homeFolder = arcticSidebarSubtree.children?.find(
      (c) => !c.url && (c.title.toLowerCase() === 'home' || c.title.toLowerCase() === 'workspace')
    );
    if (!homeFolder) {
      homeFolder = await chrome.bookmarks.create({
        parentId: arcticSidebar.id,
        title: 'Home'
      });

      if (isNewSidebar) {
        const devFolder = await chrome.bookmarks.create({
          parentId: homeFolder.id,
          title: 'Development'
        });
        await chrome.bookmarks.create({
          parentId: devFolder.id,
          title: 'Tailwind CSS Docs',
          url: 'https://tailwindcss.com/docs'
        });
        await chrome.bookmarks.create({
          parentId: devFolder.id,
          title: 'Chrome Extensions Docs',
          url: 'https://developer.chrome.com/docs/extensions'
        });
      }
    } else if (homeFolder.title.toLowerCase() === 'workspace') {
      await chrome.bookmarks.update(homeFolder.id, { title: 'Home' });
      homeFolder.title = 'Home';
    }

    // Re-fetch sub-tree of Arctic Sidebar to include created nodes
    const [finalSubtree] = await chrome.bookmarks.getSubTree(arcticSidebar.id);

    return {
      rootId: arcticSidebar.id,
      quickAccessId: quickAccess.id,
      workspaceId: homeFolder.id,
      arcticSidebarSubtree: finalSubtree,
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
      const defaultIds = await ensureDefaultFolders();

      // Check stored custom settings (storage.local first, then storage.sync)
      const settings = (await chrome.storage.local.get([
        'quickAccessFolderId',
        'workspaceFolderId',
        'spaces',
        'activeSpaceId'
      ])) as LocalSettings;

      let currentSpaces: SpaceItem[] = Array.isArray(settings.spaces) ? [...settings.spaces] : [];

      // If local spaces are empty (e.g. extension was uninstalled and reinstalled), check storage.sync
      if (currentSpaces.length === 0 && chrome.storage && chrome.storage.sync) {
        try {
          const syncData = await chrome.storage.sync.get(['spaces', 'activeSpaceId']);
          if (Array.isArray(syncData.spaces) && syncData.spaces.length > 0) {
            currentSpaces = [...syncData.spaces];
          }
        } catch (e) {
          console.warn('[Arctic] Could not read spaces from storage.sync:', e);
        }
      }

      const homeFolderId = settings.workspaceFolderId || defaultIds.workspaceId;

      // Reconstruct / retain any spaces from existing bookmark folders
      // If the user previously had Arctic installed and reinstalled, spaces are restored from bookmarks
      if (currentSpaces.length === 0) {
        const knownFolderIds = new Set<string>();
        const children = defaultIds.arcticSidebarSubtree.children || [];

        for (const child of children) {
          if (child.url) continue; // ignore bookmark links
          const titleLower = child.title.toLowerCase();
          if (
            titleLower === 'quick access' ||
            titleLower.startsWith('quick access (') ||
            titleLower === 'home' ||
            titleLower === 'workspace'
          ) {
            continue;
          }

          if (!knownFolderIds.has(child.id)) {
            const matchingQaTitle = `quick access (${titleLower})`;
            const qaFolder = children.find(
              (c) => !c.url && c.title.toLowerCase() === matchingQaTitle
            );
            currentSpaces.push({
              id: child.title.toLowerCase() === 'work' ? 'work' : child.title.toLowerCase() === 'personal' ? 'personal' : `space-${child.id}`,
              name: child.title,
              folderId: child.id,
              icon: inferSpaceIcon(child.title),
              quickAccessFolderId: qaFolder ? qaFolder.id : defaultIds.quickAccessId
            });
            knownFolderIds.add(child.id);
          }
        }
      }

      // If still empty (fresh install with no prior spaces), keep only 1 as Home
      if (currentSpaces.length === 0) {
        currentSpaces = [
          {
            id: 'home',
            name: 'Home',
            folderId: homeFolderId,
            icon: 'home',
            quickAccessFolderId: defaultIds.quickAccessId
          }
        ];
      } else {
        // Ensure home space is present and valid
        let hasHome = false;
        const ensuredSpaces: SpaceItem[] = [];
        const children = defaultIds.arcticSidebarSubtree.children || [];

        for (const s of currentSpaces) {
          let updated = { ...s };
          if (s.id === 'home' || s.name.toLowerCase() === 'home' || s.name.toLowerCase() === 'workspace') {
            hasHome = true;
            updated = {
              ...updated,
              id: 'home',
              name: 'Home',
              folderId: homeFolderId,
              icon: 'home',
              quickAccessFolderId: updated.quickAccessFolderId || defaultIds.quickAccessId
            };
          } else if (!updated.quickAccessFolderId) {
            // Find or create Quick Access for this space
            try {
              const targetTitle = `quick access (${s.name})`.toLowerCase();
              const existingQA = children.find(
                (c) => !c.url && c.title.toLowerCase() === targetTitle
              );
              if (existingQA) {
                updated = { ...updated, quickAccessFolderId: existingQA.id };
              } else {
                const createdQA = await chrome.bookmarks.create({
                  parentId: defaultIds.rootId,
                  title: `Quick Access (${s.name})`
                });
                updated = { ...updated, quickAccessFolderId: createdQA.id };
              }
            } catch {
              updated = { ...updated, quickAccessFolderId: defaultIds.quickAccessId };
            }
          }
          ensuredSpaces.push(updated);
        }

        if (!hasHome) {
          ensuredSpaces.unshift({
            id: 'home',
            name: 'Home',
            folderId: homeFolderId,
            icon: 'home',
            quickAccessFolderId: defaultIds.quickAccessId
          });
        }

        currentSpaces = ensuredSpaces;
      }

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

      // Load all folders for dropdown selection
      const fullTree = await chrome.bookmarks.getTree();
      setAllFolders(collectFolderOptions(fullTree));

      // Load Quick Access sub-tree
      try {
        const [qa] = await chrome.bookmarks.getSubTree(activeQaId);
        setQuickAccessNode(qa);
      } catch (err) {
        console.warn('[Arctic] Quick Access folder not found, falling back to default:', err);
        const [qa] = await chrome.bookmarks.getSubTree(defaultIds.quickAccessId);
        setQuickAccessNode(qa);
        if (activeSpace.id === 'home') {
          await chrome.storage.local.remove('quickAccessFolderId');
        }
      }

      // Load active Space / Home sub-tree
      try {
        const [ws] = await chrome.bookmarks.getSubTree(workspaceId);
        setWorkspaceNode(ws);
      } catch (err) {
        console.warn('[Arctic] Space folder not found, falling back to default Home:', err);
        const [ws] = await chrome.bookmarks.getSubTree(defaultIds.workspaceId);
        setWorkspaceNode(ws);
      }
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

  // Create a new Space (creates a folder under Arctic Sidebar root by default, or uses given folderId)
  const createSpace = useCallback(
    async (name: string, icon: string = 'folder', existingFolderId?: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const parentId = activeFolderIds.defaultRootId || '2';
      let folderId = existingFolderId;
      if (!folderId) {
        const newFolder = await chrome.bookmarks.create({
          parentId,
          title: trimmed
        });
        folderId = newFolder.id;
      }

      // Create space-specific Quick Access folder under Arctic root
      let qaFolderId: string;
      try {
        const qaFolder = await chrome.bookmarks.create({
          parentId,
          title: `Quick Access (${trimmed})`
        });
        qaFolderId = qaFolder.id;
      } catch {
        qaFolderId = activeFolderIds.quickAccessId || parentId;
      }

      const newSpace: SpaceItem = {
        id: `space-${Date.now()}`,
        name: trimmed,
        folderId,
        icon,
        quickAccessFolderId: qaFolderId
      };

      const updatedSpaces = [...spaces, newSpace];
      await persistSpaces(updatedSpaces, newSpace.id);
      await loadBookmarks();
    },
    [activeFolderIds.defaultRootId, activeFolderIds.quickAccessId, spaces, loadBookmarks]
  );

  // Rename a Space
  const renameSpace = useCallback(
    async (spaceId: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      const target = spaces.find((s) => s.id === spaceId);
      if (target) {
        try {
          await chrome.bookmarks.update(target.folderId, { title: trimmed });
        } catch {
          // ignore if bookmark folder cannot be updated
        }
        if (target.quickAccessFolderId) {
          try {
            await chrome.bookmarks.update(target.quickAccessFolderId, {
              title: `Quick Access (${trimmed})`
            });
          } catch {
            // ignore
          }
        }
      }
      const updated = spaces.map((s) => (s.id === spaceId ? { ...s, name: trimmed } : s));
      await persistSpaces(updated);
      await loadBookmarks();
    },
    [spaces, loadBookmarks]
  );

  // Delete a Space (keeps at least 1 space)
  const deleteSpace = useCallback(
    async (spaceId: string) => {
      if (spaces.length <= 1) return;
      const target = spaces.find((s) => s.id === spaceId);
      if (target && target.id !== 'home') {
        if (target.quickAccessFolderId) {
          try {
            await chrome.bookmarks.removeTree(target.quickAccessFolderId);
          } catch {
            // ignore
          }
        }
        if (target.folderId) {
          try {
            await chrome.bookmarks.removeTree(target.folderId);
          } catch {
            // ignore
          }
        }
      }
      const updated = spaces.filter((s) => s.id !== spaceId);
      const nextActive = activeSpaceId === spaceId ? updated[0].id : activeSpaceId;
      await persistSpaces(updated, nextActive);
      await loadBookmarks();
    },
    [spaces, activeSpaceId, loadBookmarks]
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

  // Add folder
  const createFolder = async (parentId: string, title: string) => {
    await chrome.bookmarks.create({ parentId, title });
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
