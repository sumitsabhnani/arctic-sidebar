import React, { useRef, useEffect, useState } from 'react';
import {
  StickyNote,
  Copy,
  Check,
  Trash2,
  X,
  Cloud,
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
}

export const ScratchpadDrawer: React.FC<ScratchpadDrawerProps> = ({
  isOpen,
  onClose,
  text,
  onChange,
  syncStatus,
  onClear,
  maxChars = MAX_CHARS
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [copied, setCopied] = useState(false);

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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn('[ScratchpadDrawer] Failed to copy text:', err);
    }
  };

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
        borderColor: 'var(--theme-border-subtle)'
      }}
      className="flex flex-col w-full h-[240px] border-t backdrop-blur-md transition-all duration-200 z-30 animate-in slide-in-from-bottom-2 duration-150 select-none"
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-black/[0.06] dark:border-white/[0.06]">
        {/* Left: Icon & Title */}
        <div className="flex items-center space-x-2">
          <StickyNote className="w-3.5 h-3.5 theme-accent-text" />
          <span className="text-xs font-semibold text-zinc-900 dark:text-white">
            Scratchpad
          </span>

          {/* Sync Status Badge */}
          <div
            className={`flex items-center space-x-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
              syncStatus === 'Synced'
                ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                : syncStatus === 'Saving...'
                ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10'
                : 'text-zinc-500 dark:text-zinc-400 bg-black/5 dark:bg-white/5'
            }`}
            title={
              syncStatus === 'Synced'
                ? 'Synced across all Chrome instances via Google Account'
                : syncStatus === 'Saving...'
                ? 'Saving changes...'
                : 'Saved to local device storage'
            }
          >
            {syncStatus === 'Synced' ? (
              <Cloud className="w-2.5 h-2.5 stroke-[2.5]" />
            ) : syncStatus === 'Saving...' ? (
              <RefreshCw className="w-2.5 h-2.5 stroke-[2.5] animate-spin" />
            ) : (
              <CloudOff className="w-2.5 h-2.5 stroke-[2.5]" />
            )}
            <span>{syncStatus}</span>
          </div>
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

          {/* Copy All Button */}
          <button
            type="button"
            title="Copy All"
            onClick={handleCopy}
            className="flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-500 stroke-[2.5]" />
                <span className="text-emerald-500">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>

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

          {/* Close Drawer Button */}
          <button
            type="button"
            title="Close Scratchpad (Esc)"
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-1 p-2.5 overflow-hidden flex flex-col">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={maxChars}
          placeholder="Quick notes, URLs, or snippets (synced across devices)..."
          className="w-full flex-1 bg-transparent text-xs text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 font-mono resize-none focus:outline-none selection:bg-[var(--theme-accent-bg)] leading-relaxed custom-scrollbar select-text"
        />
      </div>
    </div>
  );
};
