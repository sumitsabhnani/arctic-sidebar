import React, { useState } from 'react';
import {
  Settings,
  FolderTree,
  ChevronsUpDown,
  ExternalLink,
  Plus,
  Compass,
  Check,
  RotateCcw
} from 'lucide-react';
import type { BookmarkFolderOption } from '../../types';

interface HeaderProps {
  allFolders: BookmarkFolderOption[];
  activeFolderIds: {
    quickAccessId: string | null;
    workspaceId: string | null;
    defaultRootId: string | null;
  };
  onSelectQuickAccessFolder: (id: string) => void;
  onSelectWorkspaceFolder: (id: string) => void;
  onResetFolders: () => void;
  onToggleAllCollapsed: (collapsed: boolean) => void;
  onCreateFolder: (parentId: string, title: string) => void;
  onCreateBookmark: (parentId: string, title: string, url: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  allFolders,
  activeFolderIds,
  onSelectQuickAccessFolder,
  onSelectWorkspaceFolder,
  onResetFolders,
  onToggleAllCollapsed,
  onCreateFolder,
  onCreateBookmark
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [areAllCollapsed, setAreAllCollapsed] = useState(false);

  // Add Item state
  const [addType, setAddType] = useState<'bookmark' | 'folder'>('bookmark');
  const [addTitle, setAddTitle] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [targetFolderId, setTargetFolderId] = useState(activeFolderIds.workspaceId || '');

  const handleToggleExpandAll = () => {
    const nextState = !areAllCollapsed;
    setAreAllCollapsed(nextState);
    onToggleAllCollapsed(nextState);
  };

  const handleOpenBookmarkManager = () => {
    chrome.tabs.create({ url: 'chrome://bookmarks' });
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const folderId = targetFolderId || activeFolderIds.workspaceId;
    if (!folderId || !addTitle.trim()) return;

    if (addType === 'folder') {
      onCreateFolder(folderId, addTitle.trim());
    } else {
      let finalUrl = addUrl.trim();
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = `https://${finalUrl}`;
      }
      onCreateBookmark(folderId, addTitle.trim(), finalUrl);
    }

    setAddTitle('');
    setAddUrl('');
    setShowAddModal(false);
  };

  return (
    <div className="relative flex flex-col w-full border-b border-white/[0.08] bg-[#161618]/80 backdrop-blur-md">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-3 h-11">
        {/* Logo & Title */}
        <div className="flex items-center space-x-2">
          <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-[0_0_8px_rgba(6,182,212,0.4)]">
            <Compass className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="flex items-baseline space-x-1.5">
            <span className="text-sm font-semibold tracking-tight text-white">Arctic</span>
            <span className="text-[10px] uppercase font-mono tracking-widest text-zinc-500">Sidebar</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-1">
          {/* Quick Add Bookmark/Folder */}
          <button
            type="button"
            title="Add bookmark or folder"
            onClick={() => {
              setTargetFolderId(activeFolderIds.workspaceId || '');
              setShowAddModal(true);
            }}
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          {/* Toggle Expand / Collapse All */}
          <button
            type="button"
            title={areAllCollapsed ? 'Expand all folders' : 'Collapse all folders'}
            onClick={handleToggleExpandAll}
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ChevronsUpDown className="w-3.5 h-3.5" />
          </button>

          {/* Open Chrome Bookmark Manager */}
          <button
            type="button"
            title="Open Chrome Bookmark Manager"
            onClick={handleOpenBookmarkManager}
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>

          {/* Settings Dropdown Toggle */}
          <button
            type="button"
            title="Folder Mapping Settings"
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1 rounded-md transition-colors ${
              showSettings
                ? 'text-cyan-400 bg-white/10'
                : 'text-zinc-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Settings Panel / Dropdown */}
      {showSettings && (
        <div className="p-3 border-t border-white/[0.08] bg-[#1a1a1d] text-zinc-300 text-xs flex flex-col space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white flex items-center gap-1.5">
              <FolderTree className="w-3.5 h-3.5 text-cyan-400" />
              Folder Mapping
            </span>
            <button
              type="button"
              onClick={onResetFolders}
              title="Reset to default 'Arc Sidebar' folder"
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Reset Defaults
            </button>
          </div>

          {/* Quick Access Mapping Selector */}
          <div className="flex flex-col space-y-1">
            <label className="text-[11px] font-medium text-zinc-400">
              Quick Access Folder (Top Grid)
            </label>
            <select
              value={activeFolderIds.quickAccessId || ''}
              onChange={(e) => onSelectQuickAccessFolder(e.target.value)}
              className="w-full bg-zinc-900 border border-white/10 rounded-md px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500/50"
            >
              {allFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.path}
                </option>
              ))}
            </select>
          </div>

          {/* Workspace Mapping Selector */}
          <div className="flex flex-col space-y-1">
            <label className="text-[11px] font-medium text-zinc-400">
              Workspace Folder (Sidebar Tree)
            </label>
            <select
              value={activeFolderIds.workspaceId || ''}
              onChange={(e) => onSelectWorkspaceFolder(e.target.value)}
              className="w-full bg-zinc-900 border border-white/10 rounded-md px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500/50"
            >
              {allFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.path}
                </option>
              ))}
            </select>
          </div>

          <p className="text-[11px] text-zinc-500 italic">
            Default folders are stored inside Chrome&apos;s &quot;Other Bookmarks&quot; &gt; &quot;Arc Sidebar&quot;.
          </p>
        </div>
      )}

      {/* Add Item Modal */}
      {showAddModal && (
        <form
          onSubmit={handleQuickAdd}
          className="p-3 border-t border-white/[0.08] bg-[#1a1a1d] text-zinc-300 text-xs flex flex-col space-y-2.5"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white">Add New Item</span>
            <div className="flex bg-zinc-900 p-0.5 rounded-md border border-white/10">
              <button
                type="button"
                onClick={() => setAddType('bookmark')}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                  addType === 'bookmark'
                    ? 'bg-white/20 text-white font-medium'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Bookmark
              </button>
              <button
                type="button"
                onClick={() => setAddType('folder')}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                  addType === 'folder'
                    ? 'bg-white/20 text-white font-medium'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Folder
              </button>
            </div>
          </div>

          <input
            type="text"
            required
            placeholder={addType === 'bookmark' ? 'Bookmark Title (e.g. Linear)' : 'Folder Title (e.g. Work)'}
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            className="w-full bg-zinc-900 border border-white/10 rounded-md px-2.5 py-1 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50"
            autoFocus
          />

          {addType === 'bookmark' && (
            <input
              type="text"
              required
              placeholder="URL (e.g. https://linear.app)"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              className="w-full bg-zinc-900 border border-white/10 rounded-md px-2.5 py-1 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50"
            />
          )}

          <div className="flex flex-col space-y-1">
            <label className="text-[10px] text-zinc-400">Destination Folder</label>
            <select
              value={targetFolderId}
              onChange={(e) => setTargetFolderId(e.target.value)}
              className="w-full bg-zinc-900 border border-white/10 rounded-md px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500/50"
            >
              {allFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.path}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end space-x-2 pt-1">
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="px-2.5 py-1 rounded text-xs text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center space-x-1 px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors"
            >
              <Check className="w-3 h-3" />
              <span>Add</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
