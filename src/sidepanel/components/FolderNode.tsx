import React, { useState } from 'react';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
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
  activeTabId: number | null;
  onRowClick: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
  onFaviconClick: (bookmark: chrome.bookmarks.BookmarkTreeNode, e: React.MouseEvent) => void;
  onCloseTab: (tabId: number, e: React.MouseEvent) => void;
  onReloadTab?: (tabId: number) => void;
  onCreateFolder: (parentId: string, title: string) => void;
  onRenameFolder?: (id: string, title: string) => void;
  onOpenContextMenu?: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  onDeleteBookmark?: (id: string) => void;
  onMoveToQuickAccess?: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
}

export const FolderNode: React.FC<FolderNodeProps> = ({
  node,
  depth = 0,
  collapsedFolderIds,
  onToggleCollapse,
  bindingsByBookmarkId,
  activeTabId,
  onRowClick,
  onFaviconClick,
  onCloseTab,
  onReloadTab,
  onCreateFolder,
  onRenameFolder,
  onOpenContextMenu,
  onDeleteBookmark,
  onMoveToQuickAccess
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

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onOpenContextMenu) return;
    e.preventDefault();

    const items: ContextMenuItem[] = [
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
        }
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
    <div className="flex flex-col select-none">
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
            autoFocus
            className="flex-1 bg-zinc-800 border border-cyan-500/50 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
          />
          <button
            type="submit"
            title="Confirm"
            className="p-1 rounded text-emerald-400 hover:bg-emerald-500/20"
          >
            <Check className="w-3 h-3" />
          </button>
          <button
            type="button"
            title="Cancel"
            onClick={handleCancelRename}
            className="p-1 rounded text-zinc-400 hover:text-white"
          >
            <X className="w-3 h-3" />
          </button>
        </form>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => onToggleCollapse(node.id)}
          onContextMenu={handleContextMenu}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleCollapse(node.id);
            }
          }}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          className="group flex items-center justify-between h-[30px] pr-2 rounded-lg cursor-pointer text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors duration-150 outline-none"
        >
          <div className="flex items-center min-w-0 flex-1 space-x-1.5 mr-2">
            {/* Rotating Chevron */}
            <ChevronRight
              className={`w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300 transition-transform duration-200 ${
                isCollapsed ? 'rotate-0' : 'rotate-90'
              }`}
            />

            {/* Folder Icon */}
            {isCollapsed ? (
              <Folder className="w-3.5 h-3.5 text-zinc-400 group-hover:text-amber-400/90 transition-colors flex-shrink-0" />
            ) : (
              <FolderOpen className="w-3.5 h-3.5 text-amber-400/90 transition-colors flex-shrink-0" />
            )}

            {/* Folder Title */}
            <span className="truncate text-xs font-semibold tracking-wide uppercase text-zinc-400 group-hover:text-zinc-200">
              {node.title || 'Untitled Folder'}
            </span>
          </div>

          {/* Right Action: Item count default, + Subfolder button on group hover */}
          <div className="flex items-center space-x-1 flex-shrink-0">
            <button
              type="button"
              title="Add Subfolder"
              onClick={handleStartCreateSubfolder}
              className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-zinc-400 hover:text-amber-300 hover:bg-white/10 transition-colors"
            >
              <FolderPlus className="w-3 h-3" />
            </button>

            <span className="text-[11px] text-zinc-600 group-hover:text-zinc-500 font-mono">
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
              <Folder className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              <input
                type="text"
                value={newSubfolderTitle}
                onChange={(e) => setNewSubfolderTitle(e.target.value)}
                placeholder="Subfolder name..."
                onKeyDown={(e) => {
                  if (e.key === 'Escape') handleCancelSubfolder();
                }}
                autoFocus
                className="flex-1 bg-zinc-800 border border-cyan-500/50 rounded px-2 py-0.5 text-xs text-white placeholder-zinc-500 focus:outline-none"
              />
              <button
                type="submit"
                title="Create"
                className="p-1 rounded text-emerald-400 hover:bg-emerald-500/20"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                type="button"
                title="Cancel"
                onClick={handleCancelSubfolder}
                className="p-1 rounded text-zinc-400 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </form>
          )}

          {itemCount === 0 && !isCreatingSubfolder ? (
            <div
              style={{ paddingLeft: `${24 + depth * 14}px` }}
              className="py-1 text-[11px] text-zinc-600 italic flex items-center justify-between pr-3"
            >
              <span>Empty folder</span>
              <button
                type="button"
                onClick={handleStartCreateSubfolder}
                className="text-amber-400/80 hover:text-amber-300 text-[10px] not-italic hover:underline"
              >
                + Add subfolder
              </button>
            </div>
          ) : (
            children.map((child) => {
              // If child has no URL, it is a subfolder
              if (!child.url) {
                return (
                  <FolderNode
                    key={child.id}
                    node={child}
                    depth={depth + 1}
                    collapsedFolderIds={collapsedFolderIds}
                    onToggleCollapse={onToggleCollapse}
                    bindingsByBookmarkId={bindingsByBookmarkId}
                    activeTabId={activeTabId}
                    onRowClick={onRowClick}
                    onFaviconClick={onFaviconClick}
                    onCloseTab={onCloseTab}
                    onReloadTab={onReloadTab}
                    onCreateFolder={onCreateFolder}
                    onRenameFolder={onRenameFolder}
                    onOpenContextMenu={onOpenContextMenu}
                    onDeleteBookmark={onDeleteBookmark}
                    onMoveToQuickAccess={onMoveToQuickAccess}
                  />
                );
              }

              // Bookmark item
              const binding = bindingsByBookmarkId[child.id];
              const isActive = Boolean(binding && binding.tabId === activeTabId);

              return (
                <BookmarkRow
                  key={child.id}
                  bookmark={child}
                  depth={depth + 1}
                  binding={binding}
                  isActive={isActive}
                  onRowClick={onRowClick}
                  onFaviconClick={onFaviconClick}
                  onCloseTab={onCloseTab}
                  onReloadTab={onReloadTab}
                  onOpenContextMenu={onOpenContextMenu}
                  onDeleteBookmark={onDeleteBookmark}
                  onMoveToQuickAccess={onMoveToQuickAccess}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
