import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useBookmarks } from './hooks/useBookmarks';
import { useTabBindings } from './hooks/useTabBindings';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { QuickAccessGrid } from './components/QuickAccessGrid';
import { FolderNode } from './components/FolderNode';
import { BookmarkRow } from './components/BookmarkRow';
import { OpenTabsSection } from './components/OpenTabsSection';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import type { TabBinding, LocalSettings } from '../types';
import { Bookmark, Loader2, FolderPlus, BookmarkPlus, Folder, Check, X, ChevronDown } from 'lucide-react';

export const App: React.FC = () => {
  const {
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
    renameBookmarkOrFolder,
    updateBookmarkUrl,
    removeBookmarkOrFolder,
    loading
  } = useBookmarks();

  const {
    bindingsByBookmarkId,
    bookmarkIdByTabId,
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
    discardTab,
    discardAllBackgroundTabs,
    discardedTabsByTabId,
    moveOpenTab,
    renameOpenTab,
    toggleMuteTab,
    autoArchiveInterval,
    setAutoArchiveInterval
  } = useTabBindings();

  // Theme State
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

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
    chrome.storage.local.get(['theme', 'collapsedSections'], (res) => {
      if (res.theme === 'light' || res.theme === 'dark') {
        setTheme(res.theme);
      }
      if (res.collapsedSections) {
        setCollapsedSections(res.collapsedSections as { quickAccess: boolean; workspace: boolean; todayTabs: boolean });
      }
    });
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      chrome.storage.local.set({ theme: next } as LocalSettings);
      return next;
    });
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

  // Inline Root Folder Creation in Workspace
  const [isCreatingRootFolder, setIsCreatingRootFolder] = useState(false);
  const [rootFolderTitle, setRootFolderTitle] = useState('');

  // Inline Workspace Root Folder Renaming
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
   * Replace an existing bookmark's URL with the currently focused page URL
   */
  const handleReplaceBookmarkUrl = useCallback(
    async (bookmarkId: string) => {
      try {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (currentTab && currentTab.url) {
          await updateBookmarkUrl(bookmarkId, currentTab.url, currentTab.title);
        }
      } catch (err) {
        console.warn('[Arctic] Could not replace bookmark url:', err);
      }
    },
    [updateBookmarkUrl]
  );

  /**
   * Handle drop of items (unpinned tab or bookmark) onto a folder, bookmark, or workspace
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
      } else if (data.type === 'bookmark' && typeof data.id === 'string') {
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#f8f9fa] dark:bg-[#121214] text-zinc-500 dark:text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-500 dark:text-cyan-400 mb-2" />
        <span className="text-xs font-medium">Initializing Arctic Sidebar...</span>
      </div>
    );
  }

  const runningTabCount = Object.keys(bindingsByBookmarkId).length;

  return (
    <div className="flex flex-col h-screen w-full bg-[#f8f9fa] dark:bg-[#121214] text-zinc-800 dark:text-zinc-100 select-none overflow-hidden font-sans transition-colors duration-150">
      {/* Header with Settings, Actions, Search, New Tab & Collapse */}
      <Header
        allFolders={allFolders}
        activeFolderIds={activeFolderIds}
        autoArchiveInterval={autoArchiveInterval}
        isActiveTabLoading={isActiveTabLoading}
        isSearchOpen={isSearchOpen}
        theme={theme}
        onSelectQuickAccessFolder={setQuickAccessFolderId}
        onSelectWorkspaceFolder={setWorkspaceFolderId}
        onResetFolders={resetToDefaultFolders}
        onToggleAllCollapsed={setAllFoldersCollapsed}
        onCreateFolder={createFolder}
        onCreateBookmark={createBookmark}
        onSetAutoArchiveInterval={setAutoArchiveInterval}
        onNewTab={() => createNewTab()}
        onReloadActiveTab={reloadActiveTab}
        onToggleSearch={() => setIsSearchOpen((prev) => !prev)}
        onToggleTheme={toggleTheme}
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
              activeTabId={activeTabId}
              onTileClick={handleQuickAccessClick}
              onTileDoubleClick={handleFaviconDoubleClick}
              onOpenContextMenu={handleOpenContextMenu}
              onCloseTab={handleCloseTab}
              onMoveToWorkspace={handleMoveBookmarkToWorkspace}
              onReplaceUrl={handleReplaceBookmarkUrl}
              onRenameBookmark={renameBookmarkOrFolder}
              onRemoveBookmark={removeBookmarkOrFolder}
              onReorderQuickAccess={handleReorderQuickAccess}
            />
          </div>
        )}

        {/* Section 2: Workspace Vertical Tabs Tree (Permanent Bookmarks & Folders) */}
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
          className={`flex flex-col space-y-1 rounded-xl transition-colors ${
            isWorkspaceDragOver ? 'bg-cyan-500/5 ring-1 ring-cyan-500/30' : ''
          }`}
        >
          <div className="flex items-center justify-between px-1 pt-1 pb-0.5">
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
                  className="bg-zinc-200 dark:bg-zinc-800 border border-cyan-500 rounded px-1.5 py-0.5 text-xs text-zinc-900 dark:text-white focus:outline-none"
                />
              </form>
            ) : (
              <button
                type="button"
                onClick={() => toggleSectionCollapse('workspace')}
                className="flex items-center space-x-1 text-left group cursor-pointer"
              >
                <ChevronDown
                  className={`w-3 h-3 text-zinc-400 dark:text-zinc-500 transition-transform duration-150 ${
                    collapsedSections.workspace ? '-rotate-90' : 'rotate-0'
                  }`}
                />
                <span
                  title="Double-click to rename workspace folder"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (workspaceNode) {
                      setWorkspaceRenameTitle(workspaceNode.title || 'Workspace');
                      setIsRenamingWorkspace(true);
                    }
                  }}
                  className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 cursor-text select-text"
                >
                  <Bookmark className="w-2.5 h-2.5 text-amber-500 dark:text-amber-400/80" />
                  {workspaceNode?.title || 'Workspace'}
                </span>
              </button>
            )}

            {/* Folder creation and Quick Bookmark action */}
            <div className="flex items-center space-x-1">
              {/* Quick Bookmark Current Page in Workspace Root */}
              {activeFolderIds.workspaceId && (
                <button
                  type="button"
                  title="Bookmark current page in Workspace"
                  onClick={() =>
                    activeFolderIds.workspaceId &&
                    handleBookmarkCurrentPage(activeFolderIds.workspaceId)
                  }
                  className="p-1 rounded text-zinc-500 dark:text-zinc-400 hover:text-cyan-600 dark:hover:text-cyan-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                </button>
              )}

              {/* New Folder Button */}
              <button
                type="button"
                title="Create New Folder in Workspace"
                onClick={() => {
                  if (collapsedSections.workspace) {
                    toggleSectionCollapse('workspace');
                  }
                  setIsCreatingRootFolder(true);
                }}
                className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] text-zinc-600 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors font-medium"
              >
                <FolderPlus className="w-3 h-3 text-amber-500 dark:text-amber-400" />
                <span>New Folder</span>
              </button>

              <span className="text-[10px] text-zinc-400 dark:text-zinc-600 font-mono">
                {filteredWorkspace.length} items
              </span>
            </div>
          </div>

          {/* Render Vertical Tree */}
          {!collapsedSections.workspace && (
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
                <div className="px-3 py-4 text-center text-zinc-500 rounded-lg border border-dashed border-black/10 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.01]">
                  <p className="text-xs">
                    {queryLower ? 'No matching bookmarks found.' : 'This workspace folder is empty.'}
                  </p>
                  {!queryLower && (
                    <button
                      type="button"
                      onClick={() => setIsCreatingRootFolder(true)}
                      className="mt-2 inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-xs text-amber-600 dark:text-amber-300 font-medium transition-colors"
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
                        discardedTabsByTabId={discardedTabsByTabId}
                        activeTabId={activeTabId}
                        onRowClick={handleRowClick}
                        onFaviconClick={handleFaviconClick}
                        onFaviconDoubleClick={handleFaviconDoubleClick}
                        onCloseTab={handleCloseTab}
                        onReloadTab={reloadTab}
                        onDiscardTab={discardTab}
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
                  const isActive = Boolean(binding && binding.tabId === activeTabId);
                  const isDiscarded = Boolean(binding && discardedTabsByTabId[binding.tabId]);

                  return (
                    <BookmarkRow
                      key={child.id}
                      bookmark={child}
                      depth={0}
                      binding={binding}
                      isActive={isActive}
                      isDiscarded={isDiscarded}
                      onRowClick={handleRowClick}
                      onFaviconClick={handleFaviconClick}
                      onFaviconDoubleClick={handleFaviconDoubleClick}
                      onCloseTab={handleCloseTab}
                      onReloadTab={reloadTab}
                      onDiscardTab={discardTab}
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
          )}
        </div>

        {/* Section 3: Today's Tabs / Open Tabs (Ephemeral Unpinned Tabs) */}
        <OpenTabsSection
          unpinnedTabs={filteredUnpinnedTabs}
          activeTabId={activeTabId}
          isCollapsed={collapsedSections.todayTabs}
          onToggleCollapse={() => toggleSectionCollapse('todayTabs')}
          onFocusTab={focusTab}
          onCloseTab={handleCloseTab}
          onCloseAll={closeAllUnpinnedTabs}
          onNewTab={() => createNewTab()}
          onPinToQuickAccess={handlePinTabToQuickAccess}
          onPinToWorkspace={handlePinTabToWorkspace}
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

      {/* Footer Info Bar */}
      <div className="flex items-center justify-between px-3 h-7 border-t border-black/[0.06] dark:border-white/[0.06] bg-[#f0f2f5] dark:bg-[#141416] text-[11px] text-zinc-500">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                runningTabCount > 0 ? 'bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]' : 'bg-zinc-400 dark:bg-zinc-600'
              }`}
            />
            <span>{runningTabCount} bound</span>
          </div>
          <span className="text-zinc-400 dark:text-zinc-600">•</span>
          <span>{unpinnedTabs.length} open</span>
        </div>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-600 font-mono">v2.1.0</span>
      </div>
    </div>
  );
};
