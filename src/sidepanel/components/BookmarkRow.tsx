import React, { useState } from 'react';
import {
  Globe,
  RotateCcw,
  RotateCw,
  CopyPlus,
  X,
  ExternalLink,
  Link2,
  Check,
  Trash2,
  Sparkles,
  Moon,
  RefreshCw,
  Edit2,
  Volume2,
  VolumeX,
  ArrowRightLeft,
  Folder,
  Bell,
  PinOff
} from 'lucide-react';
import type { TabBinding, SpaceItem, TabReminder } from '../../types';
import { getFaviconUrl } from '../utils/url';
import type { ContextMenuItem } from './ContextMenu';

function formatSubdomain(rawUrl?: string): string {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    let host = u.hostname.replace(/^www\./, '');
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${host}${path}`;
  } catch {
    return rawUrl;
  }
}

interface BookmarkRowProps {
  bookmark: chrome.bookmarks.BookmarkTreeNode;
  depth?: number;
  binding?: TabBinding;
  boundTab?: chrome.tabs.Tab;
  isActive: boolean;
  isDiscarded?: boolean;
  spaces?: SpaceItem[];
  activeSpaceId?: string;
  densityMode?: 'relaxed' | 'compact';
  onRowClick: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onFaviconClick: (bookmark: chrome.bookmarks.BookmarkTreeNode, e: React.MouseEvent) => void;
  onFaviconDoubleClick?: (bookmark: chrome.bookmarks.BookmarkTreeNode, e: React.MouseEvent) => void;
  onCloseTab: (tabId: number, e: React.MouseEvent) => void;
  onReloadTab?: (tabId: number) => void;
  onDuplicateTab?: (tabId: number) => void;
  onDiscardTab?: (tabId: number) => void;
  onToggleMuteTab?: (tabOrId: chrome.tabs.Tab | number) => void;
  onMoveToSpace?: (nodeId: string, targetSpaceFolderId: string) => void;
  onRenameBookmark?: (id: string, title: string) => void;
  onReplaceUrl?: (bookmarkId: string) => void;
  onOpenContextMenu?: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  onDeleteBookmark?: (id: string) => void;
  onUnpinBookmark?: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onMoveToQuickAccess?: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onMoveBookmarkToIndex?: (draggedId: string, targetParentId: string, targetIndex?: number) => void;
  onDropItemToFolder?: (data: { type: string; [key: string]: unknown }, targetFolderId: string, targetIndex?: number) => void;
  reminder?: TabReminder;
  onOpenReminderPopover?: (target: { type: 'bookmark'; bookmarkId: string; url: string; title: string }, anchorRect: DOMRect) => void;
  isEditing?: boolean;
  editTitle?: string;
  onStartRename?: () => void;
  onChangeEditTitle?: (newTitle: string) => void;
  onSaveRename?: () => void;
  onCancelRename?: () => void;
}

export const BookmarkRow: React.FC<BookmarkRowProps> = ({
  bookmark,
  depth = 0,
  binding,
  boundTab,
  isActive,
  isDiscarded = false,
  spaces = [],
  activeSpaceId,
  onRowClick,
  onFaviconClick,
  onFaviconDoubleClick,
  onCloseTab,
  onReloadTab,
  onDuplicateTab,
  onDiscardTab,
  onToggleMuteTab,
  onMoveToSpace,
  onRenameBookmark,
  onReplaceUrl,
  onOpenContextMenu,
  onDeleteBookmark,
  onUnpinBookmark,
  onMoveToQuickAccess,
  onMoveBookmarkToIndex,
  onDropItemToFolder,
  reminder,
  onOpenReminderPopover,
  densityMode = 'compact',
  isEditing: controlledIsEditing,
  editTitle: controlledEditTitle,
  onStartRename,
  onChangeEditTitle,
  onSaveRename,
  onCancelRename
}) => {
  const [faviconError, setFaviconError] = useState(false);
  const [isHoveringFavicon, setIsHoveringFavicon] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dropPosition, setDropPosition] = useState<'top' | 'bottom' | null>(null);
  const [localIsEditing, setLocalIsEditing] = useState(false);
  const [localEditTitle, setLocalEditTitle] = useState(bookmark.title || '');

  const isControlled = typeof onStartRename === 'function';
  const effectiveIsEditing = isControlled ? Boolean(controlledIsEditing) : localIsEditing;
  const effectiveEditTitle = isControlled && typeof controlledEditTitle === 'string' ? controlledEditTitle : localEditTitle;

  const isNavAway = binding?.isNavigatedAway ?? false;
  const isRunning = Boolean(binding);
  const isAudible = Boolean(boundTab?.audible);
  const isMuted = Boolean(boundTab?.mutedInfo?.muted);
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

  const otherSpaces = spaces.filter((s) => s.id !== activeSpaceId);

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
      ...(isRunning && binding && onReloadTab
        ? [
            {
              label: 'Reload Tab',
              icon: <RotateCw className="w-3.5 h-3.5" />,
              action: () => onReloadTab(binding.tabId)
            }
          ]
        : []),
      ...(isRunning && binding && onToggleMuteTab
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
      ...(onReplaceUrl && bookmark.url
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
                if (onStartRename) {
                  onStartRename();
                } else {
                  setLocalEditTitle(bookmark.title || '');
                  setLocalIsEditing(true);
                }
              }
            }
          ]
        : []),
      ...(onMoveToQuickAccess
        ? [
            {
              label: 'Pin to Quick Access',
              icon: <Sparkles className="w-3.5 h-3.5" />,
              action: () => onMoveToQuickAccess(bookmark)
            }
          ]
        : []),
      ...(onUnpinBookmark
        ? [
            {
              label: "Unpin to Today's Tabs",
              icon: <PinOff className="w-3.5 h-3.5" />,
              action: () => onUnpinBookmark(bookmark)
            }
          ]
        : []),
      ...(onMoveToSpace && otherSpaces.length > 0
        ? [
            {
              label: 'Move to Space',
              icon: <ArrowRightLeft className="w-3.5 h-3.5" />,
              submenu: otherSpaces.map((sp) => ({
                label: sp.name,
                icon: <Folder className="w-3.5 h-3.5" />,
                action: () => onMoveToSpace(bookmark.id, sp.folderId)
              }))
            }
          ]
        : []),
      ...(!isActive && isRunning && binding && !isDiscarded && onDiscardTab
        ? [
            {
              label: 'Hibernate Tab (Save RAM)',
              icon: <Moon className="w-3.5 h-3.5" />,
              action: () => onDiscardTab(binding.tabId)
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
      ...(isRunning && binding
        ? [
            {
              label: 'Close Running Tab',
              icon: <X className="w-3.5 h-3.5" />,
              action: () => onCloseTab(binding.tabId, e),
              danger: true
            }
          ]
        : []),
      ...(onDeleteBookmark
        ? [
            {
              label: 'Delete Bookmark',
              icon: <Trash2 className="w-3.5 h-3.5" />,
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
      if (!targetParentId) return;

      let targetIndex = typeof bookmark.index === 'number' ? bookmark.index : 0;
      if (pos === 'bottom') {
        targetIndex += 1;
      }

      if (data.type === 'openTab' && onDropItemToFolder) {
        onDropItemToFolder(data, targetParentId, targetIndex);
      } else if (onMoveBookmarkToIndex && data.id) {
        onMoveBookmarkToIndex(data.id, targetParentId, targetIndex);
      }
    } catch {
      // ignore
    }
  };

  if (effectiveIsEditing) {
    return (
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (onSaveRename) {
            onSaveRename();
          } else {
            const trimmed = effectiveEditTitle.trim();
            if (trimmed && onRenameBookmark) {
              await onRenameBookmark(bookmark.id, trimmed);
            }
            setLocalIsEditing(false);
          }
        }}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        className="flex items-center h-[34px] pr-2 my-[1px] space-x-1.5 bg-zinc-200/50 dark:bg-white/[0.06] rounded-lg border border-cyan-500/60"
      >
        <input
          type="text"
          value={effectiveEditTitle}
          onChange={(e) => {
            if (onChangeEditTitle) {
              onChangeEditTitle(e.target.value);
            } else {
              setLocalEditTitle(e.target.value);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (onCancelRename) {
                onCancelRename();
              } else {
                setLocalIsEditing(false);
                setLocalEditTitle(bookmark.title || '');
              }
            }
          }}
          autoFocus
          onFocus={(e) => e.target.select()}
          className="flex-1 bg-transparent px-1.5 py-0.5 text-xs text-zinc-900 dark:text-white focus:outline-none"
        />
        <button
          type="submit"
          title="Save Title"
          onMouseDown={(e) => e.preventDefault()}
          className="p-1 rounded text-emerald-500 hover:bg-emerald-500/20"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Cancel"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (onCancelRename) {
              onCancelRename();
            } else {
              setLocalIsEditing(false);
              setLocalEditTitle(bookmark.title || '');
            }
          }}
          className="p-1 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </form>
    );
  }

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
      className={`group relative flex items-center justify-between ${
        densityMode === 'relaxed' ? 'min-h-[38px] py-1.5' : 'h-[34px]'
      } pr-2.5 my-0 cursor-pointer select-none transition-all duration-150 outline-none ${
        isDragging ? 'opacity-40 scale-98' : ''
      } ${
        dropPosition === 'top'
          ? 'theme-drag-over-top'
          : dropPosition === 'bottom'
          ? 'theme-drag-over-bottom'
          : ''
      } ${
        isActive
          ? 'theme-active-card text-zinc-900 dark:text-white font-medium'
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
          title={isNavAway ? 'Reset tab to bookmarked URL (Double-click to reload)' : `${titleText} (Double-click to reload original page)`}
          onClick={(e) => onFaviconClick(bookmark, e)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onFaviconDoubleClick?.(bookmark, e);
          }}
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

        {/* Title / Description (Double-click to rename) & Subdomain Subtitle */}
        <div
          className="flex flex-col min-w-0 flex-1 justify-center py-0.5"
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (onStartRename) {
              onStartRename();
            } else {
              setLocalEditTitle(bookmark.title || '');
              setLocalIsEditing(true);
            }
          }}
        >
          <span
            title={tooltip}
            className={`truncate text-[12.5px] leading-tight transition-colors duration-150 select-none ${
              isNavAway
                ? 'italic text-amber-600 dark:text-amber-200/90 font-normal'
                : isActive
                ? 'font-semibold text-zinc-900 dark:text-white'
                : isRunning
                ? 'font-medium text-zinc-800 dark:text-zinc-200'
                : 'text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-zinc-100'
            }`}
          >
            {titleText}
          </span>
          {densityMode === 'relaxed' && bookmark.url && (
            <span className="truncate text-[10px] text-zinc-400 dark:text-zinc-500 leading-none select-none pt-0.5 font-mono">
              {formatSubdomain(bookmark.url)}
            </span>
          )}
        </div>
      </div>

      {/* Right: Audio Mute Indicator, Split View, Copy Link, Reload, & Status */}
      <div className="flex items-center space-x-1 flex-shrink-0 ml-1">
        {/* Quick Audio Mute Indicator on Pinned Bookmark Tab */}
        {isRunning && binding && (isAudible || isMuted) && (
          <button
            type="button"
            data-tooltip={isMuted ? 'Tab is muted (Click to unmute)' : 'Tab is playing audio (Click to mute)'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleMuteTab?.(binding.tabId);
            }}
            className={`flex items-center justify-center w-5 h-5 rounded-full transition-colors ${
              isMuted
                ? 'text-rose-500 dark:text-rose-400 bg-rose-500/15 hover:bg-rose-500/25'
                : 'text-cyan-500 dark:text-cyan-400 bg-cyan-500/15 hover:bg-cyan-500/25'
            }`}
          >
            {isMuted ? (
              <VolumeX className="w-3 h-3 stroke-[2.5]" />
            ) : (
              <Volume2 className="w-3 h-3 stroke-[2.5] animate-pulse" />
            )}
          </button>
        )}

        {/* Unpin Bookmark to Today's Tabs Button (on hover) */}
        {onUnpinBookmark && (
          <button
            type="button"
            data-tooltip="Unpin to Today's Tabs (Removes bookmark)"
            data-tooltip-pos="bottom-right"
            onClick={(e) => {
              e.stopPropagation();
              onUnpinBookmark(bookmark);
            }}
            className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full text-zinc-400 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-500/10 transition-all duration-100"
          >
            <PinOff className="w-3 h-3 stroke-[2.2]" />
          </button>
        )}

        {/* Reload Tab Button (visible on hover, only for open/running tabs) */}
        {isRunning && binding && typeof binding.tabId === 'number' && (
          <button
            type="button"
            data-tooltip="Reload tab"
            data-tooltip-pos="bottom-right"
            onClick={(e) => {
              e.stopPropagation();
              if (onReloadTab) {
                onReloadTab(binding.tabId);
              }
            }}
            className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-100"
          >
            <RotateCw className="w-3 h-3 stroke-[2.2]" />
          </button>
        )}

        {/* Tab Reminder Bell Icon */}
        {onOpenReminderPopover && bookmark.url && (
          <button
            type="button"
            data-tooltip={
              reminder
                ? reminder.status === 'fired' || reminder.triggerAt <= Date.now()
                  ? `Overdue Reminder: ${reminder.note || 'Check tab'}`
                  : `Reminder at ${new Date(reminder.triggerAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${reminder.note || 'Check tab'}`
                : 'Set reminder'
            }
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              onOpenReminderPopover(
                {
                  type: 'bookmark',
                  bookmarkId: bookmark.id,
                  url: bookmark.url || '',
                  title: bookmark.title || ''
                },
                rect
              );
            }}
            className={`items-center justify-center w-5 h-5 rounded-full transition-all duration-100 ${
              reminder
                ? reminder.status === 'fired' || reminder.triggerAt <= Date.now()
                  ? 'flex text-rose-500 bg-rose-500/15 animate-pulse'
                  : 'flex text-amber-500 dark:text-amber-400 bg-amber-500/10'
                : 'hidden group-hover:flex text-zinc-400 hover:text-amber-500 hover:bg-amber-500/10'
            }`}
          >
            <Bell className="w-3 h-3 stroke-[2.5]" />
          </button>
        )}

        {/* Running status / close tab button */}
        {isRunning && (
          <>
            <div
              className={`w-1.5 h-1.5 rounded-full transition-opacity duration-150 ${
                isActive
                  ? 'theme-active-indicator'
                  : 'bg-zinc-400 dark:bg-zinc-400/70 group-hover:opacity-0'
              }`}
            />

            <button
              type="button"
              data-tooltip="Close running tab"
              onClick={(e) => binding && onCloseTab(binding.tabId, e)}
              className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full text-zinc-500 dark:text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all duration-100"
            >
              <X className="w-3 h-3 stroke-[2.5]" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
