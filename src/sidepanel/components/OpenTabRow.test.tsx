import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OpenTabRow } from './OpenTabRow';

function createBaseProps(overrides: Partial<React.ComponentProps<typeof OpenTabRow>> = {}) {
  const tab: chrome.tabs.Tab = {
    id: 42,
    index: 0,
    windowId: 10,
    highlighted: false,
    active: false,
    pinned: false,
    incognito: false,
    url: 'https://www.github.com/facebook/react',
    title: 'facebook/react: A JavaScript library',
    status: 'complete',
    audible: false,
    discarded: false,
    autoDiscardable: true,
    mutedInfo: { muted: false },
    ...overrides.tab
  } as chrome.tabs.Tab;

  return {
    tab,
    isActive: false,
    onFocus: vi.fn(),
    onClose: vi.fn(),
    onPinToQuickAccess: vi.fn(),
    onPinToWorkspace: vi.fn(),
    onDuplicate: vi.fn(),
    onReload: vi.fn(),
    onToggleMute: vi.fn(),
    onOpenContextMenu: vi.fn(),
    ...overrides
  };
}

describe('OpenTabRow Component', () => {
  it('renders tab title, active badge and formatted subdomain in relaxed mode, and focuses on click', () => {
    const props = createBaseProps({
      isActive: true,
      densityMode: 'relaxed'
    });

    render(<OpenTabRow {...props} />);

    expect(screen.getByText('facebook/react: A JavaScript library')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('github.com/facebook/react')).toBeInTheDocument();

    fireEvent.click(screen.getByText('facebook/react: A JavaScript library'));
    expect(props.onFocus).toHaveBeenCalledWith(42);
  });

  it('displays audio mute/unmute button when tab is audible or muted and calls onToggleMute', () => {
    const props = createBaseProps({
      tab: {
        id: 42,
        index: 0,
        windowId: 10,
        url: 'https://youtube.com/watch?v=123',
        title: 'YouTube Video',
        audible: true,
        mutedInfo: { muted: false }
      } as chrome.tabs.Tab
    });

    const { container } = render(<OpenTabRow {...props} />);
    const audioBtn = container.querySelector('[data-tooltip="Tab is playing audio (Click to mute)"]');
    expect(audioBtn).toBeInTheDocument();

    fireEvent.click(audioBtn!);
    expect(props.onToggleMute).toHaveBeenCalledWith(props.tab);
    expect(props.onFocus).not.toHaveBeenCalled();
  });

  it('triggers onPinToWorkspace, onOpenReminderPopover, and onClose from row action buttons', () => {
    const onOpenReminderPopover = vi.fn();
    const props = createBaseProps({ onOpenReminderPopover });

    const { container } = render(<OpenTabRow {...props} />);

    const pinBtn = container.querySelector('[data-tooltip="Pin to Active Space"]');
    fireEvent.click(pinBtn!);
    expect(props.onPinToWorkspace).toHaveBeenCalledWith(props.tab);

    const reminderBtn = container.querySelector('[data-tooltip="Set reminder"]');
    fireEvent.click(reminderBtn!);
    expect(onOpenReminderPopover).toHaveBeenCalledWith(
      {
        type: 'tab',
        tabId: 42,
        url: 'https://www.github.com/facebook/react',
        title: 'facebook/react: A JavaScript library'
      },
      expect.any(Object)
    );

    const closeBtn = container.querySelector('[data-tooltip="Close tab (Cmd+W)"]');
    fireEvent.click(closeBtn!);
    expect(props.onClose).toHaveBeenCalledWith(42, expect.any(Object));
  });

  it('supports inline rename on double-click and saves updated title on submit', () => {
    const onRenameTab = vi.fn();
    const props = createBaseProps({ onRenameTab });

    render(<OpenTabRow {...props} />);

    const titleEl = screen.getByText('facebook/react: A JavaScript library');
    fireEvent.doubleClick(titleEl);

    const input = screen.getByDisplayValue('facebook/react: A JavaScript library');
    fireEvent.change(input, { target: { value: 'React Repo' } });
    fireEvent.submit(input.closest('form')!);

    expect(onRenameTab).toHaveBeenCalledWith(42, 'React Repo');
  });

  it('calls onReload when double-clicking the tab favicon', () => {
    const props = createBaseProps();
    render(<OpenTabRow {...props} />);

    const faviconBtn = screen.getByTitle(/Double-click to reload/i);
    fireEvent.doubleClick(faviconBtn);

    expect(props.onReload).toHaveBeenCalledWith(42);
  });

  it('opens single-tab and multi-selected context menus on right-click', () => {
    const onDiscardTab = vi.fn();
    const onCloseMultipleTabs = vi.fn();
    const props = createBaseProps({
      onDiscardTab,
      onCloseMultipleTabs
    });

    const { rerender } = render(<OpenTabRow {...props} />);
    const row = screen.getByText('facebook/react: A JavaScript library').closest('[role="button"]')!;

    fireEvent.contextMenu(row);
    expect(props.onOpenContextMenu).toHaveBeenCalledTimes(1);
    const singleMenuItems = vi.mocked(props.onOpenContextMenu).mock.calls[0][1];
    expect(
      singleMenuItems.some(
        (item: { label: string }) => item.label === 'Hibernate Tab (Save RAM)'
      )
    ).toBe(true);
    expect(
      singleMenuItems.some((item: { label: string }) => item.label === 'Close Tab')
    ).toBe(true);

    // Multi-selection context menu
    vi.mocked(props.onOpenContextMenu).mockClear();
    rerender(
      <OpenTabRow
        {...props}
        isSelected={true}
        selectedTabIds={new Set([42, 43])}
      />
    );

    fireEvent.contextMenu(row);
    expect(props.onOpenContextMenu).toHaveBeenCalledTimes(1);
    const multiMenuItems = vi.mocked(props.onOpenContextMenu).mock.calls[0][1];
    const closeMultiItem = multiMenuItems.find(
      (item: { label: string; action?: () => void }) =>
        item.label === 'Close 2 Selected Tabs'
    );
    expect(closeMultiItem).toBeDefined();
    closeMultiItem?.action?.();
    expect(onCloseMultipleTabs).toHaveBeenCalledWith([42, 43]);
  });
});
