import { useState, useEffect, useCallback } from 'react';
import type { BookmarkFolderOption, LocalSettings } from '../../types';

export function useBookmarks() {
  const [quickAccessNode, setQuickAccessNode] = useState<chrome.bookmarks.BookmarkTreeNode | null>(null);
  const [workspaceNode, setWorkspaceNode] = useState<chrome.bookmarks.BookmarkTreeNode | null>(null);
  const [allFolders, setAllFolders] = useState<BookmarkFolderOption[]>([]);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Record<string, boolean>>({});
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
   * Find or create the default 'Arc Sidebar' structure in 'Other Bookmarks'
   */
  const ensureDefaultFolders = async (): Promise<{
    rootId: string;
    quickAccessId: string;
    workspaceId: string;
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

    // Check if 'Arc Sidebar' exists inside Other Bookmarks
    let arcSidebar = otherBookmarksNode?.children?.find(
      (c) => !c.url && (c.title === 'Arc Sidebar' || c.title === 'Arctic Sidebar')
    );

    let isNewSidebar = false;
    if (!arcSidebar) {
      arcSidebar = await chrome.bookmarks.create({
        parentId: otherId,
        title: 'Arc Sidebar'
      });
      isNewSidebar = true;
    }

    // Refresh sub-tree of Arc Sidebar to inspect children
    const [arcSidebarSubtree] = await chrome.bookmarks.getSubTree(arcSidebar.id);

    // Find or create 'Quick Access'
    let quickAccess = arcSidebarSubtree.children?.find(
      (c) => !c.url && c.title.toLowerCase() === 'quick access'
    );
    if (!quickAccess) {
      quickAccess = await chrome.bookmarks.create({
        parentId: arcSidebar.id,
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

    // Find or create 'Workspace'
    let workspace = arcSidebarSubtree.children?.find(
      (c) => !c.url && c.title.toLowerCase() === 'workspace'
    );
    if (!workspace) {
      workspace = await chrome.bookmarks.create({
        parentId: arcSidebar.id,
        title: 'Workspace'
      });

      if (isNewSidebar) {
        const devFolder = await chrome.bookmarks.create({
          parentId: workspace.id,
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
    }

    return {
      rootId: arcSidebar.id,
      quickAccessId: quickAccess.id,
      workspaceId: workspace.id
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
        'workspaceFolderId'
      ])) as LocalSettings;

      const quickAccessId = settings.quickAccessFolderId || defaultIds.quickAccessId;
      const workspaceId = settings.workspaceFolderId || defaultIds.workspaceId;

      setActiveFolderIds({
        quickAccessId,
        workspaceId,
        defaultRootId: defaultIds.rootId
      });

      // Load all folders for dropdown selection
      const fullTree = await chrome.bookmarks.getTree();
      setAllFolders(collectFolderOptions(fullTree));

      // Load Quick Access sub-tree
      try {
        const [qa] = await chrome.bookmarks.getSubTree(quickAccessId);
        setQuickAccessNode(qa);
      } catch (err) {
        console.warn('[Arctic] Quick Access folder not found, falling back to default:', err);
        const [qa] = await chrome.bookmarks.getSubTree(defaultIds.quickAccessId);
        setQuickAccessNode(qa);
        await chrome.storage.local.remove('quickAccessFolderId');
      }

      // Load Workspace sub-tree
      try {
        const [ws] = await chrome.bookmarks.getSubTree(workspaceId);
        setWorkspaceNode(ws);
      } catch (err) {
        console.warn('[Arctic] Workspace folder not found, falling back to default:', err);
        const [ws] = await chrome.bookmarks.getSubTree(defaultIds.workspaceId);
        setWorkspaceNode(ws);
        await chrome.storage.local.remove('workspaceFolderId');
      }
    } catch (err) {
      console.error('[Arctic] Error loading bookmarks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Set custom folder IDs
  const setQuickAccessFolderId = async (id: string) => {
    await chrome.storage.local.set({ quickAccessFolderId: id });
    loadBookmarks();
  };

  const setWorkspaceFolderId = async (id: string) => {
    await chrome.storage.local.set({ workspaceFolderId: id });
    loadBookmarks();
  };

  const resetToDefaultFolders = async () => {
    await chrome.storage.local.remove(['quickAccessFolderId', 'workspaceFolderId']);
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

  // Remove bookmark or folder
  const removeBookmarkOrFolder = async (id: string) => {
    try {
      await chrome.bookmarks.removeTree(id);
    } catch {
      await chrome.bookmarks.remove(id);
    }
    loadBookmarks();
  };

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

    return () => {
      chrome.bookmarks.onCreated.removeListener(handleBookmarkChange);
      chrome.bookmarks.onRemoved.removeListener(handleBookmarkChange);
      chrome.bookmarks.onChanged.removeListener(handleBookmarkChange);
      chrome.bookmarks.onMoved.removeListener(handleBookmarkChange);
      chrome.bookmarks.onChildrenReordered.removeListener(handleBookmarkChange);
    };
  }, [loadBookmarks]);

  return {
    quickAccessNode,
    workspaceNode,
    allFolders,
    collapsedFolderIds,
    toggleFolderCollapse,
    setAllFoldersCollapsed,
    activeFolderIds,
    setQuickAccessFolderId,
    setWorkspaceFolderId,
    resetToDefaultFolders,
    createBookmark,
    createFolder,
    removeBookmarkOrFolder,
    refreshBookmarks: loadBookmarks,
    loading
  };
}
