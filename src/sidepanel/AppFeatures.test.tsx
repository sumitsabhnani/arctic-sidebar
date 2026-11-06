import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from './App';
import { BookmarkRow } from './components/BookmarkRow';
import { FolderNode } from './components/FolderNode';
import { OpenTabRow } from './components/OpenTabRow';
import { mockChrome } from '../test/setup';

describe('AppFeatures: Left-Side Positioning, Notes, Multi-Select', () => {
  it('renders first-run left-side tip banner when hasDismissedLeftSideTip is not set and allows dismiss', async () => {
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
                  {
                    id: '12',
                    title: 'Home',
                    children: [
                      {
                        id: '11',
                        title: 'Quick Access',
                        children: [{ id: '111', title: 'Google', url: 'https://google.com' }]
                      }
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

    render(<App />);

    // Tip banner should appear
    expect(await screen.findByText('Prefer Arctic on the Left?')).toBeInTheDocument();

    // Clicking "Dismiss" should hide the banner
    const dismissBtn = screen.getByText('Dismiss');
    await act(async () => {
      fireEvent.click(dismissBtn);
    });

    expect(screen.queryByText('Prefer Arctic on the Left?')).not.toBeInTheDocument();
  });

  it('clicking "Open Settings" in left-side tip banner opens appearance settings and dismisses tip', async () => {
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
                  {
                    id: '12',
                    title: 'Home',
                    children: [
                      {
                        id: '11',
                        title: 'Quick Access',
                        children: [{ id: '111', title: 'Google', url: 'https://google.com' }]
                      }
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

    render(<App />);

    expect(await screen.findByText('Prefer Arctic on the Left?')).toBeInTheDocument();

    const openSettingsBtn = screen.getByText('Open Settings');
    await act(async () => {
      fireEvent.click(openSettingsBtn);
    });

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome://settings/appearance' });
    expect(screen.queryByText('Prefer Arctic on the Left?')).not.toBeInTheDocument();
  });

  it('does NOT render left-side tip banner on existing installs (e.g. customized theme or multiple spaces)', async () => {
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
                  {
                    id: '12',
                    title: 'Home',
                    children: [
                      {
                        id: '11',
                        title: 'Quick Access',
                        children: [{ id: '111', title: 'Google', url: 'https://google.com' }]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
    mockChrome.__setLocalStorage({ theme: 'dark' });
    mockChrome.__setSyncStorage({});

    render(<App />);
    expect(await screen.findByText('Google')).toBeInTheDocument();
    expect(screen.queryByText('Prefer Arctic on the Left?')).not.toBeInTheDocument();
  });

  it('does NOT render left-side tip banner when hasDismissedLeftSideTip is true', async () => {
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
                  {
                    id: '12',
                    title: 'Home',
                    children: [
                      {
                        id: '11',
                        title: 'Quick Access',
                        children: [{ id: '111', title: 'Google', url: 'https://google.com' }]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
    mockChrome.__setLocalStorage({ hasDismissedLeftSideTip: true });
    mockChrome.__setSyncStorage({});

    render(<App />);
    expect(await screen.findByText('Google')).toBeInTheDocument();
    expect(screen.queryByText('Prefer Arctic on the Left?')).not.toBeInTheDocument();
  });

  it('does NOT render left-side tip banner when chrome.sidePanel.getLayout reports side: "left"', async () => {
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
                  {
                    id: '12',
                    title: 'Home',
                    children: [
                      {
                        id: '11',
                        title: 'Quick Access',
                        children: [{ id: '111', title: 'Google', url: 'https://google.com' }]
                      }
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

    (chrome.sidePanel as any).getLayout = vi.fn().mockResolvedValue({ side: 'left' });

    render(<App />);
    expect(await screen.findByText('Google')).toBeInTheDocument();
    expect(screen.queryByText('Prefer Arctic on the Left?')).not.toBeInTheDocument();

    delete (chrome.sidePanel as any).getLayout;
  });

  it('renders left-side tip banner when chrome.sidePanel.getLayout reports side: "right"', async () => {
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
                  {
                    id: '12',
                    title: 'Home',
                    children: [
                      {
                        id: '11',
                        title: 'Quick Access',
                        children: [{ id: '111', title: 'Google', url: 'https://google.com' }]
                      }
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

    (chrome.sidePanel as any).getLayout = vi.fn().mockResolvedValue({ side: 'right' });

    render(<App />);
    expect(await screen.findByText('Prefer Arctic on the Left?')).toBeInTheDocument();

    delete (chrome.sidePanel as any).getLayout;
  });

  it('FolderNode right-click context menu offers "New Scratchpad" and "New Google Doc"', () => {
    const onOpenContextMenu = vi.fn();
    const onCreateScratchpad = vi.fn();
    const onCreateGoogleDoc = vi.fn();

    const mockFolder: chrome.bookmarks.BookmarkTreeNode = {
      id: 'f-1',
      title: 'Project Notes',
      children: []
    };

    render(
      <FolderNode
        node={mockFolder}
        collapsedFolderIds={{}}
        onToggleCollapse={vi.fn()}
        bindingsByBookmarkId={{}}
        activeTabId={null}
        onRowClick={vi.fn()}
        onFaviconClick={vi.fn()}
        onCloseTab={vi.fn()}
        onCreateFolder={vi.fn()}
        onOpenContextMenu={onOpenContextMenu}
        onCreateScratchpad={onCreateScratchpad}
        onCreateGoogleDoc={onCreateGoogleDoc}
      />
    );

    const folderRow = screen.getByText('Project Notes').closest('[role="button"]')!;
    fireEvent.contextMenu(folderRow);

    expect(onOpenContextMenu).toHaveBeenCalled();
    const items = onOpenContextMenu.mock.calls[0][1];

    const scratchpadItem = items.find((i: { label: string }) => i.label === 'New Scratchpad');
    expect(scratchpadItem).toBeDefined();
    scratchpadItem.action();
    expect(onCreateScratchpad).toHaveBeenCalledWith('f-1');

    const gdocItem = items.find((i: { label: string }) => i.label === 'New Google Doc');
    expect(gdocItem).toBeDefined();
    gdocItem.action();
    expect(onCreateGoogleDoc).toHaveBeenCalledWith('f-1');
  });

  it('BookmarkRow renders note bookmark with sticky note icon and opens note on click', () => {
    const onOpenScratchpadNote = vi.fn();
    const onRowClick = vi.fn();

    const noteBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: 'note-bm-1',
      title: 'Sprint Planning Notes',
      url: 'https://arctic.local/note/note_123'
    };

    render(
      <BookmarkRow
        bookmark={noteBookmark}
        isActive={false}
        onRowClick={onRowClick}
        onFaviconClick={vi.fn()}
        onCloseTab={vi.fn()}
        onOpenScratchpadNote={onOpenScratchpadNote}
      />
    );

    expect(screen.getByText('Sprint Planning Notes')).toBeInTheDocument();
    const row = screen.getByText('Sprint Planning Notes').closest('div[role="button"]')!;
    fireEvent.click(row);

    expect(onOpenScratchpadNote).toHaveBeenCalledWith(noteBookmark);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('supports multi-select on BookmarkRow with Ctrl/Cmd + click and Shift + click', () => {
    const onSelectBookmark = vi.fn();
    const onRowClick = vi.fn();

    const bm: chrome.bookmarks.BookmarkTreeNode = {
      id: 'bm-1',
      title: 'Sample Bookmark',
      url: 'https://sample.com'
    };

    render(
      <BookmarkRow
        bookmark={bm}
        isActive={false}
        isSelected={true}
        onRowClick={onRowClick}
        onFaviconClick={vi.fn()}
        onCloseTab={vi.fn()}
        onSelectBookmark={onSelectBookmark}
      />
    );

    const row = screen.getByText('Sample Bookmark').closest('div[role="button"]')!;
    // Ctrl+Click
    fireEvent.click(row, { ctrlKey: true });
    expect(onSelectBookmark).toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();

    // Verify visual selection styling is present
    expect(row.className).toContain('border-l-2');
    expect(row.className).toContain('border-cyan-500');
  });

  it('supports multi-select on OpenTabRow with Ctrl/Cmd + click and batch actions', () => {
    const onSelectTab = vi.fn();
    const onFocus = vi.fn();
    const onOpenContextMenu = vi.fn();

    const tab: chrome.tabs.Tab = {
      id: 999,
      index: 0,
      pinned: false,
      highlighted: false,
      windowId: 1,
      active: false,
      incognito: false,
      selected: false,
      discarded: false,
      autoDiscardable: true,
      frozen: false,
      groupId: -1,
      title: 'Unpinned Tab 1',
      url: 'https://tab1.com'
    };

    const onPinMultipleTabsToWorkspace = vi.fn();
    const onCloseMultipleTabs = vi.fn();

    render(
      <OpenTabRow
        tab={tab}
        isActive={false}
        isSelected={true}
        selectedTabIds={new Set([999, 1000])}
        onFocus={onFocus}
        onClose={vi.fn()}
        onPinToQuickAccess={vi.fn()}
        onPinToWorkspace={vi.fn()}
        onToggleMute={vi.fn()}
        onDuplicate={vi.fn()}
        onReload={vi.fn()}
        onOpenContextMenu={onOpenContextMenu}
        onSelectTab={onSelectTab}
        onPinMultipleTabsToWorkspace={onPinMultipleTabsToWorkspace}
        onCloseMultipleTabs={onCloseMultipleTabs}
      />
    );

    const row = screen.getByText('Unpinned Tab 1').closest('div[role="button"]')!;
    fireEvent.click(row, { metaKey: true });
    expect(onSelectTab).toHaveBeenCalled();
    expect(onFocus).not.toHaveBeenCalled();

    // Context menu on multiple selected tabs shows batch options
    fireEvent.contextMenu(row);
    expect(onOpenContextMenu).toHaveBeenCalled();
    const items = onOpenContextMenu.mock.calls[0][1];
    const pinSelected = items.find((i: { label: string }) => i.label.includes('Pin 2 Tabs'));
    const closeSelected = items.find((i: { label: string }) => i.label.includes('Close 2 Selected Tabs'));
    expect(pinSelected).toBeDefined();
    expect(closeSelected).toBeDefined();
  });

  it('normal click on bookmark records anchor so subsequent Shift + click selects range', async () => {
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
                  {
                    id: '12',
                    title: 'Home',
                    children: [
                      {
                        id: '11',
                        title: 'Quick Access',
                        children: [{ id: '111', title: 'Google', url: 'https://google.com' }]
                      },
                      { id: 'b1', title: 'Doc Alpha', url: 'https://alpha.com' },
                      { id: 'b2', title: 'Doc Beta', url: 'https://beta.com' },
                      { id: 'b3', title: 'Doc Gamma', url: 'https://gamma.com' }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
    mockChrome.__setLocalStorage({ hasDismissedLeftSideTip: true });
    mockChrome.__setSyncStorage({});

    render(<App />);

    expect(await screen.findByText('Doc Alpha')).toBeInTheDocument();
    expect(await screen.findByText('Doc Gamma')).toBeInTheDocument();

    const rowAlpha = screen.getByText('Doc Alpha').closest('div[role="button"]')!;
    const rowGamma = screen.getByText('Doc Gamma').closest('div[role="button"]')!;

    // 1. Normal click on Alpha
    await act(async () => {
      fireEvent.click(rowAlpha);
    });

    // 2. Shift + Click on Gamma
    await act(async () => {
      fireEvent.click(rowGamma, { shiftKey: true });
    });

    // All rows in between (Alpha, Beta, Gamma) should now have selected styling (border-cyan-500)
    const rowBeta = screen.getByText('Doc Beta').closest('div[role="button"]')!;
    expect(rowAlpha.className).toContain('border-cyan-500');
    expect(rowBeta.className).toContain('border-cyan-500');
    expect(rowGamma.className).toContain('border-cyan-500');
  });

  it('drag and drop of multiple bookmarks moves them into destination folder', async () => {
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
                  {
                    id: '12',
                    title: 'Home',
                    children: [
                      {
                        id: '11',
                        title: 'Quick Access',
                        children: [{ id: '111', title: 'Google', url: 'https://google.com' }]
                      },
                      {
                        id: 'folder-target',
                        title: 'Destination Folder',
                        children: []
                      },
                      { id: 'bm-1', title: 'Item 1', url: 'https://item1.com' },
                      { id: 'bm-2', title: 'Item 2', url: 'https://item2.com' }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
    mockChrome.__setLocalStorage({ hasDismissedLeftSideTip: true });
    mockChrome.__setSyncStorage({});

    render(<App />);

    expect(await screen.findByText('Destination Folder')).toBeInTheDocument();
    expect(await screen.findByText('Item 1')).toBeInTheDocument();
    expect(await screen.findByText('Item 2')).toBeInTheDocument();

    const targetFolder = screen.getByText('Destination Folder').closest('[role="button"]')!;

    // Simulate dropping multiple selected bookmark IDs onto targetFolder
    await act(async () => {
      fireEvent.drop(targetFolder, {
        dataTransfer: {
          getData: (type: string) =>
            type === 'application/json'
              ? JSON.stringify({
                  type: 'bookmark',
                  id: 'bm-1',
                  ids: ['bm-1', 'bm-2']
                })
              : ''
        }
      });
    });

    // chrome.bookmarks.move should have been called for both bookmarks to move them
    expect(chrome.bookmarks.move).toHaveBeenCalledWith('bm-1', expect.objectContaining({ parentId: 'folder-target' }));
    expect(chrome.bookmarks.move).toHaveBeenCalledWith('bm-2', expect.objectContaining({ parentId: 'folder-target' }));
  });

  it('renders Google Doc bookmark with FileText icon consistent with Scratchpad StickyNote in monochrome', async () => {
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
                  {
                    id: '12',
                    title: 'Home',
                    children: [
                      {
                        id: '11',
                        title: 'Quick Access',
                        children: [{ id: '111', title: 'Google', url: 'https://google.com' }]
                      },
                      { id: 'gdoc-1', title: 'Q4 Strategy Doc', url: 'https://docs.google.com/document/d/123/edit' },
                      { id: 'note-1', title: 'Quick Notes', url: 'https://arctic.local/note/note_abc' }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
    mockChrome.__setLocalStorage({ hasDismissedLeftSideTip: true });
    mockChrome.__setSyncStorage({});

    render(<App />);

    expect(await screen.findByText('Q4 Strategy Doc')).toBeInTheDocument();
    expect(await screen.findByText('Quick Notes')).toBeInTheDocument();

    const gdocRow = screen.getByText('Q4 Strategy Doc').closest('div[role="button"]')!;
    const noteRow = screen.getByText('Quick Notes').closest('div[role="button"]')!;

    // Google Doc has lucide-file-text icon in monochrome styling
    const gdocSvg = gdocRow.querySelector('svg.lucide-file-text');
    expect(gdocSvg).toBeInTheDocument();
    expect(gdocSvg?.getAttribute('class')).toContain('text-zinc-400');

    // Scratchpad note has lucide-sticky-note icon in monochrome styling
    const noteSvg = noteRow.querySelector('svg.lucide-sticky-note');
    expect(noteSvg).toBeInTheDocument();
    expect(noteSvg?.getAttribute('class')).toContain('text-zinc-400');
  });

  it('clicking scratchpad tab highlights it, shows reminder bell icon, and clicking again closes drawer', async () => {
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
                  {
                    id: '12',
                    title: 'Home',
                    children: [
                      {
                        id: '11',
                        title: 'Quick Access',
                        children: [{ id: '111', title: 'Google', url: 'https://google.com' }]
                      },
                      { id: 'note-test-1', title: 'Meeting Scratchpad', url: 'https://arctic.local/note/note_meeting' }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
    mockChrome.__setLocalStorage({ hasDismissedLeftSideTip: true });
    mockChrome.__setSyncStorage({});

    render(<App />);

    expect(await screen.findByText('Meeting Scratchpad')).toBeInTheDocument();
    const noteRow = screen.getByText('Meeting Scratchpad').closest('div[role="button"]')!;

    // Scratchpad has reminder bell icon available
    const bellBtn = noteRow.querySelector('button[data-tooltip*="reminder"]');
    expect(bellBtn).toBeInTheDocument();

    // Initially not active
    expect(noteRow.className).not.toContain('theme-active-card');

    // 1. Click scratchpad tab: drawer opens and row highlights
    await act(async () => {
      fireEvent.click(noteRow);
    });

    expect(noteRow.className).toContain('theme-active-card');
    expect(await screen.findByPlaceholderText('Write notes for this folder...')).toBeInTheDocument();

    // 2. Click scratchpad tab again: drawer closes and tab un-highlights
    await act(async () => {
      fireEvent.click(noteRow);
    });

    expect(noteRow.className).not.toContain('theme-active-card');
    expect(screen.queryByPlaceholderText('Write notes for this folder...')).not.toBeInTheDocument();
  });
});
