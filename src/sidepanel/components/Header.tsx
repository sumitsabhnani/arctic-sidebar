import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  RotateCw,
  RefreshCw,
  ChevronDown,
  Link2,
  Lock,
  Globe,
  Sparkles,
  ArrowLeft,
  Check
} from 'lucide-react';

interface HeaderProps {
  activeTabUrl?: string;
  isActiveTabLoading?: boolean;
  onReloadActiveTab: (bypassCache?: boolean) => void;
  onNavigateActiveTab?: (input: string) => void;
  onGoBackActiveTab?: () => void;
}

function formatDisplayUrl(rawUrl?: string): { display: string; isSecure: boolean; isInternal: boolean } {
  if (
    !rawUrl ||
    rawUrl === 'about:blank' ||
    rawUrl.startsWith('chrome://newtab') ||
    rawUrl.includes('/newtab.html') ||
    rawUrl.includes('/command.html')
  ) {
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
  activeTabUrl = '',
  isActiveTabLoading = false,
  onReloadActiveTab,
  onNavigateActiveTab,
  onGoBackActiveTab
}) => {
  const [isCopied, setIsCopied] = useState(false);

  // URL Bar Inline Editing State
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [urlInput, setUrlInput] = useState(activeTabUrl);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Reload dropdown state
  const [isReloadMenuOpen, setIsReloadMenuOpen] = useState(false);
  const reloadDropdownRef = useRef<HTMLDivElement>(null);
  const dropdownMenuRef = useRef<HTMLDivElement>(null);
  const [menuCoords, setMenuCoords] = useState<{ top: number; right: number } | null>(null);

  const toggleReloadMenu = () => {
    if (isReloadMenuOpen) {
      setIsReloadMenuOpen(false);
    } else {
      const rect = reloadDropdownRef.current?.getBoundingClientRect();
      if (rect) {
        setMenuCoords({
          top: rect.bottom + 6,
          right: Math.max(8, window.innerWidth - rect.right)
        });
      }
      setIsReloadMenuOpen(true);
    }
  };

  useEffect(() => {
    if (!isReloadMenuOpen) return;
    const closeMenu = () => {
      setIsReloadMenuOpen(false);
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        reloadDropdownRef.current &&
        !reloadDropdownRef.current.contains(target) &&
        dropdownMenuRef.current &&
        !dropdownMenuRef.current.contains(target)
      ) {
        closeMenu();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMenu();
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden) closeMenu();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('blur', closeMenu);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (chrome?.tabs?.onActivated) {
      chrome.tabs.onActivated.addListener(closeMenu);
    }
    if (chrome?.windows?.onFocusChanged) {
      chrome.windows.onFocusChanged.addListener(closeMenu);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('blur', closeMenu);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (chrome?.tabs?.onActivated) {
        chrome.tabs.onActivated.removeListener(closeMenu);
      }
      if (chrome?.windows?.onFocusChanged) {
        chrome.windows.onFocusChanged.removeListener(closeMenu);
      }
    };
  }, [isReloadMenuOpen]);

  useEffect(() => {
    setIsReloadMenuOpen(false);
  }, [activeTabUrl]);

  useEffect(() => {
    if (!isEditingUrl) {
      setUrlInput(activeTabUrl);
    }
  }, [activeTabUrl, isEditingUrl]);

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

  const { display: displayUrl, isSecure, isInternal } = formatDisplayUrl(activeTabUrl);
  const canCopyUrl = Boolean(
    activeTabUrl &&
      activeTabUrl !== 'about:blank' &&
      !activeTabUrl.startsWith('chrome://newtab') &&
      !activeTabUrl.includes('/newtab.html') &&
      !activeTabUrl.includes('/command.html')
  );

  return (
    <div
      style={{
        backgroundColor: 'var(--theme-header-bg)',
        borderColor: 'var(--theme-border-subtle)'
      }}
      className="relative flex flex-col w-full border-b transition-colors duration-200"
    >
      {/* Top Address / URL Bar with Back, Copy Link & Reload */}
      <div className="px-2.5 py-2">
        <div
          className={`flex items-center h-8 px-2.5 rounded-xl border transition-all duration-150 ${
            isEditingUrl
              ? 'bg-white dark:bg-zinc-900 border-[var(--theme-accent)] shadow-sm'
              : 'bg-black/[0.04] dark:bg-white/[0.05] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] border-black/[0.06] dark:border-white/[0.07]'
          }`}
        >
          {/* Backward Button */}
          <button
            type="button"
            data-tooltip="Back"
            data-tooltip-pos="bottom-left"
            onClick={(e) => {
              e.stopPropagation();
              onGoBackActiveTab?.();
            }}
            className="flex-shrink-0 -ml-0.5 mr-1.5 p-1 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>

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

            {/* Reload Active Tab Button & Hard Reload Dropdown */}
            <div className="relative flex items-center" ref={reloadDropdownRef}>
              <div
                className={`flex items-center rounded-lg border transition-colors ${
                  isReloadMenuOpen
                    ? 'bg-black/10 dark:bg-white/10 border-black/15 dark:border-white/20'
                    : 'bg-black/[0.03] dark:bg-white/[0.04] border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <button
                  type="button"
                  data-tooltip="Reload (Cmd+R)"
                  data-tooltip-pos="bottom-right"
                  onClick={() => onReloadActiveTab(false)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toggleReloadMenu();
                  }}
                  className="p-1 pl-1.5 rounded-l-md text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors group"
                >
                  <RotateCw
                    className={`w-3.5 h-3.5 transition-transform duration-300 ${
                      isActiveTabLoading
                        ? 'animate-spin theme-accent-text'
                        : 'group-active:rotate-180'
                    }`}
                  />
                </button>

                <span className="w-[1px] h-3.5 bg-black/15 dark:bg-white/15 my-auto" />

                <button
                  type="button"
                  data-tooltip="Reload options"
                  data-tooltip-pos="bottom-right"
                  aria-label="Reload options"
                  aria-expanded={isReloadMenuOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleReloadMenu();
                  }}
                  className="p-1 pr-1.5 rounded-r-md text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
                >
                  <ChevronDown
                    className={`w-3.5 h-3.5 stroke-[2.5] transition-transform duration-150 ${
                      isReloadMenuOpen ? 'rotate-180 text-zinc-900 dark:text-white' : ''
                    }`}
                  />
                </button>
              </div>

              {/* Reload Dropdown Menu rendered via portal into document.body to avoid backdrop-filter/stacking context issues */}
              {isReloadMenuOpen &&
                menuCoords &&
                createPortal(
                  <div
                    ref={dropdownMenuRef}
                    style={{
                      position: 'fixed',
                      top: `${menuCoords.top}px`,
                      right: `${menuCoords.right}px`,
                      zIndex: 99999
                    }}
                    className="reload-dropdown-menu w-64 rounded-xl bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-zinc-700/80 shadow-[0_16px_48px_rgba(0,0,0,0.25)] dark:shadow-[0_16px_48px_rgba(0,0,0,0.85)] p-1.5 animate-in fade-in zoom-in-95 duration-100 select-none text-zinc-900 dark:text-zinc-100"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onReloadActiveTab(false);
                        setIsReloadMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 active:bg-zinc-200/80 dark:active:bg-zinc-700/80 group"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <RotateCw className="w-4 h-4 text-zinc-600 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors flex-shrink-0" />
                        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Normal Reload</span>
                      </div>
                      <kbd className="ml-2 px-1.5 py-0.5 text-[10px] font-mono font-medium rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 shadow-2xs flex-shrink-0">
                        ⌘R
                      </kbd>
                    </button>

                    <div className="my-1 border-t border-zinc-200/80 dark:border-zinc-800" />

                    <button
                      type="button"
                      onClick={() => {
                        onReloadActiveTab(true);
                        setIsReloadMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-cyan-50 dark:hover:bg-cyan-950/40 active:bg-cyan-100/70 dark:active:bg-cyan-900/40 group"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <RefreshCw className="w-4 h-4 text-cyan-600 dark:text-cyan-400 group-hover:rotate-180 transition-transform duration-300 flex-shrink-0" />
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold text-zinc-900 dark:text-white group-hover:text-cyan-700 dark:group-hover:text-cyan-300 transition-colors">
                            Hard Reload
                          </span>
                          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate">
                            Clear cache & reload
                          </span>
                        </div>
                      </div>
                      <kbd className="ml-2 px-1.5 py-0.5 text-[10px] font-mono font-medium rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 shadow-2xs flex-shrink-0">
                        ⇧⌘R
                      </kbd>
                    </button>
                  </div>,
                  document.body
                )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
