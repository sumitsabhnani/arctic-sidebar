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
  reconcileReminders
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
});
