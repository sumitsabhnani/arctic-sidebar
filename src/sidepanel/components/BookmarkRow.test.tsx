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

  it('renders bookmark row with title and Copy link button on hover (even when tab is not open)', () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
    const { container } = render(<BookmarkRow {...defaultProps} binding={undefined} />);
    expect(screen.getByText('Google Docs')).toBeInTheDocument();

    const copyBtn = container.querySelector('button[data-tooltip="Copy link"]');
    expect(copyBtn).toBeInTheDocument();
    expect(copyBtn?.className).toContain('hidden');
    expect(copyBtn?.className).toContain('group-hover:flex');

    fireEvent.click(copyBtn!);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://docs.google.com');
  });

  it('does NOT render reload button on row hover (Reload lives in context menu, URL bar, and double-click favicon)', () => {
    const { container } = render(
      <BookmarkRow {...defaultProps} />
    );

    const reloadBtn = container.querySelector('button[data-tooltip="Reload tab"]');
    expect(reloadBtn).not.toBeInTheDocument();
  });

  it('renders action buttons in consistent order: PinOff -> Copy link -> Bell -> Close', () => {
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
        'button[data-tooltip="Unpin to Today\'s Tabs"], button[data-tooltip="Copy link"], button[data-tooltip="Set reminder"], button[data-tooltip="Close running tab"]'
      )
    );

    expect(actionButtons.length).toBe(4);
    expect(actionButtons[0]).toHaveAttribute('data-tooltip', "Unpin to Today's Tabs");
    expect(actionButtons[1]).toHaveAttribute('data-tooltip', 'Copy link');
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

  it('renders Google Doc bookmark with proper website favicon img instead of monochrome FileText icon', () => {
    const docBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: 'b-doc',
      parentId: 'folder-1',
      title: 'Project Spec',
      url: 'https://docs.google.com/document/d/123/edit'
    };

    const { container } = render(
      <BookmarkRow
        {...defaultProps}
        bookmark={docBookmark}
        binding={undefined}
      />
    );

    const docSvg = container.querySelector('svg.lucide-file-text');
    expect(docSvg).not.toBeInTheDocument();

    const faviconImg = container.querySelector('img');
    expect(faviconImg).toBeInTheDocument();
    expect(faviconImg?.getAttribute('src')).toContain(
      encodeURIComponent('https://docs.google.com/document/d/123/edit')
    );
  });

  it('renders spinning loader icon when bound tab status is loading', () => {
    const loadingTab = {
      id: 501,
      status: 'loading'
    } as chrome.tabs.Tab;

    const { container } = render(
      <BookmarkRow
        {...defaultProps}
        boundTab={loadingTab}
      />
    );

    const spinSvg = container.querySelector('svg.lucide-rotate-cw.animate-spin');
    expect(spinSvg).toBeInTheDocument();
  });

  it('calls onFaviconDoubleClick when double-clicking the favicon or row icon area', () => {
    const onFaviconDoubleClick = vi.fn();
    render(
      <BookmarkRow
        {...defaultProps}
        onFaviconDoubleClick={onFaviconDoubleClick}
      />
    );

    const faviconBtn = screen.getByTitle(/Double-click to reload/i);
    fireEvent.doubleClick(faviconBtn);
    expect(onFaviconDoubleClick).toHaveBeenCalledWith(mockBookmark, expect.any(Object));
  });
});
