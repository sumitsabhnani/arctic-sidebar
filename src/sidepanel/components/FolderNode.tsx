import React from 'react';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { BookmarkRow } from './BookmarkRow';
import type { TabBinding } from '../../types';

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
  onCloseTab
}) => {
  const isCollapsed = Boolean(collapsedFolderIds[node.id]);
  const children = node.children || [];
  const itemCount = children.length;

  return (
    <div className="flex flex-col select-none">
      {/* Folder Header Row */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onToggleCollapse(node.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleCollapse(node.id);
          }
        }}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        className="group flex items-center justify-between h-[30px] pr-2 rounded-lg cursor-pointer text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors duration-150 outline-none"
      >
        <div className="flex items-center min-w-0 flex-1 space-x-1.5">
          {/* Rotating Chevron */}
          <ChevronRight
            className={`w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300 transition-transform duration-200 ${
              isCollapsed ? 'rotate-0' : 'rotate-90'
            }`}
          />

          {/* Folder Icon */}
          {isCollapsed ? (
            <Folder className="w-3.5 h-3.5 text-zinc-400 group-hover:text-amber-400/90 transition-colors" />
          ) : (
            <FolderOpen className="w-3.5 h-3.5 text-amber-400/90 transition-colors" />
          )}

          {/* Folder Title */}
          <span className="truncate text-xs font-semibold tracking-wide uppercase text-zinc-400 group-hover:text-zinc-200">
            {node.title || 'Untitled Folder'}
          </span>
        </div>

        {/* Item count preview */}
        <span className="text-[11px] text-zinc-600 group-hover:text-zinc-500 font-mono">
          {itemCount}
        </span>
      </div>

      {/* Expanded Children Container */}
      {!isCollapsed && (
        <div className="flex flex-col">
          {itemCount === 0 ? (
            <div
              style={{ paddingLeft: `${24 + depth * 14}px` }}
              className="py-1 text-[11px] text-zinc-600 italic"
            >
              Empty folder
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
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
