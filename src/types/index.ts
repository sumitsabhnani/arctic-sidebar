export interface TabBinding {
  bookmarkId: string;
  tabId: number;
  windowId: number;
  originalUrl: string;
  currentUrl: string;
  currentTitle: string;
  isNavigatedAway: boolean; // true when normalizeUrl(currentUrl) !== normalizeUrl(originalUrl)
}

export interface PersistedTabBinding {
  bookmarkId: string;
  originalUrl: string;
  currentUrl: string;
  currentTitle: string;
  isNavigatedAway: boolean;
  updatedAt: number;
}

export interface SessionState {
  bindingsByBookmarkId: Record<string, TabBinding>;
  bookmarkIdByTabId: Record<number, string>;
}

export type ColorThemeId =
  | 'crystal-aqua'
  | 'aqua-lagoon'
  | 'arctic-aurora'
  | 'coral-breeze'
  | 'glacier-blue'
  | 'midnight-amethyst'
  | 'forest-sage'
  | 'warm-terracotta'
  | 'pure-monochrome'
  | 'slate-grey';
export type ThemeMode = 'dark' | 'light' | 'system';

export const QUICK_ACCESS_FOLDER_NAME = 'Quick Access';

export interface SpaceItem {
  id: string;
  name: string;
  folderId: string;
  icon?: string;
  quickAccessFolderId?: string;
}

export interface SiteSearchEngine {
  id: string;
  name: string;
  domain: string;
  shortcut: string;
  aliases?: string[];
  searchUrlTemplate: string;
}

export type EdgeTriggerMode = 'push' | 'hover';

export interface LocalSettings {
  quickAccessFolderId?: string;
  workspaceFolderId?: string;
  spaces?: SpaceItem[];
  activeSpaceId?: string;
  collapsedFolderIds?: Record<string, boolean>; // Stored in chrome.storage.local for permanence
  autoArchiveInterval?: 'never' | '12h' | '24h' | '7d';
  tabOpenedAt?: Record<number, number>;
  persistedBindingsByBookmarkId?: Record<string, PersistedTabBinding>;
  theme?: ThemeMode;
  colorTheme?: ColorThemeId;
  quickAccessDensity?: 'relaxed' | 'compact';
  tabsDensity?: 'relaxed' | 'compact';
  densityMode?: 'relaxed' | 'compact';
  showMemorySaverBar?: boolean;
  hasDismissedLeftSideTip?: boolean;
  isSidebarCollapsed?: boolean;
  edgeTriggerEnabled?: boolean;
  edgeTriggerMode?: EdgeTriggerMode;
  sidebarDockSide?: 'left' | 'right';
  collapsedSections?: {
    quickAccess?: boolean;
    workspace?: boolean;
    todayTabs?: boolean;
  };
  customSearchEngines?: SiteSearchEngine[];
  openArcticSettings?: number | boolean;
}

export interface BookmarkFolderOption {
  id: string;
  title: string;
  path: string;
}

export interface EdgeQuickAccessItem {
  id: string;
  title: string;
  url: string;
  faviconDataUrl: string;
  isActive: boolean;
  isOpen: boolean;
  isNavigatedAway: boolean;
  currentTitle?: string;
}

export interface EdgeBookmarkNode extends EdgeQuickAccessItem {
  type: 'bookmark';
}

export interface EdgeFolderNode {
  type: 'folder';
  id: string;
  title: string;
  children: EdgeSpaceNode[];
  hasActiveChild: boolean;
  hasOpenChild: boolean;
  hasNavigatedAwayChild: boolean;
  itemCount: number;
}

export type EdgeSpaceNode = EdgeBookmarkNode | EdgeFolderNode;

export interface EdgeRailData {
  quickAccessItems: EdgeQuickAccessItem[];
  spaceItems: EdgeSpaceNode[];
  spaceName: string;
}

export * from './reminder';
