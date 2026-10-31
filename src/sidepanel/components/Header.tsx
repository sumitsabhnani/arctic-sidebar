import React, { useState, useEffect, useRef } from 'react';
import {
  Settings,
  FolderTree,
  ChevronsUpDown,
  Check,
  RotateCcw,
  RotateCw,
  Clock,
  Search,
  Moon,
  Sun,
  Palette,
  Link2,
  Lock,
  Globe,
  Sparkles,
  Coffee,
  Heart
} from 'lucide-react';
import type { BookmarkFolderOption } from '../../types';
import type { ColorThemeId, ThemeMode } from '../utils/theme';
import { COLOR_THEMES } from '../utils/theme';

interface HeaderProps {
  allFolders: BookmarkFolderOption[];
  activeFolderIds: {
    quickAccessId: string | null;
    workspaceId: string | null;
    defaultRootId: string | null;
  };
  autoArchiveInterval: 'never' | '12h' | '24h' | '7d';
  activeTabUrl?: string;
  isActiveTabLoading?: boolean;
  isSearchOpen?: boolean;
  theme: ThemeMode;
  colorTheme: ColorThemeId;
  onSelectQuickAccessFolder: (id: string) => void;
  onSelectWorkspaceFolder: (id: string) => void;
  onResetFolders: () => void;
  onToggleAllCollapsed: (collapsed: boolean) => void;
  onCreateFolder: (parentId: string, title: string) => void;
  onCreateBookmark: (parentId: string, title: string, url: string) => void;
  onSetAutoArchiveInterval: (val: 'never' | '12h' | '24h' | '7d') => void;
  onReloadActiveTab: () => void;
  onNavigateActiveTab?: (input: string) => void;
  onToggleSearch: () => void;
  onToggleTheme: () => void;
  onSelectColorTheme: (themeId: ColorThemeId) => void;
  onDiscardAllBackgroundTabs?: () => void;
}

function formatDisplayUrl(rawUrl?: string): { display: string; isSecure: boolean; isInternal: boolean } {
  if (!rawUrl || rawUrl === 'about:blank' || rawUrl.startsWith('chrome://newtab') || rawUrl.includes('/newtab.html')) {
    return { display: 'Search or enter URL...', isSecure: false, isInternal: true };
  }
  if (rawUrl.startsWith('chrome://') || rawUrl.startsWith('chrome-extension://')) {
    return { display: rawUrl, isSecure: false, isInternal: true };
  }
  try {
    const parsed = new URL(rawUrl);
    const isSecure = parsed.protocol === 'https:';
    let host = parsed.hostname;
    if (host.startsWith('www.')) host = host.slice(4);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    const search = parsed.search || '';
    return {
      display: `${host}${path}${search}`,
      isSecure,
      isInternal: false
    };
  } catch {
    return { display: rawUrl, isSecure: false, isInternal: false };
  }
}

export const Header: React.FC<HeaderProps> = ({
  allFolders,
  activeFolderIds,
  autoArchiveInterval,
  activeTabUrl = '',
  isActiveTabLoading = false,
  isSearchOpen = false,
  theme,
  colorTheme,
  onSelectQuickAccessFolder,
  onSelectWorkspaceFolder,
  onResetFolders,
  onToggleAllCollapsed,
  onCreateFolder,
  onCreateBookmark,
  onSetAutoArchiveInterval,
  onReloadActiveTab,
  onNavigateActiveTab,
  onToggleSearch,
  onToggleTheme,
  onSelectColorTheme,
  onDiscardAllBackgroundTabs
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [areAllCollapsed, setAreAllCollapsed] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // URL Bar Inline Editing State
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [urlInput, setUrlInput] = useState(activeTabUrl);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditingUrl) {
      setUrlInput(activeTabUrl);
    }
  }, [activeTabUrl, isEditingUrl]);

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

  const handleCopyCurrentUrl = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeTabUrl) return;
    navigator.clipboard.writeText(activeTabUrl);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (trimmed && onNavigateActiveTab) {
      onNavigateActiveTab(trimmed);
    }
    setIsEditingUrl(false);
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

  const { display: displayUrl, isSecure, isInternal } = formatDisplayUrl(activeTabUrl);
  const canCopyUrl = Boolean(
    activeTabUrl &&
      activeTabUrl !== 'about:blank' &&
      !activeTabUrl.startsWith('chrome://newtab') &&
      !activeTabUrl.includes('/newtab.html')
  );

  return (
    <div
      style={{
        backgroundColor: 'var(--theme-header-bg)',
        borderColor: 'var(--theme-border-subtle)'
      }}
      className="relative flex flex-col w-full border-b backdrop-blur-md transition-colors duration-200"
    >
      {/* Top Address / URL Bar with Copy Link & Reload */}
      <div className="px-2.5 pt-2 pb-1">
        <div
          className={`flex items-center h-8 px-2.5 rounded-xl border transition-all duration-150 ${
            isEditingUrl
              ? 'bg-white dark:bg-zinc-900 border-[var(--theme-accent)] shadow-sm'
              : 'bg-black/[0.04] dark:bg-white/[0.05] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] border-black/[0.06] dark:border-white/[0.07]'
          }`}
        >
          {/* Protocol / Security Icon */}
          <span className="flex-shrink-0 mr-2 text-zinc-400 dark:text-zinc-500">
            {isInternal ? (
              <Sparkles className="w-3.5 h-3.5 theme-accent-text" />
            ) : isSecure ? (
              <Lock className="w-3 h-3 text-emerald-500/80 dark:text-emerald-400/80" />
            ) : (
              <Globe className="w-3.5 h-3.5" />
            )}
          </span>

          {/* URL Display or Editable Input */}
          {isEditingUrl ? (
            <form onSubmit={handleUrlSubmit} className="flex-1 min-w-0 mr-1">
              <input
                ref={urlInputRef}
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onBlur={() => setIsEditingUrl(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsEditingUrl(false);
                    setUrlInput(activeTabUrl);
                  }
                }}
                placeholder="Search Google or enter URL..."
                autoFocus
                onFocus={(e) => e.target.select()}
                className="w-full bg-transparent text-xs text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none select-text"
              />
            </form>
          ) : (
            <button
              type="button"
              title={activeTabUrl ? `${activeTabUrl}\n(Click to edit URL)` : 'Click to enter URL or search'}
              onClick={() => {
                setUrlInput(canCopyUrl ? activeTabUrl : '');
                setIsEditingUrl(true);
              }}
              className={`flex-1 min-w-0 text-left truncate text-xs mr-1.5 transition-colors ${
                isInternal
                  ? 'text-zinc-400 dark:text-zinc-500'
                  : 'text-zinc-700 dark:text-zinc-200 font-medium'
              }`}
            >
              {displayUrl}
            </button>
          )}

          {/* Right URL Bar Actions: Copy Link & Reload */}
          <div className="flex items-center space-x-0.5 flex-shrink-0">
            {/* Copy Current URL Button */}
            <button
              type="button"
              disabled={!canCopyUrl}
              data-tooltip={isCopied ? 'Copied URL!' : 'Copy URL'}
              data-tooltip-pos="bottom-right"
              onClick={handleCopyCurrentUrl}
              className={`p-1 rounded-md transition-colors ${
                !canCopyUrl
                  ? 'opacity-30 cursor-not-allowed text-zinc-400'
                  : isCopied
                  ? 'text-emerald-500 bg-emerald-500/15'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10'
              }`}
            >
              {isCopied ? (
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              ) : (
                <Link2 className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Reload Active Tab Button */}
            <button
              type="button"
              data-tooltip="Reload (Cmd+R)"
              data-tooltip-pos="bottom-right"
              onClick={onReloadActiveTab}
              className="p-1 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors group"
            >
              <RotateCw
                className={`w-3.5 h-3.5 transition-transform duration-300 ${
                  isActiveTabLoading
                    ? 'animate-spin theme-accent-text'
                    : 'group-active:rotate-180'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Action Items Bar */}
      <div className="flex items-center justify-between px-2.5 h-8 pb-1">
        {/* Left Action Items: Search */}
        <div className="flex items-center space-x-1">
          {/* Toggle Search */}
          <button
            type="button"
            data-tooltip="Search (Cmd+K)"
            data-tooltip-pos="bottom-left"
            onClick={onToggleSearch}
            className={`p-1.5 rounded-md transition-colors ${
              isSearchOpen
                ? 'theme-accent-text theme-accent-tint'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10'
            }`}
          >
            <Search className="w-4 h-4" />
          </button>
        </div>

        {/* Right Action Items: Collapse/Expand Folders & Settings */}
        <div className="flex items-center space-x-1">
          {/* Toggle Expand / Collapse All */}
          <button
            type="button"
            data-tooltip={areAllCollapsed ? 'Expand folders' : 'Collapse folders'}
            data-tooltip-pos="bottom-right"
            onClick={handleToggleExpandAll}
            className="p-1.5 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <ChevronsUpDown className="w-4 h-4" />
          </button>

          {/* Settings Dropdown Toggle */}
          <button
            type="button"
            data-tooltip="Settings & Appearance"
            data-tooltip-pos="bottom-right"
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded-md transition-colors ${
              showSettings
                ? 'theme-accent-text theme-accent-tint'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10'
            }`}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Settings Panel / Dropdown */}
      {showSettings && (
        <div
          style={{
            backgroundColor: 'var(--theme-header-bg)',
            borderColor: 'var(--theme-border-subtle)'
          }}
          className="p-3 border-t text-zinc-800 dark:text-zinc-300 text-xs flex flex-col space-y-3 animate-in fade-in slide-in-from-top-1 duration-150 shadow-lg max-h-[420px] overflow-y-auto"
        >
          {/* Color Themes & Dark/Light Mode Section in Settings */}
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 theme-accent-text" />
                Theme & Appearance
              </span>
              <div className="flex items-center space-x-1 bg-black/5 dark:bg-white/5 p-0.5 rounded-lg border border-black/5 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => theme === 'light' && onToggleTheme()}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 ${
                    theme === 'dark'
                      ? 'bg-black/20 dark:bg-white/15 text-zinc-900 dark:text-white shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  <Moon className="w-3 h-3 text-indigo-400" />
                  <span>Dark</span>
                </button>
                <button
                  type="button"
                  onClick={() => theme === 'dark' && onToggleTheme()}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 ${
                    theme === 'light'
                      ? 'bg-white dark:bg-white/20 text-zinc-900 dark:text-white shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  <Sun className="w-3 h-3 text-amber-500" />
                  <span>Light</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              {COLOR_THEMES.map((t) => {
                const isSelected = colorTheme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelectColorTheme(t.id)}
                    className={`flex items-center space-x-2 p-1.5 rounded-lg border text-left transition-all ${
                      isSelected
                        ? 'theme-active-card font-medium text-zinc-900 dark:text-white'
                        : 'border-black/5 dark:border-white/5 hover:border-black/15 dark:hover:border-white/15 bg-black/[0.02] dark:bg-white/[0.02]'
                    }`}
                  >
                    <div
                      style={{ background: t.swatchGradient }}
                      className="w-4 h-4 rounded-full flex-shrink-0 border border-white/20"
                    />
                    <span className="text-[11px] truncate flex-1">{t.name}</span>
                    {isSelected && <Check className="w-3 h-3 theme-accent-text flex-shrink-0 stroke-[2.5]" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-black/[0.06] dark:border-white/[0.06]">
            <span className="font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
              <FolderTree className="w-3.5 h-3.5 theme-accent-text" />
              Folder Mapping
            </span>
            <button
              type="button"
              onClick={onResetFolders}
              title="Reset to default 'Arctic Sidebar' folder"
              className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Reset Defaults
            </button>
          </div>

          {/* Quick Access Mapping Selector */}
          <div className="flex flex-col space-y-1">
            <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              Quick Access Folder (Top Grid)
            </label>
            <select
              value={activeFolderIds.quickAccessId || ''}
              onChange={(e) => onSelectQuickAccessFolder(e.target.value)}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-white/10 rounded-md px-2 py-1 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-[var(--theme-accent)]"
            >
              {allFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.path}
                </option>
              ))}
            </select>
          </div>

          {/* Active Space Folder Mapping Selector */}
          <div className="flex flex-col space-y-1">
            <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              Active Space Folder (Sidebar Tree)
            </label>
            <select
              value={activeFolderIds.workspaceId || ''}
              onChange={(e) => onSelectWorkspaceFolder(e.target.value)}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-white/10 rounded-md px-2 py-1 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-[var(--theme-accent)]"
            >
              {allFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.path}
                </option>
              ))}
            </select>
          </div>

          {/* Ephemeral / Temp Tabs Auto-Archive Setting */}
          <div className="flex flex-col space-y-1 pt-1 border-t border-black/[0.06] dark:border-white/[0.06]">
            <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 flex items-center gap-1">
              <Clock className="w-3 h-3 theme-accent-text" />
              Auto-Archive Inactive Today&apos;s Tabs
            </label>
            <select
              value={autoArchiveInterval}
              onChange={(e) =>
                onSetAutoArchiveInterval(e.target.value as 'never' | '12h' | '24h' | '7d')
              }
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-white/10 rounded-md px-2 py-1 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-[var(--theme-accent)]"
            >
              <option value="never">Never (Keep until manually cleared)</option>
              <option value="12h">After 12 Hours</option>
              <option value="24h">After 24 Hours (Recommended)</option>
              <option value="7d">After 7 Days</option>
            </select>
          </div>

          {/* Tab Memory Saver / Hibernation */}
          {onDiscardAllBackgroundTabs && (
            <div className="flex items-center justify-between pt-1 border-t border-black/[0.06] dark:border-white/[0.06]">
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 flex items-center gap-1">
                <Moon className="w-3 h-3 text-indigo-500 dark:text-indigo-400" />
                Tab Memory Saver
              </span>
              <button
                type="button"
                onClick={onDiscardAllBackgroundTabs}
                className="flex items-center space-x-1 px-2 py-1 rounded bg-indigo-500/10 dark:bg-indigo-500/15 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-[11px] font-medium transition-colors"
              >
                <span>Sleep Background Tabs</span>
              </button>
            </div>
          )}

          {/* Support Arctic Sidebar / Buy Me a Coffee / GitHub Sponsors */}
          <div className="pt-2 border-t border-black/[0.06] dark:border-white/[0.06] flex flex-col space-y-1.5">
            <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
              Support Arctic Development
            </span>
            <div className="flex items-center space-x-2">
              <a
                href="https://buymeacoffee.com/sumitsabhnani"
                target="_blank"
                rel="noreferrer"
                className="flex-1 flex items-center justify-center space-x-1.5 py-1 px-2 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[11px] font-medium transition-colors border border-amber-500/20"
              >
                <Coffee className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                <span className="truncate">Buy Me a Coffee</span>
              </a>
              <a
                href="https://github.com/sponsors/sumitsabhnani"
                target="_blank"
                rel="noreferrer"
                className="flex-1 flex items-center justify-center space-x-1.5 py-1 px-2 rounded-md bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 text-[11px] font-medium transition-colors border border-rose-500/20"
              >
                <Heart className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
                <span className="truncate">Sponsor</span>
              </a>
            </div>
          </div>

          <p className="text-[11px] text-zinc-500 italic">
            Default folders are stored inside Chrome&apos;s &quot;Other Bookmarks&quot; &gt; &quot;Arctic Sidebar&quot;.
          </p>
        </div>
      )}

      {/* Add Item Modal */}
      {showAddModal && (
        <form
          onSubmit={handleQuickAdd}
          className="p-3 border-t border-black/[0.08] dark:border-white/[0.08] bg-zinc-50 dark:bg-[#1a1a1d] text-zinc-800 dark:text-zinc-300 text-xs flex flex-col space-y-2.5"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-900 dark:text-white">Add New Item</span>
            <div className="flex bg-zinc-200 dark:bg-zinc-900 p-0.5 rounded-md border border-zinc-300 dark:border-white/10">
              <button
                type="button"
                onClick={() => setAddType('bookmark')}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                  addType === 'bookmark'
                    ? 'bg-white dark:bg-white/20 text-zinc-900 dark:text-white font-medium shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
                }`}
              >
                Bookmark
              </button>
              <button
                type="button"
                onClick={() => setAddType('folder')}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                  addType === 'folder'
                    ? 'bg-white dark:bg-white/20 text-zinc-900 dark:text-white font-medium shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
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
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-white/10 rounded-md px-2.5 py-1 text-xs text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:border-[var(--theme-accent)]"
            autoFocus
          />

          {addType === 'bookmark' && (
            <input
              type="text"
              required
              placeholder="URL (e.g. https://linear.app)"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-white/10 rounded-md px-2.5 py-1 text-xs text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:border-[var(--theme-accent)]"
            />
          )}

          <div className="flex flex-col space-y-1">
            <label className="text-[10px] text-zinc-500 dark:text-zinc-400">Destination Folder</label>
            <select
              value={targetFolderId}
              onChange={(e) => setTargetFolderId(e.target.value)}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-white/10 rounded-md px-2 py-1 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-[var(--theme-accent)]"
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
              className="px-2.5 py-1 rounded text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center space-x-1 px-3 py-1 rounded theme-accent-bg hover:opacity-90 text-white dark:text-black font-medium text-xs transition-opacity"
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
