import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BookmarkRow } from './BookmarkRow';
import type { TabBinding } from '../../types';

describe('BookmarkRow component', () => {
  const mockBookmark: chrome.bookmarks.BookmarkTreeNode = {
    id: 'b-101',
    parentId: 'folder-1',
    title: 'Google Docs',
    url: 'https://docs.google.com'
  };

  const mockBinding: TabBinding = {
    bookmarkId: 'b-101',
    tabId: 501,
    windowId: 1,
    originalUrl: 'https://docs.google.com',
    currentUrl: 'https://docs.google.com',
    currentTitle: 'Google Docs',
    isNavigatedAway: false
  };

  const defaultProps = {
    bookmark: mockBookmark,
    depth: 0,
    binding: mockBinding,
    isActive: false,
    onRowClick: vi.fn(),
    onFaviconClick: vi.fn(),
    onCloseTab: vi.fn(),
    onReloadTab: vi.fn(),
    onDuplicateTab: vi.fn(),
    onOpenContextMenu: vi.fn()
  };

  it('renders bookmark row with title and reload button on hover', () => {
    const { container } = render(<BookmarkRow {...defaultProps} />);
    expect(screen.getByText('Google Docs')).toBeInTheDocument();

    const reloadBtn = container.querySelector('button[data-tooltip="Reload tab"]');
    expect(reloadBtn).toBeInTheDocument();
    expect(reloadBtn?.className).toContain('hidden');
    expect(reloadBtn?.className).toContain('group-hover:flex');

    fireEvent.click(reloadBtn!);
    expect(defaultProps.onReloadTab).toHaveBeenCalledWith(501);
  });

  it('does NOT render reload button when bookmark tab is not open (un-bound)', () => {
    const { container } = render(
      <BookmarkRow {...defaultProps} binding={undefined} />
    );

    const reloadBtn = container.querySelector('button[data-tooltip="Reload tab"]');
    expect(reloadBtn).not.toBeInTheDocument();
  });

  it('renders action buttons in consistent order: PinOff -> Reload -> Bell -> Close', () => {
    const onOpenReminderPopover = vi.fn();
    const onUnpinBookmark = vi.fn();
    const { container } = render(
      <BookmarkRow
        {...defaultProps}
        onOpenReminderPopover={onOpenReminderPopover}
        onUnpinBookmark={onUnpinBookmark}
      />
    );

    // Query all action buttons within the right-side cluster
    const actionButtons = Array.from(
      container.querySelectorAll(
        'button[data-tooltip="Unpin to Today\'s Tabs (Removes bookmark)"], button[data-tooltip="Reload tab"], button[data-tooltip="Set reminder"], button[data-tooltip="Close running tab"]'
      )
    );

    expect(actionButtons.length).toBe(4);
    expect(actionButtons[0]).toHaveAttribute('data-tooltip', "Unpin to Today's Tabs (Removes bookmark)");
    expect(actionButtons[1]).toHaveAttribute('data-tooltip', 'Reload tab');
    expect(actionButtons[2]).toHaveAttribute('data-tooltip', 'Set reminder');
    expect(actionButtons[3]).toHaveAttribute('data-tooltip', 'Close running tab');
  });

  it('includes Duplicate Tab option in context menu on right click', () => {
    render(<BookmarkRow {...defaultProps} />);
    const row = screen.getByText('Google Docs').closest('[role="button"]')!;
    fireEvent.contextMenu(row);

    expect(defaultProps.onOpenContextMenu).toHaveBeenCalled();
    const menuItems = defaultProps.onOpenContextMenu.mock.calls[0][1];
    const duplicateItem = menuItems.find((item: { label: string }) => item.label === 'Duplicate Tab');
    expect(duplicateItem).toBeDefined();

    duplicateItem.action();
    expect(defaultProps.onDuplicateTab).toHaveBeenCalledWith(501);
  });
});
