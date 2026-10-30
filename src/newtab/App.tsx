import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search,
  Globe,
  Bookmark,
  History,
  CornerDownLeft,
  X,
  Sparkles
} from 'lucide-react';
import type { ColorThemeId, ThemeMode } from '../sidepanel/utils/theme';
import { getFaviconUrl, getDomainFromUrl } from '../sidepanel/utils/url';

interface SuggestionItem {
  id: string;
  type: 'search' | 'bookmark' | 'history' | 'url';
  title: string;
  url: string;
  domain?: string;
}

export function isLikelyUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) return true;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?(\/.*)?$/.test(trimmed)) return true;
  if (!/\s/.test(trimmed) && /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function formatNavigationUrl(input: string): string {
  const trimmed = input.trim();
  if (isLikelyUrl(trimmed)) {
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export const App: React.FC = () => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [colorTheme, setColorTheme] = useState<ColorThemeId>('glacier-blue');

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync theme with Arctic Sidebar
  useEffect(() => {
    chrome.storage.local.get(['theme', 'colorTheme'], (res) => {
      if (res.theme === 'light' || res.theme === 'dark') {
        setTheme(res.theme as ThemeMode);
      }
      if (
        typeof res.colorTheme === 'string' &&
        [
          'glacier-blue',
          'midnight-amethyst',
          'forest-sage',
          'warm-terracotta',
          'pure-monochrome',
          'slate-grey'
        ].includes(res.colorTheme)
      ) {
        setColorTheme(res.colorTheme as ColorThemeId);
      }
    });

    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local') {
        if (changes.theme) {
          setTheme(changes.theme.newValue as ThemeMode);
        }
        if (changes.colorTheme) {
          setColorTheme(changes.colorTheme.newValue as ColorThemeId);
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // Apply theme & color palette classes
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
    document.documentElement.setAttribute('data-color-theme', colorTheme);
  }, [theme, colorTheme]);

  // Keep input focused automatically on mount, tab switch, window focus, and sidebar messages
  useEffect(() => {
    const focusInput = () => {
      window.focus();
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    };

    // Immediate and staged focus attempts to handle renderer transitions
    focusInput();
    const t1 = setTimeout(focusInput, 50);
    const t2 = setTimeout(focusInput, 150);
    const t3 = setTimeout(focusInput, 300);

    window.addEventListener('focus', focusInput);

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        focusInput();
        setTimeout(focusInput, 50);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen to tab activation directly in extension context
    const handleTabActivated = async (activeInfo: { tabId: number; windowId: number }) => {
      try {
        const currentTab = await chrome.tabs.getCurrent();
        if (currentTab && currentTab.id === activeInfo.tabId) {
          focusInput();
          setTimeout(focusInput, 50);
        }
      } catch {
        // ignore
      }
    };
    if (chrome?.tabs?.onActivated) {
      chrome.tabs.onActivated.addListener(handleTabActivated);
    }

    // Direct message from Arctic Sidebar
    const handleMessage = (msg: unknown) => {
      if (
        typeof msg === 'object' &&
        msg !== null &&
        (msg as { type?: string }).type === 'ARCTIC_FOCUS_SEARCH'
      ) {
        focusInput();
        setTimeout(focusInput, 50);
      }
    };
    if (chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handleMessage);
    }

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener('focus', focusInput);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (chrome?.tabs?.onActivated) {
        chrome.tabs.onActivated.removeListener(handleTabActivated);
      }
      if (chrome?.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(handleMessage);
      }
    };
  }, []);

  // Load suggestions from history, bookmarks, and search query
  useEffect(() => {
    let isCancelled = false;
    const trimmed = query.trim();

    if (!trimmed) {
      // Empty query: fetch top 6 most visited / recent history items
      if (chrome?.history?.search) {
        chrome.history.search(
          { text: '', maxResults: 6, startTime: 0 },
          (historyItems) => {
            if (isCancelled) return;
            const items: SuggestionItem[] = (historyItems || [])
              .filter((h) => h.url && !h.url.startsWith('chrome://') && !h.url.startsWith('chrome-extension://'))
              .map((h) => ({
                id: `hist-${h.id}`,
                type: 'history',
                title: h.title || h.url || 'Visited Page',
                url: h.url!,
                domain: getDomainFromUrl(h.url!)
              }));
            setSuggestions(items);
            setSelectedIndex(-1);
          }
        );
      } else {
        setSuggestions([]);
        setSelectedIndex(-1);
      }
      return () => {
        isCancelled = true;
      };
    }

    // Non-empty query: search history + bookmarks + add search action
    const fetchResults = async () => {
      const results: SuggestionItem[] = [];
      const seenUrls = new Set<string>();

      // 1. If it looks like a direct domain or URL, offer direct visit as top suggestion
      if (isLikelyUrl(trimmed)) {
        const directUrl = formatNavigationUrl(trimmed);
        results.push({
          id: 'direct-url',
          type: 'url',
          title: `Open ${trimmed}`,
          url: directUrl,
          domain: getDomainFromUrl(directUrl)
        });
        seenUrls.add(directUrl.toLowerCase());
      }

      // 2. Query Bookmarks
      try {
        if (chrome?.bookmarks?.search) {
          const bookmarkNodes = await chrome.bookmarks.search(trimmed);
          for (const bm of bookmarkNodes) {
            if (bm.url && !seenUrls.has(bm.url.toLowerCase())) {
              seenUrls.add(bm.url.toLowerCase());
              results.push({
                id: `bm-${bm.id}`,
                type: 'bookmark',
                title: bm.title || bm.url,
                url: bm.url,
                domain: getDomainFromUrl(bm.url)
              });
              if (results.length >= 4) break;
            }
          }
        }
      } catch {
        // ignore
      }

      // 3. Query History
      try {
        if (chrome?.history?.search) {
          const historyItems = await chrome.history.search({
            text: trimmed,
            maxResults: 10,
            startTime: 0
          });
          for (const item of historyItems) {
            if (
              item.url &&
              !item.url.startsWith('chrome://') &&
              !item.url.startsWith('chrome-extension://') &&
              !seenUrls.has(item.url.toLowerCase())
            ) {
              seenUrls.add(item.url.toLowerCase());
              results.push({
                id: `hist-${item.id}`,
                type: 'history',
                title: item.title || item.url,
                url: item.url,
                domain: getDomainFromUrl(item.url)
              });
              if (results.length >= 7) break;
            }
          }
        }
      } catch {
        // ignore
      }

      // 4. Always add Google Search suggestion at the bottom
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
      results.push({
        id: 'google-search',
        type: 'search',
        title: `Search Google for "${trimmed}"`,
        url: searchUrl
      });

      if (!isCancelled) {
        setSuggestions(results);
        // Default to first suggestion when typing
        setSelectedIndex(0);
      }
    };

    fetchResults();

    return () => {
      isCancelled = true;
    };
  }, [query]);

  // Navigate to destination
  const handleNavigate = useCallback((destinationUrl: string) => {
    if (!destinationUrl) return;
    window.location.href = destinationUrl;
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setSelectedIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setSelectedIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        handleNavigate(suggestions[selectedIndex].url);
      } else if (query.trim()) {
        handleNavigate(formatNavigationUrl(query));
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery('');
      setSelectedIndex(-1);
    }
  };

  return (
    <div
      style={{
        background: 'var(--theme-bg-gradient)'
      }}
      onClick={() => inputRef.current?.focus()}
      className="min-h-screen w-full flex flex-col items-center justify-center p-6 text-zinc-900 dark:text-zinc-100 select-none transition-colors duration-300"
    >
      {/* Center Command Palette Container */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[620px] flex flex-col space-y-4 animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Brand Header */}
        <div className="flex items-center justify-center space-x-2 pb-1">
          <div className="w-6 h-6 rounded-lg bg-[var(--theme-accent)] flex items-center justify-center shadow-md">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">
            Arctic Command
          </span>
        </div>

        {/* Command Card */}
        <div
          style={{
            borderColor: 'var(--theme-accent-border)',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.25)'
          }}
          className="w-full rounded-2xl bg-white/90 dark:bg-[#18181c]/90 backdrop-blur-2xl border transition-all duration-200 overflow-hidden"
        >
          {/* Top Search Input Box */}
          <div className="flex items-center px-4 py-3.5 space-x-3 border-b border-zinc-200/80 dark:border-white/10">
            <Search className="w-5 h-5 text-zinc-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search Google or enter URL..."
              autoFocus
              className="flex-1 bg-transparent text-[16px] leading-normal text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 outline-none font-normal"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                className="p-1 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-zinc-200/60 dark:bg-white/10 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                <CornerDownLeft className="w-3 h-3 mr-0.5" />
                <span>Jump</span>
              </div>
            )}
          </div>

          {/* Suggestions Dropdown */}
          {suggestions.length > 0 && (
            <div
              ref={listRef}
              className="max-h-[360px] overflow-y-auto p-1.5 space-y-0.5"
            >
              {!query.trim() && (
                <div className="px-3 py-1.5 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                  Frequently Visited
                </div>
              )}

              {suggestions.map((item, index) => {
                const isSelected = index === selectedIndex;
                const faviconSrc = item.url ? getFaviconUrl(item.url, 32) : '';

                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleNavigate(item.url)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-100 outline-none ${
                      isSelected
                        ? 'theme-active-card text-zinc-950 dark:text-white'
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    {/* Left: Favicon & Title/URL */}
                    <div className="flex items-center space-x-3 min-w-0 flex-1 mr-3">
                      <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded">
                        {item.type === 'search' ? (
                          <Search className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />
                        ) : item.type === 'url' ? (
                          <Globe className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                        ) : faviconSrc ? (
                          <img
                            src={faviconSrc}
                            alt=""
                            className="w-4 h-4 object-contain rounded-sm"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : item.type === 'bookmark' ? (
                          <Bookmark className="w-4 h-4 text-amber-500" />
                        ) : (
                          <History className="w-4 h-4 text-zinc-400" />
                        )}
                      </div>

                      <div className="flex flex-col min-w-0 flex-1 leading-tight">
                        <span className="truncate text-[13.5px] font-medium">
                          {item.title}
                        </span>
                        {item.domain && (
                          <span className="truncate text-[11.5px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                            {item.domain}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: Badge & Enter prompt */}
                    <div className="flex items-center space-x-2 flex-shrink-0">
                      {item.type === 'bookmark' && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-300 border border-amber-500/20">
                          Bookmark
                        </span>
                      )}
                      {item.type === 'history' && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-zinc-200/50 dark:bg-white/10 text-zinc-500 dark:text-zinc-400">
                          History
                        </span>
                      )}
                      {item.type === 'search' && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 border border-cyan-500/20">
                          Search
                        </span>
                      )}
                      {isSelected && (
                        <CornerDownLeft className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 animate-in fade-in duration-100" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Keyboard Hints */}
        <div className="flex items-center justify-center space-x-4 text-xs text-zinc-400 dark:text-zinc-500 pt-1">
          <span className="flex items-center space-x-1">
            <kbd className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-[10px] font-mono">
              ↑
            </kbd>
            <kbd className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-[10px] font-mono">
              ↓
            </kbd>
            <span className="ml-1">to navigate</span>
          </span>
          <span>•</span>
          <span className="flex items-center space-x-1">
            <kbd className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-[10px] font-mono">
              ↵
            </kbd>
            <span className="ml-1">to open</span>
          </span>
          <span>•</span>
          <span className="flex items-center space-x-1">
            <kbd className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-[10px] font-mono">
              esc
            </kbd>
            <span className="ml-1">to clear</span>
          </span>
        </div>
      </div>
    </div>
  );
};
