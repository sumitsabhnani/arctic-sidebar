export interface TabBinding {
  bookmarkId: string;
  tabId: number;
  windowId: number;
  originalUrl: string;
  currentUrl: string;
  currentTitle: string;
  isNavigatedAway: boolean; // true when normalizeUrl(currentUrl) !== normalizeUrl(originalUrl)
}

export interface SessionState {
  bindingsByBookmarkId: Record<string, TabBinding>;
  bookmarkIdByTabId: Record<number, string>;
}

export type ColorThemeId =
  | 'glacier-blue'
  | 'midnight-amethyst'
  | 'forest-sage'
  | 'warm-terracotta'
  | 'pure-monochrome'
  | 'slate-grey';
export type ThemeMode = 'dark' | 'light';

export interface LocalSettings {
  quickAccessFolderId?: string;
  workspaceFolderId?: string;
  collapsedFolderIds?: Record<string, boolean>; // Stored in chrome.storage.local for permanence
  autoArchiveInterval?: 'never' | '12h' | '24h' | '7d';
  tabOpenedAt?: Record<number, number>;
  theme?: ThemeMode;
  colorTheme?: ColorThemeId;
  isSidebarCollapsed?: boolean;
  collapsedSections?: {
    quickAccess?: boolean;
    workspace?: boolean;
    todayTabs?: boolean;
  };
}

export interface BookmarkFolderOption {
  id: string;
  title: string;
  path: string;
}
