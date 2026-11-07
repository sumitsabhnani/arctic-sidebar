import { describe, it, expect, vi } from 'vitest';
import {
  REMINDERS_STORAGE_KEY,
  getStoredReminders,
  saveStoredReminders,
  updateBadgeCount
} from './reminderStorage';
import type { TabReminder } from '../../types';

const sampleReminders: TabReminder[] = [
  {
    id: 'r1',
    targetType: 'tab',
    tabId: 1,
    url: 'https://github.com',
    title: 'GitHub PR',
    note: 'Review changes',
    createdAt: 1000,
    triggerAt: 2000,
    status: 'fired'
  },
  {
    id: 'r2',
    targetType: 'bookmark',
    bookmarkId: 'b1',
    url: 'https://linear.app',
    title: 'Linear Issue',
    note: 'Check sprint',
    createdAt: 1000,
    triggerAt: 99999999,
    status: 'scheduled'
  }
];

describe('reminderStorage utilities', () => {
  it('saves reminders to both sync and local storage and reads them back', async () => {
    await saveStoredReminders(sampleReminders);

    const syncData = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY);
    const localData = await chrome.storage.local.get(REMINDERS_STORAGE_KEY);
    expect(syncData[REMINDERS_STORAGE_KEY]).toEqual(sampleReminders);
    expect(localData[REMINDERS_STORAGE_KEY]).toEqual(sampleReminders);

    const loaded = await getStoredReminders();
    expect(loaded).toEqual(sampleReminders);
  });

  it('falls back to local storage when sync storage fails on read or write', async () => {
    vi.spyOn(chrome.storage.sync, 'set').mockRejectedValueOnce(new Error('Quota exceeded'));
    await saveStoredReminders(sampleReminders);

    vi.spyOn(chrome.storage.sync, 'get').mockRejectedValueOnce(new Error('Sync unavailable'));
    const loaded = await getStoredReminders();
    expect(loaded).toEqual(sampleReminders);
  });

  it('returns empty array when no reminders exist in sync or local storage', async () => {
    const loaded = await getStoredReminders();
    expect(loaded).toEqual([]);
  });

  it('updates extension badge text and color based on fired reminder count', async () => {
    const count = await updateBadgeCount(sampleReminders);
    expect(count).toBe(1);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '1' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#EF4444' });

    const clearCount = await updateBadgeCount([sampleReminders[1]]);
    expect(clearCount).toBe(0);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
  });
});
