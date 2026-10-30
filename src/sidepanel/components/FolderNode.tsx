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
  X
} from 'lucide-react';
import { BookmarkRow } from './BookmarkRow';
import type { TabBinding } from '../../types';
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
  discardedTabsByTabId?: Record<number, boolean>;
  activeTabId: number | null;
  onRowClick: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onFaviconClick: (bookmark: chrome.bookmarks.BookmarkTreeNode, e: React.MouseEvent) => void;
  onFaviconDoubleClick?: (bookmark: chrome.bookmarks.BookmarkTreeNode, e: React.MouseEvent) => void;
  onCloseTab: (tabId: number, e: React.MouseEvent) => void;
  onReloadTab?: (tabId: number) => void;
  onDiscardTab?: (tabId: number) => void;
  onReplaceUrl?: (bookmarkId: string) => void;
  onCreateFolder: (parentId: string, title: string) => void;
  onBookmarkCurrentPage?: (parentId: string) => void;
  onRenameFolder?: (id: string, title: string) => void;
  onRenameBookmark?: (id: string, title: string) => void;
  onOpenContextMenu?: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  onDeleteBookmark?: (id: string) => void;
  onMoveToQuickAccess?: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onDropItemToFolder?: (data: { type: string; [key: string]: unknown }, targetFolderId: string, targetIndex?: number) => void;
  onMoveBookmarkToIndex?: (draggedId: string, targetParentId: string, targetIndex?: number) => void;
}

export const FolderNode: React.FC<FolderNodeProps> = ({
  node,
  depth = 0,
  collapsedFolderIds,
  onToggleCollapse,
  bindingsByBookmarkId,
  discardedTabsByTabId = {},
  activeTabId,
  onRowClick,
  onFaviconClick,
  onFaviconDoubleClick,
  onCloseTab,
  onReloadTab,
  onDiscardTab,
  onReplaceUrl,
  onCreateFolder,
  onBookmarkCurrentPage,
  onRenameFolder,
  onRenameBookmark,
  onOpenContextMenu,
  onDeleteBookmark,
  onMoveToQuickAccess,
  onDropItemToFolder,
  onMoveBookmarkToIndex
}) => {
  const isCollapsed = Boolean(collapsedFolderIds[node.id]);
  const children = node.children || [];
  const itemCount = children.length;

  // Inline subfolder creation state
  const [isCreatingSubfolder, setIsCreatingSubfolder] = useState(false);
  const [newSubfolderTitle, setNewSubfolderTitle] = useState('');

  // Inline rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(node.title || '');

  // Drop target state
  const [dropState, setDropState] = useState<'inside' | 'top' | 'bottom' | null>(null);

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
    const title = renameTitle.trim();
    if (title && onRenameFolder && title !== node.title) {
      onRenameFolder(node.id, title);
    }
    setIsRenaming(false);
  };

  const handleCancelRename = () => {
    setIsRenaming(false);
    setRenameTitle(node.title || '');
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: 'folder',
        id: node.id,
        parentId: node.parentId,
        title: node.title,
        index: node.index
      })
    );
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const rect = e.currentTarget.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    if (relY < 6) {
      setDropState('top');
    } else if (relY > rect.height - 6) {
      setDropState('bottom');
    } else {
      setDropState('inside');
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropState(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const currentDrop = dropState;
    setDropState(null);

    try {
      const dataStr = e.dataTransfer.getData('application/json');
      if (!dataStr) return;
      const data = JSON.parse(dataStr);

      if (data.id === node.id) return;

      if (data.type === 'openTab') {
        if (currentDrop === 'inside' && onDropItemToFolder) {
          onDropItemToFolder(data, node.id);
        } else if ((currentDrop === 'top' || currentDrop === 'bottom') && node.parentId && onDropItemToFolder) {
          let targetIndex = typeof node.index === 'number' ? node.index : 0;
          if (currentDrop === 'bottom') targetIndex += 1;
          onDropItemToFolder(data, node.parentId, targetIndex);
        }
        return;
      }

      if (currentDrop === 'inside' && onDropItemToFolder) {
        onDropItemToFolder(data, node.id);
      } else if ((currentDrop === 'top' || currentDrop === 'bottom') && node.parentId && onMoveBookmarkToIndex && data.id) {
        let targetIndex = typeof node.index === 'number' ? node.index : 0;
        if (currentDrop === 'bottom') {
          targetIndex += 1;
        }
        onMoveBookmarkToIndex(data.id, node.parentId, targetIndex);
      }
    } catch (err) {
      console.warn('[Arctic] Could not parse dropped data:', err);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onOpenContextMenu) return;
    e.preventDefault();

    const items: ContextMenuItem[] = [
      ...(onBookmarkCurrentPage
        ? [
            {
              label: 'Bookmark Current Page Here',
              icon: <BookmarkPlus className="w-3.5 h-3.5 text-cyan-400" />,
              action: () => onBookmarkCurrentPage(node.id)
            }
          ]
        : []),
      {
        label: 'New Subfolder',
        icon: <FolderPlus className="w-3.5 h-3.5 text-amber-400" />,
        action: () => handleStartCreateSubfolder()
      },
      ...(runningTabIdsUnderFolder.length > 0 && onDiscardTab
        ? [
            {
              label: `Archive All Tabs in Folder (${runningTabIdsUnderFolder.length} open)`,
              icon: <Archive className="w-3.5 h-3.5 text-indigo-400" />,
              action: () => handleArchiveAllTabs()
            }
          ]
        : []),
      {
        label: 'Rename Folder',
        icon: <Edit2 className="w-3.5 h-3.5 text-zinc-400" />,
        action: () => {
          setIsRenaming(true);
          setRenameTitle(node.title || '');
        },
        dividerBefore: true
      },
      ...(onDeleteBookmark
        ? [
            {
              label: 'Delete Folder',
              icon: <Trash2 className="w-3.5 h-3.5 text-rose-400" />,
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
            onChange={(e) => setRenameTitle(e.target.value)}
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
            className="p-1 rounded text-emerald-500 hover:bg-emerald-500/20"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            data-tooltip="Cancel"
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
          draggable={true}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => onToggleCollapse(node.id)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setRenameTitle(node.title || '');
            setIsRenaming(true);
          }}
          onContextMenu={handleContextMenu}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleCollapse(node.id);
            }
          }}
          style={{ paddingLeft: `${12 + depth * 14}px` }}
          className={`group flex items-center justify-between h-[34px] pr-2 rounded-lg cursor-pointer transition-colors duration-150 outline-none ${
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
              setRenameTitle(node.title || '');
              setIsRenaming(true);
            }}
          >
            {/* Folder Icon (no > chevron; aligns with website favicons).
                On hover:
                - If collapsed (closed): show FolderOpen on hover
                - If open: show Folder (closed) on hover
            */}
            <div className="relative w-4 h-4 flex items-center justify-center flex-shrink-0">
              {isCollapsed ? (
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
              className="truncate text-[13.5px] font-medium text-zinc-700 dark:text-zinc-200 group-hover:text-zinc-950 dark:group-hover:text-white cursor-text select-text"
            >
              {node.title || 'Untitled Folder'}
            </span>
          </div>

          <div className="flex items-center space-x-1 flex-shrink-0">
            {/* Archive All Tabs in Folder (Sleep tabs to save RAM) */}
            {runningTabIdsUnderFolder.length > 0 && onDiscardTab && (
              <button
                type="button"
                data-tooltip={`Archive ${runningTabIdsUnderFolder.length} open tab${runningTabIdsUnderFolder.length > 1 ? 's' : ''} (Sleep)`}
                onClick={handleArchiveAllTabs}
                className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Bookmark Current Page */}
            {onBookmarkCurrentPage && (
              <button
                type="button"
                data-tooltip="Bookmark current page here"
                onClick={(e) => {
                  e.stopPropagation();
                  onBookmarkCurrentPage(node.id);
                }}
                className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded text-zinc-400 hover:theme-accent-text hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Add Subfolder */}
            <button
              type="button"
              data-tooltip="New subfolder"
              onClick={handleStartCreateSubfolder}
              className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded text-zinc-400 hover:text-amber-500 dark:hover:text-amber-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>

            <span className="text-[11px] text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-500 font-mono">
              {itemCount}
            </span>
          </div>
        </div>
      )}

      {/* Expanded Children Container */}
      {!isCollapsed && (
        <div className="flex flex-col">
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
                    activeTabId={activeTabId}
                    onRowClick={onRowClick}
                    onFaviconClick={onFaviconClick}
                    onFaviconDoubleClick={onFaviconDoubleClick}
                    onCloseTab={onCloseTab}
                    onReloadTab={onReloadTab}
                    onDiscardTab={onDiscardTab}
                    discardedTabsByTabId={discardedTabsByTabId}
                    onToggleCollapse={onToggleCollapse}
                    onBookmarkCurrentPage={onBookmarkCurrentPage}
                    onCreateFolder={onCreateFolder}
                    onRenameFolder={onRenameFolder}
                    onRenameBookmark={onRenameBookmark}
                    onOpenContextMenu={onOpenContextMenu}
                    onDeleteBookmark={onDeleteBookmark}
                    onMoveToQuickAccess={onMoveToQuickAccess}
                    onMoveBookmarkToIndex={onMoveBookmarkToIndex}
                    onDropItemToFolder={onDropItemToFolder}
                  />
                );
              }

              const binding = bindingsByBookmarkId[child.id];
              const isActive = Boolean(binding && binding.tabId === activeTabId);
              const isDiscarded = Boolean(binding && discardedTabsByTabId[binding.tabId]);

              return (
                <BookmarkRow
                  key={child.id}
                  bookmark={child}
                  depth={depth + 1}
                  binding={binding}
                  isActive={isActive}
                  isDiscarded={isDiscarded}
                  onRowClick={onRowClick}
                  onFaviconClick={onFaviconClick}
                  onFaviconDoubleClick={onFaviconDoubleClick}
                  onCloseTab={onCloseTab}
                  onReloadTab={onReloadTab}
                  onDiscardTab={onDiscardTab}
                  onReplaceUrl={onReplaceUrl}
                  onRenameBookmark={onRenameBookmark}
                  onOpenContextMenu={onOpenContextMenu}
                  onDeleteBookmark={onDeleteBookmark}
                  onMoveToQuickAccess={onMoveToQuickAccess}
                  onMoveBookmarkToIndex={onMoveBookmarkToIndex}
                  onDropItemToFolder={onDropItemToFolder}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
