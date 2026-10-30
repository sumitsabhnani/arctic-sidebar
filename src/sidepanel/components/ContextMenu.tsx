import React, { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
  dividerBefore?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

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

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) onClose();
    });

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

  // Adjust coordinates if menu would render offscreen
  const menuWidth = 190;
  const menuHeight = items.length * 28 + 20;

  let posX = x;
  let posY = y;

  if (typeof window !== 'undefined') {
    if (posX + menuWidth > window.innerWidth) {
      posX = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (posY + menuHeight > window.innerHeight) {
      posY = Math.max(8, window.innerHeight - menuHeight - 8);
    }
  }

  return (
    <div
      ref={menuRef}
      style={{ top: `${posY}px`, left: `${posX}px` }}
      className="fixed z-50 min-w-[180px] p-1 rounded-xl bg-white/95 dark:bg-[#1e1e22]/95 backdrop-blur-xl border border-zinc-200 dark:border-white/10 shadow-xl dark:shadow-[0_8px_30px_rgba(0,0,0,0.6)] text-xs text-zinc-800 dark:text-zinc-200 select-none animate-in fade-in zoom-in-95 duration-100"
    >
      {items.map((item, idx) => (
        <React.Fragment key={idx}>
          {item.dividerBefore && (
            <div className="my-1 border-t border-zinc-200 dark:border-white/[0.08]" />
          )}
          <button
            type="button"
            disabled={item.disabled}
            onClick={() => {
              item.action();
              onClose();
            }}
            className={`w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
              item.disabled
                ? 'opacity-40 cursor-not-allowed'
                : item.danger
                ? 'text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-300'
                : 'hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            {item.icon && (
              <span className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 text-zinc-400 dark:text-zinc-400">
                {item.icon}
              </span>
            )}
            <span className="truncate flex-1 font-normal text-[12px]">{item.label}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};
