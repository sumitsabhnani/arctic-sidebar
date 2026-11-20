import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BookmarkRow } from './BookmarkRow';
import type { TabBinding, TabWithFaviconMeta } from '../../types';

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
        'button[data-tooltip="Unpin tab"], button[data-tooltip="Copy link"], button[data-tooltip="Set reminder"], button[data-tooltip="Close running tab"]'
      )
    );

    expect(actionButtons.length).toBe(4);
    expect(actionButtons[0]).toHaveAttribute('data-tooltip', 'Unpin tab');
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

  it('supports reordering a folder above or below a BookmarkRow via drag and drop', () => {
    const onDropItemToFolder = vi.fn();
    render(
      <BookmarkRow
        {...defaultProps}
        bookmark={{ ...mockBookmark, parentId: 'space-root', index: 3 }}
        onDropItemToFolder={onDropItemToFolder}
      />
    );

    const row = screen.getByText('Google Docs').closest('[role="button"]') as HTMLElement;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 34,
      left: 0,
      right: 260,
      width: 260,
      height: 34,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });

    // Drop folder on bottom half -> index 4
    fireEvent.dragOver(row, { clientY: 28, dataTransfer: { dropEffect: 'move' } });
    fireEvent.drop(row, {
      clientY: 28,
      dataTransfer: {
        getData: (type: string) =>
          type === 'application/json'
            ? JSON.stringify({ type: 'folder', id: 'folder-a', parentId: 'space-root', index: 1 })
            : ''
      }
    });

    expect(onDropItemToFolder).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'folder', id: 'folder-a' }),
      'space-root',
      4
    );
  });

  it('blocks dropping an ancestor folder onto a BookmarkRow inside that folder', () => {
    const onDropItemToFolder = vi.fn();
    const treeRoots: chrome.bookmarks.BookmarkTreeNode[] = [
      {
        id: 'folder-anc',
        title: 'Ancestor',
        children: [
          {
            id: 'b-101',
            parentId: 'folder-anc',
            index: 0,
            title: 'Google Docs',
            url: 'https://docs.google.com'
          }
        ]
      }
    ];

    render(
      <BookmarkRow
        {...defaultProps}
        bookmark={treeRoots[0].children![0]}
        treeRoots={treeRoots}
        onDropItemToFolder={onDropItemToFolder}
      />
    );

    const row = screen.getByText('Google Docs').closest('[role="button"]')!;
    fireEvent.drop(row, {
      clientY: 4,
      dataTransfer: {
        getData: (type: string) =>
          type === 'application/json'
            ? JSON.stringify({ type: 'folder', id: 'folder-anc', parentId: 'space-root' })
            : ''
      }
    });

    expect(onDropItemToFolder).not.toHaveBeenCalled();
  });

  it('falls back to /_favicon/ when boundTab.favIconUrl fails and retries live favIconUrl after reload', () => {
    const liveIcon = 'https://docs.google.com/favicon.ico';
    const { container, rerender } = render(
      <BookmarkRow
        {...defaultProps}
        boundTab={
          {
            id: 501,
            url: 'https://docs.google.com',
            status: 'complete',
            favIconUrl: liveIcon,
            _faviconRev: 1
          } as TabWithFaviconMeta
        }
      />
    );

    // 1. Live icon fails transiently -> steps to /_favicon/ fallback instead of permanent Globe
    let img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(liveIcon);
    fireEvent.error(img!);

    img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute('src')).toContain('/_favicon/');
    fireEvent.error(img!);
    expect(container.querySelector('svg.lucide-globe')).toBeInTheDocument();

    // 2. Reload completes with bumped _faviconRev -> retries liveIcon cleanly
    rerender(
      <BookmarkRow
        {...defaultProps}
        boundTab={
          {
            id: 501,
            url: 'https://docs.google.com',
            status: 'complete',
            favIconUrl: liveIcon,
            _faviconRev: 2
          } as TabWithFaviconMeta
        }
      />
    );

    img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute('src')).toBe(liveIcon);
  });

  it('renders highlight quote snippet and Copy Highlight Quote context menu option for #:~:text= highlight bookmarks', () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });

    const highlightBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: 'b-hl-1',
      parentId: 'folder-1',
      title: '“Curiosity is the best guide” — How to Do Great Work',
      url: 'https://paulgraham.com/greatwork.html#:~:text=Curiosity%20is%20the%20best%20guide'
    };

    render(
      <BookmarkRow
        {...defaultProps}
        bookmark={highlightBookmark}
        binding={undefined}
      />
    );

    // Displays clean page title on line 1 and styled quote snippet on line 2
    expect(screen.getByText('How to Do Great Work')).toBeInTheDocument();
    const quoteEl = screen.getByTestId('bookmark-highlight-quote');
    expect(quoteEl).toHaveTextContent('“Curiosity is the best guide”');

    // Right-click opens context menu with "Copy Highlight Quote"
    defaultProps.onOpenContextMenu.mockClear();
    const row = screen.getByText('How to Do Great Work').closest('[role="button"]')!;
    fireEvent.contextMenu(row);

    const menuItems = defaultProps.onOpenContextMenu.mock.calls[0][1];
    const copyQuoteItem = menuItems.find(
      (item: { label: string }) => item.label === 'Copy Highlight Quote'
    );
    expect(copyQuoteItem).toBeDefined();

    copyQuoteItem.action();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Curiosity is the best guide');
  });

  it('renders active bookmark row with concentric rounded-xl border so it is never clipped by the curved active space container', () => {
    const { container } = render(<BookmarkRow {...defaultProps} isActive={true} />);
    const row = container.querySelector('[data-bookmark-id="b-101"]') as HTMLElement;
    expect(row).toHaveClass('theme-active-card');
    expect(row).toHaveClass('rounded-xl');
  });
});
