import React from 'react';
import { Layers, Plus, Trash2 } from 'lucide-react';
import { OpenTabRow } from './OpenTabRow';
import type { ContextMenuItem } from './ContextMenu';

interface OpenTabsSectionProps {
  unpinnedTabs: chrome.tabs.Tab[];
  activeTabId: number | null;
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
  onOpenContextMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  onMoveOpenTab?: (tabId: number, targetIndex: number) => void;
}

export const OpenTabsSection: React.FC<OpenTabsSectionProps> = ({
  unpinnedTabs,
  activeTabId,
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
  onOpenContextMenu,
  onMoveOpenTab
}) => {
  return (
    <div className="flex flex-col space-y-1 pt-2 border-t border-white/[0.06]">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-1 pb-1">
        <div className="flex items-center space-x-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1">
            <Layers className="w-2.5 h-2.5 text-blue-400/90" />
            Today&apos;s Tabs
          </span>
          <span className="text-[10px] text-zinc-600 font-mono">
            {unpinnedTabs.length}
          </span>
        </div>

        {/* Action Buttons: Clear & New Tab */}
        <div className="flex items-center space-x-1">
          {unpinnedTabs.length > 0 && (
            <button
              type="button"
              title="Clear / Close all unpinned tabs"
              onClick={onCloseAll}
              className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] text-zinc-500 hover:text-zinc-200 hover:bg-white/10 transition-colors"
            >
              <Trash2 className="w-2.5 h-2.5" />
              <span>Clear</span>
            </button>
          )}

          <button
            type="button"
            title="New Tab (Ctrl+T / Cmd+T)"
            onClick={onNewTab}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] text-zinc-400 hover:text-white hover:bg-white/10 transition-colors font-medium"
          >
            <Plus className="w-3 h-3 text-cyan-400" />
            <span>New Tab</span>
          </button>
        </div>
      </div>

      {/* Unpinned Tabs List */}
      <div className="flex flex-col -mx-1">
        {unpinnedTabs.length === 0 ? (
          <div className="px-3 py-3 text-center text-zinc-500 rounded-lg border border-dashed border-white/5 bg-white/[0.01]">
            <p className="text-[11px] text-zinc-500">No unpinned tabs open.</p>
            <button
              type="button"
              onClick={onNewTab}
              className="mt-1 text-xs text-cyan-400 hover:underline"
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
                onOpenContextMenu={onOpenContextMenu}
                onMoveOpenTab={onMoveOpenTab}
              />
            );
          })
        )}
      </div>
    </div>
  );
};
