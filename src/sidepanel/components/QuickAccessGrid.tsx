import React, { useState } from 'react';
import { Globe, RotateCcw, ExternalLink, FolderPlus, Copy, Trash2, X, RefreshCw, Edit2 } from 'lucide-react';
import type { TabBinding } from '../../types';
import { getFaviconUrl } from '../utils/url';
import type { ContextMenuItem } from './ContextMenu';

interface QuickAccessGridProps {
  bookmarks: chrome.bookmarks.BookmarkTreeNode[];
  bindingsByBookmarkId: Record<string, TabBinding>;
  activeTabId: number | null;
  onTileClick: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onOpenContextMenu?: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  onCloseTab?: (tabId: number, e: React.MouseEvent) => void;
  onMoveToWorkspace?: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onReplaceUrl?: (bookmarkId: string) => void;
  onRenameBookmark?: (id: string, title: string) => void;
  onRemoveBookmark?: (id: string) => void;
}

export const QuickAccessGrid: React.FC<QuickAccessGridProps> = ({
  bookmarks,
  bindingsByBookmarkId,
  activeTabId,
  onTileClick,
  onOpenContextMenu,
  onCloseTab,
  onMoveToWorkspace,
  onReplaceUrl,
  onRenameBookmark,
  onRemoveBookmark
}) => {
  const items = bookmarks.filter((b) => Boolean(b.url));

  if (items.length === 0) {
    return (
      <div className="px-3 py-3 rounded-xl border border-dashed border-zinc-300 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-center">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">No Quick Access favorites yet.</p>
        <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">
          Right-click any tab or bookmark to pin it here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-1.5 w-full">
      {items.map((bookmark) => (
        <QuickAccessTile
          key={bookmark.id}
          bookmark={bookmark}
          binding={bindingsByBookmarkId[bookmark.id]}
          activeTabId={activeTabId}
          onTileClick={onTileClick}
          onOpenContextMenu={onOpenContextMenu}
          onCloseTab={onCloseTab}
          onMoveToWorkspace={onMoveToWorkspace}
          onReplaceUrl={onReplaceUrl}
          onRenameBookmark={onRenameBookmark}
          onRemoveBookmark={onRemoveBookmark}
        />
      ))}
    </div>
  );
};

interface QuickAccessTileProps {
  bookmark: chrome.bookmarks.BookmarkTreeNode;
  binding?: TabBinding;
  activeTabId: number | null;
  onTileClick: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onOpenContextMenu?: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  onCloseTab?: (tabId: number, e: React.MouseEvent) => void;
  onMoveToWorkspace?: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onReplaceUrl?: (bookmarkId: string) => void;
  onRenameBookmark?: (id: string, title: string) => void;
  onRemoveBookmark?: (id: string) => void;
}

const QuickAccessTile: React.FC<QuickAccessTileProps> = ({
  bookmark,
  binding,
  activeTabId,
  onTileClick,
  onOpenContextMenu,
  onCloseTab,
  onMoveToWorkspace,
  onReplaceUrl,
  onRenameBookmark,
  onRemoveBookmark
}) => {
  const [faviconError, setFaviconError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const isActive = Boolean(binding && binding.tabId === activeTabId);
  const isRunningInBackground = Boolean(binding && binding.tabId !== activeTabId);
  const isNavAway = binding?.isNavigatedAway ?? false;

  const titleText = bookmark.title || bookmark.url || 'Favorite';
  const faviconSrc = bookmark.url ? getFaviconUrl(bookmark.url, 48) : '';

  let tooltip = titleText;
  if (isActive && isNavAway) {
    tooltip = `${titleText} (Navigated away: click to reset to original bookmark)`;
  } else if (isNavAway && binding) {
    tooltip = `${titleText}\n↳ Current: ${binding.currentTitle || binding.currentUrl}`;
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onOpenContextMenu) return;
    e.preventDefault();

    const items: ContextMenuItem[] = [
      {
        label: 'Open in New Tab',
        icon: <ExternalLink className="w-3.5 h-3.5" />,
        action: () => {
          if (bookmark.url) chrome.tabs.create({ url: bookmark.url, active: true });
        }
      },
      ...(onMoveToWorkspace
        ? [
            {
              label: 'Move to Workspace',
              icon: <FolderPlus className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />,
              action: () => onMoveToWorkspace(bookmark)
            }
          ]
        : []),
      ...(onReplaceUrl
        ? [
            {
              label: 'Replace with Current Page URL',
              icon: <RefreshCw className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />,
              action: () => onReplaceUrl(bookmark.id)
            }
          ]
        : []),
      ...(onRenameBookmark
        ? [
            {
              label: 'Rename Tab',
              icon: <Edit2 className="w-3.5 h-3.5 text-zinc-400" />,
              action: () => {
                const newTitle = window.prompt('Rename Quick Access tab:', bookmark.title || '');
                if (newTitle !== null && newTitle.trim()) {
                  onRenameBookmark(bookmark.id, newTitle.trim());
                }
              }
            }
          ]
        : []),
      {
        label: 'Copy URL',
        icon: <Copy className="w-3.5 h-3.5" />,
        action: () => {
          if (bookmark.url) navigator.clipboard.writeText(bookmark.url);
        },
        dividerBefore: true
      },
      ...(binding && onCloseTab
        ? [
            {
              label: 'Close Running Tab',
              icon: <X className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />,
              action: () => onCloseTab(binding.tabId, e),
              danger: true
            }
          ]
        : []),
      ...(onRemoveBookmark
        ? [
            {
              label: 'Remove from Quick Access',
              icon: <Trash2 className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />,
              action: () => onRemoveBookmark(bookmark.id),
              danger: true,
              dividerBefore: true
            }
          ]
        : [])
    ];

    onOpenContextMenu(e, items);
  };

  return (
    <button
      type="button"
      title={tooltip}
      onClick={() => onTileClick(bookmark)}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative flex flex-col items-center justify-center h-12 rounded-xl transition-all duration-150 select-none outline-none ${
        isActive
          ? 'bg-blue-500/15 border border-blue-400/40 shadow-[0_0_12px_rgba(59,130,246,0.3)] text-blue-600 dark:text-white'
          : isRunningInBackground
          ? 'bg-black/[0.04] dark:bg-white/[0.07] border border-black/10 dark:border-white/10 hover:bg-black/[0.08] dark:hover:bg-white/12 text-zinc-700 dark:text-zinc-200'
          : 'bg-black/[0.02] dark:bg-white/[0.03] border border-black/5 dark:border-white/5 hover:bg-black/[0.06] dark:hover:bg-white/[0.08] hover:border-black/10 dark:hover:border-white/10 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
      }`}
    >
      {/* Favicon or Reset Icon */}
      <div className="relative w-5 h-5 flex items-center justify-center">
        {/* Reset Icon when Active and Navigated Away (on hover) */}
        {isActive && isNavAway && isHovered ? (
          <RotateCcw className="w-4 h-4 text-amber-500 dark:text-amber-300 animate-spin-reverse stroke-[2.5]" />
        ) : !faviconError && faviconSrc ? (
          <img
            src={faviconSrc}
            alt=""
            onError={() => setFaviconError(true)}
            className="w-5 h-5 object-contain rounded-[4px] drop-shadow-sm transition-transform group-hover:scale-105"
          />
        ) : (
          <Globe className="w-4 h-4 text-zinc-400 dark:text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-200" />
        )}

        {/* Small drifted dot indicator if navigated away & not hovering */}
        {isNavAway && !(isActive && isHovered) && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-white dark:ring-[#1c1c1f]" />
        )}
      </div>

      {/* Background Tab Running Dot (bottom center) */}
      {isRunningInBackground && (
        <span className="absolute bottom-1 w-1 h-1 rounded-full bg-zinc-400/80 dark:bg-zinc-400/70" />
      )}

      {/* Active Tab Glow Bar (bottom center) */}
      {isActive && (
        <span className="absolute bottom-1 w-3 h-0.5 rounded-full bg-blue-500 dark:bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.8)]" />
      )}
    </button>
  );
};
