import { normalizeUrl } from '../sidepanel/utils/url';
import type { SessionState, TabBinding, TabReminder } from '../types';
import {
  getStoredReminders,
  saveStoredReminders,
  updateBadgeCount,
  REMINDERS_STORAGE_KEY
} from '../sidepanel/utils/reminderStorage';

// Configure side panel behavior on installation & startup
chrome.runtime.onInstalled.addListener(async () => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  // Ensure storage.session is accessible to extension contexts
  if (chrome.storage.session && 'setAccessLevel' in chrome.storage.session) {
    try {
      await chrome.storage.session.setAccessLevel({
        accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'
      });
    } catch (err) {
      console.warn('[Arctic Background] Could not set session access level:', err);
    }
  }

  // Reconcile and schedule alarms on installation
  await reconcileReminders();
});

chrome.runtime.onStartup.addListener(async () => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  // Reconcile and schedule alarms on startup
  await reconcileReminders();
});

/**
 * Helper to fetch session state safely
 */
async function getSessionState(): Promise<SessionState> {
  try {
    const data = await chrome.storage.session.get(['bindingsByBookmarkId', 'bookmarkIdByTabId']);
    return {
      bindingsByBookmarkId: (data.bindingsByBookmarkId as Record<string, TabBinding>) || {},
      bookmarkIdByTabId: (data.bookmarkIdByTabId as Record<number, string>) || {}
    };
  } catch (err) {
    console.error('[Arctic Background] Error reading session state:', err);
    return {
      bindingsByBookmarkId: {},
      bookmarkIdByTabId: {}
    };
  }
}

/**
 * Helper to persist session state
 */
async function saveSessionState(state: SessionState): Promise<void> {
  try {
    await chrome.storage.session.set({
      bindingsByBookmarkId: state.bindingsByBookmarkId,
      bookmarkIdByTabId: state.bookmarkIdByTabId
    });
  } catch (err) {
    console.error('[Arctic Background] Error saving session state:', err);
  }
}

/**
 * Handle tab removal: unbind closed tab from bookmark
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getSessionState();
  const bookmarkId = session.bookmarkIdByTabId[tabId];

  if (bookmarkId) {
    delete session.bookmarkIdByTabId[tabId];
    delete session.bindingsByBookmarkId[bookmarkId];
    await saveSessionState(session);
  }
});

/**
 * Handle tab replacement (e.g. Chrome prerendering swap)
 */
chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  const session = await getSessionState();
  const bookmarkId = session.bookmarkIdByTabId[removedTabId];

  if (bookmarkId) {
    const existingBinding = session.bindingsByBookmarkId[bookmarkId];
    if (existingBinding) {
      existingBinding.tabId = addedTabId;
    }
    delete session.bookmarkIdByTabId[removedTabId];
    session.bookmarkIdByTabId[addedTabId] = bookmarkId;
    await saveSessionState(session);
  }
});

/**
 * Handle tab navigation & status update
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete' && !changeInfo.title) {
    return;
  }

  const session = await getSessionState();
  const bookmarkId = session.bookmarkIdByTabId[tabId];

  if (!bookmarkId) return;

  const binding = session.bindingsByBookmarkId[bookmarkId];
  if (!binding) return;

  let hasChanged = false;

  if (tab.url && tab.url !== binding.currentUrl) {
    binding.currentUrl = tab.url;
    binding.isNavigatedAway = normalizeUrl(tab.url) !== normalizeUrl(binding.originalUrl);
    hasChanged = true;
  }

  if (tab.title && tab.title !== binding.currentTitle) {
    binding.currentTitle = tab.title;
    hasChanged = true;
  }

  if (hasChanged) {
    session.bindingsByBookmarkId[bookmarkId] = binding;
    await saveSessionState(session);
  }
});

/* -------------------------------------------------------------
   TAB REMINDERS SERVICE WORKER LIFECYCLE (chrome.alarms)
   ------------------------------------------------------------- */

let alarmLock: Promise<void> = Promise.resolve();
const recentlyNotified = new Map<string, number>();

/**
 * Trigger native browser notification for a due/overdue reminder
 */
export async function showReminderNotification(reminder: TabReminder): Promise<void> {
  const lastNotified = recentlyNotified.get(reminder.id);
  const now = Date.now();
  if (lastNotified && now - lastNotified < 10000) {
    // Already notified within the last 10 seconds, avoid duplicate notification
    return;
  }
  recentlyNotified.set(reminder.id, now);
  if (recentlyNotified.size > 100) {
    for (const [id, time] of recentlyNotified.entries()) {
      if (now - time > 60000) recentlyNotified.delete(id);
    }
  }

  if (!chrome.notifications || !chrome.notifications.create) return;
  try {
    await chrome.notifications.create(`notif:${reminder.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: `Reminder: ${reminder.title}`,
      message: reminder.note || 'Time to check this tab',
      priority: 2,
      requireInteraction: true,
      buttons: [
        { title: 'Open Tab' },
        { title: 'Dismiss' }
      ]
    });
  } catch (err) {
    console.error('[Arctic Background] Failed to create notification:', err);
  }
}

/**
 * Handle Alarm Trigger: mark status 'fired', display notification, update badge
 * Safely serialized via alarmLock mutex to prevent read-modify-write race conditions,
 * and batches all simultaneous/due reminders together.
 */
export async function handleAlarmTrigger(alarm: chrome.alarms.Alarm): Promise<void> {
  if (!alarm.name || !alarm.name.startsWith('reminder:')) return;
  const reminderId = alarm.name.slice('reminder:'.length);

  alarmLock = alarmLock.then(async () => {
    try {
      const reminders = await getStoredReminders();
      const now = Date.now();
      const dueToNotify: TabReminder[] = [];
      let hasUpdates = false;

      for (const r of reminders) {
        const isTarget = r.id === reminderId;
        const isDue = r.status === 'scheduled' && r.triggerAt <= now + 2000;

        if (isTarget || isDue) {
          if (r.status !== 'fired') {
            r.status = 'fired';
            hasUpdates = true;
          }
          dueToNotify.push(r);
        }
      }

      if (hasUpdates) {
        await saveStoredReminders(reminders);
        await updateBadgeCount(reminders);
      }

      for (const r of dueToNotify) {
        await showReminderNotification(r);
      }
    } catch (err) {
      console.error('[Arctic Background] Error handling alarm trigger:', err);
    }
  });

  await alarmLock;
}

if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener(handleAlarmTrigger);
}

/**
 * Handle Notification Clicks: Focus or open tab, remove reminder, clear notification
 */
export async function handleNotificationOpenTab(reminderId: string): Promise<void> {
  try {
    const reminders = await getStoredReminders();
    const reminder = reminders.find((r) => r.id === reminderId);

    if (reminder) {
      const tabs = await chrome.tabs.query({});
      const targetNormalized = normalizeUrl(reminder.url);

      const matchingTab = tabs.find((t) => {
        if (typeof reminder.tabId === 'number' && t.id === reminder.tabId) {
          return true;
        }
        if (t.url && normalizeUrl(t.url) === targetNormalized) {
          return true;
        }
        return false;
      });

      if (matchingTab && typeof matchingTab.id === 'number') {
        if (typeof matchingTab.windowId === 'number') {
          await chrome.windows.update(matchingTab.windowId, { focused: true });
        }
        await chrome.tabs.update(matchingTab.id, { active: true });
      } else {
        await chrome.tabs.create({ url: reminder.url, active: true });
      }
    }
  } catch (err) {
    console.warn('[Arctic Background] Could not focus/open tab for reminder:', err);
  }

  await handleNotificationDismiss(reminderId);
}

/**
 * Dismiss Notification: Remove from storage, clear notification, update badge
 */
export async function handleNotificationDismiss(reminderId: string): Promise<void> {
  try {
    const notifId = `notif:${reminderId}`;
    if (chrome.notifications && chrome.notifications.clear) {
      await chrome.notifications.clear(notifId);
    }

    const reminders = await getStoredReminders();
    const filtered = reminders.filter((r) => r.id !== reminderId);
    await saveStoredReminders(filtered);
    await updateBadgeCount(filtered);
  } catch (err) {
    console.error('[Arctic Background] Error dismissing reminder:', err);
  }
}

if (chrome.notifications) {
  if (chrome.notifications.onButtonClicked) {
    chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
      if (notificationId.startsWith('notif:')) {
        const reminderId = notificationId.slice('notif:'.length);
        if (buttonIndex === 0) {
          await handleNotificationOpenTab(reminderId);
        } else {
          await handleNotificationDismiss(reminderId);
        }
      }
    });
  }

  if (chrome.notifications.onClicked) {
    chrome.notifications.onClicked.addListener(async (notificationId) => {
      if (notificationId.startsWith('notif:')) {
        const reminderId = notificationId.slice('notif:'.length);
        await handleNotificationOpenTab(reminderId);
      }
    });
  }
}

/**
 * Startup Reconciliation: Check scheduled reminders; fire if overdue, otherwise ensure alarm exists
 */
export async function reconcileReminders(): Promise<void> {
  try {
    const reminders = await getStoredReminders();
    let hasChanges = false;
    const now = Date.now();

    for (const reminder of reminders) {
      if (reminder.status === 'scheduled') {
        if (reminder.triggerAt <= now) {
          reminder.status = 'fired';
          hasChanges = true;
          await showReminderNotification(reminder);
        } else if (chrome.alarms && chrome.alarms.create) {
          await chrome.alarms.create(`reminder:${reminder.id}`, { when: reminder.triggerAt });
        }
      }
    }

    if (hasChanges) {
      await saveStoredReminders(reminders);
    }
    await updateBadgeCount(reminders);
  } catch (err) {
    console.error('[Arctic Background] Error reconciling reminders:', err);
  }
}

// Keep badge count synced when storage changes from sidepanel or another window
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' || areaName === 'local') {
      if (changes[REMINDERS_STORAGE_KEY]) {
        const newReminders = changes[REMINDERS_STORAGE_KEY].newValue as TabReminder[] | undefined;
        updateBadgeCount(newReminders);
      }
    }
  });
}
