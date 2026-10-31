import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useBookmarks } from './hooks/useBookmarks';
import { useTabBindings } from './hooks/useTabBindings';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { QuickAccessGrid } from './components/QuickAccessGrid';
import { FolderNode } from './components/FolderNode';
import { BookmarkRow } from './components/BookmarkRow';
import { OpenTabsSection } from './components/OpenTabsSection';
import { SpacesSwitcher } from './components/SpacesSwitcher';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import type { TabBinding, LocalSettings, ColorThemeId, ThemeMode } from '../types';
import { Loader2, FolderPlus, BookmarkPlus, Folder, Check, X } from 'lucide-react';

export const App: React.FC = () => {
  const {
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
    loading
  } = useBookmarks();

  const {
    bindingsByBookmarkId,
    bookmarkIdByTabId,
    tabsByTabId,
    activeTabId,
    unpinnedTabs,
    createNewTab,
    focusTab,
    handleRowClick,
    handleFaviconClick,
    handleFaviconDoubleClick,
    handleQuickAccessClick,
    handleCloseTab,
    closeAllUnpinnedTabs,
    pinTab,
    duplicateTab,
    reloadTab,
    reloadActiveTab,
    isActiveTabLoading,
    activeTabUrl,
    navigateActiveTab,
    discardTab,
    discardAllBackgroundTabs,
    discardedTabsByTabId,
    moveOpenTab,
    renameOpenTab,
    toggleMuteTab,
    autoArchiveInterval,
    setAutoArchiveInterval,
    updateBookmarkBindingUrl
  } = useTabBindings();

  // Theme State
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [colorTheme, setColorTheme] = useState<ColorThemeId>('glacier-blue');

  // Section Collapsed States
  const [collapsedSections, setCollapsedSections] = useState<{
    quickAccess: boolean;
    workspace: boolean;
    todayTabs: boolean;
  }>({
    quickAccess: false,
    workspace: false,
    todayTabs: false
  });

  useEffect(() => {
    chrome.storage.local.get(['theme', 'colorTheme', 'collapsedSections'], (res) => {
      if (res.theme === 'light' || res.theme === 'dark') {
        setTheme(res.theme as ThemeMode);
      }
      if (
        typeof res.colorTheme === 'string' &&
        [
          'glacier-blue',
          'midnight-amethyst',
          'forest-sage',
          'warm-terracotta',
          'pure-monochrome',
          'slate-grey'
        ].includes(res.colorTheme)
      ) {
        setColorTheme(res.colorTheme as ColorThemeId);
      }
      if (res.collapsedSections) {
        setCollapsedSections(res.collapsedSections as { quickAccess: boolean; workspace: boolean; todayTabs: boolean });
      }
    });
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
    document.documentElement.setAttribute('data-color-theme', colorTheme);
  }, [theme, colorTheme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      chrome.storage.local.set({ theme: next } as LocalSettings);
      return next;
    });
  }, []);

  const handleSelectColorTheme = useCallback((newTheme: ColorThemeId) => {
    setColorTheme(newTheme);
    chrome.storage.local.set({ colorTheme: newTheme } as LocalSettings);
  }, []);

  const toggleSectionCollapse = useCallback((section: 'quickAccess' | 'workspace' | 'todayTabs') => {
    setCollapsedSections((prev) => {
      const updated = {
        ...prev,
        [section]: !prev[section]
      };
      chrome.storage.local.set({ collapsedSections: updated } as LocalSettings);
      return updated;
    });
  }, []);

  // Search State
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  // Inline Root Folder Creation in active Space / Home
  const [isCreatingRootFolder, setIsCreatingRootFolder] = useState(false);
  const [rootFolderTitle, setRootFolderTitle] = useState('');

  // Inline Space / Home Root Folder Renaming
  const [isRenamingWorkspace, setIsRenamingWorkspace] = useState(false);
  const [workspaceRenameTitle, setWorkspaceRenameTitle] = useState('');

  // Drag over workspace container
  const [isWorkspaceDragOver, setIsWorkspaceDragOver] = useState(false);

  // Global keyboard shortcuts:
  // - Ctrl+T / Cmd+T: New Tab
  // - Ctrl+R / Cmd+R: Reload active web page
  // - Ctrl+K / Cmd+K: Toggle Search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        createNewTab();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        reloadActiveTab();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createNewTab, reloadActiveTab]);

  const handleOpenContextMenu = (e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items
    });
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
  };

  // Pin action handlers
  const handlePinTabToQuickAccess = async (tab: chrome.tabs.Tab) => {
    if (activeFolderIds.quickAccessId) {
      await pinTab(tab, activeFolderIds.quickAccessId);
    }
  };

  const handlePinTabToWorkspace = async (tab: chrome.tabs.Tab) => {
    if (activeFolderIds.workspaceId) {
      await pinTab(tab, activeFolderIds.workspaceId);
    }
  };

  const handlePinTabToSpace = async (tab: chrome.tabs.Tab, targetSpaceFolderId: string) => {
    if (targetSpaceFolderId) {
      await pinTab(tab, targetSpaceFolderId);
    }
  };

  const handleMoveBookmarkToQuickAccess = async (bookmark: chrome.bookmarks.BookmarkTreeNode) => {
    if (!activeFolderIds.quickAccessId || !bookmark.url) return;
    await chrome.bookmarks.move(bookmark.id, { parentId: activeFolderIds.quickAccessId });
  };

  const handleMoveBookmarkToWorkspace = async (bookmark: chrome.bookmarks.BookmarkTreeNode) => {
    if (!activeFolderIds.workspaceId || !bookmark.url) return;
    await chrome.bookmarks.move(bookmark.id, { parentId: activeFolderIds.workspaceId });
  };

  const handleConfirmCreateRootFolder = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const title = rootFolderTitle.trim();
    if (title && activeFolderIds.workspaceId) {
      await createFolder(activeFolderIds.workspaceId, title);
    }
    setIsCreatingRootFolder(false);
    setRootFolderTitle('');
  };

  /**
   * Bookmark currently focused page directly into a given folder
   */
  const handleBookmarkCurrentPage = useCallback(
    async (targetFolderId: string) => {
      try {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (currentTab && currentTab.url) {
          const title = currentTab.title || currentTab.url || 'New Bookmark';
          const newBookmark = await chrome.bookmarks.create({
            parentId: targetFolderId,
            title,
            url: currentTab.url
          });

          // Bind tab immediately if present
          if (typeof currentTab.id === 'number') {
            const newBinding: TabBinding = {
              bookmarkId: newBookmark.id,
              tabId: currentTab.id,
              windowId: currentTab.windowId,
              originalUrl: currentTab.url,
              currentUrl: currentTab.url,
              currentTitle: title,
              isNavigatedAway: false
            };
            await chrome.storage.session.set({
              bindingsByBookmarkId: { ...bindingsByBookmarkId, [newBookmark.id]: newBinding },
              bookmarkIdByTabId: { ...bookmarkIdByTabId, [currentTab.id]: newBookmark.id }
            });
          }
        }
      } catch (err) {
        console.warn('[Arctic] Could not bookmark current page:', err);
      }
    },
    [bindingsByBookmarkId, bookmarkIdByTabId]
  );

  /**
   * Replace an existing bookmark's URL with the currently focused page URL.
   * Keeps the user's custom title unchanged, updates the tab binding's originalUrl,
   * and clears isNavigatedAway so the row returns to standard styling.
   */
  const handleReplaceBookmarkUrl = useCallback(
    async (bookmarkId: string) => {
      try {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (currentTab && currentTab.url) {
          // 1. Update bookmark URL without changing custom title
          await updateBookmarkUrl(bookmarkId, currentTab.url);
          // 2. Immediately update the tab binding's originalUrl and clear isNavigatedAway
          await updateBookmarkBindingUrl(bookmarkId, currentTab.url);
        }
      } catch (err) {
        console.warn('[Arctic] Could not replace bookmark url:', err);
      }
    },
    [updateBookmarkUrl, updateBookmarkBindingUrl]
  );

  /**
   * Handle drop of items (unpinned tab, bookmark, or folder) onto a folder, bookmark, or space
   */
  const handleDropItemToFolder = useCallback(
    async (data: { type: string; [key: string]: unknown }, targetFolderId: string, targetIndex?: number) => {
      if (data.type === 'openTab' && typeof data.tabId === 'number') {
        const tab = unpinnedTabs.find((t) => t.id === data.tabId) || {
          id: data.tabId as number,
          url: (data.url as string) || '',
          title: (data.title as string) || 'Pinned Tab',
          windowId: 0
        };
        await pinTab(tab as chrome.tabs.Tab, targetFolderId, targetIndex);
      } else if ((data.type === 'bookmark' || data.type === 'folder') && typeof data.id === 'string') {
        if (data.id === targetFolderId) return;
        await chrome.bookmarks.move(data.id, {
          parentId: targetFolderId,
          ...(typeof targetIndex === 'number' ? { index: targetIndex } : {})
        });
      }
    },
    [pinTab, unpinnedTabs]
  );

  /**
   * Reorder Quick Access tiles via drag and drop
   */
  const handleReorderQuickAccess = useCallback(
    async (draggedId: string, targetIndex: number) => {
      if (!activeFolderIds.quickAccessId) return;
      try {
        await chrome.bookmarks.move(draggedId, {
          parentId: activeFolderIds.quickAccessId,
          index: targetIndex
        });
      } catch (err) {
        console.warn('[Arctic] Could not reorder quick access bookmark:', err);
      }
    },
    [activeFolderIds.quickAccessId]
  );

  /**
   * Handle reordering bookmarks within a folder
   */
  const handleMoveBookmarkToIndex = useCallback(
    async (draggedId: string, targetParentId: string, targetIndex?: number) => {
      try {
        await chrome.bookmarks.move(draggedId, {
          parentId: targetParentId,
          ...(typeof targetIndex === 'number' ? { index: targetIndex } : {})
        });
      } catch (err) {
        console.warn('[Arctic] Could not reorder bookmark:', err);
      }
    },
    []
  );

  // Filter bookmarks & tabs based on searchQuery
  const queryLower = searchQuery.trim().toLowerCase();

  const filterBookmarkTree = useCallback(
    (nodes: chrome.bookmarks.BookmarkTreeNode[]): chrome.bookmarks.BookmarkTreeNode[] => {
      if (!queryLower) return nodes;

      const result: chrome.bookmarks.BookmarkTreeNode[] = [];
      for (const node of nodes) {
        if (node.url) {
          const matchTitle = node.title?.toLowerCase().includes(queryLower);
          const matchUrl = node.url?.toLowerCase().includes(queryLower);
          if (matchTitle || matchUrl) {
            result.push(node);
          }
        } else {
          // Folder: check children
          const filteredChildren = filterBookmarkTree(node.children || []);
          const matchFolderName = node.title?.toLowerCase().includes(queryLower);
          if (filteredChildren.length > 0 || matchFolderName) {
            result.push({
              ...node,
              children: filteredChildren.length > 0 ? filteredChildren : node.children
            });
          }
        }
      }
      return result;
    },
    [queryLower]
  );

  const filteredQuickAccess = useMemo(() => {
    const original = quickAccessNode?.children || [];
    if (!queryLower) return original;
    return original.filter(
      (b) =>
        b.title?.toLowerCase().includes(queryLower) ||
        b.url?.toLowerCase().includes(queryLower)
    );
  }, [quickAccessNode?.children, queryLower]);

  const filteredWorkspace = useMemo(() => {
    const original = workspaceNode?.children || [];
    return filterBookmarkTree(original);
  }, [workspaceNode?.children, filterBookmarkTree]);

  const filteredUnpinnedTabs = useMemo(() => {
    if (!queryLower) return unpinnedTabs;
    return unpinnedTabs.filter(
      (t) =>
        t.title?.toLowerCase().includes(queryLower) ||
        t.url?.toLowerCase().includes(queryLower)
    );
  }, [unpinnedTabs, queryLower]);

  const totalMatches =
    filteredQuickAccess.length +
    filteredWorkspace.length +
    filteredUnpinnedTabs.length;

  const activeSpaceObj = spaces.find((s) => s.id === activeSpaceId);
  const spaceDisplayTitle =
    activeSpaceObj?.name ||
    (workspaceNode?.title?.toLowerCase() === 'workspace' ? 'Home' : workspaceNode?.title) ||
    'Home';

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#f8f9fa] dark:bg-[#121214] text-zinc-500 dark:text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-500 dark:text-cyan-400 mb-2" />
        <span className="text-xs font-medium">Initializing Arctic Sidebar...</span>
      </div>
    );
  }

  return (
    <div
      style={{ background: 'var(--theme-bg-gradient)' }}
      className="flex flex-col h-screen w-full text-zinc-800 dark:text-zinc-100 select-none overflow-hidden font-sans transition-colors duration-200"
    >
      {/* Header with Settings, Actions, Search, Split View, New Tab & Theme */}
      <Header
        allFolders={allFolders}
        activeFolderIds={activeFolderIds}
        autoArchiveInterval={autoArchiveInterval}
        activeTabUrl={activeTabUrl}
        isActiveTabLoading={isActiveTabLoading}
        isSearchOpen={isSearchOpen}
        theme={theme}
        colorTheme={colorTheme}
        onSelectQuickAccessFolder={setQuickAccessFolderId}
        onSelectWorkspaceFolder={setWorkspaceFolderId}
        onResetFolders={resetToDefaultFolders}
        onToggleAllCollapsed={setAllFoldersCollapsed}
        onCreateFolder={createFolder}
        onCreateBookmark={createBookmark}
        onSetAutoArchiveInterval={setAutoArchiveInterval}
        onReloadActiveTab={reloadActiveTab}
        onNavigateActiveTab={navigateActiveTab}
        onToggleSearch={() => setIsSearchOpen((prev) => !prev)}
        onToggleTheme={toggleTheme}
        onSelectColorTheme={handleSelectColorTheme}
        onDiscardAllBackgroundTabs={discardAllBackgroundTabs}
      />

      {/* Expandable Search / Filter Bar */}
      {isSearchOpen && (
        <SearchBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onClose={() => {
            setIsSearchOpen(false);
            setSearchQuery('');
          }}
          matchCount={queryLower ? totalMatches : undefined}
        />
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3 space-y-4">
        {/* Section 1: Quick Access Favorites */}
        {(!queryLower || filteredQuickAccess.length > 0) && (
          <div className="flex flex-col">
            <QuickAccessGrid
              bookmarks={filteredQuickAccess}
              bindingsByBookmarkId={bindingsByBookmarkId}
              tabsByTabId={tabsByTabId}
              activeTabId={activeTabId}
              onTileClick={handleQuickAccessClick}
              onTileDoubleClick={handleFaviconDoubleClick}
              onOpenContextMenu={handleOpenContextMenu}
              onCloseTab={handleCloseTab}
              onToggleMuteTab={toggleMuteTab}
              onMoveToWorkspace={handleMoveBookmarkToWorkspace}
              onReplaceUrl={handleReplaceBookmarkUrl}
              onRenameBookmark={renameBookmarkOrFolder}
              onRemoveBookmark={removeBookmarkOrFolder}
              onReorderQuickAccess={handleReorderQuickAccess}
            />
          </div>
        )}

        {/* Section 2: Active Space / Home Vertical Tabs Tree (Permanent Bookmarks & Folders) */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setIsWorkspaceDragOver(true);
          }}
          onDragLeave={() => setIsWorkspaceDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsWorkspaceDragOver(false);
            if (activeFolderIds.workspaceId) {
              try {
                const data = JSON.parse(e.dataTransfer.getData('application/json'));
                handleDropItemToFolder(data, activeFolderIds.workspaceId);
              } catch {
                // ignore
              }
            }
          }}
          className={`flex flex-col space-y-1.5 rounded-xl transition-colors ${
            isWorkspaceDragOver ? 'theme-drag-over-inside' : ''
          }`}
        >
          {/* Prominent Space / Home Title Header (larger than tabs/folders, no left icon, no dropdown arrow) */}
          <div className="flex items-center justify-between px-2 pt-1.5 pb-1">
            {isRenamingWorkspace ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (workspaceNode && workspaceRenameTitle.trim()) {
                    renameBookmarkOrFolder(workspaceNode.id, workspaceRenameTitle.trim());
                  }
                  setIsRenamingWorkspace(false);
                }}
                className="flex items-center space-x-1"
              >
                <input
                  type="text"
                  value={workspaceRenameTitle}
                  onChange={(e) => setWorkspaceRenameTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setIsRenamingWorkspace(false);
                  }}
                  onBlur={() => {
                    if (workspaceNode && workspaceRenameTitle.trim()) {
                      renameBookmarkOrFolder(workspaceNode.id, workspaceRenameTitle.trim());
                    }
                    setIsRenamingWorkspace(false);
                  }}
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  className="bg-zinc-200 dark:bg-zinc-800 border border-cyan-500 rounded px-2 py-0.5 text-sm font-semibold text-zinc-900 dark:text-white focus:outline-none"
                />
              </form>
            ) : (
              <span
                title="Double-click to rename space"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (workspaceNode) {
                    setWorkspaceRenameTitle(spaceDisplayTitle);
                    setIsRenamingWorkspace(true);
                  }
                }}
                className="text-[15.5px] font-bold tracking-tight text-zinc-900 dark:text-zinc-100 cursor-text select-text"
              >
                {spaceDisplayTitle}
              </span>
            )}

            {/* Folder creation and Quick Bookmark action */}
            <div className="flex items-center space-x-1">
              {/* Quick Bookmark Current Page in Space Root */}
              {activeFolderIds.workspaceId && (
                <button
                  type="button"
                  title={`Bookmark current page in ${spaceDisplayTitle}`}
                  onClick={() =>
                    activeFolderIds.workspaceId &&
                    handleBookmarkCurrentPage(activeFolderIds.workspaceId)
                  }
                  className="p-1 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-cyan-600 dark:hover:text-cyan-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                </button>
              )}

              {/* New Folder Button */}
              <button
                type="button"
                title={`Create New Folder in ${spaceDisplayTitle}`}
                onClick={() => setIsCreatingRootFolder(true)}
                className="flex items-center space-x-1 px-1.5 py-0.5 rounded-md text-[10.5px] text-zinc-600 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors font-medium"
              >
                <FolderPlus className="w-3 h-3 text-amber-500 dark:text-amber-400" />
                <span>New Folder</span>
              </button>

              <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500 font-mono pl-0.5">
                {filteredWorkspace.length}
              </span>
            </div>
          </div>

          {/* Render Vertical Tree */}
          <div className="flex flex-col -mx-1 animate-in fade-in duration-100">
            {/* Inline New Folder Input Row */}
            {isCreatingRootFolder && (
              <form
                onSubmit={handleConfirmCreateRootFolder}
                className="flex items-center h-[32px] px-2 my-1 space-x-1.5 bg-black/[0.03] dark:bg-white/[0.04] rounded-lg border border-cyan-500/40 animate-in fade-in slide-in-from-top-1 duration-100"
              >
                <Folder className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 flex-shrink-0" />
                <input
                  type="text"
                  value={rootFolderTitle}
                  onChange={(e) => setRootFolderTitle(e.target.value)}
                  placeholder="New folder name..."
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsCreatingRootFolder(false);
                      setRootFolderTitle('');
                    }
                  }}
                  autoFocus
                  className="flex-1 bg-white dark:bg-zinc-800 border border-black/10 dark:border-white/10 rounded px-2 py-0.5 text-xs text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-cyan-400"
                />
                <button
                  type="submit"
                  title="Create Folder"
                  className="p-1 rounded text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                >
                  <Check className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  title="Cancel"
                  onClick={() => {
                    setIsCreatingRootFolder(false);
                    setRootFolderTitle('');
                  }}
                  className="p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              </form>
            )}

            {filteredWorkspace.length === 0 && !isCreatingRootFolder ? (
              <div className="px-3 py-4 text-center text-zinc-500 rounded-xl border border-dashed border-black/10 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.01]">
                <p className="text-xs">
                  {queryLower
                    ? 'No matching bookmarks found.'
                    : `No tabs or folders in ${spaceDisplayTitle} yet.`}
                </p>
                {!queryLower && (
                  <button
                    type="button"
                    onClick={() => setIsCreatingRootFolder(true)}
                    className="mt-2 inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-xs text-amber-600 dark:text-amber-300 font-medium transition-colors"
                  >
                    <FolderPlus className="w-3 h-3" />
                    <span>+ Create a Folder</span>
                  </button>
                )}
              </div>
            ) : (
              filteredWorkspace.map((child) => {
                if (!child.url) {
                  return (
                    <FolderNode
                      key={child.id}
                      node={child}
                      depth={0}
                      collapsedFolderIds={collapsedFolderIds}
                      onToggleCollapse={toggleFolderCollapse}
                      bindingsByBookmarkId={bindingsByBookmarkId}
                      tabsByTabId={tabsByTabId}
                      discardedTabsByTabId={discardedTabsByTabId}
                      activeTabId={activeTabId}
                      spaces={spaces}
                      activeSpaceId={activeSpaceId}
                      onRowClick={handleRowClick}
                      onFaviconClick={handleFaviconClick}
                      onFaviconDoubleClick={handleFaviconDoubleClick}
                      onCloseTab={handleCloseTab}
                      onReloadTab={reloadTab}
                      onDiscardTab={discardTab}
                      onToggleMuteTab={toggleMuteTab}
                      onMoveToSpace={moveNodeToSpace}
                      onReplaceUrl={handleReplaceBookmarkUrl}
                      onCreateFolder={createFolder}
                      onBookmarkCurrentPage={handleBookmarkCurrentPage}
                      onRenameFolder={renameBookmarkOrFolder}
                      onRenameBookmark={renameBookmarkOrFolder}
                      onOpenContextMenu={handleOpenContextMenu}
                      onDeleteBookmark={removeBookmarkOrFolder}
                      onMoveToQuickAccess={handleMoveBookmarkToQuickAccess}
                      onDropItemToFolder={handleDropItemToFolder}
                      onMoveBookmarkToIndex={handleMoveBookmarkToIndex}
                    />
                  );
                }

                const binding = bindingsByBookmarkId[child.id];
                const boundTab = binding ? tabsByTabId[binding.tabId] : undefined;
                const isActive = Boolean(binding && binding.tabId === activeTabId);
                const isDiscarded = Boolean(binding && discardedTabsByTabId[binding.tabId]);

                return (
                  <BookmarkRow
                    key={child.id}
                    bookmark={child}
                    depth={0}
                    binding={binding}
                    boundTab={boundTab}
                    isActive={isActive}
                    isDiscarded={isDiscarded}
                    spaces={spaces}
                    activeSpaceId={activeSpaceId}
                    onRowClick={handleRowClick}
                    onFaviconClick={handleFaviconClick}
                    onFaviconDoubleClick={handleFaviconDoubleClick}
                    onCloseTab={handleCloseTab}
                    onReloadTab={reloadTab}
                    onDiscardTab={discardTab}
                    onToggleMuteTab={toggleMuteTab}
                    onMoveToSpace={moveNodeToSpace}
                    onReplaceUrl={handleReplaceBookmarkUrl}
                    onRenameBookmark={renameBookmarkOrFolder}
                    onOpenContextMenu={handleOpenContextMenu}
                    onDeleteBookmark={removeBookmarkOrFolder}
                    onMoveToQuickAccess={handleMoveBookmarkToQuickAccess}
                    onMoveBookmarkToIndex={handleMoveBookmarkToIndex}
                    onDropItemToFolder={handleDropItemToFolder}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Section 3: Today's Tabs / Open Tabs (Ephemeral Unpinned Tabs) */}
        <OpenTabsSection
          unpinnedTabs={filteredUnpinnedTabs}
          activeTabId={activeTabId}
          spaces={spaces}
          isCollapsed={collapsedSections.todayTabs}
          onToggleCollapse={() => toggleSectionCollapse('todayTabs')}
          onFocusTab={focusTab}
          onCloseTab={handleCloseTab}
          onCloseAll={closeAllUnpinnedTabs}
          onNewTab={() => createNewTab()}
          onPinToQuickAccess={handlePinTabToQuickAccess}
          onPinToWorkspace={handlePinTabToWorkspace}
          onPinToSpace={handlePinTabToSpace}
          onDuplicateTab={duplicateTab}
          onReloadTab={reloadTab}
          onDiscardTab={discardTab}
          onToggleMuteTab={toggleMuteTab}
          onRenameTab={renameOpenTab}
          onOpenContextMenu={handleOpenContextMenu}
          onMoveOpenTab={moveOpenTab}
        />
      </div>

      {/* Floating Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={handleCloseContextMenu}
        />
      )}

      {/* Bottom Multiple Spaces Switcher Dock */}
      <SpacesSwitcher
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        onSelectSpace={selectSpace}
        onCreateSpace={createSpace}
        onRenameSpace={renameSpace}
        onDeleteSpace={deleteSpace}
        onDropItemToSpace={(data, targetFolderId) => handleDropItemToFolder(data, targetFolderId)}
        onOpenContextMenu={handleOpenContextMenu}
      />
    </div>
  );
};
