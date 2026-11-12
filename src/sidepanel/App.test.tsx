import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { App } from './App';
import { mockChrome } from '../test/setup';

describe('Sidepanel App Integration', () => {
  it('renders sidepanel without Quick Access appearing as a folder in the active space tree, and displays spaces in the switcher', async () => {
    // Seed bookmarks with Arctic > Home > Quick Access (Gmail) and Sheets
    // and Arctic > Learning > Quick Access (Docs)
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
                        children: [{ id: '111', title: 'Gmail', url: 'https://mail.google.com' }]
                      },
                      {
                        id: '13',
                        title: 'Sheets',
                        children: [{ id: '131', title: 'Spreadsheet', url: 'https://sheets.google.com' }]
                      }
                    ]
                  },
                  {
                    id: '20',
                    title: 'Learning',
                    children: [
                      {
                        id: '21',
                        title: 'Quick Access',
                        children: [{ id: '211', title: 'Coursera', url: 'https://coursera.org' }]
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

    // Wait for bookmarks & spaces to load into DOM
    expect(await screen.findByText('Gmail')).toBeInTheDocument();
    expect(await screen.findByText('Sheets')).toBeInTheDocument();

    // 3. "Quick Access" must NOT be rendered as a regular folder node in the vertical tree
    const allQuickAccessElements = screen.queryAllByText('Quick Access');
    expect(allQuickAccessElements.length).toBe(0);

    // 4. The spaces switcher at the bottom should show both Home and Learning
    expect(await screen.findByTitle(/^Home Space/i)).toBeInTheDocument();
    expect(await screen.findByTitle(/^Learning Space/i)).toBeInTheDocument();
    expect(screen.getAllByText('Home').length).toBeGreaterThanOrEqual(2); // Header title + space dock button
  });

  it('switches space when clicking on another space in the switcher and updates Quick Access and bookmarks', async () => {
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
                        children: [{ id: '111', title: 'Gmail', url: 'https://mail.google.com' }]
                      }
                    ]
                  },
                  {
                    id: '20',
                    title: 'Learning',
                    children: [
                      {
                        id: '21',
                        title: 'Quick Access',
                        children: [{ id: '211', title: 'Coursera', url: 'https://coursera.org' }]
                      },
                      {
                        id: '22',
                        title: 'React Docs',
                        url: 'https://react.dev'
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

    const { fireEvent } = await import('@testing-library/react');
    render(<App />);

    // Wait for initial load
    expect(await screen.findByText('Gmail')).toBeInTheDocument();
    expect(screen.queryByText('Coursera')).not.toBeInTheDocument();

    // Click on "Learning" space in switcher
    const learningSpaceBtn = await screen.findByTitle(/^Learning Space/i);
    await act(async () => {
      fireEvent.click(learningSpaceBtn);
    });

    // Now in Learning space: Coursera is in Quick Access, React Docs is in tree
    expect(await screen.findByText('Coursera')).toBeInTheDocument();
    expect(await screen.findByText('React Docs')).toBeInTheDocument();
    expect(screen.queryByText('Gmail')).not.toBeInTheDocument();

    // Quick Access should still NOT appear as a folder in the vertical tree
    expect(screen.queryAllByText('Quick Access').length).toBe(0);
  });

  it('automatically opens SettingsModal when openArcticSettings is triggered from Command Bar', async () => {
    mockChrome.__setLocalStorage({ openArcticSettings: Date.now() });
    mockChrome.__setSyncStorage({});

    render(<App />);

    expect(await screen.findByText('Settings & Appearance')).toBeInTheDocument();
    // Flag is cleared after opening
    expect(mockChrome.__getLocalStorage().openArcticSettings).toBeUndefined();
  });

  it("displays Clear button in Today's Tabs when there are no temporary tabs but active space tabs are open", async () => {
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
                        id: '131',
                        title: 'Example Bookmark',
                        url: 'https://example.com'
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
    // Tab 1 (https://example.com) is bound to bookmark '131' in active space, so 0 temporary unpinned tabs exist
    mockChrome.__setSessionStorage({
      bindingsByBookmarkId: {
        '131': {
          bookmarkId: '131',
          tabId: 1,
          windowId: 10,
          originalUrl: 'https://example.com',
          currentUrl: 'https://example.com',
          currentTitle: 'Example Domain',
          isNavigatedAway: false
        }
      },
      bookmarkIdByTabId: {
        1: '131'
      }
    });
    mockChrome.__setLocalStorage({ hasDismissedLeftSideTip: true });
    mockChrome.__setSyncStorage({});

    render(<App />);

    expect(await screen.findByText('Example Bookmark')).toBeInTheDocument();
    expect(screen.getByText('No unpinned tabs open.')).toBeInTheDocument();

    // Clear button and Clear options must still be visible in Today's Tabs header
    expect(screen.getByTitle("Close temporary Today's tabs")).toBeInTheDocument();
    expect(screen.getByTitle('Clear options')).toBeInTheDocument();
  });

  it('filters out Scratchpad Backup bookmarks from Quick Access and workspace bookmark tree', async () => {
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
                        children: [
                          { id: '111', title: 'Gmail', url: 'https://mail.google.com' },
                          {
                            id: '112',
                            title: 'Scratchpad Backup',
                            url: 'https://arctic.local/scratchpad#secret'
                          }
                        ]
                      },
                      {
                        id: '131',
                        title: 'Example Bookmark',
                        url: 'https://example.com'
                      },
                      {
                        id: '132',
                        title: 'Scratchpad Backup',
                        url: 'https://arctic.local/scratchpad#secret'
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

    expect(await screen.findByText('Gmail')).toBeInTheDocument();
    expect(await screen.findByText('Example Bookmark')).toBeInTheDocument();
    expect(screen.queryByText('Scratchpad Backup')).not.toBeInTheDocument();
  });

  it("reconciles sleeping and open tabs across ALL Spaces on startup so non-active Space bookmark tabs do not leak into Home Today's Tabs", async () => {
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
                        children: [{ id: '111', title: 'Gmail', url: 'https://gmail.com' }]
                      }
                    ]
                  },
                  {
                    id: '20',
                    title: 'Work',
                    children: [
                      {
                        id: '21',
                        title: 'Quick Access',
                        children: [{ id: '211', title: 'Linear Board', url: 'https://linear.app' }]
                      },
                      {
                        id: '22',
                        title: 'Datadog Dashboard',
                        url: 'https://app.datadoghq.com/dashboard/123'
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

    // Simulate browser restart / reinstall: session storage is wiped, Home is active,
    // and tabs for both Home (redirected Gmail) and Work (sleeping Linear + Datadog) are open
    mockChrome.__setSessionStorage({});
    mockChrome.__setLocalStorage({ hasDismissedLeftSideTip: true });
    mockChrome.__setSyncStorage({});
    mockChrome.__setTabs([
      {
        id: 1,
        windowId: 10,
        url: 'https://mail.google.com/mail/u/0/#inbox',
        title: 'Inbox - Gmail',
        active: true,
        discarded: false
      } as chrome.tabs.Tab,
      {
        id: 2,
        windowId: 10,
        url: 'https://linear.app',
        title: 'Linear Workspace',
        active: false,
        discarded: true
      } as chrome.tabs.Tab,
      {
        id: 3,
        windowId: 10,
        url: '',
        pendingUrl: 'https://app.datadoghq.com/dashboard/123',
        title: 'Datadog Dashboard',
        active: false,
        discarded: true
      } as chrome.tabs.Tab
    ]);

    render(<App />);

    expect(await screen.findByText('Gmail')).toBeInTheDocument();

    // Wait for startup reconciliation across all spaces to complete
    await screen.findByText('No unpinned tabs open.');

    // Neither Linear Workspace nor Datadog Dashboard leaked into Home's Today's Tabs
    expect(screen.queryByText('Linear Workspace')).not.toBeInTheDocument();
    expect(screen.queryByText('Datadog Dashboard')).not.toBeInTheDocument();

    const session = mockChrome.__getSessionStorage();
    expect((session.bookmarkIdByTabId as Record<number, string>)[1]).toBe('111');
    expect((session.bookmarkIdByTabId as Record<number, string>)[2]).toBe('211');
    expect((session.bookmarkIdByTabId as Record<number, string>)[3]).toBe('22');
  });

  it('persists new tab bindings into persistedBindingsByBookmarkId when pinning current tab or creating a Google Doc', async () => {
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
                      { id: '11', title: 'Quick Access', children: [] },
                      { id: '13', title: 'Docs Folder', children: [] }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
    mockChrome.__setSessionStorage({});
    mockChrome.__setLocalStorage({ hasDismissedLeftSideTip: true });
    mockChrome.__setSyncStorage({});
    mockChrome.__setTabs([
      {
        id: 1,
        windowId: 10,
        url: 'https://developer.mozilla.org/en-US/docs/Web',
        title: 'MDN Web Docs',
        active: true
      } as chrome.tabs.Tab
    ]);

    const { fireEvent } = await import('@testing-library/react');
    render(<App />);

    const folderRow = await screen.findByText('Docs Folder');

    // 1. Right-click "Docs Folder" -> click "Pin Current Tab Here"
    await act(async () => {
      fireEvent.contextMenu(folderRow);
    });
    const pinHereItem = await screen.findByText('Pin Current Tab Here');
    await act(async () => {
      fireEvent.click(pinHereItem);
    });

    let persisted = (mockChrome.__getLocalStorage().persistedBindingsByBookmarkId ||
      {}) as Record<string, { currentUrl: string; originalUrl: string }>;
    expect(
      Object.values(persisted).some(
        (b) => b.currentUrl === 'https://developer.mozilla.org/en-US/docs/Web'
      )
    ).toBe(true);

    // 2. Right-click "Docs Folder" -> click "New Document" -> click "Google Doc"
    await act(async () => {
      fireEvent.contextMenu(folderRow);
    });
    const newDocTrigger = await screen.findByText('New Document');
    await act(async () => {
      fireEvent.click(newDocTrigger);
    });
    const gdocOption = await screen.findByText('Google Doc');
    await act(async () => {
      fireEvent.click(gdocOption);
    });

    persisted = (mockChrome.__getLocalStorage().persistedBindingsByBookmarkId ||
      {}) as Record<string, { currentUrl: string; originalUrl: string }>;
    expect(Object.values(persisted).some((b) => b.originalUrl === 'https://docs.new')).toBe(true);
  });

  it('prompts on first Hide sidebar click, requests optional host permission, enables edge trigger, and closes panel', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});

    mockChrome.__setLocalStorage({});
    mockChrome.__setHostPermissionsGranted(false);

    render(<App />);

    const hideBtn = await screen.findByLabelText('Hide sidebar');
    await act(async () => {
      fireEvent.click(hideBtn);
    });

    // Confirmation prompt appears explaining why edge trigger needs permission
    expect(await screen.findByText('Hide to Screen Edge?')).toBeInTheDocument();

    const enableBtn = screen.getByRole('button', { name: /Enable Edge Trigger & Hide/i });
    await act(async () => {
      fireEvent.click(enableBtn);
    });

    expect(chrome.permissions.request).toHaveBeenCalledWith({
      origins: ['http://*/*', 'https://*/*']
    });
    expect(mockChrome.__getLocalStorage().edgeTriggerEnabled).toBe(true);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PREPARE_HIDE_SIDEBAR',
        injectIntoOpenTabs: true
      })
    );
    expect(closeSpy).toHaveBeenCalled();

    closeSpy.mockRestore();
  });

  it('closes sidebar immediately on Hide sidebar click when edgeTriggerEnabled and permission are already active', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});

    mockChrome.__setLocalStorage({ edgeTriggerEnabled: true });
    mockChrome.__setHostPermissionsGranted(true);

    render(<App />);

    // Flush initial permission contains check
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

    const hideBtn = await screen.findByLabelText('Hide sidebar');
    await act(async () => {
      fireEvent.click(hideBtn);
    });

    expect(screen.queryByText('Hide to Screen Edge?')).not.toBeInTheDocument();
    expect(closeSpy).toHaveBeenCalledTimes(1);

    closeSpy.mockRestore();
  });

  it('allows closing sidebar without enabling edge trigger ("Just Close Sidebar") and persists edgeTriggerMode changes in Settings', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});

    mockChrome.__setLocalStorage({});
    mockChrome.__setHostPermissionsGranted(false);

    render(<App />);

    // Click Hide sidebar -> choose "Just Close Sidebar"
    const hideBtn = await screen.findByLabelText('Hide sidebar');
    await act(async () => {
      fireEvent.click(hideBtn);
    });
    const justCloseBtn = await screen.findByRole('button', { name: /Just Close Sidebar/i });
    await act(async () => {
      fireEvent.click(justCloseBtn);
    });

    expect(chrome.permissions.request).not.toHaveBeenCalled();
    expect(mockChrome.__getLocalStorage().edgeTriggerEnabled).toBeUndefined();
    expect(closeSpy).toHaveBeenCalledTimes(1);

    // Enable edge trigger via Settings and switch behavior to Auto-Hide on Hover
    const settingsBtn = screen.getByTitle('Settings & Appearance');
    await act(async () => {
      fireEvent.click(settingsBtn);
    });

    const edgeSwitch = await screen.findByRole('switch', { name: 'Edge Trigger When Hidden' });
    await act(async () => {
      fireEvent.click(edgeSwitch);
    });

    const hoverModeBtn = await screen.findByRole('button', { name: 'Auto-Hide on Hover' });
    await act(async () => {
      fireEvent.click(hoverModeBtn);
    });

    expect(mockChrome.__getLocalStorage().edgeTriggerEnabled).toBe(true);
    expect(mockChrome.__getLocalStorage().edgeTriggerMode).toBe('hover');

    closeSpy.mockRestore();
  });
});
