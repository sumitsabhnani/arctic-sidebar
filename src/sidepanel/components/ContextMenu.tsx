import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
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

  // Reset expanded submenu when menu coordinates or items change
  useEffect(() => {
    setExpandedSubmenuIdx(null);
  }, [x, y, items]);

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
    let leaveTimer: ReturnType<typeof setTimeout> | null = null;

    const handleClose = () => {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
      onClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    const handleScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      handleClose();
    };

    // In Chromium's SidePanelWebUIView, right-clicking inside the sidepanel does not transfer
    // native C++ views::FocusManager focus from the webpage to the sidepanel. After the first
    // outside click on the webpage, document.hasFocus() remains false on subsequent right-clicks,
    // so window.blur will not fire again. Detecting cursor exit from the sidepanel document
    // guarantees the menu closes whenever the user moves back to the webpage to click.
    const handleMouseLeaveDocument = () => {
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => {
        handleClose();
      }, 80);
    };

    const handleMouseEnterDocument = () => {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) handleClose();
    };

    const handleTabActivated = () => {
      handleClose();
    };

    const handleWindowFocus = () => {
      handleClose();
    };

    const handleTabHighlighted = () => {
      handleClose();
    };

    const handleTabUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) => {
      if (changeInfo.status || changeInfo.url) {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleClose);
    window.addEventListener('resize', handleClose);
    window.addEventListener('scroll', handleScroll, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.documentElement.addEventListener('mouseleave', handleMouseLeaveDocument);
    document.documentElement.addEventListener('mouseenter', handleMouseEnterDocument);

    if (chrome?.tabs?.onActivated) {
      chrome.tabs.onActivated.addListener(handleTabActivated);
    }
    if (chrome?.windows?.onFocusChanged) {
      chrome.windows.onFocusChanged.addListener(handleWindowFocus);
    }
    if (chrome?.tabs?.onHighlighted) {
      chrome.tabs.onHighlighted.addListener(handleTabHighlighted);
    }
    if (chrome?.tabs?.onUpdated) {
      chrome.tabs.onUpdated.addListener(handleTabUpdated);
    }

    // Use capture phase so clicks outside close the menu even if a child stops propagation,
    // and right-clicking another item closes the current menu in capture before opening the new one in bubble
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside, true);
      window.addEventListener('contextmenu', handleClickOutside, true);
    }, 10);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleClose);
      window.removeEventListener('resize', handleClose);
      window.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.documentElement.addEventListener('mouseleave', handleMouseLeaveDocument);
      document.documentElement.addEventListener('mouseenter', handleMouseEnterDocument);
      window.removeEventListener('mousedown', handleClickOutside, true);
      window.removeEventListener('contextmenu', handleClickOutside, true);
      if (chrome?.tabs?.onActivated) {
        chrome.tabs.onActivated.removeListener(handleTabActivated);
      }
      if (chrome?.windows?.onFocusChanged) {
        chrome.windows.onFocusChanged.removeListener(handleWindowFocus);
      }
      if (chrome?.tabs?.onHighlighted) {
        chrome.tabs.onHighlighted.removeListener(handleTabHighlighted);
      }
      if (chrome?.tabs?.onUpdated) {
        chrome.tabs.onUpdated.removeListener(handleTabUpdated);
      }
      clearTimeout(timer);
      if (leaveTimer) {
        clearTimeout(leaveTimer);
      }
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      tabIndex={-1}
      style={{ top: `${coords.y}px`, left: `${coords.x}px` }}
      className="fixed z-[99999] min-w-[196px] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto p-1 rounded-xl bg-white/95 dark:bg-[#1e1e22]/95 backdrop-blur-xl border border-zinc-200 dark:border-white/10 shadow-xl dark:shadow-[0_8px_30px_rgba(0,0,0,0.6)] text-xs text-zinc-800 dark:text-zinc-200 select-none animate-in fade-in zoom-in-95 duration-100 outline-none"
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
              className={`w-full flex items-center justify-between space-x-2 px-2.5 py-1.5 rounded-lg text-left transition-colors group ${
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
                  <span
                    className={`w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 transition-colors ${
                      item.danger
                        ? 'text-rose-500 dark:text-rose-400 group-hover:text-rose-600 dark:group-hover:text-rose-300'
                        : 'text-zinc-400 dark:text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-200'
                    }`}
                  >
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
                    className={`w-full flex items-center space-x-2 px-2 py-1.5 rounded-lg text-left transition-colors group ${
                      sub.disabled
                        ? 'opacity-40 cursor-not-allowed'
                        : sub.danger
                        ? 'text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-300'
                        : 'hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    {sub.icon && (
                      <span
                        className={`w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 transition-colors ${
                          sub.danger
                            ? 'text-rose-500 dark:text-rose-400 group-hover:text-rose-600 dark:group-hover:text-rose-300'
                            : 'text-zinc-400 dark:text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-200'
                        }`}
                      >
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
    </div>,
    document.body
  );
};
