import React, { useState, useEffect, useRef } from 'react';
import {
  RotateCw,
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
  onReloadActiveTab: () => void;
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
      className="relative flex flex-col w-full border-b backdrop-blur-md transition-colors duration-200"
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
            title="Back"
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
    </div>
  );
};
