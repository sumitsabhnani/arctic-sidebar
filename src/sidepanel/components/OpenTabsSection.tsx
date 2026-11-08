import React, { useState, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, ChevronDown, X, Plus } from 'lucide-react';
import { OpenTabRow } from './OpenTabRow';
import type { SpaceItem, TabReminder } from '../../types';
import type { ContextMenuItem } from './ContextMenu';

interface OpenTabsSectionProps {
  unpinnedTabs: chrome.tabs.Tab[];
  hasOpenActiveSpaceTabs?: boolean;
  activeTabId: number | null;
  activeSpaceId?: string;
  isInitialTabsLoaded?: boolean;
  spaces?: SpaceItem[];
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onFocusTab: (tabId: number) => void;
  onCloseTab: (tabId: number, e: React.MouseEvent) => void;
  onCloseAll: () => void;
  onCloseAllWindowTabs?: () => void;
  onNewTab?: () => void;
  onPinToQuickAccess: (tab: chrome.tabs.Tab) => void;
  onPinToWorkspace: (tab: chrome.tabs.Tab) => void;
  onPinToSpace?: (tab: chrome.tabs.Tab, targetSpaceFolderId: string) => void;
  onMoveTabToSpace?: (tabId: number, targetSpaceId: string) => void;
  onDuplicateTab: (tabId: number) => void;
  onReloadTab: (tabId: number) => void;
  onDiscardTab?: (tabId: number) => void;
  onToggleMuteTab: (tab: chrome.tabs.Tab) => void;
  onRenameTab?: (tabId: number, title: string) => void;
  onOpenContextMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  onMoveOpenTab?: (tabId: number, targetIndex: number) => void;
  getReminderForTab?: (tabId: number, url?: string) => TabReminder | undefined;
  onOpenReminderPopover?: (target: { type: 'tab'; tabId: number; url: string; title: string }, anchorRect: DOMRect) => void;
  densityMode?: 'relaxed' | 'compact';
  selectedTabIds?: Set<number>;
  onSelectTab?: (tab: chrome.tabs.Tab, e: React.MouseEvent) => void;
  onCloseMultipleTabs?: (tabIds: number[]) => void;
  onPinMultipleTabsToWorkspace?: (tabs: chrome.tabs.Tab[]) => void;
  onPinMultipleTabsToSpace?: (tabs: chrome.tabs.Tab[], targetSpaceFolderId: string) => void;
  onMoveMultipleTabsToSpace?: (tabIds: number[], targetSpaceId: string) => void;
  onDiscardMultipleTabs?: (tabIds: number[]) => void;
  editingTabId?: number | null;
  editingTitle?: string;
  onStartRename?: (tab: chrome.tabs.Tab) => void;
  onChangeEditTitle?: (newTitle: string) => void;
  onSaveRename?: () => void;
  onCancelRename?: () => void;
}

export const OpenTabsSection: React.FC<OpenTabsSectionProps> = ({
  unpinnedTabs,
  hasOpenActiveSpaceTabs = false,
  activeTabId,
  activeSpaceId,
  isInitialTabsLoaded = true,
  spaces = [],
  isCollapsed = false,
  onToggleCollapse,
  onFocusTab,
  onCloseTab,
  onCloseAll,
  onCloseAllWindowTabs,
  onNewTab,
  onPinToQuickAccess,
  onPinToWorkspace,
  onPinToSpace,
  onMoveTabToSpace,
  onDuplicateTab,
  onReloadTab,
  onDiscardTab,
  onToggleMuteTab,
  onRenameTab,
  onOpenContextMenu,
  onMoveOpenTab,
  getReminderForTab,
  onOpenReminderPopover,
  densityMode = 'compact',
  selectedTabIds,
  onSelectTab,
  onCloseMultipleTabs,
  onPinMultipleTabsToWorkspace,
  onPinMultipleTabsToSpace,
  onMoveMultipleTabsToSpace,
  onDiscardMultipleTabs,
  editingTabId: controlledEditingTabId,
  editingTitle: controlledEditingTitle,
  onStartRename: controlledOnStartRename,
  onChangeEditTitle: controlledOnChangeEditTitle,
  onSaveRename: controlledOnSaveRename,
  onCancelRename: controlledOnCancelRename
}) => {
  const [localEditingTabId, setLocalEditingTabId] = useState<number | null>(null);
  const [localEditingTitle, setLocalEditingTitle] = useState<string>('');
  const [isClearMenuOpen, setIsClearMenuOpen] = useState(false);
  const sectionRef = React.useRef<HTMLDivElement>(null);
  const prevTabIdsRef = React.useRef<Set<number> | null>(null);
  const prevSpaceIdRef = React.useRef<string | undefined>(activeSpaceId);
  const clearDropdownRef = React.useRef<HTMLDivElement>(null);
  const dropdownMenuRef = React.useRef<HTMLDivElement>(null);
  const [clearMenuCoords, setClearMenuCoords] = useState<{ top: number; right: number }>({
    top: 0,
    right: 8
  });

  useLayoutEffect(() => {
    if (!isClearMenuOpen || !clearDropdownRef.current) return;
    const triggerRect = clearDropdownRef.current.getBoundingClientRect();
    const menuEl = dropdownMenuRef.current;
    const menuHeight = menuEl ? menuEl.getBoundingClientRect().height : 84;
    const winW = typeof window !== 'undefined' ? window.innerWidth : 320;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 600;
    // Leave at least 52px margin from the bottom so it never overlaps the bottom Spaces dock
    const bottomSafeBoundary = winH - 52;

    let top = triggerRect.bottom + 6;
    if (top + menuHeight > bottomSafeBoundary && triggerRect.top - menuHeight - 6 > 8) {
      top = triggerRect.top - menuHeight - 6;
    } else if (top + menuHeight > winH - 12) {
      top = Math.max(8, winH - menuHeight - 12);
    }

    const right = Math.max(8, winW - triggerRect.right);
    setClearMenuCoords({ top, right });
  }, [isClearMenuOpen]);

  useEffect(() => {
    if (!isClearMenuOpen) return;

    let leaveTimer: ReturnType<typeof setTimeout> | null = null;

    const handleClose = () => {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
      setIsClearMenuOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        clearDropdownRef.current &&
        !clearDropdownRef.current.contains(target) &&
        dropdownMenuRef.current &&
        !dropdownMenuRef.current.contains(target)
      ) {
        handleClose();
      }
    };

    const handleScroll = (e: Event) => {
      if (dropdownMenuRef.current && e.target instanceof Node && dropdownMenuRef.current.contains(e.target)) {
        return;
      }
      handleClose();
    };

    const handleMouseLeaveDocument = () => {
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => {
        handleClose();
      }, 80);
    };

    const handleMouseEnterDocument = () => {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) handleClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleClose);
    window.addEventListener('resize', handleClose);
    window.addEventListener('scroll', handleScroll, true);
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.documentElement.addEventListener('mouseleave', handleMouseLeaveDocument);
    document.documentElement.addEventListener('mouseenter', handleMouseEnterDocument);

    if (chrome?.tabs?.onActivated) {
      chrome.tabs.onActivated.addListener(handleClose);
    }
    if (chrome?.windows?.onFocusChanged) {
      chrome.windows.onFocusChanged.addListener(handleClose);
    }
    if (chrome?.tabs?.onHighlighted) {
      chrome.tabs.onHighlighted.addListener(handleClose);
    }

    return () => {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleClose);
      window.removeEventListener('resize', handleClose);
      window.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.documentElement.removeEventListener('mouseleave', handleMouseLeaveDocument);
      document.documentElement.removeEventListener('mouseenter', handleMouseEnterDocument);

      if (chrome?.tabs?.onActivated) {
        chrome.tabs.onActivated.removeListener(handleClose);
      }
      if (chrome?.windows?.onFocusChanged) {
        chrome.windows.onFocusChanged.removeListener(handleClose);
      }
      if (chrome?.tabs?.onHighlighted) {
        chrome.tabs.onHighlighted.removeListener(handleClose);
      }
    };
  }, [isClearMenuOpen]);

  const hasClearableTabs = unpinnedTabs.length > 0 || hasOpenActiveSpaceTabs;

  useEffect(() => {
    if (!hasClearableTabs) {
      setIsClearMenuOpen(false);
    }
  }, [hasClearableTabs]);

  const isControlled = typeof controlledOnStartRename === 'function';
  const effectiveEditingTabId = isControlled ? controlledEditingTabId : localEditingTabId;
  const effectiveEditingTitle = isControlled && controlledEditingTitle !== undefined ? controlledEditingTitle : localEditingTitle;

  const commitEdit = useCallback(
    (tabId: number, newTitle: string) => {
      const tab = unpinnedTabs.find((t) => t.id === tabId);
      const originalTitle = tab?.title || '';
      const trimmed = newTitle.trim();
      if (trimmed && trimmed !== originalTitle && onRenameTab) {
        onRenameTab(tabId, trimmed);
      }
    },
    [unpinnedTabs, onRenameTab]
  );

  const localHandleStartRename = useCallback(
    (tab: chrome.tabs.Tab) => {
      if (typeof tab.id !== 'number') return;
      if (localEditingTabId !== null && localEditingTabId !== tab.id) {
        commitEdit(localEditingTabId, localEditingTitle);
      }
      setLocalEditingTabId(tab.id);
      setLocalEditingTitle(tab.title || '');
    },
    [localEditingTabId, localEditingTitle, commitEdit]
  );

  const localHandleSaveRename = useCallback(
    (tabId: number) => {
      commitEdit(tabId, localEditingTitle);
      setLocalEditingTabId(null);
      setLocalEditingTitle('');
    },
    [commitEdit, localEditingTitle]
  );

  const localHandleCancelRename = useCallback(() => {
    setLocalEditingTabId(null);
    setLocalEditingTitle('');
  }, []);

  const handleStartRename = controlledOnStartRename || localHandleStartRename;
  const handleSaveRename = (tabId: number) => {
    if (controlledOnSaveRename) {
      controlledOnSaveRename();
    } else {
      localHandleSaveRename(tabId);
    }
  };
  const handleCancelRename = controlledOnCancelRename || localHandleCancelRename;
  const handleChangeEditTitle = controlledOnChangeEditTitle || setLocalEditingTitle;

  // Cleanup if edited tab is closed or removed
  useEffect(() => {
    if (localEditingTabId !== null && !unpinnedTabs.some((t) => t.id === localEditingTabId)) {
      setLocalEditingTabId(null);
      setLocalEditingTitle('');
    }
  }, [localEditingTabId, unpinnedTabs]);

  // Automatically scroll down so the latest tab is in view when a new tab is opened
  useEffect(() => {
    if (!isInitialTabsLoaded) return;

    const currentIds = unpinnedTabs
      .map((t) => t.id)
      .filter((id): id is number => typeof id === 'number');

    if (prevTabIdsRef.current === null || prevSpaceIdRef.current !== activeSpaceId) {
      prevTabIdsRef.current = new Set(currentIds);
      prevSpaceIdRef.current = activeSpaceId;
      return;
    }

    const prevIds = prevTabIdsRef.current;
    const addedIds = currentIds.filter((id) => !prevIds.has(id));
    prevTabIdsRef.current = new Set(currentIds);

    if (addedIds.length > 0 && !isCollapsed) {
      const latestTabId = addedIds[addedIds.length - 1];
      const sectionEl = sectionRef.current;
      if (sectionEl) {
        const rowEl = sectionEl.querySelector(
          `[data-tab-id="${latestTabId}"]`
        ) as HTMLElement | null;
        if (rowEl && typeof rowEl.scrollIntoView === 'function') {
          rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        const scrollContainer = sectionEl.closest('.overflow-y-auto') as HTMLElement | null;
        if (scrollContainer) {
          if (typeof scrollContainer.scrollTo === 'function') {
            scrollContainer.scrollTo({
              top: scrollContainer.scrollHeight,
              behavior: 'smooth'
            });
          }
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
    }
  }, [unpinnedTabs, activeSpaceId, isInitialTabsLoaded, isCollapsed]);

  return (
    <div
      ref={sectionRef}
      className="flex flex-col space-y-1 pt-2 pb-2 border-t border-black/[0.06] dark:border-white/[0.06]"
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-1 pb-1">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex items-center space-x-1 text-left group"
        >
          {onToggleCollapse && (
            <ChevronDown
              className={`w-3 h-3 text-zinc-400 dark:text-zinc-500 transition-transform duration-150 ${
                isCollapsed ? '-rotate-90' : 'rotate-0'
              }`}
            />
          )}
          <span className="text-[11px] font-semibold tracking-wide text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-zinc-200 transition-colors">
            Today&apos;s Tabs
          </span>
        </button>

        {/* Action Buttons: Clear with Chevron & New Tab */}
        <div className="flex items-center space-x-1">
          {hasClearableTabs && (
            <div
              ref={clearDropdownRef}
              className={`relative flex items-center rounded-md transition-colors ${
                isClearMenuOpen
                  ? 'bg-black/10 dark:bg-white/10'
                  : 'hover:bg-black/5 dark:hover:bg-white/10'
              }`}
            >
              <button
                type="button"
                title="Close temporary Today's tabs"
                aria-label="Close temporary Today's tabs"
                onClick={() => {
                  onCloseAll();
                  if (unpinnedTabs.length === 0 && onCloseAllWindowTabs) {
                    setIsClearMenuOpen((prev) => !prev);
                  }
                }}
                onContextMenu={(e) => {
                  if (onCloseAllWindowTabs) {
                    e.preventDefault();
                    setIsClearMenuOpen((prev) => !prev);
                  }
                }}
                className="p-1 pl-1.5 rounded-l text-zinc-400 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>

              {onCloseAllWindowTabs && (
                <>
                  <span className="w-[1px] h-3 bg-black/10 dark:bg-white/10 my-auto" />
                  <button
                    type="button"
                    title="Clear options"
                    aria-label="Clear options"
                    aria-expanded={isClearMenuOpen}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsClearMenuOpen((prev) => !prev);
                    }}
                    className="p-1 pr-1.5 rounded-r text-zinc-400 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                  >
                    <ChevronDown
                      className={`w-3 h-3 stroke-[2.2] transition-transform duration-150 ${
                        isClearMenuOpen ? 'rotate-180 text-zinc-800 dark:text-zinc-100' : ''
                      }`}
                    />
                  </button>
                </>
              )}

              {/* Clear Dropdown Menu rendered in portal so it is never clipped by the scroll container */}
              {isClearMenuOpen &&
                createPortal(
                  <div
                    ref={dropdownMenuRef}
                    style={{
                      position: 'fixed',
                      top: `${clearMenuCoords.top}px`,
                      right: `${clearMenuCoords.right}px`,
                      zIndex: 99999
                    }}
                    className="w-44 rounded-xl bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-zinc-700/80 shadow-[0_12px_36px_rgba(0,0,0,0.2)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.8)] p-1 animate-in fade-in zoom-in-95 duration-100 select-none text-zinc-900 dark:text-zinc-100"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onCloseAll();
                        setIsClearMenuOpen(false);
                      }}
                      className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                      <span>Clear Today&apos;s tabs</span>
                    </button>

                    {onCloseAllWindowTabs && (
                      <button
                        type="button"
                        title="Close all tabs in current window"
                        onClick={() => {
                          onCloseAllWindowTabs();
                          setIsClearMenuOpen(false);
                        }}
                        className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-left text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      >
                        <X className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
                        <span>Clear all tabs</span>
                      </button>
                    )}
                  </div>,
                  document.body
                )}
            </div>
          )}

          {onNewTab && (
            <button
              type="button"
              title="New tab (Cmd+T)"
              aria-label="New tab"
              onClick={onNewTab}
              className="p-1 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Unpinned Tabs List */}
      {!isCollapsed && (
        <div className="flex flex-col -mx-1 animate-in fade-in duration-100">
          {unpinnedTabs.length === 0 ? (
            <div className="px-3 py-3 text-center text-zinc-500 rounded-lg border border-dashed border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.01]">
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">No unpinned tabs open.</p>
              <button
                type="button"
                onClick={onNewTab}
                className="mt-1 text-xs theme-accent-text hover:underline"
              >
                + Open a new tab
              </button>
            </div>
          ) : (
            unpinnedTabs.map((tab) => {
              const isActive = Boolean(tab.id && tab.id === activeTabId);
              const isEditing = typeof tab.id === 'number' && effectiveEditingTabId === tab.id;
              return (
                <OpenTabRow
                  key={tab.id}
                  tab={tab}
                  isActive={isActive}
                  spaces={spaces}
                  onFocus={onFocusTab}
                  onClose={onCloseTab}
                  onPinToQuickAccess={onPinToQuickAccess}
                  onPinToWorkspace={onPinToWorkspace}
                  onPinToSpace={onPinToSpace}
                  onDuplicate={onDuplicateTab}
                  onReload={onReloadTab}
                  onDiscardTab={onDiscardTab}
                  onToggleMute={onToggleMuteTab}
                  onRenameTab={onRenameTab}
                  onOpenContextMenu={onOpenContextMenu}
                  onMoveOpenTab={onMoveOpenTab}
                  reminder={typeof tab.id === 'number' ? getReminderForTab?.(tab.id, tab.url) : undefined}
                  onOpenReminderPopover={onOpenReminderPopover}
                  densityMode={densityMode}
                  isSelected={typeof tab.id === 'number' && Boolean(selectedTabIds?.has(tab.id))}
                  selectedTabIds={selectedTabIds}
                  onSelectTab={onSelectTab}
                  onCloseMultipleTabs={onCloseMultipleTabs}
                  onPinMultipleTabsToWorkspace={onPinMultipleTabsToWorkspace}
                  onPinMultipleTabsToSpace={onPinMultipleTabsToSpace}
                  onMoveTabToSpace={onMoveTabToSpace}
                  onMoveMultipleTabsToSpace={onMoveMultipleTabsToSpace}
                  onDiscardMultipleTabs={onDiscardMultipleTabs}
                  isEditing={isEditing}
                  editTitle={isEditing ? (effectiveEditingTitle || '') : (tab.title || '')}
                  onStartRename={() => handleStartRename(tab)}
                  onChangeEditTitle={handleChangeEditTitle}
                  onSaveRename={() => typeof tab.id === 'number' && handleSaveRename(tab.id)}
                  onCancelRename={handleCancelRename}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
