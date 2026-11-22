import React, { useState } from 'react';
import {
  Globe,
  RotateCcw,
  RotateCw,
  CopyPlus,
  ExternalLink,
  FolderPlus,
  Link2,
  Trash2,
  X,
  RefreshCw,
  Edit2,
  Volume2,
  VolumeX
} from 'lucide-react';
import type { TabBinding, TabWithFaviconMeta } from '../../types';
import { useResolvedFavicon } from '../utils/faviconCache';
import { markKeyboardRowActivation } from '../utils/tabPageFocus';
import { useFlipAnimation } from '../hooks/useFlipAnimation';
import {
  endDragSession,
  parseDragPayload,
  startDragSession,
  useActiveDrag,
  useRecentlyMovedIds
} from '../utils/dnd';
import type { ContextMenuItem } from './ContextMenu';

interface QuickAccessGridProps {
  bookmarks: chrome.bookmarks.BookmarkTreeNode[];
  bindingsByBookmarkId: Record<string, TabBinding>;
  tabsByTabId: Record<number, chrome.tabs.Tab>;
  activeTabId: number | null;
  densityMode?: 'relaxed' | 'compact';
  onTileClick: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onTileDoubleClick?: (bookmark: chrome.bookmarks.BookmarkTreeNode, e: React.MouseEvent) => void;
  onOpenContextMenu?: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  onCloseTab?: (tabId: number, e: React.MouseEvent) => void;
  onToggleMuteTab?: (tabOrId: chrome.tabs.Tab | number) => void;
  onMoveToWorkspace?: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onReplaceUrl?: (bookmarkId: string) => void;
  onRenameBookmark?: (id: string, title: string) => void;
  onRemoveBookmark?: (id: string) => void;
  onReorderQuickAccess?: (draggedId: string, targetIndex: number) => void;
  onDropItemToQuickAccess?: (
    data: { type: string; [key: string]: unknown },
    targetIndex?: number
  ) => void;
  onReloadTab?: (tabId: number) => void;
  onDuplicateTab?: (tabId: number) => void;
}

function getShortTitle(rawTitle?: string, rawUrl?: string): string {
  if (rawTitle && rawTitle.trim()) {
    let t = rawTitle.trim();
    if (t.includes(' · ')) t = t.split(' · ')[0];
    if (t.includes(' - ')) t = t.split(' - ')[0];
    if (t.includes(' | ')) t = t.split(' | ')[0];
    if (t.includes(': ')) t = t.split(': ')[0];
    if (t.length > 12) return t.slice(0, 11) + '…';
    return t;
  }
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      let host = u.hostname.replace(/^www\./, '');
      const parts = host.split('.');
      if (parts.length > 1) {
        return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      }
      return host;
    } catch {
      return rawUrl.slice(0, 10);
    }
  }
  return 'Tab';
}

export const QuickAccessGrid: React.FC<QuickAccessGridProps> = ({
  bookmarks,
  bindingsByBookmarkId,
  tabsByTabId,
  activeTabId,
  densityMode = 'relaxed',
  onTileClick,
  onTileDoubleClick,
  onOpenContextMenu,
  onCloseTab,
  onToggleMuteTab,
  onMoveToWorkspace,
  onReplaceUrl,
  onRenameBookmark,
  onRemoveBookmark,
  onReorderQuickAccess,
  onDropItemToQuickAccess,
  onReloadTab,
  onDuplicateTab
}) => {
  const items = bookmarks.filter((b) => Boolean(b.url));
  const gridRef = React.useRef<HTMLDivElement>(null);
  const gridOrderSignature = React.useMemo(
    () => items.map((b) => b.id).join(','),
    [items]
  );
  useFlipAnimation(gridRef, gridOrderSignature);

  if (items.length === 0) {
    return (
      <div className="px-3 py-3 rounded-xl border border-dashed border-zinc-300 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-center">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">No Quick Access favorites yet.</p>
        <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">
          Right-click any tab to pin it here.
        </p>
      </div>
    );
  }

  return (
    <div ref={gridRef} className="grid grid-cols-4 gap-1.5 w-full">
      {items.map((bookmark) => {
        const binding = bindingsByBookmarkId[bookmark.id];
        const boundTab = binding ? tabsByTabId[binding.tabId] : undefined;
        return (
          <QuickAccessTile
            key={bookmark.id}
            bookmark={bookmark}
            binding={binding}
            boundTab={boundTab}
            activeTabId={activeTabId}
            densityMode={densityMode}
            onTileClick={onTileClick}
            onTileDoubleClick={onTileDoubleClick}
            onOpenContextMenu={onOpenContextMenu}
            onCloseTab={onCloseTab}
            onToggleMuteTab={onToggleMuteTab}
            onMoveToWorkspace={onMoveToWorkspace}
            onReplaceUrl={onReplaceUrl}
            onRenameBookmark={onRenameBookmark}
            onRemoveBookmark={onRemoveBookmark}
            onReorderQuickAccess={onReorderQuickAccess}
            onDropItemToQuickAccess={onDropItemToQuickAccess}
            onReloadTab={onReloadTab}
            onDuplicateTab={onDuplicateTab}
          />
        );
      })}
    </div>
  );
};

interface QuickAccessTileProps {
  bookmark: chrome.bookmarks.BookmarkTreeNode;
  binding?: TabBinding;
  boundTab?: chrome.tabs.Tab;
  activeTabId: number | null;
  densityMode?: 'relaxed' | 'compact';
  onTileClick: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onTileDoubleClick?: (bookmark: chrome.bookmarks.BookmarkTreeNode, e: React.MouseEvent) => void;
  onOpenContextMenu?: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  onCloseTab?: (tabId: number, e: React.MouseEvent) => void;
  onToggleMuteTab?: (tabOrId: chrome.tabs.Tab | number) => void;
  onMoveToWorkspace?: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onReplaceUrl?: (bookmarkId: string) => void;
  onRenameBookmark?: (id: string, title: string) => void;
  onRemoveBookmark?: (id: string) => void;
  onReorderQuickAccess?: (draggedId: string, targetIndex: number) => void;
  onDropItemToQuickAccess?: (
    data: { type: string; [key: string]: unknown },
    targetIndex?: number
  ) => void;
  onReloadTab?: (tabId: number) => void;
  onDuplicateTab?: (tabId: number) => void;
}

const QuickAccessTile: React.FC<QuickAccessTileProps> = ({
  bookmark,
  binding,
  boundTab,
  activeTabId,
  densityMode = 'relaxed',
  onTileClick,
  onTileDoubleClick,
  onOpenContextMenu,
  onCloseTab,
  onToggleMuteTab,
  onMoveToWorkspace,
  onReplaceUrl,
  onRenameBookmark,
  onRemoveBookmark,
  onReorderQuickAccess,
  onDropItemToQuickAccess,
  onReloadTab,
  onDuplicateTab
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dropPosition, setDropPosition] = useState<'left' | 'right' | null>(null);
  const activeDrag = useActiveDrag();
  const recentlyMovedIds = useRecentlyMovedIds();
  const isRecentlyMoved = recentlyMovedIds.has(bookmark.id);

  const isActive = Boolean(binding && binding.tabId === activeTabId);
  const isRunningInBackground = Boolean(binding && binding.tabId !== activeTabId);
  const isNavAway = binding?.isNavigatedAway ?? false;
  const isBoundTabLoading = boundTab?.status === 'loading';
  const isAudible = Boolean(boundTab?.audible);
  const isMuted = Boolean(boundTab?.mutedInfo?.muted);
  const isRelaxed = densityMode === 'relaxed';
  const shortTitle = getShortTitle(bookmark.title, bookmark.url);

  const titleText = bookmark.title || bookmark.url || 'Favorite';
  const { faviconSrc, handleFaviconError, handleFaviconLoad } = useResolvedFavicon({
    pageUrl: bookmark.url,
    tab: boundTab as TabWithFaviconMeta | undefined,
    size: 48
  });

  let tooltip = `${titleText} (Double-click to reload original page)`;
  if (isActive && isNavAway) {
    tooltip = `${titleText} (Navigated away: click to reset, double-click to reload)`;
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
      {
        label: 'Duplicate Tab',
        icon: <CopyPlus className="w-3.5 h-3.5" />,
        action: () => {
          if (binding && typeof binding.tabId === 'number') {
            if (onDuplicateTab) {
              onDuplicateTab(binding.tabId);
            } else {
              chrome.tabs.duplicate(binding.tabId);
            }
          } else if (bookmark.url) {
            chrome.tabs.create({ url: bookmark.url, active: true });
          }
        }
      },
      ...(binding && onReloadTab
        ? [
            {
              label: 'Reload Tab',
              icon: <RotateCw className="w-3.5 h-3.5" />,
              action: () => onReloadTab(binding.tabId)
            }
          ]
        : []),
      ...(binding && onToggleMuteTab
        ? [
            {
              label: isMuted ? 'Unmute Tab' : 'Mute Tab',
              icon: isMuted ? (
                <Volume2 className="w-3.5 h-3.5" />
              ) : (
                <VolumeX className="w-3.5 h-3.5" />
              ),
              action: () => onToggleMuteTab(binding.tabId)
            }
          ]
        : []),
      ...(onMoveToWorkspace
        ? [
            {
              label: 'Move to Active Space',
              icon: <FolderPlus className="w-3.5 h-3.5" />,
              action: () => onMoveToWorkspace(bookmark)
            }
          ]
        : []),
      ...(onReplaceUrl
        ? [
            {
              label: 'Replace with Current URL',
              icon: <RefreshCw className="w-3.5 h-3.5" />,
              action: () => onReplaceUrl(bookmark.id)
            }
          ]
        : []),
      ...(onRenameBookmark
        ? [
            {
              label: 'Rename Tab',
              icon: <Edit2 className="w-3.5 h-3.5" />,
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
        label: 'Copy Link',
        icon: <Link2 className="w-3.5 h-3.5" />,
        action: () => {
          if (bookmark.url) navigator.clipboard.writeText(bookmark.url);
        },
        dividerBefore: true
      },
      ...(binding && onCloseTab
        ? [
            {
              label: 'Close Running Tab',
              icon: <X className="w-3.5 h-3.5" />,
              action: () => onCloseTab(binding.tabId, e),
              danger: true
            }
          ]
        : []),
      ...(onRemoveBookmark
        ? [
            {
              label: 'Remove from Quick Access',
              icon: <Trash2 className="w-3.5 h-3.5" />,
              action: () => onRemoveBookmark(bookmark.id),
              danger: true,
              dividerBefore: true
            }
          ]
        : [])
    ];

    onOpenContextMenu(e, items);
  };

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true);
    const payload = {
      type: 'quickAccess' as const,
      id: bookmark.id,
      title: bookmark.title,
      url: bookmark.url,
      parentId: bookmark.parentId,
      index: bookmark.index
    };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copyMove';
    startDragSession(payload);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDropPosition(null);
    endDragSession();
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (activeDrag?.type === 'folder') {
      if (dropPosition !== null) setDropPosition(null);
      return;
    }
    if (
      activeDrag?.id === bookmark.id &&
      (!activeDrag.ids || activeDrag.ids.length <= 1)
    ) {
      if (dropPosition !== null) setDropPosition(null);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const isLeft = e.clientX - rect.left < rect.width / 2;
    setDropPosition(isLeft ? 'left' : 'right');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropPosition(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pos =
      dropPosition || (e.clientX - rect.left < rect.width / 2 ? 'left' : 'right');
    setDropPosition(null);
    endDragSession();

    const data = parseDragPayload(e);
    if (!data || data.type === 'folder') return;
    if (data.id === bookmark.id && (!Array.isArray(data.ids) || data.ids.length <= 1)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    let targetIndex = typeof bookmark.index === 'number' ? bookmark.index : 0;
    if (pos === 'right') {
      targetIndex += 1;
    }

    if (data.type === 'quickAccess' && typeof data.id === 'string' && onReorderQuickAccess) {
      onReorderQuickAccess(data.id, targetIndex);
    } else if (
      (data.type === 'openTab' || data.type === 'bookmark' || data.type === 'quickAccess') &&
      onDropItemToQuickAccess
    ) {
      onDropItemToQuickAccess(
        data as { type: string; [key: string]: unknown },
        targetIndex
      );
    }
  };

  return (
    <button
      type="button"
      data-flip-id={`qa-${bookmark.id}`}
      title={tooltip}
      draggable={true}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={(e) => {
        if (e.detail > 1) return;
        onTileClick(bookmark);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          markKeyboardRowActivation();
        }
      }}
      onDoubleClick={(e) => {
        if (onTileDoubleClick) {
          onTileDoubleClick(bookmark, e);
        } else {
          onTileClick(bookmark);
        }
      }}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative flex flex-col items-center justify-center rounded-xl transition-[background-color,border-color,color,opacity,box-shadow] duration-150 select-none outline-none cursor-pointer ${
        isRelaxed ? 'min-h-[58px] py-2 px-1.5 gap-1.5' : 'h-12'
      } ${isDragging ? 'opacity-35' : ''} ${
        isRecentlyMoved ? 'arctic-drop-settle' : ''
      } ${dropPosition === 'left' ? 'theme-drag-over-left' : ''} ${
        dropPosition === 'right' ? 'theme-drag-over-right' : ''
      } ${
        isActive
          ? 'theme-active-card text-zinc-900 dark:text-white font-medium shadow-xs'
          : isRunningInBackground
          ? 'bg-black/[0.04] dark:bg-white/[0.07] border border-black/10 dark:border-white/10 hover:bg-black/[0.08] dark:hover:bg-white/12 text-zinc-700 dark:text-zinc-200'
          : 'bg-black/[0.02] dark:bg-white/[0.03] border border-black/5 dark:border-white/5 hover:bg-black/[0.06] dark:hover:bg-white/[0.08] hover:border-black/10 dark:hover:border-white/10 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
      }`}
    >
      {/* Quick Audio Mute / Playing Indicator Badge on Top-Right of Pinned Tile */}
      {binding && (isAudible || isMuted) && (
        <span
          role="button"
          tabIndex={0}
          title={isMuted ? 'Unmute tab' : 'Mute tab'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMuteTab?.(binding.tabId);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              e.preventDefault();
              onToggleMuteTab?.(binding.tabId);
            }
          }}
          className={`absolute top-1 right-1 z-10 w-4 h-4 rounded-full flex items-center justify-center transition-all shadow-sm ${
            isMuted
              ? 'bg-rose-500/20 text-rose-500 dark:text-rose-400 hover:bg-rose-500/30'
              : 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 hover:bg-cyan-500/35'
          }`}
        >
          {isMuted ? (
            <VolumeX className="w-2.5 h-2.5 stroke-[2.5]" />
          ) : (
            <Volume2 className="w-2.5 h-2.5 stroke-[2.5] animate-pulse" />
          )}
        </span>
      )}

      {/* Favicon or Reset Icon */}
      <div className="relative w-5 h-5 flex items-center justify-center pointer-events-none">
        {/* Reset Icon when Active and Navigated Away (on hover) */}
        {isActive && isNavAway && isHovered ? (
          <RotateCcw className="w-4 h-4 text-amber-500 dark:text-amber-300 animate-spin-reverse stroke-[2.5]" />
        ) : isBoundTabLoading ? (
          <RotateCw className="w-4 h-4 animate-spin theme-accent-text" />
        ) : faviconSrc ? (
          <img
            src={faviconSrc}
            alt=""
            onError={handleFaviconError}
            onLoad={handleFaviconLoad}
            className="w-5 h-5 object-contain rounded-[4px] drop-shadow-sm transition-transform group-hover:scale-105"
          />
        ) : (
          <Globe className="w-4 h-4 text-zinc-400 dark:text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-200" />
        )}

        {/* Small drifted dot indicator if navigated away & not hovering */}
        {isNavAway && !(isActive && isHovered) && !(isAudible || isMuted) && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-white dark:ring-[#1c1c1f]" />
        )}
      </div>

      {/* Short Name Label in Relaxed Mode */}
      {isRelaxed && (
        <span
          className={`text-[10.5px] leading-tight truncate max-w-full px-0.5 pointer-events-none ${
            isActive
              ? 'font-semibold text-zinc-900 dark:text-white'
              : 'font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white'
          }`}
        >
          {shortTitle}
        </span>
      )}

      {/* Background Tab Running Dot (bottom center) */}
      {isRunningInBackground && (
        <span className="absolute bottom-1 w-1 h-1 rounded-full bg-zinc-400/80 dark:bg-zinc-400/70 pointer-events-none" />
      )}

      {/* Active Tab Glow Bar (bottom center) */}
      {isActive && (
        <span className="absolute bottom-1 w-3 h-0.5 rounded-full theme-active-indicator pointer-events-none" />
      )}
    </button>
  );
};
