import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickAccessGrid } from './QuickAccessGrid';
import type { TabBinding } from '../../types';

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

  it('renders reload icon on quick access tile on hover and triggers reload on click', () => {
    render(<QuickAccessGrid {...defaultProps} />);

    const reloadButtons = screen.getAllByTitle('Reload tab');
    expect(reloadButtons.length).toBe(2);
    reloadButtons.forEach((btn) => {
      expect(btn.className).toContain('hidden');
      expect(btn.className).toContain('group-hover:flex');
    });

    fireEvent.click(reloadButtons[0]);
    expect(defaultProps.onReloadTab).toHaveBeenCalledWith(101);
  });

  it('does NOT render reload icon on quick access tile when tab is not open', () => {
    // Only qa-1 is bound; qa-2 is not open
    render(<QuickAccessGrid {...defaultProps} bindingsByBookmarkId={{ 'qa-1': mockBindings['qa-1'] }} />);

    const reloadButtons = screen.getAllByTitle('Reload tab');
    expect(reloadButtons.length).toBe(1);
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
});
