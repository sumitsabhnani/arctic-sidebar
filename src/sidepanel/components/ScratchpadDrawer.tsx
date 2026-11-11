import React, { useRef, useEffect } from 'react';
import {
  StickyNote,
  Trash2,
  Minus,
  CloudOff,
  RefreshCw
} from 'lucide-react';
import type { ScratchpadSyncStatus } from '../hooks/useScratchpad';
import { MAX_CHARS } from '../hooks/useScratchpad';

interface ScratchpadDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  text: string;
  onChange: (text: string) => void;
  syncStatus: ScratchpadSyncStatus;
  onClear: () => void;
  maxChars?: number;
  title?: string;
  placeholder?: string;
}

export const ScratchpadDrawer: React.FC<ScratchpadDrawerProps> = ({
  isOpen,
  onClose,
  text,
  onChange,
  syncStatus,
  onClear,
  maxChars = MAX_CHARS,
  title = 'Scratchpad',
  placeholder = 'Quick notes, URLs, or snippets (synced across devices)...'
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-focus when drawer opens
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        backgroundColor: 'var(--theme-header-bg)',
        borderTopColor: 'var(--theme-accent-border)'
      }}
      className="flex flex-col w-full h-[240px] border-t-2 border-b border-b-black/10 dark:border-b-white/10 backdrop-blur-md shadow-[0_-8px_24px_rgba(0,0,0,0.14)] dark:shadow-[0_-10px_28px_rgba(0,0,0,0.55)] transition-all duration-200 z-30 animate-in slide-in-from-bottom-2 duration-150 select-none"
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-black/[0.025] dark:bg-white/[0.03] border-b border-black/10 dark:border-white/10">
        {/* Left: Icon & Title */}
        <div className="flex items-center space-x-2">
          <StickyNote className="w-3.5 h-3.5 theme-accent-text" />
          <span className="text-xs font-semibold text-zinc-900 dark:text-white truncate max-w-[140px]">
            {title}
          </span>

          {/* Sync Status Badge (only shown while saving or offline) */}
          {syncStatus !== 'Synced' && (
            <div
              className={`flex items-center space-x-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                syncStatus === 'Saving...'
                  ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10'
                  : 'text-zinc-500 dark:text-zinc-400 bg-black/5 dark:bg-white/5'
              }`}
              title={
                syncStatus === 'Saving...'
                  ? 'Saving changes...'
                  : syncStatus === 'Retrying sync...'
                    ? 'Chrome Sync rejected the last save (likely a write-rate limit). Saved on this device; retrying automatically.'
                    : syncStatus === 'Too large to sync'
                      ? 'This note exceeds Chrome Sync storage limits. It is saved on this device and in the bookmark backup.'
                      : 'Saved to local device storage'
              }
            >
              {syncStatus === 'Saving...' ? (
                <RefreshCw className="w-2.5 h-2.5 stroke-[2.5] animate-spin" />
              ) : (
                <CloudOff className="w-2.5 h-2.5 stroke-[2.5]" />
              )}
              <span>{syncStatus}</span>
            </div>
          )}
        </div>

        {/* Right: Character Count & Actions */}
        <div className="flex items-center space-x-1">
          {/* Character Counter */}
          <span
            className={`text-[10px] font-mono mr-1.5 ${
              text.length >= maxChars
                ? 'text-rose-500 font-bold'
                : text.length > maxChars * 0.9
                ? 'text-amber-500'
                : 'text-zinc-400 dark:text-zinc-500'
            }`}
          >
            {text.length.toLocaleString()} / {maxChars.toLocaleString()}
          </span>

          {/* Clear Button */}
          {text.length > 0 && (
            <button
              type="button"
              title="Clear Scratchpad"
              onClick={() => {
                if (window.confirm('Clear all scratchpad text?')) {
                  onClear();
                }
              }}
              className="p-1 rounded-md text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}

          {/* Minimize Drawer Button */}
          <button
            type="button"
            title="Minimize Scratchpad (Esc)"
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Editor Body with Defined Inset Card Boundaries */}
      <div className="flex-1 p-2.5 overflow-hidden flex flex-col">
        <div className="flex-1 flex flex-col rounded-lg bg-white/75 dark:bg-black/35 border border-black/15 dark:border-white/15 focus-within:border-[var(--theme-accent)] focus-within:ring-1 focus-within:ring-[var(--theme-accent-border)] shadow-inner overflow-hidden transition-colors">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={maxChars}
            placeholder={placeholder}
            className="w-full flex-1 p-2.5 bg-transparent text-xs text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 font-mono resize-none focus:outline-none selection:bg-[var(--theme-accent-bg)] leading-relaxed custom-scrollbar select-text"
          />
        </div>
      </div>
    </div>
  );
};
