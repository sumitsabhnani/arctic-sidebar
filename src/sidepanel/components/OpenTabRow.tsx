import React, { useState } from 'react';
import {
  Globe,
  X,
  Volume2,
  VolumeX,
  Sparkles,
  FolderPlus,
  Link2,
  Check,
  RotateCw,
  CopyPlus,
  Moon,
  Edit2,
  ArrowRightLeft,
  Folder,
  Bell,
  Pin
} from 'lucide-react';
import type { SpaceItem, TabReminder } from '../../types';
import { getFaviconUrl } from '../utils/url';
import type { ContextMenuItem } from './ContextMenu';

function formatSubdomain(rawUrl?: string): string {
  if (!rawUrl || rawUrl === 'about:blank' || rawUrl.startsWith('chrome://')) return '';
  try {
    const u = new URL(rawUrl);
    let host = u.hostname.replace(/^www\./, '');
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${host}${path}`;
  } catch {
    return rawUrl;
  }
}

interface OpenTabRowProps {
  tab: chrome.tabs.Tab;
  isActive: boolean;
  spaces?: SpaceItem[];
  densityMode?: 'relaxed' | 'compact';
  onFocus: (tabId: number) => void;
  onClose: (tabId: number, e: React.MouseEvent) => void;
  onPinToQuickAccess: (tab: chrome.tabs.Tab) => void;
  onPinToWorkspace: (tab: chrome.tabs.Tab) => void;
  onPinToSpace?: (tab: chrome.tabs.Tab, targetSpaceFolderId: string) => void;
  onDuplicate: (tabId: number) => void;
  onReload: (tabId: number) => void;
  onDiscardTab?: (tabId: number) => void;
  onToggleMute: (tab: chrome.tabs.Tab) => void;
  onRenameTab?: (tabId: number, title: string) => void;
  onOpenContextMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  onMoveOpenTab?: (tabId: number, targetIndex: number) => void;
  reminder?: TabReminder;
  onOpenReminderPopover?: (target: { type: 'tab'; tabId: number; url: string; title: string }, anchorRect: DOMRect) => void;
  isEditing?: boolean;
  editTitle?: string;
  onStartRename?: () => void;
  onChangeEditTitle?: (newTitle: string) => void;
  onSaveRename?: () => void;
  onCancelRename?: () => void;
}

export const OpenTabRow: React.FC<OpenTabRowProps> = ({
  tab,
  isActive,
  spaces = [],
  densityMode = 'compact',
  onFocus,
  onClose,
  onPinToQuickAccess,
  onPinToWorkspace,
  onPinToSpace,
  onDuplicate,
  onReload,
  onDiscardTab,
  onToggleMute,
  onRenameTab,
  onOpenContextMenu,
  onMoveOpenTab,
  reminder,
  onOpenReminderPopover,
  isEditing: controlledIsEditing,
  editTitle: controlledEditTitle,
  onStartRename,
  onChangeEditTitle,
  onSaveRename,
  onCancelRename
}) => {
  const [faviconError, setFaviconError] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dropPosition, setDropPosition] = useState<'top' | 'bottom' | null>(null);
  const [localIsEditing, setLocalIsEditing] = useState(false);
  const [localEditTitle, setLocalEditTitle] = useState(tab.title || '');

  const isControlled = typeof onStartRename === 'function';
  const effectiveIsEditing = isControlled ? Boolean(controlledIsEditing) : localIsEditing;
  const effectiveEditTitle = isControlled && typeof controlledEditTitle === 'string' ? controlledEditTitle : localEditTitle;

  const tabId = tab.id;
  const isNewTab =
    !tab.url ||
    tab.url.startsWith('chrome://newtab') ||
    tab.url === 'about:blank' ||
    tab.url.includes('/newtab.html') ||
    tab.url.includes('/command.html');
  const titleText = tab.title || (isNewTab ? 'New Tab' : tab.url || 'Untitled Tab');
  const faviconSrc = tab.favIconUrl || (tab.url ? getFaviconUrl(tab.url, 32) : '');

  const isAudible = Boolean(tab.audible);
  const isMuted = Boolean(tab.mutedInfo?.muted);
  const isDiscarded = Boolean(tab.discarded);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (typeof tabId !== 'number') return;

    const items: ContextMenuItem[] = [
      {
        label: 'Pin to Quick Access',
        icon: <Sparkles className="w-3.5 h-3.5" />,
        action: () => onPinToQuickAccess(tab),
        disabled: !tab.url || isNewTab
      },
      {
        label: 'Pin to Active Space',
        icon: <FolderPlus className="w-3.5 h-3.5" />,
        action: () => onPinToWorkspace(tab),
        disabled: !tab.url || isNewTab
      },
      ...(onPinToSpace && spaces.length > 0 && tab.url && !isNewTab
        ? [
            {
              label: 'Move to Space',
              icon: <ArrowRightLeft className="w-3.5 h-3.5" />,
              submenu: spaces.map((sp) => ({
                label: sp.name,
                icon: <Folder className="w-3.5 h-3.5" />,
                action: () => onPinToSpace(tab, sp.folderId)
              }))
            }
          ]
        : []),
      ...(!isActive && !isDiscarded && onDiscardTab
        ? [
            {
              label: 'Hibernate Tab (Save RAM)',
              icon: <Moon className="w-3.5 h-3.5" />,
              action: () => onDiscardTab(tabId)
            }
          ]
        : []),
      {
        label: 'Copy Link',
        icon: <Link2 className="w-3.5 h-3.5" />,
        action: () => {
          if (tab.url) navigator.clipboard.writeText(tab.url);
        },
        disabled: !tab.url || isNewTab,
        dividerBefore: true
      },
      {
        label: 'Reload Tab',
        icon: <RotateCw className="w-3.5 h-3.5" />,
        action: () => onReload(tabId)
      },
      {
        label: isMuted ? 'Unmute Tab' : 'Mute Tab',
        icon: isMuted ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />,
        action: () => onToggleMute(tab)
      },
      {
        label: 'Duplicate Tab',
        icon: <CopyPlus className="w-3.5 h-3.5" />,
        action: () => onDuplicate(tabId)
      },
      ...(onRenameTab && typeof tabId === 'number'
        ? [
            {
              label: 'Rename Tab',
              icon: <Edit2 className="w-3.5 h-3.5" />,
              action: () => {
                if (onStartRename) {
                  onStartRename();
                } else {
                  setLocalEditTitle(tab.title || '');
                  setLocalIsEditing(true);
                }
              }
            }
          ]
        : []),
      {
        label: 'Close Tab',
        icon: <X className="w-3.5 h-3.5" />,
        action: () => onClose(tabId, e),
        danger: true,
        dividerBefore: true
      }
    ];

    onOpenContextMenu(e, items);
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (typeof tabId !== 'number') return;
    setIsDragging(true);
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: 'openTab',
        tabId,
        url: tab.url,
        title: tab.title,
        index: tab.index
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

      if (data.type === 'openTab' && data.tabId !== tabId && onMoveOpenTab) {
        let targetIndex = tab.index;
        if (pos === 'bottom') {
          targetIndex += 1;
        }
        onMoveOpenTab(data.tabId, targetIndex);
      }
    } catch {
      // ignore
    }
  };

  if (effectiveIsEditing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (onSaveRename) {
            onSaveRename();
          } else {
            const trimmed = effectiveEditTitle.trim();
            if (trimmed && onRenameTab && typeof tabId === 'number') {
              onRenameTab(tabId, trimmed);
            }
            setLocalIsEditing(false);
          }
        }}
        className="flex items-center h-[34px] px-2.5 my-[1px] space-x-1.5 bg-zinc-200/50 dark:bg-white/[0.06] rounded-lg border border-cyan-500/60"
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
                setLocalEditTitle(tab.title || '');
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
              setLocalEditTitle(tab.title || '');
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
      draggable={Boolean(tab.url && !isNewTab)}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      title={`${titleText}\n${tab.url || ''}${isDiscarded ? '\n(Sleeping to save memory - click to wake)' : ''}`}
      onClick={() => tabId && onFocus(tabId)}
      onContextMenu={handleContextMenu}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && tabId) {
          e.preventDefault();
          onFocus(tabId);
        }
      }}
      className={`group relative flex items-center justify-between ${
        densityMode === 'relaxed'
          ? 'min-h-[46px] py-1.5 px-2.5 my-1 rounded-xl border transition-all duration-150'
          : 'h-[34px] px-2.5 my-[1px] rounded-lg'
      } cursor-pointer select-none outline-none ${
        isDragging ? 'opacity-40 scale-98' : ''
      } ${
        dropPosition === 'top'
          ? 'theme-drag-over-top'
          : dropPosition === 'bottom'
          ? 'theme-drag-over-bottom'
          : ''
      } ${
        isActive
          ? densityMode === 'relaxed'
            ? 'theme-active-card border-cyan-500/50 dark:border-cyan-400/50 shadow-xs text-zinc-900 dark:text-white font-medium'
            : 'theme-active-card text-zinc-900 dark:text-white font-medium'
          : densityMode === 'relaxed'
          ? isDiscarded
            ? 'bg-white/40 dark:bg-white/[0.02] border-black/[0.04] dark:border-white/[0.04] text-zinc-400 dark:text-zinc-500 hover:bg-black/5 dark:hover:bg-white/5'
            : 'bg-white/70 dark:bg-zinc-900/40 border-black/[0.06] dark:border-white/[0.06] hover:border-black/15 dark:hover:border-white/12 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
          : isDiscarded
          ? 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5'
          : 'text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'
      }`}
    >
      {/* Left: Favicon & Title */}
      <div className="flex items-center min-w-0 flex-1 space-x-2 mr-2">
        <div className="relative flex-shrink-0 w-4 h-4 flex items-center justify-center">
          {!faviconError && faviconSrc ? (
            <img
              src={faviconSrc}
              alt=""
              onError={() => setFaviconError(true)}
              className={`w-4 h-4 object-contain rounded-sm transition-opacity ${
                isDiscarded ? 'opacity-60 grayscale' : 'opacity-100'
              }`}
            />
          ) : (
            <Globe className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-400" />
          )}

          {/* Sleep icon overlay on favicon if hibernated */}
          {isDiscarded && (
            <Moon className="absolute -bottom-1 -right-1 w-2.5 h-2.5 text-indigo-400 fill-indigo-400/30" />
          )}
        </div>

        {/* Title + Subdomain details */}
        <div
          className="flex flex-col min-w-0 flex-1 justify-center py-0.5"
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (onStartRename) {
              onStartRename();
            } else {
              setLocalEditTitle(tab.title || '');
              setLocalIsEditing(true);
            }
          }}
        >
          <div className="flex items-center space-x-1.5 min-w-0">
            <span
              title={titleText}
              className={`truncate text-[12.5px] leading-tight transition-colors duration-150 select-none ${
                isActive
                  ? 'font-semibold text-zinc-900 dark:text-white'
                  : isDiscarded
                  ? 'text-zinc-400 italic'
                  : 'text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white'
              }`}
            >
              {titleText}
            </span>
            {isActive && densityMode === 'relaxed' && (
              <span className="px-1.5 py-0.2 rounded text-[9.5px] font-semibold bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 flex-shrink-0">
                Active
              </span>
            )}
          </div>
          {densityMode === 'relaxed' && tab.url && !isNewTab && (
            <span className="truncate text-[10px] text-zinc-400 dark:text-zinc-500 leading-none select-none pt-0.5 font-mono">
              {formatSubdomain(tab.url)}
            </span>
          )}
        </div>
      </div>

      {/* Right: Audio Indicator, Pin Button, Reminder, & Close Button */}
      <div className="flex items-center space-x-1 flex-shrink-0">
        {/* Audio status */}
        {(isAudible || isMuted) && (
          <button
            type="button"
            data-tooltip={isMuted ? 'Tab is muted (Click to unmute)' : 'Tab is playing audio (Click to mute)'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleMute(tab);
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

        {/* Quick Pin to Bookmarks Button (visible on hover) */}
        {!isNewTab && (
          <button
            type="button"
            data-tooltip="Pin to Bookmarks"
            data-tooltip-pos="bottom-right"
            onClick={(e) => {
              e.stopPropagation();
              onPinToWorkspace(tab);
            }}
            className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full text-zinc-400 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-500/10 transition-all duration-100"
          >
            <Pin className="w-3 h-3 stroke-[2.2]" />
          </button>
        )}

        {/* Tab Reminder Bell Icon */}
        {onOpenReminderPopover && typeof tabId === 'number' && !isNewTab && (
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
                  type: 'tab',
                  tabId,
                  url: tab.url || '',
                  title: tab.title || ''
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

        {/* Close Button on hover */}
        {typeof tabId === 'number' && (
          <button
            type="button"
            data-tooltip="Close tab (Cmd+W)"
            onClick={(e) => onClose(tabId, e)}
            className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full text-zinc-500 dark:text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all duration-100"
          >
            <X className="w-3 h-3 stroke-[2.5]" />
          </button>
        )}
      </div>
    </div>
  );
};
