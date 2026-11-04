import React, { useState, useEffect, useCallback } from 'react';
import { Layers, Trash2, ChevronDown, X } from 'lucide-react';
import { OpenTabRow } from './OpenTabRow';
import type { SpaceItem, TabReminder } from '../../types';
import type { ContextMenuItem } from './ContextMenu';

interface OpenTabsSectionProps {
  unpinnedTabs: chrome.tabs.Tab[];
  activeTabId: number | null;
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
  editingTabId?: number | null;
  editingTitle?: string;
  onStartRename?: (tab: chrome.tabs.Tab) => void;
  onChangeEditTitle?: (newTitle: string) => void;
  onSaveRename?: () => void;
  onCancelRename?: () => void;
}

export const OpenTabsSection: React.FC<OpenTabsSectionProps> = ({
  unpinnedTabs,
  activeTabId,
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
  editingTabId: controlledEditingTabId,
  editingTitle: controlledEditingTitle,
  onStartRename: controlledOnStartRename,
  onChangeEditTitle: controlledOnChangeEditTitle,
  onSaveRename: controlledOnSaveRename,
  onCancelRename: controlledOnCancelRename
}) => {
  const [localEditingTabId, setLocalEditingTabId] = useState<number | null>(null);
  const [localEditingTitle, setLocalEditingTitle] = useState<string>('');

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

  return (
    <div className="flex flex-col space-y-1 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
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
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1 group-hover:text-zinc-700 dark:group-hover:text-zinc-300">
            <Layers className="w-2.5 h-2.5 theme-accent-text" />
            Today&apos;s Tabs
          </span>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
            ({unpinnedTabs.length} ACTIVE)
          </span>
        </button>

        {/* Action Buttons: Clear & Clear All */}
        <div className="flex items-center space-x-1">
          {unpinnedTabs.length > 0 && (
            <button
              type="button"
              title="Close temporary Today's tabs"
              onClick={onCloseAll}
              className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <Trash2 className="w-2.5 h-2.5" />
              <span>Clear</span>
            </button>
          )}
          {onCloseAllWindowTabs && (
            <button
              type="button"
              title="Close all tabs in current window"
              onClick={onCloseAllWindowTabs}
              className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            >
              <X className="w-2.5 h-2.5" />
              <span>Clear All</span>
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
