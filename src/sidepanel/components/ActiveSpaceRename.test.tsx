import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import { BookmarkRow } from './BookmarkRow';
import { FolderNode } from './FolderNode';

describe('Active Space tab and folder renaming coordination', () => {
  const bookmark1: chrome.bookmarks.BookmarkTreeNode = {
    id: 'b1',
    parentId: 'root-1',
    title: 'Google Search',
    url: 'https://google.com'
  };

  const bookmark2: chrome.bookmarks.BookmarkTreeNode = {
    id: 'b2',
    parentId: 'f1',
    title: 'GitHub Home',
    url: 'https://github.com'
  };

  const folder1: chrome.bookmarks.BookmarkTreeNode = {
    id: 'f1',
    parentId: 'root-1',
    title: 'Development Links',
    children: [bookmark2]
  };

  // Harness that mimics App.tsx coordination across bookmarks and folders
  const CoordinatedSpaceHarness: React.FC<{
    onSaveRenameBookmark?: (id: string, title: string) => void;
    onSaveRenameFolder?: (id: string, title: string) => void;
  }> = ({ onSaveRenameBookmark, onSaveRenameFolder }) => {
    const [editingTarget, setEditingTarget] = useState<{
      type: 'openTab' | 'bookmark' | 'folder';
      id: string | number;
      initialTitle: string;
      title: string;
    } | null>(null);

    const commitCurrentEdit = (target: {
      type: 'openTab' | 'bookmark' | 'folder';
      id: string | number;
      initialTitle: string;
      title: string;
    }) => {
      const trimmed = target.title.trim();
      const initialTrimmed = target.initialTitle.trim();
      if (trimmed && trimmed !== initialTrimmed) {
        if (target.type === 'bookmark') {
          onSaveRenameBookmark?.(String(target.id), trimmed);
        } else if (target.type === 'folder') {
          onSaveRenameFolder?.(String(target.id), trimmed);
        }
      }
    };

    const handleStartRename = (
      type: 'openTab' | 'bookmark' | 'folder',
      id: string | number,
      currentTitle: string
    ) => {
      if (editingTarget !== null && !(editingTarget.type === type && editingTarget.id === id)) {
        commitCurrentEdit(editingTarget);
      }
      setEditingTarget({
        type,
        id,
        initialTitle: currentTitle || '',
        title: currentTitle || ''
      });
    };

    const handleChangeEditTitle = (newTitle: string) => {
      setEditingTarget((prev) => (prev ? { ...prev, title: newTitle } : null));
    };

    const handleSaveRename = () => {
      if (editingTarget) {
        commitCurrentEdit(editingTarget);
        setEditingTarget(null);
      }
    };

    const handleCancelRename = () => {
      setEditingTarget(null);
    };

    const isB1Editing = Boolean(editingTarget && editingTarget.type === 'bookmark' && editingTarget.id === bookmark1.id);

    return (
      <div>
        {/* Space Header mock */}
        <div
          data-testid="space-header"
          onDoubleClick={() => {
            if (editingTarget) {
              commitCurrentEdit(editingTarget);
              setEditingTarget(null);
            }
          }}
        >
          Home
        </div>
        <FolderNode
          node={folder1}
          collapsedFolderIds={{}}
          onToggleCollapse={vi.fn()}
          bindingsByBookmarkId={{}}
          activeTabId={null}
          onRowClick={vi.fn()}
          onFaviconClick={vi.fn()}
          onCloseTab={vi.fn()}
          onCreateFolder={vi.fn()}
          editingTarget={editingTarget}
          onStartRename={handleStartRename}
          onChangeEditTitle={handleChangeEditTitle}
          onSaveRename={handleSaveRename}
          onCancelRename={handleCancelRename}
        />
        <BookmarkRow
          bookmark={bookmark1}
          isActive={false}
          onRowClick={vi.fn()}
          onFaviconClick={vi.fn()}
          onCloseTab={vi.fn()}
          isEditing={isB1Editing}
          editTitle={isB1Editing && editingTarget ? editingTarget.title : bookmark1.title}
          onStartRename={() => handleStartRename('bookmark', bookmark1.id, bookmark1.title || '')}
          onChangeEditTitle={handleChangeEditTitle}
          onSaveRename={handleSaveRename}
          onCancelRename={handleCancelRename}
        />
      </div>
    );
  };

  it('cancels previous Active Space tab edit when double-clicking another tab without changes', () => {
    const onSaveBookmark = vi.fn();
    render(<CoordinatedSpaceHarness onSaveRenameBookmark={onSaveBookmark} />);

    // Double-click first tab
    const firstTabTitles = screen.getAllByText('Google Search');
    fireEvent.doubleClick(firstTabTitles[0]);

    // First tab should have textbox
    const inputsAfterFirst = screen.getAllByRole('textbox');
    expect(inputsAfterFirst.length).toBe(1);
    expect(inputsAfterFirst[0]).toHaveValue('Google Search');

    // Double-click second tab without changes
    const secondTabTitles = screen.getAllByText('GitHub Home');
    fireEvent.doubleClick(secondTabTitles[0]);

    // Previous tab cancelled; second tab now has textbox
    const inputsAfterSecond = screen.getAllByRole('textbox');
    expect(inputsAfterSecond.length).toBe(1);
    expect(inputsAfterSecond[0]).toHaveValue('GitHub Home');
    expect(onSaveBookmark).not.toHaveBeenCalled();
  });

  it('saves previous Active Space tab edit when double-clicking another tab after title changes', () => {
    const onSaveBookmark = vi.fn();
    render(<CoordinatedSpaceHarness onSaveRenameBookmark={onSaveBookmark} />);

    // Double-click first tab
    const firstTabTitles = screen.getAllByText('Google Search');
    fireEvent.doubleClick(firstTabTitles[0]);

    // Change title
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Google Portal' } });

    // Double-click second tab
    const secondTabTitles = screen.getAllByText('GitHub Home');
    fireEvent.doubleClick(secondTabTitles[0]);

    // Should have saved previous tab
    expect(onSaveBookmark).toHaveBeenCalledWith('b1', 'Google Portal');

    // Second tab now active in rename mode
    const inputsAfterSecond = screen.getAllByRole('textbox');
    expect(inputsAfterSecond.length).toBe(1);
    expect(inputsAfterSecond[0]).toHaveValue('GitHub Home');
  });

  it('coordinates renaming between folders and tabs in Active Space', () => {
    const onSaveBookmark = vi.fn();
    const onSaveFolder = vi.fn();
    render(
      <CoordinatedSpaceHarness
        onSaveRenameBookmark={onSaveBookmark}
        onSaveRenameFolder={onSaveFolder}
      />
    );

    // Double-click folder
    const folderTitle = screen.getByText('Development Links');
    fireEvent.doubleClick(folderTitle);

    // Folder input active
    let inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBe(1);
    expect(inputs[0]).toHaveValue('Development Links');

    // Edit folder name
    fireEvent.change(inputs[0], { target: { value: 'Dev Resources' } });

    // Double-click tab inside Active Space
    const firstTabTitles = screen.getAllByText('Google Search');
    fireEvent.doubleClick(firstTabTitles[0]);

    // Folder rename was committed
    expect(onSaveFolder).toHaveBeenCalledWith('f1', 'Dev Resources');

    // Tab is now the only one being edited
    inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBe(1);
    expect(inputs[0]).toHaveValue('Google Search');
  });

  it('commits or cancels Active Space tab rename when double-clicking space header', () => {
    const onSaveBookmark = vi.fn();
    render(<CoordinatedSpaceHarness onSaveRenameBookmark={onSaveBookmark} />);

    // Double-click tab to rename
    const tab = screen.getByText('Google Search');
    fireEvent.doubleClick(tab);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Google Updated' } });

    // Double click space header
    const spaceHeader = screen.getByTestId('space-header');
    fireEvent.doubleClick(spaceHeader);

    // Tab edit saved and closed
    expect(onSaveBookmark).toHaveBeenCalledWith('b1', 'Google Updated');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
