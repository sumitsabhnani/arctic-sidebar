import React, { useState } from 'react';
import {
  PanelLeftOpen,
  Plus,
  RotateCw,
  Sun,
  Moon,
  Globe,
  RotateCcw,
  X,
  Volume2,
  Folder,
  Search,
  BookmarkPlus,
  ExternalLink,
  Copy,
  Pin
} from 'lucide-react';
import type { TabBinding } from '../../types';
import { getFaviconUrl } from '../utils/url';
import type { ContextMenuItem } from './ContextMenu';

interface CompactSidebarProps {
  quickAccessBookmarks: chrome.bookmarks.BookmarkTreeNode[];
  workspaceBookmarks: chrome.bookmarks.BookmarkTreeNode[];
  unpinnedTabs: chrome.tabs.Tab[];
  bindingsByBookmarkId: Record<string, TabBinding>;
  activeTabId: number | null;
  isActiveTabLoading?: boolean;
  theme: 'dark' | 'light';
  onExpand: () => void;
  onToggleTheme: () => void;
  onNewTab: () => void;
  onReloadActiveTab: () => void;
  onToggleSearch: () => void;
  onFocusTab: (tabId: number) => void;
  onRowClick: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onQuickAccessClick: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onCloseTab: (tabId: number, e: React.MouseEvent) => void;
  onPinToQuickAccess?: (tab: chrome.tabs.Tab) => void;
  onPinToWorkspace?: (tab: chrome.tabs.Tab) => void;
  onDuplicateTab?: (tabId: number) => void;
  onReloadTab?: (tabId: number) => void;
  onToggleMuteTab?: (tab: chrome.tabs.Tab) => void;
  onOpenContextMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
}

export const CompactSidebar: React.FC<CompactSidebarProps> = ({
  quickAccessBookmarks,
  workspaceBookmarks,
  unpinnedTabs,
  bindingsByBookmarkId,
  activeTabId,
  isActiveTabLoading = false,
  theme,
  onExpand,
  onToggleTheme,
  onNewTab,
  onReloadActiveTab,
  onToggleSearch,
  onFocusTab,
  onRowClick,
  onQuickAccessClick,
  onCloseTab,
  onPinToQuickAccess,
  onPinToWorkspace,
  onDuplicateTab,
  onReloadTab,
  onToggleMuteTab,
  onOpenContextMenu
}) => {
  const quickAccessItems = quickAccessBookmarks.filter((b) => Boolean(b.url));

  // Flatten top bookmarks from workspace for compact view
  const topWorkspaceItems: chrome.bookmarks.BookmarkTreeNode[] = [];
  const collectBookmarks = (nodes: chrome.bookmarks.BookmarkTreeNode[], limit = 15) => {
    for (const node of nodes) {
      if (topWorkspaceItems.length >= limit) break;
      topWorkspaceItems.push(node);
    }
  };
  collectBookmarks(workspaceBookmarks);

  return (
    <div className="flex flex-col h-screen w-full items-center py-2 px-1 bg-[#f8f9fa] dark:bg-[#121214] text-zinc-800 dark:text-zinc-100 select-none overflow-hidden font-sans border-r border-black/[0.08] dark:border-white/[0.08] transition-colors duration-150">
      {/* Top Action Bar */}
      <div className="flex flex-col items-center space-y-1 w-full pb-2 border-b border-black/[0.08] dark:border-white/[0.08]">
        {/* Expand Button */}
        <button
          type="button"
          title="Expand sidebar (Cmd+S / Ctrl+S)"
          onClick={onExpand}
          className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>

        {/* New Tab Button */}
        <button
          type="button"
          title="New Tab (Cmd+T)"
          onClick={onNewTab}
          className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>

        {/* Reload Active Tab */}
        <button
          type="button"
          title="Reload page (Cmd+R)"
          onClick={onReloadActiveTab}
          className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <RotateCw
            className={`w-4 h-4 transition-transform duration-300 ${
              isActiveTabLoading ? 'animate-spin text-cyan-500' : ''
            }`}
          />
        </button>

        {/* Search */}
        <button
          type="button"
          title="Search bookmarks & tabs (Cmd+K)"
          onClick={() => {
            onExpand();
            onToggleSearch();
          }}
          className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Theme Toggle */}
        <button
          type="button"
          title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          onClick={onToggleTheme}
          className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-amber-500 dark:hover:text-amber-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-300" />
          ) : (
            <Moon className="w-4 h-4 text-indigo-500" />
          )}
        </button>
      </div>

      {/* Scrollable Icon Column */}
      <div className="flex-1 w-full overflow-y-auto overflow-x-hidden flex flex-col items-center py-2 space-y-2 no-scrollbar">
        {/* Quick Access Tiles */}
        {quickAccessItems.length > 0 && (
          <div className="flex flex-col items-center space-y-1.5 w-full">
            {quickAccessItems.map((b) => {
              const binding = bindingsByBookmarkId[b.id];
              const isActive = Boolean(binding && binding.tabId === activeTabId);
              const isRunningInBackground = Boolean(binding && binding.tabId !== activeTabId);
              const isNavAway = binding?.isNavigatedAway ?? false;
              const faviconSrc = b.url ? getFaviconUrl(b.url, 48) : '';

              return (
                <CompactTile
                  key={b.id}
                  title={b.title || b.url || 'Quick Access'}
                  faviconSrc={faviconSrc}
                  isActive={isActive}
                  isRunning={isRunningInBackground}
                  isNavAway={isNavAway}
                  onClick={() => onQuickAccessClick(b)}
                  onContextMenu={(e) => {
                    const items: ContextMenuItem[] = [
                      {
                        label: 'Open in New Tab',
                        icon: <ExternalLink className="w-3.5 h-3.5" />,
                        action: () => b.url && chrome.tabs.create({ url: b.url, active: true })
                      },
                      {
                        label: 'Copy URL',
                        icon: <Copy className="w-3.5 h-3.5" />,
                        action: () => b.url && navigator.clipboard.writeText(b.url)
                      },
                      ...(binding
                        ? [
                            {
                              label: 'Close Running Tab',
                              icon: <X className="w-3.5 h-3.5 text-rose-500" />,
                              action: () => onCloseTab(binding.tabId, e),
                              danger: true,
                              dividerBefore: true
                            }
                          ]
                        : [])
                    ];
                    onOpenContextMenu(e, items);
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Divider if Quick Access & Workspace exist */}
        {quickAccessItems.length > 0 && topWorkspaceItems.length > 0 && (
          <div className="w-6 h-[1px] bg-black/10 dark:bg-white/10 my-1" />
        )}

        {/* Workspace Bookmarks */}
        {topWorkspaceItems.length > 0 && (
          <div className="flex flex-col items-center space-y-1 w-full">
            {topWorkspaceItems.map((item) => {
              if (!item.url) {
                // Folder icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={`Folder: ${item.title || 'Workspace Folder'} (Click to expand sidebar)`}
                    onClick={onExpand}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-amber-500 dark:text-amber-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  >
                    <Folder className="w-4 h-4" />
                  </button>
                );
              }

              const binding = bindingsByBookmarkId[item.id];
              const isActive = Boolean(binding && binding.tabId === activeTabId);
              const isRunning = Boolean(binding && binding.tabId !== activeTabId);
              const isNavAway = binding?.isNavigatedAway ?? false;
              const faviconSrc = getFaviconUrl(item.url, 32);

              return (
                <CompactTile
                  key={item.id}
                  title={item.title || item.url || 'Bookmark'}
                  faviconSrc={faviconSrc}
                  isActive={isActive}
                  isRunning={isRunning}
                  isNavAway={isNavAway}
                  onClick={() => onRowClick(item)}
                  onContextMenu={(e) => {
                    const items: ContextMenuItem[] = [
                      {
                        label: 'Open in New Tab',
                        icon: <ExternalLink className="w-3.5 h-3.5" />,
                        action: () => item.url && chrome.tabs.create({ url: item.url, active: true })
                      },
                      {
                        label: 'Copy URL',
                        icon: <Copy className="w-3.5 h-3.5" />,
                        action: () => item.url && navigator.clipboard.writeText(item.url)
                      },
                      ...(binding
                        ? [
                            {
                              label: 'Close Running Tab',
                              icon: <X className="w-3.5 h-3.5 text-rose-500" />,
                              action: () => onCloseTab(binding.tabId, e),
                              danger: true,
                              dividerBefore: true
                            }
                          ]
                        : [])
                    ];
                    onOpenContextMenu(e, items);
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Divider if Open Tabs exist */}
        {unpinnedTabs.length > 0 && (
          <div className="w-6 h-[1px] bg-black/10 dark:bg-white/10 my-1" />
        )}

        {/* Open Unpinned Tabs */}
        {unpinnedTabs.length > 0 && (
          <div className="flex flex-col items-center space-y-1 w-full">
            {unpinnedTabs.map((tab) => {
              if (typeof tab.id !== 'number') return null;
              const tabId = tab.id;
              const isActive = tabId === activeTabId;
              const isAudible = Boolean(tab.audible);
              const faviconSrc = tab.favIconUrl || (tab.url ? getFaviconUrl(tab.url, 32) : '');

              return (
                <div key={tabId} className="relative group flex items-center justify-center">
                  <CompactTile
                    title={tab.title || tab.url || 'Open Tab'}
                    faviconSrc={faviconSrc}
                    isActive={isActive}
                    isRunning={!isActive}
                    isNavAway={false}
                    onClick={() => onFocusTab(tabId)}
                    onContextMenu={(e) => {
                      const items: ContextMenuItem[] = [
                        ...(onPinToQuickAccess
                          ? [
                              {
                                label: 'Pin to Quick Access',
                                icon: <Pin className="w-3.5 h-3.5 text-cyan-500" />,
                                action: () => onPinToQuickAccess(tab)
                              }
                            ]
                          : []),
                        ...(onPinToWorkspace
                          ? [
                              {
                                label: 'Pin to Workspace',
                                icon: <BookmarkPlus className="w-3.5 h-3.5 text-amber-500" />,
                                action: () => onPinToWorkspace(tab)
                              }
                            ]
                          : []),
                        ...(onDuplicateTab
                          ? [
                              {
                                label: 'Duplicate Tab',
                                icon: <Plus className="w-3.5 h-3.5" />,
                                action: () => onDuplicateTab(tabId)
                              }
                            ]
                          : []),
                        ...(onReloadTab
                          ? [
                              {
                                label: 'Reload Tab',
                                icon: <RotateCw className="w-3.5 h-3.5" />,
                                action: () => onReloadTab(tabId)
                              }
                            ]
                          : []),
                        ...(onToggleMuteTab
                          ? [
                              {
                                label: tab.mutedInfo?.muted ? 'Unmute Tab' : 'Mute Tab',
                                icon: <Volume2 className="w-3.5 h-3.5" />,
                                action: () => onToggleMuteTab(tab)
                              }
                            ]
                          : []),
                        {
                          label: 'Copy URL',
                          icon: <Copy className="w-3.5 h-3.5" />,
                          action: () => tab.url && navigator.clipboard.writeText(tab.url),
                          dividerBefore: true
                        },
                        {
                          label: 'Close Tab',
                          icon: <X className="w-3.5 h-3.5 text-rose-500" />,
                          action: () => onCloseTab(tabId, e),
                          danger: true,
                          dividerBefore: true
                        }
                      ];
                      onOpenContextMenu(e, items);
                    }}
                  />

                  {/* Audible Indicator */}
                  {isAudible && (
                    <span className="absolute -bottom-0.5 -right-0.5 p-0.5 rounded-full bg-emerald-500 text-white pointer-events-none">
                      <Volume2 className="w-2 h-2" />
                    </span>
                  )}

                  {/* Hover ✕ Close Button */}
                  <button
                    type="button"
                    title="Close tab"
                    onClick={(e) => onCloseTab(tabId, e)}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-zinc-700 hover:bg-rose-500 text-white items-center justify-center hidden group-hover:flex shadow-sm transition-colors z-10"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Compact Footer */}
      <div className="pt-2 border-t border-black/[0.08] dark:border-white/[0.08] flex items-center justify-center">
        <button
          type="button"
          title="Expand sidebar"
          onClick={onExpand}
          className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
        >
          <PanelLeftOpen className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

interface CompactTileProps {
  title: string;
  faviconSrc: string;
  isActive: boolean;
  isRunning?: boolean;
  isNavAway?: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const CompactTile: React.FC<CompactTileProps> = ({
  title,
  faviconSrc,
  isActive,
  isRunning,
  isNavAway,
  onClick,
  onContextMenu
}) => {
  const [faviconError, setFaviconError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 outline-none ${
        isActive
          ? 'bg-blue-500/15 border border-blue-400/50 shadow-[0_0_10px_rgba(59,130,246,0.3)] text-blue-600 dark:text-white'
          : isRunning
          ? 'bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300'
          : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.07] text-zinc-500 dark:text-zinc-400'
      }`}
    >
      <div className="relative w-4 h-4 flex items-center justify-center">
        {isActive && isNavAway && isHovered ? (
          <RotateCcw className="w-3.5 h-3.5 text-amber-500 dark:text-amber-300 animate-spin-reverse" />
        ) : !faviconError && faviconSrc ? (
          <img
            src={faviconSrc}
            alt=""
            onError={() => setFaviconError(true)}
            className="w-4 h-4 object-contain rounded-[3px]"
          />
        ) : (
          <Globe className="w-3.5 h-3.5 text-zinc-400" />
        )}

        {/* Small drifted dot indicator */}
        {isNavAway && !(isActive && isHovered) && (
          <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-amber-400 ring-1 ring-white dark:ring-[#121214]" />
        )}
      </div>

      {/* Active Tab Glow Bar (left side) */}
      {isActive && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.8)]" />
      )}
    </button>
  );
};
