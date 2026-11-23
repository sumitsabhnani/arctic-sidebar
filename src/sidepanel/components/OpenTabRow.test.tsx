import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OpenTabRow } from './OpenTabRow';
import { endDragSession, getActiveDrag, parseDragPayload, startDragSession } from '../utils/dnd';
import type { TabWithFaviconMeta } from '../../types';

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
  afterEach(() => {
    endDragSession();
  });

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

  it('passes visual slot index to onMoveOpenTabs and ignores non-openTab drops', () => {
    const onMoveOpenTabs = vi.fn();
    const props = createBaseProps({
      tab: {
        id: 42,
        index: 3,
        windowId: 10,
        url: 'https://github.com/facebook/react',
        title: 'React'
      } as chrome.tabs.Tab,
      onMoveOpenTabs
    });

    render(<OpenTabRow {...props} />);
    const row = screen.getByText('React').closest('[role="button"]') as HTMLElement;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 34,
      left: 0,
      right: 260,
      width: 260,
      height: 34,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });

    // Dropping a folder onto an OpenTabRow is ignored
    fireEvent.drop(row, {
      clientY: 28,
      dataTransfer: {
        getData: (type: string) =>
          type === 'application/json' ? JSON.stringify({ type: 'folder', id: 'f-1' }) : ''
      }
    });
    expect(onMoveOpenTabs).not.toHaveBeenCalled();

    // Dropping openTab on bottom half of index 3 passes visual slot 4
    fireEvent.dragOver(row, { clientY: 28, dataTransfer: { dropEffect: 'move' } });
    fireEvent.drop(row, {
      clientY: 28,
      dataTransfer: {
        getData: (type: string) =>
          type === 'application/json'
            ? JSON.stringify({ type: 'openTab', tabId: 10, tabIds: [10], index: 0 })
            : ''
      }
    });
    expect(onMoveOpenTabs).toHaveBeenCalledWith([10], 4);
  });

  it('recovers OpenTabRow favicon on reload after transient load error with identical favIconUrl', () => {
    const iconUrl = 'https://github.githubassets.com/favicons/favicon.svg';
    const props = createBaseProps({
      tab: {
        id: 42,
        index: 0,
        windowId: 10,
        url: 'https://github.com/facebook/react',
        title: 'React',
        status: 'complete',
        favIconUrl: iconUrl,
        _faviconRev: 1
      } as TabWithFaviconMeta
    });

    const { container, rerender } = render(<OpenTabRow {...props} />);
    let img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(iconUrl);

    // Transient failure of both live icon and /_favicon/
    fireEvent.error(img!);
    img = container.querySelector('img');
    expect(img?.getAttribute('src')).toContain('/_favicon/');
    fireEvent.error(img!);
    expect(container.querySelector('svg.lucide-globe')).toBeInTheDocument();

    // Reload finishes with bumped _faviconRev -> recovers iconUrl
    rerender(
      <OpenTabRow
        {...props}
        tab={
          {
            ...props.tab,
            status: 'complete',
            favIconUrl: iconUrl,
            _faviconRev: 2
          } as TabWithFaviconMeta
        }
      />
    );

    img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute('src')).toBe(iconUrl);
  });

  it('falls back to in-memory drag session when dataTransfer JSON is empty and preserves non-openTab sessions for parent drop zones', () => {
    const onMoveOpenTabs = vi.fn();
    let parentReceivedId: unknown = null;
    const props = createBaseProps({
      tab: {
        id: 42,
        index: 2,
        windowId: 10,
        url: 'https://github.com/facebook/react',
        title: 'React'
      } as chrome.tabs.Tab,
      onMoveOpenTabs
    });

    render(
      <div
        onDrop={(e) => {
          parentReceivedId = parseDragPayload(e)?.id ?? null;
        }}
      >
        <OpenTabRow {...props} />
      </div>
    );
    const row = screen.getByText('React').closest('[role="button"]') as HTMLElement;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 34,
      left: 0,
      right: 260,
      width: 260,
      height: 34,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });

    // 1. Non-openTab active drag session bubbles intact to parent drop zone before window cleanup
    startDragSession({ type: 'bookmark', id: 'bm-1', url: 'https://example.com' });
    fireEvent.drop(row, {
      clientY: 20,
      dataTransfer: { getData: () => '' }
    });
    expect(onMoveOpenTabs).not.toHaveBeenCalled();
    expect(parentReceivedId).toBe('bm-1');
    expect(getActiveDrag()).toBeNull();

    // 2. openTab active drag session succeeds even when dataTransfer.getData returns '' and stops bubbling
    parentReceivedId = null;
    startDragSession({ type: 'openTab', tabId: 15, tabIds: [15], index: 0 });
    fireEvent.drop(row, {
      clientY: 28,
      dataTransfer: { getData: () => '' }
    });
    expect(onMoveOpenTabs).toHaveBeenCalledWith([15], 3);
    expect(parentReceivedId).toBeNull();
    expect(getActiveDrag()).toBeNull();
  });

  it('does not hijack Enter/Space keydown from focused child action buttons or create a nested favicon tab stop', () => {
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

    // Only the outer row has role="button" + tabIndex=0 (no duplicate favicon tabIndex=0)
    const tabbableRoleButtons = container.querySelectorAll('[role="button"][tabindex="0"]');
    expect(tabbableRoleButtons.length).toBe(1);

    const muteBtn = container.querySelector(
      '[data-tooltip="Tab is playing audio (Click to mute)"]'
    ) as HTMLButtonElement;
    muteBtn.focus();

    const enterPrevented = !fireEvent.keyDown(muteBtn, { key: 'Enter' });
    const spacePrevented = !fireEvent.keyDown(muteBtn, { key: ' ' });
    expect(enterPrevented).toBe(false);
    expect(spacePrevented).toBe(false);
    expect(props.onFocus).not.toHaveBeenCalled();
  });

  it('commits inline rename on blur, skips no-op renames, and reloads on title double-click when rename is unsupported', () => {
    const onRenameTab = vi.fn();
    const { rerender } = render(<OpenTabRow {...createBaseProps({ onRenameTab })} />);

    // 1. Blur without changing title exits edit mode without calling onRenameTab
    fireEvent.doubleClick(screen.getByText('facebook/react: A JavaScript library'));
    let input = screen.getByDisplayValue('facebook/react: A JavaScript library');
    fireEvent.blur(input);
    expect(onRenameTab).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    // 2. Blur after editing commits updated title and exits edit mode
    fireEvent.doubleClick(screen.getByText('facebook/react: A JavaScript library'));
    input = screen.getByDisplayValue('facebook/react: A JavaScript library');
    fireEvent.change(input, { target: { value: 'Custom Title' } });
    fireEvent.blur(input);
    expect(onRenameTab).toHaveBeenCalledTimes(1);
    expect(onRenameTab).toHaveBeenCalledWith(42, 'Custom Title');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    // 3. When onRenameTab is omitted, double-clicking the title reloads instead of opening a dead input
    const noRenameProps = createBaseProps({ onRenameTab: undefined });
    rerender(<OpenTabRow {...noRenameProps} />);
    fireEvent.doubleClick(screen.getByText('facebook/react: A JavaScript library'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(noRenameProps.onReload).toHaveBeenCalledWith(42);
  });

  it('handles clipboard rejections cleanly, clears copy timer on unmount, and truncates huge data: URLs', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Document is not focused'))
      }
    });

    const hugeDataUrl = `data:text/html;base64,${'A'.repeat(2000)}`;
    const props = createBaseProps({
      densityMode: 'relaxed',
      tab: {
        id: 42,
        index: 0,
        windowId: 10,
        url: hugeDataUrl,
        title: 'Inline Preview'
      } as chrome.tabs.Tab
    });

    const { container, unmount } = render(<OpenTabRow {...props} />);
    const row = screen.getByText('Inline Preview').closest('[role="button"]')!;
    expect(row.getAttribute('title')!.length).toBeLessThan(350);
    expect(screen.getByText('data:text/html')).toBeInTheDocument();

    const copyBtn = container.querySelector('button[data-tooltip="Copy link"]')!;
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(hugeDataUrl);

    // Unmounting before 1500ms cleans up timer cleanly
    unmount();
  });
});
