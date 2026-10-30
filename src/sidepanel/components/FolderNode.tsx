import React, { useState } from 'react';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  BookmarkPlus,
  Edit2,
  Trash2,
  Check,
  X
} from 'lucide-react';
import { BookmarkRow } from './BookmarkRow';
import type { TabBinding } from '../../types';
import type { ContextMenuItem } from './ContextMenu';

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
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          className="flex items-center h-[30px] pr-2 space-x-1.5"
        >
          <Folder className="w-3.5 h-3.5 text-amber-400/90 flex-shrink-0" />
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
            className="flex-1 bg-zinc-200 dark:bg-zinc-800 border border-cyan-500 rounded px-1.5 py-0.5 text-xs text-zinc-900 dark:text-white focus:outline-none"
          />
          <button
            type="submit"
            title="Confirm"
            className="p-1 rounded text-emerald-500 hover:bg-emerald-500/20"
          >
            <Check className="w-3 h-3" />
          </button>
          <button
            type="button"
            title="Cancel"
            onClick={handleCancelRename}
            className="p-1 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
          >
            <X className="w-3 h-3" />
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
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          className={`group flex items-center justify-between h-[30px] pr-2 rounded-lg cursor-pointer transition-colors duration-150 outline-none ${
            dropState === 'top'
              ? 'border-t-2 border-cyan-400 bg-cyan-500/10'
              : dropState === 'bottom'
              ? 'border-b-2 border-cyan-400 bg-cyan-500/10'
              : dropState === 'inside'
              ? 'ring-1 ring-cyan-400 bg-cyan-500/15'
              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          <div
            className="flex items-center min-w-0 flex-1 space-x-1.5 mr-2"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenameTitle(node.title || '');
              setIsRenaming(true);
            }}
          >
            <ChevronRight
              className={`w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-transform duration-200 ${
                isCollapsed ? 'rotate-0' : 'rotate-90'
              }`}
            />

            {isCollapsed ? (
              <Folder className="w-3.5 h-3.5 text-zinc-400 group-hover:text-amber-500 dark:group-hover:text-amber-400/90 transition-colors flex-shrink-0" />
            ) : (
              <FolderOpen className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400/90 transition-colors flex-shrink-0" />
            )}

            <span
              title="Double-click to rename folder"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setRenameTitle(node.title || '');
                setIsRenaming(true);
              }}
              className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 cursor-text select-text"
            >
              {node.title || 'Untitled Folder'}
            </span>
          </div>

          <div className="flex items-center space-x-1 flex-shrink-0">
            {onBookmarkCurrentPage && (
              <button
                type="button"
                title="Bookmark current page in this folder"
                onClick={(e) => {
                  e.stopPropagation();
                  onBookmarkCurrentPage(node.id);
                }}
                className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-zinc-400 hover:text-cyan-500 dark:hover:text-cyan-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                <BookmarkPlus className="w-3 h-3" />
              </button>
            )}

            <button
              type="button"
              title="Add Subfolder"
              onClick={handleStartCreateSubfolder}
              className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-zinc-400 hover:text-amber-500 dark:hover:text-amber-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <FolderPlus className="w-3 h-3" />
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
              style={{ paddingLeft: `${22 + depth * 14}px` }}
              className="flex items-center h-[32px] pr-2 my-0.5 space-x-1.5 animate-in fade-in slide-in-from-top-1 duration-100"
            >
              <Folder className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 flex-shrink-0" />
              <input
                type="text"
                value={newSubfolderTitle}
                onChange={(e) => setNewSubfolderTitle(e.target.value)}
                placeholder="Subfolder name..."
                onKeyDown={(e) => {
                  if (e.key === 'Escape') handleCancelSubfolder();
                }}
                autoFocus
                className="flex-1 bg-zinc-200 dark:bg-zinc-800 border border-cyan-500 rounded px-2 py-0.5 text-xs text-zinc-900 dark:text-white placeholder-zinc-500 focus:outline-none"
              />
              <button
                type="submit"
                title="Create"
                className="p-1 rounded text-emerald-500 hover:bg-emerald-500/20"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                type="button"
                title="Cancel"
                onClick={handleCancelSubfolder}
                className="p-1 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </form>
          )}

          {itemCount === 0 && !isCreatingSubfolder ? (
            <div
              style={{ paddingLeft: `${24 + depth * 14}px` }}
              className="py-1 text-[11px] text-zinc-400 dark:text-zinc-600 italic flex items-center justify-between pr-3"
            >
              <span>Empty folder</span>
              <button
                type="button"
                onClick={handleStartCreateSubfolder}
                className="text-amber-500 dark:text-amber-400/80 hover:underline text-[10px] not-italic"
              >
                + Add subfolder
              </button>
            </div>
          ) : (
            children.map((child) => {
              if (!child.url) {
                return (
                  <FolderNode
                    key={child.id}
                    node={child}
                    depth={depth + 1}
                    collapsedFolderIds={collapsedFolderIds}
                    onToggleCollapse={onToggleCollapse}
                    bindingsByBookmarkId={bindingsByBookmarkId}
                    discardedTabsByTabId={discardedTabsByTabId}
                    activeTabId={activeTabId}
                    onRowClick={onRowClick}
                    onFaviconClick={onFaviconClick}
                    onFaviconDoubleClick={onFaviconDoubleClick}
                    onCloseTab={onCloseTab}
                    onReloadTab={onReloadTab}
                    onDiscardTab={onDiscardTab}
                    onReplaceUrl={onReplaceUrl}
                    onCreateFolder={onCreateFolder}
                    onBookmarkCurrentPage={onBookmarkCurrentPage}
                    onRenameFolder={onRenameFolder}
                    onRenameBookmark={onRenameBookmark}
                    onOpenContextMenu={onOpenContextMenu}
                    onDeleteBookmark={onDeleteBookmark}
                    onMoveToQuickAccess={onMoveToQuickAccess}
                    onDropItemToFolder={onDropItemToFolder}
                    onMoveBookmarkToIndex={onMoveBookmarkToIndex}
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
                  onRenameBookmark={onRenameBookmark}
                  onReplaceUrl={onReplaceUrl}
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
