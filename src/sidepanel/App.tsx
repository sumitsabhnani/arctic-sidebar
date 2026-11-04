import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useBookmarks } from './hooks/useBookmarks';
import { useTabBindings } from './hooks/useTabBindings';
import { Header } from './components/Header';
import { SettingsModal } from './components/SettingsModal';
import { QuickAccessGrid } from './components/QuickAccessGrid';
import { FolderNode } from './components/FolderNode';
import { BookmarkRow } from './components/BookmarkRow';
import { OpenTabsSection } from './components/OpenTabsSection';
import { SpacesSwitcher } from './components/SpacesSwitcher';
import { ScratchpadDrawer } from './components/ScratchpadDrawer';
import { ReminderPopover } from './components/ReminderPopover';
import { useScratchpad } from './hooks/useScratchpad';
import { useReminders } from './hooks/useReminders';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import type { TabBinding, LocalSettings, ColorThemeId, ThemeMode } from '../types';
import { Loader2, FolderPlus, Folder, Check, X, Bell } from 'lucide-react';

export const App: React.FC = () => {
  const {
    quickAccessNode,
    workspaceNode,
    allFolders,
    collapsedFolderIds,
    toggleFolderCollapse,
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
    closeAllWindowTabs,
    pinTab,
    duplicateTab,
    reloadTab,
    reloadActiveTab,
    isActiveTabLoading,
    activeTabUrl,
    navigateActiveTab,
    goBackActiveTab,
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

  // Cross-Device Scratchpad
  const {
    text: scratchpadText,
    setText: setScratchpadText,
    syncStatus: scratchpadStatus,
    clearScratchpad,
    isOpen: isScratchpadOpen,
    setIsOpen: setIsScratchpadOpen,
    toggleOpen: toggleScratchpadOpen,
    maxChars: maxScratchpadChars
  } = useScratchpad();

  // Tab Reminders
  const {
    firedReminders,
    getReminderForBookmark,
    getReminderForTab,
    createOrUpdateReminder,
    deleteReminder,
    snoozeReminder,
    dismissReminder,
    openAndDismissReminder
  } = useReminders();

  // Active Reminder Popover Anchor
  const [activeReminderTarget, setActiveReminderTarget] = useState<{
    target: {
      type: 'bookmark' | 'tab';
      bookmarkId?: string;
      tabId?: number;
      url: string;
      title: string;
    };
    anchorRect: DOMRect;
  } | null>(null);

  // Theme State
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [colorTheme, setColorTheme] = useState<ColorThemeId>('glacier-blue');
  const [quickAccessDensity, setQuickAccessDensity] = useState<'relaxed' | 'compact'>('relaxed');
  const [tabsDensity, setTabsDensity] = useState<'relaxed' | 'compact'>('relaxed');
  const [showMemorySaverBar, setShowMemorySaverBar] = useState<boolean>(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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
    chrome.storage.local.get(
      [
        'theme',
        'colorTheme',
        'collapsedSections',
        'quickAccessDensity',
        'tabsDensity',
        'densityMode',
        'showMemorySaverBar'
      ],
      (res) => {
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
        const qaDensity = res.quickAccessDensity || res.densityMode;
        if (qaDensity === 'relaxed' || qaDensity === 'compact') {
          setQuickAccessDensity(qaDensity);
        }
        const tDensity = res.tabsDensity || res.densityMode;
        if (tDensity === 'relaxed' || tDensity === 'compact') {
          setTabsDensity(tDensity);
        }
        if (typeof res.showMemorySaverBar === 'boolean') {
          setShowMemorySaverBar(res.showMemorySaverBar);
        }
        if (res.collapsedSections) {
          setCollapsedSections(res.collapsedSections as { quickAccess: boolean; workspace: boolean; todayTabs: boolean });
        }
      }
    );

    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local') {
        if (changes.theme && (changes.theme.newValue === 'light' || changes.theme.newValue === 'dark')) {
          setTheme(changes.theme.newValue as ThemeMode);
        }
        if (
          changes.colorTheme &&
          typeof changes.colorTheme.newValue === 'string' &&
          [
            'glacier-blue',
            'midnight-amethyst',
            'forest-sage',
            'warm-terracotta',
            'pure-monochrome',
            'slate-grey'
          ].includes(changes.colorTheme.newValue)
        ) {
          setColorTheme(changes.colorTheme.newValue as ColorThemeId);
        }
        if (changes.quickAccessDensity && (changes.quickAccessDensity.newValue === 'relaxed' || changes.quickAccessDensity.newValue === 'compact')) {
          setQuickAccessDensity(changes.quickAccessDensity.newValue);
        }
        if (changes.tabsDensity && (changes.tabsDensity.newValue === 'relaxed' || changes.tabsDensity.newValue === 'compact')) {
          setTabsDensity(changes.tabsDensity.newValue);
        }
        if (changes.showMemorySaverBar && typeof changes.showMemorySaverBar.newValue === 'boolean') {
          setShowMemorySaverBar(changes.showMemorySaverBar.newValue);
        }
        if (changes.collapsedSections && changes.collapsedSections.newValue) {
          setCollapsedSections(
            changes.collapsedSections.newValue as {
              quickAccess: boolean;
              workspace: boolean;
              todayTabs: boolean;
            }
          );
        }
      }
    };

    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }
    return () => {
      if (chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      }
    };
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

  const handleToggleQuickAccessDensity = useCallback((mode: 'relaxed' | 'compact') => {
    setQuickAccessDensity(mode);
    chrome.storage.local.set({ quickAccessDensity: mode } as LocalSettings);
  }, []);

  const handleToggleTabsDensity = useCallback((mode: 'relaxed' | 'compact') => {
    setTabsDensity(mode);
    chrome.storage.local.set({ tabsDensity: mode } as LocalSettings);
  }, []);

  const handleToggleMemorySaverBar = useCallback((show: boolean) => {
    setShowMemorySaverBar(show);
    chrome.storage.local.set({ showMemorySaverBar: show } as LocalSettings);
  }, []);

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
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        createNewTab();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        reloadActiveTab(e.shiftKey);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createNewTab, reloadActiveTab]);

  const handleOpenContextMenu = (e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    try {
      window.focus();
    } catch {
      // ignore
    }
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

  /**
   * Quick Unpin Bookmark:
   * Moves the tab to unpinned Today's Tabs (opens if not already open) and deletes the bookmark.
   */
  const handleUnpinBookmarkToTodayTabs = useCallback(
    async (bookmark: chrome.bookmarks.BookmarkTreeNode) => {
      try {
        const binding = bindingsByBookmarkId[bookmark.id];
        if (binding) {
          const updatedBindings = { ...bindingsByBookmarkId };
          delete updatedBindings[bookmark.id];
          const updatedTabIdMap = { ...bookmarkIdByTabId };
          delete updatedTabIdMap[binding.tabId];
          await chrome.storage.session.set({
            bindingsByBookmarkId: updatedBindings,
            bookmarkIdByTabId: updatedTabIdMap
          });
        } else if (bookmark.url) {
          await chrome.tabs.create({ url: bookmark.url, active: true });
        }
        await removeBookmarkOrFolder(bookmark.id);
      } catch (err) {
        console.warn('[Arctic] Could not unpin bookmark:', err);
      }
    },
    [bindingsByBookmarkId, bookmarkIdByTabId, removeBookmarkOrFolder]
  );

  /**
   * Delete bookmark or folder and close any open running tabs bound to it or its children.
   */
  const handleDeleteBookmark = useCallback(
    async (id: string) => {
      try {
        const bookmarkIdsToClose: string[] = [id];
        try {
          const [subtree] = await chrome.bookmarks.getSubTree(id);
          const collectDescendants = (node: chrome.bookmarks.BookmarkTreeNode) => {
            if (node.id) bookmarkIdsToClose.push(node.id);
            if (node.children) {
              for (const child of node.children) {
                collectDescendants(child);
              }
            }
          };
          if (subtree.children) {
            for (const child of subtree.children) {
              collectDescendants(child);
            }
          }
        } catch {
          // ignore if subtree cannot be queried
        }

        for (const bId of bookmarkIdsToClose) {
          const binding = bindingsByBookmarkId[bId];
          if (binding && typeof binding.tabId === 'number') {
            await handleCloseTab(binding.tabId);
          }
        }

        await removeBookmarkOrFolder(id);
      } catch (err) {
        console.warn('[Arctic] Error deleting bookmark and closing tabs:', err);
        await removeBookmarkOrFolder(id);
      }
    },
    [bindingsByBookmarkId, handleCloseTab, removeBookmarkOrFolder]
  );

  const discardedTabsCount = useMemo(() => {
    let count = 0;
    for (const tabIdStr of Object.keys(discardedTabsByTabId)) {
      if (discardedTabsByTabId[Number(tabIdStr)]) count++;
    }
    for (const tab of unpinnedTabs) {
      if (tab.discarded && !discardedTabsByTabId[tab.id!]) {
        count++;
      }
    }
    return count;
  }, [discardedTabsByTabId, unpinnedTabs]);

  const quickAccessBookmarks = quickAccessNode?.children || [];
  const workspaceBookmarks = workspaceNode?.children || [];

  const activeSpaceObj = spaces.find((s) => s.id === activeSpaceId);
  const spaceDisplayTitle =
    activeSpaceObj?.name ||
    (workspaceNode?.title?.toLowerCase() === 'workspace' ? 'Home' : workspaceNode?.title) ||
    'Home';

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#f8f9fa] dark:bg-[#121214] text-zinc-500 dark:text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-500 dark:text-cyan-400 mb-2" />
        <span className="text-xs font-medium">Initializing Arctic...</span>
      </div>
    );
  }

  return (
    <div
      style={{ background: 'var(--theme-bg-gradient)' }}
      className="flex flex-col h-screen w-full text-zinc-800 dark:text-zinc-100 select-none overflow-hidden font-sans transition-colors duration-200"
    >
      {/* Header with Address Bar */}
      <Header
        activeTabUrl={activeTabUrl}
        isActiveTabLoading={isActiveTabLoading}
        onReloadActiveTab={reloadActiveTab}
        onNavigateActiveTab={navigateActiveTab}
        onGoBackActiveTab={goBackActiveTab}
      />

      {/* Top Overdue Tab Reminders Banner */}
      {firedReminders.length > 0 && (
        <div className="mx-2.5 mt-2 flex flex-col space-y-2">
          {firedReminders.map((reminder) => (
            <div
              key={reminder.id}
              className="p-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-300 flex flex-col space-y-1.5 text-xs shadow-sm animate-in fade-in slide-in-from-top-1"
            >
              {/* Header: Status, Title, Actions */}
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center space-x-1.5 min-w-0 flex-1">
                  <Bell className="w-3.5 h-3.5 stroke-[2.5] text-rose-500 animate-pulse flex-shrink-0" />
                  <span className="font-semibold text-xs text-rose-600 dark:text-rose-400 whitespace-nowrap">
                    Reminder Due
                  </span>
                  <span
                    className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate"
                    title={reminder.title || reminder.url}
                  >
                    • {reminder.title || reminder.url}
                  </span>
                </div>

                <div className="flex items-center space-x-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => openAndDismissReminder(reminder)}
                    className="px-2.5 py-1 rounded-xl font-semibold bg-rose-500 hover:bg-rose-600 text-white transition-colors text-[11px] whitespace-nowrap shadow-sm active:scale-95"
                  >
                    Open Tab
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissReminder(reminder.id)}
                    className="px-2 py-1 rounded-xl font-medium text-rose-600 dark:text-rose-300 hover:bg-rose-500/20 transition-colors text-[11px] whitespace-nowrap"
                  >
                    Dismiss
                  </button>
                </div>
              </div>

              {/* Multi-line Message with Hover Tooltip & Click-to-Alert */}
              {reminder.note && (
                <div
                  title={`Full Message:\n${reminder.note}\n\n(Click to open in browser alert window)`}
                  onClick={() => {
                    window.alert(`🔔 Reminder for "${reminder.title}":\n\n${reminder.note}\n\nURL: ${reminder.url}`);
                  }}
                  className="text-xs text-zinc-800 dark:text-zinc-200 bg-white/60 dark:bg-black/30 rounded-xl p-2 break-words select-text font-normal leading-relaxed cursor-pointer hover:bg-white/80 dark:hover:bg-black/40 transition-colors border border-rose-500/10 shadow-xs"
                >
                  {reminder.note}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Fixed Quick Access Links (Pinned Favorites Grid) */}
      {quickAccessBookmarks.length > 0 && (
        <div className="px-2.5 pt-2 pb-2 flex-shrink-0 border-b border-black/[0.06] dark:border-white/[0.06] max-h-[35vh] overflow-y-auto no-scrollbar">
          <QuickAccessGrid
            bookmarks={quickAccessBookmarks}
            bindingsByBookmarkId={bindingsByBookmarkId}
            tabsByTabId={tabsByTabId}
            activeTabId={activeTabId}
            densityMode={quickAccessDensity}
            onTileClick={handleQuickAccessClick}
            onTileDoubleClick={handleFaviconDoubleClick}
            onOpenContextMenu={handleOpenContextMenu}
            onCloseTab={handleCloseTab}
            onToggleMuteTab={toggleMuteTab}
            onMoveToWorkspace={handleMoveBookmarkToWorkspace}
            onReplaceUrl={handleReplaceBookmarkUrl}
            onRenameBookmark={renameBookmarkOrFolder}
            onRemoveBookmark={handleDeleteBookmark}
            onReorderQuickAccess={handleReorderQuickAccess}
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3 space-y-4">
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
                className="text-[15.5px] font-bold tracking-tight text-zinc-900 dark:text-zinc-100 select-none cursor-default"
              >
                {spaceDisplayTitle}
              </span>
            )}

            {/* Folder creation action */}
            <div className="flex items-center space-x-1">
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
            </div>
          </div>

          {/* Render Vertical Tree in Grouped Card (5a) */}
          <div className="flex flex-col rounded-2xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-zinc-900/60 backdrop-blur-sm divide-y divide-black/5 dark:divide-white/5 overflow-hidden shadow-xs animate-in fade-in duration-100">
            {/* Inline New Folder Input Row */}
            {isCreatingRootFolder && (
              <form
                onSubmit={handleConfirmCreateRootFolder}
                className="flex items-center h-[34px] px-2.5 my-0.5 space-x-1.5 bg-black/[0.03] dark:bg-white/[0.04] animate-in fade-in slide-in-from-top-1 duration-100"
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

            {workspaceBookmarks.length === 0 && !isCreatingRootFolder ? (
              <div className="px-3 py-6 text-center text-zinc-500">
                <p className="text-xs">
                  {`No tabs or folders in ${spaceDisplayTitle} yet.`}
                </p>
                <button
                  type="button"
                  onClick={() => setIsCreatingRootFolder(true)}
                  className="mt-2 inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-xs text-amber-600 dark:text-amber-300 font-medium transition-colors"
                >
                  <FolderPlus className="w-3 h-3" />
                  <span>+ Create a Folder</span>
                </button>
              </div>
            ) : (
              workspaceBookmarks.map((child) => {
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
                      onDeleteBookmark={handleDeleteBookmark}
                      onUnpinBookmark={handleUnpinBookmarkToTodayTabs}
                      onMoveToQuickAccess={handleMoveBookmarkToQuickAccess}
                      onDropItemToFolder={handleDropItemToFolder}
                      onMoveBookmarkToIndex={handleMoveBookmarkToIndex}
                      getReminderForBookmark={getReminderForBookmark}
                      onOpenReminderPopover={(target, rect) =>
                        setActiveReminderTarget({ target, anchorRect: rect })
                      }
                      densityMode={tabsDensity}
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
                    onDeleteBookmark={handleDeleteBookmark}
                    onUnpinBookmark={handleUnpinBookmarkToTodayTabs}
                    onMoveToQuickAccess={handleMoveBookmarkToQuickAccess}
                    onMoveBookmarkToIndex={handleMoveBookmarkToIndex}
                    onDropItemToFolder={handleDropItemToFolder}
                    reminder={getReminderForBookmark(child.id)}
                    onOpenReminderPopover={(target, rect) =>
                      setActiveReminderTarget({ target, anchorRect: rect })
                    }
                    densityMode={tabsDensity}
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
          spaces={spaces}
          isCollapsed={collapsedSections.todayTabs}
          densityMode={tabsDensity}
          onToggleCollapse={() => toggleSectionCollapse('todayTabs')}
          onFocusTab={focusTab}
          onCloseTab={handleCloseTab}
          onCloseAll={closeAllUnpinnedTabs}
          onCloseAllWindowTabs={closeAllWindowTabs}
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
          getReminderForTab={getReminderForTab}
          onOpenReminderPopover={(target, rect) =>
            setActiveReminderTarget({ target, anchorRect: rect })
          }
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

      {/* Slide-Up Scratchpad Drawer */}
      <ScratchpadDrawer
        isOpen={isScratchpadOpen}
        onClose={() => setIsScratchpadOpen(false)}
        text={scratchpadText}
        onChange={setScratchpadText}
        syncStatus={scratchpadStatus}
        onClear={clearScratchpad}
        maxChars={maxScratchpadChars}
      />

      {/* Bottom Multiple Spaces Switcher Dock / Footer Bar */}
      <SpacesSwitcher
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        onSelectSpace={selectSpace}
        onCreateSpace={createSpace}
        onRenameSpace={renameSpace}
        onDeleteSpace={deleteSpace}
        onDropItemToSpace={(data, targetFolderId) => handleDropItemToFolder(data, targetFolderId)}
        onOpenContextMenu={handleOpenContextMenu}
        isScratchpadOpen={isScratchpadOpen}
        onToggleScratchpad={toggleScratchpadOpen}
        hasScratchpadText={Boolean(scratchpadText.trim())}
        onOpenSettings={() => setIsSettingsOpen(true)}
        showMemorySaverBar={showMemorySaverBar}
        discardedTabsCount={discardedTabsCount}
      />

      {/* Settings & Appearance Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        theme={theme}
        colorTheme={colorTheme}
        quickAccessDensity={quickAccessDensity}
        tabsDensity={tabsDensity}
        showMemorySaverBar={showMemorySaverBar}
        allFolders={allFolders}
        activeFolderIds={activeFolderIds}
        autoArchiveInterval={autoArchiveInterval}
        onToggleTheme={toggleTheme}
        onSelectColorTheme={handleSelectColorTheme}
        onToggleQuickAccessDensity={handleToggleQuickAccessDensity}
        onToggleTabsDensity={handleToggleTabsDensity}
        onToggleMemorySaverBar={handleToggleMemorySaverBar}
        onSelectQuickAccessFolder={setQuickAccessFolderId}
        onSelectWorkspaceFolder={setWorkspaceFolderId}
        onResetFolders={resetToDefaultFolders}
        onSetAutoArchiveInterval={setAutoArchiveInterval}
        onDiscardAllBackgroundTabs={discardAllBackgroundTabs}
      />

      {/* Floating Active Reminder Popover */}
      {activeReminderTarget && (
        <ReminderPopover
          target={activeReminderTarget.target}
          activeReminder={
            activeReminderTarget.target.type === 'bookmark' && activeReminderTarget.target.bookmarkId
              ? getReminderForBookmark(activeReminderTarget.target.bookmarkId)
              : activeReminderTarget.target.tabId !== undefined
              ? getReminderForTab(activeReminderTarget.target.tabId, activeReminderTarget.target.url)
              : undefined
          }
          anchorRect={activeReminderTarget.anchorRect}
          onSave={(params) => {
            createOrUpdateReminder({
              targetType: activeReminderTarget.target.type,
              bookmarkId: activeReminderTarget.target.bookmarkId,
              tabId: activeReminderTarget.target.tabId,
              url: activeReminderTarget.target.url,
              title: activeReminderTarget.target.title,
              note: params.note,
              triggerAt: params.triggerAt,
              reminderId: params.reminderId
            });
          }}
          onDelete={deleteReminder}
          onSnooze={snoozeReminder}
          onClose={() => setActiveReminderTarget(null)}
        />
      )}
    </div>
  );
};
