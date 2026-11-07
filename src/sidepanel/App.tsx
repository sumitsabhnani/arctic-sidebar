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
import { isValidColorTheme, isValidThemeMode, resolveEffectiveTheme } from './utils/theme';
import { Loader2, FolderPlus, Folder, Check, X, Bell, PanelLeft } from 'lucide-react';

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
    moveBookmarks,
    loading
  } = useBookmarks();

  const {
    bindingsByBookmarkId,
    bookmarkIdByTabId,
    tabsByTabId,
    activeTabId,
    unpinnedTabs,
    isInitialTabsLoaded,
    tabSpaceByTabId,
    setTabSpace,
    moveTabsToSpace,
    closeSpaceUnpinnedTabs,
    reconcileTabsWithBookmarks,
    createNewTab,
    focusTab,
    handleRowClick,
    handleFaviconClick,
    handleFaviconDoubleClick,
    handleQuickAccessClick,
    handleCloseTab,
    closeAllWindowTabs,
    pinTab,
    pinMultipleTabs,
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
  } = useTabBindings(activeSpaceId);

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
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [colorTheme, setColorTheme] = useState<ColorThemeId>('pure-monochrome');
  const [quickAccessDensity, setQuickAccessDensity] = useState<'relaxed' | 'compact'>('relaxed');
  const [tabsDensity, setTabsDensity] = useState<'relaxed' | 'compact'>('compact');
  const [showMemorySaverBar, setShowMemorySaverBar] = useState<boolean>(false);
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
        'showMemorySaverBar',
        'openArcticSettings'
      ],
      (res) => {
        if (isValidThemeMode(res.theme)) {
          setTheme(res.theme);
        }
        if (isValidColorTheme(res.colorTheme)) {
          setColorTheme(res.colorTheme);
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
        if (res.openArcticSettings) {
          setIsSettingsOpen(true);
          try {
            chrome.storage.local.remove('openArcticSettings');
          } catch {
            // ignore
          }
        }
      }
    );

    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local') {
        if (changes.theme && isValidThemeMode(changes.theme.newValue)) {
          setTheme(changes.theme.newValue);
        }
        if (changes.colorTheme && isValidColorTheme(changes.colorTheme.newValue)) {
          setColorTheme(changes.colorTheme.newValue);
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
        if (changes.openArcticSettings && changes.openArcticSettings.newValue) {
          setIsSettingsOpen(true);
          try {
            chrome.storage.local.remove('openArcticSettings');
          } catch {
            // ignore
          }
        }
      }
    };

    const handleRuntimeMessage = (message: { type?: string }) => {
      if (message && message.type === 'OPEN_ARCTIC_SETTINGS') {
        setIsSettingsOpen(true);
      }
    };

    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }
    if (chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    }
    return () => {
      if (chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      }
      if (chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
      }
    };
  }, []);

  useEffect(() => {
    const applyEffectiveTheme = (effective: 'dark' | 'light') => {
      if (effective === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      }
    };

    applyEffectiveTheme(resolveEffectiveTheme(theme));
    document.documentElement.setAttribute('data-color-theme', colorTheme);

    if (theme === 'system' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent) => {
        applyEffectiveTheme(e.matches ? 'dark' : 'light');
      };
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handleChange);
        return () => mediaQuery.removeListener(handleChange);
      }
    }
  }, [theme, colorTheme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const currentEffective = resolveEffectiveTheme(prev);
      const next: ThemeMode = currentEffective === 'dark' ? 'light' : 'dark';
      chrome.storage.local.set({ theme: next } as LocalSettings);
      return next;
    });
  }, []);

  const handleSelectThemeMode = useCallback((mode: ThemeMode) => {
    setTheme(mode);
    chrome.storage.local.set({ theme: mode } as LocalSettings);
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

  // First-run Left-Side Tip State
  const [showLeftSideTip, setShowLeftSideTip] = useState(false);

  const dismissLeftSideTip = useCallback(() => {
    setShowLeftSideTip(false);
    chrome.storage.local.set({ hasDismissedLeftSideTip: true } as LocalSettings);
  }, []);

  useEffect(() => {
    let resolved = false;
    let cleanupListeners = () => {};

    chrome.storage.local.get(
      [
        'hasDismissedLeftSideTip',
        'spaces',
        'workspaceFolderId',
        'quickAccessFolderId',
        'collapsedFolderIds',
        'theme',
        'colorTheme',
        'densityMode',
        'quickAccessDensity',
        'tabsDensity',
        'showMemorySaverBar',
        'autoArchiveInterval'
      ],
      async (res) => {
        if (res.hasDismissedLeftSideTip) {
          resolved = true;
          return;
        }

        // Suppress if user already had Arctic installed previously
        const hasExistingConfig = Boolean(
          (Array.isArray(res.spaces) && res.spaces.length > 1) ||
            (Array.isArray(res.collapsedFolderIds) && res.collapsedFolderIds.length > 0) ||
            res.theme ||
            res.colorTheme ||
            res.densityMode ||
            res.quickAccessDensity ||
            res.tabsDensity ||
            res.showMemorySaverBar !== undefined ||
            res.autoArchiveInterval !== undefined
        );
        if (hasExistingConfig) {
          dismissLeftSideTip();
          resolved = true;
          return;
        }

        // 1. Check native Chrome 140+ side panel layout API if available
        if (typeof (chrome?.sidePanel as any)?.getLayout === 'function') {
          try {
            const layout = await (chrome.sidePanel as any).getLayout();
            if (layout && layout.side) {
              resolved = true;
              if (layout.side === 'left') {
                dismissLeftSideTip();
              } else if (layout.side === 'right') {
                setShowLeftSideTip(true);
              }
              return;
            }
          } catch {
            // Fall through to pointer/window detection
          }
        }

        // 2. Unit tests (JSDOM): Show tip so tests can verify dismissal & buttons
        const isJsdom =
          typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
        if (isJsdom) {
          setShowLeftSideTip(true);
          resolved = true;
          return;
        }

        // 3. Fallback for real browser: Detect docked position on first pointer interaction
        cleanupListeners = () => {
          window.removeEventListener('pointermove', handlePointer);
          window.removeEventListener('pointerdown', handlePointer);
          window.removeEventListener('mouseenter', handlePointer);
        };

        const handlePointer = (e: MouseEvent | PointerEvent) => {
          if (resolved) return;
          if (!chrome?.windows?.getCurrent) {
            resolved = true;
            cleanupListeners();
            setShowLeftSideTip(true);
            return;
          }

          chrome.windows.getCurrent((win) => {
            if (resolved) return;
            if (win) {
              resolved = true;
              cleanupListeners();
              const panelScreenLeft = e.screenX - e.clientX;
              const relativeX =
                typeof win.left === 'number'
                  ? panelScreenLeft - win.left
                  : panelScreenLeft;
              const halfWidth =
                typeof win.width === 'number' && win.width > 0
                  ? win.width / 2
                  : (window.screen?.availWidth || 1920) / 2;

              if (relativeX < halfWidth) {
                // Docked on the LEFT: auto-dismiss and never show!
                dismissLeftSideTip();
              } else {
                // Docked on the RIGHT: show the tip banner
                setShowLeftSideTip(true);
              }
            }
          });
        };

        window.addEventListener('pointermove', handlePointer, { passive: true });
        window.addEventListener('pointerdown', handlePointer, { passive: true });
        window.addEventListener('mouseenter', handlePointer, { passive: true });
      }
    );

    return () => {
      resolved = true;
      cleanupListeners();
    };
  }, [dismissLeftSideTip]);

  // Multi-Selection State for Bookmarks & Today's Tabs
  const [selectedBookmarkIds, setSelectedBookmarkIds] = useState<Set<string>>(new Set());
  const [lastSelectedBookmarkId, setLastSelectedBookmarkId] = useState<string | null>(null);
  const lastSelectedBookmarkIdRef = React.useRef<string | null>(null);
  const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(new Set());
  const [lastSelectedTabId, setLastSelectedTabId] = useState<number | null>(null);
  const lastSelectedTabIdRef = React.useRef<number | null>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  // Inline Root Folder Creation in active Space / Home
  const [isCreatingRootFolder, setIsCreatingRootFolder] = useState(false);
  const [rootFolderTitle, setRootFolderTitle] = useState('');

  // Active Space Display Title
  const activeSpaceObj = spaces.find((s) => s.id === activeSpaceId);
  const spaceDisplayTitle =
    activeSpaceObj?.name ||
    (workspaceNode?.title?.toLowerCase() === 'workspace' ? 'Home' : workspaceNode?.title) ||
    'Home';

  const quickAccessBookmarks = quickAccessNode?.children || [];
  // Filter out the Quick Access subfolder from the Active Space tree so it only renders in the top Quick Access grid
  const workspaceBookmarks = useMemo(() => {
    return (workspaceNode?.children || []).filter(
      (child) =>
        child.id !== activeFolderIds.quickAccessId &&
        !(!child.url && child.title.trim().toLowerCase() === 'quick access')
    );
  }, [workspaceNode?.children, activeFolderIds.quickAccessId]);

  // Auto-reconcile open tabs with bookmarks on startup/reload
  useEffect(() => {
    if (quickAccessNode || workspaceNode) {
      const allNodes: chrome.bookmarks.BookmarkTreeNode[] = [];
      if (quickAccessNode) allNodes.push(quickAccessNode);
      if (workspaceNode) allNodes.push(workspaceNode);
      reconcileTabsWithBookmarks(allNodes);
    }
  }, [quickAccessNode, workspaceNode, reconcileTabsWithBookmarks]);

  const visibleUnpinnedTabs = useMemo(() => {
    return unpinnedTabs
      .filter((tab) => {
        if (typeof tab.id !== 'number') return false;
        const space = tabSpaceByTabId[tab.id] || 'home';
        return space === activeSpaceId;
      })
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }, [unpinnedTabs, tabSpaceByTabId, activeSpaceId]);

  // Inline Space / Home Root Folder Renaming
  const [isRenamingWorkspace, setIsRenamingWorkspace] = useState(false);
  const [workspaceRenameTitle, setWorkspaceRenameTitle] = useState('');

  // Renaming coordination across both Active space and Today's tabs
  const [editingTarget, setEditingTarget] = useState<{
    type: 'openTab' | 'bookmark' | 'folder';
    id: string | number;
    initialTitle: string;
    title: string;
  } | null>(null);

  const commitCurrentEdit = useCallback(
    (target: { type: 'openTab' | 'bookmark' | 'folder'; id: string | number; initialTitle: string; title: string }) => {
      const trimmed = target.title.trim();
      const initialTrimmed = target.initialTitle.trim();
      if (trimmed && trimmed !== initialTrimmed) {
        if (target.type === 'openTab' && (typeof target.id === 'number' || !isNaN(Number(target.id)))) {
          renameOpenTab(Number(target.id), trimmed);
        } else if ((target.type === 'bookmark' || target.type === 'folder') && target.id !== undefined) {
          renameBookmarkOrFolder(String(target.id), trimmed);
        }
      }
    },
    [renameOpenTab, renameBookmarkOrFolder]
  );

  const handleStartRename = useCallback(
    (type: 'openTab' | 'bookmark' | 'folder', id: string | number, currentTitle: string) => {
      if (editingTarget !== null && !(editingTarget.type === type && editingTarget.id === id)) {
        // Cancel (or save if changed) the previous one before opening the new one for editing
        commitCurrentEdit(editingTarget);
      }
      if (isRenamingWorkspace && workspaceNode) {
        const trimmed = workspaceRenameTitle.trim();
        if (trimmed && trimmed !== spaceDisplayTitle) {
          renameBookmarkOrFolder(workspaceNode.id, trimmed);
        }
        setIsRenamingWorkspace(false);
      }
      setEditingTarget({
        type,
        id,
        initialTitle: currentTitle || '',
        title: currentTitle || ''
      });
    },
    [editingTarget, commitCurrentEdit, isRenamingWorkspace, workspaceNode, workspaceRenameTitle, spaceDisplayTitle, renameBookmarkOrFolder]
  );

  const handleChangeEditTitle = useCallback((newTitle: string) => {
    setEditingTarget((prev) => (prev ? { ...prev, title: newTitle } : null));
  }, []);

  const handleSaveRename = useCallback(() => {
    if (editingTarget) {
      commitCurrentEdit(editingTarget);
      setEditingTarget(null);
    }
  }, [editingTarget, commitCurrentEdit]);

  const handleCancelRename = useCallback(() => {
    setEditingTarget(null);
  }, []);

  // When activeSpaceId actually changes, commit or cancel any active bookmark/folder rename from the previous space
  const prevActiveSpaceIdRef = React.useRef(activeSpaceId);
  useEffect(() => {
    if (prevActiveSpaceIdRef.current !== activeSpaceId) {
      prevActiveSpaceIdRef.current = activeSpaceId;
      if (editingTarget && (editingTarget.type === 'bookmark' || editingTarget.type === 'folder')) {
        commitCurrentEdit(editingTarget);
        setEditingTarget(null);
      }
    }
  }, [activeSpaceId, editingTarget, commitCurrentEdit]);

  // When an open tab being renamed is closed
  useEffect(() => {
    if (
      editingTarget &&
      editingTarget.type === 'openTab' &&
      !unpinnedTabs.some((t) => t.id === editingTarget.id)
    ) {
      setEditingTarget(null);
    }
  }, [editingTarget, unpinnedTabs]);

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
      } else if (e.key === 'Escape') {
        setSelectedBookmarkIds(new Set());
        setSelectedTabIds(new Set());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createNewTab, reloadActiveTab]);

  const handleOpenContextMenu = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items
    });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

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
          const title = currentTab.title || currentTab.url || 'New Tab';
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

  const handleCloseScratchpadDrawer = useCallback(() => {
    setIsScratchpadOpen(false);
  }, [setIsScratchpadOpen]);

  /**
   * Create a new document bookmark (.new shortcut) in a target folder and open it
   */
  const handleCreateGoogleDoc = useCallback(
    async (targetFolderId: string, docUrl = 'https://docs.new', docTitle = 'New Google Doc') => {
      try {
        const newBookmark = await chrome.bookmarks.create({
          parentId: targetFolderId,
          title: docTitle,
          url: docUrl
        });
        const newTab = await chrome.tabs.create({ url: docUrl, active: true });
        if (typeof newTab.id === 'number') {
          const newBinding: TabBinding = {
            bookmarkId: newBookmark.id,
            tabId: newTab.id,
            windowId: newTab.windowId,
            originalUrl: docUrl,
            currentUrl: docUrl,
            currentTitle: docTitle,
            isNavigatedAway: false
          };
          await chrome.storage.session.set({
            bindingsByBookmarkId: { ...bindingsByBookmarkId, [newBookmark.id]: newBinding },
            bookmarkIdByTabId: { ...bookmarkIdByTabId, [newTab.id]: newBookmark.id }
          });
        }
      } catch (err) {
        console.warn('[Arctic] Could not create document bookmark:', err);
      }
    },
    [bindingsByBookmarkId, bookmarkIdByTabId]
  );

  // Helper to collect all visible bookmark IDs under current space tree for range selection
  const getVisibleBookmarkIds = useCallback(
    (nodes: chrome.bookmarks.BookmarkTreeNode[]): string[] => {
      const result: string[] = [];
      const traverse = (list: chrome.bookmarks.BookmarkTreeNode[]) => {
        for (const node of list) {
          if (node.url) {
            result.push(node.id);
          } else {
            const isCollapsed = collapsedFolderIds[node.id] !== undefined ? Boolean(collapsedFolderIds[node.id]) : true;
            if (!isCollapsed && node.children) {
              traverse(node.children);
            }
          }
        }
      };
      traverse(nodes);
      return result;
    },
    [collapsedFolderIds]
  );

  const handleSelectBookmark = useCallback(
    (bookmark: chrome.bookmarks.BookmarkTreeNode, e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        setSelectedBookmarkIds((prev) => {
          const next = new Set(prev);
          if (next.has(bookmark.id)) {
            next.delete(bookmark.id);
          } else {
            next.add(bookmark.id);
          }
          return next;
        });
        setLastSelectedBookmarkId(bookmark.id);
        lastSelectedBookmarkIdRef.current = bookmark.id;
      } else if (e.shiftKey) {
        const visibleIds = getVisibleBookmarkIds(workspaceBookmarks);
        const anchorId =
          lastSelectedBookmarkIdRef.current ||
          lastSelectedBookmarkId ||
          (selectedBookmarkIds.size > 0 ? Array.from(selectedBookmarkIds)[0] : null);

        const idxA = anchorId ? visibleIds.indexOf(anchorId) : -1;
        const idxB = visibleIds.indexOf(bookmark.id);

        if (idxA !== -1 && idxB !== -1) {
          const start = Math.min(idxA, idxB);
          const end = Math.max(idxA, idxB);
          const range = visibleIds.slice(start, end + 1);
          setSelectedBookmarkIds(new Set(range));
        } else {
          setSelectedBookmarkIds(new Set([bookmark.id]));
          setLastSelectedBookmarkId(bookmark.id);
          lastSelectedBookmarkIdRef.current = bookmark.id;
        }
      } else {
        setSelectedBookmarkIds(new Set());
        setLastSelectedBookmarkId(bookmark.id);
        lastSelectedBookmarkIdRef.current = bookmark.id;
      }
    },
    [workspaceBookmarks, getVisibleBookmarkIds, lastSelectedBookmarkId, selectedBookmarkIds]
  );

  const handleSelectTab = useCallback(
    (tab: chrome.tabs.Tab, e: React.MouseEvent) => {
      if (typeof tab.id !== 'number') return;
      const tid = tab.id;
      if (e.metaKey || e.ctrlKey) {
        setSelectedTabIds((prev) => {
          const next = new Set(prev);
          if (next.has(tid)) {
            next.delete(tid);
          } else {
            next.add(tid);
          }
          return next;
        });
        setLastSelectedTabId(tid);
        lastSelectedTabIdRef.current = tid;
      } else if (e.shiftKey) {
        const visibleTabIds = visibleUnpinnedTabs
          .map((t) => t.id)
          .filter((id): id is number => typeof id === 'number');

        const anchorId =
          typeof lastSelectedTabIdRef.current === 'number'
            ? lastSelectedTabIdRef.current
            : typeof lastSelectedTabId === 'number'
            ? lastSelectedTabId
            : selectedTabIds.size > 0
            ? Array.from(selectedTabIds)[0]
            : null;

        const idxA = typeof anchorId === 'number' ? visibleTabIds.indexOf(anchorId) : -1;
        const idxB = visibleTabIds.indexOf(tid);

        if (idxA !== -1 && idxB !== -1) {
          const start = Math.min(idxA, idxB);
          const end = Math.max(idxA, idxB);
          const range = visibleTabIds.slice(start, end + 1);
          setSelectedTabIds(new Set(range));
        } else {
          setSelectedTabIds(new Set([tid]));
          setLastSelectedTabId(tid);
          lastSelectedTabIdRef.current = tid;
        }
      } else {
        setSelectedTabIds(new Set());
        setLastSelectedTabId(tid);
        lastSelectedTabIdRef.current = tid;
      }
    },
    [visibleUnpinnedTabs, lastSelectedTabId, selectedTabIds]
  );

  const handleDeleteMultipleBookmarks = useCallback(
    async (ids: string[]) => {
      for (const id of ids) {
        await handleDeleteBookmark(id);
      }
      setSelectedBookmarkIds(new Set());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleMoveMultipleBookmarksToSpace = useCallback(
    async (ids: string[], targetSpaceFolderId: string) => {
      await moveBookmarks(ids, targetSpaceFolderId);
      setSelectedBookmarkIds(new Set());
      setLastSelectedBookmarkId(null);
      lastSelectedBookmarkIdRef.current = null;
    },
    [moveBookmarks]
  );

  const handleCloseMultipleTabs = useCallback(
    async (tabIds: number[]) => {
      for (const tid of tabIds) {
        await handleCloseTab(tid);
      }
      setSelectedTabIds(new Set());
    },
    [handleCloseTab]
  );

  const handlePinMultipleTabsToWorkspace = useCallback(
    async (_tabs: chrome.tabs.Tab[]) => {
      const ids = Array.from(selectedTabIds);
      const targetTabs = ids
        .map(
          (id) =>
            visibleUnpinnedTabs.find((t) => t.id === id) ||
            tabsByTabId[id] ||
            unpinnedTabs.find((t) => t.id === id)
        )
        .filter((t): t is chrome.tabs.Tab => Boolean(t));
      if (activeFolderIds.workspaceId && targetTabs.length > 0) {
        await pinMultipleTabs(targetTabs, activeFolderIds.workspaceId);
      }
      setSelectedTabIds(new Set());
      setLastSelectedTabId(null);
      lastSelectedTabIdRef.current = null;
    },
    [selectedTabIds, visibleUnpinnedTabs, tabsByTabId, unpinnedTabs, activeFolderIds.workspaceId, pinMultipleTabs]
  );

  const handlePinMultipleTabsToSpace = useCallback(
    async (_tabs: chrome.tabs.Tab[], targetSpaceFolderId: string) => {
      const ids = Array.from(selectedTabIds);
      const targetTabs = ids
        .map(
          (id) =>
            visibleUnpinnedTabs.find((t) => t.id === id) ||
            tabsByTabId[id] ||
            unpinnedTabs.find((t) => t.id === id)
        )
        .filter((t): t is chrome.tabs.Tab => Boolean(t));
      if (targetTabs.length > 0) {
        await pinMultipleTabs(targetTabs, targetSpaceFolderId);
      }
      setSelectedTabIds(new Set());
      setLastSelectedTabId(null);
      lastSelectedTabIdRef.current = null;
    },
    [selectedTabIds, visibleUnpinnedTabs, tabsByTabId, unpinnedTabs, pinMultipleTabs]
  );

  const handleDiscardMultipleTabs = useCallback(
    async (tabIds: number[]) => {
      for (const tid of tabIds) {
        if (discardTab) await discardTab(tid);
      }
      setSelectedTabIds(new Set());
    },
    [discardTab]
  );

  /**
   * Handle drop of items (unpinned tab, bookmark, or folder) onto a folder, bookmark, or space
   */
  const handleDropItemToFolder = useCallback(
    async (data: { type: string; [key: string]: unknown }, targetFolderId: string, targetIndex?: number) => {
      if (data.type === 'openTab') {
        const tabIds: number[] =
          Array.isArray(data.tabIds) && data.tabIds.length > 0
            ? (data.tabIds as number[])
            : typeof data.tabId === 'number'
            ? [data.tabId as number]
            : [];

        const tabsToPin: chrome.tabs.Tab[] = [];
        for (const tid of tabIds) {
          const tab =
            visibleUnpinnedTabs.find((t) => t.id === tid) ||
            tabsByTabId[tid] ||
            unpinnedTabs.find((t) => t.id === tid) || {
              id: tid,
              url: (data.url as string) || '',
              title: (data.title as string) || 'Pinned Tab',
              windowId: 0
            };
          tabsToPin.push(tab as chrome.tabs.Tab);
        }

        if (tabsToPin.length > 0) {
          await pinMultipleTabs(tabsToPin, targetFolderId, targetIndex);
        }
        setSelectedTabIds(new Set());
        setLastSelectedTabId(null);
        lastSelectedTabIdRef.current = null;
      } else if (data.type === 'bookmark' || data.type === 'folder') {
        const rawIds: string[] =
          Array.isArray(data.ids) && data.ids.length > 0
            ? (data.ids as string[])
            : typeof data.id === 'string'
            ? [data.id as string]
            : [];
        const ids = rawIds.filter((bid) => bid !== targetFolderId);
        if (ids.length > 0) {
          const visibleIds = getVisibleBookmarkIds(workspaceBookmarks);
          const sortedIds = [...ids].sort((a, b) => {
            const idxA = visibleIds.indexOf(a);
            const idxB = visibleIds.indexOf(b);
            if (idxA === -1 && idxB === -1) return 0;
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
          });
          await moveBookmarks(sortedIds, targetFolderId, targetIndex);
        }
        setSelectedBookmarkIds(new Set());
        setLastSelectedBookmarkId(null);
        lastSelectedBookmarkIdRef.current = null;
      }
    },
    [visibleUnpinnedTabs, tabsByTabId, unpinnedTabs, pinMultipleTabs, workspaceBookmarks, getVisibleBookmarkIds, moveBookmarks]
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
        const ids =
          selectedBookmarkIds.has(draggedId) && selectedBookmarkIds.size > 1
            ? Array.from(selectedBookmarkIds)
            : [draggedId];
        const visibleIds = getVisibleBookmarkIds(workspaceBookmarks);
        const sortedIds = [...ids].sort((a, b) => {
          const idxA = visibleIds.indexOf(a);
          const idxB = visibleIds.indexOf(b);
          if (idxA === -1 && idxB === -1) return 0;
          if (idxA === -1) return 1;
          if (idxB === -1) return -1;
          return idxA - idxB;
        });
        await moveBookmarks(sortedIds, targetParentId, targetIndex);
        setSelectedBookmarkIds(new Set());
        setLastSelectedBookmarkId(null);
        lastSelectedBookmarkIdRef.current = null;
      } catch (err) {
        console.warn('[Arctic] Could not reorder bookmark:', err);
      }
    },
    [selectedBookmarkIds, workspaceBookmarks, getVisibleBookmarkIds, moveBookmarks]
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
            if (node.id) {
              bookmarkIdsToClose.push(node.id);
            }
            if (node.children) {
              for (const child of node.children) {
                collectDescendants(child);
              }
            }
          };
          collectDescendants(subtree);
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

  const handleToggleBottomScratchpad = useCallback(() => {
    toggleScratchpadOpen();
  }, [toggleScratchpadOpen]);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      if (selectedBookmarkIds.size > 0) setSelectedBookmarkIds(new Set());
      if (selectedTabIds.size > 0) setSelectedTabIds(new Set());
      setLastSelectedBookmarkId(null);
      lastSelectedBookmarkIdRef.current = null;
      setLastSelectedTabId(null);
      lastSelectedTabIdRef.current = null;
    }
  }, [selectedBookmarkIds.size, selectedTabIds.size]);

  return (
    <div
      style={{ background: 'var(--theme-bg-gradient)' }}
      onPointerDown={(e) => {
        if (showLeftSideTip && chrome?.windows?.getCurrent) {
          chrome.windows.getCurrent((win) => {
            if (
              win &&
              typeof win.left === 'number' &&
              typeof win.width === 'number' &&
              win.width > 0
            ) {
              const panelScreenLeft = e.screenX - e.clientX;
              if (panelScreenLeft - win.left < win.width / 2) {
                dismissLeftSideTip();
              }
            }
          });
        }
      }}
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

      {/* First-Run Left-Side Positioning Tip Banner */}
      {showLeftSideTip && (
        <div className="mx-2.5 mt-2 p-2.5 rounded-xl bg-cyan-500/10 dark:bg-cyan-500/15 border border-cyan-500/25 text-zinc-800 dark:text-zinc-200 flex items-start gap-2 text-xs shadow-xs animate-in fade-in slide-in-from-top-1">
          <PanelLeft className="w-4 h-4 text-cyan-600 dark:text-cyan-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
              Prefer Arctic on the Left?
            </div>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
              Chrome opens sidebars on the right by default. You can switch sidebar alignment to the left anytime in Chrome Appearance Settings.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => {
                  dismissLeftSideTip();
                  chrome.tabs.create({ url: 'chrome://settings/appearance' });
                }}
                className="px-2 py-1 rounded-lg text-[11px] font-medium bg-cyan-600 hover:bg-cyan-500 text-white transition-colors shadow-xs active:scale-95"
              >
                Open Settings
              </button>
              <button
                type="button"
                onClick={dismissLeftSideTip}
                className="px-2 py-1 rounded-lg text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissLeftSideTip}
            title="Dismiss"
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors -mr-1 -mt-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

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
            onReloadTab={reloadTab}
            onDuplicateTab={duplicateTab}
          />
        </div>
      )}

      {/* Main Content Area */}
      <div
        onClick={handleContainerClick}
        className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 pt-3 pb-7 space-y-4"
      >
        {/* Section 2: Active Space / Home Vertical Tabs Tree (Permanent Bookmarks & Folders) */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
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
                  if (editingTarget) {
                    commitCurrentEdit(editingTarget);
                    setEditingTarget(null);
                  }
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
            <div className="flex items-center">
              <button
                type="button"
                title={`Create New Folder in ${spaceDisplayTitle}`}
                aria-label="New folder"
                onClick={() => setIsCreatingRootFolder(true)}
                className="p-1 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5" />
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

            {loading && workspaceBookmarks.length === 0 ? (
              <div className="flex items-center justify-center py-6 space-x-2 text-zinc-400 dark:text-zinc-500">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-500 dark:text-cyan-400" />
                <span className="text-xs">Loading tabs...</span>
              </div>
            ) : workspaceBookmarks.length === 0 && !isCreatingRootFolder ? (
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
                      onDuplicateTab={duplicateTab}
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
                      editingTarget={editingTarget}
                      onStartRename={handleStartRename}
                      onChangeEditTitle={handleChangeEditTitle}
                      onSaveRename={handleSaveRename}
                      onCancelRename={handleCancelRename}
                      onCreateGoogleDoc={handleCreateGoogleDoc}
                      selectedBookmarkIds={selectedBookmarkIds}
                      onSelectBookmark={handleSelectBookmark}
                      onDeleteMultipleBookmarks={handleDeleteMultipleBookmarks}
                      onMoveMultipleBookmarksToSpace={handleMoveMultipleBookmarksToSpace}
                    />
                  );
                }

                const binding = bindingsByBookmarkId[child.id];
                const boundTab = binding ? tabsByTabId[binding.tabId] : undefined;
                const isActive = Boolean(binding && binding.tabId === activeTabId);
                const isDiscarded = Boolean(binding && discardedTabsByTabId[binding.tabId]);
                const isEditing = Boolean(editingTarget && editingTarget.type === 'bookmark' && editingTarget.id === child.id);

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
                    onDuplicateTab={duplicateTab}
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
                    isEditing={isEditing}
                    editTitle={isEditing && editingTarget ? editingTarget.title : (child.title || '')}
                    onStartRename={() => handleStartRename('bookmark', child.id, child.title || '')}
                    onChangeEditTitle={handleChangeEditTitle}
                    onSaveRename={handleSaveRename}
                    onCancelRename={handleCancelRename}
                    isSelected={Boolean(selectedBookmarkIds.has(child.id))}
                    selectedBookmarkIds={selectedBookmarkIds}
                    onSelectBookmark={handleSelectBookmark}
                    onDeleteMultipleBookmarks={handleDeleteMultipleBookmarks}
                    onMoveMultipleBookmarksToSpace={handleMoveMultipleBookmarksToSpace}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Section 3: Today's Tabs / Open Tabs (Ephemeral Unpinned Tabs) */}
        <OpenTabsSection
          unpinnedTabs={visibleUnpinnedTabs}
          activeTabId={activeTabId}
          activeSpaceId={activeSpaceId}
          isInitialTabsLoaded={isInitialTabsLoaded}
          spaces={spaces}
          isCollapsed={collapsedSections.todayTabs}
          densityMode={tabsDensity}
          onToggleCollapse={() => toggleSectionCollapse('todayTabs')}
          onFocusTab={focusTab}
          onCloseTab={handleCloseTab}
          onCloseAll={() => {
            const ids = visibleUnpinnedTabs
              .map((t) => t.id)
              .filter((id): id is number => typeof id === 'number');
            closeSpaceUnpinnedTabs(ids);
          }}
          onCloseAllWindowTabs={closeAllWindowTabs}
          onNewTab={() => createNewTab(undefined, activeSpaceId)}
          onPinToQuickAccess={handlePinTabToQuickAccess}
          onPinToWorkspace={handlePinTabToWorkspace}
          onPinToSpace={handlePinTabToSpace}
          onMoveTabToSpace={setTabSpace}
          onMoveMultipleTabsToSpace={moveTabsToSpace}
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
          editingTabId={editingTarget?.type === 'openTab' ? Number(editingTarget.id) : null}
          editingTitle={editingTarget?.type === 'openTab' ? editingTarget.title : ''}
          onStartRename={(tab) => typeof tab.id === 'number' && handleStartRename('openTab', tab.id, tab.title || '')}
          onChangeEditTitle={handleChangeEditTitle}
          onSaveRename={handleSaveRename}
          onCancelRename={handleCancelRename}
          selectedTabIds={selectedTabIds}
          onSelectTab={handleSelectTab}
          onCloseMultipleTabs={handleCloseMultipleTabs}
          onPinMultipleTabsToWorkspace={handlePinMultipleTabsToWorkspace}
          onPinMultipleTabsToSpace={handlePinMultipleTabsToSpace}
          onDiscardMultipleTabs={handleDiscardMultipleTabs}
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
        onClose={handleCloseScratchpadDrawer}
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
        onDropItemToSpace={(data, targetFolderId) => {
          if (data.type === 'openTab') {
            const targetSpace = spaces.find((s) => s.folderId === targetFolderId || s.id === targetFolderId);
            if (targetSpace) {
              if (Array.isArray(data.tabIds) && data.tabIds.length > 0) {
                moveTabsToSpace(data.tabIds as number[], targetSpace.id);
              } else if (typeof data.tabId === 'number') {
                setTabSpace(data.tabId as number, targetSpace.id);
              }
              return;
            }
          }
          handleDropItemToFolder(data, targetFolderId);
        }}
        onOpenContextMenu={handleOpenContextMenu}
        isScratchpadOpen={isScratchpadOpen}
        onToggleScratchpad={handleToggleBottomScratchpad}
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
        onSelectThemeMode={handleSelectThemeMode}
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
