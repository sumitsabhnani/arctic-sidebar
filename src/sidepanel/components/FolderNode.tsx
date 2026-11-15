import React, { useState, useMemo } from 'react';
import {
  Folder,
  FolderOpen,
  FolderPlus,
  BookmarkPlus,
  Archive,
  Edit2,
  Trash2,
  Check,
  X,
  ArrowRightLeft,
  FileText,
  Table,
  Presentation,
  BookOpen,
  Code
} from 'lucide-react';
import { BookmarkRow } from './BookmarkRow';
import type { TabBinding, SpaceItem, TabReminder } from '../../types';
import {
  endDragSession,
  getFolderDropZone,
  isFolderSelfOrDescendant,
  parseDragPayload,
  startDragSession,
  useActiveDrag,
  useRecentlyMovedIds
} from '../utils/dnd';
import type { ContextMenuItem } from './ContextMenu';

function getDescendantBookmarkIds(folder: chrome.bookmarks.BookmarkTreeNode): string[] {
  let ids: string[] = [];
  if (folder.children) {
    for (const child of folder.children) {
      if (child.url) {
        ids.push(child.id);
      } else if (child.children) {
        ids = ids.concat(getDescendantBookmarkIds(child));
      }
    }
  }
  return ids;
}

interface FolderNodeProps {
  node: chrome.bookmarks.BookmarkTreeNode;
  depth?: number;
  collapsedFolderIds: Record<string, boolean>;
  onToggleCollapse: (folderId: string) => void;
  bindingsByBookmarkId: Record<string, TabBinding>;
  tabsByTabId?: Record<number, chrome.tabs.Tab>;
  discardedTabsByTabId?: Record<number, boolean>;
  activeTabId: number | null;
  spaces?: SpaceItem[];
  activeSpaceId?: string;
  onRowClick: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onFaviconClick: (bookmark: chrome.bookmarks.BookmarkTreeNode, e: React.MouseEvent) => void;
  onFaviconDoubleClick?: (bookmark: chrome.bookmarks.BookmarkTreeNode, e: React.MouseEvent) => void;
  onCloseTab: (tabId: number, e: React.MouseEvent) => void;
  onReloadTab?: (tabId: number) => void;
  onDuplicateTab?: (tabId: number) => void;
  onDiscardTab?: (tabId: number) => void;
  onToggleMuteTab?: (tabOrId: chrome.tabs.Tab | number) => void;
  onMoveToSpace?: (nodeId: string, targetSpaceFolderId: string) => void;
  onReplaceUrl?: (bookmarkId: string) => void;
  onCreateFolder: (parentId: string, title: string) => void;
  onBookmarkCurrentPage?: (parentId: string) => void;
  onRenameFolder?: (id: string, title: string) => void;
  onRenameBookmark?: (id: string, title: string) => void;
  onOpenContextMenu?: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  onDeleteBookmark?: (id: string) => void;
  onUnpinBookmark?: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onMoveToQuickAccess?: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onDropItemToFolder?: (data: { type: string; [key: string]: unknown }, targetFolderId: string, targetIndex?: number) => void;
  onMoveBookmarkToIndex?: (draggedId: string, targetParentId: string, targetIndex?: number) => void;
  getReminderForBookmark?: (bookmarkId: string) => TabReminder | undefined;
  onOpenReminderPopover?: (target: { type: 'bookmark'; bookmarkId: string; url: string; title: string }, anchorRect: DOMRect) => void;
  onCreateGoogleDoc?: (parentId: string, url?: string, title?: string) => void;
  selectedBookmarkIds?: Set<string>;
  onSelectBookmark?: (bookmark: chrome.bookmarks.BookmarkTreeNode, e: React.MouseEvent) => void;
  onDeleteMultipleBookmarks?: (ids: string[]) => void;
  onMoveMultipleBookmarksToSpace?: (ids: string[], targetSpaceFolderId: string) => void;
  treeRoots?: chrome.bookmarks.BookmarkTreeNode[];
  densityMode?: 'relaxed' | 'compact';
  editingTarget?: { type: 'openTab' | 'bookmark' | 'folder'; id: string | number; initialTitle?: string; title: string } | null;
  onStartRename?: (type: 'openTab' | 'bookmark' | 'folder', id: string | number, currentTitle: string) => void;
  onChangeEditTitle?: (newTitle: string) => void;
  onSaveRename?: () => void;
  onCancelRename?: () => void;
}

export const FolderNode: React.FC<FolderNodeProps> = ({
  node,
  depth = 0,
  collapsedFolderIds,
  onToggleCollapse,
  bindingsByBookmarkId,
  tabsByTabId = {},
  discardedTabsByTabId = {},
  activeTabId,
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
  onReplaceUrl,
  onCreateFolder,
  onBookmarkCurrentPage,
  onRenameFolder,
  onRenameBookmark,
  onOpenContextMenu,
  onDeleteBookmark,
  onUnpinBookmark,
  onMoveToQuickAccess,
  onDropItemToFolder,
  onMoveBookmarkToIndex,
  getReminderForBookmark,
  onOpenReminderPopover,
  onCreateGoogleDoc,
  selectedBookmarkIds,
  onSelectBookmark,
  onDeleteMultipleBookmarks,
  onMoveMultipleBookmarksToSpace,
  treeRoots,
  densityMode = 'compact',
  editingTarget,
  onStartRename,
  onChangeEditTitle,
  onSaveRename,
  onCancelRename
}) => {
  const isCollapsed = collapsedFolderIds[node.id] !== undefined ? Boolean(collapsedFolderIds[node.id]) : true;
  const children = node.children || [];

  // Inline subfolder creation state
  const [isCreatingSubfolder, setIsCreatingSubfolder] = useState(false);
  const [newSubfolderTitle, setNewSubfolderTitle] = useState('');

  // Inline rename state
  const [localIsRenaming, setLocalIsRenaming] = useState(false);
  const [localRenameTitle, setLocalRenameTitle] = useState(node.title || '');

  const isControlled = typeof onStartRename === 'function';
  const isRenaming = isControlled
    ? Boolean(editingTarget && editingTarget.type === 'folder' && editingTarget.id === node.id)
    : localIsRenaming;
  const renameTitle = isControlled
    ? (editingTarget && editingTarget.type === 'folder' && editingTarget.id === node.id ? editingTarget.title : (node.title || ''))
    : localRenameTitle;

  // Drop target & drag source state
  const [dropState, setDropState] = useState<'inside' | 'top' | 'bottom' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const activeDrag = useActiveDrag();
  const recentlyMovedIds = useRecentlyMovedIds();
  const effectiveRoots = useMemo(() => treeRoots || [node], [treeRoots, node]);
  const isSelfOrAncestorBeingDragged =
    isDragging ||
    Boolean(
      activeDrag?.type === 'folder' &&
        isFolderSelfOrDescendant(effectiveRoots, activeDrag.id, node.id)
    );
  const isRecentlyMoved = recentlyMovedIds.has(node.id);

  // Find all open/running tab IDs under this folder and its subfolders
  const runningTabIdsUnderFolder = useMemo(() => {
    const bookmarkIds = getDescendantBookmarkIds(node);
    const tabIds: number[] = [];
    for (const bId of bookmarkIds) {
      const binding = bindingsByBookmarkId[bId];
      if (binding && typeof binding.tabId === 'number') {
        tabIds.push(binding.tabId);
      }
    }
    return tabIds;
  }, [node, bindingsByBookmarkId]);

  // Archive all tabs under this folder to sleep
  const handleArchiveAllTabs = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!onDiscardTab) return;
    for (const tabId of runningTabIdsUnderFolder) {
      onDiscardTab(tabId);
    }
  };

  const handleStartCreateSubfolder = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (isCollapsed) {
      onToggleCollapse(node.id);
    }
    setIsCreatingSubfolder(true);
    setNewSubfolderTitle('');
  };

  const handleConfirmSubfolder = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const title = newSubfolderTitle.trim();
    if (title) {
      onCreateFolder(node.id, title);
    }
    setIsCreatingSubfolder(false);
    setNewSubfolderTitle('');
  };

  const handleCancelSubfolder = () => {
    setIsCreatingSubfolder(false);
    setNewSubfolderTitle('');
  };

  const handleConfirmRename = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (onSaveRename) {
      onSaveRename();
    } else {
      const title = renameTitle.trim();
      if (title && onRenameFolder && title !== node.title) {
        onRenameFolder(node.id, title);
      }
      setLocalIsRenaming(false);
    }
  };

  const handleCancelRename = () => {
    if (onCancelRename) {
      onCancelRename();
    } else {
      setLocalIsRenaming(false);
      setLocalRenameTitle(node.title || '');
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    const payload = {
      type: 'folder' as const,
      id: node.id,
      parentId: node.parentId,
      title: node.title,
      index: node.index
    };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copyMove';
    startDragSession(payload);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDropState(null);
    endDragSession();
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (
      activeDrag?.type === 'folder' &&
      isFolderSelfOrDescendant(effectiveRoots, activeDrag.id, node.id)
    ) {
      if (dropState !== null) setDropState(null);
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const rect = e.currentTarget.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const zone = getFolderDropZone(relY, rect.height, isCollapsed);
    setDropState(zone);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) {
      return;
    }
    setDropState(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const effectiveDrop =
      dropState ?? getFolderDropZone(e.clientY - rect.top, rect.height, isCollapsed);
    setDropState(null);
    endDragSession();

    const data = parseDragPayload(e);
    if (!data) return;
    if (data.id === node.id) return;

    if (data.type === 'folder') {
      const draggedFolderId = String(data.id || '');
      if (effectiveDrop === 'inside') {
        if (isFolderSelfOrDescendant(effectiveRoots, draggedFolderId, node.id)) {
          return;
        }
      } else if (isFolderSelfOrDescendant(effectiveRoots, draggedFolderId, node.parentId)) {
        return;
      }
    }

    if (effectiveDrop === 'inside') {
      if (onDropItemToFolder) {
        onDropItemToFolder(data as { type: string; [key: string]: unknown }, node.id);
      }
      return;
    }

    if ((effectiveDrop === 'top' || effectiveDrop === 'bottom') && node.parentId) {
      let targetIndex = typeof node.index === 'number' ? node.index : 0;
      if (effectiveDrop === 'bottom') {
        targetIndex += 1;
      }
      if (onDropItemToFolder) {
        onDropItemToFolder(
          data as { type: string; [key: string]: unknown },
          node.parentId,
          targetIndex
        );
      } else if (onMoveBookmarkToIndex && typeof data.id === 'string') {
        onMoveBookmarkToIndex(data.id, node.parentId, targetIndex);
      }
    }
  };

  const otherSpaces = spaces.filter((s) => s.id !== activeSpaceId);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onOpenContextMenu) return;
    e.preventDefault();

    const items: ContextMenuItem[] = [
      ...(onBookmarkCurrentPage
        ? [
            {
              label: 'Pin Current Tab Here',
              icon: <BookmarkPlus className="w-3.5 h-3.5" />,
              action: () => onBookmarkCurrentPage(node.id)
            }
          ]
        : []),
      {
        label: 'New Subfolder',
        icon: <FolderPlus className="w-3.5 h-3.5" />,
        action: () => handleStartCreateSubfolder()
      },
      ...(onCreateGoogleDoc
        ? [
            {
              label: 'New Document',
              icon: <FileText className="w-3.5 h-3.5" />,
              submenu: [
                {
                  label: 'Google Doc',
                  icon: <FileText className="w-3.5 h-3.5" />,
                  action: () => onCreateGoogleDoc(node.id, 'https://docs.new', 'New Google Doc')
                },
                {
                  label: 'Google Sheet',
                  icon: <Table className="w-3.5 h-3.5" />,
                  action: () => onCreateGoogleDoc(node.id, 'https://sheets.new', 'New Google Sheet')
                },
                {
                  label: 'Google Slides',
                  icon: <Presentation className="w-3.5 h-3.5" />,
                  action: () => onCreateGoogleDoc(node.id, 'https://slides.new', 'New Google Slides')
                },
                {
                  label: 'Notion Page',
                  icon: <BookOpen className="w-3.5 h-3.5" />,
                  action: () => onCreateGoogleDoc(node.id, 'https://notion.new', 'New Notion Page')
                },
                {
                  label: 'GitHub Gist',
                  icon: <Code className="w-3.5 h-3.5" />,
                  action: () => onCreateGoogleDoc(node.id, 'https://gist.new', 'New GitHub Gist')
                }
              ]
            }
          ]
        : []),
      ...(onMoveToSpace && otherSpaces.length > 0
        ? [
            {
              label: 'Move Folder to Space',
              icon: <ArrowRightLeft className="w-3.5 h-3.5" />,
              submenu: otherSpaces.map((sp) => ({
                label: sp.name,
                icon: <Folder className="w-3.5 h-3.5" />,
                action: () => onMoveToSpace(node.id, sp.folderId)
              }))
            }
          ]
        : []),
      ...(runningTabIdsUnderFolder.length > 0 && onDiscardTab
        ? [
            {
              label: `Archive All Tabs in Folder (${runningTabIdsUnderFolder.length} open)`,
              icon: <Archive className="w-3.5 h-3.5" />,
              action: () => handleArchiveAllTabs()
            }
          ]
        : []),
      {
        label: 'Rename Folder',
        icon: <Edit2 className="w-3.5 h-3.5" />,
        action: () => {
          if (onStartRename) {
            onStartRename('folder', node.id, node.title || '');
          } else {
            setLocalRenameTitle(node.title || '');
            setLocalIsRenaming(true);
          }
        },
        dividerBefore: true
      },
      ...(onDeleteBookmark
        ? [
            {
              label: 'Delete Folder',
              icon: <Trash2 className="w-3.5 h-3.5" />,
              action: () => onDeleteBookmark(node.id),
              danger: true,
              dividerBefore: true
            }
          ]
        : [])
    ];

    onOpenContextMenu(e, items);
  };

  return (
    <div className="flex flex-col select-none rounded-lg transition-colors">
      {/* Folder Header Row */}
      {isRenaming ? (
        <form
          onSubmit={handleConfirmRename}
          style={{ paddingLeft: `${12 + depth * 14}px` }}
          className="flex items-center h-[34px] pr-2 space-x-2"
        >
          <Folder className="w-[18px] h-[18px] text-amber-400/90 flex-shrink-0" />
          <input
            type="text"
            value={renameTitle}
            onChange={(e) => {
              if (onChangeEditTitle && isRenaming && editingTarget?.id === node.id) {
                onChangeEditTitle(e.target.value);
              } else {
                setLocalRenameTitle(e.target.value);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleCancelRename();
            }}
            onBlur={(e) => {
              if (
                e.currentTarget.form &&
                e.relatedTarget &&
                e.currentTarget.form.contains(e.relatedTarget as Node)
              ) {
                return;
              }
              handleConfirmRename();
            }}
            autoFocus
            onFocus={(e) => e.target.select()}
            className="flex-1 bg-zinc-200 dark:bg-zinc-800 border border-[var(--theme-accent)] rounded px-1.5 py-0.5 text-[13px] text-zinc-900 dark:text-white focus:outline-none"
          />
          <button
            type="submit"
            data-tooltip="Confirm"
            onMouseDown={(e) => e.preventDefault()}
            className="p-1 rounded text-emerald-500 hover:bg-emerald-500/20"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            data-tooltip="Cancel"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleCancelRename}
            className="p-1 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </form>
      ) : (
        <div
          role="button"
          tabIndex={0}
          data-flip-id={`bm-${node.id}`}
          data-folder-id={node.id}
          draggable={true}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => onToggleCollapse(node.id)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (onStartRename) {
              onStartRename('folder', node.id, node.title || '');
            } else {
              setLocalRenameTitle(node.title || '');
              setLocalIsRenaming(true);
            }
          }}
          onContextMenu={handleContextMenu}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleCollapse(node.id);
            }
          }}
          style={
            {
              paddingLeft: `${12 + depth * 14}px`,
              '--drop-indent': `${12 + depth * 14}px`
            } as React.CSSProperties
          }
          className={`group relative flex items-center justify-between h-[34px] pr-2 rounded-lg cursor-pointer transition-[background-color,color,opacity,box-shadow] duration-150 outline-none ${
            isDragging ? 'opacity-40' : ''
          } ${isRecentlyMoved ? 'arctic-drop-settle' : ''} ${
            dropState === 'top'
              ? 'theme-drag-over-top'
              : dropState === 'bottom'
              ? 'theme-drag-over-bottom'
              : dropState === 'inside'
              ? 'theme-drag-over-inside'
              : 'text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          <div
            className="flex items-center min-w-0 flex-1 space-x-2 mr-2"
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (onStartRename) {
                onStartRename('folder', node.id, node.title || '');
              } else {
                setLocalRenameTitle(node.title || '');
                setLocalIsRenaming(true);
              }
            }}
          >
            <div className="relative w-4 h-4 flex items-center justify-center flex-shrink-0">
              {dropState === 'inside' ? (
                <FolderOpen className="w-[18px] h-[18px] text-amber-500 dark:text-amber-400 scale-110 transition-transform duration-150 flex-shrink-0" />
              ) : isCollapsed ? (
                <>
                  <Folder className="w-[18px] h-[18px] text-zinc-400 dark:text-zinc-500 group-hover:hidden transition-colors flex-shrink-0" />
                  <FolderOpen className="w-[18px] h-[18px] text-amber-500 dark:text-amber-400 hidden group-hover:block transition-colors flex-shrink-0" />
                </>
              ) : (
                <>
                  <FolderOpen className="w-[18px] h-[18px] text-amber-500 dark:text-amber-400 group-hover:hidden transition-colors flex-shrink-0" />
                  <Folder className="w-[18px] h-[18px] text-zinc-400 dark:text-zinc-500 hidden group-hover:block transition-colors flex-shrink-0" />
                </>
              )}
            </div>

            <span
              className="truncate text-[13.5px] font-medium text-zinc-700 dark:text-zinc-200 group-hover:text-zinc-950 dark:group-hover:text-white select-none"
            >
              {node.title || 'Untitled Folder'}
            </span>
          </div>

          <div className="flex items-center flex-shrink-0">
            {/* Add Subfolder (subtle hover action; other folder actions live in right-click menu) */}
            <button
              type="button"
              data-tooltip="New subfolder"
              onClick={handleStartCreateSubfolder}
              className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded-md text-zinc-400/80 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5 stroke-[2]" />
            </button>
          </div>
        </div>
      )}

      {/* Expanded Children Container */}
      {!isCollapsed && (
        <div className={`flex flex-col ${isSelfOrAncestorBeingDragged ? 'opacity-40 pointer-events-none' : ''}`}>
          {/* Inline Subfolder Input Row if active */}
          {isCreatingSubfolder && (
            <form
              onSubmit={handleConfirmSubfolder}
              style={{ paddingLeft: `${24 + depth * 14}px` }}
              className="flex items-center h-[34px] pr-2 my-0.5 space-x-2 animate-in fade-in slide-in-from-top-1 duration-100"
            >
              <Folder className="w-[18px] h-[18px] text-amber-500 dark:text-amber-400 flex-shrink-0" />
              <input
                type="text"
                value={newSubfolderTitle}
                onChange={(e) => setNewSubfolderTitle(e.target.value)}
                placeholder="Subfolder name..."
                onKeyDown={(e) => {
                  if (e.key === 'Escape') handleCancelSubfolder();
                }}
                autoFocus
                className="flex-1 bg-zinc-200 dark:bg-zinc-800 border border-[var(--theme-accent)] rounded px-2 py-0.5 text-xs text-zinc-900 dark:text-white placeholder-zinc-500 focus:outline-none"
              />
              <button
                type="submit"
                data-tooltip="Create"
                className="p-1 rounded text-emerald-500 hover:bg-emerald-500/20"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                data-tooltip="Cancel"
                onClick={handleCancelSubfolder}
                className="p-1 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          )}

          {/* Render Child Items */}
          {children.length === 0 && !isCreatingSubfolder ? (
            <div
              onDragOver={(e) => {
                if (
                  activeDrag?.type === 'folder' &&
                  isFolderSelfOrDescendant(effectiveRoots, activeDrag.id, node.id)
                ) {
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                setDropState('inside');
              }}
              onDragLeave={handleDragLeave}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDropState(null);
                endDragSession();
                const data = parseDragPayload(e);
                if (!data || data.id === node.id) return;
                if (
                  data.type === 'folder' &&
                  isFolderSelfOrDescendant(effectiveRoots, String(data.id), node.id)
                ) {
                  return;
                }
                onDropItemToFolder?.(data as { type: string; [key: string]: unknown }, node.id);
              }}
              style={{ paddingLeft: `${24 + depth * 14}px` }}
              className="py-1 text-[11px] text-zinc-400 dark:text-zinc-600 italic select-none"
            >
              Empty folder
            </div>
          ) : (
            children.map((child) => {
              const childIsFolder = !child.url;
              if (childIsFolder) {
                return (
                  <FolderNode
                    key={child.id}
                    node={child}
                    depth={depth + 1}
                    collapsedFolderIds={collapsedFolderIds}
                    bindingsByBookmarkId={bindingsByBookmarkId}
                    tabsByTabId={tabsByTabId}
                    activeTabId={activeTabId}
                    spaces={spaces}
                    activeSpaceId={activeSpaceId}
                    onRowClick={onRowClick}
                    onFaviconClick={onFaviconClick}
                    onFaviconDoubleClick={onFaviconDoubleClick}
                    onCloseTab={onCloseTab}
                    onReloadTab={onReloadTab}
                    onDuplicateTab={onDuplicateTab}
                    onDiscardTab={onDiscardTab}
                    onToggleMuteTab={onToggleMuteTab}
                    onMoveToSpace={onMoveToSpace}
                    onReplaceUrl={onReplaceUrl}
                    discardedTabsByTabId={discardedTabsByTabId}
                    onToggleCollapse={onToggleCollapse}
                    onBookmarkCurrentPage={onBookmarkCurrentPage}
                    onCreateFolder={onCreateFolder}
                    onRenameFolder={onRenameFolder}
                    onRenameBookmark={onRenameBookmark}
                    onOpenContextMenu={onOpenContextMenu}
                    onDeleteBookmark={onDeleteBookmark}
                    onUnpinBookmark={onUnpinBookmark}
                    onMoveToQuickAccess={onMoveToQuickAccess}
                    onMoveBookmarkToIndex={onMoveBookmarkToIndex}
                    onDropItemToFolder={onDropItemToFolder}
                    getReminderForBookmark={getReminderForBookmark}
                    onOpenReminderPopover={onOpenReminderPopover}
                    onCreateGoogleDoc={onCreateGoogleDoc}
                    selectedBookmarkIds={selectedBookmarkIds}
                    onSelectBookmark={onSelectBookmark}
                    onDeleteMultipleBookmarks={onDeleteMultipleBookmarks}
                    onMoveMultipleBookmarksToSpace={onMoveMultipleBookmarksToSpace}
                    treeRoots={effectiveRoots}
                    densityMode={densityMode}
                    editingTarget={editingTarget}
                    onStartRename={onStartRename}
                    onChangeEditTitle={onChangeEditTitle}
                    onSaveRename={onSaveRename}
                    onCancelRename={onCancelRename}
                  />
                );
              }

              const binding = bindingsByBookmarkId[child.id];
              const boundTab = binding ? tabsByTabId[binding.tabId] : undefined;
              const isActive = Boolean(binding && binding.tabId === activeTabId);
              const isDiscarded = Boolean(binding && discardedTabsByTabId[binding.tabId]);
              const isEditing = Boolean(editingTarget && editingTarget.type === 'bookmark' && editingTarget.id === child.id);

              return (
                <BookmarkRow
                  key={child.id}
                  bookmark={child}
                  depth={depth + 1}
                  binding={binding}
                  boundTab={boundTab}
                  isActive={isActive}
                  isDiscarded={isDiscarded}
                  spaces={spaces}
                  activeSpaceId={activeSpaceId}
                  onRowClick={onRowClick}
                  onFaviconClick={onFaviconClick}
                  onFaviconDoubleClick={onFaviconDoubleClick}
                  onCloseTab={onCloseTab}
                  onReloadTab={onReloadTab}
                  onDuplicateTab={onDuplicateTab}
                  onDiscardTab={onDiscardTab}
                  onToggleMuteTab={onToggleMuteTab}
                  onMoveToSpace={onMoveToSpace}
                  onReplaceUrl={onReplaceUrl}
                  onRenameBookmark={onRenameBookmark}
                  onOpenContextMenu={onOpenContextMenu}
                  onDeleteBookmark={onDeleteBookmark}
                  onUnpinBookmark={onUnpinBookmark}
                  onMoveToQuickAccess={onMoveToQuickAccess}
                  onMoveBookmarkToIndex={onMoveBookmarkToIndex}
                  onDropItemToFolder={onDropItemToFolder}
                  reminder={getReminderForBookmark?.(child.id)}
                  onOpenReminderPopover={onOpenReminderPopover}
                  densityMode={densityMode}
                  isSelected={Boolean(selectedBookmarkIds?.has(child.id))}
                  selectedBookmarkIds={selectedBookmarkIds}
                  onSelectBookmark={onSelectBookmark}
                  onDeleteMultipleBookmarks={onDeleteMultipleBookmarks}
                  onMoveMultipleBookmarksToSpace={onMoveMultipleBookmarksToSpace}
                  treeRoots={effectiveRoots}
                  isEditing={isEditing}
                  editTitle={isEditing && editingTarget ? editingTarget.title : (child.title || '')}
                  onStartRename={() => onStartRename?.('bookmark', child.id, child.title || '')}
                  onChangeEditTitle={onChangeEditTitle}
                  onSaveRename={onSaveRename}
                  onCancelRename={onCancelRename}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
