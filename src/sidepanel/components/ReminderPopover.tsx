import React, { useState, useEffect, useRef } from 'react';
import {
  Bell,
  Clock,
  Trash2,
  X,
  Check,
  RotateCw,
  AlertCircle
} from 'lucide-react';
import type { TabReminder } from '../../types';

interface ReminderPopoverProps {
  target: {
    type: 'bookmark' | 'tab';
    bookmarkId?: string;
    tabId?: number;
    url: string;
    title: string;
  };
  activeReminder?: TabReminder;
  anchorRect?: DOMRect | null;
  onSave: (params: {
    note: string;
    triggerAt: number;
    reminderId?: string;
  }) => void;
  onDelete?: (id: string) => void;
  onSnooze?: (id: string, minutes?: number) => void;
  onClose: () => void;
}

function toDateTimeLocalString(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getTomorrow9AM(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

function formatScheduledTime(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) {
    return `Today at ${timeStr}`;
  }
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
}

export const ReminderPopover: React.FC<ReminderPopoverProps> = ({
  target,
  activeReminder,
  anchorRect,
  onSave,
  onDelete,
  onSnooze,
  onClose
}) => {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Default trigger: 15 minutes from now
  const [triggerAt, setTriggerAt] = useState<number>(
    activeReminder ? activeReminder.triggerAt : Date.now() + 15 * 60 * 1000
  );
  const [note, setNote] = useState<string>(activeReminder ? activeReminder.note : '');
  const [isEditing, setIsEditing] = useState<boolean>(!activeReminder);

  // Close on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleOutsideClick, true);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick, true);
    };
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanNote = note.trim();
    if (!cleanNote) return;

    onSave({
      note: cleanNote,
      triggerAt,
      reminderId: activeReminder?.id
    });
    onClose();
  };

  // Compute fixed position relative to anchor button
  const popoverStyle: React.CSSProperties = {
    position: 'fixed',
    width: '280px',
    zIndex: 70
  };

  if (anchorRect) {
    const right = Math.max(8, window.innerWidth - anchorRect.right);
    const showAbove = anchorRect.bottom + 320 > window.innerHeight;
    if (showAbove) {
      popoverStyle.bottom = `${Math.max(8, window.innerHeight - anchorRect.top + 6)}px`;
    } else {
      popoverStyle.top = `${anchorRect.bottom + 6}px`;
    }
    popoverStyle.right = `${right}px`;
  } else {
    popoverStyle.top = '80px';
    popoverStyle.right = '16px';
  }

  const isFired = activeReminder?.status === 'fired';

  return (
    <div
      ref={popoverRef}
      style={{
        ...popoverStyle,
        backgroundColor: 'var(--theme-header-bg)',
        borderColor: 'var(--theme-border-subtle)'
      }}
      className="rounded-2xl border shadow-2xl backdrop-blur-xl p-3.5 flex flex-col space-y-3 animate-in fade-in zoom-in-95 duration-150 select-none text-zinc-900 dark:text-white"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-black/[0.06] dark:border-white/[0.06] pb-2">
        <div className="flex items-center space-x-1.5 min-w-0">
          <Bell className={`w-3.5 h-3.5 ${isFired ? 'text-rose-500 animate-pulse' : 'theme-accent-text'}`} />
          <span className="text-xs font-semibold truncate">
            {activeReminder ? (isFired ? 'Overdue Reminder' : 'Active Reminder') : 'Set Tab Reminder'}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Target Title Preview */}
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
        {target.title || target.url}
      </div>

      {/* Active Reminder View Mode */}
      {activeReminder && !isEditing ? (
        <div className="flex flex-col space-y-3">
          <div
            className={`p-2.5 rounded-xl border flex flex-col space-y-1 ${
              isFired
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-300'
                : 'bg-black/[0.03] dark:bg-white/[0.04] border-black/[0.06] dark:border-white/[0.06]'
            }`}
          >
            <div className="flex items-center space-x-1.5 text-[11px] font-medium">
              {isFired ? (
                <>
                  <AlertCircle className="w-3 h-3 text-rose-500" />
                  <span>Due now / Overdue</span>
                </>
              ) : (
                <>
                  <Clock className="w-3 h-3 text-amber-500" />
                  <span>Scheduled for {formatScheduledTime(activeReminder.triggerAt)}</span>
                </>
              )}
            </div>
            <p className="text-xs font-normal text-zinc-800 dark:text-zinc-200 break-words select-text">
              {activeReminder.note || '(No custom note)'}
            </p>
          </div>

          {/* Action Buttons for Active Reminder */}
          <div className="flex items-center space-x-1.5">
            {/* Snooze Button */}
            <button
              type="button"
              onClick={() => {
                onSnooze?.(activeReminder.id, 15);
                onClose();
              }}
              className="flex-1 flex items-center justify-center space-x-1 px-2.5 py-1.5 rounded-xl text-xs font-medium theme-accent-tint theme-accent-text hover:opacity-90 transition-opacity"
            >
              <RotateCw className="w-3 h-3 stroke-[2.5]" />
              <span>+15m Snooze</span>
            </button>

            {/* Edit Button */}
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              Edit
            </button>

            {/* Delete Button */}
            <button
              type="button"
              title="Delete Reminder"
              onClick={() => {
                onDelete?.(activeReminder.id);
                onClose();
              }}
              className="p-1.5 rounded-xl text-rose-500 hover:bg-rose-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : (
        /* Reminder Creation / Edit Form */
        <form onSubmit={handleSubmit} className="flex flex-col space-y-2.5">
          {/* Note Input */}
          <div className="flex flex-col space-y-1">
            <input
              type="text"
              autoFocus
              maxLength={120}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What do you want to remember?"
              className="w-full bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-[var(--theme-accent)]"
            />
            <div className="flex justify-end text-[10px] text-zinc-400">
              {note.length}/120
            </div>
          </div>

          {/* Quick Preset Chips */}
          <div className="flex flex-col space-y-1">
            <span className="text-[10px] uppercase font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
              Quick Presets
            </span>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setTriggerAt(Date.now() + 15 * 60 * 1000)}
                className="px-2 py-1 rounded-lg text-[11px] font-medium bg-black/[0.03] dark:bg-white/[0.05] hover:bg-black/[0.07] dark:hover:bg-white/[0.1] text-zinc-700 dark:text-zinc-200 border border-black/[0.04] dark:border-white/[0.06] transition-colors text-center"
              >
                In 15m
              </button>
              <button
                type="button"
                onClick={() => setTriggerAt(Date.now() + 60 * 60 * 1000)}
                className="px-2 py-1 rounded-lg text-[11px] font-medium bg-black/[0.03] dark:bg-white/[0.05] hover:bg-black/[0.07] dark:hover:bg-white/[0.1] text-zinc-700 dark:text-zinc-200 border border-black/[0.04] dark:border-white/[0.06] transition-colors text-center"
              >
                In 1h
              </button>
              <button
                type="button"
                onClick={() => setTriggerAt(Date.now() + 3 * 60 * 60 * 1000)}
                className="px-2 py-1 rounded-lg text-[11px] font-medium bg-black/[0.03] dark:bg-white/[0.05] hover:bg-black/[0.07] dark:hover:bg-white/[0.1] text-zinc-700 dark:text-zinc-200 border border-black/[0.04] dark:border-white/[0.06] transition-colors text-center"
              >
                In 3h
              </button>
              <button
                type="button"
                onClick={() => setTriggerAt(getTomorrow9AM())}
                className="px-2 py-1 rounded-lg text-[11px] font-medium bg-black/[0.03] dark:bg-white/[0.05] hover:bg-black/[0.07] dark:hover:bg-white/[0.1] text-zinc-700 dark:text-zinc-200 border border-black/[0.04] dark:border-white/[0.06] transition-colors text-center"
              >
                Tomorrow 9 AM
              </button>
            </div>
          </div>

          {/* Custom Time Picker */}
          <div className="flex flex-col space-y-1">
            <span className="text-[10px] uppercase font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
              Custom Date & Time
            </span>
            <input
              type="datetime-local"
              value={toDateTimeLocalString(triggerAt)}
              onChange={(e) => {
                const parsed = new Date(e.target.value).getTime();
                if (!isNaN(parsed)) {
                  setTriggerAt(parsed);
                }
              }}
              className="w-full bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 rounded-xl px-2 py-1 text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-[var(--theme-accent)]"
            />
          </div>

          {/* Submit Actions */}
          <div className="flex items-center space-x-1.5 pt-1">
            <button
              type="submit"
              disabled={!note.trim()}
              className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold theme-accent-bg text-white dark:text-black hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>{activeReminder ? 'Save Changes' : 'Set Reminder'}</span>
            </button>

            {activeReminder && (
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
};
