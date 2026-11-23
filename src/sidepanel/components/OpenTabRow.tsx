import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import type { SpaceItem, TabReminder, TabWithFaviconMeta } from '../../types';
import { useResolvedFavicon } from '../utils/faviconCache';
import { markKeyboardRowActivation } from '../utils/tabPageFocus';
import {
  attachMultiDragPreview,
  endDragSession,
  getActiveDrag,
  parseDragPayload,
  startDragSession,
  useIsDraggedOpenTab,
  useIsRecentlyMoved,
  useResetOnDragEnd
} from '../utils/dnd';
import type { ContextMenuItem } from './ContextMenu';

function isNewTabUrl(rawUrl?: string): boolean {
  return (
    !rawUrl ||
    rawUrl.startsWith('chrome://newtab') ||
    rawUrl === 'about:blank' ||
    rawUrl.includes('/newtab.html') ||
    rawUrl.includes('/command.html')
  );
}

function formatSubdomain(rawUrl?: string): string {
  if (
    !rawUrl ||
    rawUrl === 'about:blank' ||
    rawUrl.startsWith('chrome://') ||
    rawUrl.startsWith('chrome-extension://') ||
    rawUrl.startsWith('edge://') ||
    rawUrl.startsWith('about:')
  ) {
    return '';
  }
  if (/^data:/i.test(rawUrl)) {
    const semi = rawUrl.indexOf(';');
    const comma = rawUrl.indexOf(',');
    const end = semi !== -1 && (comma === -1 || semi < comma) ? semi : comma;
    return end > 5 && end <= 48 ? rawUrl.slice(0, end) : 'data:';
  }
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname === '/' ? '' : u.pathname;
    const formatted = `${host}${path}`;
    return formatted.length > 160 ? `${formatted.slice(0, 160)}…` : formatted;
  } catch {
    return rawUrl.length > 160 ? `${rawUrl.slice(0, 160)}…` : rawUrl;
  }
}

function formatTooltipUrl(rawUrl?: string): string {
  if (!rawUrl) return '';
  return rawUrl.length > 300 ? `${rawUrl.slice(0, 300)}…` : rawUrl;
}

function copyUrlToClipboard(url: string): void {
  try {
    const res = navigator.clipboard?.writeText?.(url);
    if (res && typeof res.catch === 'function') {
      res.catch(() => {});
    }
  } catch {
    // Ignore clipboard write errors when panel lacks focus
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
  onMoveOpenTabs?: (tabIds: number[], targetSlotIndex: number) => void;
  reminder?: TabReminder;
  onOpenReminderPopover?: (target: { type: 'tab'; tabId: number; url: string; title: string }, anchorRect: DOMRect) => void;
  isSelected?: boolean;
  selectedTabIds?: Set<number>;
  getSelectedTabIds?: () => Set<number> | undefined;
  resolveSelectedTabs?: (tabIds: number[]) => chrome.tabs.Tab[];
  onSelectTab?: (tab: chrome.tabs.Tab, e: React.MouseEvent) => void;
  onCloseMultipleTabs?: (tabIds: number[]) => void;
  onPinMultipleTabsToWorkspace?: (tabs: chrome.tabs.Tab[]) => void;
  onPinMultipleTabsToSpace?: (tabs: chrome.tabs.Tab[], targetSpaceFolderId: string) => void;
  onMoveTabToSpace?: (tabId: number, targetSpaceId: string) => void;
  onMoveMultipleTabsToSpace?: (tabIds: number[], targetSpaceId: string) => void;
  onDiscardMultipleTabs?: (tabIds: number[]) => void;
  isEditing?: boolean;
  editTitle?: string;
  onStartRename?: () => void;
  onStartRenameTab?: (tab: chrome.tabs.Tab) => void;
  onChangeEditTitle?: (newTitle: string) => void;
  onSaveRename?: () => void;
  onSaveRenameTab?: (tabId: number) => void;
  onCancelRename?: () => void;
}

const OpenTabRowComponent: React.FC<OpenTabRowProps> = ({
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
  onMoveOpenTabs,
  reminder,
  onOpenReminderPopover,
  isSelected = false,
  selectedTabIds,
  getSelectedTabIds,
  resolveSelectedTabs,
  onSelectTab,
  onCloseMultipleTabs,
  onPinMultipleTabsToWorkspace,
  onPinMultipleTabsToSpace,
  onMoveTabToSpace,
  onMoveMultipleTabsToSpace,
  onDiscardMultipleTabs,
  isEditing: controlledIsEditing,
  editTitle: controlledEditTitle,
  onStartRename,
  onStartRenameTab,
  onChangeEditTitle,
  onSaveRename,
  onSaveRenameTab,
  onCancelRename
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dropPosition, setDropPosition] = useState<'top' | 'bottom' | null>(null);
  const lastDragOverYRef = useRef<number | null>(null);
  const isDraggedOpenTab = useIsDraggedOpenTab(tab.id);
  const isPartOfActiveDrag = isDragging || isDraggedOpenTab;
  const isRecentlyMoved = useIsRecentlyMoved(typeof tab.id === 'number' ? `tab-${tab.id}` : '');
  const [localIsEditing, setLocalIsEditing] = useState(false);
  const [localEditTitle, setLocalEditTitle] = useState(tab.title || '');
  const [isCopied, setIsCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renameHandledRef = useRef(false);

  const resetDragState = useCallback(() => {
    setIsDragging(false);
    setDropPosition(null);
    lastDragOverYRef.current = null;
  }, []);
  useResetOnDragEnd(isDragging || dropPosition !== null, resetDragState);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = null;
      }
    };
  }, []);

  const isControlled =
    typeof onStartRename === 'function' || typeof onStartRenameTab === 'function';
  const canRename = Boolean(onRenameTab || isControlled);
  const effectiveIsEditing = isControlled ? Boolean(controlledIsEditing) : localIsEditing;
  const effectiveEditTitle =
    isControlled && typeof controlledEditTitle === 'string' ? controlledEditTitle : localEditTitle;

  if (!effectiveIsEditing) {
    renameHandledRef.current = false;
  }

  const tabId = tab.id;
  const isNewTab = isNewTabUrl(tab.url);
  const titleText = tab.title || (isNewTab ? 'New Tab' : tab.url || 'Untitled Tab');
  const { faviconSrc, handleFaviconError, handleFaviconLoad } = useResolvedFavicon({
    pageUrl: tab.url,
    tab: tab as TabWithFaviconMeta,
    size: 32
  });

  const isAudible = Boolean(tab.audible);
  const isMuted = Boolean(tab.mutedInfo?.muted);
  const isDiscarded = Boolean(tab.discarded);
  const isLoading = tab.status === 'loading';

  const triggerStartRename = () => {
    renameHandledRef.current = false;
    if (onStartRenameTab) {
      onStartRenameTab(tab);
    } else if (onStartRename) {
      onStartRename();
    } else {
      setLocalEditTitle(tab.title || '');
      setLocalIsEditing(true);
    }
  };

  const commitRename = () => {
    if (renameHandledRef.current) return;
    renameHandledRef.current = true;
    if (onSaveRenameTab && typeof tabId === 'number') {
      onSaveRenameTab(tabId);
    } else if (onSaveRename) {
      onSaveRename();
    } else {
      const trimmed = effectiveEditTitle.trim();
      const original = (tab.title || '').trim();
      if (trimmed && trimmed !== original && onRenameTab && typeof tabId === 'number') {
        onRenameTab(tabId, trimmed);
      }
      setLocalIsEditing(false);
    }
  };

  const cancelRename = () => {
    if (renameHandledRef.current) return;
    renameHandledRef.current = true;
    if (onCancelRename) {
      onCancelRename();
    } else {
      setLocalIsEditing(false);
      setLocalEditTitle(tab.title || '');
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (typeof tabId !== 'number') return;

    const effectiveSelectedIds = getSelectedTabIds ? getSelectedTabIds() : selectedTabIds;
    const isMultiSelected = Boolean(
      effectiveSelectedIds && effectiveSelectedIds.has(tabId) && effectiveSelectedIds.size > 1
    );

    if (isMultiSelected) {
      const selectedIds = Array.from(effectiveSelectedIds!);
      const resolvedTabs = resolveSelectedTabs
        ? resolveSelectedTabs(selectedIds)
        : selectedIds.includes(tabId)
        ? [tab]
        : [];
      const pinnableTabs = resolvedTabs.filter((t) => Boolean(t.url && !isNewTabUrl(t.url)));

      const multiItems: ContextMenuItem[] = [
        ...(onMoveMultipleTabsToSpace && spaces.length > 1
          ? [
              {
                label: `Move ${selectedIds.length} Tabs to Space`,
                icon: <ArrowRightLeft className="w-3.5 h-3.5" />,
                submenu: spaces.map((sp) => ({
                  label: sp.name,
                  icon: <Folder className="w-3.5 h-3.5" />,
                  action: () => onMoveMultipleTabsToSpace(selectedIds, sp.id)
                }))
              }
            ]
          : []),
        ...(onPinMultipleTabsToWorkspace
          ? [
              {
                label: `Pin ${selectedIds.length} Tabs to Active Space`,
                icon: <FolderPlus className="w-3.5 h-3.5" />,
                action: () => onPinMultipleTabsToWorkspace(pinnableTabs),
                disabled: pinnableTabs.length === 0
              }
            ]
          : []),
        ...(onPinMultipleTabsToSpace && spaces.length > 0
          ? [
              {
                label: `Pin ${selectedIds.length} Tabs to Space`,
                icon: <FolderPlus className="w-3.5 h-3.5" />,
                disabled: pinnableTabs.length === 0,
                submenu:
                  pinnableTabs.length > 0
                    ? spaces.map((sp) => ({
                        label: sp.name,
                        icon: <Folder className="w-3.5 h-3.5" />,
                        action: () => onPinMultipleTabsToSpace(pinnableTabs, sp.folderId)
                      }))
                    : undefined
              }
            ]
          : []),
        ...(onDiscardMultipleTabs
          ? [
              {
                label: `Hibernate ${selectedIds.length} Tabs (Save RAM)`,
                icon: <Moon className="w-3.5 h-3.5" />,
                action: () => onDiscardMultipleTabs(selectedIds)
              }
            ]
          : []),
        ...(onCloseMultipleTabs
          ? [
              {
                label: `Close ${selectedIds.length} Selected Tabs`,
                icon: <X className="w-3.5 h-3.5" />,
                action: () => onCloseMultipleTabs(selectedIds),
                danger: true,
                dividerBefore: true
              }
            ]
          : [])
      ];
      onOpenContextMenu(e, multiItems);
      return;
    }

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
      ...(onMoveTabToSpace && spaces.length > 1
        ? [
            {
              label: 'Move Tab to Space',
              icon: <ArrowRightLeft className="w-3.5 h-3.5" />,
              submenu: spaces.map((sp) => ({
                label: sp.name,
                icon: <Folder className="w-3.5 h-3.5" />,
                action: () => onMoveTabToSpace(tabId, sp.id)
              }))
            }
          ]
        : []),
      ...(onPinToSpace && spaces.length > 0 && tab.url && !isNewTab
        ? [
            {
              label: onMoveTabToSpace && spaces.length > 1 ? 'Pin to Space' : 'Move to Space',
              icon:
                onMoveTabToSpace && spaces.length > 1 ? (
                  <FolderPlus className="w-3.5 h-3.5" />
                ) : (
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                ),
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
          if (tab.url) copyUrlToClipboard(tab.url);
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
      ...(canRename && typeof tabId === 'number'
        ? [
            {
              label: 'Rename Tab',
              icon: <Edit2 className="w-3.5 h-3.5" />,
              action: () => triggerStartRename()
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
    e.stopPropagation();
    setIsDragging(true);
    const effectiveSelectedIds = getSelectedTabIds ? getSelectedTabIds() : selectedTabIds;
    let tabIdsToDrag: number[] = [tabId];
    if (effectiveSelectedIds && effectiveSelectedIds.has(tabId)) {
      tabIdsToDrag = Array.from(effectiveSelectedIds);
    } else if (effectiveSelectedIds && effectiveSelectedIds.size > 0 && (e.metaKey || e.ctrlKey)) {
      tabIdsToDrag = Array.from(new Set([...Array.from(effectiveSelectedIds), tabId]));
    }
    const payload = {
      type: 'openTab' as const,
      tabId,
      tabIds: tabIdsToDrag,
      url: tab.url,
      title: tab.title,
      index: tab.index
    };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copyMove';
    startDragSession(payload);
    attachMultiDragPreview(e, tabIdsToDrag.length, 'tab');
  };

  const handleDragEnd = () => {
    resetDragState();
    endDragSession();
  };

  const handleDragOver = (e: React.DragEvent) => {
    const activeDrag = getActiveDrag();
    if (activeDrag && activeDrag.type !== 'openTab') {
      if (dropPosition !== null) setDropPosition(null);
      return;
    }
    if (
      activeDrag?.type === 'openTab' &&
      (!activeDrag.tabIds || activeDrag.tabIds.length <= 1) &&
      activeDrag.tabId === tabId
    ) {
      if (dropPosition !== null) setDropPosition(null);
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (lastDragOverYRef.current === e.clientY && dropPosition !== null) {
      return;
    }
    lastDragOverYRef.current = e.clientY;
    const rect = e.currentTarget.getBoundingClientRect();
    const nextPos = e.clientY - rect.top < rect.height / 2 ? 'top' : 'bottom';
    if (nextPos !== dropPosition) {
      setDropPosition(nextPos);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    lastDragOverYRef.current = null;
    setDropPosition(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    lastDragOverYRef.current = null;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos =
      dropPosition || (e.clientY - rect.top < rect.height / 2 ? 'top' : 'bottom');
    setDropPosition(null);

    const data = parseDragPayload(e);
    if (!data || data.type !== 'openTab') return;

    endDragSession();
    e.preventDefault();
    e.stopPropagation();

    const baseIndex = typeof tab.index === 'number' ? tab.index : 0;
    const targetSlotIndex = baseIndex + (pos === 'bottom' ? 1 : 0);
    const idsToMove: number[] =
      Array.isArray(data.tabIds) && data.tabIds.length > 0
        ? (data.tabIds as number[])
        : typeof data.tabId === 'number'
        ? [data.tabId]
        : [];

    if (idsToMove.length === 0 || (idsToMove.length === 1 && idsToMove[0] === tabId)) {
      return;
    }

    if (onMoveOpenTabs) {
      onMoveOpenTabs(idsToMove, targetSlotIndex);
    } else if (onMoveOpenTab) {
      if (idsToMove.length === 1) {
        const draggedIdx = typeof data.index === 'number' ? data.index : -1;
        const effectiveIndex =
          draggedIdx !== -1 && draggedIdx < targetSlotIndex
            ? Math.max(0, targetSlotIndex - 1)
            : targetSlotIndex;
        onMoveOpenTab(idsToMove[0], effectiveIndex);
      } else {
        const draggedIdx = typeof data.index === 'number' ? data.index : -1;
        const movingDown = draggedIdx !== -1 && draggedIdx < targetSlotIndex;
        const startSlot = movingDown
          ? Math.max(0, targetSlotIndex - idsToMove.length)
          : targetSlotIndex;
        for (let i = 0; i < idsToMove.length; i++) {
          onMoveOpenTab(idsToMove[i], startSlot + i);
        }
      }
    }
  };

  if (effectiveIsEditing) {
    return (
      <form
        data-tab-id={tabId}
        onSubmit={(e) => {
          e.preventDefault();
          commitRename();
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
          onBlur={() => commitRename()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              cancelRename();
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
          onClick={() => cancelRename()}
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
      data-flip-id={typeof tabId === 'number' ? `tab-${tabId}` : undefined}
      data-tab-id={tabId}
      style={{ '--drop-indent': '10px' } as React.CSSProperties}
      draggable={Boolean(tab.url && !isNewTab)}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      title={`${titleText}\n${formatTooltipUrl(tab.url)}${isDiscarded ? '\n(Sleeping to save memory - click to wake)' : ''}`}
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          onSelectTab?.(tab, e);
          return;
        }
        onSelectTab?.(tab, e);
        if (typeof tabId === 'number') onFocus(tabId);
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        if (typeof tabId === 'number') onReload(tabId);
      }}
      onContextMenu={handleContextMenu}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if ((e.key === 'Enter' || e.key === ' ') && typeof tabId === 'number') {
          e.preventDefault();
          markKeyboardRowActivation();
          onFocus(tabId);
        }
      }}
      className={`group relative flex items-center justify-between ${
        densityMode === 'relaxed'
          ? 'min-h-[46px] py-1.5 px-2.5 my-1 rounded-xl border transition-[background-color,border-color,color,opacity] duration-150'
          : 'h-[34px] px-2.5 my-[1px] rounded-lg transition-[background-color,color,opacity] duration-150'
      } cursor-pointer select-none outline-none ${
        isPartOfActiveDrag ? 'opacity-40' : ''
      } ${isRecentlyMoved ? 'arctic-drop-settle' : ''} ${
        dropPosition === 'top'
          ? 'theme-drag-over-top'
          : dropPosition === 'bottom'
          ? 'theme-drag-over-bottom'
          : ''
      } ${
        isSelected
          ? densityMode === 'relaxed'
            ? 'bg-cyan-500/15 dark:bg-cyan-400/20 border-cyan-500 dark:border-cyan-400 text-zinc-900 dark:text-white font-medium shadow-xs'
            : 'bg-cyan-500/15 dark:bg-cyan-400/20 border-l-2 border-cyan-500 text-zinc-900 dark:text-white font-medium'
          : isActive
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
        <div
          title={`${titleText} (Double-click to reload)`}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (typeof tabId === 'number') onReload(tabId);
          }}
          className="relative flex-shrink-0 w-4 h-4 flex items-center justify-center rounded transition-transform active:scale-90"
        >
          <div className="relative w-4 h-4 flex items-center justify-center pointer-events-none">
            {isLoading ? (
              <RotateCw className="w-3.5 h-3.5 animate-spin theme-accent-text" />
            ) : faviconSrc ? (
              <img
                src={faviconSrc}
                alt=""
                draggable={false}
                onError={handleFaviconError}
                onLoad={handleFaviconLoad}
                className={`w-4 h-4 object-contain rounded-sm transition-opacity ${
                  isDiscarded ? 'opacity-60 grayscale' : 'opacity-100'
                }`}
              />
            ) : (
              <Globe className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-400" />
            )}

            {/* Sleep icon overlay on favicon if hibernated */}
            {isDiscarded && !isLoading && (
              <Moon className="absolute -bottom-1 -right-1 w-2.5 h-2.5 text-indigo-400 fill-indigo-400/30" />
            )}
          </div>
        </div>

        {/* Title + Subdomain details */}
        <div
          className="flex flex-col min-w-0 flex-1 justify-center py-0.5"
          onDoubleClick={(e) => {
            if (!canRename) return;
            e.stopPropagation();
            triggerStartRename();
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

      {/* Right: Audio Indicator & Cohesive Hover Actions (Pin, Reload, Reminder, Close) */}
      <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
        {/* Audio status */}
        {(isAudible || isMuted) && (
          <button
            type="button"
            data-tooltip={isMuted ? 'Tab is muted (Click to unmute)' : 'Tab is playing audio (Click to mute)'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleMute(tab);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className={`flex items-center justify-center w-5 h-5 rounded-md transition-colors ${
              isMuted
                ? 'text-rose-500 dark:text-rose-400 bg-rose-500/15 hover:bg-rose-500/25'
                : 'text-cyan-500 dark:text-cyan-400 bg-cyan-500/15 hover:bg-cyan-500/25'
            }`}
          >
            {isMuted ? (
              <VolumeX className="w-3 h-3 stroke-[2.2]" />
            ) : (
              <Volume2 className="w-3 h-3 stroke-[2.2] animate-pulse" />
            )}
          </button>
        )}

        {/* Quick Pin to Active Space Button (visible on hover) */}
        {!isNewTab && (
          <button
            type="button"
            data-tooltip="Pin to Active Space"
            data-tooltip-pos="bottom-right"
            onClick={(e) => {
              e.stopPropagation();
              onPinToWorkspace(tab);
            }}
            className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded-md text-zinc-400/80 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
          >
            <Pin className="w-3 h-3 stroke-[2]" />
          </button>
        )}

        {/* Copy Link Button (visible on hover) */}
        {!isNewTab && tab.url && (
          <button
            type="button"
            data-tooltip={isCopied ? 'Copied!' : 'Copy link'}
            data-tooltip-pos="bottom-right"
            onClick={(e) => {
              e.stopPropagation();
              if (tab.url) {
                copyUrlToClipboard(tab.url);
                setIsCopied(true);
                if (copyTimeoutRef.current !== null) {
                  clearTimeout(copyTimeoutRef.current);
                }
                copyTimeoutRef.current = setTimeout(() => {
                  copyTimeoutRef.current = null;
                  setIsCopied(false);
                }, 1500);
              }
            }}
            className={`hidden group-hover:flex items-center justify-center w-5 h-5 rounded-md transition-colors ${
              isCopied
                ? 'text-emerald-500 bg-emerald-500/15'
                : 'text-zinc-400/80 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/[0.06] dark:hover:bg-white/[0.08]'
            }`}
          >
            {isCopied ? (
              <Check className="w-3 h-3 stroke-[2.2]" />
            ) : (
              <Link2 className="w-3 h-3 stroke-[2]" />
            )}
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
            className={`items-center justify-center w-5 h-5 rounded-md transition-colors ${
              reminder
                ? reminder.status === 'fired' || reminder.triggerAt <= Date.now()
                  ? 'flex text-rose-500 bg-rose-500/15 animate-pulse'
                  : 'flex text-amber-500 dark:text-amber-400 bg-amber-500/10'
                : 'hidden group-hover:flex text-zinc-400/80 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/[0.06] dark:hover:bg-white/[0.08]'
            }`}
          >
            <Bell className="w-3 h-3 stroke-[2]" />
          </button>
        )}

        {/* Close Button on hover */}
        {typeof tabId === 'number' && (
          <button
            type="button"
            data-tooltip="Close tab (Cmd+W)"
            onClick={(e) => onClose(tabId, e)}
            className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded-md text-zinc-400/80 dark:text-zinc-500 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            <X className="w-3 h-3 stroke-[2.2]" />
          </button>
        )}
      </div>
    </div>
  );
};

export const OpenTabRow = React.memo(OpenTabRowComponent);
