import React, { useState } from 'react';
import {
  Globe,
  RotateCcw,
  RotateCw,
  X,
  ExternalLink,
  Copy,
  Check,
  Trash2,
  Sparkles,
  Moon,
  RefreshCw
} from 'lucide-react';
import type { TabBinding } from '../../types';
import { getFaviconUrl } from '../utils/url';
import type { ContextMenuItem } from './ContextMenu';

interface BookmarkRowProps {
  bookmark: chrome.bookmarks.BookmarkTreeNode;
  depth?: number;
  binding?: TabBinding;
  isActive: boolean;
  isDiscarded?: boolean;
  onRowClick: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onFaviconClick: (bookmark: chrome.bookmarks.BookmarkTreeNode, e: React.MouseEvent) => void;
  onCloseTab: (tabId: number, e: React.MouseEvent) => void;
  onReloadTab?: (tabId: number) => void;
  onDiscardTab?: (tabId: number) => void;
  onReplaceUrl?: (bookmarkId: string) => void;
  onOpenContextMenu?: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  onDeleteBookmark?: (id: string) => void;
  onMoveToQuickAccess?: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onMoveBookmarkToIndex?: (draggedId: string, targetParentId: string, targetIndex?: number) => void;
}

export const BookmarkRow: React.FC<BookmarkRowProps> = ({
  bookmark,
  depth = 0,
  binding,
  isActive,
  isDiscarded = false,
  onRowClick,
  onFaviconClick,
  onCloseTab,
  onReloadTab,
  onDiscardTab,
  onReplaceUrl,
  onOpenContextMenu,
  onDeleteBookmark,
  onMoveToQuickAccess,
  onMoveBookmarkToIndex
}) => {
  const [faviconError, setFaviconError] = useState(false);
  const [isHoveringFavicon, setIsHoveringFavicon] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dropPosition, setDropPosition] = useState<'top' | 'bottom' | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const isNavAway = binding?.isNavigatedAway ?? false;
  const isRunning = Boolean(binding);
  const titleText = bookmark.title || bookmark.url || 'Untitled Bookmark';

  let tooltip = titleText;
  if (isNavAway && binding) {
    tooltip = `${titleText}\n↳ Current: ${binding.currentTitle || binding.currentUrl}\n(Click favicon to reset to bookmark)`;
  } else if (bookmark.url) {
    tooltip = `${titleText}\n${bookmark.url}`;
  }
  if (isDiscarded) {
    tooltip += '\n(Sleeping to save memory - click to wake)';
  }

  const faviconSrc = bookmark.url ? getFaviconUrl(bookmark.url, 32) : '';

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (bookmark.url) {
      navigator.clipboard.writeText(bookmark.url);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1500);
    }
  };

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
      ...(onReplaceUrl && bookmark.url
        ? [
            {
              label: 'Replace with Current Page URL',
              icon: <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />,
              action: () => onReplaceUrl(bookmark.id)
            }
          ]
        : []),
      ...(onMoveToQuickAccess
        ? [
            {
              label: 'Pin to Quick Access',
              icon: <Sparkles className="w-3.5 h-3.5 text-cyan-400" />,
              action: () => onMoveToQuickAccess(bookmark)
            }
          ]
        : []),
      ...(!isActive && isRunning && binding && !isDiscarded && onDiscardTab
        ? [
            {
              label: 'Hibernate Tab (Save RAM)',
              icon: <Moon className="w-3.5 h-3.5 text-indigo-400" />,
              action: () => onDiscardTab(binding.tabId)
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
      ...(isRunning && binding
        ? [
            {
              label: 'Close Running Tab',
              icon: <X className="w-3.5 h-3.5 text-rose-400" />,
              action: () => onCloseTab(binding.tabId, e),
              danger: true
            }
          ]
        : []),
      ...(onDeleteBookmark
        ? [
            {
              label: 'Delete Bookmark',
              icon: <Trash2 className="w-3.5 h-3.5 text-rose-400" />,
              action: () => onDeleteBookmark(bookmark.id),
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
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: 'bookmark',
        id: bookmark.id,
        title: bookmark.title,
        url: bookmark.url,
        parentId: bookmark.parentId,
        index: bookmark.index
      })
    );
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const isTop = e.clientY - rect.top < rect.height / 2;
    setDropPosition(isTop ? 'top' : 'bottom');
  };

  const handleDragLeave = () => {
    setDropPosition(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = dropPosition;
    setDropPosition(null);

    try {
      const dataStr = e.dataTransfer.getData('application/json');
      if (!dataStr) return;
      const data = JSON.parse(dataStr);

      if (data.id === bookmark.id) return;

      const targetParentId = bookmark.parentId;
      if (!targetParentId || !onMoveBookmarkToIndex) return;

      let targetIndex = typeof bookmark.index === 'number' ? bookmark.index : 0;
      if (pos === 'bottom') {
        targetIndex += 1;
      }

      onMoveBookmarkToIndex(data.id, targetParentId, targetIndex);
    } catch {
      // ignore
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      title={tooltip}
      draggable={true}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => onRowClick(bookmark)}
      onContextMenu={handleContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onRowClick(bookmark);
        }
      }}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
      className={`group relative flex items-center justify-between h-[34px] pr-2.5 my-[1px] rounded-lg cursor-pointer select-none transition-all duration-150 outline-none ${
        isDragging ? 'opacity-40 scale-98' : ''
      } ${
        dropPosition === 'top'
          ? 'border-t-2 border-cyan-400 bg-cyan-500/10'
          : dropPosition === 'bottom'
          ? 'border-b-2 border-cyan-400 bg-cyan-500/10'
          : ''
      } ${
        isActive
          ? 'bg-black/10 dark:bg-white/15 text-zinc-900 dark:text-white font-medium shadow-[0_1px_3px_rgba(0,0,0,0.1)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] backdrop-blur-md'
          : isRunning
          ? 'text-zinc-800 dark:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10'
          : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5'
      }`}
    >
      {/* Left: Favicon & Title */}
      <div className="flex items-center min-w-0 flex-1 space-x-2 mr-2">
        {/* Favicon Button Container with Reset Overlay */}
        <div
          role="button"
          tabIndex={0}
          title={isNavAway ? 'Reset tab to bookmarked URL' : titleText}
          onClick={(e) => onFaviconClick(bookmark, e)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onFaviconClick(bookmark, e as unknown as React.MouseEvent);
            }
          }}
          onMouseEnter={() => setIsHoveringFavicon(true)}
          onMouseLeave={() => setIsHoveringFavicon(false)}
          className="relative flex-shrink-0 w-4 h-4 flex items-center justify-center rounded transition-transform active:scale-90"
        >
          {!faviconError && faviconSrc ? (
            <img
              src={faviconSrc}
              alt=""
              onError={() => setFaviconError(true)}
              className={`w-4 h-4 object-contain rounded-sm transition-opacity duration-150 ${
                isNavAway && isHoveringFavicon ? 'opacity-0' : 'opacity-100'
              } ${isDiscarded ? 'opacity-60 grayscale' : ''}`}
            />
          ) : (
            <Globe
              className={`w-3.5 h-3.5 text-zinc-400 transition-opacity duration-150 ${
                isNavAway && isHoveringFavicon ? 'opacity-0' : 'opacity-100'
              }`}
            />
          )}

          {/* Sleep icon overlay on favicon if hibernated */}
          {isDiscarded && (
            <Moon className="absolute -bottom-1 -right-1 w-2.5 h-2.5 text-indigo-400 fill-indigo-400/30" />
          )}

          {/* Reset Icon Overlay on Favicon Hover when Navigated Away */}
          {isNavAway && (
            <div
              className={`absolute inset-0 flex items-center justify-center rounded-sm transition-all duration-150 ${
                isHoveringFavicon
                  ? 'opacity-100 scale-105 bg-amber-400/20 text-amber-500 dark:text-amber-300'
                  : 'opacity-0 scale-95 text-transparent'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5 stroke-[2.5]" />
            </div>
          )}
        </div>

        {/* Title / Description */}
        <span
          className={`truncate text-[13px] leading-tight transition-colors duration-150 ${
            isNavAway
              ? 'italic text-amber-600 dark:text-amber-200/90 font-normal'
              : isActive
              ? 'text-zinc-900 dark:text-white'
              : isRunning
              ? 'text-zinc-800 dark:text-zinc-200'
              : 'text-zinc-600 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-200'
          }`}
        >
          {titleText}
        </span>
      </div>

      {/* Right: Actions on hover & Status Indicator */}
      <div className="flex items-center space-x-1 flex-shrink-0 ml-1">
        {/* Copy Link Button on hover */}
        {bookmark.url && (
          <button
            type="button"
            title={isCopied ? 'Copied link!' : 'Copy link'}
            onClick={handleCopyLink}
            className={`hidden group-hover:flex items-center justify-center w-4 h-4 rounded transition-all duration-100 ${
              isCopied
                ? 'text-emerald-500 bg-emerald-500/10'
                : 'text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/20'
            }`}
          >
            {isCopied ? <Check className="w-3 h-3 stroke-[2.5]" /> : <Copy className="w-3 h-3" />}
          </button>
        )}

        {/* Reload button for active tab on hover */}
        {isActive && onReloadTab && binding && (
          <button
            type="button"
            title="Reload this page (Cmd+R)"
            onClick={(e) => {
              e.stopPropagation();
              onReloadTab(binding.tabId);
            }}
            className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/20 transition-all duration-100"
          >
            <RotateCw className="w-3 h-3" />
          </button>
        )}

        {/* Running status / close tab button */}
        {isRunning && (
          <>
            <div
              className={`w-1.5 h-1.5 rounded-full transition-opacity duration-150 ${
                isActive
                  ? 'bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.8)]'
                  : 'bg-zinc-400 dark:bg-zinc-400/70 group-hover:opacity-0'
              }`}
            />

            <button
              type="button"
              title="Close running tab"
              onClick={(e) => binding && onCloseTab(binding.tabId, e)}
              className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-zinc-400 hover:text-rose-500 hover:bg-black/5 dark:hover:bg-white/20 transition-all duration-100"
            >
              <X className="w-3 h-3 stroke-[2.5]" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
