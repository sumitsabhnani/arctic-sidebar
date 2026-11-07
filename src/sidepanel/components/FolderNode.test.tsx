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
});
