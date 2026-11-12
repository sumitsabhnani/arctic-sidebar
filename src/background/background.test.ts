import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TabReminder } from '../types';
import { REMINDERS_STORAGE_KEY } from '../sidepanel/utils/reminderStorage';
import {
  handleAlarmTrigger,
  handleInstalled,
  handleNotificationOpenTab,
  handleNotificationDismiss,
  handleStartup,
  handleTabActivated,
  handleTabCreated,
  handleTabRemoved,
  handleTabReplaced,
  handleTabUpdated,
  reconcileReminders,
  handleRuntimeMessage,
  handleSidePanelPortConnect,
  syncEdgeTriggerContentScript,
  getEdgeRailDataForWindow,
  EDGE_TRIGGER_SCRIPT_ID,
  EDGE_TRIGGER_ORIGINS
} from './index';
import { mockChrome } from '../test/setup';

describe('Background service worker reminder lifecycle', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it('handles alarm trigger: marks reminder fired, shows notification, updates badge', async () => {
    const reminder: TabReminder = {
      id: 'rem_abc123',
      targetType: 'tab',
      tabId: 1,
      url: 'https://example.com',
      title: 'Example Page',
      note: 'Time to check analytics',
      triggerAt: Date.now() - 100,
      status: 'scheduled',
      createdAt: Date.now() - 1000
    };

    // Seed storage with reminder
    await chrome.storage.sync.set({
      [REMINDERS_STORAGE_KEY]: [reminder]
    });

    // Trigger alarm handler
    await handleAlarmTrigger({
      name: 'reminder:rem_abc123',
      scheduledTime: reminder.triggerAt
    });

    // Verify storage updated to fired
    const stored = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY);
    const list = stored[REMINDERS_STORAGE_KEY] as TabReminder[];
    expect(list[0].status).toBe('fired');

    // Verify native notification created
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      'notif:rem_abc123',
      expect.objectContaining({
        title: 'Reminder: Example Page',
        message: 'Time to check analytics',
        priority: 2,
        requireInteraction: true
      })
    );

    // Verify extension badge updated to 1 with red color
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '1' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#EF4444' });
  });

  it('handles multiple alarms set for the same time: marks all fired, creates notifications, updates badge', async () => {
    const triggerTime = Date.now() - 50;
    const reminder1: TabReminder = {
      id: 'rem_multi_1',
      targetType: 'tab',
      tabId: 10,
      url: 'https://example.com/1',
      title: 'Page 1',
      note: 'Note 1',
      triggerAt: triggerTime,
      status: 'scheduled',
      createdAt: Date.now() - 1000
    };
    const reminder2: TabReminder = {
      id: 'rem_multi_2',
      targetType: 'tab',
      tabId: 11,
      url: 'https://example.com/2',
      title: 'Page 2',
      note: 'Note 2',
      triggerAt: triggerTime,
      status: 'scheduled',
      createdAt: Date.now() - 1000
    };

    await chrome.storage.sync.set({
      [REMINDERS_STORAGE_KEY]: [reminder1, reminder2]
    });

    // Simulate concurrent alarm triggers for the same timestamp
    await Promise.all([
      handleAlarmTrigger({ name: 'reminder:rem_multi_1', scheduledTime: triggerTime }),
      handleAlarmTrigger({ name: 'reminder:rem_multi_2', scheduledTime: triggerTime })
    ]);

    const stored = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY);
    const list = stored[REMINDERS_STORAGE_KEY] as TabReminder[];

    // BOTH reminders must be marked 'fired'
    expect(list.length).toBe(2);
    expect(list[0].status).toBe('fired');
    expect(list[1].status).toBe('fired');

    // Notifications dispatched for both
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      'notif:rem_multi_1',
      expect.objectContaining({ title: 'Reminder: Page 1' })
    );
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      'notif:rem_multi_2',
      expect.objectContaining({ title: 'Reminder: Page 2' })
    );

    // Badge updated to 2
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '2' });
  });

  it('handles notification Dismiss button click: removes reminder and clears notification', async () => {
    const reminder: TabReminder = {
      id: 'rem_dismiss_me',
      targetType: 'bookmark',
      bookmarkId: 'bm_1',
      url: 'https://example.com',
      title: 'Example',
      note: 'Dismiss me',
      triggerAt: Date.now() - 100,
      status: 'fired',
      createdAt: Date.now() - 1000
    };

    await chrome.storage.sync.set({
      [REMINDERS_STORAGE_KEY]: [reminder]
    });

    await handleNotificationDismiss('rem_dismiss_me');

    expect(chrome.notifications.clear).toHaveBeenCalledWith('notif:rem_dismiss_me');

    const stored = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY);
    const list = stored[REMINDERS_STORAGE_KEY] as TabReminder[];
    expect(list.length).toBe(0);
  });

  it('handles notification Open Tab button click: focuses matching tab and dismisses reminder', async () => {
    const reminder: TabReminder = {
      id: 'rem_open_tab',
      targetType: 'tab',
      tabId: 1,
      url: 'https://example.com',
      title: 'Example Domain',
      note: 'Open tab',
      triggerAt: Date.now() - 100,
      status: 'fired',
      createdAt: Date.now() - 1000
    };

    await chrome.storage.sync.set({
      [REMINDERS_STORAGE_KEY]: [reminder]
    });

    await handleNotificationOpenTab('rem_open_tab');

    // Tab 1 should be updated to active: true
    expect(chrome.tabs.update).toHaveBeenCalledWith(1, { active: true });
    expect(chrome.notifications.clear).toHaveBeenCalledWith('notif:rem_open_tab');

    const stored = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY);
    const list = stored[REMINDERS_STORAGE_KEY] as TabReminder[];
    expect(list.length).toBe(0);
  });

  it('startup reconciliation fires overdue reminders and schedules future alarms', async () => {
    const pastReminder: TabReminder = {
      id: 'rem_past',
      targetType: 'bookmark',
      bookmarkId: 'bm_past',
      url: 'https://example.com/past',
      title: 'Past Reminder',
      note: 'Overdue already',
      triggerAt: Date.now() - 5000,
      status: 'scheduled',
      createdAt: Date.now() - 10000
    };

    const futureReminder: TabReminder = {
      id: 'rem_future',
      targetType: 'bookmark',
      bookmarkId: 'bm_future',
      url: 'https://example.com/future',
      title: 'Future Reminder',
      note: 'Coming up later',
      triggerAt: Date.now() + 60000,
      status: 'scheduled',
      createdAt: Date.now()
    };

    await chrome.storage.sync.set({
      [REMINDERS_STORAGE_KEY]: [pastReminder, futureReminder]
    });

    await reconcileReminders();

    // Past reminder was fired and notified
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      'notif:rem_past',
      expect.objectContaining({ title: 'Reminder: Past Reminder' })
    );

    // Future reminder alarm was scheduled
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'reminder:rem_future',
      expect.objectContaining({ when: futureReminder.triggerAt })
    );
  });

  it('reconciles scratchpad backup bookmark into storage on install and startup', async () => {
    const preservedNote = 'Scratchpad preserved across extension reinstall';
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
                    id: 'bm-scratch',
                    title: 'Scratchpad Backup',
                    url: `https://arctic.local/scratchpad#${encodeURIComponent(preservedNote)}`
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

    await handleInstalled();

    expect(
      (mockChrome.__getLocalStorage().scratchpad_local_draft as { text?: string })?.text
    ).toBe(preservedNote);
    expect(mockChrome.__getSyncStorage().scratchpad_chunk_0).toBe(preservedNote);

    // Clear local storage and verify handleStartup also reconciles
    mockChrome.__setLocalStorage({});
    await handleStartup();
    expect(
      (mockChrome.__getLocalStorage().scratchpad_local_draft as { text?: string })?.text
    ).toBe(preservedNote);
  });

  it('closes inactive empty Arctic Command tabs on tab activation and repeated Cmd+T tab creation', async () => {
    mockChrome.__setTabs([
      {
        id: 1,
        windowId: 10,
        url: 'https://github.com',
        title: 'GitHub',
        active: false
      } as chrome.tabs.Tab,
      {
        id: 2,
        windowId: 10,
        url: 'chrome-extension://mock-extension-id/command.html',
        title: 'Arctic Command',
        active: false
      } as chrome.tabs.Tab,
      {
        id: 3,
        windowId: 10,
        url: 'chrome-extension://mock-extension-id/command.html',
        title: 'Arctic Command',
        active: true
      } as chrome.tabs.Tab
    ]);

    // When tab 3 is created as active (e.g. pressing Cmd+T again), inactive tab 2 is closed
    await handleTabCreated({
      id: 3,
      windowId: 10,
      url: 'chrome-extension://mock-extension-id/command.html',
      title: 'Arctic Command',
      active: true
    } as chrome.tabs.Tab);

    expect(mockChrome.__getTabs().map((t) => t.id)).toEqual([1, 3]);

    // When focus switches to tab 1, tab 3 becomes inactive and is closed
    await mockChrome.tabs.update(1, { active: true });
    await handleTabActivated({ tabId: 1, windowId: 10 });

    expect(mockChrome.__getTabs().map((t) => t.id)).toEqual([1]);
  });

  it('reconciles open and sleeping tabs across all Spaces into session storage on handleInstalled and handleStartup', async () => {
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
                        children: [{ id: 'bm-gmail', title: 'Gmail', url: 'https://gmail.com' }]
                      }
                    ]
                  },
                  {
                    id: '20',
                    title: 'Work',
                    children: [
                      {
                        id: 'bm-linear',
                        title: 'Linear',
                        url: 'https://linear.app/team/inbox'
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

    mockChrome.__setTabs([
      {
        id: 41,
        windowId: 10,
        url: 'https://mail.google.com/mail/u/0/#inbox',
        title: 'Inbox - Gmail',
        active: true,
        discarded: false
      } as chrome.tabs.Tab,
      {
        id: 42,
        windowId: 10,
        url: '',
        pendingUrl: 'https://linear.app/team/inbox',
        title: 'Linear',
        active: false,
        discarded: true
      } as chrome.tabs.Tab
    ]);
    mockChrome.__setSessionStorage({});

    await handleInstalled();

    let session = mockChrome.__getSessionStorage();
    expect((session.bookmarkIdByTabId as Record<number, string>)[41]).toBe('bm-gmail');
    expect((session.bookmarkIdByTabId as Record<number, string>)[42]).toBe('bm-linear');

    // Wipe session storage to simulate browser restart and verify handleStartup also restores bindings
    mockChrome.__setSessionStorage({});
    await handleStartup();

    session = mockChrome.__getSessionStorage();
    expect((session.bookmarkIdByTabId as Record<number, string>)[41]).toBe('bm-gmail');
    expect((session.bookmarkIdByTabId as Record<number, string>)[42]).toBe('bm-linear');
  });

  it('serializes concurrent handleTabReplaced events without losing bindings', async () => {
    mockChrome.__setSessionStorage({
      bindingsByBookmarkId: {
        'bm-1': {
          bookmarkId: 'bm-1',
          tabId: 10,
          windowId: 10,
          originalUrl: 'https://a.com',
          currentUrl: 'https://a.com',
          currentTitle: 'A',
          isNavigatedAway: false
        },
        'bm-2': {
          bookmarkId: 'bm-2',
          tabId: 20,
          windowId: 10,
          originalUrl: 'https://b.com',
          currentUrl: 'https://b.com',
          currentTitle: 'B',
          isNavigatedAway: false
        }
      },
      bookmarkIdByTabId: {
        10: 'bm-1',
        20: 'bm-2'
      }
    });

    await Promise.all([handleTabReplaced(110, 10), handleTabReplaced(120, 20)]);

    const session = mockChrome.__getSessionStorage();
    expect(session.bookmarkIdByTabId).toEqual({
      110: 'bm-1',
      120: 'bm-2'
    });
    expect((session.bindingsByBookmarkId as Record<string, any>)['bm-1'].tabId).toBe(110);
    expect((session.bindingsByBookmarkId as Record<string, any>)['bm-2'].tabId).toBe(120);
  });

  it('handleTabReplaced migrates tabSpaceByTabId and tabOpenedAt in chrome.storage.local', async () => {
    mockChrome.__setSessionStorage({});
    mockChrome.__setLocalStorage({
      tabSpaceByTabId: { 50: 'space-work', 51: 'home' },
      tabOpenedAt: { 50: 123456789, 51: 987654321 }
    });

    await handleTabReplaced(500, 50);

    const local = mockChrome.__getLocalStorage();
    expect(local.tabSpaceByTabId).toEqual({ 500: 'space-work', 51: 'home' });
    expect(local.tabOpenedAt).toEqual({ 500: 123456789, 51: 987654321 });
  });

  it('handleTabRemoved preserves persistedBindingsByBookmarkId when isWindowClosing is true and deletes it when false', async () => {
    mockChrome.__setSessionStorage({
      bindingsByBookmarkId: {
        'bm-gh': {
          bookmarkId: 'bm-gh',
          tabId: 77,
          windowId: 10,
          originalUrl: 'https://github.com',
          currentUrl: 'https://github.com/pulls',
          currentTitle: 'Pull Requests',
          isNavigatedAway: true
        }
      },
      bookmarkIdByTabId: { 77: 'bm-gh' }
    });
    mockChrome.__setLocalStorage({
      persistedBindingsByBookmarkId: {
        'bm-gh': {
          bookmarkId: 'bm-gh',
          originalUrl: 'https://github.com',
          currentUrl: 'https://github.com/pulls',
          currentTitle: 'Pull Requests',
          isNavigatedAway: true,
          updatedAt: 100
        }
      }
    });

    // Browser quit (isWindowClosing: true) clears session binding but preserves persistedBindingsByBookmarkId
    await handleTabRemoved(77, { windowId: 10, isWindowClosing: true });
    expect(mockChrome.__getSessionStorage().bookmarkIdByTabId).toEqual({});
    expect(
      (mockChrome.__getLocalStorage().persistedBindingsByBookmarkId as Record<string, any>)?.[
        'bm-gh'
      ]
    ).toBeDefined();

    // Re-seed session binding and close tab normally (isWindowClosing: false) -> deletes persisted binding
    mockChrome.__setSessionStorage({
      bindingsByBookmarkId: {
        'bm-gh': {
          bookmarkId: 'bm-gh',
          tabId: 88,
          windowId: 10,
          originalUrl: 'https://github.com',
          currentUrl: 'https://github.com/pulls',
          currentTitle: 'Pull Requests',
          isNavigatedAway: true
        }
      },
      bookmarkIdByTabId: { 88: 'bm-gh' }
    });

    await handleTabRemoved(88, { windowId: 10, isWindowClosing: false });
    expect(
      (mockChrome.__getLocalStorage().persistedBindingsByBookmarkId as Record<string, any>)?.[
        'bm-gh'
      ]
    ).toBeUndefined();
  });

  it('handleTabUpdated syncs navigated-away URL and persistedBindingsByBookmarkId, and handleTabCreated/handleTabUpdated reconcile late-restored sleeping tabs', async () => {
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
                      { id: 'bm-gh', title: 'GitHub', url: 'https://github.com' },
                      { id: 'bm-figma', title: 'Figma', url: 'https://figma.com/file/1' },
                      { id: 'bm-notion', title: 'Notion', url: 'https://notion.so/doc' }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);

    mockChrome.__setTabs([
      {
        id: 1,
        windowId: 10,
        url: 'https://github.com/issues',
        title: 'Issues',
        active: true
      } as chrome.tabs.Tab,
      {
        id: 2,
        windowId: 10,
        url: '',
        pendingUrl: 'https://figma.com/file/1',
        title: 'Figma',
        discarded: true,
        active: false
      } as chrome.tabs.Tab,
      {
        id: 3,
        windowId: 10,
        url: 'https://notion.so/doc',
        title: 'Notion',
        discarded: true,
        active: false
      } as chrome.tabs.Tab
    ]);

    mockChrome.__setSessionStorage({
      bindingsByBookmarkId: {
        'bm-gh': {
          bookmarkId: 'bm-gh',
          tabId: 1,
          windowId: 10,
          originalUrl: 'https://github.com',
          currentUrl: 'https://github.com',
          currentTitle: 'GitHub',
          isNavigatedAway: false
        }
      },
      bookmarkIdByTabId: { 1: 'bm-gh' }
    });
    mockChrome.__setLocalStorage({});

    // 1. Bound tab 1 navigates to /issues -> updates session + persistedBindingsByBookmarkId
    await handleTabUpdated(
      1,
      { url: 'https://github.com/issues', title: 'Issues' },
      mockChrome.__getTabs()[0]
    );

    expect(
      (mockChrome.__getSessionStorage().bindingsByBookmarkId as Record<string, any>)['bm-gh']
        .isNavigatedAway
    ).toBe(true);
    expect(
      (mockChrome.__getLocalStorage().persistedBindingsByBookmarkId as Record<string, any>)?.[
        'bm-gh'
      ]?.currentUrl
    ).toBe('https://github.com/issues');

    // 2. Unbound sleeping tab 2 receives pendingUrl update, and sleeping tab 3 is created via session restore
    await handleTabUpdated(2, { status: 'complete' }, mockChrome.__getTabs()[1]);
    await handleTabCreated(mockChrome.__getTabs()[2]);
    // Flush microtask-coalesced background reconciliation
    await new Promise((r) => setTimeout(r, 10));

    const session = mockChrome.__getSessionStorage();
    expect((session.bookmarkIdByTabId as Record<number, string>)[2]).toBe('bm-figma');
    expect((session.bookmarkIdByTabId as Record<number, string>)[3]).toBe('bm-notion');
  });

  it('handleNotificationOpenTab focuses a sleeping or canonical-redirected tab instead of creating a duplicate', async () => {
    mockChrome.__setTabs([
      {
        id: 61,
        windowId: 10,
        url: '',
        pendingUrl: 'https://mail.google.com/mail/u/0/#inbox',
        title: 'Inbox - Gmail',
        discarded: true,
        active: false
      } as chrome.tabs.Tab
    ]);

    const reminder: TabReminder = {
      id: 'rem_gmail_sleep',
      targetType: 'bookmark',
      bookmarkId: 'bm-gmail',
      url: 'https://gmail.com',
      title: 'Check Gmail',
      note: 'Reply to thread',
      triggerAt: Date.now() - 100,
      status: 'fired',
      createdAt: Date.now() - 1000
    };

    await chrome.storage.sync.set({
      [REMINDERS_STORAGE_KEY]: [reminder]
    });

    mockChrome.tabs.create.mockClear();
    await handleNotificationOpenTab('rem_gmail_sleep');

    expect(mockChrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.update).toHaveBeenCalledWith(61, { active: true });
  });

  describe('Edge Trigger & Side Panel Visibility Lifecycle', () => {
    it('OPEN_SIDE_PANEL_FROM_EDGE calls chrome.sidePanel.open synchronously before any microtask gap', async () => {
      let calledSynchronously = false;
      mockChrome.sidePanel.open.mockImplementationOnce(() => {
        calledSynchronously = true;
        return Promise.resolve();
      });

      const sendResponse = vi.fn();
      const ret = handleRuntimeMessage(
        { type: 'OPEN_SIDE_PANEL_FROM_EDGE' },
        { tab: { id: 5, windowId: 42 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
        sendResponse
      );

      // Must be true BEFORE any await so Chrome preserves transient user gesture
      expect(calledSynchronously).toBe(true);
      expect(ret).toBe(true);
      expect(mockChrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 42 });

      await new Promise((r) => setTimeout(r, 10));
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it('tracks sidePanel open and close per window via runtime port and SIDEPANEL_WILL_CLOSE', async () => {
      mockChrome.runtime.onConnect.addListener(handleSidePanelPortConnect);
      const port = chrome.runtime.connect({ name: 'arctic-sidepanel' });
      port.postMessage({ type: 'SIDEPANEL_INIT', windowId: 77 });

      await new Promise((r) => setTimeout(r, 15));
      expect(mockChrome.__getSessionStorage().openSidePanelWindowIds).toEqual([77]);

      // Disconnecting port removes window 77 from openSidePanelWindowIds
      port.disconnect();
      await new Promise((r) => setTimeout(r, 15));
      expect(mockChrome.__getSessionStorage().openSidePanelWindowIds).toEqual([]);
    });

    it('registers dynamic content script and injects only into non-discarded open tabs when enabled with permission', async () => {
      mockChrome.__setLocalStorage({ edgeTriggerEnabled: true });
      mockChrome.__setHostPermissionsGranted(true);
      mockChrome.__setTabs([
        { id: 101, windowId: 10, url: 'https://github.com', discarded: false, active: true } as chrome.tabs.Tab,
        { id: 102, windowId: 10, url: 'https://news.ycombinator.com', discarded: true, active: false } as chrome.tabs.Tab
      ]);

      const active = await syncEdgeTriggerContentScript(true);
      expect(active).toBe(true);
      expect(chrome.scripting.registerContentScripts).toHaveBeenCalledWith([
        expect.objectContaining({
          id: EDGE_TRIGGER_SCRIPT_ID,
          matches: EDGE_TRIGGER_ORIGINS,
          js: ['edgeTrigger.js']
        })
      ]);
      // Injected into active tab 101, NOT sleeping tab 102
      expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: 101 },
        files: ['edgeTrigger.js']
      });

      // Disabling unregisters and notifies open tabs to unmount
      mockChrome.__setLocalStorage({ edgeTriggerEnabled: false });
      const afterDisable = await syncEdgeTriggerContentScript(false);
      expect(afterDisable).toBe(false);
      expect(chrome.scripting.unregisterContentScripts).toHaveBeenCalledWith({
        ids: [EDGE_TRIGGER_SCRIPT_ID]
      });
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(101, {
        type: 'ARCTIC_REMOVE_EDGE_TRIGGER'
      });
    });

    it('GET_EDGE_TRIGGER_STATE returns tab windowId, openWindowIds, mode, and enabled status', async () => {
      mockChrome.__setLocalStorage({ edgeTriggerEnabled: true, sidebarDockSide: 'right' });
      mockChrome.__setSessionStorage({ openSidePanelWindowIds: [99] });
      mockChrome.__setHostPermissionsGranted(true);

      const sendResponse = vi.fn();
      handleRuntimeMessage(
        { type: 'GET_EDGE_TRIGGER_STATE' },
        { tab: { id: 7, windowId: 10 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
        sendResponse
      );

      await new Promise((r) => setTimeout(r, 20));
      expect(sendResponse).toHaveBeenCalledWith({
        windowId: 10,
        openWindowIds: [99],
        edgeTriggerEnabled: true,
        side: 'right',
        mode: 'push',
        justCollapsed: false,
        quickAccessItems: expect.any(Array),
        spaceItems: expect.any(Array),
        spaceName: expect.any(String)
      });

      // Also returns mode: 'hover' when edgeTriggerMode is 'hover'
      mockChrome.__setLocalStorage({
        edgeTriggerEnabled: true,
        sidebarDockSide: 'left',
        edgeTriggerMode: 'hover'
      });
      const sendHoverResponse = vi.fn();
      handleRuntimeMessage(
        { type: 'GET_EDGE_TRIGGER_STATE' },
        { tab: { id: 7, windowId: 10 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
        sendHoverResponse
      );
      await new Promise((r) => setTimeout(r, 20));
      expect(sendHoverResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          side: 'left',
          mode: 'hover'
        })
      );
    });

    it('PREPARE_HIDE_SIDEBAR atomically closes window state, injects into open web tabs, and broadcasts ARCTIC_SIDEPANEL_VISIBILITY with quickAccessItems and spaceItems to active tab', async () => {
      mockChrome.__setLocalStorage({ edgeTriggerEnabled: true, sidebarDockSide: 'left' });
      mockChrome.__setSessionStorage({ openSidePanelWindowIds: [10] });
      mockChrome.__setHostPermissionsGranted(true);
      mockChrome.__setTabs([
        {
          id: 201,
          windowId: 10,
          url: 'https://example.com',
          discarded: false,
          active: true
        } as chrome.tabs.Tab,
        {
          id: 202,
          windowId: 10,
          url: 'chrome://extensions',
          discarded: false,
          active: false
        } as chrome.tabs.Tab
      ]);

      const sendResponse = vi.fn();
      handleRuntimeMessage(
        { type: 'PREPARE_HIDE_SIDEBAR', windowId: 10, injectIntoOpenTabs: true },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      await new Promise((r) => setTimeout(r, 25));

      expect(sendResponse).toHaveBeenCalledWith({ ok: true, active: true });
      expect(mockChrome.__getSessionStorage().openSidePanelWindowIds).toEqual([]);
      // Only web tab 201 is injected, never restricted chrome:// tab 202
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: 201 },
        files: ['edgeTrigger.js']
      });
      expect(chrome.scripting.executeScript).not.toHaveBeenCalledWith({
        target: { tabId: 202 },
        files: ['edgeTrigger.js']
      });
      // Direct visibility push sent with quickAccessItems and spaceItems to active tab
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(201, {
        type: 'ARCTIC_SIDEPANEL_VISIBILITY',
        windowId: 10,
        isSidePanelOpen: false,
        openWindowIds: [],
        justCollapsed: true,
        quickAccessItems: expect.any(Array),
        spaceItems: expect.any(Array),
        spaceName: 'Home'
      });
    });

    it('ACTIVATE_QUICK_ACCESS_FROM_EDGE switches to bound tab, resets drifted active tab, or opens and binds unbound Quick Access bookmark', async () => {
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
                            { id: 'qa-gh', title: 'GitHub', url: 'https://github.com' },
                            { id: 'qa-yt', title: 'YouTube', url: 'https://youtube.com' }
                          ]
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

      mockChrome.__setTabs([
        {
          id: 301,
          windowId: 10,
          url: 'https://github.com/notifications',
          title: 'Notifications',
          active: true
        } as chrome.tabs.Tab
      ]);

      mockChrome.__setSessionStorage({
        bindingsByBookmarkId: {
          'qa-gh': {
            bookmarkId: 'qa-gh',
            tabId: 301,
            windowId: 10,
            originalUrl: 'https://github.com',
            currentUrl: 'https://github.com/notifications',
            currentTitle: 'Notifications',
            isNavigatedAway: true
          }
        },
        bookmarkIdByTabId: { 301: 'qa-gh' }
      });

      // 1. Clicking already-active drifted Quick Access bookmark resets it to originalUrl
      const resp1 = vi.fn();
      handleRuntimeMessage(
        { type: 'ACTIVATE_QUICK_ACCESS_FROM_EDGE', bookmarkId: 'qa-gh' },
        { tab: { id: 301, windowId: 10 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
        resp1
      );
      await new Promise((r) => setTimeout(r, 25));
      expect(resp1).toHaveBeenCalledWith({ ok: true });
      expect(chrome.tabs.update).toHaveBeenCalledWith(301, {
        url: 'https://github.com',
        active: true
      });
      expect(mockChrome.sidePanel.open).not.toHaveBeenCalled();

      // 2. Clicking unbound Quick Access bookmark 'qa-yt' creates a new tab and binds it
      const resp2 = vi.fn();
      handleRuntimeMessage(
        { type: 'ACTIVATE_QUICK_ACCESS_FROM_EDGE', bookmarkId: 'qa-yt' },
        { tab: { id: 301, windowId: 10 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
        resp2
      );
      await new Promise((r) => setTimeout(r, 25));
      expect(resp2).toHaveBeenCalledWith({ ok: true });
      expect(chrome.tabs.create).toHaveBeenCalledWith({
        url: 'https://youtube.com',
        active: true,
        windowId: 10
      });
      const session = mockChrome.__getSessionStorage();
      expect((session.bindingsByBookmarkId as Record<string, any>)['qa-yt']).toBeDefined();
    });

    it('getEdgeRailDataForWindow returns Quick Access items alongside Active Space saved tabs and folders with aggregated folder status', async () => {
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
                      title: 'Work',
                      children: [
                        {
                          id: '11',
                          title: 'Quick Access',
                          children: [{ id: 'qa-1', title: 'Gmail', url: 'https://mail.google.com' }]
                        },
                        { id: 'sp-bm-1', title: 'Linear', url: 'https://linear.app' },
                        {
                          id: 'sp-folder-1',
                          title: 'Design Docs',
                          children: [
                            { id: 'f-bm-1', title: 'Figma Spec', url: 'https://figma.com/spec' },
                            {
                              id: 'sp-subfolder-1',
                              title: 'Archive',
                              children: [
                                { id: 'f-bm-2', title: 'Old Spec', url: 'https://figma.com/old' }
                              ]
                            }
                          ]
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

      mockChrome.__setLocalStorage({
        spaces: [{ id: 'work', name: 'Work', folderId: '12', quickAccessFolderId: '11' }],
        activeSpaceId: 'work'
      });

      mockChrome.__setTabs([
        {
          id: 401,
          windowId: 10,
          url: 'https://figma.com/spec/edit',
          title: 'Figma Editing',
          active: true
        } as chrome.tabs.Tab
      ]);

      mockChrome.__setSessionStorage({
        bindingsByBookmarkId: {
          'f-bm-1': {
            bookmarkId: 'f-bm-1',
            tabId: 401,
            windowId: 10,
            originalUrl: 'https://figma.com/spec',
            currentUrl: 'https://figma.com/spec/edit',
            currentTitle: 'Figma Editing',
            isNavigatedAway: true
          }
        },
        bookmarkIdByTabId: { 401: 'f-bm-1' }
      });

      const railData = await getEdgeRailDataForWindow(10);
      expect(railData.spaceName).toBe('Work');
      expect(railData.quickAccessItems).toHaveLength(1);
      expect(railData.quickAccessItems[0].id).toBe('qa-1');

      // Space items exclude the Quick Access subfolder and include Linear + Design Docs folder
      expect(railData.spaceItems).toHaveLength(2);
      expect(railData.spaceItems[0]).toMatchObject({
        type: 'bookmark',
        id: 'sp-bm-1',
        title: 'Linear'
      });
      expect(railData.spaceItems[1]).toMatchObject({
        type: 'folder',
        id: 'sp-folder-1',
        title: 'Design Docs',
        hasActiveChild: true,
        hasOpenChild: true,
        hasNavigatedAwayChild: true,
        itemCount: 2
      });
    });

    it('only broadcasts ARCTIC_EDGE_ITEMS_UPDATED to the active tab and skips resolving rail data when sidebar is open', async () => {
      mockChrome.__setLocalStorage({ edgeTriggerEnabled: true });
      mockChrome.__setHostPermissionsGranted(true);
      mockChrome.__setSessionStorage({ openSidePanelWindowIds: [] });
      mockChrome.__setTabs([
        { id: 501, windowId: 10, url: 'https://active.example', active: true, discarded: false } as chrome.tabs.Tab,
        { id: 502, windowId: 10, url: 'https://bg1.example', active: false, discarded: false } as chrome.tabs.Tab,
        { id: 503, windowId: 10, url: 'https://bg2.example', active: false, discarded: false } as chrome.tabs.Tab
      ]);

      vi.mocked(chrome.tabs.sendMessage).mockClear();
      await handleTabActivated({ tabId: 501, windowId: 10 });
      await new Promise((r) => setTimeout(r, 50));

      // Active tab 501 receives update; background tabs 502 & 503 are NOT spammed
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        501,
        expect.objectContaining({ type: 'ARCTIC_EDGE_ITEMS_UPDATED', windowId: 10 })
      );
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(502, expect.anything());
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(503, expect.anything());

      // When sidePanel is open in window 10 via active port, GET_EDGE_TRIGGER_STATE skips bookmark queries
      mockChrome.runtime.onConnect.addListener(handleSidePanelPortConnect);
      const port = chrome.runtime.connect({ name: 'arctic-sidepanel' });
      port.postMessage({ type: 'SIDEPANEL_INIT', windowId: 10 });
      await new Promise((r) => setTimeout(r, 20));

      vi.mocked(chrome.bookmarks.getTree).mockClear();
      vi.mocked(chrome.bookmarks.getSubTree).mockClear();

      const resp = vi.fn();
      handleRuntimeMessage(
        { type: 'GET_EDGE_TRIGGER_STATE' },
        { tab: { id: 501, windowId: 10 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
        resp
      );
      await new Promise((r) => setTimeout(r, 25));

      expect(chrome.bookmarks.getTree).not.toHaveBeenCalled();
      expect(chrome.bookmarks.getSubTree).not.toHaveBeenCalled();
      expect(resp).toHaveBeenCalledWith(
        expect.objectContaining({
          windowId: 10,
          openWindowIds: [10],
          quickAccessItems: [],
          spaceItems: []
        })
      );

      port.disconnect();
      await new Promise((r) => setTimeout(r, 15));
    });

    it('ACTIVATE_QUICK_ACCESS_FROM_EDGE adopts an existing matching unbound tab instead of opening a duplicate, and reloads on forceReset', async () => {
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
                      children: [{ id: 'sp-cal', title: 'Calendar', url: 'https://calendar.google.com' }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]);

      mockChrome.__setTabs([
        {
          id: 601,
          windowId: 10,
          url: 'https://example.com',
          title: 'Example',
          active: true
        } as chrome.tabs.Tab,
        {
          id: 602,
          windowId: 10,
          url: 'https://calendar.google.com/',
          title: 'Google Calendar',
          active: false
        } as chrome.tabs.Tab
      ]);
      mockChrome.__setSessionStorage({});

      vi.mocked(chrome.tabs.create).mockClear();
      vi.mocked(chrome.tabs.update).mockClear();

      // 1. Clicking unbound bookmark 'sp-cal' adopts existing unbound tab 602 without creating a duplicate tab
      const respAdopt = vi.fn();
      handleRuntimeMessage(
        { type: 'ACTIVATE_QUICK_ACCESS_FROM_EDGE', bookmarkId: 'sp-cal' },
        { tab: { id: 601, windowId: 10 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
        respAdopt
      );
      await new Promise((r) => setTimeout(r, 25));

      expect(respAdopt).toHaveBeenCalledWith({ ok: true });
      expect(chrome.tabs.create).not.toHaveBeenCalled();
      expect(chrome.tabs.update).toHaveBeenCalledWith(602, { active: true });
      expect(
        (mockChrome.__getSessionStorage().bindingsByBookmarkId as Record<string, any>)['sp-cal']?.tabId
      ).toBe(602);

      // 2. Double-clicking ('forceReset: true') on bound non-drifted tab 602 reloads it
      const respReload = vi.fn();
      handleRuntimeMessage(
        { type: 'ACTIVATE_QUICK_ACCESS_FROM_EDGE', bookmarkId: 'sp-cal', forceReset: true },
        { tab: { id: 602, windowId: 10 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
        respReload
      );
      await new Promise((r) => setTimeout(r, 25));

      expect(respReload).toHaveBeenCalledWith({ ok: true });
      expect(chrome.tabs.reload).toHaveBeenCalledWith(602);
    });

    it('SIDEPANEL_WILL_CLOSE marks window closed with closing guard and GET_EDGE_FOLDER_FAVICONS deduplicates URLs', async () => {
      mockChrome.runtime.onConnect.addListener(handleSidePanelPortConnect);
      const port = chrome.runtime.connect({ name: 'arctic-sidepanel' });
      port.postMessage({ type: 'SIDEPANEL_INIT', windowId: 22 });
      await new Promise((r) => setTimeout(r, 15));
      expect(mockChrome.__getSessionStorage().openSidePanelWindowIds).toContain(22);

      const closeResp = vi.fn();
      handleRuntimeMessage(
        { type: 'SIDEPANEL_WILL_CLOSE', windowId: 22 },
        {} as chrome.runtime.MessageSender,
        closeResp
      );
      await new Promise((r) => setTimeout(r, 20));
      expect(closeResp).toHaveBeenCalledWith({ ok: true, openWindowIds: [] });
      expect(mockChrome.__getSessionStorage().openSidePanelWindowIds).toEqual([]);

      // GET_EDGE_FOLDER_FAVICONS handles duplicate/empty URLs cleanly
      const favResp = vi.fn();
      handleRuntimeMessage(
        {
          type: 'GET_EDGE_FOLDER_FAVICONS',
          urls: ['https://a.example', 'https://a.example', '']
        },
        {} as chrome.runtime.MessageSender,
        favResp
      );
      await new Promise((r) => setTimeout(r, 20));
      expect(favResp).toHaveBeenCalledWith({
        ok: true,
        favicons: expect.any(Object)
      });
    });

    it('hydrates openWindowIds via chrome.runtime.getContexts after extension reload while Side Panel is open, and immediately marks window open on OPEN_SIDE_PANEL_FROM_EDGE', async () => {
      const rt = chrome.runtime as unknown as {
        getContexts?: (filter: { contextTypes: string[] }) => Promise<Array<{ windowId?: number }>>;
      };
      const origGetContexts = rt.getContexts;
      mockChrome.__setLocalStorage({ edgeTriggerEnabled: true });
      mockChrome.__setSessionStorage({}); // Wiped on extension reload
      mockChrome.__setHostPermissionsGranted(true);

      rt.getContexts = vi.fn().mockResolvedValue([{ contextType: 'SIDE_PANEL', windowId: 10 }]);
      try {
        const resp = vi.fn();
        handleRuntimeMessage(
          { type: 'GET_EDGE_TRIGGER_STATE' },
          { tab: { id: 701, windowId: 10 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
          resp
        );
        await new Promise((r) => setTimeout(r, 25));

        expect(resp).toHaveBeenCalledWith(
          expect.objectContaining({
            windowId: 10,
            openWindowIds: [10]
          })
        );
        expect(mockChrome.__getSessionStorage().openSidePanelWindowIds).toEqual([10]);
      } finally {
        if (origGetContexts === undefined) {
          delete rt.getContexts;
        } else {
          rt.getContexts = origGetContexts;
        }
      }

      // Also verify OPEN_SIDE_PANEL_FROM_EDGE immediately records windowId in session storage
      const openResp = vi.fn();
      handleRuntimeMessage(
        { type: 'OPEN_SIDE_PANEL_FROM_EDGE' },
        { tab: { id: 702, windowId: 33 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
        openResp
      );
      await new Promise((r) => setTimeout(r, 25));
      expect(openResp).toHaveBeenCalledWith({ ok: true });
      expect(mockChrome.__getSessionStorage().openSidePanelWindowIds).toContain(33);

      // Clean up window 33 state
      const closeResp = vi.fn();
      handleRuntimeMessage(
        { type: 'SIDEPANEL_WILL_CLOSE', windowId: 33 },
        {} as chrome.runtime.MessageSender,
        closeResp
      );
      await new Promise((r) => setTimeout(r, 20));
    });
  });
});
