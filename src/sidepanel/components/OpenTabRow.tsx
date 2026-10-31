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
  Folder
} from 'lucide-react';
import type { SpaceItem } from '../../types';
import { getFaviconUrl } from '../utils/url';
import type { ContextMenuItem } from './ContextMenu';

interface OpenTabRowProps {
  tab: chrome.tabs.Tab;
  isActive: boolean;
  spaces?: SpaceItem[];
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
}

export const OpenTabRow: React.FC<OpenTabRowProps> = ({
  tab,
  isActive,
  spaces = [],
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
  onMoveOpenTab
}) => {
  const [faviconError, setFaviconError] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dropPosition, setDropPosition] = useState<'top' | 'bottom' | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(tab.title || '');

  const tabId = tab.id;
  const isNewTab = !tab.url || tab.url.startsWith('chrome://newtab') || tab.url === 'about:blank';
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
        icon: <Sparkles className="w-3.5 h-3.5 text-cyan-400" />,
        action: () => onPinToQuickAccess(tab),
        disabled: !tab.url || isNewTab
      },
      {
        label: 'Pin to Active Space',
        icon: <FolderPlus className="w-3.5 h-3.5 text-amber-400" />,
        action: () => onPinToWorkspace(tab),
        disabled: !tab.url || isNewTab
      },
      ...(onPinToSpace && spaces.length > 0 && tab.url && !isNewTab
        ? [
            {
              label: 'Move to Space',
              icon: <ArrowRightLeft className="w-3.5 h-3.5 text-amber-400" />,
              submenu: spaces.map((sp) => ({
                label: sp.name,
                icon: <Folder className="w-3.5 h-3.5 text-amber-400" />,
                action: () => onPinToSpace(tab, sp.folderId)
              }))
            }
          ]
        : []),
      ...(!isActive && !isDiscarded && onDiscardTab
        ? [
            {
              label: 'Hibernate Tab (Save RAM)',
              icon: <Moon className="w-3.5 h-3.5 text-indigo-400" />,
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
        icon: isMuted ? <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> : <VolumeX className="w-3.5 h-3.5" />,
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
              icon: <Edit2 className="w-3.5 h-3.5 text-zinc-400" />,
              action: () => {
                setEditTitle(tab.title || '');
                setIsEditing(true);
              }
            }
          ]
        : []),
      {
        label: 'Close Tab',
        icon: <X className="w-3.5 h-3.5 text-rose-400" />,
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

  if (isEditing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = editTitle.trim();
          if (trimmed && onRenameTab && typeof tabId === 'number') {
            onRenameTab(tabId, trimmed);
          }
          setIsEditing(false);
        }}
        className="flex items-center h-[34px] px-2.5 my-[1px] space-x-1.5 bg-zinc-200/50 dark:bg-white/[0.06] rounded-lg border border-cyan-500/60"
      >
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setIsEditing(false);
              setEditTitle(tab.title || '');
            }
          }}
          autoFocus
          onFocus={(e) => e.target.select()}
          className="flex-1 bg-transparent px-1.5 py-0.5 text-xs text-zinc-900 dark:text-white focus:outline-none"
        />
        <button
          type="submit"
          title="Save Title"
          className="p-1 rounded text-emerald-500 hover:bg-emerald-500/20"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Cancel"
          onClick={() => {
            setIsEditing(false);
            setEditTitle(tab.title || '');
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
      className={`group relative flex items-center justify-between h-[34px] px-2.5 my-[1px] rounded-lg cursor-pointer select-none transition-all duration-150 outline-none ${
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

        <span
          title={titleText}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditTitle(tab.title || '');
            setIsEditing(true);
          }}
          className={`truncate text-[13px] leading-tight transition-colors duration-150 cursor-text select-text ${
            isActive
              ? 'text-zinc-900 dark:text-white'
              : isDiscarded
              ? 'text-zinc-400 italic'
              : 'text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white'
          }`}
        >
          {titleText}
        </span>
      </div>

      {/* Right: Audio Indicator, Split View, Copy Link, Reload on active hover, & Close Button */}
      <div className="flex items-center space-x-1 flex-shrink-0">
        {/* Audio status */}
        {(isAudible || isMuted) && (
          <button
            type="button"
            title={isMuted ? 'Tab is muted' : 'Tab is playing audio'}
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

        {/* Active tab indicator dot */}
        {isActive && (
          <div className="w-1.5 h-1.5 rounded-full theme-active-indicator group-hover:hidden transition-opacity flex-shrink-0" />
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
