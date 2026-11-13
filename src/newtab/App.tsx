import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search,
  Globe,
  Bookmark,
  History,
  CornerDownLeft,
  X,
  Moon,
  Sun,
  Monitor,
  Palette,
  PanelLeft,
  Layers,
  RotateCcw,
  Trash2,
  Settings,
  Command,
  Zap,
  ExternalLink,
  Check
} from 'lucide-react';
import type { ColorThemeId, ThemeMode, SpaceItem, TabBinding, SiteSearchEngine } from '../types';
import {
  doesTabUrlMatchBookmark,
  getCanonicalUrlKey,
  getDomainFromUrl,
  getEffectiveTabUrl,
  getFaviconUrl,
  isScratchpadUrl,
  isUrlNavigatedAway,
  normalizeUrl
} from '../sidepanel/utils/url';
import {
  findMatchingUnboundTabForBookmark,
  getPersistedBindings,
  isArcticCommandTab,
  upsertPersistedBindings
} from '../sidepanel/utils/reconcileBindings';
import {
  COLOR_THEMES,
  isValidColorTheme,
  isValidThemeMode,
  resolveEffectiveTheme
} from '../sidepanel/utils/theme';
import { NewTabEdgeTrigger } from './components/NewTabEdgeTrigger';
import {
  findMatchingSiteEngine,
  buildSiteSearchUrl,
  doesUrlMatchEngineDomain,
  inferRegionalSiteDomains,
  type RegionalDomainPreferences,
  type DomainSignalInput
} from './utils/siteSearch';
import {
  rankOmniboxCandidates,
  scoreActionCommand,
  computeInlineGhostSuffix,
  getHistoryCollapseKey,
  type OmniboxCandidate
} from './utils/omniboxSearch';

export interface SuggestionItem {
  id: string;
  type: 'search' | 'bookmark' | 'history' | 'url' | 'command' | 'tab';
  title: string;
  searchQuery?: string;
  defaultSearchText?: string;
  url?: string;
  domain?: string;
  description?: string;
  commandCategory?: string;
  icon?: React.ReactNode;
  action?: () => void | Promise<void>;
  bookmarkId?: string;
  spaceId?: string | null;
  spaceName?: string;
  isQuickAccess?: boolean;
  isArctic?: boolean;
  isOpenTab?: boolean;
  tabId?: number;
  windowId?: number;
}

interface SpaceOption {
  id: string;
  name: string;
  folderId?: string;
}

export interface ArcticBookmarkItem {
  id: string;
  title: string;
  url: string;
  spaceName: string;
  spaceId?: string | null;
  isQuickAccess?: boolean;
}

export function isLikelyUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) return true;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?(\/.*)?$/.test(trimmed)) return true;
  if (!/\s/.test(trimmed) && /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/i.test(trimmed)) {
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

// Fetch live Google autocomplete suggestions when a query is not found locally
export async function fetchGoogleSuggestions(
  query: string,
  signal?: AbortSignal
): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed || typeof fetch !== 'function') return [];
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(trimmed)}`;
    const response = await fetch(url, signal ? { signal } : undefined);
    if (!response || !response.ok) return [];
    const data = await response.json();
    if (Array.isArray(data) && Array.isArray(data[1])) {
      const seen = new Set<string>([trimmed.toLowerCase()]);
      const suggestions: string[] = [];
      for (const item of data[1]) {
        if (typeof item === 'string') {
          const clean = item.trim();
          const lower = clean.toLowerCase();
          if (clean && !seen.has(lower)) {
            seen.add(lower);
            suggestions.push(clean);
          }
        }
      }
      return suggestions;
    }
    return [];
  } catch {
    return [];
  }
}

// Fetch all bookmarks saved within Arctic (Quick Access and Spaces)
export async function getArcticBookmarks(): Promise<ArcticBookmarkItem[]> {
  if (!chrome?.bookmarks?.getTree) return [];
  try {
    const tree = await chrome.bookmarks.getTree();
    const root = tree[0];
    const otherBookmarks =
      root?.children?.find(
        (c) => c.id === '2' || c.title.toLowerCase().includes('other')
      ) || root?.children?.[1];

    const arcticRoot = otherBookmarks?.children?.find(
      (c) =>
        !c.url &&
        (c.title === 'Arctic' ||
          c.title === 'Arctic Sidebar' ||
          c.title.includes('Sidebar'))
    );

    let storedSpaces: SpaceItem[] = [];
    let quickAccessFolderId: string | null = null;
    try {
      const stored = await chrome.storage.local.get([
        'spaces',
        'quickAccessFolderId'
      ]);
      if (Array.isArray(stored.spaces)) {
        storedSpaces = stored.spaces;
      }
      quickAccessFolderId = (stored.quickAccessFolderId as string) || null;
    } catch {
      // ignore
    }

    const results: ArcticBookmarkItem[] = [];
    const visitedFolderIds = new Set<string>();

    const walk = (
      node: chrome.bookmarks.BookmarkTreeNode,
      spaceId: string | null,
      spaceName: string,
      isQuickAccess: boolean
    ) => {
      if (node.url) {
        if (isScratchpadUrl(node.url) || node.title === 'Scratchpad Backup') {
          return;
        }
        results.push({
          id: node.id,
          title: node.title || node.url,
          url: node.url,
          spaceId,
          spaceName,
          isQuickAccess
        });
      }
      if (node.children) {
        for (const child of node.children) {
          const childIsQa =
            isQuickAccess ||
            (!child.url && child.title.trim().toLowerCase() === 'quick access');
          walk(
            child,
            spaceId,
            childIsQa && !isQuickAccess
              ? spaceId && spaceId !== 'home'
                ? `Quick Access (${spaceName})`
                : 'Quick Access'
              : spaceName,
            childIsQa
          );
        }
      }
    };

    if (arcticRoot?.id) {
      const [arcticSubtree] = await chrome.bookmarks.getSubTree(arcticRoot.id);
      visitedFolderIds.add(arcticRoot.id);

      if (arcticSubtree?.children) {
        for (const section of arcticSubtree.children) {
          visitedFolderIds.add(section.id);
          const sectionTitleLower = section.title.toLowerCase();
          const isQA =
            section.id === quickAccessFolderId ||
            sectionTitleLower === 'quick access' ||
            sectionTitleLower.startsWith('quick access (');

          if (isQA) {
            if (sectionTitleLower.startsWith('quick access (')) {
              const matchedQaSpace = storedSpaces.find(
                (s) =>
                  s.quickAccessFolderId === section.id ||
                  `quick access (${s.name.toLowerCase()})` === sectionTitleLower
              );
              if (storedSpaces.length > 0 && !matchedQaSpace) {
                continue;
              }
              walk(
                section,
                matchedQaSpace?.id || null,
                matchedQaSpace ? `Quick Access (${matchedQaSpace.name})` : 'Quick Access',
                true
              );
            } else {
              walk(section, null, 'Quick Access', true);
            }
          } else {
            const matchedSpace = storedSpaces.find(
              (s) =>
                s.folderId === section.id ||
                s.name.toLowerCase() === sectionTitleLower ||
                s.id.toLowerCase() === sectionTitleLower
            );
            const isHomeSection =
              sectionTitleLower === 'home' || sectionTitleLower === 'workspace';
            if (storedSpaces.length > 0 && !matchedSpace && !isHomeSection) {
              // Skip orphaned folders under Arctic root that do not belong to any active Space
              continue;
            }
            const spaceId =
              matchedSpace?.id ||
              (isHomeSection ? 'home' : sectionTitleLower);
            const spaceName = matchedSpace?.name || section.title;
            walk(section, spaceId, spaceName, false);
          }
        }
      }
    }

    // Also check any configured space or quick access folders that might be outside arcticRoot
    if (quickAccessFolderId && !visitedFolderIds.has(quickAccessFolderId)) {
      try {
        const [qaNode] = await chrome.bookmarks.getSubTree(quickAccessFolderId);
        if (qaNode) {
          visitedFolderIds.add(quickAccessFolderId);
          walk(qaNode, null, 'Quick Access', true);
        }
      } catch {}
    }

    for (const sp of storedSpaces) {
      if (sp.folderId && !visitedFolderIds.has(sp.folderId)) {
        try {
          const [spNode] = await chrome.bookmarks.getSubTree(sp.folderId);
          if (spNode) {
            visitedFolderIds.add(sp.folderId);
            walk(spNode, sp.id, sp.name, false);
          }
        } catch {}
      }
    }

    return results;
  } catch (err) {
    console.warn('[Arctic] Error searching Arctic bookmarks:', err);
    return [];
  }
}

export const App: React.FC<{ debounceMs?: number }> = ({ debounceMs }) => {
  const effectiveDebounceMs = typeof debounceMs === 'number' ? debounceMs : 0;

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [hasArrowNavigated, setHasArrowNavigated] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [colorTheme, setColorTheme] = useState<ColorThemeId>('pure-monochrome');
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [activeSiteEngine, setActiveSiteEngine] = useState<SiteSearchEngine | null>(null);
  const [siteTriggerQuery, setSiteTriggerQuery] = useState<string>('');
  const [dismissedEngineId, setDismissedEngineId] = useState<string | null>(null);
  const [customSearchEngines, setCustomSearchEngines] = useState<SiteSearchEngine[]>([]);
  const [regionalPrefs, setRegionalPrefs] = useState<RegionalDomainPreferences>({});

  // Smoothly debounce query changes when debounceMs is configured
  useEffect(() => {
    if (effectiveDebounceMs <= 0 || !query.trim()) {
      setDebouncedQuery(query);
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, effectiveDebounceMs);
    return () => clearTimeout(timer);
  }, [query, effectiveDebounceMs]);

  const activeQuery = effectiveDebounceMs <= 0 ? query : debouncedQuery;

  const candidateSiteEngine = activeSiteEngine
    ? null
    : findMatchingSiteEngine(query, customSearchEngines, regionalPrefs);
  const matchedSiteEngine =
    candidateSiteEngine && candidateSiteEngine.id !== dismissedEngineId
      ? candidateSiteEngine
      : null;

  const visualMatchedSiteEngine = matchedSiteEngine;
  const topActiveSuggestion =
    activeQuery.trim() &&
    activeQuery.trim() === query.trim() &&
    suggestions.length > 0
      ? suggestions[0]
      : undefined;
  const ghostSuffix = activeSiteEngine
    ? ''
    : computeInlineGhostSuffix(
        query,
        topActiveSuggestion?.url,
        topActiveSuggestion?.type,
        visualMatchedSiteEngine
      );

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arcticBookmarksRef = useRef<ArcticBookmarkItem[]>([]);
  const arcticBookmarksLoadedRef = useRef(false);
  const arcticBookmarksPromiseRef = useRef<Promise<ArcticBookmarkItem[]> | null>(null);
  const regionalSignalsRef = useRef<DomainSignalInput[]>([]);
  const lastGoogleSuggestionsRef = useRef<SuggestionItem[]>([]);
  const isNavigatingRef = useRef(false);
  const currentTabRef = useRef<chrome.tabs.Tab | null>(null);
  const currentWindowIdRef = useRef<number | null>(null);
  const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSuggestionContextRef = useRef<{ query: string; engineId: string | null }>({
    query: '',
    engineId: null
  });

  const mergeRegionalSignals = useCallback((newSignals: DomainSignalInput[]) => {
    if (newSignals.length === 0) return;
    const combined = [...newSignals, ...regionalSignalsRef.current].slice(0, 200);
    regionalSignalsRef.current = combined;
    const inferred = inferRegionalSiteDomains(combined);
    setRegionalPrefs((prev) => {
      const nextAmazon = inferred.amazon ?? prev.amazon;
      const nextGoogle = inferred.google ?? prev.google;
      if (nextAmazon === prev.amazon && nextGoogle === prev.google) {
        return prev;
      }
      return { amazon: nextAmazon, google: nextGoogle };
    });
  }, []);

  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll('[role="button"]');
    const activeEl = items[selectedIndex] as HTMLElement | undefined;
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const loadArcticBookmarks = useCallback(() => {
    if (!arcticBookmarksPromiseRef.current) {
      arcticBookmarksPromiseRef.current = getArcticBookmarks().then((items) => {
        arcticBookmarksRef.current = items;
        arcticBookmarksLoadedRef.current = true;
        mergeRegionalSignals(items.map((bm) => ({ url: bm.url, weight: 3 })));
        return items;
      });
    }
    return arcticBookmarksPromiseRef.current;
  }, [mergeRegionalSignals]);

  // Pre-load open tab domain signals on mount so regional site search (e.g. amazon.de) is instant
  useEffect(() => {
    if (!chrome?.tabs?.query) return;
    Promise.resolve(chrome.tabs.query({}))
      .then((tabs) => {
        if (!Array.isArray(tabs)) return;
        const tabSignals: DomainSignalInput[] = [];
        for (const t of tabs) {
          if (isArcticCommandTab(t)) continue;
          const effUrl = getEffectiveTabUrl(t);
          if (effUrl) {
            tabSignals.push({ url: effUrl, weight: 6 });
          }
        }
        mergeRegionalSignals(tabSignals);
      })
      .catch(() => {});
  }, [mergeRegionalSignals]);

  // Pre-load Arctic bookmarks for fast lookup and URL matching, and invalidate cache on bookmark/space changes
  useEffect(() => {
    loadArcticBookmarks();

    const invalidateBookmarksCache = () => {
      arcticBookmarksLoadedRef.current = false;
      arcticBookmarksPromiseRef.current = null;
      loadArcticBookmarks();
    };

    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local' && (changes.spaces || changes.quickAccessFolderId)) {
        invalidateBookmarksCache();
      }
    };

    chrome.bookmarks?.onCreated?.addListener(invalidateBookmarksCache);
    chrome.bookmarks?.onRemoved?.addListener(invalidateBookmarksCache);
    chrome.bookmarks?.onChanged?.addListener(invalidateBookmarksCache);
    chrome.bookmarks?.onMoved?.addListener(invalidateBookmarksCache);
    chrome.storage?.onChanged?.addListener(handleStorageChange);

    return () => {
      chrome.bookmarks?.onCreated?.removeListener(invalidateBookmarksCache);
      chrome.bookmarks?.onRemoved?.removeListener(invalidateBookmarksCache);
      chrome.bookmarks?.onChanged?.removeListener(invalidateBookmarksCache);
      chrome.bookmarks?.onMoved?.removeListener(invalidateBookmarksCache);
      chrome.storage?.onChanged?.removeListener(handleStorageChange);
    };
  }, [loadArcticBookmarks]);

  // Pre-resolve current tab and window for instantaneous navigation & sidePanel dispatch
  useEffect(() => {
    if (chrome?.tabs?.getCurrent) {
      Promise.resolve(chrome.tabs.getCurrent())
        .then((tab) => {
          if (tab) {
            currentTabRef.current = tab;
            if (typeof tab.windowId === 'number') {
              currentWindowIdRef.current = tab.windowId;
            }
          }
        })
        .catch(() => {});
    }
    if (chrome?.windows?.getCurrent) {
      Promise.resolve(chrome.windows.getCurrent())
        .then((win) => {
          if (win && typeof win.id === 'number') {
            currentWindowIdRef.current = win.id;
          }
        })
        .catch(() => {});
    }
  }, []);

  // Safety cleanup for navigation timeout
  useEffect(() => {
    return () => {
      if (navTimeoutRef.current) {
        clearTimeout(navTimeoutRef.current);
      }
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2400);
  }, []);

  // Sync theme, palettes, and custom search engines with Arctic storage
  useEffect(() => {
    chrome.storage.local.get(['theme', 'colorTheme', 'customSearchEngines'], (res) => {
      if (isValidThemeMode(res.theme)) {
        setTheme(res.theme);
      }
      if (isValidColorTheme(res.colorTheme)) {
        setColorTheme(res.colorTheme);
      }
      if (Array.isArray(res.customSearchEngines)) {
        setCustomSearchEngines(res.customSearchEngines as SiteSearchEngine[]);
      }
    });

    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local') {
        if (changes.theme && isValidThemeMode(changes.theme.newValue)) {
          setTheme(changes.theme.newValue);
        }
        if (changes.colorTheme && isValidColorTheme(changes.colorTheme.newValue)) {
          setColorTheme(changes.colorTheme.newValue);
        }
        if (changes.customSearchEngines) {
          setCustomSearchEngines(
            Array.isArray(changes.customSearchEngines.newValue)
              ? (changes.customSearchEngines.newValue as SiteSearchEngine[])
              : []
          );
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // Fetch available spaces from storage
  useEffect(() => {
    const loadSpaces = () => {
      chrome.storage.local.get(['spaces'], (res) => {
        if (Array.isArray(res.spaces) && res.spaces.length > 0) {
          setSpaces(
            res.spaces.map((s: SpaceItem) => ({
              id: s.id,
              name: s.name,
              folderId: s.folderId
            }))
          );
        } else {
          setSpaces([
            { id: 'home', name: 'Home' }
          ]);
        }
      });
    };

    loadSpaces();

    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local' && changes.spaces) {
        loadSpaces();
      }
    };
    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }
    return () => {
      if (chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      }
    };
  }, []);

  // Apply theme & color palette classes (including live OS system theme tracking)
  useEffect(() => {
    const applyEffectiveTheme = (effective: 'dark' | 'light') => {
      if (effective === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      }
    };

    applyEffectiveTheme(resolveEffectiveTheme(theme));
    document.documentElement.setAttribute('data-color-theme', colorTheme);

    if (theme === 'system' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent) => {
        applyEffectiveTheme(e.matches ? 'dark' : 'light');
      };
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handleChange);
        return () => mediaQuery.removeListener(handleChange);
      }
    }
  }, [theme, colorTheme]);

  // Keep input focused automatically
  useEffect(() => {
    const focusInput = () => {
      if (isNavigatingRef.current) return;
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    };

    focusInput();
    const t1 = setTimeout(focusInput, 50);
    const t2 = setTimeout(focusInput, 150);

    window.addEventListener('focus', focusInput);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('focus', focusInput);
    };
  }, []);

  // Capture keyboard typing outside input and direct into search input
  useEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (isNavigatingRef.current) return;
      if (
        inputRef.current &&
        document.activeElement !== inputRef.current &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        e.key.length === 1
      ) {
        inputRef.current.focus();
      }
    };
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, []);

  // Action commands registry
  const getActionCommands = useCallback((): SuggestionItem[] => {
    const effectiveTheme = resolveEffectiveTheme(theme);

    const cmds: SuggestionItem[] = [
      // 1. Open Arctic Settings
      {
        id: 'cmd-open-settings',
        type: 'command',
        title: 'Open Arctic Settings',
        description: 'Configure Arctic theme, appearance, density, and folder mapping',
        commandCategory: 'Settings',
        icon: <Settings className="w-4 h-4 text-cyan-400" />,
        action: async () => {
          const openSidePanelPromise = (async () => {
            const cachedWinId = currentWindowIdRef.current ?? currentTabRef.current?.windowId;
            if (typeof cachedWinId === 'number' && chrome?.sidePanel?.open) {
              await chrome.sidePanel.open({ windowId: cachedWinId });
              return true;
            }
            const win = await chrome?.windows?.getCurrent();
            if (win?.id && chrome?.sidePanel?.open) {
              await chrome.sidePanel.open({ windowId: win.id });
              return true;
            }
            return false;
          })().catch(() => false);

          await chrome?.storage?.local?.set({ openArcticSettings: Date.now() });
          try {
            chrome.runtime?.sendMessage?.({ type: 'OPEN_ARCTIC_SETTINGS' });
          } catch {
            // ignore
          }
          await openSidePanelPromise;
          showToast('Opened Arctic Settings');
        }
      },
      {
        id: 'cmd-customize-shortcut',
        type: 'command',
        title: 'Customize Sidebar Keyboard Shortcut',
        description: 'Change the keyboard shortcut for toggling Arctic Sidebar',
        commandCategory: 'Settings',
        icon: <Command className="w-4 h-4 text-cyan-400" />,
        action: async () => {
          await chrome?.tabs?.create?.({ url: 'chrome://extensions/shortcuts' });
          showToast('Opened Chrome Extension Shortcuts');
        }
      },
      // 2. Theme Toggle & System Theme
      {
        id: 'cmd-toggle-theme',
        type: 'command',
        title: effectiveTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        description: `Toggle theme (currently ${theme} mode)`,
        commandCategory: 'Theme',
        icon:
          effectiveTheme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-indigo-400" />
          ),
        action: async () => {
          const nextTheme: ThemeMode = effectiveTheme === 'dark' ? 'light' : 'dark';
          setTheme(nextTheme);
          await chrome?.storage?.local?.set({ theme: nextTheme });
          showToast(`Theme switched to ${nextTheme} mode`);
        }
      },
      {
        id: 'cmd-theme-system',
        type: 'command',
        title: 'Theme: System (Auto Light/Dark)',
        description: 'Automatically apply your system light or dark theme',
        commandCategory: 'Theme',
        icon: <Monitor className="w-4 h-4 text-cyan-400" />,
        action: async () => {
          setTheme('system');
          await chrome?.storage?.local?.set({ theme: 'system' });
          showToast('Theme set to System (auto light/dark)');
        }
      },
      // 3. Color Themes (all themes including Aqua & multi-tone palettes)
      ...COLOR_THEMES.map((t) => ({
        id: `cmd-palette-${t.id}`,
        type: 'command' as const,
        title: `Theme: ${t.name}`,
        description: `${t.tag} — ${t.description}${colorTheme === t.id ? ' (Active)' : ''}`,
        commandCategory: 'Theme',
        icon: <Palette className="w-4 h-4" style={{ color: t.accentColor }} />,
        action: async () => {
          setColorTheme(t.id);
          await chrome?.storage?.local?.set({ colorTheme: t.id });
          showToast(`Color palette set to ${t.name}`);
        }
      })),
      // 4. Side Panel
      {
        id: 'cmd-open-sidebar',
        type: 'command',
        title: 'Open Arctic Sidebar',
        description: 'Open the vertical tabs and spaces panel',
        commandCategory: 'Navigation',
        icon: <PanelLeft className="w-4 h-4 text-cyan-400" />,
        action: async () => {
          try {
            const cachedWinId = currentWindowIdRef.current ?? currentTabRef.current?.windowId;
            if (typeof cachedWinId === 'number' && chrome?.sidePanel?.open) {
              await chrome.sidePanel.open({ windowId: cachedWinId });
              showToast('Arctic Sidebar opened');
              return;
            }
            const win = await chrome?.windows?.getCurrent();
            if (win?.id && chrome?.sidePanel?.open) {
              await chrome.sidePanel.open({ windowId: win.id });
              showToast('Arctic Sidebar opened');
            } else {
              showToast('Click the Arctic icon in Chrome toolbar to open sidebar');
            }
          } catch {
            showToast('Click the Arctic icon in Chrome toolbar to open sidebar');
          }
        }
      },
      // 4. Tab Memory Saver (Sleep tabs in parallel with instant update)
      {
        id: 'cmd-sleep-tabs',
        type: 'command',
        title: 'Sleep Inactive Background Tabs',
        description: 'Free up memory by discarding idle tabs',
        commandCategory: 'Tabs',
        icon: <Zap className="w-4 h-4 text-amber-400" />,
        action: async () => {
          if (!chrome?.tabs?.query) return;
          const tabs = await chrome.tabs.query({ currentWindow: true });
          const toDiscard = tabs.filter(
            (t) => !t.active && !t.discarded && typeof t.id === 'number'
          );

          if (toDiscard.length === 0) {
            showToast('All background tabs are already asleep');
            return;
          }

          // Discard all background tabs simultaneously in parallel
          const results = await Promise.allSettled(
            toDiscard.map((t) => chrome.tabs.discard(t.id as number))
          );
          const count = results.filter((r) => r.status === 'fulfilled').length;

          // Notify sidebar to refresh tab state instantly
          try {
            chrome.runtime?.sendMessage?.({ type: 'REFRESH_TABS' });
          } catch {
            // ignore
          }

          showToast(
            count > 0
              ? `Slept ${count} background tab${count === 1 ? '' : 's'}`
              : 'All background tabs are already asleep'
          );
        }
      },
      // 5. Close Duplicate Tabs
      {
        id: 'cmd-close-duplicates',
        type: 'command',
        title: 'Close Duplicate Tabs',
        description: 'Find and close repeated open URLs',
        commandCategory: 'Tabs',
        icon: <Trash2 className="w-4 h-4 text-rose-400" />,
        action: async () => {
          if (!chrome?.tabs?.query) return;
          const tabs = await chrome.tabs.query({ currentWindow: true });
          const seen = new Set<string>();
          const duplicateIds: number[] = [];
          for (const t of tabs) {
            const effUrl = getEffectiveTabUrl(t);
            if (effUrl && !t.pinned && typeof t.id === 'number') {
              const cleanUrl = effUrl.replace(/#.*$/, '').replace(/\/$/, '');
              if (seen.has(cleanUrl)) {
                duplicateIds.push(t.id);
              } else {
                seen.add(cleanUrl);
              }
            }
          }
          if (duplicateIds.length > 0) {
            await Promise.allSettled(duplicateIds.map((id) => chrome.tabs.remove(id)));
            try {
              chrome.runtime?.sendMessage?.({ type: 'REFRESH_TABS' });
            } catch {
              // ignore
            }
          }
          showToast(
            duplicateIds.length > 0
              ? `Closed ${duplicateIds.length} duplicate tab${duplicateIds.length === 1 ? '' : 's'}`
              : 'No duplicate tabs found'
          );
        }
      },
      // 6. Restore Tab
      {
        id: 'cmd-restore-tab',
        type: 'command',
        title: 'Reopen Last Closed Tab',
        description: 'Restore the most recently closed tab',
        commandCategory: 'Tabs',
        icon: <RotateCcw className="w-4 h-4 text-indigo-400" />,
        action: async () => {
          if (chrome?.sessions?.restore) {
            await chrome.sessions.restore();
            window.close();
          } else {
            showToast('Session restore not available');
          }
        }
      },
      // 7. Chrome Internal URLs
      {
        id: 'cmd-open-bookmarks',
        type: 'command',
        title: 'Open Chrome Bookmarks Manager',
        description: 'chrome://bookmarks',
        commandCategory: 'System',
        icon: <Bookmark className="w-4 h-4 text-amber-400" />,
        url: 'chrome://bookmarks'
      },
      {
        id: 'cmd-open-history',
        type: 'command',
        title: 'Open Chrome History',
        description: 'chrome://history',
        commandCategory: 'System',
        icon: <History className="w-4 h-4 text-zinc-400" />,
        url: 'chrome://history'
      },
      {
        id: 'cmd-open-extensions',
        type: 'command',
        title: 'Open Chrome Extensions',
        description: 'chrome://extensions',
        commandCategory: 'System',
        icon: <Settings className="w-4 h-4 text-cyan-400" />,
        url: 'chrome://extensions'
      },
      {
        id: 'cmd-open-downloads',
        type: 'command',
        title: 'Open Chrome Downloads',
        description: 'chrome://downloads',
        commandCategory: 'System',
        icon: <ExternalLink className="w-4 h-4 text-indigo-400" />,
        url: 'chrome://downloads'
      }
    ];

    // Dynamic Spaces Commands (mapped to actual sidebar space switching)
    for (const sp of spaces) {
      cmds.push({
        id: `cmd-space-${sp.id}`,
        type: 'command',
        title: `Switch Space: ${sp.name}`,
        description: 'Switch active space in Arctic Sidebar',
        commandCategory: 'Spaces',
        icon: <Layers className="w-4 h-4 text-amber-400" />,
        action: async () => {
          await chrome?.storage?.local?.set({ activeSpaceId: sp.id });
          showToast(`Switched active space to "${sp.name}"`);
        }
      });
    }

    return cmds;
  }, [theme, colorTheme, spaces, showToast]);

  // Load suggestions from commands, open tabs, bookmarks, history, and search
  useEffect(() => {
    let isCancelled = false;
    const trimmed = activeQuery.trim();
    const currentEngineId = activeSiteEngine?.id ?? null;
    const didQueryContextChange =
      trimmed !== lastSuggestionContextRef.current.query ||
      currentEngineId !== lastSuggestionContextRef.current.engineId;
    lastSuggestionContextRef.current = { query: trimmed, engineId: currentEngineId };

    // SITE SEARCH MODE (activated via Tab on a matched site engine)
    if (activeSiteEngine) {
      lastGoogleSuggestionsRef.current = [];
      const fetchSiteResults = async () => {
        const results: SuggestionItem[] = [];
        const seenUrls = new Set<string>();
        const lowerTrimmed = trimmed.toLowerCase();

        // 1. Primary Site Search or Open Site action
        if (trimmed) {
          const siteSearchUrl = buildSiteSearchUrl(activeSiteEngine, trimmed);
          results.push({
            id: `site-search-${activeSiteEngine.id}`,
            type: 'search',
            title: `Search ${activeSiteEngine.name} for "${trimmed}"`,
            url: siteSearchUrl,
            domain: activeSiteEngine.domain
          });
          seenUrls.add(siteSearchUrl.toLowerCase());
        } else {
          const siteHomeUrl = `https://${activeSiteEngine.domain}`;
          results.push({
            id: `site-open-${activeSiteEngine.id}`,
            type: 'url',
            title: `Open ${activeSiteEngine.name}`,
            url: siteHomeUrl,
            domain: activeSiteEngine.domain
          });
          seenUrls.add(siteHomeUrl.toLowerCase());
          seenUrls.add(normalizeUrl(siteHomeUrl).toLowerCase());
          seenUrls.add(getCanonicalUrlKey(siteHomeUrl).toLowerCase());
        }

        // 2. Domain-scoped Open Tabs (Today's Tabs & Open Space Tabs)
        try {
          if (chrome?.tabs?.query) {
            const [openTabs, sessionData, localData] = await Promise.all([
              chrome.tabs.query({}).catch(() => []),
              chrome.storage?.session?.get
                ? chrome.storage.session
                    .get(['bookmarkIdByTabId', 'customTabTitles'])
                    .catch(() => ({}))
                : Promise.resolve({}),
              chrome.storage?.local?.get
                ? chrome.storage.local.get(['tabSpaceByTabId']).catch(() => ({}))
                : Promise.resolve({})
            ]);
            const byTab =
              ((sessionData as { bookmarkIdByTabId?: Record<number, string> })
                ?.bookmarkIdByTabId as Record<number, string>) || {};
            const customTitles =
              ((sessionData as { customTabTitles?: Record<number, string> })
                ?.customTabTitles as Record<number, string>) || {};
            const tabSpaceByTabId =
              ((localData as { tabSpaceByTabId?: Record<number, string> })
                ?.tabSpaceByTabId as Record<number, string>) || {};

            for (const t of openTabs) {
              if (
                typeof t.id !== 'number' ||
                t.id === currentTabRef.current?.id ||
                byTab[t.id] ||
                isArcticCommandTab(t)
              ) {
                continue;
              }
              const effUrl = getEffectiveTabUrl(t);
              const tabTitle = customTitles[t.id] || t.title || effUrl;
              if (
                effUrl &&
                doesUrlMatchEngineDomain(effUrl, activeSiteEngine) &&
                (!lowerTrimmed ||
                  tabTitle.toLowerCase().includes(lowerTrimmed) ||
                  effUrl.toLowerCase().includes(lowerTrimmed))
              ) {
                const canon = getCanonicalUrlKey(effUrl).toLowerCase();
                if (!seenUrls.has(effUrl.toLowerCase()) && !seenUrls.has(canon)) {
                  seenUrls.add(effUrl.toLowerCase());
                  seenUrls.add(canon);
                  results.push({
                    id: `site-tab-${t.id}`,
                    type: 'tab',
                    title: tabTitle,
                    url: effUrl,
                    domain: getDomainFromUrl(effUrl),
                    isOpenTab: true,
                    tabId: t.id,
                    windowId: t.windowId,
                    spaceId: tabSpaceByTabId[t.id] || 'home'
                  });
                  if (results.length >= 5) break;
                }
              }
            }
          }
        } catch {
          // ignore
        }

        // 3. Domain-scoped Arctic Bookmarks
        try {
          const arcticBm = arcticBookmarksLoadedRef.current
            ? arcticBookmarksRef.current
            : await loadArcticBookmarks();
          const matchingArctic = arcticBm.filter(
            (bm) =>
              doesUrlMatchEngineDomain(bm.url, activeSiteEngine) &&
              (!lowerTrimmed ||
                bm.title.toLowerCase().includes(lowerTrimmed) ||
                bm.url.toLowerCase().includes(lowerTrimmed))
          );

          for (const bm of matchingArctic) {
            const norm = normalizeUrl(bm.url).toLowerCase();
            const canon = getCanonicalUrlKey(bm.url).toLowerCase();
            if (
              !seenUrls.has(bm.url.toLowerCase()) &&
              !seenUrls.has(norm) &&
              !seenUrls.has(canon)
            ) {
              seenUrls.add(bm.url.toLowerCase());
              seenUrls.add(norm);
              seenUrls.add(canon);
              results.push({
                id: `arctic-bm-${bm.id}`,
                type: 'bookmark',
                title: bm.title,
                url: bm.url,
                bookmarkId: bm.id,
                spaceId: bm.spaceId,
                spaceName: bm.spaceName,
                isQuickAccess: bm.isQuickAccess,
                isArctic: true,
                domain:
                  bm.spaceName.toLowerCase() === 'quick access'
                    ? 'Quick Access'
                    : `Space: ${bm.spaceName}`
              });
              if (results.length >= 6) break;
            }
          }
        } catch {
          // ignore
        }

        // 4. Domain-scoped History
        try {
          if (chrome?.history?.search) {
            const historyItems = await chrome.history.search({
              text: trimmed || activeSiteEngine.domain,
              maxResults: 16,
              startTime: 0
            });
            for (const item of historyItems) {
              if (
                item.url &&
                doesUrlMatchEngineDomain(item.url, activeSiteEngine) &&
                (!lowerTrimmed ||
                  (item.title && item.title.toLowerCase().includes(lowerTrimmed)) ||
                  item.url.toLowerCase().includes(lowerTrimmed))
              ) {
                const norm = normalizeUrl(item.url).toLowerCase();
                const collapseKey = getHistoryCollapseKey(item.url, item.title);
                if (
                  !seenUrls.has(item.url.toLowerCase()) &&
                  !seenUrls.has(norm) &&
                  !seenUrls.has(collapseKey)
                ) {
                  seenUrls.add(item.url.toLowerCase());
                  seenUrls.add(norm);
                  seenUrls.add(collapseKey);
                  results.push({
                    id: `hist-${item.id}`,
                    type: 'history',
                    title: item.title || item.url,
                    url: item.url,
                    domain: getDomainFromUrl(item.url)
                  });
                  if (results.length >= 8) break;
                }
              }
            }
          }
        } catch {
          // ignore
        }

        if (!isCancelled) {
          setSuggestions(results);
          setSelectedIndex(0);
        }
      };

      fetchSiteResults();

      return () => {
        isCancelled = true;
      };
    }

    // EXPLICIT COMMAND MODE (starts with '>' or 'Theme:' / 'Palette:')
    const rawCommandFilter = trimmed.startsWith('>') ? trimmed.slice(1).trim() : trimmed;
    const isThemePrefixQuery = /^(theme|palette):/i.test(rawCommandFilter);

    if (trimmed.startsWith('>') || isThemePrefixQuery) {
      lastGoogleSuggestionsRef.current = [];
      const allCmds = getActionCommands();
      const filterTerm = rawCommandFilter.toLowerCase();

      let matchedCmds: SuggestionItem[];
      if (isThemePrefixQuery) {
        const themeSubQuery = filterTerm.replace(/^(theme|palette):\s*/i, '').trim();
        matchedCmds = allCmds.filter(
          (c) =>
            c.commandCategory === 'Theme' &&
            (!themeSubQuery ||
              c.title.toLowerCase().includes(themeSubQuery) ||
              c.description?.toLowerCase().includes(themeSubQuery))
        );
      } else {
        matchedCmds = filterTerm
          ? allCmds.filter(
              (c) =>
                c.title.toLowerCase().includes(filterTerm) ||
                c.description?.toLowerCase().includes(filterTerm) ||
                c.commandCategory?.toLowerCase().includes(filterTerm) ||
                ('palette'.includes(filterTerm) && c.commandCategory === 'Theme')
            )
          : allCmds;
      }

      setSuggestions(matchedCmds);
      setSelectedIndex((prev) => {
        if (matchedCmds.length === 0) return -1;
        if (didQueryContextChange) return 0;
        return prev >= 0 && prev < matchedCmds.length ? prev : 0;
      });
      return;
    }

    // EMPTY QUERY: fetch top 6 most visited / recent history items (and seed regional domains)
    if (!trimmed) {
      lastGoogleSuggestionsRef.current = [];
      if (chrome?.history?.search) {
        chrome.history.search(
          { text: '', maxResults: 40, startTime: 0 },
          (historyItems) => {
            if (isCancelled) return;
            const validHistory = (historyItems || []).filter(
              (h) =>
                h.url &&
                !h.url.startsWith('chrome://') &&
                !h.url.startsWith('chrome-extension://') &&
                !isScratchpadUrl(h.url)
            );
            mergeRegionalSignals(
              validHistory.map((h) => ({
                url: h.url!,
                weight: Math.min(4, 1 + Math.floor((h.visitCount || 1) / 5))
              }))
            );
            const items: SuggestionItem[] = validHistory.slice(0, 6).map((h) => ({
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

    // NON-EMPTY QUERY: parallel omnibox search across Open Tabs, Bookmarks, History, Commands & Web
    const fetchResults = async () => {
      const [
        arcticBm,
        allOpenTabs,
        sessionData,
        localTabData,
        generalNodes,
        historyItems
      ] = await Promise.all([
        (arcticBookmarksLoadedRef.current
          ? Promise.resolve(arcticBookmarksRef.current)
          : loadArcticBookmarks()
        ).catch(() => [] as ArcticBookmarkItem[]),
        chrome?.tabs?.query ? chrome.tabs.query({}).catch(() => []) : Promise.resolve([]),
        chrome?.storage?.session?.get
          ? chrome.storage.session
              .get(['bindingsByBookmarkId', 'bookmarkIdByTabId', 'customTabTitles'])
              .catch(() => ({}))
          : Promise.resolve({}),
        chrome?.storage?.local?.get
          ? chrome.storage.local
              .get(['activeSpaceId', 'tabSpaceByTabId'])
              .catch(() => ({}))
          : Promise.resolve({}),
        chrome?.bookmarks?.search
          ? chrome.bookmarks.search(trimmed).catch(() => [])
          : Promise.resolve([]),
        chrome?.history?.search
          ? chrome.history
              .search({
                text: trimmed,
                maxResults: 50,
                startTime: 0
              })
              .catch(() => [])
          : Promise.resolve([])
      ]);

      const bindings =
        ((sessionData as { bindingsByBookmarkId?: Record<string, TabBinding> })
          ?.bindingsByBookmarkId as Record<string, TabBinding>) || {};
      const rawByTab =
        ((sessionData as { bookmarkIdByTabId?: Record<number, string> })
          ?.bookmarkIdByTabId as Record<number, string>) || {};
      const customTabTitles =
        ((sessionData as { customTabTitles?: Record<number, string> })
          ?.customTabTitles as Record<number, string>) || {};
      const activeSpaceId =
        typeof (localTabData as { activeSpaceId?: string })?.activeSpaceId === 'string' &&
        (localTabData as { activeSpaceId?: string }).activeSpaceId
          ? (localTabData as { activeSpaceId: string }).activeSpaceId
          : 'home';
      const tabSpaceByTabId =
        ((localTabData as { tabSpaceByTabId?: Record<number, string> })
          ?.tabSpaceByTabId as Record<number, string>) || {};

      const launcherTabId = currentTabRef.current?.id;
      const currentWinId =
        currentWindowIdRef.current ?? currentTabRef.current?.windowId ?? null;

      // Index live open tabs (excluding the temporary Command Bar launcher tab & internal pages)
      const liveTabsById = new Map<number, chrome.tabs.Tab>();
      const discoveredRegionalSignals: DomainSignalInput[] = [];

      for (const tab of allOpenTabs) {
        if (typeof tab.id !== 'number' || tab.id === launcherTabId) continue;
        if (isArcticCommandTab(tab)) continue;
        const effUrl = getEffectiveTabUrl(tab);
        if (
          !effUrl ||
          effUrl === 'about:blank' ||
          effUrl.startsWith('chrome://') ||
          effUrl.startsWith('chrome-extension://') ||
          isScratchpadUrl(effUrl)
        ) {
          continue;
        }
        liveTabsById.set(tab.id, tab);
        discoveredRegionalSignals.push({ url: effUrl, weight: 6 });
      }

      // Build canonical history frecency lookup so Open Tabs & Bookmarks also benefit from visit stats
      const historyStatsByCanon = new Map<
        string,
        { visitCount?: number; typedCount?: number; lastVisitTime?: number }
      >();
      for (const h of historyItems) {
        if (!h.url) continue;
        discoveredRegionalSignals.push({
          url: h.url,
          weight: Math.min(4, 1 + Math.floor((h.visitCount || 1) / 5))
        });
        const canon = getCanonicalUrlKey(h.url).toLowerCase();
        const prev = historyStatsByCanon.get(canon);
        if (!prev || (h.visitCount || 0) > (prev.visitCount || 0)) {
          historyStatsByCanon.set(canon, {
            visitCount: h.visitCount,
            typedCount: h.typedCount,
            lastVisitTime: h.lastVisitTime
          });
        }
      }

      for (const bm of generalNodes) {
        if (bm.url) {
          discoveredRegionalSignals.push({ url: bm.url, weight: 2 });
        }
      }
      mergeRegionalSignals(discoveredRegionalSignals);

      // Determine which live tabs are genuinely bound to an Arctic bookmark
      const liveBoundBookmarkIdByTabId: Record<number, string> = {};
      for (const [tabIdStr, bmId] of Object.entries(rawByTab)) {
        const numId = Number(tabIdStr);
        if (liveTabsById.has(numId) && bmId) {
          liveBoundBookmarkIdByTabId[numId] = bmId;
        }
      }

      const candidates: OmniboxCandidate[] = [];
      const consumedTabIds = new Set<number>();
      const seenCanonicalUrls = new Set<string>();
      const seenHistoryCollapseKeys = new Set<string>();
      const arcticBookmarkIds = new Set<string>();

      // 1. Arctic Bookmarks (Quick Access & Spaces, enriched with bound/matching open tab state)
      for (const bm of arcticBm) {
        arcticBookmarkIds.add(bm.id);
        const bmCanon = getCanonicalUrlKey(bm.url).toLowerCase();
        const histStats = historyStatsByCanon.get(bmCanon);

        let matchedOpenTab: chrome.tabs.Tab | undefined;
        let secondaryTitle: string | undefined;
        let secondaryUrl: string | undefined;

        const existingBinding = bindings[bm.id];
        if (existingBinding && liveTabsById.has(existingBinding.tabId)) {
          matchedOpenTab = liveTabsById.get(existingBinding.tabId);
          consumedTabIds.add(existingBinding.tabId);
          secondaryTitle =
            customTabTitles[existingBinding.tabId] ||
            existingBinding.currentTitle ||
            matchedOpenTab?.title;
          secondaryUrl =
            getEffectiveTabUrl(matchedOpenTab) || existingBinding.currentUrl;
        } else {
          // Check if an unbound live tab matches this Arctic bookmark's URL
          for (const [tId, tab] of liveTabsById.entries()) {
            if (consumedTabIds.has(tId) || liveBoundBookmarkIdByTabId[tId]) continue;
            const effUrl = getEffectiveTabUrl(tab);
            if (effUrl && doesTabUrlMatchBookmark(effUrl, bm.url)) {
              matchedOpenTab = tab;
              consumedTabIds.add(tId);
              secondaryTitle = customTabTitles[tId] || tab.title;
              secondaryUrl = effUrl;
              break;
            }
          }
        }

        seenCanonicalUrls.add(bmCanon);
        seenCanonicalUrls.add(normalizeUrl(bm.url).toLowerCase());
        if (secondaryUrl) {
          seenCanonicalUrls.add(getCanonicalUrlKey(secondaryUrl).toLowerCase());
        }

        const isOpen = Boolean(matchedOpenTab);
        const matchedTabId = matchedOpenTab?.id;
        const lastAccessed = (
          matchedOpenTab as (chrome.tabs.Tab & { lastAccessed?: number }) | undefined
        )?.lastAccessed;

        candidates.push({
          id: `arctic-bm-${bm.id}`,
          source: 'arctic-bookmark',
          title: bm.title,
          secondaryTitle,
          url: bm.url,
          secondaryUrl,
          bookmarkId: bm.id,
          spaceId: bm.spaceId,
          spaceName: bm.spaceName,
          isQuickAccess: bm.isQuickAccess,
          isArctic: true,
          isOpenTab: isOpen,
          tabId: matchedTabId,
          windowId: matchedOpenTab?.windowId,
          isInActiveSpace: !bm.spaceId || bm.spaceId === activeSpaceId,
          isInCurrentWindow:
            !matchedOpenTab ||
            currentWinId === null ||
            matchedOpenTab.windowId === currentWinId,
          lastAccessed,
          visitCount: histStats?.visitCount,
          typedCount: histStats?.typedCount,
          lastVisitTime: histStats?.lastVisitTime,
          domain:
            bm.spaceName.toLowerCase() === 'quick access'
              ? 'Quick Access'
              : `Space: ${bm.spaceName}`
        });
      }

      // 2. Unbound Live Open Tabs ("Today's Tabs")
      const orderedUnboundTabs = Array.from(liveTabsById.values())
        .filter((t) => typeof t.id === 'number' && !consumedTabIds.has(t.id))
        .sort((a, b) => {
          const aWin = currentWinId !== null && a.windowId === currentWinId ? 1 : 0;
          const bWin = currentWinId !== null && b.windowId === currentWinId ? 1 : 0;
          if (aWin !== bWin) return bWin - aWin;
          const aAcc = (a as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed || 0;
          const bAcc = (b as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed || 0;
          return bAcc - aAcc;
        });

      for (const tab of orderedUnboundTabs) {
        const tabId = tab.id as number;
        const effUrl = getEffectiveTabUrl(tab);
        if (!effUrl) continue;
        const canon = getCanonicalUrlKey(effUrl).toLowerCase();
        if (seenCanonicalUrls.has(canon)) continue;
        seenCanonicalUrls.add(canon);
        seenCanonicalUrls.add(normalizeUrl(effUrl).toLowerCase());

        const histStats = historyStatsByCanon.get(canon);
        const tabSpace = tabSpaceByTabId[tabId] || 'home';
        const lastAccessed = (tab as chrome.tabs.Tab & { lastAccessed?: number })
          .lastAccessed;

        candidates.push({
          id: `open-tab-${tabId}`,
          source: 'tab',
          title: customTabTitles[tabId] || tab.title || effUrl,
          url: effUrl,
          domain: getDomainFromUrl(effUrl),
          isOpenTab: true,
          tabId,
          windowId: tab.windowId,
          spaceId: tabSpace,
          isInActiveSpace: tabSpace === activeSpaceId,
          isInCurrentWindow: currentWinId === null || tab.windowId === currentWinId,
          lastAccessed,
          visitCount: histStats?.visitCount,
          typedCount: histStats?.typedCount,
          lastVisitTime: histStats?.lastVisitTime
        });
      }

      // 3. General Chrome Bookmarks (always searched, deduplicated against Arctic & Open Tabs)
      for (const bm of generalNodes) {
        if (
          !bm.url ||
          arcticBookmarkIds.has(bm.id) ||
          isScratchpadUrl(bm.url) ||
          bm.title === 'Scratchpad Backup'
        ) {
          continue;
        }
        const canon = getCanonicalUrlKey(bm.url).toLowerCase();
        const norm = normalizeUrl(bm.url).toLowerCase();
        if (
          seenCanonicalUrls.has(bm.url.toLowerCase()) ||
          seenCanonicalUrls.has(norm) ||
          seenCanonicalUrls.has(canon)
        ) {
          continue;
        }
        seenCanonicalUrls.add(bm.url.toLowerCase());
        seenCanonicalUrls.add(norm);
        seenCanonicalUrls.add(canon);

        const histStats = historyStatsByCanon.get(canon);
        candidates.push({
          id: `chrome-bm-${bm.id}`,
          source: 'chrome-bookmark',
          title: bm.title || bm.url,
          url: bm.url,
          bookmarkId: bm.id,
          isArctic: false,
          domain: getDomainFromUrl(bm.url),
          visitCount: histStats?.visitCount,
          typedCount: histStats?.typedCount,
          lastVisitTime: histStats?.lastVisitTime
        });
      }

      // 4. Browser History (expanded pool, collapsing duplicate OAuth/sign-in redirects)
      for (const item of historyItems) {
        if (
          !item.url ||
          item.url.startsWith('chrome://') ||
          item.url.startsWith('chrome-extension://') ||
          isScratchpadUrl(item.url)
        ) {
          continue;
        }
        const canon = getCanonicalUrlKey(item.url).toLowerCase();
        const norm = normalizeUrl(item.url).toLowerCase();
        const collapseKey = getHistoryCollapseKey(item.url, item.title);
        if (
          seenCanonicalUrls.has(item.url.toLowerCase()) ||
          seenCanonicalUrls.has(norm) ||
          seenCanonicalUrls.has(canon) ||
          seenHistoryCollapseKeys.has(collapseKey)
        ) {
          continue;
        }
        seenCanonicalUrls.add(item.url.toLowerCase());
        seenCanonicalUrls.add(norm);
        seenCanonicalUrls.add(canon);
        seenHistoryCollapseKeys.add(collapseKey);

        candidates.push({
          id: `hist-${item.id}`,
          source: 'history',
          title: item.title || item.url,
          url: item.url,
          domain: getDomainFromUrl(item.url),
          visitCount: item.visitCount,
          typedCount: item.typedCount,
          lastVisitTime: item.lastVisitTime
        });
      }

      // 5. Score & Rank Omnibox Candidates + Strong Title-Matched Action Commands
      const rankedOmnibox = rankOmniboxCandidates(candidates, trimmed, {
        maxResults: 8
      });

      const scoredEntries: Array<{ score: number; item: SuggestionItem }> =
        rankedOmnibox.map((r) => ({
          score: r.score,
          item: {
            id: r.id,
            type:
              r.source === 'tab'
                ? 'tab'
                : r.source === 'arctic-bookmark' || r.source === 'chrome-bookmark'
                  ? 'bookmark'
                  : r.source === 'url'
                    ? 'url'
                    : 'history',
            title: r.title,
            url: r.url,
            domain: r.domain,
            bookmarkId: r.bookmarkId,
            spaceId: r.spaceId,
            spaceName: r.spaceName,
            isQuickAccess: r.isQuickAccess,
            isArctic: r.isArctic,
            isOpenTab: r.isOpenTab,
            tabId: r.tabId,
            windowId: r.windowId
          }
        }));

      const scoredCmds = getActionCommands()
        .map((cmd) => ({
          score: scoreActionCommand(cmd.title, trimmed),
          item: cmd
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);

      scoredEntries.push(...scoredCmds);
      scoredEntries.sort((a, b) => b.score - a.score);

      const results: SuggestionItem[] = scoredEntries.slice(0, 8).map((e) => e.item);

      // 6. Direct URL suggestion (if user typed a URL-like input not already in ranked results)
      if (isLikelyUrl(trimmed)) {
        const directUrl = formatNavigationUrl(trimmed);
        const directNorm = normalizeUrl(directUrl).toLowerCase();
        const directCanon = getCanonicalUrlKey(directUrl).toLowerCase();
        const alreadyShown = results.some(
          (r) =>
            r.url &&
            (r.url.toLowerCase() === directUrl.toLowerCase() ||
              normalizeUrl(r.url).toLowerCase() === directNorm ||
              getCanonicalUrlKey(r.url).toLowerCase() === directCanon)
        );
        if (!alreadyShown) {
          const directItem: SuggestionItem = {
            id: 'direct-url',
            type: 'url',
            title: `Open ${trimmed}`,
            url: directUrl,
            domain: getDomainFromUrl(directUrl)
          };
          // Put explicit direct URL first if no high-confidence host match beat it
          if (rankedOmnibox.length === 0 || rankedOmnibox[0].relevanceScore < 900) {
            results.unshift(directItem);
          } else {
            results.push(directItem);
          }
        }
      }

      // 7. Web Search Fallback (uses browser's default search engine via chrome.search)
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
      results.push({
        id: 'google-search',
        type: 'search',
        title: `Search Web for "${trimmed}"`,
        defaultSearchText: trimmed,
        url: searchUrl
      });

      const hasLocalDestination = results.some(
        (r) =>
          r.type === 'tab' ||
          r.type === 'bookmark' ||
          r.type === 'history' ||
          r.type === 'url'
      );
      const isMultiWordWeakLocal =
        /\s/.test(trimmed) &&
        !rankedOmnibox.some((r) => r.relevanceScore >= 320);
      const shouldFetchGoogleSuggestions =
        !isLikelyUrl(trimmed) && (!hasLocalDestination || isMultiWordWeakLocal);

      if (!shouldFetchGoogleSuggestions) {
        lastGoogleSuggestionsRef.current = [];
      }

      if (!isCancelled) {
        setSuggestions(
          shouldFetchGoogleSuggestions && lastGoogleSuggestionsRef.current.length > 0
            ? [...results, ...lastGoogleSuggestionsRef.current]
            : [...results]
        );
        setSelectedIndex((prev) => {
          if (results.length === 0) return -1;
          if (didQueryContextChange) return 0;
          return prev >= 0 && prev < results.length ? prev : 0;
        });
      }

      // 8. Live Google Suggestions
      if (shouldFetchGoogleSuggestions) {
        const googleSuggestions = await fetchGoogleSuggestions(
          trimmed,
          abortController?.signal
        );
        if (!isCancelled) {
          const maxGoogleItems = hasLocalDestination ? 3 : 5;
          const suggestionItems: SuggestionItem[] = googleSuggestions
            .slice(0, maxGoogleItems)
            .map((suggestionText, idx) => ({
              id: `google-suggest-${idx}`,
              type: 'search',
              title: suggestionText,
              searchQuery: suggestionText,
              defaultSearchText: suggestionText,
              url: `https://www.google.com/search?q=${encodeURIComponent(suggestionText)}`
            }));
          lastGoogleSuggestionsRef.current = suggestionItems;
          setSuggestions([...results, ...suggestionItems]);
        }
      }
    };

    const abortController =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    fetchResults();

    return () => {
      isCancelled = true;
      abortController?.abort();
    };
  }, [
    activeQuery,
    activeSiteEngine,
    getActionCommands,
    loadArcticBookmarks,
    mergeRegionalSignals
  ]);

  // Navigate to destination (handling bookmark bindings and space switching)
  const openBookmarkOrUrl = useCallback(
    async (
      targetUrl: string,
      bookmarkInfo?: {
        id?: string;
        title?: string;
        spaceId?: string | null;
        spaceName?: string;
        isQuickAccess?: boolean;
        isArctic?: boolean;
      }
    ) => {
      if (!targetUrl || isNavigatingRef.current) return;

      // Provide immediate visual confirmation and prevent multiple Enter presses
      isNavigatingRef.current = true;
      setIsNavigating(true);
      inputRef.current?.blur();

      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
      navTimeoutRef.current = setTimeout(() => {
        isNavigatingRef.current = false;
        setIsNavigating(false);
      }, 12000);

      try {
        const targetNormalized = normalizeUrl(targetUrl);

        // If bookmark info wasn't explicitly passed, check if targetUrl matches any known Arctic bookmark
        if (!bookmarkInfo?.id && arcticBookmarksRef.current.length > 0) {
          const matchedBm = arcticBookmarksRef.current.find(
            (bm) => normalizeUrl(bm.url) === targetNormalized
          );
          if (matchedBm) {
            bookmarkInfo = {
              id: matchedBm.id,
              title: matchedBm.title,
              spaceId: matchedBm.spaceId,
              spaceName: matchedBm.spaceName,
              isQuickAccess: matchedBm.isQuickAccess,
              isArctic: true
            };
          }
        }

        const bookmarkId = bookmarkInfo?.id;
        const isArctic = Boolean(bookmarkInfo?.isArctic);

        // 1. Read existing tab session bindings
        let bindings: Record<string, TabBinding> = {};
        let byTab: Record<number, string> = {};
        try {
          if (chrome?.storage?.session?.get) {
            const session = await chrome.storage.session.get([
              'bindingsByBookmarkId',
              'bookmarkIdByTabId'
            ]);
            bindings =
              (session.bindingsByBookmarkId as Record<string, TabBinding>) || {};
            byTab = (session.bookmarkIdByTabId as Record<number, string>) || {};
          }
        } catch {
          // ignore
        }

        // 2. Identify the current tab running Arctic Command
        let currentTab: chrome.tabs.Tab | undefined = currentTabRef.current || undefined;
        if (!currentTab && chrome?.tabs?.getCurrent) {
          try {
            const t = await chrome.tabs.getCurrent();
            if (t) {
              currentTab = t;
              currentTabRef.current = t;
            }
          } catch {
            // ignore
          }
        }
        if (!currentTab && chrome?.tabs?.query) {
          try {
            const [activeTab] = await chrome.tabs.query({
              active: true,
              currentWindow: true
            });
            currentTab = activeTab;
            if (currentTab) {
              currentTabRef.current = currentTab;
            }
          } catch {
            // ignore
          }
        }

        // 3. Case A: Arctic Bookmark is ALREADY open in another tab
        if (isArctic && bookmarkId && bindings[bookmarkId]) {
          const boundTabId = bindings[bookmarkId].tabId;
          try {
            const boundTab = await chrome.tabs.get(boundTabId);
            if (boundTab) {
              // Switch sidebar space if bookmark belongs to a space
              if (bookmarkInfo?.spaceId) {
                await chrome?.storage?.local?.set({
                  activeSpaceId: bookmarkInfo.spaceId
                });
              }
              // Activate the existing tab
              await chrome.tabs.update(boundTabId, { active: true });
              if (boundTab.windowId) {
                try {
                  await chrome.windows.update(boundTab.windowId, { focused: true });
                } catch {}
              }
              // Notify sidebar and reveal the activated Space Tab
              try {
                chrome.runtime?.sendMessage?.({
                  type: 'REFRESH_TABS',
                  revealTabId: boundTabId,
                  revealBookmarkId: bookmarkId
                });
              } catch {}
              // Close the temporary launcher tab
              if (currentTab?.id && currentTab.id !== boundTabId) {
                try {
                  await chrome.tabs.remove(currentTab.id);
                } catch {}
              } else {
                window.close();
              }
              return;
            }
          } catch {
            // Tab was closed; prune dead binding before falling through to re-bind
            delete byTab[boundTabId];
            delete bindings[bookmarkId];
          }
        }

        // 4. Case B: An existing (or sleeping/redirected) tab already matches target URL
        if (chrome?.tabs?.query) {
          try {
            let otherMatch: chrome.tabs.Tab | undefined;

            if (isArctic && bookmarkId) {
              const [allTabs, persistedBindings] = await Promise.all([
                chrome.tabs.query({}),
                getPersistedBindings()
              ]);
              const prefWinId = currentTab?.windowId;
              const orderedTabs =
                typeof prefWinId === 'number'
                  ? [
                      ...allTabs.filter((t) => t.windowId === prefWinId),
                      ...allTabs.filter((t) => t.windowId !== prefWinId)
                    ]
                  : allTabs;

              otherMatch = findMatchingUnboundTabForBookmark({
                bookmark: { id: bookmarkId, url: targetUrl },
                tabs: orderedTabs,
                boundTabIds: byTab,
                persistedBindings,
                excludeTabId: currentTab?.id
              });
            } else {
              const currentTabs = await chrome.tabs.query({ currentWindow: true });
              otherMatch = currentTabs.find((t) => {
                if (typeof t.id !== 'number' || t.id === currentTab?.id) return false;
                const effUrl = getEffectiveTabUrl(t);
                if (!effUrl) return false;
                return (
                  normalizeUrl(effUrl) === targetNormalized ||
                  doesTabUrlMatchBookmark(effUrl, targetUrl)
                );
              });
            }

            if (otherMatch && typeof otherMatch.id === 'number') {
              const matchedTabId = otherMatch.id;
              if (isArctic && bookmarkId && chrome?.storage?.session?.set) {
                const matchUrl = getEffectiveTabUrl(otherMatch) || targetUrl;
                const newBinding: TabBinding = {
                  bookmarkId,
                  tabId: matchedTabId,
                  windowId: otherMatch.windowId,
                  originalUrl: targetUrl,
                  currentUrl: matchUrl,
                  currentTitle: otherMatch.title || bookmarkInfo?.title || '',
                  isNavigatedAway: isUrlNavigatedAway(matchUrl, targetUrl)
                };
                const nextBindings = { ...bindings, [bookmarkId]: newBinding };
                const nextByTab = { ...byTab, [matchedTabId]: bookmarkId };
                await chrome.storage.session.set({
                  bindingsByBookmarkId: nextBindings,
                  bookmarkIdByTabId: nextByTab
                });
                await upsertPersistedBindings({ [bookmarkId]: newBinding });
                if (bookmarkInfo?.spaceId) {
                  await chrome?.storage?.local?.set({
                    activeSpaceId: bookmarkInfo.spaceId
                  });
                }
              }
              await chrome.tabs.update(matchedTabId, { active: true });
              if (otherMatch.windowId) {
                try {
                  await chrome.windows.update(otherMatch.windowId, { focused: true });
                } catch {}
              }
              try {
                chrome.runtime?.sendMessage?.({
                  type: 'REFRESH_TABS',
                  revealTabId: matchedTabId,
                  ...(isArctic && bookmarkId ? { revealBookmarkId: bookmarkId } : {})
                });
              } catch {}
              if (currentTab?.id && currentTab.id !== matchedTabId) {
                try {
                  await chrome.tabs.remove(currentTab.id);
                } catch {}
              }
              return;
            }
          } catch {
            // ignore
          }
        }

        // 5. Case C: Open in currentTab (or fallback to window.location.href)
        if (isArctic && bookmarkId && currentTab?.id && chrome?.storage?.session?.set) {
          const newBinding: TabBinding = {
            bookmarkId,
            tabId: currentTab.id,
            windowId: currentTab.windowId,
            originalUrl: targetUrl,
            currentUrl: targetUrl,
            currentTitle: bookmarkInfo?.title || targetUrl,
            isNavigatedAway: false
          };
          const nextBindings = { ...bindings, [bookmarkId]: newBinding };
          const nextByTab = { ...byTab, [currentTab.id]: bookmarkId };
          await chrome.storage.session.set({
            bindingsByBookmarkId: nextBindings,
            bookmarkIdByTabId: nextByTab
          });
          await upsertPersistedBindings({ [bookmarkId]: newBinding });
          if (bookmarkInfo?.spaceId) {
            await chrome?.storage?.local?.set({
              activeSpaceId: bookmarkInfo.spaceId
            });
          }
        }

        if (currentTab?.id && chrome?.tabs?.update) {
          try {
            await chrome.tabs.update(currentTab.id, {
              url: targetUrl,
              active: true
            });
          } catch {
            window.location.href = targetUrl;
          }
        } else {
          window.location.href = targetUrl;
        }

        try {
          chrome.runtime?.sendMessage?.({
            type: 'REFRESH_TABS',
            ...(typeof currentTab?.id === 'number' ? { revealTabId: currentTab.id } : {}),
            ...(isArctic && bookmarkId ? { revealBookmarkId: bookmarkId } : {})
          });
        } catch {}
      } catch (err) {
        console.warn('[Arctic] Navigation error:', err);
        if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
        isNavigatingRef.current = false;
        setIsNavigating(false);
        inputRef.current?.focus();
        showToast('Could not open page');
      }
    },
    [showToast]
  );

  // Execute a web search using the user's default browser search engine (with Google fallback)
  const performWebSearch = useCallback(
    async (rawSearchQuery: string) => {
      const trimmed = rawSearchQuery.trim();
      if (!trimmed || isNavigatingRef.current) return;

      isNavigatingRef.current = true;
      setIsNavigating(true);
      inputRef.current?.blur();

      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
      navTimeoutRef.current = setTimeout(() => {
        isNavigatingRef.current = false;
        setIsNavigating(false);
      }, 12000);

      const fallbackUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;

      try {
        if (typeof chrome !== 'undefined' && typeof chrome.search?.query === 'function') {
          await chrome.search.query({
            text: trimmed,
            disposition: 'CURRENT_TAB'
          });
        } else {
          let currentTab: chrome.tabs.Tab | undefined = currentTabRef.current || undefined;
          if (!currentTab && chrome?.tabs?.getCurrent) {
            try {
              const t = await chrome.tabs.getCurrent();
              if (t) {
                currentTab = t;
                currentTabRef.current = t;
              }
            } catch {}
          }
          if (!currentTab && chrome?.tabs?.query) {
            try {
              const [activeTab] = await chrome.tabs.query({
                active: true,
                currentWindow: true
              });
              currentTab = activeTab;
              if (currentTab) {
                currentTabRef.current = currentTab;
              }
            } catch {}
          }
          if (currentTab?.id && chrome?.tabs?.update) {
            await chrome.tabs.update(currentTab.id, {
              url: fallbackUrl,
              active: true
            });
          } else {
            window.location.href = fallbackUrl;
          }
        }

        try {
          chrome.runtime?.sendMessage?.({
            type: 'REFRESH_TABS',
            ...(typeof currentTabRef.current?.id === 'number'
              ? { revealTabId: currentTabRef.current.id }
              : {})
          });
        } catch {}
      } catch (err) {
        try {
          window.location.href = fallbackUrl;
        } catch {
          console.warn('[Arctic] Search navigation error:', err);
          if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
          isNavigatingRef.current = false;
          setIsNavigating(false);
          inputRef.current?.focus();
          showToast('Could not perform search');
        }
      }
    },
    [showToast]
  );

  // Activate an already-open unbound Today's Tab directly and close the Command Bar launcher
  const focusOpenTab = useCallback(
    async (item: SuggestionItem) => {
      if (typeof item.tabId !== 'number' || isNavigatingRef.current) return;

      isNavigatingRef.current = true;
      setIsNavigating(true);
      inputRef.current?.blur();

      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
      navTimeoutRef.current = setTimeout(() => {
        isNavigatingRef.current = false;
        setIsNavigating(false);
      }, 12000);

      try {
        let currentTab: chrome.tabs.Tab | undefined = currentTabRef.current || undefined;
        if (!currentTab && chrome?.tabs?.getCurrent) {
          try {
            const t = await chrome.tabs.getCurrent();
            if (t) {
              currentTab = t;
              currentTabRef.current = t;
            }
          } catch {
            // ignore
          }
        }
        if (!currentTab && chrome?.tabs?.query) {
          try {
            const [activeTab] = await chrome.tabs.query({
              active: true,
              currentWindow: true
            });
            currentTab = activeTab;
            if (currentTab) {
              currentTabRef.current = currentTab;
            }
          } catch {
            // ignore
          }
        }

        if (item.spaceId) {
          try {
            await chrome?.storage?.local?.set({ activeSpaceId: item.spaceId });
          } catch {
            // ignore
          }
        }

        await chrome.tabs.update(item.tabId, { active: true });
        if (item.windowId) {
          try {
            await chrome.windows.update(item.windowId, { focused: true });
          } catch {
            // ignore
          }
        }

        try {
          chrome.runtime?.sendMessage?.({
            type: 'REFRESH_TABS',
            revealTabId: item.tabId
          });
        } catch {
          // ignore
        }

        if (currentTab?.id && currentTab.id !== item.tabId) {
          try {
            await chrome.tabs.remove(currentTab.id);
          } catch {
            // ignore
          }
        } else {
          window.close();
        }
      } catch {
        // Tab was closed right before selection; fall back to opening URL
        if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
        isNavigatingRef.current = false;
        setIsNavigating(false);
        if (item.url) {
          await openBookmarkOrUrl(item.url);
        }
      }
    },
    [openBookmarkOrUrl]
  );

  // Handle selection (URL navigation, Tab switching, Bookmark activation, Web search, or Command action)
  const handleSelect = useCallback(
    async (item: SuggestionItem) => {
      if (isNavigatingRef.current) return;

      if (item.type === 'command') {
        if (item.action) {
          await item.action();
        } else if (item.url) {
          openBookmarkOrUrl(item.url);
        }
        return;
      }
      if (item.type === 'tab' && typeof item.tabId === 'number') {
        await focusOpenTab(item);
        return;
      }
      if (item.defaultSearchText) {
        await performWebSearch(item.defaultSearchText);
        return;
      }
      if (item.url) {
        openBookmarkOrUrl(item.url, {
          id: item.bookmarkId,
          title: item.title,
          spaceId: item.spaceId,
          spaceName: item.spaceName,
          isQuickAccess: item.isQuickAccess,
          isArctic: item.isArctic
        });
      } else {
        await performWebSearch(item.title);
      }
    },
    [focusOpenTab, openBookmarkOrUrl, performWebSearch]
  );

  // Load a suggestion's URL into the input box and place cursor at the end for editing
  const autocompleteUrlIntoInput = useCallback((fullUrl: string) => {
    setActiveSiteEngine(null);
    setSiteTriggerQuery('');
    setDismissedEngineId(null);
    setHasArrowNavigated(false);
    setQuery(fullUrl);
    setDebouncedQuery(fullUrl);
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.value = fullUrl;
      inputRef.current.setSelectionRange(fullUrl.length, fullUrl.length);
    }
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(fullUrl.length, fullUrl.length);
      }
    });
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isNavigatingRef.current) {
      e.preventDefault();
      return;
    }

    if (
      e.key === 'ArrowRight' &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      ghostSuffix
    ) {
      const inputEl = e.currentTarget;
      const selStart = inputEl.selectionStart ?? query.length;
      const selEnd = inputEl.selectionEnd ?? query.length;
      if (selStart === query.length && selEnd === query.length) {
        e.preventDefault();
        const completed = `${query}${ghostSuffix}`;
        setHasArrowNavigated(false);
        setQuery(completed);
        setDebouncedQuery(completed);
        if (inputRef.current) {
          inputRef.current.value = completed;
          inputRef.current.setSelectionRange(completed.length, completed.length);
        }
        requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.setSelectionRange(completed.length, completed.length);
          }
        });
        return;
      }
    }

    const selectedItem =
      selectedIndex >= 0 && selectedIndex < suggestions.length
        ? suggestions[selectedIndex]
        : null;
    const autocompleteTarget =
      selectedItem?.type === 'search'
        ? selectedItem.searchQuery
        : selectedItem?.type !== 'command'
          ? selectedItem?.url
          : undefined;
    const canAutocompleteSelectedItem =
      Boolean(autocompleteTarget) &&
      (hasArrowNavigated || !matchedSiteEngine || Boolean(activeSiteEngine));

    if (e.key === 'Tab' && !e.shiftKey) {
      if (canAutocompleteSelectedItem && autocompleteTarget) {
        e.preventDefault();
        autocompleteUrlIntoInput(autocompleteTarget);
        return;
      }

      if (!activeSiteEngine && matchedSiteEngine) {
        e.preventDefault();
        setActiveSiteEngine(matchedSiteEngine);
        setSiteTriggerQuery(query);
        setDismissedEngineId(null);
        setHasArrowNavigated(false);
        setQuery('');
        setDebouncedQuery('');
        setSelectedIndex(0);
        return;
      }
    }

    if (e.key === 'Backspace' && activeSiteEngine && query === '') {
      e.preventDefault();
      setActiveSiteEngine(null);
      setSiteTriggerQuery('');
      setHasArrowNavigated(false);
      setSelectedIndex(-1);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setHasArrowNavigated(true);
      setSelectedIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setHasArrowNavigated(true);
      setSelectedIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        const rawSearch = query.trim() || siteTriggerQuery.trim();
        if (rawSearch) {
          performWebSearch(rawSearch);
        }
        return;
      }
      const isDebouncePending = activeQuery.trim() !== query.trim();
      if (!isDebouncePending && selectedIndex >= 0 && selectedIndex < suggestions.length) {
        handleSelect(suggestions[selectedIndex]);
      } else if (activeSiteEngine) {
        openBookmarkOrUrl(buildSiteSearchUrl(activeSiteEngine, query));
      } else if (
        query.trim() &&
        !query.trim().startsWith('>') &&
        !/^(theme|palette):/i.test(query.trim())
      ) {
        if (isLikelyUrl(query.trim())) {
          openBookmarkOrUrl(formatNavigationUrl(query));
        } else {
          performWebSearch(query.trim());
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setHasArrowNavigated(false);
      if (activeSiteEngine) {
        const restoredQuery = query || siteTriggerQuery;
        setDismissedEngineId(activeSiteEngine.id);
        setActiveSiteEngine(null);
        setSiteTriggerQuery('');
        setQuery(restoredQuery);
        setDebouncedQuery(restoredQuery);
      } else if (matchedSiteEngine) {
        setDismissedEngineId(matchedSiteEngine.id);
      } else {
        setQuery('');
        setDebouncedQuery('');
        setDismissedEngineId(null);
        setSelectedIndex(-1);
      }
    }
  };

  const activeSiteFavicon = activeSiteEngine
    ? getFaviconUrl(`https://${activeSiteEngine.domain}`, 32)
    : '';

  return (
    <div
      style={{
        background: 'var(--theme-bg-gradient)'
      }}
      onClick={() => {
        if (!isNavigatingRef.current) {
          inputRef.current?.focus();
        }
      }}
      className="min-h-screen w-full flex flex-col items-center justify-start pt-[18vh] sm:pt-[20vh] px-6 pb-6 text-zinc-900 dark:text-zinc-100 select-none transition-colors duration-300 relative overflow-hidden"
    >
      {/* Top Navigation Progress Bar */}
      {isNavigating && (
        <div
          role="progressbar"
          aria-label="Loading page"
          className="fixed top-0 left-0 right-0 h-[3px] z-50 overflow-hidden bg-black/5 dark:bg-white/5"
        >
          <div
            style={{ backgroundColor: 'var(--theme-accent)' }}
            className="h-full w-full arctic-nav-progress"
          />
        </div>
      )}

      {/* Center Command Palette Container */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-[620px] flex flex-col space-y-4 transition-[opacity,transform] duration-150 ease-out ${
          isNavigating
            ? 'opacity-0 scale-95 -translate-y-2 pointer-events-none'
            : ''
        }`}
      >
        {/* Command Card */}
        <div
          style={{
            borderColor: 'var(--theme-accent-border)',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.25)'
          }}
          className="w-full rounded-2xl bg-white/90 dark:bg-[#18181c]/90 backdrop-blur-2xl border transition-colors duration-200 overflow-hidden"
        >
          {/* Top Search Input Box */}
          <div className="flex items-center px-4 py-3.5 space-x-3 border-b border-zinc-200/80 dark:border-white/10">
            {activeSiteEngine ? (
              <div
                data-testid="active-site-pill"
                className="flex items-center space-x-1.5 pl-2.5 pr-1.5 py-1 rounded-lg theme-active-card border text-xs font-semibold text-zinc-900 dark:text-white flex-shrink-0"
              >
                {activeSiteFavicon ? (
                  <img
                    src={activeSiteFavicon}
                    alt=""
                    className="w-3.5 h-3.5 object-contain rounded-xs"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Search className="w-3.5 h-3.5 theme-accent-text" />
                )}
                <span>Search {activeSiteEngine.name}</span>
                <button
                  type="button"
                  aria-label={`Exit ${activeSiteEngine.name} search`}
                  onClick={() => {
                    const restoredQuery = query || siteTriggerQuery;
                    setDismissedEngineId(activeSiteEngine.id);
                    setActiveSiteEngine(null);
                    setSiteTriggerQuery('');
                    setHasArrowNavigated(false);
                    setQuery(restoredQuery);
                    setDebouncedQuery(restoredQuery);
                    inputRef.current?.focus();
                  }}
                  className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : query.trim().startsWith('>') ? (
              <Command className="w-5 h-5 theme-accent-text flex-shrink-0" />
            ) : (
              <Search className="w-5 h-5 text-zinc-400 flex-shrink-0" />
            )}

            <div className="relative flex-1 flex items-center min-w-0">
              {ghostSuffix && (
                <div
                  aria-hidden="true"
                  data-testid="ghost-autocomplete"
                  className="pointer-events-none absolute inset-0 flex items-center text-[16px] leading-normal font-normal overflow-hidden whitespace-pre"
                >
                  <span className="invisible">{query}</span>
                  <span className="text-zinc-400/70 dark:text-zinc-500/80">
                    {ghostSuffix}
                  </span>
                </div>
              )}
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  const val = e.target.value;
                  setQuery(val);
                  setHasArrowNavigated(false);
                  if (!val.trim()) {
                    setDismissedEngineId(null);
                  }
                }}
                onKeyDown={handleKeyDown}
                placeholder={
                  activeSiteEngine
                    ? `Search ${activeSiteEngine.name}...`
                    : 'Search web, enter URL, or type > for commands...'
                }
                autoFocus
                disabled={isNavigating}
                className="relative z-10 w-full bg-transparent text-[16px] leading-normal text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 outline-none font-normal disabled:opacity-40"
              />
            </div>

            {visualMatchedSiteEngine && !activeSiteEngine && (
              <button
                type="button"
                data-testid="tab-to-search-hint"
                onClick={() => {
                  setActiveSiteEngine(visualMatchedSiteEngine);
                  setSiteTriggerQuery(query);
                  setDismissedEngineId(null);
                  setHasArrowNavigated(false);
                  setQuery('');
                  setDebouncedQuery('');
                  setSelectedIndex(0);
                  inputRef.current?.focus();
                }}
                className="flex items-center space-x-1.5 px-2 py-1 rounded-lg bg-zinc-200/70 dark:bg-white/10 hover:bg-zinc-300/70 dark:hover:bg-white/15 border border-black/10 dark:border-white/10 text-zinc-700 dark:text-zinc-200 text-[11px] font-medium transition-colors flex-shrink-0"
              >
                <span className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/15 text-[10px] font-mono leading-none">
                  Tab ⇥
                </span>
                <span>Search {visualMatchedSiteEngine.name}</span>
              </button>
            )}

            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setDebouncedQuery('');
                  setHasArrowNavigated(false);
                  setDismissedEngineId(null);
                  inputRef.current?.focus();
                }}
                className="p-1 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            ) : !activeSiteEngine ? (
              <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-zinc-200/60 dark:bg-white/10 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 flex-shrink-0">
                <CornerDownLeft className="w-3 h-3 mr-0.5" />
                <span>Jump</span>
              </div>
            ) : null}
          </div>

          {/* Suggestions Dropdown */}
          {suggestions.length > 0 && (
            <div
              ref={listRef}
              className="max-h-[360px] overflow-y-auto p-1.5 space-y-0.5"
            >
              {!activeQuery.trim() && (
                <div className="px-3 py-1.5 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                  {activeSiteEngine
                    ? `${activeSiteEngine.name} Search & Recent`
                    : 'Frequently Visited'}
                </div>
              )}

              {(activeQuery.trim().startsWith('>') ||
                /^(theme|palette):/i.test(activeQuery.trim())) && (
                <div className="px-3 py-1.5 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center justify-between">
                  <span>
                    {/^(theme|palette):/i.test(activeQuery.trim().replace(/^>\s*/, ''))
                      ? 'Themes & Appearance'
                      : 'Action Commands'}
                  </span>
                  <span className="text-[10px] text-zinc-400 font-normal">
                    {suggestions.length} available
                  </span>
                </div>
              )}

              {suggestions.map((item, index) => {
                const isSelected = index === selectedIndex;
                const faviconSrc =
                  item.type !== 'command' && item.url ? getFaviconUrl(item.url, 32) : '';

                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-colors duration-75 outline-none ${
                      isSelected
                        ? 'theme-active-card text-zinc-950 dark:text-white'
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    {/* Left: Icon & Title/Description */}
                    <div className="flex items-center space-x-3 min-w-0 flex-1 mr-3">
                      <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded">
                        {item.type === 'command' ? (
                          item.icon || <Command className="w-4 h-4 text-purple-400" />
                        ) : item.type === 'search' ? (
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
                        ) : item.type === 'tab' ? (
                          <Globe className="w-4 h-4 text-emerald-500" />
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
                        {item.description ? (
                          <span className="truncate text-[11.5px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                            {item.description}
                          </span>
                        ) : item.url && item.type !== 'search' ? (
                          <span className="truncate text-[11.5px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                            {item.url}
                          </span>
                        ) : item.domain ? (
                          <span className="truncate text-[11.5px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                            {item.domain}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* Right: Badge & Enter prompt */}
                    <div className="flex items-center space-x-2 flex-shrink-0">
                      {item.type === 'command' && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-purple-500/10 text-purple-600 dark:text-purple-300 border border-purple-500/20">
                          {item.commandCategory || 'Command'}
                        </span>
                      )}
                      {(item.type === 'tab' || item.isOpenTab) && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/20">
                          Switch to Tab
                        </span>
                      )}
                      {item.type === 'bookmark' && !item.isOpenTab && item.isArctic && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-300 border border-amber-500/20">
                          {item.isQuickAccess ? 'Pinned' : 'Space Tab'}
                        </span>
                      )}
                      {item.type === 'bookmark' && !item.isOpenTab && !item.isArctic && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-zinc-200/70 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 border border-black/5 dark:border-white/10">
                          Bookmark
                        </span>
                      )}
                      {item.type === 'url' && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20">
                          Website
                        </span>
                      )}
                      {item.type === 'history' && !item.isOpenTab && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-zinc-200/50 dark:bg-white/10 text-zinc-500 dark:text-zinc-400">
                          History
                        </span>
                      )}
                      {item.type === 'search' && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 border border-cyan-500/20">
                          {item.searchQuery ? 'Google Suggestion' : 'Search'}
                        </span>
                      )}
                      {item.id === 'google-search' && (
                        <span
                          data-testid="shift-enter-search-hint"
                          title="Press Shift+Enter anywhere to search the web directly"
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-black/5 dark:bg-white/10 text-zinc-500 dark:text-zinc-400 border border-black/10 dark:border-white/10"
                        >
                          ⇧ ↵
                        </span>
                      )}
                      {isSelected &&
                        item.type !== 'command' &&
                        (hasArrowNavigated ||
                          !visualMatchedSiteEngine ||
                          Boolean(activeSiteEngine)) &&
                        (item.type === 'search'
                          ? Boolean(item.searchQuery)
                          : Boolean(item.url)) && (
                          <button
                            type="button"
                            data-testid="row-tab-to-edit-hint"
                            title={
                              item.type === 'search'
                                ? 'Press Tab or click to fill suggestion in search bar'
                                : 'Press Tab or click to edit URL in search bar'
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              autocompleteUrlIntoInput(
                                item.type === 'search'
                                  ? item.searchQuery!
                                  : item.url!
                              );
                            }}
                            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-zinc-500 dark:text-zinc-400 border border-black/10 dark:border-white/10 transition-colors"
                          >
                            <span>Tab ⇥</span>
                          </button>
                        )}
                      {isSelected && (
                        <CornerDownLeft className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Action Toast Feedback */}
        {toastMessage && (
          <div className="flex items-center justify-center animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-zinc-900/90 dark:bg-white/95 text-white dark:text-zinc-950 text-xs font-medium shadow-xl backdrop-blur-md">
              <Check className="w-3.5 h-3.5 text-emerald-400 dark:text-emerald-600 flex-shrink-0" />
              <span>{toastMessage}</span>
            </div>
          </div>
        )}
      </div>

      {/* Edge Trigger Pill when Sidebar is Hidden */}
      <NewTabEdgeTrigger
        theme={theme}
        colorTheme={colorTheme}
        windowIdRef={currentWindowIdRef}
      />
    </div>
  );
};
