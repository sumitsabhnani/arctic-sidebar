import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReminderPopover } from './ReminderPopover';
import type { TabReminder } from '../../types';

describe('ReminderPopover component', () => {
  const target = {
    type: 'bookmark' as const,
    bookmarkId: 'bm_1',
    url: 'https://github.com',
    title: 'GitHub'
  };

  const defaultProps = {
    target,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onSnooze: vi.fn(),
    onClose: vi.fn()
  };

  it('renders creation form with quick presets and allows submitting a reminder', () => {
    render(<ReminderPopover {...defaultProps} />);

    expect(screen.getByText('Set Tab Reminder')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();

    // Preset chips
    expect(screen.getByText('In 15m')).toBeInTheDocument();
    expect(screen.getByText('In 1h')).toBeInTheDocument();
    expect(screen.getByText('In 3h')).toBeInTheDocument();
    expect(screen.getByText('Tomorrow 9 AM')).toBeInTheDocument();

    const noteInput = screen.getByPlaceholderText(/What do you want to remember/i);
    expect(noteInput).toBeInTheDocument();

    // Type note and click preset
    fireEvent.change(noteInput, { target: { value: 'Review pull request' } });
    fireEvent.click(screen.getByText('In 1h'));

    // Submit form
    const submitBtn = screen.getByText('Set Reminder');
    fireEvent.click(submitBtn);

    expect(defaultProps.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        note: 'Review pull request'
      })
    );
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('renders active reminder details with Snooze and Delete buttons', () => {
    const activeReminder: TabReminder = {
      id: 'rem_123',
      targetType: 'bookmark',
      bookmarkId: 'bm_1',
      url: 'https://github.com',
      title: 'GitHub',
      note: 'Existing active reminder note',
      triggerAt: Date.now() + 60000,
      status: 'scheduled',
      createdAt: Date.now()
    };

    render(<ReminderPopover {...defaultProps} activeReminder={activeReminder} />);

    expect(screen.getByText('Active Reminder')).toBeInTheDocument();
    expect(screen.getByText('Existing active reminder note')).toBeInTheDocument();

    // Snooze button
    const snoozeBtn = screen.getByText('+15m Snooze');
    fireEvent.click(snoozeBtn);
    expect(defaultProps.onSnooze).toHaveBeenCalledWith('rem_123', 15);
    expect(defaultProps.onClose).toHaveBeenCalled();

    // Delete button
    const deleteBtn = screen.getByTitle('Delete Reminder');
    fireEvent.click(deleteBtn);
    expect(defaultProps.onDelete).toHaveBeenCalledWith('rem_123');
  });

  it('closes when Escape key is pressed', () => {
    render(<ReminderPopover {...defaultProps} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
