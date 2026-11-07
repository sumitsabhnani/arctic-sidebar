import React, { useState } from 'react';
import {
  X,
  Palette,
  Moon,
  Sun,
  Check,
  FolderTree,
  RotateCcw,
  Clock,
  Coffee,
  Heart,
  LayoutGrid,
  Activity,
  Loader2,
  PanelLeft,
  ExternalLink
} from 'lucide-react';
import type { BookmarkFolderOption, ColorThemeId, ThemeMode } from '../../types';
import { COLOR_THEMES } from '../utils/theme';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemeMode;
  colorTheme: ColorThemeId;
  quickAccessDensity?: 'relaxed' | 'compact';
  tabsDensity?: 'relaxed' | 'compact';
  densityMode?: 'relaxed' | 'compact';
  showMemorySaverBar: boolean;
  allFolders: BookmarkFolderOption[];
  activeFolderIds: {
    quickAccessId: string | null;
    workspaceId: string | null;
    defaultRootId: string | null;
  };
  autoArchiveInterval: 'never' | '12h' | '24h' | '7d';
  onToggleTheme: () => void;
  onSelectColorTheme: (themeId: ColorThemeId) => void;
  onToggleQuickAccessDensity?: (mode: 'relaxed' | 'compact') => void;
  onToggleTabsDensity?: (mode: 'relaxed' | 'compact') => void;
  onToggleMemorySaverBar: (show: boolean) => void;
  onSelectQuickAccessFolder: (id: string) => void;
  onSelectWorkspaceFolder: (id: string) => void;
  onResetFolders: () => void;
  onSetAutoArchiveInterval: (val: 'never' | '12h' | '24h' | '7d') => void;
  onDiscardAllBackgroundTabs?: () => Promise<number | void> | number | void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  theme,
  colorTheme,
  quickAccessDensity = 'relaxed',
  tabsDensity = 'compact',
  showMemorySaverBar,
  allFolders,
  activeFolderIds,
  autoArchiveInterval,
  onToggleTheme,
  onSelectColorTheme,
  onToggleQuickAccessDensity,
  onToggleTabsDensity,
  onToggleMemorySaverBar,
  onSelectQuickAccessFolder,
  onSelectWorkspaceFolder,
  onResetFolders,
  onSetAutoArchiveInterval,
  onDiscardAllBackgroundTabs
}) => {
  const [isHibernating, setIsHibernating] = useState(false);
  const [hibernateFeedback, setHibernateFeedback] = useState<{ text: string; isError?: boolean } | null>(null);

  if (!isOpen) return null;

  const qaDensity = quickAccessDensity;
  const tDensity = tabsDensity;

  const handleHibernate = async () => {
    if (!onDiscardAllBackgroundTabs || isHibernating) return;
    setIsHibernating(true);
    setHibernateFeedback(null);
    try {
      const count = await onDiscardAllBackgroundTabs();
      if (typeof count === 'number') {
        if (count > 0) {
          setHibernateFeedback({
            text: `Hibernated ${count} background ${count === 1 ? 'tab' : 'tabs'} (~${count * 75} MB freed)`
          });
        } else {
          setHibernateFeedback({
            text: 'All background tabs are already hibernated (or only active tab open).'
          });
        }
      } else {
        setHibernateFeedback({ text: 'Background tabs hibernated' });
      }
    } catch {
      setHibernateFeedback({ text: 'Could not hibernate tabs', isError: true });
    } finally {
      setIsHibernating(false);
      setTimeout(() => {
        setHibernateFeedback(null);
      }, 4000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        style={{
          backgroundColor: 'var(--theme-header-bg)',
          borderColor: 'var(--theme-border-subtle)'
        }}
        className="w-full max-h-[85vh] rounded-t-2xl sm:rounded-2xl border shadow-2xl flex flex-col overflow-hidden text-zinc-800 dark:text-zinc-200 text-xs animate-in slide-in-from-bottom-2 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/[0.08] dark:border-white/[0.08]">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-sm text-zinc-900 dark:text-white">Settings & Appearance</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-4">
          {/* Theme & Mode */}
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

          {/* Quick Access Density */}
          <div className="flex flex-col space-y-1.5 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
                <LayoutGrid className="w-3.5 h-3.5 theme-accent-text" />
                Quick Access Density
              </span>
              <div className="flex items-center space-x-1 bg-black/5 dark:bg-white/5 p-0.5 rounded-lg border border-black/5 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => onToggleQuickAccessDensity?.('relaxed')}
                  className={`px-2.5 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                    qaDensity === 'relaxed'
                      ? 'theme-active-card text-zinc-900 dark:text-white shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  Relaxed
                </button>
                <button
                  type="button"
                  onClick={() => onToggleQuickAccessDensity?.('compact')}
                  className={`px-2.5 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                    qaDensity === 'compact'
                      ? 'theme-active-card text-zinc-900 dark:text-white shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  Compact
                </button>
              </div>
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-normal">
              Relaxed mode shows favicons and short labels in card tiles. Compact mode shows icon-only square tiles.
            </p>
          </div>

          {/* Tabs Density */}
          <div className="flex flex-col space-y-1.5 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
                <LayoutGrid className="w-3.5 h-3.5 theme-accent-text" />
                Tabs Density
              </span>
              <div className="flex items-center space-x-1 bg-black/5 dark:bg-white/5 p-0.5 rounded-lg border border-black/5 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => onToggleTabsDensity?.('relaxed')}
                  className={`px-2.5 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                    tDensity === 'relaxed'
                      ? 'theme-active-card text-zinc-900 dark:text-white shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  Relaxed
                </button>
                <button
                  type="button"
                  onClick={() => onToggleTabsDensity?.('compact')}
                  className={`px-2.5 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                    tDensity === 'compact'
                      ? 'theme-active-card text-zinc-900 dark:text-white shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  Compact
                </button>
              </div>
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-normal">
              Relaxed mode displays two-line rows with domain details. Compact mode uses streamlined single-line rows.
            </p>
          </div>

          {/* Sidebar Position Preference */}
          <div className="flex flex-col space-y-1.5 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
            <div className="flex items-center justify-between">
              <div className="flex flex-col pr-2">
                <span className="font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
                  <PanelLeft className="w-3.5 h-3.5 theme-accent-text" />
                  Sidebar Position (Left / Right)
                </span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Chrome places side panels on the right by default. You can display Arctic on the left side in Chrome settings.
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  try {
                    chrome?.storage?.local?.set?.({ hasDismissedLeftSideTip: true });
                  } catch {
                    // ignore
                  }
                  if (chrome?.tabs?.create) {
                    chrome.tabs.create({ url: 'chrome://settings/appearance' });
                  }
                }}
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-zinc-700 dark:text-zinc-200 text-[11px] font-medium transition-colors flex-shrink-0"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Open Settings</span>
              </button>
            </div>
            <p className="text-[10.5px] text-zinc-400 dark:text-zinc-500 italic">
              In Settings &rarr; Appearance &rarr; Side panel &rarr; choose &quot;Show on left&quot;.
            </p>
          </div>

          {/* Memory Saver Feed Bar Toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
            <div className="flex flex-col pr-2">
              <span className="font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-500" />
                Memory Saver Status Bar
              </span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Display estimated RAM freed by sleeping tabs in the bottom bar.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showMemorySaverBar}
              onClick={() => onToggleMemorySaverBar(!showMemorySaverBar)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                showMemorySaverBar ? 'theme-accent-bg' : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  showMemorySaverBar ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Tab Memory Saver Quick Discard Button with Live Confirmation Feedback */}
          {onDiscardAllBackgroundTabs && (
            <div className="flex flex-col space-y-1.5 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
              <div className="flex items-center justify-between">
                <div className="flex flex-col pr-2">
                  <span className="font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
                    <Moon className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                    Sleep Background Tabs Now
                  </span>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Immediately free RAM by sleeping all inactive tabs in this window.
                  </span>
                </div>
                <button
                  type="button"
                  disabled={isHibernating}
                  onClick={handleHibernate}
                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/10 dark:bg-indigo-500/15 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-[11px] font-medium transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  {isHibernating ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Hibernating...</span>
                    </>
                  ) : hibernateFeedback && !hibernateFeedback.isError ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-500 stroke-[2.5]" />
                      <span className="text-emerald-600 dark:text-emerald-400">Done</span>
                    </>
                  ) : (
                    <span>Hibernate Tabs</span>
                  )}
                </button>
              </div>
              {hibernateFeedback && (
                <div
                  className={`text-[11px] px-2 py-1 rounded-md flex items-center gap-1.5 animate-in fade-in duration-150 ${
                    hibernateFeedback.isError
                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {!hibernateFeedback.isError && <Check className="w-3 h-3 flex-shrink-0 stroke-[2.5]" />}
                  <span>{hibernateFeedback.text}</span>
                </div>
              )}
            </div>
          )}

          {/* Folder Mapping */}
          <div className="flex items-center justify-between pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
            <span className="font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
              <FolderTree className="w-3.5 h-3.5 theme-accent-text" />
              Folder Mapping
            </span>
            <button
              type="button"
              onClick={onResetFolders}
              title="Reset to default 'Arctic' folder"
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
          <div className="flex flex-col space-y-1 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
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

          {/* Support Arctic Sidebar */}
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
        </div>
      </div>
    </div>
  );
};
