import React, { useState } from 'react';
import { Globe, RotateCcw, X, ExternalLink, Copy, Trash2, Sparkles } from 'lucide-react';
import type { TabBinding } from '../../types';
import { getFaviconUrl } from '../utils/url';
import type { ContextMenuItem } from './ContextMenu';

interface BookmarkRowProps {
  bookmark: chrome.bookmarks.BookmarkTreeNode;
  depth?: number;
  binding?: TabBinding;
  isActive: boolean;
  onRowClick: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onFaviconClick: (bookmark: chrome.bookmarks.BookmarkTreeNode, e: React.MouseEvent) => void;
  onCloseTab: (tabId: number, e: React.MouseEvent) => void;
  onOpenContextMenu?: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  onDeleteBookmark?: (id: string) => void;
  onMoveToQuickAccess?: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
}

export const BookmarkRow: React.FC<BookmarkRowProps> = ({
  bookmark,
  depth = 0,
  binding,
  isActive,
  onRowClick,
  onFaviconClick,
  onCloseTab,
  onOpenContextMenu,
  onDeleteBookmark,
  onMoveToQuickAccess
}) => {
  const [faviconError, setFaviconError] = useState(false);
  const [isHoveringFavicon, setIsHoveringFavicon] = useState(false);

  const isNavAway = binding?.isNavigatedAway ?? false;
  const isRunning = Boolean(binding);
  const titleText = bookmark.title || bookmark.url || 'Untitled Bookmark';

  // Tooltip showing bookmark title and drifted state
  const tooltip = isNavAway && binding
    ? `${titleText}\n↳ Current: ${binding.currentTitle || binding.currentUrl}\n(Click favicon to reset to bookmark)`
    : `${titleText}\n${bookmark.url || ''}`;

  const faviconSrc = bookmark.url ? getFaviconUrl(bookmark.url, 32) : '';

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
      ...(onMoveToQuickAccess
        ? [
            {
              label: 'Pin to Quick Access',
              icon: <Sparkles className="w-3.5 h-3.5 text-cyan-400" />,
              action: () => onMoveToQuickAccess(bookmark)
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

  return (
    <div
      role="button"
      tabIndex={0}
      title={tooltip}
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
        isActive
          ? 'bg-white/15 text-white font-medium shadow-[0_1px_3px_rgba(0,0,0,0.3)] backdrop-blur-md'
          : isRunning
          ? 'text-zinc-200 hover:bg-white/10'
          : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
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
          {/* Main Favicon Image or Fallback */}
          {!faviconError && faviconSrc ? (
            <img
              src={faviconSrc}
              alt=""
              onError={() => setFaviconError(true)}
              className={`w-4 h-4 object-contain rounded-sm transition-opacity duration-150 ${
                isNavAway && isHoveringFavicon ? 'opacity-0' : 'opacity-100'
              }`}
            />
          ) : (
            <Globe
              className={`w-3.5 h-3.5 text-zinc-400 transition-opacity duration-150 ${
                isNavAway && isHoveringFavicon ? 'opacity-0' : 'opacity-100'
              }`}
            />
          )}

          {/* Reset Icon Overlay on Favicon Hover when Navigated Away */}
          {isNavAway && (
            <div
              className={`absolute inset-0 flex items-center justify-center rounded-sm transition-all duration-150 ${
                isHoveringFavicon
                  ? 'opacity-100 scale-105 bg-amber-400/20 text-amber-300'
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
              ? 'italic text-amber-200/90 font-normal'
              : isActive
              ? 'text-white'
              : isRunning
              ? 'text-zinc-200'
              : 'text-zinc-400 group-hover:text-zinc-200'
          }`}
        >
          {titleText}
        </span>
      </div>

      {/* Right: Status Indicator / Close Tab Action */}
      <div className="flex items-center flex-shrink-0 ml-1">
        {isRunning && (
          <>
            {/* Background running dot (hidden on hover when X appears) */}
            <div
              className={`w-1.5 h-1.5 rounded-full transition-opacity duration-150 ${
                isActive
                  ? 'bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.8)]'
                  : 'bg-zinc-400/70 group-hover:opacity-0'
              }`}
            />

            {/* Close tab button (appears on group hover) */}
            <button
              type="button"
              title="Close running tab"
              onClick={(e) => binding && onCloseTab(binding.tabId, e)}
              className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-zinc-400 hover:text-white hover:bg-white/20 transition-all duration-100"
            >
              <X className="w-3 h-3 stroke-[2.5]" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
