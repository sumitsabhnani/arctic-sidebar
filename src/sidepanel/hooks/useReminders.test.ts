import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReminders } from './useReminders';
import type { TabReminder } from '../../types';

describe('useReminders hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new reminder, schedules Chrome alarm, and updates badge', async () => {
    const { result } = renderHook(() => useReminders());

    let created: TabReminder | undefined;
    await act(async () => {
      created = await result.current.createOrUpdateReminder({
        targetType: 'bookmark',
        bookmarkId: 'bm_123',
        url: 'https://example.com/docs',
        title: 'Project Docs',
        note: 'Review deployment checklist',
        triggerAt: Date.now() + 30 * 60 * 1000
      });
    });

    expect(created).toBeDefined();
    expect(created?.id).toMatch(/^rem_/);
    expect(created?.status).toBe('scheduled');
    expect(created?.note).toBe('Review deployment checklist');

    // Chrome alarm was registered
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      `reminder:${created?.id}`,
      expect.objectContaining({
        when: created?.triggerAt
      })
    );

    // Stored in storage.sync
    expect(chrome.storage.sync.set).toHaveBeenCalled();

    // Hook state updated
    expect(result.current.reminders.length).toBe(1);
    expect(result.current.getReminderForBookmark('bm_123')).toBeDefined();
  });

  it('snoozes a reminder by 15 minutes and reschedules alarm', async () => {
    const { result } = renderHook(() => useReminders());

    let created: TabReminder | undefined;
    await act(async () => {
      created = await result.current.createOrUpdateReminder({
        targetType: 'tab',
        tabId: 42,
        url: 'https://example.com',
        title: 'Tab 42',
        note: 'Check analytics',
        triggerAt: Date.now() + 5000
      });
    });

    const oldTrigger = created!.triggerAt;

    await act(async () => {
      await result.current.snoozeReminder(created!.id, 15);
    });

    const snoozed = result.current.getReminderForTab(42);
    expect(snoozed).toBeDefined();
    expect(snoozed!.status).toBe('scheduled');
    expect(snoozed!.triggerAt).toBeGreaterThan(oldTrigger);

    // Alarm recreated with new trigger time
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      `reminder:${created!.id}`,
      expect.objectContaining({
        when: snoozed!.triggerAt
      })
    );
  });

  it('deletes a reminder, clearing alarm and notification', async () => {
    const { result } = renderHook(() => useReminders());

    let created: TabReminder | undefined;
    await act(async () => {
      created = await result.current.createOrUpdateReminder({
        targetType: 'bookmark',
        bookmarkId: 'bm_456',
        url: 'https://example.com/test',
        title: 'Test',
        note: 'Note',
        triggerAt: Date.now() + 10000
      });
    });

    expect(result.current.reminders.length).toBe(1);

    await act(async () => {
      await result.current.deleteReminder(created!.id);
    });

    expect(result.current.reminders.length).toBe(0);
    expect(chrome.alarms.clear).toHaveBeenCalledWith(`reminder:${created!.id}`);
    expect(chrome.notifications.clear).toHaveBeenCalledWith(`notif:${created!.id}`);
  });

  it('filters fired overdue reminders correctly', async () => {
    const { result } = renderHook(() => useReminders());

    await act(async () => {
      await result.current.createOrUpdateReminder({
        targetType: 'tab',
        tabId: 10,
        url: 'https://github.com',
        title: 'GitHub',
        note: 'Pull Request Review',
        triggerAt: Date.now() + 5000
      });
    });

    expect(result.current.firedReminders.length).toBe(0);
    expect(result.current.scheduledReminders.length).toBe(1);
  });
});
