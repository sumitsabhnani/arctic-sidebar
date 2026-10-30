import React from 'react';
import { Layers, Plus, Trash2, ChevronDown } from 'lucide-react';
import { OpenTabRow } from './OpenTabRow';
import type { ContextMenuItem } from './ContextMenu';

interface OpenTabsSectionProps {
  unpinnedTabs: chrome.tabs.Tab[];
  activeTabId: number | null;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onFocusTab: (tabId: number) => void;
  onCloseTab: (tabId: number, e: React.MouseEvent) => void;
  onCloseAll: () => void;
  onNewTab: () => void;
  onPinToQuickAccess: (tab: chrome.tabs.Tab) => void;
  onPinToWorkspace: (tab: chrome.tabs.Tab) => void;
  onDuplicateTab: (tabId: number) => void;
  onReloadTab: (tabId: number) => void;
  onDiscardTab?: (tabId: number) => void;
  onToggleMuteTab: (tab: chrome.tabs.Tab) => void;
  onRenameTab?: (tabId: number, title: string) => void;
  onOpenContextMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  onMoveOpenTab?: (tabId: number, targetIndex: number) => void;
}

export const OpenTabsSection: React.FC<OpenTabsSectionProps> = ({
  unpinnedTabs,
  activeTabId,
  isCollapsed = false,
  onToggleCollapse,
  onFocusTab,
  onCloseTab,
  onCloseAll,
  onNewTab,
  onPinToQuickAccess,
  onPinToWorkspace,
  onDuplicateTab,
  onReloadTab,
  onDiscardTab,
  onToggleMuteTab,
  onRenameTab,
  onOpenContextMenu,
  onMoveOpenTab
}) => {
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
          <span className="text-[10px] text-zinc-400 dark:text-zinc-600 font-mono">
            {unpinnedTabs.length}
          </span>
        </button>

        {/* Action Buttons: Clear & New Tab */}
        <div className="flex items-center space-x-1">
          {unpinnedTabs.length > 0 && (
            <button
              type="button"
              title="Clear / Close all unpinned tabs"
              onClick={onCloseAll}
              className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <Trash2 className="w-2.5 h-2.5" />
              <span>Clear</span>
            </button>
          )}

          <button
            type="button"
            title="New Tab (Ctrl+T / Cmd+T)"
            onClick={onNewTab}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] text-zinc-500 dark:text-zinc-400 hover:theme-accent-text hover:bg-black/5 dark:hover:bg-white/10 transition-colors font-medium"
          >
            <Plus className="w-3 h-3 theme-accent-text" />
            <span>New Tab</span>
          </button>
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
              return (
                <OpenTabRow
                  key={tab.id}
                  tab={tab}
                  isActive={isActive}
                  onFocus={onFocusTab}
                  onClose={onCloseTab}
                  onPinToQuickAccess={onPinToQuickAccess}
                  onPinToWorkspace={onPinToWorkspace}
                  onDuplicate={onDuplicateTab}
                  onReload={onReloadTab}
                  onDiscardTab={onDiscardTab}
                  onToggleMute={onToggleMuteTab}
                  onRenameTab={onRenameTab}
                  onOpenContextMenu={onOpenContextMenu}
                  onMoveOpenTab={onMoveOpenTab}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
