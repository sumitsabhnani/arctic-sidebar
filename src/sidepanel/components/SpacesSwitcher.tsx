import React, { useState } from 'react';
import {
  Home,
  Briefcase,
  User,
  BookOpen,
  Code,
  Sparkles,
  Folder,
  Plus,
  Check,
  X,
  Edit2,
  Trash2,
  StickyNote,
  Settings
} from 'lucide-react';
import type { SpaceItem } from '../../types';
import type { ContextMenuItem } from './ContextMenu';

interface SpacesSwitcherProps {
  spaces: SpaceItem[];
  activeSpaceId: string;
  onSelectSpace: (spaceId: string) => void;
  onCreateSpace: (name: string, icon?: string) => void;
  onRenameSpace: (spaceId: string, newName: string) => void;
  onDeleteSpace: (spaceId: string) => void;
  onDropItemToSpace?: (data: { type: string; [key: string]: unknown }, targetFolderId: string) => void;
  onOpenContextMenu?: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  isScratchpadOpen?: boolean;
  onToggleScratchpad?: () => void;
  hasScratchpadText?: boolean;
  onOpenSettings?: () => void;
  showMemorySaverBar?: boolean;
  discardedTabsCount?: number;
}

const SPACE_ICONS: { id: string; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'briefcase', label: 'Work' },
  { id: 'user', label: 'Personal' },
  { id: 'book', label: 'Study' },
  { id: 'code', label: 'Dev' },
  { id: 'sparkles', label: 'Creative' }
];

export function renderSpaceIcon(iconName?: string, className: string = 'w-3.5 h-3.5') {
  switch (iconName) {
    case 'home':
      return <Home className={className} />;
    case 'briefcase':
      return <Briefcase className={className} />;
    case 'user':
      return <User className={className} />;
    case 'book':
      return <BookOpen className={className} />;
    case 'code':
      return <Code className={className} />;
    case 'sparkles':
      return <Sparkles className={className} />;
    default:
      return <Folder className={className} />;
  }
}

export const SpacesSwitcher: React.FC<SpacesSwitcherProps> = ({
  spaces,
  activeSpaceId,
  onSelectSpace,
  onCreateSpace,
  onRenameSpace,
  onDeleteSpace,
  onDropItemToSpace,
  onOpenContextMenu,
  isScratchpadOpen,
  onToggleScratchpad,
  hasScratchpadText,
  onOpenSettings,
  showMemorySaverBar = true,
  discardedTabsCount = 0
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceIcon, setNewSpaceIcon] = useState('book');
  const [dragOverSpaceId, setDragOverSpaceId] = useState<string | null>(null);

  const handleConfirmAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSpaceName.trim();
    if (trimmed) {
      onCreateSpace(trimmed, newSpaceIcon);
    }
    setIsAdding(false);
    setNewSpaceName('');
  };

  const handleSpaceContextMenu = (e: React.MouseEvent, space: SpaceItem) => {
    if (!onOpenContextMenu) return;
    e.preventDefault();

    const items: ContextMenuItem[] = [
      {
        label: `Rename "${space.name}"`,
        icon: <Edit2 className="w-3.5 h-3.5" />,
        action: () => {
          const next = window.prompt('Rename Space:', space.name);
          if (next && next.trim()) {
            onRenameSpace(space.id, next.trim());
          }
        }
      },
      ...(spaces.length > 1
        ? [
            {
              label: `Remove "${space.name}" Space`,
              icon: <Trash2 className="w-3.5 h-3.5" />,
              action: () => onDeleteSpace(space.id),
              danger: true,
              dividerBefore: true
            }
          ]
        : [])
    ];

    onOpenContextMenu(e, items);
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--theme-header-bg)',
        borderColor: 'var(--theme-border-subtle)'
      }}
      className="flex flex-col w-full border-t backdrop-blur-md transition-colors duration-200"
    >
      {/* Inline New Space Form */}
      {isAdding && (
        <form
          onSubmit={handleConfirmAdd}
          className="px-2.5 py-2 border-b border-black/[0.06] dark:border-white/[0.06] flex flex-col space-y-2 animate-in fade-in slide-in-from-bottom-1 duration-150"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
              Create New Space
            </span>
            <div className="flex items-center space-x-1">
              {SPACE_ICONS.map((ic) => (
                <button
                  key={ic.id}
                  type="button"
                  title={ic.label}
                  onClick={() => setNewSpaceIcon(ic.id)}
                  className={`p-1 rounded-md transition-colors ${
                    newSpaceIcon === ic.id
                      ? 'theme-accent-bg text-white dark:text-black shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10'
                  }`}
                >
                  {renderSpaceIcon(ic.id, 'w-3 h-3')}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center space-x-1.5">
            <input
              type="text"
              value={newSpaceName}
              onChange={(e) => setNewSpaceName(e.target.value)}
              placeholder="Space name (e.g. Study, Design)..."
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsAdding(false);
                  setNewSpaceName('');
                }
              }}
              autoFocus
              className="flex-1 bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-lg px-2.5 py-1 text-xs text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:border-[var(--theme-accent)]"
            />
            <button
              type="submit"
              title="Create Space"
              className="p-1.5 rounded-lg theme-accent-bg text-white dark:text-black hover:opacity-90 transition-opacity"
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
            <button
              type="button"
              title="Cancel"
              onClick={() => {
                setIsAdding(false);
                setNewSpaceName('');
              }}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      )}

      {/* Memory Saver Feed Information Strip */}
      {showMemorySaverBar && (
        <div className="flex items-center px-3 py-1 border-b border-black/[0.05] dark:border-white/[0.06] text-[10.5px] text-zinc-500 dark:text-zinc-400 font-medium select-none">
          <div
            title={
              discardedTabsCount > 0
                ? `${discardedTabsCount} sleeping ${
                    discardedTabsCount === 1 ? 'tab' : 'tabs'
                  } freeing ~${discardedTabsCount * 75} MB of RAM. Click any sleeping tab to wake it up.`
                : 'Memory Saver is active (0 MB currently freed). Idle background tabs will sleep automatically or via Settings > Hibernate Tabs.'
            }
            className="flex items-center space-x-1.5 min-w-0"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 bg-emerald-500 ${
                discardedTabsCount > 0 ? 'animate-pulse' : ''
              }`}
            />
            <span className="truncate">
              Memory Saver Active: ~{discardedTabsCount * 75} MB freed
            </span>
          </div>
        </div>
      )}

      {/* Bottom Spaces Dock / Footer Bar */}
      <div className="flex items-center justify-between px-2 py-1.5 gap-1">
        {/* Left Footer Utilities: Scratchpad Button */}
        {onToggleScratchpad && (
          <div className="flex items-center pl-0.5 pr-1 flex-shrink-0">
            <button
              type="button"
              data-tooltip="Scratchpad (Quick notes synced across devices)"
              title="Scratchpad (Quick notes synced across devices)"
              onClick={onToggleScratchpad}
              className={`relative p-1.5 rounded-xl transition-all ${
                isScratchpadOpen
                  ? 'theme-accent-text theme-accent-tint shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10'
              }`}
            >
              <StickyNote className="w-3.5 h-3.5" />
              {hasScratchpadText && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full theme-active-indicator" />
              )}
            </button>
            <div className="w-px h-3.5 bg-black/10 dark:bg-white/10 ml-1 mr-0.5" />
          </div>
        )}

        <div className="flex items-center gap-1 flex-1 overflow-x-auto no-scrollbar">
          {spaces.map((space) => {
            const isActive = space.id === activeSpaceId;
            const isDragOver = dragOverSpaceId === space.id;

            return (
              <button
                key={space.id}
                type="button"
                title={`${space.name} Space (Click to switch, Right-click to edit, or Drop tabs here)`}
                onClick={() => onSelectSpace(space.id)}
                onContextMenu={(e) => handleSpaceContextMenu(e, space)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverSpaceId(space.id);
                }}
                onDragLeave={() => setDragOverSpaceId(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverSpaceId(null);
                  try {
                    const dataStr = e.dataTransfer.getData('application/json');
                    if (!dataStr) return;
                    const data = JSON.parse(dataStr);
                    onDropItemToSpace?.(data, space.folderId);
                  } catch {
                    // ignore
                  }
                }}
                className={`group relative flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs transition-all duration-150 flex-1 min-w-0 ${
                  isDragOver
                    ? 'theme-drag-over-inside scale-105'
                    : isActive
                    ? 'theme-active-card text-zinc-900 dark:text-white font-semibold shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                <span
                  className={`flex-shrink-0 transition-transform duration-150 group-hover:scale-105 ${
                    isActive ? 'theme-accent-text' : ''
                  }`}
                >
                  {renderSpaceIcon(space.icon, 'w-3.5 h-3.5')}
                </span>
                <span className="truncate text-[11.5px] leading-none">{space.name}</span>
              </button>
            );
          })}
        </div>

        {/* Add Space Button */}
        <button
          type="button"
          title="Add New Space"
          onClick={() => setIsAdding((prev) => !prev)}
          className={`p-1.5 rounded-xl flex-shrink-0 transition-colors ${
            isAdding
              ? 'theme-accent-text theme-accent-tint'
              : 'text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>

        {/* Settings Button */}
        {onOpenSettings && (
          <button
            type="button"
            title="Settings & Appearance"
            data-tooltip="Settings & Appearance"
            data-tooltip-pos="bottom-right"
            onClick={onOpenSettings}
            className="p-1.5 rounded-xl flex-shrink-0 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
