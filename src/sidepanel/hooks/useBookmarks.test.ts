import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBookmarks } from './useBookmarks';
import { mockChrome } from '../../test/setup';

describe('useBookmarks hook', () => {
  beforeEach(() => {
    mockChrome.__resetAll();
  });

  it('initializes default folder hierarchy and spaces if none exist (positive)', async () => {
    const { result } = renderHook(() => useBookmarks());

    // Wait until loading completes
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.spaces.length).toBe(3);
    expect(result.current.spaces.map((s) => s.name)).toEqual(['Home', 'Work', 'Personal']);
    expect(result.current.activeSpaceId).toBe('home');
    expect(result.current.quickAccessNode).toBeDefined();
    expect(result.current.workspaceNode).toBeDefined();
  });

  it('migrates legacy "Workspace" folder to "Home" automatically', async () => {
    // Seed tree with legacy 'Workspace'
    mockChrome.__setBookmarksTree([
      {
        id: '0',
        title: 'Root',
        children: [
          {
            id: '2',
            title: 'Other Bookmarks',
            children: [
              {
                id: '10',
                title: 'Arctic Sidebar',
                children: [
                  { id: '11', title: 'Quick Access', children: [] },
                  { id: '12', title: 'Workspace', children: [] }
                ]
              }
            ]
          }
        ]
      }
    ]);

    renderHook(() => useBookmarks());
    await act(async () => {
      await Promise.resolve();
    });

    // Check that bookmark title was renamed to Home
    const tree = mockChrome.__getBookmarksTree();
    const otherBookmarks = tree[0].children?.find((c) => c.id === '2');
    const arctic = otherBookmarks?.children?.find((c) => c.title === 'Arctic Sidebar');
    const home = arctic?.children?.find((c) => c.id === '12');
    expect(home?.title).toBe('Home');
  });

  it('allows creating, renaming, and deleting spaces (positive and negative)', async () => {
    const { result } = renderHook(() => useBookmarks());
    await act(async () => {
      await Promise.resolve();
    });

    // Positive: Create a new Space "Study"
    await act(async () => {
      await result.current.createSpace('Study', 'book');
    });

    expect(result.current.spaces.some((s) => s.name === 'Study')).toBe(true);
    const studySpace = result.current.spaces.find((s) => s.name === 'Study')!;
    expect(result.current.activeSpaceId).toBe(studySpace.id);

    // Positive: Rename space
    await act(async () => {
      await result.current.renameSpace(studySpace.id, 'Advanced Study');
    });
    expect(result.current.spaces.find((s) => s.id === studySpace.id)?.name).toBe('Advanced Study');

    // Negative: Creating empty space does nothing
    const countBefore = result.current.spaces.length;
    await act(async () => {
      await result.current.createSpace('   ');
    });
    expect(result.current.spaces.length).toBe(countBefore);

    // Positive: Delete space
    await act(async () => {
      await result.current.deleteSpace(studySpace.id);
    });
    expect(result.current.spaces.some((s) => s.id === studySpace.id)).toBe(false);

    // Negative: Cannot delete when only 1 space remains
    // First remove other spaces until only 1 remains
    while (result.current.spaces.length > 1) {
      const spaceToDelete = result.current.spaces[result.current.spaces.length - 1];
      await act(async () => {
        await result.current.deleteSpace(spaceToDelete.id);
      });
    }
    expect(result.current.spaces.length).toBe(1);
    const lastSpaceId = result.current.spaces[0].id;
    await act(async () => {
      await result.current.deleteSpace(lastSpaceId);
    });
    expect(result.current.spaces.length).toBe(1);
    expect(result.current.spaces[0].id).toBe(lastSpaceId);
  });

  it('switches active space and loads its folder contents', async () => {
    const { result } = renderHook(() => useBookmarks());
    await act(async () => {
      await Promise.resolve();
    });

    const workSpace = result.current.spaces.find((s) => s.name === 'Work');
    expect(workSpace).toBeDefined();

    await act(async () => {
      await result.current.selectSpace(workSpace!.id);
    });

    expect(result.current.activeSpaceId).toBe(workSpace!.id);
    expect(result.current.activeFolderIds.workspaceId).toBe(workSpace!.folderId);
  });

  it('supports moving bookmarks or folders to another space root (moveNodeToSpace)', async () => {
    const { result } = renderHook(() => useBookmarks());
    await act(async () => {
      await Promise.resolve();
    });

    const homeFolderId = result.current.activeFolderIds.workspaceId!;
    const workSpace = result.current.spaces.find((s) => s.name === 'Work')!;

    // Create a bookmark in Home
    await act(async () => {
      await result.current.createBookmark(homeFolderId, 'Test Doc', 'https://docs.google.com');
    });

    const matches = await mockChrome.bookmarks.search('Test Doc');
    expect(matches.length).toBe(1);
    const bookmarkId = matches[0].id;
    expect(matches[0].parentId).toBe(homeFolderId);

    // Move to Work space
    await act(async () => {
      await result.current.moveNodeToSpace(bookmarkId, workSpace.folderId);
    });

    const moved = await mockChrome.bookmarks.getSubTree(bookmarkId);
    expect(moved[0].parentId).toBe(workSpace.folderId);
  });

  it('toggles folder collapse and persists in storage.local', async () => {
    const { result } = renderHook(() => useBookmarks());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.collapsedFolderIds['test-folder-1']).toBeFalsy();

    await act(async () => {
      result.current.toggleFolderCollapse('test-folder-1');
    });

    expect(result.current.collapsedFolderIds['test-folder-1']).toBe(true);
    expect(mockChrome.__getLocalStorage()['collapsedFolderIds']).toEqual({ 'test-folder-1': true });

    await act(async () => {
      result.current.toggleFolderCollapse('test-folder-1');
    });
    expect(result.current.collapsedFolderIds['test-folder-1']).toBe(false);
  });
});
