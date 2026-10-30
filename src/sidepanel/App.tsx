import React, { useState, useEffect } from 'react';
import { useBookmarks } from './hooks/useBookmarks';
import { useTabBindings } from './hooks/useTabBindings';
import { Header } from './components/Header';
import { QuickAccessGrid } from './components/QuickAccessGrid';
import { FolderNode } from './components/FolderNode';
import { BookmarkRow } from './components/BookmarkRow';
import { OpenTabsSection } from './components/OpenTabsSection';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import { Bookmark, Sparkles, Loader2, FolderPlus, Folder, Check, X } from 'lucide-react';

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
    removeBookmarkOrFolder,
    loading
  } = useBookmarks();

  const {
    bindingsByBookmarkId,
    activeTabId,
    unpinnedTabs,
    createNewTab,
    focusTab,
    handleRowClick,
    handleFaviconClick,
    handleQuickAccessClick,
    handleCloseTab,
    closeAllUnpinnedTabs,
    pinTab,
    duplicateTab,
    reloadTab,
    toggleMuteTab,
    autoArchiveInterval,
    setAutoArchiveInterval
  } = useTabBindings();

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  // Inline Root Folder Creation in Workspace
  const [isCreatingRootFolder, setIsCreatingRootFolder] = useState(false);
  const [rootFolderTitle, setRootFolderTitle] = useState('');

  // Global keyboard shortcut: Ctrl+T or Cmd+T inside sidebar opens new tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        createNewTab();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createNewTab]);

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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#121214] text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-400 mb-2" />
        <span className="text-xs font-medium">Initializing Arctic Sidebar...</span>
      </div>
    );
  }

  const quickAccessBookmarks = quickAccessNode?.children || [];
  const workspaceChildren = workspaceNode?.children || [];
  const runningTabCount = Object.keys(bindingsByBookmarkId).length;

  return (
    <div className="flex flex-col h-screen w-full bg-[#121214] text-zinc-100 select-none overflow-hidden font-sans">
      {/* Header with Settings, Actions & New Tab */}
      <Header
        allFolders={allFolders}
        activeFolderIds={activeFolderIds}
        autoArchiveInterval={autoArchiveInterval}
        onSelectQuickAccessFolder={setQuickAccessFolderId}
        onSelectWorkspaceFolder={setWorkspaceFolderId}
        onResetFolders={resetToDefaultFolders}
        onToggleAllCollapsed={setAllFoldersCollapsed}
        onCreateFolder={createFolder}
        onCreateBookmark={createBookmark}
        onSetAutoArchiveInterval={setAutoArchiveInterval}
        onNewTab={() => createNewTab()}
      />

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3 space-y-4">
        {/* Section 1: Quick Access Favorites */}
        <div className="flex flex-col space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
              Quick Access
            </span>
            <span className="text-[10px] text-zinc-600 font-mono">
              {quickAccessBookmarks.length}
            </span>
          </div>

          <QuickAccessGrid
            bookmarks={quickAccessBookmarks}
            bindingsByBookmarkId={bindingsByBookmarkId}
            activeTabId={activeTabId}
            onTileClick={handleQuickAccessClick}
            onOpenContextMenu={handleOpenContextMenu}
            onCloseTab={handleCloseTab}
            onMoveToWorkspace={handleMoveBookmarkToWorkspace}
            onRemoveBookmark={removeBookmarkOrFolder}
          />
        </div>

        {/* Section 2: Workspace Vertical Tabs Tree (Permanent Bookmarks & Folders) */}
        <div className="flex flex-col space-y-1">
          <div className="flex items-center justify-between px-1 pt-1 pb-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1">
              <Bookmark className="w-2.5 h-2.5 text-amber-400/80" />
              {workspaceNode?.title || 'Workspace'}
            </span>

            {/* Folder creation action */}
            <div className="flex items-center space-x-1.5">
              <button
                type="button"
                title="Create New Folder in Workspace"
                onClick={() => setIsCreatingRootFolder(true)}
                className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] text-zinc-400 hover:text-amber-300 hover:bg-white/10 transition-colors font-medium"
              >
                <FolderPlus className="w-3 h-3 text-amber-400" />
                <span>New Folder</span>
              </button>
              <span className="text-[10px] text-zinc-600 font-mono">
                {workspaceChildren.length} items
              </span>
            </div>
          </div>

          {/* Render Vertical Tree */}
          <div className="flex flex-col -mx-1">
            {/* Inline New Folder Input Row */}
            {isCreatingRootFolder && (
              <form
                onSubmit={handleConfirmCreateRootFolder}
                className="flex items-center h-[32px] px-2 my-1 space-x-1.5 bg-white/[0.04] rounded-lg border border-cyan-500/40 animate-in fade-in slide-in-from-top-1 duration-100"
              >
                <Folder className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
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
                  className="flex-1 bg-zinc-800 border border-white/10 rounded px-2 py-0.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-400"
                />
                <button
                  type="submit"
                  title="Create Folder"
                  className="p-1 rounded text-emerald-400 hover:bg-emerald-500/20"
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
                  className="p-1 rounded text-zinc-400 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              </form>
            )}

            {workspaceChildren.length === 0 && !isCreatingRootFolder ? (
              <div className="px-3 py-4 text-center text-zinc-500 rounded-lg border border-dashed border-white/5 bg-white/[0.01]">
                <p className="text-xs">This workspace folder is empty.</p>
                <button
                  type="button"
                  onClick={() => setIsCreatingRootFolder(true)}
                  className="mt-2 inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-xs text-amber-300 font-medium transition-colors"
                >
                  <FolderPlus className="w-3 h-3" />
                  <span>+ Create a Folder</span>
                </button>
              </div>
            ) : (
              workspaceChildren.map((child) => {
                if (!child.url) {
                  return (
                    <FolderNode
                      key={child.id}
                      node={child}
                      depth={0}
                      collapsedFolderIds={collapsedFolderIds}
                      onToggleCollapse={toggleFolderCollapse}
                      bindingsByBookmarkId={bindingsByBookmarkId}
                      activeTabId={activeTabId}
                      onRowClick={handleRowClick}
                      onFaviconClick={handleFaviconClick}
                      onCloseTab={handleCloseTab}
                      onCreateFolder={createFolder}
                      onRenameFolder={renameBookmarkOrFolder}
                      onOpenContextMenu={handleOpenContextMenu}
                      onDeleteBookmark={removeBookmarkOrFolder}
                      onMoveToQuickAccess={handleMoveBookmarkToQuickAccess}
                    />
                  );
                }

                const binding = bindingsByBookmarkId[child.id];
                const isActive = Boolean(binding && binding.tabId === activeTabId);

                return (
                  <BookmarkRow
                    key={child.id}
                    bookmark={child}
                    depth={0}
                    binding={binding}
                    isActive={isActive}
                    onRowClick={handleRowClick}
                    onFaviconClick={handleFaviconClick}
                    onCloseTab={handleCloseTab}
                    onOpenContextMenu={handleOpenContextMenu}
                    onDeleteBookmark={removeBookmarkOrFolder}
                    onMoveToQuickAccess={handleMoveBookmarkToQuickAccess}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Section 3: Today's Tabs / Open Tabs (Ephemeral Unpinned Tabs) */}
        <OpenTabsSection
          unpinnedTabs={unpinnedTabs}
          activeTabId={activeTabId}
          onFocusTab={focusTab}
          onCloseTab={handleCloseTab}
          onCloseAll={closeAllUnpinnedTabs}
          onNewTab={() => createNewTab()}
          onPinToQuickAccess={handlePinTabToQuickAccess}
          onPinToWorkspace={handlePinTabToWorkspace}
          onDuplicateTab={duplicateTab}
          onReloadTab={reloadTab}
          onToggleMuteTab={toggleMuteTab}
          onOpenContextMenu={handleOpenContextMenu}
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
      <div className="flex items-center justify-between px-3 h-7 border-t border-white/[0.06] bg-[#141416] text-[11px] text-zinc-500">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                runningTabCount > 0 ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]' : 'bg-zinc-600'
              }`}
            />
            <span>{runningTabCount} bound</span>
          </div>
          <span className="text-zinc-600">•</span>
          <span>{unpinnedTabs.length} open</span>
        </div>
        <span className="text-[10px] text-zinc-600 font-mono">v1.1.0</span>
      </div>
    </div>
  );
};
