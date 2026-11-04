import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBookmarks } from './useBookmarks';
import { mockChrome } from '../../test/setup';

describe('useBookmarks hook', () => {
  beforeEach(() => {
    mockChrome.__resetAll();
  });

  it('initializes default folder hierarchy and keeps only 1 default space (Home) on fresh install', async () => {
    const { result } = renderHook(() => useBookmarks());

    // Wait until loading completes
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.spaces.length).toBe(1);
    expect(result.current.spaces.map((s) => s.name)).toEqual(['Home']);
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

    // Check that bookmark title was renamed to Home and root normalized to Arctic
    const tree = mockChrome.__getBookmarksTree();
    const otherBookmarks = tree[0].children?.find((c) => c.id === '2');
    const arctic = otherBookmarks?.children?.find((c) => c.title === 'Arctic');
    expect(arctic).toBeDefined();
    const home = arctic?.children?.find((c) => c.id === '12');
    expect(home?.title).toBe('Home');
  });

  it('automatically deduplicates, merges, and cleans up messy/duplicate folders in Arctic bookmarks', async () => {
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
                  {
                    id: '11',
                    title: 'Quick Access',
                    children: [{ id: '111', title: 'Gmail', url: 'https://mail.google.com/' }]
                  },
                  {
                    id: '12',
                    title: 'Quick Access',
                    children: [
                      { id: '121', title: 'Gmail', url: 'https://mail.google.com/' },
                      { id: '122', title: 'GitHub', url: 'https://github.com/' }
                    ]
                  },
                  {
                    id: '13',
                    title: 'Home',
                    children: [{ id: '131', title: 'SnapTrade', url: 'https://snaptrade.com/' }]
                  },
                  {
                    id: '14',
                    title: 'Workspace',
                    children: [{ id: '141', title: 'Sheets', children: [{ id: '142', title: 'Budget', url: 'https://docs.google.com/spreadsheets' }] }]
                  },
                  {
                    id: '20',
                    title: 'Learning',
                    children: [{ id: '201', title: 'Course 1', url: 'https://example.com/course1' }]
                  },
                  { id: '21', title: 'Quick Access (Learning)', children: [] },
                  { id: '22', title: 'Quick Access (Learning)', children: [{ id: '221', title: 'Docs', url: 'https://docs.example.com' }] },
                  { id: '30', title: 'Work', children: [] },
                  { id: '31', title: 'Work', children: [] },
                  { id: '32', title: 'Work', children: [] },
                  { id: '33', title: 'Quick Access (Work)', children: [] },
                  { id: '34', title: 'Quick Access (Work)', children: [] },
                  { id: '40', title: 'Personal', children: [] },
                  { id: '41', title: 'Personal', children: [] }
                ]
              }
            ]
          }
        ]
      }
    ]);
    mockChrome.__setLocalStorage({});
    mockChrome.__setSyncStorage({});

    const { result } = renderHook(() => useBookmarks());
    await act(async () => {
      await Promise.resolve();
    });

    const tree = mockChrome.__getBookmarksTree();
    const otherBookmarks = tree[0].children?.find((c) => c.id === '2');
    const arctic = otherBookmarks?.children?.find((c) => c.title === 'Arctic');
    expect(arctic).toBeDefined();

    const folderTitles = (arctic?.children || []).map((c) => c.title);
    // Under Arctic root, only space folders remain (Home and Learning)!
    // Root-level Quick Access and Quick Access (Learning) are migrated into Home/Quick Access and Learning/Quick Access,
    // and all 4x empty Work / Quick Access (Work) / Personal folders are removed!
    expect(folderTitles).toEqual(['Home', 'Learning']);

    // Verify Learning space was automatically discovered and appears in spaces!
    expect(result.current.spaces.map((s) => s.name)).toEqual(['Home', 'Learning']);

    // Verify Home / Quick Access merged both Gmail and GitHub without duplicating Gmail
    const qaUrls = (result.current.quickAccessNode?.children || []).map((c) => c.url);
    expect(qaUrls).toEqual(['https://mail.google.com/', 'https://github.com/']);

    // Verify Home merged both SnapTrade and Sheets subfolder from Workspace, plus its Quick Access child folder
    const homeTitles = (result.current.workspaceNode?.children || []).map((c) => c.title);
    expect(homeTitles).toContain('Quick Access');
    expect(homeTitles).toContain('SnapTrade');
    expect(homeTitles).toContain('Sheets');

    // Verify Learning / Quick Access received the Docs bookmark from Quick Access (Learning)
    const learningFolder = arctic?.children?.find((c) => c.title === 'Learning');
    const learningQa = learningFolder?.children?.find((c) => c.title === 'Quick Access');
    expect(learningQa).toBeDefined();
    expect((learningQa?.children || []).map((c) => c.url)).toEqual(['https://docs.example.com']);
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

    // Create Work space
    await act(async () => {
      await result.current.createSpace('Work', 'briefcase');
    });

    const workSpace = result.current.spaces.find((s) => s.name === 'Work');
    expect(workSpace).toBeDefined();

    await act(async () => {
      await result.current.selectSpace(workSpace!.id);
    });

    expect(result.current.activeSpaceId).toBe(workSpace!.id);
    expect(result.current.activeFolderIds.workspaceId).toBe(workSpace!.folderId);
    expect(result.current.activeFolderIds.quickAccessId).toBe(workSpace!.quickAccessFolderId);
    const homeSpace = result.current.spaces.find((s) => s.id === 'home');
    expect(result.current.activeFolderIds.quickAccessId).not.toBe(homeSpace?.quickAccessFolderId);
  });

  it('supports moving bookmarks or folders to another space root (moveNodeToSpace)', async () => {
    const { result } = renderHook(() => useBookmarks());
    await act(async () => {
      await Promise.resolve();
    });

    // Create Work space
    await act(async () => {
      await result.current.createSpace('Work', 'briefcase');
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

  it('automatically discovers existing Space folders under Arctic root on reinstall and nests Quick Access under each Space folder', async () => {
    // Seed existing Arctic folder with user spaces (e.g. Learning and Links)
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
                title: 'Arctic',
                children: [
                  { id: '11', title: 'Quick Access', children: [{ id: '111', title: 'Gmail', url: 'https://mail.google.com' }] },
                  { id: '12', title: 'Home', children: [] },
                  { id: '20', title: 'Learning', children: [{ id: '201', title: 'Jira', url: 'https://jira.com' }] },
                  { id: '21', title: 'Quick Access (Learning)', children: [] }
                ]
              }
            ]
          }
        ]
      }
    ]);

    // Ensure storage.local is completely empty as happens after uninstalling an extension
    mockChrome.__setLocalStorage({});
    mockChrome.__setSyncStorage({});

    const { result } = renderHook(() => useBookmarks());
    await act(async () => {
      await Promise.resolve();
    });

    // Both Home and Learning spaces are automatically discovered from Arctic root folders
    expect(result.current.spaces.map((s) => s.name)).toEqual(['Home', 'Learning']);
    const homeSpace = result.current.spaces.find((s) => s.name === 'Home')!;
    const learningSpace = result.current.spaces.find((s) => s.name === 'Learning')!;
    expect(learningSpace.folderId).toBe('20');
    expect(learningSpace.quickAccessFolderId).not.toBe(homeSpace.quickAccessFolderId);

    // Switch to Learning space and verify its bookmarks and separate Quick Access
    await act(async () => {
      await result.current.selectSpace(learningSpace.id);
    });
    expect(result.current.workspaceNode?.children?.some((c) => c.title === 'Jira')).toBe(true);
    expect(result.current.quickAccessNode?.children?.length).toBe(0);
  });

  it('cleans up empty legacy Work and Personal space folders on fresh/reinstalled startup and allows deleting any remaining spaces', async () => {
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
                title: 'Arctic',
                children: [
                  { id: '11', title: 'Quick Access', children: [] },
                  { id: '12', title: 'Home', children: [] },
                  { id: '20', title: 'Work', children: [] },
                  { id: '21', title: 'Quick Access (Work)', children: [] },
                  { id: '30', title: 'Personal', children: [] },
                  { id: '31', title: 'Quick Access (Personal)', children: [] }
                ]
              }
            ]
          }
        ]
      }
    ]);
    mockChrome.__setLocalStorage({});
    mockChrome.__setSyncStorage({});

    const { result } = renderHook(() => useBookmarks());
    await act(async () => {
      await Promise.resolve();
    });

    // Empty legacy Work & Personal folders are automatically removed, leaving only Home
    expect(result.current.spaces.length).toBe(1);
    expect(result.current.spaces[0].name).toBe('Home');
  });

  it('toggles folder collapse (folders default to closed/collapsed, first toggle expands to false) and persists in storage.local', async () => {
    const { result } = renderHook(() => useBookmarks());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.collapsedFolderIds['test-folder-1']).toBeUndefined();

    // First toggle opens the folder (sets collapsed = false)
    await act(async () => {
      result.current.toggleFolderCollapse('test-folder-1');
    });

    expect(result.current.collapsedFolderIds['test-folder-1']).toBe(false);
    expect(mockChrome.__getLocalStorage()['collapsedFolderIds']).toEqual({ 'test-folder-1': false });

    // Second toggle closes the folder (sets collapsed = true)
    await act(async () => {
      result.current.toggleFolderCollapse('test-folder-1');
    });
    expect(result.current.collapsedFolderIds['test-folder-1']).toBe(true);
  });

  it('createSpace nests Quick Access subfolder directly inside the created space folder and avoids root-level QA folders', async () => {
    const { result } = renderHook(() => useBookmarks());
    await act(async () => {
      await Promise.resolve();
    });

    // Create a new space named "Projects" with icon "code"
    await act(async () => {
      await result.current.createSpace('Projects', 'code');
    });

    const projectSpace = result.current.spaces.find((s) => s.name === 'Projects');
    expect(projectSpace).toBeDefined();
    expect(projectSpace?.icon).toBe('code');

    // Inspect the actual Chrome bookmarks tree
    const tree = mockChrome.__getBookmarksTree();
    const otherBookmarks = tree[0].children?.find((c) => c.id === '2');
    const arctic = otherBookmarks?.children?.find((c) => c.title === 'Arctic');
    expect(arctic).toBeDefined();

    // The Arctic root should only contain space folders (Home and Projects), NOT a root-level Quick Access (Projects)
    const arcticChildTitles = (arctic?.children || []).map((c) => c.title);
    expect(arcticChildTitles).toContain('Projects');
    expect(arcticChildTitles.some((t) => t.toLowerCase().includes('quick access'))).toBe(false);

    // Inside the Projects folder, there must be a nested Quick Access subfolder
    const projectsFolder = arctic?.children?.find((c) => c.title === 'Projects');
    expect(projectsFolder).toBeDefined();
    const nestedQa = projectsFolder?.children?.find((c) => c.title === 'Quick Access');
    expect(nestedQa).toBeDefined();
    expect(projectSpace?.quickAccessFolderId).toBe(nestedQa?.id);
    expect(projectSpace?.folderId).toBe(projectsFolder?.id);
  });

  it('deleteSpace deletes the space folder and its nested Quick Access folder completely', async () => {
    const { result } = renderHook(() => useBookmarks());
    await act(async () => {
      await Promise.resolve();
    });

    // Create space "Design"
    await act(async () => {
      await result.current.createSpace('Design', 'sparkles');
    });

    const designSpace = result.current.spaces.find((s) => s.name === 'Design')!;
    expect(designSpace).toBeDefined();
    const designFolderId = designSpace.folderId;
    const designQaId = designSpace.quickAccessFolderId;

    // Delete "Design" space
    await act(async () => {
      await result.current.deleteSpace(designSpace.id);
    });

    // Verify it was removed from spaces state and fallback to Home
    expect(result.current.spaces.some((s) => s.name === 'Design')).toBe(false);
    expect(result.current.activeSpaceId).toBe('home');

    // Verify both Design folder and nested QA folder were removed from Chrome bookmarks
    const tree = mockChrome.__getBookmarksTree();
    const otherBookmarks = tree[0].children?.find((c) => c.id === '2');
    const arctic = otherBookmarks?.children?.find((c) => c.title === 'Arctic');
    const designNode = arctic?.children?.find((c) => c.id === designFolderId);
    expect(designNode).toBeUndefined();

    const qaMatches = await mockChrome.bookmarks.search('Quick Access');
    expect(qaMatches.some((m) => m.id === designQaId)).toBe(false);
  });

  it('createFolder reuses existing Quick Access subfolder rather than duplicating it', async () => {
    const { result } = renderHook(() => useBookmarks());
    await act(async () => {
      await Promise.resolve();
    });

    const homeFolderId = result.current.activeFolderIds.workspaceId!;

    // Count Quick Access folders before
    const treeBefore = mockChrome.__getBookmarksTree();
    const otherBookmarksBefore = treeBefore[0].children?.find((c) => c.id === '2');
    const arcticBefore = otherBookmarksBefore?.children?.find((c) => c.title === 'Arctic');
    const homeBefore = arcticBefore?.children?.find((c) => c.id === homeFolderId);
    const qaCountBefore = (homeBefore?.children || []).filter((c) => c.title === 'Quick Access').length;
    expect(qaCountBefore).toBe(1);

    // Attempt to create another folder named "Quick Access" inside Home
    await act(async () => {
      await result.current.createFolder(homeFolderId, 'Quick Access');
    });

    // Should still have only 1 Quick Access folder inside Home
    const treeAfter = mockChrome.__getBookmarksTree();
    const otherBookmarksAfter = treeAfter[0].children?.find((c) => c.id === '2');
    const arcticAfter = otherBookmarksAfter?.children?.find((c) => c.title === 'Arctic');
    const homeAfter = arcticAfter?.children?.find((c) => c.id === homeFolderId);
    const qaCountAfter = (homeAfter?.children || []).filter((c) => c.title === 'Quick Access').length;
    expect(qaCountAfter).toBe(1);
  });

  it('automatically recovers an orphaned Quick Access (<Space>) by creating the Space folder and moving bookmarks', async () => {
    // Seed tree with an orphaned "Quick Access (Cooking)" with bookmarks but no "Cooking" folder
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
                title: 'Arctic',
                children: [
                  { id: '11', title: 'Quick Access', children: [] },
                  { id: '12', title: 'Home', children: [] },
                  {
                    id: '30',
                    title: 'Quick Access (Cooking)',
                    children: [
                      { id: '301', title: 'NYT Cooking', url: 'https://cooking.nytimes.com' },
                      { id: '302', title: 'Bon Appetit', url: 'https://bonappetit.com' }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
    mockChrome.__setLocalStorage({});
    mockChrome.__setSyncStorage({});

    const { result } = renderHook(() => useBookmarks());
    await act(async () => {
      await Promise.resolve();
    });

    // A "Cooking" space should have been recovered and discovered
    expect(result.current.spaces.map((s) => s.name)).toEqual(['Home', 'Cooking']);
    const cookingSpace = result.current.spaces.find((s) => s.name === 'Cooking')!;
    expect(cookingSpace).toBeDefined();

    // Switch to Cooking space and verify its quick access bookmarks
    await act(async () => {
      await result.current.selectSpace(cookingSpace.id);
    });

    const qaUrls = (result.current.quickAccessNode?.children || []).map((c) => c.url);
    expect(qaUrls).toEqual(['https://cooking.nytimes.com', 'https://bonappetit.com']);

    // Check tree structure: "Quick Access (Cooking)" at root is gone, replaced by Cooking/Quick Access
    const tree = mockChrome.__getBookmarksTree();
    const otherBookmarks = tree[0].children?.find((c) => c.id === '2');
    const arctic = otherBookmarks?.children?.find((c) => c.title === 'Arctic');
    expect(arctic?.children?.some((c) => c.title === 'Quick Access (Cooking)')).toBe(false);
    const cookingFolder = arctic?.children?.find((c) => c.title === 'Cooking');
    expect(cookingFolder).toBeDefined();
    expect(cookingFolder?.children?.some((c) => c.title === 'Quick Access')).toBe(true);
  });

  it('infers appropriate icons for automatically discovered space folders', async () => {
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
                title: 'Arctic',
                children: [
                  { id: '11', title: 'Quick Access', children: [] },
                  { id: '12', title: 'Home', children: [] },
                  { id: '20', title: 'Dev Code', children: [{ id: '201', title: 'b1', url: 'https://dev.com' }] },
                  { id: '30', title: 'Study Research', children: [{ id: '301', title: 'b2', url: 'https://edu.com' }] },
                  { id: '40', title: 'Work Office', children: [{ id: '401', title: 'b3', url: 'https://work.com' }] },
                  { id: '50', title: 'Personal Vault', children: [{ id: '501', title: 'b4', url: 'https://personal.com' }] },
                  { id: '60', title: 'Misc', children: [{ id: '601', title: 'b5', url: 'https://misc.com' }] }
                ]
              }
            ]
          }
        ]
      }
    ]);
    mockChrome.__setLocalStorage({});
    mockChrome.__setSyncStorage({});

    const { result } = renderHook(() => useBookmarks());
    await act(async () => {
      await Promise.resolve();
    });

    const spaceIcons = result.current.spaces.reduce<Record<string, string | undefined>>((acc, s) => {
      acc[s.name] = s.icon;
      return acc;
    }, {});

    expect(spaceIcons['Home']).toBe('home');
    expect(spaceIcons['Dev Code']).toBe('code');
    expect(spaceIcons['Study Research']).toBe('book');
    expect(spaceIcons['Work Office']).toBe('briefcase');
    expect(spaceIcons['Personal Vault']).toBe('user');
    expect(spaceIcons['Misc']).toBe('folder');
  });
});
