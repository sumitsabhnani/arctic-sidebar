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

export interface LocalSettings {
  quickAccessFolderId?: string;
  workspaceFolderId?: string;
  collapsedFolderIds?: Record<string, boolean>; // Stored in chrome.storage.local for permanence
  autoArchiveInterval?: 'never' | '12h' | '24h' | '7d';
  tabOpenedAt?: Record<number, number>;
  theme?: 'dark' | 'light';
}

export interface BookmarkFolderOption {
  id: string;
  title: string;
  path: string;
}
