import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TabReminder } from '../types';
import { REMINDERS_STORAGE_KEY } from '../sidepanel/utils/reminderStorage';
import {
  handleAlarmTrigger,
  handleInstalled,
  handleNotificationOpenTab,
  handleNotificationDismiss,
  handleStartup,
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
});
