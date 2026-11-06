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

  it('renders scratchpad bookmark with monochrome note icon, handles selection and note click', () => {
    const onRowClick = vi.fn();
    const noteBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: 'b-note',
      parentId: 'folder-1',
      title: 'Meeting Notes',
      url: 'https://arctic.local/note/note_123'
    };

    const { container, rerender } = render(
      <BookmarkRow
        {...defaultProps}
        bookmark={noteBookmark}
        binding={undefined}
        isSelected={false}
        isActive={false}
        onRowClick={onRowClick}
      />
    );

    expect(screen.getByText('Meeting Notes')).toBeInTheDocument();
    // Scratchpad notes render a StickyNote svg icon
    const noteSvg = container.querySelector('svg.lucide-sticky-note');
    expect(noteSvg).toBeInTheDocument();
    expect(noteSvg?.getAttribute('class') || '').toContain('text-zinc-400');

    // Click on scratchpad note row
    const row = screen.getByText('Meeting Notes').closest('[role="button"]')!;
    fireEvent.click(row);
    expect(onRowClick).toHaveBeenCalledTimes(1);

    // Re-render as active (when note drawer is open)
    rerender(
      <BookmarkRow
        {...defaultProps}
        bookmark={noteBookmark}
        binding={undefined}
        isSelected={false}
        isActive={true}
        onRowClick={onRowClick}
      />
    );
    expect(row.className).toContain('theme-active-card');

    // Re-render as multi-selected
    rerender(
      <BookmarkRow
        {...defaultProps}
        bookmark={noteBookmark}
        binding={undefined}
        isSelected={true}
        isActive={false}
        onRowClick={onRowClick}
      />
    );
    expect(row.className).toContain('bg-cyan-500/15');
  });

  it('renders Google Doc bookmark with monochrome FileText icon', () => {
    const docBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: 'b-doc',
      parentId: 'folder-1',
      title: 'Project Spec',
      url: 'https://docs.new'
    };

    const { container } = render(
      <BookmarkRow
        {...defaultProps}
        bookmark={docBookmark}
        binding={undefined}
      />
    );

    const docSvg = container.querySelector('svg.lucide-file-text');
    expect(docSvg).toBeInTheDocument();
    expect(docSvg?.getAttribute('class') || '').toContain('text-zinc-400');
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
});
