import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FolderNode } from './FolderNode';

function createBaseFolderProps(overrides: Partial<React.ComponentProps<typeof FolderNode>> = {}) {
  const node: chrome.bookmarks.BookmarkTreeNode = {
    id: 'folder-1',
    parentId: 'root-space',
    title: 'Engineering',
    children: [
      {
        id: 'bm-1',
        parentId: 'folder-1',
        title: 'GitHub Issues',
        url: 'https://github.com/issues'
      },
      {
        id: 'subfolder-1',
        parentId: 'folder-1',
        title: 'Design Docs',
        children: []
      }
    ],
    ...overrides.node
  };

  return {
    node,
    collapsedFolderIds: { 'folder-1': false, 'subfolder-1': false },
    onToggleCollapse: vi.fn(),
    bindingsByBookmarkId: {},
    activeTabId: null,
    onRowClick: vi.fn(),
    onFaviconClick: vi.fn(),
    onCloseTab: vi.fn(),
    onCreateFolder: vi.fn(),
    ...overrides
  };
}

describe('FolderNode Component', () => {
  it('renders folder header, child bookmarks, and nested subfolders when expanded', () => {
    const props = createBaseFolderProps();
    render(<FolderNode {...props} />);

    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('GitHub Issues')).toBeInTheDocument();
    expect(screen.getByText('Design Docs')).toBeInTheDocument();
    expect(screen.getByText('Empty folder')).toBeInTheDocument();
  });

  it('toggles folder collapse when clicking the folder header', () => {
    const props = createBaseFolderProps({
      collapsedFolderIds: { 'folder-1': true }
    });
    render(<FolderNode {...props} />);

    expect(screen.queryByText('GitHub Issues')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Engineering'));
    expect(props.onToggleCollapse).toHaveBeenCalledWith('folder-1');
  });

  it('creates a new subfolder via the inline subfolder form', () => {
    const props = createBaseFolderProps();
    const { container } = render(<FolderNode {...props} />);

    const newSubfolderBtn = container.querySelector('[data-tooltip="New subfolder"]');
    expect(newSubfolderBtn).toBeInTheDocument();
    fireEvent.click(newSubfolderBtn!);

    const input = screen.getByPlaceholderText('Subfolder name...');
    fireEvent.change(input, { target: { value: 'API Specs' } });
    fireEvent.submit(input.closest('form')!);

    expect(props.onCreateFolder).toHaveBeenCalledWith('folder-1', 'API Specs');
  });

  it('supports inline folder rename on double-click and saves new folder title', () => {
    const onRenameFolder = vi.fn();
    const props = createBaseFolderProps({ onRenameFolder });

    render(<FolderNode {...props} />);

    fireEvent.doubleClick(screen.getByText('Engineering'));

    const input = screen.getByDisplayValue('Engineering');
    fireEvent.change(input, { target: { value: 'Platform Engineering' } });
    fireEvent.submit(input.closest('form')!);

    expect(onRenameFolder).toHaveBeenCalledWith('folder-1', 'Platform Engineering');
  });

  it('provides context menu actions including archiving all open tabs inside the folder', () => {
    const onOpenContextMenu = vi.fn();
    const onDiscardTab = vi.fn();
    const onDeleteBookmark = vi.fn();
    const props = createBaseFolderProps({
      onOpenContextMenu,
      onDiscardTab,
      onDeleteBookmark,
      bindingsByBookmarkId: {
        'bm-1': {
          bookmarkId: 'bm-1',
          tabId: 101,
          windowId: 10,
          originalUrl: 'https://github.com/issues',
          currentUrl: 'https://github.com/issues',
          currentTitle: 'GitHub Issues',
          isNavigatedAway: false
        }
      }
    });

    render(<FolderNode {...props} />);

    const folderRow = screen.getByText('Engineering').closest('[role="button"]')!;
    fireEvent.contextMenu(folderRow);

    expect(onOpenContextMenu).toHaveBeenCalledTimes(1);
    const menuItems = onOpenContextMenu.mock.calls[0][1];

    const archiveItem = menuItems.find((item: { label: string }) =>
      item.label.includes('Archive All Tabs in Folder (1 open)')
    );
    expect(archiveItem).toBeDefined();
    archiveItem.action();
    expect(onDiscardTab).toHaveBeenCalledWith(101);

    const deleteItem = menuItems.find((item: { label: string }) => item.label === 'Delete Folder');
    expect(deleteItem).toBeDefined();
    deleteItem.action();
    expect(onDeleteBookmark).toHaveBeenCalledWith('folder-1');
  });

  it('drops openTab and bookmark OUTSIDE the folder when dropped on top or bottom edge zones of a collapsed folder', () => {
    const onDropItemToFolder = vi.fn();
    const props = createBaseFolderProps({
      node: {
        id: 'folder-1',
        parentId: 'root-space',
        index: 2,
        title: 'Engineering',
        children: []
      },
      collapsedFolderIds: { 'folder-1': true },
      onDropItemToFolder
    });

    render(<FolderNode {...props} />);
    const folderRow = screen.getByText('Engineering').closest('[role="button"]') as HTMLElement;
    vi.spyOn(folderRow, 'getBoundingClientRect').mockReturnValue({
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

    // 1. Drop an openTab on the bottom zone (clientY = 32 of 34px) -> inserts AFTER folder-1 in root-space (index 3)
    fireEvent.dragOver(folderRow, { clientY: 32, dataTransfer: { dropEffect: 'move' } });
    expect(folderRow.className).toContain('theme-drag-over-bottom');
    fireEvent.drop(folderRow, {
      clientY: 32,
      dataTransfer: {
        getData: (type: string) =>
          type === 'application/json'
            ? JSON.stringify({ type: 'openTab', tabId: 77, url: 'https://news.ycombinator.com' })
            : ''
      }
    });
    expect(onDropItemToFolder).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'openTab', tabId: 77 }),
      'root-space',
      3
    );

    // 2. Drop a bookmark on the top zone (clientY = 3 of 34px) -> inserts BEFORE folder-1 in root-space (index 2)
    onDropItemToFolder.mockClear();
    fireEvent.dragOver(folderRow, { clientY: 3, dataTransfer: { dropEffect: 'move' } });
    expect(folderRow.className).toContain('theme-drag-over-top');
    fireEvent.drop(folderRow, {
      clientY: 3,
      dataTransfer: {
        getData: (type: string) =>
          type === 'application/json'
            ? JSON.stringify({ type: 'bookmark', id: 'bm-99', ids: ['bm-99'] })
            : ''
      }
    });
    expect(onDropItemToFolder).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bookmark', id: 'bm-99' }),
      'root-space',
      2
    );

    // 3. Drop on middle zone (clientY = 17 of 34px) -> drops INSIDE folder-1
    onDropItemToFolder.mockClear();
    fireEvent.dragOver(folderRow, { clientY: 17, dataTransfer: { dropEffect: 'move' } });
    expect(folderRow.className).toContain('theme-drag-over-inside');
    fireEvent.drop(folderRow, {
      clientY: 17,
      dataTransfer: {
        getData: (type: string) =>
          type === 'application/json'
            ? JSON.stringify({ type: 'openTab', tabId: 88, url: 'https://react.dev' })
            : ''
      }
    });
    expect(onDropItemToFolder).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'openTab', tabId: 88 }),
      'folder-1'
    );
  });

  it('prevents circular drops of an ancestor folder into its own descendant subfolder', () => {
    const onDropItemToFolder = vi.fn();
    const props = createBaseFolderProps({ onDropItemToFolder });

    render(<FolderNode {...props} />);
    const subfolderRow = screen.getByText('Design Docs').closest('[role="button"]')!;

    fireEvent.drop(subfolderRow, {
      dataTransfer: {
        getData: (type: string) =>
          type === 'application/json'
            ? JSON.stringify({ type: 'folder', id: 'folder-1', parentId: 'root-space', index: 0 })
            : ''
      }
    });

    expect(onDropItemToFolder).not.toHaveBeenCalled();
  });
});
