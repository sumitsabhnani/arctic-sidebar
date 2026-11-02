import { useState, useEffect, useCallback, useMemo } from 'react';
import type { TabReminder } from '../../types';
import { normalizeUrl } from '../utils/url';
import {
  getStoredReminders,
  saveStoredReminders,
  updateBadgeCount,
  REMINDERS_STORAGE_KEY
} from '../utils/reminderStorage';

export function useReminders() {
  const [reminders, setReminders] = useState<TabReminder[]>([]);
  const [loading, setLoading] = useState(true);

  // Initial load from storage
  useEffect(() => {
    let isMounted = true;
    getStoredReminders().then((list) => {
      if (isMounted) {
        setReminders(list);
        setLoading(false);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Listen for storage changes across windows and background
  useEffect(() => {
    if (!chrome.storage || !chrome.storage.onChanged) return;

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName === 'sync' || areaName === 'local') {
        if (changes[REMINDERS_STORAGE_KEY]) {
          const newList = (changes[REMINDERS_STORAGE_KEY].newValue as TabReminder[]) || [];
          setReminders(newList);
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // 1-second ticker to ensure overdue reminders reflect in UI in real-time
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // When reminders become overdue while sidebar is open, sync status to storage
  useEffect(() => {
    const overdueScheduled = reminders.filter(
      (r) => r.status === 'scheduled' && r.triggerAt <= now
    );
    if (overdueScheduled.length > 0) {
      getStoredReminders().then((currentList) => {
        let changed = false;
        for (const item of currentList) {
          if (item.status === 'scheduled' && item.triggerAt <= Date.now()) {
            item.status = 'fired';
            changed = true;
          }
        }
        if (changed) {
          saveStoredReminders(currentList);
          updateBadgeCount(currentList);
        }
      });
    }
  }, [reminders, now]);

  const firedReminders = useMemo(() => {
    return reminders.filter(
      (r) => r.status === 'fired' || (r.status === 'scheduled' && r.triggerAt <= now)
    );
  }, [reminders, now]);

  const scheduledReminders = useMemo(() => {
    return reminders.filter(
      (r) => r.status === 'scheduled' && r.triggerAt > now
    );
  }, [reminders, now]);

  /**
   * Find reminder attached to a bookmark node
   */
  const getReminderForBookmark = useCallback(
    (bookmarkId: string): TabReminder | undefined => {
      return reminders.find((r) => r.bookmarkId === bookmarkId);
    },
    [reminders]
  );

  /**
   * Find reminder attached to an open tab (matching tabId or normalized URL)
   */
  const getReminderForTab = useCallback(
    (tabId: number, url?: string): TabReminder | undefined => {
      const normalizedUrl = url ? normalizeUrl(url) : '';
      return reminders.find(
        (r) =>
          r.tabId === tabId ||
          (Boolean(normalizedUrl) && normalizeUrl(r.url) === normalizedUrl)
      );
    },
    [reminders]
  );

  /**
   * Create or update a tab reminder and schedule its Chrome alarm
   */
  const createOrUpdateReminder = useCallback(
    async (params: {
      targetType: 'bookmark' | 'tab';
      bookmarkId?: string;
      tabId?: number;
      url: string;
      title: string;
      note: string;
      triggerAt: number;
      reminderId?: string;
    }): Promise<TabReminder> => {
      const currentList = await getStoredReminders();
      const existingId = params.reminderId;

      let targetReminder: TabReminder;

      if (existingId) {
        const index = currentList.findIndex((r) => r.id === existingId);
        if (index !== -1) {
          targetReminder = {
            ...currentList[index],
            note: params.note,
            triggerAt: params.triggerAt,
            status: 'scheduled',
            url: params.url || currentList[index].url,
            title: params.title || currentList[index].title
          };
          currentList[index] = targetReminder;
        } else {
          targetReminder = {
            id: existingId,
            targetType: params.targetType,
            bookmarkId: params.bookmarkId,
            tabId: params.tabId,
            url: params.url,
            title: params.title,
            note: params.note,
            triggerAt: params.triggerAt,
            status: 'scheduled',
            createdAt: Date.now()
          };
          currentList.push(targetReminder);
        }
      } else {
        targetReminder = {
          id: `rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          targetType: params.targetType,
          bookmarkId: params.bookmarkId,
          tabId: params.tabId,
          url: params.url,
          title: params.title,
          note: params.note,
          triggerAt: params.triggerAt,
          status: 'scheduled',
          createdAt: Date.now()
        };
        currentList.push(targetReminder);
      }

      // Schedule Chrome alarm
      if (chrome.alarms && chrome.alarms.create) {
        await chrome.alarms.create(`reminder:${targetReminder.id}`, {
          when: targetReminder.triggerAt
        });
      }

      await saveStoredReminders(currentList);
      await updateBadgeCount(currentList);
      setReminders([...currentList]);

      return targetReminder;
    },
    []
  );

  /**
   * Delete reminder: clear alarm, clear notification, update storage & badge
   */
  const deleteReminder = useCallback(async (id: string): Promise<void> => {
    // Clear alarm
    if (chrome.alarms && chrome.alarms.clear) {
      try {
        await chrome.alarms.clear(`reminder:${id}`);
      } catch {
        // ignore
      }
    }

    // Clear notification if any
    if (chrome.notifications && chrome.notifications.clear) {
      try {
        await chrome.notifications.clear(`notif:${id}`);
      } catch {
        // ignore
      }
    }

    const currentList = await getStoredReminders();
    const filtered = currentList.filter((r) => r.id !== id);

    await saveStoredReminders(filtered);
    await updateBadgeCount(filtered);
    setReminders(filtered);
  }, []);

  /**
   * Snooze reminder by N minutes (defaults to 15m)
   */
  const snoozeReminder = useCallback(
    async (id: string, minutes = 15): Promise<void> => {
      const currentList = await getStoredReminders();
      const index = currentList.findIndex((r) => r.id === id);
      if (index === -1) return;

      const newTriggerAt = Date.now() + minutes * 60 * 1000;
      currentList[index].triggerAt = newTriggerAt;
      currentList[index].status = 'scheduled';

      // Clear any existing notification
      if (chrome.notifications && chrome.notifications.clear) {
        try {
          await chrome.notifications.clear(`notif:${id}`);
        } catch {
          // ignore
        }
      }

      // Reschedule Chrome alarm
      if (chrome.alarms && chrome.alarms.create) {
        await chrome.alarms.create(`reminder:${id}`, {
          when: newTriggerAt
        });
      }

      await saveStoredReminders(currentList);
      await updateBadgeCount(currentList);
      setReminders([...currentList]);
    },
    []
  );

  /**
   * Dismiss reminder without opening
   */
  const dismissReminder = useCallback(
    async (id: string): Promise<void> => {
      await deleteReminder(id);
    },
    [deleteReminder]
  );

  /**
   * Open tab associated with reminder and dismiss reminder
   */
  const openAndDismissReminder = useCallback(
    async (reminder: TabReminder): Promise<void> => {
      try {
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
      } catch (err) {
        console.warn('[useReminders] Could not focus/open tab:', err);
      }

      await deleteReminder(reminder.id);
    },
    [deleteReminder]
  );

  return {
    reminders,
    firedReminders,
    scheduledReminders,
    loading,
    getReminderForBookmark,
    getReminderForTab,
    createOrUpdateReminder,
    deleteReminder,
    snoozeReminder,
    dismissReminder,
    openAndDismissReminder
  };
}
