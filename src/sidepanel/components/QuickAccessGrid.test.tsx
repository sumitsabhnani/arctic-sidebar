import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QuickAccessGrid } from './QuickAccessGrid';
import type { TabBinding, TabWithFaviconMeta } from '../../types';
import { getFaviconCacheKey, upsertCachedFaviconEntries } from '../utils/faviconCache';
import { endDragSession, startDragSession } from '../utils/dnd';

describe('QuickAccessGrid component', () => {
  const mockBookmarks: chrome.bookmarks.BookmarkTreeNode[] = [
    { id: 'qa-1', title: 'GitHub', url: 'https://github.com', index: 0 },
    { id: 'qa-2', title: 'YouTube', url: 'https://youtube.com', index: 1 }
  ];

  const mockBindings: Record<string, TabBinding> = {
    'qa-1': {
      bookmarkId: 'qa-1',
      tabId: 101,
      windowId: 1,
      originalUrl: 'https://github.com',
      currentUrl: 'https://github.com',
      currentTitle: 'GitHub',
      isNavigatedAway: false
    },
    'qa-2': {
      bookmarkId: 'qa-2',
      tabId: 102,
      windowId: 1,
      originalUrl: 'https://youtube.com',
      currentUrl: 'https://youtube.com',
      currentTitle: 'YouTube',
      isNavigatedAway: false
    }
  };

  const mockTabs: Record<number, chrome.tabs.Tab> = {
    101: {
      id: 101,
      url: 'https://github.com',
      title: 'GitHub',
      audible: false,
      mutedInfo: { muted: false }
    } as chrome.tabs.Tab,
    102: {
      id: 102,
      url: 'https://youtube.com',
      title: 'YouTube',
      audible: true, // Playing audio
      mutedInfo: { muted: false }
    } as chrome.tabs.Tab
  };

  const defaultProps = {
    bookmarks: mockBookmarks,
    bindingsByBookmarkId: mockBindings,
    tabsByTabId: mockTabs,
    activeTabId: 101,
    onTileClick: vi.fn(),
    onTileDoubleClick: vi.fn(),
    onOpenContextMenu: vi.fn(),
    onCloseTab: vi.fn(),
    onToggleMuteTab: vi.fn(),
    onMoveToWorkspace: vi.fn(),
    onReplaceUrl: vi.fn(),
    onRenameBookmark: vi.fn(),
    onRemoveBookmark: vi.fn(),
    onReorderQuickAccess: vi.fn(),
    onReloadTab: vi.fn(),
    onDuplicateTab: vi.fn()
  };

  it('renders quick access tiles with active tab indicator', () => {
    render(<QuickAccessGrid {...defaultProps} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('displays quick tab audio mute indicator on pinned tile when tab is playing audio and toggles mute on click', () => {
    render(<QuickAccessGrid {...defaultProps} />);

    // YouTube tile is playing audio -> quick mute badge is rendered
    const muteBadge = screen.getByTitle('Mute tab');
    expect(muteBadge).toBeInTheDocument();

    fireEvent.click(muteBadge);
    expect(defaultProps.onToggleMuteTab).toHaveBeenCalledWith(102);
  });

  it('calls onTileClick when tile is clicked', () => {
    render(<QuickAccessGrid {...defaultProps} />);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);

    expect(defaultProps.onTileClick).toHaveBeenCalledWith(mockBookmarks[0]);
  });

  it('does NOT render hover reload icon on quick access tiles, and reloads via double-click or context menu', () => {
    render(<QuickAccessGrid {...defaultProps} />);

    // Hover reload icon badge is removed from quick access tiles
    const reloadButtons = screen.queryAllByTitle('Reload tab');
    expect(reloadButtons.length).toBe(0);

    // Double-clicking tile calls onTileDoubleClick
    const tiles = screen.getAllByRole('button');
    fireEvent.doubleClick(tiles[0]);
    expect(defaultProps.onTileDoubleClick).toHaveBeenCalledWith(
      mockBookmarks[0],
      expect.any(Object)
    );

    // Context menu still includes Reload Tab
    fireEvent.contextMenu(tiles[0]);
    const menuItems = defaultProps.onOpenContextMenu.mock.calls[0][1];
    const reloadItem = menuItems.find((item: { label: string }) => item.label === 'Reload Tab');
    expect(reloadItem).toBeDefined();
    reloadItem.action();
    expect(defaultProps.onReloadTab).toHaveBeenCalledWith(101);
  });

  it('includes Duplicate Tab option in context menu on right click', () => {
    render(<QuickAccessGrid {...defaultProps} />);
    const tiles = screen.getAllByRole('button');
    fireEvent.contextMenu(tiles[0]);

    expect(defaultProps.onOpenContextMenu).toHaveBeenCalled();
    const menuItems = defaultProps.onOpenContextMenu.mock.calls[0][1];
    const duplicateItem = menuItems.find((item: { label: string }) => item.label === 'Duplicate Tab');
    expect(duplicateItem).toBeDefined();

    // Call duplicate action
    duplicateItem.action();
    expect(defaultProps.onDuplicateTab).toHaveBeenCalledWith(101);
  });

  it('renders Google Doc tiles with proper website favicon img instead of monochrome icon', () => {
    const specialBookmarks: chrome.bookmarks.BookmarkTreeNode[] = [
      { id: 'qa-doc', title: 'Roadmap Doc', url: 'https://docs.new', index: 0 }
    ];

    const { container } = render(
      <QuickAccessGrid
        {...defaultProps}
        bookmarks={specialBookmarks}
        bindingsByBookmarkId={{}}
        tabsByTabId={{}}
      />
    );

    const docIcon = container.querySelector('svg.lucide-file-text');
    expect(docIcon).not.toBeInTheDocument();

    const faviconImg = container.querySelector('img');
    expect(faviconImg).toBeInTheDocument();
    expect(faviconImg?.getAttribute('src')).toContain(
      encodeURIComponent('https://docs.google.com/document/')
    );
  });

  it('falls back to persisted cached favicon on slow/failed boundTab.favIconUrl instead of showing Globe, and skips blocked chrome:// icon URLs', async () => {
    const bmUrl = 'https://dashboard.acme.com';
    const cachedDataUrl = 'data:image/png;base64,PERSISTED_ACME_ICON';
    await act(async () => {
      await upsertCachedFaviconEntries({
        [getFaviconCacheKey(bmUrl)]: {
          dataUrl: cachedDataUrl,
          pageUrl: bmUrl,
          updatedAt: Date.now()
        }
      });
    });

    const bookmarks: chrome.bookmarks.BookmarkTreeNode[] = [
      { id: 'qa-acme', title: 'Acme', url: bmUrl, index: 0 }
    ];
    const bindings: Record<string, TabBinding> = {
      'qa-acme': {
        bookmarkId: 'qa-acme',
        tabId: 301,
        windowId: 1,
        originalUrl: bmUrl,
        currentUrl: bmUrl,
        currentTitle: 'Acme',
        isNavigatedAway: false
      }
    };

    // 1. Blocked chrome:// error icon scheme is skipped immediately in favor of persisted dataUrl
    const { container, rerender } = render(
      <QuickAccessGrid
        {...defaultProps}
        bookmarks={bookmarks}
        bindingsByBookmarkId={bindings}
        tabsByTabId={{
          301: {
            id: 301,
            url: bmUrl,
            title: 'Acme',
            status: 'complete',
            favIconUrl: 'chrome://theme/IDR_ERROR_NETWORK_GENERIC'
          } as chrome.tabs.Tab
        }}
      />
    );

    let img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute('src')).toBe(cachedDataUrl);
    expect(container.querySelector('svg.lucide-globe')).not.toBeInTheDocument();

    // 2. Live https favIconUrl times out / fails onError -> steps to persisted cachedDataUrl instead of Globe
    rerender(
      <QuickAccessGrid
        {...defaultProps}
        bookmarks={bookmarks}
        bindingsByBookmarkId={bindings}
        tabsByTabId={{
          301: {
            id: 301,
            url: bmUrl,
            title: 'Acme',
            status: 'complete',
            favIconUrl: 'https://dashboard.acme.com/favicon.ico'
          } as chrome.tabs.Tab
        }}
      />
    );

    img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://dashboard.acme.com/favicon.ico');

    fireEvent.error(img!);

    img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute('src')).toBe(cachedDataUrl);
    expect(container.querySelector('svg.lucide-globe')).not.toBeInTheDocument();
  });

  it('recovers Quick Access favicon on reload even when favIconUrl has the exact same URL string that failed earlier', () => {
    const bmUrl = 'https://slow-app.example.com';
    const liveIconUrl = 'https://slow-app.example.com/favicon.png';
    const bookmarks: chrome.bookmarks.BookmarkTreeNode[] = [
      { id: 'qa-slow', title: 'Slow App', url: bmUrl, index: 0 }
    ];
    const bindings: Record<string, TabBinding> = {
      'qa-slow': {
        bookmarkId: 'qa-slow',
        tabId: 401,
        windowId: 1,
        originalUrl: bmUrl,
        currentUrl: bmUrl,
        currentTitle: 'Slow App',
        isNavigatedAway: false
      }
    };

    const { container, rerender } = render(
      <QuickAccessGrid
        {...defaultProps}
        bookmarks={bookmarks}
        bindingsByBookmarkId={bindings}
        tabsByTabId={{
          401: {
            id: 401,
            url: bmUrl,
            title: 'Slow App',
            status: 'complete',
            favIconUrl: liveIconUrl,
            _faviconRev: 1
          } as TabWithFaviconMeta
        }}
      />
    );

    // Initial slow reopen: both liveIconUrl and /_favicon/ fail -> renders Globe
    let img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(liveIconUrl);
    fireEvent.error(img!);

    img = container.querySelector('img');
    expect(img?.getAttribute('src')).toContain('/_favicon/');
    fireEvent.error(img!);

    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg.lucide-globe')).toBeInTheDocument();

    // User reloads the tab: status transitions loading -> complete with bumped _faviconRev and the SAME liveIconUrl
    rerender(
      <QuickAccessGrid
        {...defaultProps}
        bookmarks={bookmarks}
        bindingsByBookmarkId={bindings}
        tabsByTabId={{
          401: {
            id: 401,
            url: bmUrl,
            title: 'Slow App',
            status: 'loading',
            favIconUrl: liveIconUrl,
            _faviconRev: 2
          } as TabWithFaviconMeta
        }}
      />
    );
    expect(container.querySelector('svg.lucide-rotate-cw.animate-spin')).toBeInTheDocument();

    rerender(
      <QuickAccessGrid
        {...defaultProps}
        bookmarks={bookmarks}
        bindingsByBookmarkId={bindings}
        tabsByTabId={{
          401: {
            id: 401,
            url: bmUrl,
            title: 'Slow App',
            status: 'complete',
            favIconUrl: liveIconUrl,
            _faviconRev: 3
          } as TabWithFaviconMeta
        }}
      />
    );

    // Icon recovers instead of staying permanently stuck on Globe!
    const recoveredImg = container.querySelector('img');
    expect(recoveredImg).toBeInTheDocument();
    expect(recoveredImg?.getAttribute('src')).toBe(liveIconUrl);
    expect(container.querySelector('svg.lucide-globe')).not.toBeInTheDocument();
  });

  it('ignores the second click (detail > 1) of a double-click so onTileClick does not race with onTileDoubleClick', () => {
    const onTileClick = vi.fn();
    const onTileDoubleClick = vi.fn();
    render(
      <QuickAccessGrid
        {...defaultProps}
        onTileClick={onTileClick}
        onTileDoubleClick={onTileDoubleClick}
      />
    );

    const tile = screen.getByTitle(/GitHub/i);
    fireEvent.click(tile, { detail: 1 });
    fireEvent.click(tile, { detail: 2 });
    fireEvent.doubleClick(tile);

    expect(onTileClick).toHaveBeenCalledTimes(1);
    expect(onTileDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('reorders Quick Access tiles via drag-and-drop using activeDrag fallback when dataTransfer JSON is empty, and clears stuck indicators on Escape', () => {
    const onReorderQuickAccess = vi.fn();
    render(
      <QuickAccessGrid
        {...defaultProps}
        onReorderQuickAccess={onReorderQuickAccess}
      />
    );

    const githubTile = screen.getByTitle(/GitHub/i);
    const youtubeTile = screen.getByTitle(/YouTube/i);

    vi.spyOn(youtubeTile, 'getBoundingClientRect').mockReturnValue({
      left: 60,
      top: 0,
      right: 120,
      bottom: 58,
      width: 60,
      height: 58,
      x: 60,
      y: 0,
      toJSON: () => ({})
    });

    // Start dragging GitHub (index 0), hover right half of YouTube (index 1), then press Escape -> resets opacity & drop line
    fireEvent.dragStart(githubTile, {
      dataTransfer: { setData: vi.fn(), effectAllowed: 'copyMove' }
    });
    expect(githubTile.className).toContain('opacity-35');

    fireEvent.dragOver(youtubeTile, {
      clientX: 110,
      dataTransfer: { dropEffect: 'move' }
    });
    expect(youtubeTile.className).toContain('theme-drag-over-right');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(githubTile.className).not.toContain('opacity-35');
    expect(youtubeTile.className).not.toContain('theme-drag-over-right');

    // Now drag GitHub onto right half of YouTube with empty dataTransfer.getData -> must fall back to activeDrag session!
    startDragSession({ type: 'quickAccess', id: 'qa-1', index: 0 });
    fireEvent.dragOver(youtubeTile, {
      clientX: 112,
      dataTransfer: { dropEffect: 'move' }
    });
    fireEvent.drop(youtubeTile, {
      clientX: 112,
      dataTransfer: { getData: () => '' }
    });

    expect(onReorderQuickAccess).toHaveBeenCalledWith('qa-1', 2);
    endDragSession();
  });

  it('stops propagation on self-drop and folder-drop on a QuickAccessTile and prevents mute-badge double-click from reloading', () => {
    const parentOnDrop = vi.fn();
    const onTileDoubleClick = vi.fn();
    const onToggleMuteTab = vi.fn();

    render(
      <div onDrop={parentOnDrop}>
        <QuickAccessGrid
          {...defaultProps}
          onTileDoubleClick={onTileDoubleClick}
          onToggleMuteTab={onToggleMuteTab}
        />
      </div>
    );

    const githubTile = screen.getByTitle(/GitHub/i);

    // Self-drop must NOT bubble to parent container
    startDragSession({ type: 'quickAccess', id: 'qa-1', index: 0 });
    fireEvent.drop(githubTile, {
      clientX: 10,
      dataTransfer: { getData: () => '' }
    });
    expect(parentOnDrop).not.toHaveBeenCalled();

    // Folder drop must NOT bubble to parent container
    startDragSession({ type: 'folder', id: 'folder-1', index: 0 });
    fireEvent.drop(githubTile, {
      clientX: 10,
      dataTransfer: { getData: () => '' }
    });
    expect(parentOnDrop).not.toHaveBeenCalled();

    // Double-clicking mute badge on YouTube must NOT fire onTileDoubleClick
    const muteBadge = screen.getByTitle('Mute tab');
    fireEvent.doubleClick(muteBadge);
    expect(onTileDoubleClick).not.toHaveBeenCalled();
    endDragSession();
  });

  it('includes Move to Space submenu in context menu when other spaces exist and hides it when only active space exists', () => {
    const onOpenContextMenu = vi.fn();
    const onMoveToSpace = vi.fn();
    const spaces = [
      { id: 'home', name: 'Home', folderId: 'folder-home', icon: 'home' },
      { id: 'work', name: 'Work', folderId: 'folder-work', icon: 'briefcase' },
      { id: 'study', name: 'Study', folderId: 'folder-study', icon: 'book' }
    ];

    const { rerender } = render(
      <QuickAccessGrid
        {...defaultProps}
        spaces={spaces}
        activeSpaceId="home"
        onOpenContextMenu={onOpenContextMenu}
        onMoveToSpace={onMoveToSpace}
      />
    );

    const githubTile = screen.getByTitle(/GitHub/i);
    fireEvent.contextMenu(githubTile);

    const menuItems = onOpenContextMenu.mock.calls[0][1];
    const moveToSpaceItem = menuItems.find(
      (item: { label: string }) => item.label === 'Move to Space'
    );
    expect(moveToSpaceItem).toBeDefined();
    expect(moveToSpaceItem.submenu.map((s: { label: string }) => s.label)).toEqual([
      'Work',
      'Study'
    ]);

    moveToSpaceItem.submenu[0].action();
    expect(onMoveToSpace).toHaveBeenCalledWith('qa-1', 'folder-work');

    // Only active space exists -> Move to Space option should not be shown
    onOpenContextMenu.mockClear();
    rerender(
      <QuickAccessGrid
        {...defaultProps}
        spaces={[spaces[0]]}
        activeSpaceId="home"
        onOpenContextMenu={onOpenContextMenu}
        onMoveToSpace={onMoveToSpace}
      />
    );

    fireEvent.contextMenu(screen.getByTitle(/GitHub/i));
    const singleSpaceMenu = onOpenContextMenu.mock.calls[0][1];
    expect(
      singleSpaceMenu.some((item: { label: string }) => item.label === 'Move to Space')
    ).toBe(false);
  });

  it('calls onOpenInNewTab when clicking Duplicate Tab or Open in New Tab on an unopened Quick Access tile', () => {
    const onOpenContextMenu = vi.fn();
    const onDuplicateTab = vi.fn();
    const onOpenInNewTab = vi.fn();

    render(
      <QuickAccessGrid
        {...defaultProps}
        bindingsByBookmarkId={{}}
        tabsByTabId={{}}
        activeTabId={null}
        onOpenContextMenu={onOpenContextMenu}
        onDuplicateTab={onDuplicateTab}
        onOpenInNewTab={onOpenInNewTab}
      />
    );

    const githubTile = screen.getByTitle(/GitHub/i);
    fireEvent.contextMenu(githubTile);

    const menuItems = onOpenContextMenu.mock.calls[0][1];
    const duplicateItem = menuItems.find((item: { label: string }) => item.label === 'Duplicate Tab');
    const openNewTabItem = menuItems.find((item: { label: string }) => item.label === 'Open in New Tab');

    duplicateItem.action();
    expect(onDuplicateTab).not.toHaveBeenCalled();
    expect(onOpenInNewTab).toHaveBeenCalledWith('https://github.com');

    onOpenInNewTab.mockClear();
    openNewTabItem.action();
    expect(onOpenInNewTab).toHaveBeenCalledWith('https://github.com');
  });
});
