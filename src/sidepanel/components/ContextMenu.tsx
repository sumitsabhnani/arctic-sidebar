import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { ChevronRight } from 'lucide-react';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  action?: () => void;
  danger?: boolean;
  disabled?: boolean;
  dividerBefore?: boolean;
  submenu?: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [expandedSubmenuIdx, setExpandedSubmenuIdx] = useState<number | null>(null);

  // Initial smart positioning using conservative estimates
  const [coords, setCoords] = useState<{ x: number; y: number }>(() => {
    const estimatedWidth = 220;
    const estimatedHeight = items.length * 32 + 20;
    const winW = typeof window !== 'undefined' ? window.innerWidth : 320;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 600;
    return {
      x: Math.max(8, Math.min(x, winW - estimatedWidth - 8)),
      y: Math.max(8, Math.min(y, winH - estimatedHeight - 8))
    };
  });

  // Accurately measure the actual rendered DOM box and clamp within viewport bounds
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    // Shift left if menu would overflow right sidepanel edge
    if (adjustedX + rect.width > winW - 8) {
      adjustedX = Math.max(8, winW - rect.width - 8);
    }
    // Shift up if menu would overflow bottom sidepanel edge
    if (adjustedY + rect.height > winH - 8) {
      adjustedY = Math.max(8, winH - rect.height - 8);
    }

    setCoords({ x: adjustedX, y: adjustedY });
  }, [x, y, items, expandedSubmenuIdx]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleTabActivated = () => {
      onClose();
    };

    const handleWindowFocus = () => {
      onClose();
    };

    if (chrome?.tabs?.onActivated) {
      chrome.tabs.onActivated.addListener(handleTabActivated);
    }
    if (chrome?.windows?.onFocusChanged) {
      chrome.windows.onFocusChanged.addListener(handleWindowFocus);
    }

    // Use capture or slight timeout so triggering right-click doesn't instantly dismiss
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('contextmenu', handleClickOutside);
    }, 10);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('contextmenu', handleClickOutside);
      if (chrome?.tabs?.onActivated) {
        chrome.tabs.onActivated.removeListener(handleTabActivated);
      }
      if (chrome?.windows?.onFocusChanged) {
        chrome.windows.onFocusChanged.removeListener(handleWindowFocus);
      }
      clearTimeout(timer);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{ top: `${coords.y}px`, left: `${coords.x}px` }}
      className="fixed z-50 min-w-[196px] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto p-1 rounded-xl bg-white/95 dark:bg-[#1e1e22]/95 backdrop-blur-xl border border-zinc-200 dark:border-white/10 shadow-xl dark:shadow-[0_8px_30px_rgba(0,0,0,0.6)] text-xs text-zinc-800 dark:text-zinc-200 select-none animate-in fade-in zoom-in-95 duration-100"
    >
      {items.map((item, idx) => {
        const hasSubmenu = Boolean(item.submenu && item.submenu.length > 0);
        const isSubmenuOpen = expandedSubmenuIdx === idx;

        return (
          <React.Fragment key={idx}>
            {item.dividerBefore && (
              <div className="my-1 border-t border-zinc-200 dark:border-white/[0.08]" />
            )}
            <button
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (hasSubmenu) {
                  setExpandedSubmenuIdx((prev) => (prev === idx ? null : idx));
                  return;
                }
                item.action?.();
                onClose();
              }}
              className={`w-full flex items-center justify-between space-x-2 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                item.disabled
                  ? 'opacity-40 cursor-not-allowed'
                  : item.danger
                  ? 'text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-300'
                  : isSubmenuOpen
                  ? 'bg-zinc-100 dark:bg-white/10 text-zinc-900 dark:text-white font-medium'
                  : 'hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-2 min-w-0 flex-1">
                {item.icon && (
                  <span className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 text-zinc-400 dark:text-zinc-400">
                    {item.icon}
                  </span>
                )}
                <span className="truncate flex-1 font-normal text-[12px]">{item.label}</span>
              </div>
              {hasSubmenu && (
                <ChevronRight
                  className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-150 ${
                    isSubmenuOpen ? 'rotate-90 theme-accent-text' : ''
                  }`}
                />
              )}
            </button>

            {hasSubmenu && isSubmenuOpen && item.submenu && (
              <div className="ml-3 pl-2 my-0.5 border-l-2 border-zinc-200 dark:border-white/10 space-y-0.5 animate-in fade-in slide-in-from-top-1 duration-100">
                {item.submenu.map((sub, subIdx) => (
                  <button
                    key={subIdx}
                    type="button"
                    disabled={sub.disabled}
                    onClick={() => {
                      sub.action?.();
                      onClose();
                    }}
                    className={`w-full flex items-center space-x-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                      sub.disabled
                        ? 'opacity-40 cursor-not-allowed'
                        : 'hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    {sub.icon && (
                      <span className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 text-zinc-400">
                        {sub.icon}
                      </span>
                    )}
                    <span className="truncate flex-1 text-[11.5px]">{sub.label}</span>
                  </button>
                ))}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
