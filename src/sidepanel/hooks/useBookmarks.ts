import { useState, useEffect, useCallback } from 'react';
import type { BookmarkFolderOption, LocalSettings, SpaceItem } from '../../types';

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
   * Find or create the default 'Arctic Sidebar' structure in 'Other Bookmarks'
   */
  const ensureDefaultFolders = async (): Promise<{
    rootId: string;
    quickAccessId: string;
    workspaceId: string;
    workId: string;
    workQuickAccessId: string;
    personalId: string;
    personalQuickAccessId: string;
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

    // Find or create 'Work' space folder
    let workFolder = arcticSidebarSubtree.children?.find(
      (c) => !c.url && c.title.toLowerCase() === 'work'
    );
    if (!workFolder) {
      workFolder = await chrome.bookmarks.create({
        parentId: arcticSidebar.id,
        title: 'Work'
      });
    }

    let workQuickAccess = arcticSidebarSubtree.children?.find(
      (c) => !c.url && c.title.toLowerCase() === 'quick access (work)'
    );
    if (!workQuickAccess) {
      workQuickAccess = await chrome.bookmarks.create({
        parentId: arcticSidebar.id,
        title: 'Quick Access (Work)'
      });
    }

    // Find or create 'Personal' space folder
    let personalFolder = arcticSidebarSubtree.children?.find(
      (c) => !c.url && c.title.toLowerCase() === 'personal'
    );
    if (!personalFolder) {
      personalFolder = await chrome.bookmarks.create({
        parentId: arcticSidebar.id,
        title: 'Personal'
      });
    }

    let personalQuickAccess = arcticSidebarSubtree.children?.find(
      (c) => !c.url && c.title.toLowerCase() === 'quick access (personal)'
    );
    if (!personalQuickAccess) {
      personalQuickAccess = await chrome.bookmarks.create({
        parentId: arcticSidebar.id,
        title: 'Quick Access (Personal)'
      });
    }

    return {
      rootId: arcticSidebar.id,
      quickAccessId: quickAccess.id,
      workspaceId: homeFolder.id,
      workId: workFolder.id,
      workQuickAccessId: workQuickAccess.id,
      personalId: personalFolder.id,
      personalQuickAccessId: personalQuickAccess.id
    };
  };

  /**
   * Core function to reload bookmarks from Chrome
   */
  const loadBookmarks = useCallback(async () => {
    try {
      const defaultIds = await ensureDefaultFolders();

      // Check stored custom settings
      const settings = (await chrome.storage.local.get([
        'quickAccessFolderId',
        'workspaceFolderId',
        'spaces',
        'activeSpaceId'
      ])) as LocalSettings;

      const homeFolderId = settings.workspaceFolderId || defaultIds.workspaceId;

      // Build or validate spaces list
      let currentSpaces: SpaceItem[] = settings.spaces || [];
      if (currentSpaces.length === 0) {
        currentSpaces = [
          { id: 'home', name: 'Home', folderId: homeFolderId, icon: 'home', quickAccessFolderId: defaultIds.quickAccessId },
          { id: 'work', name: 'Work', folderId: defaultIds.workId, icon: 'briefcase', quickAccessFolderId: defaultIds.workQuickAccessId },
          { id: 'personal', name: 'Personal', folderId: defaultIds.personalId, icon: 'user', quickAccessFolderId: defaultIds.personalQuickAccessId }
        ];
        await chrome.storage.local.set({ spaces: currentSpaces, activeSpaceId: 'home' });
      } else {
        // Ensure every space has quickAccessFolderId assigned
        let spacesUpdated = false;
        const ensuredSpaces: SpaceItem[] = [];

        for (const s of currentSpaces) {
          let updated = { ...s };
          if (s.id === 'home') {
            if (s.name.toLowerCase() === 'workspace') {
              updated = { ...updated, name: 'Home', folderId: homeFolderId };
              spacesUpdated = true;
            }
            if (!updated.quickAccessFolderId) {
              updated = { ...updated, quickAccessFolderId: defaultIds.quickAccessId };
              spacesUpdated = true;
            }
          } else if (!updated.quickAccessFolderId) {
            // Find or create Quick Access for this space
            try {
              const [rootSub] = await chrome.bookmarks.getSubTree(defaultIds.rootId);
              const targetTitle = `Quick Access (${s.name})`.toLowerCase();
              const existingQA = rootSub.children?.find(
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
              spacesUpdated = true;
            } catch {
              updated = { ...updated, quickAccessFolderId: defaultIds.quickAccessId };
            }
          }
          ensuredSpaces.push(updated);
        }

        currentSpaces = ensuredSpaces;
        if (spacesUpdated) {
          await chrome.storage.local.set({ spaces: currentSpaces });
        }
      }

      const currentActiveSpaceId =
        settings.activeSpaceId && currentSpaces.some((s) => s.id === settings.activeSpaceId)
          ? settings.activeSpaceId
          : currentSpaces[0].id;

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
      setLoading(false);
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
      await chrome.storage.local.set({
        spaces: updatedSpaces,
        activeSpaceId: newSpace.id
      });
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
      await chrome.storage.local.set({ spaces: updated });
      await loadBookmarks();
    },
    [spaces, loadBookmarks]
  );

  // Delete a Space (keeps at least 1 space)
  const deleteSpace = useCallback(
    async (spaceId: string) => {
      if (spaces.length <= 1) return;
      const target = spaces.find((s) => s.id === spaceId);
      if (target && target.quickAccessFolderId) {
        if (target.id !== 'home') {
          try {
            await chrome.bookmarks.removeTree(target.quickAccessFolderId);
          } catch {
            // ignore
          }
        }
      }
      const updated = spaces.filter((s) => s.id !== spaceId);
      const nextActive = activeSpaceId === spaceId ? updated[0].id : activeSpaceId;
      await chrome.storage.local.set({
        spaces: updated,
        activeSpaceId: nextActive
      });
      await loadBookmarks();
    },
    [spaces, activeSpaceId, loadBookmarks]
  );

  // Set custom folder IDs
  const setQuickAccessFolderId = async (id: string) => {
    const updatedSpaces = spaces.map((s) =>
      s.id === activeSpaceId ? { ...s, quickAccessFolderId: id } : s
    );
    await chrome.storage.local.set({
      quickAccessFolderId: id,
      spaces: updatedSpaces
    });
    loadBookmarks();
  };

  const setWorkspaceFolderId = async (id: string) => {
    // Update the currently active space's folderId (and workspaceFolderId if home)
    const updatedSpaces = spaces.map((s) =>
      s.id === activeSpaceId ? { ...s, folderId: id } : s
    );
    await chrome.storage.local.set({
      workspaceFolderId: id,
      spaces: updatedSpaces
    });
    loadBookmarks();
  };

  const resetToDefaultFolders = async () => {
    await chrome.storage.local.remove([
      'quickAccessFolderId',
      'workspaceFolderId',
      'spaces',
      'activeSpaceId'
    ]);
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
        await chrome.storage.local.set({ spaces: updatedSpaces });
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
      loadBookmarks();
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
      if (areaName === 'local' && (changes.activeSpaceId || changes.spaces || changes.workspaceFolderId)) {
        loadBookmarks();
      }
    };

    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }

    return () => {
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
