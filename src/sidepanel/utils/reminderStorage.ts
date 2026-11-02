import type { TabReminder } from '../../types';

export const REMINDERS_STORAGE_KEY = 'tab_reminders';

/**
 * Read all reminders from chrome.storage.sync (with automatic fallback to chrome.storage.local)
 */
export async function getStoredReminders(): Promise<TabReminder[]> {
  try {
    if (chrome.storage && chrome.storage.sync) {
      const syncData = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY);
      if (Array.isArray(syncData[REMINDERS_STORAGE_KEY])) {
        return syncData[REMINDERS_STORAGE_KEY] as TabReminder[];
      }
    }
  } catch (err) {
    console.warn('[Arctic Reminders] Could not read from storage.sync, trying local:', err);
  }

  try {
    if (chrome.storage && chrome.storage.local) {
      const localData = await chrome.storage.local.get(REMINDERS_STORAGE_KEY);
      if (Array.isArray(localData[REMINDERS_STORAGE_KEY])) {
        return localData[REMINDERS_STORAGE_KEY] as TabReminder[];
      }
    }
  } catch (err) {
    console.error('[Arctic Reminders] Error reading from storage.local:', err);
  }

  return [];
}

/**
 * Save reminders to chrome.storage.sync (with automatic fallback and local backup)
 */
export async function saveStoredReminders(reminders: TabReminder[]): Promise<void> {
  let syncSuccess = false;

  try {
    if (chrome.storage && chrome.storage.sync) {
      await chrome.storage.sync.set({ [REMINDERS_STORAGE_KEY]: reminders });
      syncSuccess = true;
    }
  } catch (err) {
    console.warn('[Arctic Reminders] Failed to save to storage.sync, falling back to local:', err);
  }

  try {
    if (chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [REMINDERS_STORAGE_KEY]: reminders });
    }
  } catch (err) {
    if (!syncSuccess) {
      console.error('[Arctic Reminders] Failed to save to storage.local as well:', err);
    }
  }
}

/**
 * Update the extension toolbar badge to reflect overdue ('fired') reminders
 */
export async function updateBadgeCount(reminders?: TabReminder[]): Promise<number> {
  try {
    const list = reminders ?? (await getStoredReminders());
    const firedCount = list.filter((r) => r.status === 'fired').length;

    if (chrome.action && chrome.action.setBadgeText) {
      await chrome.action.setBadgeText({
        text: firedCount > 0 ? String(firedCount) : ''
      });
      if (chrome.action.setBadgeBackgroundColor) {
        await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
      }
    }
    return firedCount;
  } catch (err) {
    console.warn('[Arctic Reminders] Could not update badge count:', err);
    return 0;
  }
}
