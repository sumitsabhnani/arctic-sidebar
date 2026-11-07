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

  it('detects left-side docking from pointer coordinates in real browser and suppresses tip', async () => {
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

    // Mock chrome.windows.getCurrent to simulate Chrome browser window
    chrome.windows.getCurrent = vi.fn((cb?: (win: any) => void) => {
      const win = { id: 1, left: 0, top: 0, width: 1200, height: 800 };
      if (cb) cb(win);
      return Promise.resolve(win) as any;
    }) as any;

    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
      configurable: true
    });

    try {
      render(<App />);

      // Banner should not be rendered initially
      expect(screen.queryByText('Prefer Arctic on the Left?')).not.toBeInTheDocument();

      // Trigger pointermove simulating cursor inside sidepanel on the LEFT (e.screenX=100, e.clientX=20 -> panelLeft=80 < 600)
      await act(async () => {
        window.dispatchEvent(new MouseEvent('pointermove', { screenX: 100, clientX: 20 }));
      });

      expect(screen.queryByText('Prefer Arctic on the Left?')).not.toBeInTheDocument();
      // Verifies it marked dismissed in storage
      expect(mockChrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ hasDismissedLeftSideTip: true })
      );
    } finally {
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true
      });
    }
  });

  it('detects right-side docking from pointer coordinates in real browser and shows tip', async () => {
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

    // Mock chrome.windows.getCurrent to simulate Chrome browser window
    chrome.windows.getCurrent = vi.fn((cb?: (win: any) => void) => {
      const win = { id: 1, left: 0, top: 0, width: 1200, height: 800 };
      if (cb) cb(win);
      return Promise.resolve(win) as any;
    }) as any;

    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
      configurable: true
    });

    try {
      render(<App />);

      // Banner should not be rendered initially
      expect(screen.queryByText('Prefer Arctic on the Left?')).not.toBeInTheDocument();

      // Trigger pointermove simulating cursor inside sidepanel on the RIGHT (e.screenX=1000, e.clientX=20 -> panelLeft=980 >= 600)
      await act(async () => {
        window.dispatchEvent(new MouseEvent('pointermove', { screenX: 1000, clientX: 20 }));
      });

      expect(await screen.findByText('Prefer Arctic on the Left?')).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true
      });
    }
  });

  it('FolderNode right-click context menu offers "New Document" submenu with Google Doc, Sheet, Slides, Notion, and GitHub Gist', () => {
    const onOpenContextMenu = vi.fn();
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
        onCreateGoogleDoc={onCreateGoogleDoc}
      />
    );

    const folderRow = screen.getByText('Project Notes').closest('[role="button"]')!;
    fireEvent.contextMenu(folderRow);

    expect(onOpenContextMenu).toHaveBeenCalled();
    const items = onOpenContextMenu.mock.calls[0][1];

    const newDocMenu = items.find((i: { label: string }) => i.label === 'New Document');
    expect(newDocMenu).toBeDefined();
    expect(newDocMenu.submenu).toHaveLength(5);

    const gdocItem = newDocMenu.submenu.find((i: { label: string }) => i.label === 'Google Doc');
    expect(gdocItem).toBeDefined();
    gdocItem.action();
    expect(onCreateGoogleDoc).toHaveBeenCalledWith('f-1', 'https://docs.new', 'New Google Doc');

    const notionItem = newDocMenu.submenu.find((i: { label: string }) => i.label === 'Notion Page');
    expect(notionItem).toBeDefined();
    notionItem.action();
    expect(onCreateGoogleDoc).toHaveBeenCalledWith('f-1', 'https://notion.new', 'New Notion Page');
  });

  it('FolderNode renders cleanly without item count badge, right chevron, or Archive/Pin hover buttons, keeping only New subfolder on hover and full actions in right-click menu', () => {
    const onOpenContextMenu = vi.fn();
    const onBookmarkCurrentPage = vi.fn();
    const onDiscardTab = vi.fn();

    const mockFolder: chrome.bookmarks.BookmarkTreeNode = {
      id: 'f-clean',
      title: 'Clean Folder',
      children: [
        { id: 'b-1', title: 'Child 1', url: 'https://example.com/1' },
        { id: 'b-2', title: 'Child 2', url: 'https://example.com/2' }
      ]
    };

    const { container } = render(
      <FolderNode
        node={mockFolder}
        collapsedFolderIds={{ 'f-clean': true }}
        onToggleCollapse={vi.fn()}
        bindingsByBookmarkId={{
          'b-1': {
            bookmarkId: 'b-1',
            tabId: 777,
            windowId: 1,
            originalUrl: 'https://example.com/1',
            currentUrl: 'https://example.com/1',
            currentTitle: 'Child 1',
            isNavigatedAway: false
          }
        }}
        activeTabId={null}
        onRowClick={vi.fn()}
        onFaviconClick={vi.fn()}
        onCloseTab={vi.fn()}
        onCreateFolder={vi.fn()}
        onBookmarkCurrentPage={onBookmarkCurrentPage}
        onDiscardTab={onDiscardTab}
        onOpenContextMenu={onOpenContextMenu}
      />
    );

    // No item count badge ("2") or right chevron icon on the folder row
    expect(screen.queryByText('2')).not.toBeInTheDocument();
    expect(container.querySelector('svg.lucide-chevron-right')).not.toBeInTheDocument();

    // No Archive or Pin Current Tab hover buttons on the folder row
    expect(container.querySelector('button[data-tooltip*="Archive"]')).not.toBeInTheDocument();
    expect(container.querySelector('button[data-tooltip="Pin current tab here"]')).not.toBeInTheDocument();

    // Keeps only the subtle New subfolder hover button
    expect(container.querySelector('button[data-tooltip="New subfolder"]')).toBeInTheDocument();

    // Right-click menu still exposes Pin Current Tab Here and Archive All Tabs in Folder
    const folderRow = screen.getByText('Clean Folder').closest('[role="button"]')!;
    fireEvent.contextMenu(folderRow);
    const menuItems = onOpenContextMenu.mock.calls[0][1];
    expect(menuItems.some((i: { label: string }) => i.label === 'Pin Current Tab Here')).toBe(true);
    expect(menuItems.some((i: { label: string }) => i.label.startsWith('Archive All Tabs in Folder'))).toBe(true);
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

  it('renders Google Doc bookmark with proper website favicon img instead of monochrome FileText icon', async () => {
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
                      { id: 'gdoc-1', title: 'Q4 Strategy Doc', url: 'https://docs.google.com/document/d/123/edit' }
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

    const gdocRow = screen.getByText('Q4 Strategy Doc').closest('div[role="button"]')!;

    // Google Doc renders proper website favicon img
    expect(gdocRow.querySelector('svg.lucide-file-text')).not.toBeInTheDocument();
    const faviconImg = gdocRow.querySelector('img');
    expect(faviconImg).toBeInTheDocument();
    expect(faviconImg?.getAttribute('src')).toContain(
      encodeURIComponent('https://docs.google.com/document/d/123/edit')
    );
  });
});
