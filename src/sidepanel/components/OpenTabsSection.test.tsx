import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { OpenTabsSection } from './OpenTabsSection';

describe('OpenTabsSection component', () => {
  const mockTabs: chrome.tabs.Tab[] = [
    {
      id: 101,
      index: 0,
      windowId: 1,
      highlighted: false,
      active: true,
      pinned: false,
      incognito: false,
      url: 'https://news.ycombinator.com',
      title: 'Hacker News'
    } as chrome.tabs.Tab,
    {
      id: 102,
      index: 1,
      windowId: 1,
      highlighted: false,
      active: false,
      pinned: false,
      incognito: false,
      url: 'https://github.com/trending',
      title: 'GitHub Trending'
    } as chrome.tabs.Tab
  ];

  const defaultProps = {
    unpinnedTabs: mockTabs,
    activeTabId: 101,
    onFocusTab: vi.fn(),
    onCloseTab: vi.fn(),
    onCloseAll: vi.fn(),
    onCloseAllWindowTabs: vi.fn(),
    onPinToQuickAccess: vi.fn(),
    onPinToWorkspace: vi.fn(),
    onDuplicateTab: vi.fn(),
    onReloadTab: vi.fn(),
    onNewTab: vi.fn(),
    onToggleMuteTab: vi.fn(),
    onOpenContextMenu: vi.fn()
  };

  it('renders Today\'s tabs with active count and tab rows', () => {
    render(<OpenTabsSection {...defaultProps} />);
    expect(screen.getByText(/Today's Tabs/i)).toBeInTheDocument();
    expect(screen.getByText('(2 ACTIVE)')).toBeInTheDocument();
    expect(screen.getByText('Hacker News')).toBeInTheDocument();
    expect(screen.getByText('GitHub Trending')).toBeInTheDocument();
  });

  it('renders Clear button and dropdown menu with Clear all tabs option', () => {
    render(<OpenTabsSection {...defaultProps} />);

    // Clear temporary tabs button exists and calls onCloseAll
    const clearBtn = screen.getByTitle('Close temporary Today\'s tabs');
    expect(clearBtn).toBeInTheDocument();
    expect(clearBtn).not.toHaveTextContent('Clear');
    fireEvent.click(clearBtn);
    expect(defaultProps.onCloseAll).toHaveBeenCalledTimes(1);

    // Clear All button is NOT directly visible on the header (preventing accidental clicks)
    expect(screen.queryByTitle('Close all tabs in current window')).not.toBeInTheDocument();

    // Open dropdown menu via chevron
    const clearOptionsBtn = screen.getByTitle('Clear options');
    expect(clearOptionsBtn).toBeInTheDocument();
    fireEvent.click(clearOptionsBtn);

    // Now Clear all tabs option is revealed in dropdown
    const clearAllOption = screen.getByTitle('Close all tabs in current window');
    expect(clearAllOption).toBeInTheDocument();
    expect(clearAllOption).toHaveTextContent('Clear all tabs');

    // Click Clear all option
    fireEvent.click(clearAllOption);
    expect(defaultProps.onCloseAllWindowTabs).toHaveBeenCalledTimes(1);

    // Dropdown closes after selection
    expect(screen.queryByTitle('Close all tabs in current window')).not.toBeInTheDocument();
  });

  it('closes clear dropdown when Escape key is pressed or outside is clicked', () => {
    render(<OpenTabsSection {...defaultProps} />);

    const clearOptionsBtn = screen.getByTitle('Clear options');
    fireEvent.click(clearOptionsBtn);
    expect(screen.getByText('Clear all tabs')).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Clear all tabs')).not.toBeInTheDocument();
  });

  it('closes clear dropdown when moving to main browser window (mouseleave or window blur)', () => {
    vi.useFakeTimers();
    render(<OpenTabsSection {...defaultProps} />);

    const clearOptionsBtn = screen.getByTitle('Clear options');
    fireEvent.click(clearOptionsBtn);
    expect(screen.getByText('Clear all tabs')).toBeInTheDocument();

    // Cursor leaves sidepanel document to main browser window
    fireEvent.mouseLeave(document.documentElement);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByText('Clear all tabs')).not.toBeInTheDocument();

    // Reopen and test window blur (e.g. clicking into main window)
    fireEvent.click(clearOptionsBtn);
    expect(screen.getByText('Clear all tabs')).toBeInTheDocument();

    fireEvent.blur(window);
    expect(screen.queryByText('Clear all tabs')).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it('renders + button for New tab and triggers onNewTab on click', () => {
    render(<OpenTabsSection {...defaultProps} />);

    const newTabBtn = screen.getByRole('button', { name: /new tab/i });
    expect(newTabBtn).toBeInTheDocument();
    fireEvent.click(newTabBtn);
    expect(defaultProps.onNewTab).toHaveBeenCalledTimes(1);
  });

  it('renders reload button on open tab rows on hover and calls onReloadTab', () => {
    const { container } = render(<OpenTabsSection {...defaultProps} />);

    const reloadButtons = container.querySelectorAll('button[data-tooltip="Reload tab"]');
    expect(reloadButtons.length).toBe(2);
    reloadButtons.forEach((btn) => {
      expect(btn.className).toContain('hidden');
      expect(btn.className).toContain('group-hover:flex');
    });

    fireEvent.click(reloadButtons[0]);
    expect(defaultProps.onReloadTab).toHaveBeenCalledWith(101);
  });

  it('renders tab row buttons in consistent order: Pin -> Reload -> Bell -> Close', () => {
    const onOpenReminderPopover = vi.fn();
    render(
      <OpenTabsSection
        {...defaultProps}
        onOpenReminderPopover={onOpenReminderPopover}
      />
    );

    // Get the first tab row's action cluster
    const firstTabRow = screen.getByText('Hacker News').closest('[role="button"]')!;
    const actionButtons = Array.from(
      firstTabRow.querySelectorAll(
        'button[data-tooltip="Pin to Bookmarks"], button[data-tooltip="Reload tab"], button[data-tooltip="Set reminder"], button[data-tooltip="Close tab (Cmd+W)"]'
      )
    );

    expect(actionButtons.length).toBe(4);
    expect(actionButtons[0]).toHaveAttribute('data-tooltip', 'Pin to Bookmarks');
    expect(actionButtons[1]).toHaveAttribute('data-tooltip', 'Reload tab');
    expect(actionButtons[2]).toHaveAttribute('data-tooltip', 'Set reminder');
    expect(actionButtons[3]).toHaveAttribute('data-tooltip', 'Close tab (Cmd+W)');
  });

  it('activates a tab when clicked', () => {
    render(<OpenTabsSection {...defaultProps} />);
    const secondTab = screen.getByText('GitHub Trending');
    fireEvent.click(secondTab);
    expect(defaultProps.onFocusTab).toHaveBeenCalledWith(102);
  });

  it('keeps Pin to Bookmarks button hidden on unhovered tabs (including active tab) to avoid layout shift', () => {
    const { container } = render(<OpenTabsSection {...defaultProps} />);
    const pinButtons = container.querySelectorAll('button[data-tooltip="Pin to Bookmarks"]');
    expect(pinButtons.length).toBe(2);
    pinButtons.forEach((btn) => {
      expect(btn.className).toContain('hidden');
      expect(btn.className).toContain('group-hover:flex');
    });
  });

  it('does not apply cursor-text or select-text to tab title so mouse pointer remains consistent', () => {
    render(<OpenTabsSection {...defaultProps} />);
    const titleElement = screen.getByText('Hacker News');
    expect(titleElement.className).not.toContain('cursor-text');
    expect(titleElement.className).not.toContain('select-text');
    expect(titleElement.className).toContain('select-none');
  });

  it('cancels previous tab edit when double-clicking another tab without changes', () => {
    const onRenameTab = vi.fn();
    render(<OpenTabsSection {...defaultProps} onRenameTab={onRenameTab} />);

    // Double click first tab
    const firstTab = screen.getByText('Hacker News');
    fireEvent.doubleClick(firstTab);

    // Input for first tab should appear
    const inputsAfterFirst = screen.getAllByRole('textbox');
    expect(inputsAfterFirst.length).toBe(1);
    expect(inputsAfterFirst[0]).toHaveValue('Hacker News');

    // Double click second tab without changing anything
    const secondTab = screen.getByText('GitHub Trending');
    fireEvent.doubleClick(secondTab);

    // Only one input should be present (the second tab's input)
    const inputsAfterSecond = screen.getAllByRole('textbox');
    expect(inputsAfterSecond.length).toBe(1);
    expect(inputsAfterSecond[0]).toHaveValue('GitHub Trending');
    expect(onRenameTab).not.toHaveBeenCalled();
  });

  it('saves previous tab edit when double-clicking another tab after title changes', () => {
    const onRenameTab = vi.fn();
    render(<OpenTabsSection {...defaultProps} onRenameTab={onRenameTab} />);

    // Double click first tab
    const firstTab = screen.getByText('Hacker News');
    fireEvent.doubleClick(firstTab);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'HN Frontpage' } });

    // Double click second tab
    const secondTab = screen.getByText('GitHub Trending');
    fireEvent.doubleClick(secondTab);

    // Previous tab should have saved the change
    expect(onRenameTab).toHaveBeenCalledWith(101, 'HN Frontpage');

    // Second tab should now be in editing state
    const inputsAfterSecond = screen.getAllByRole('textbox');
    expect(inputsAfterSecond.length).toBe(1);
    expect(inputsAfterSecond[0]).toHaveValue('GitHub Trending');
  });

  it('renders spinning loader icon when tab status is loading', () => {
    const loadingTabs: chrome.tabs.Tab[] = [
      {
        id: 301,
        index: 0,
        windowId: 1,
        highlighted: false,
        active: true,
        pinned: false,
        incognito: false,
        url: 'https://loading-site.com',
        title: 'Loading Site',
        status: 'loading'
      } as chrome.tabs.Tab
    ];

    const { container } = render(
      <OpenTabsSection {...defaultProps} unpinnedTabs={loadingTabs} activeTabId={301} />
    );

    const spinSvg = container.querySelector('svg.lucide-rotate-cw.animate-spin');
    expect(spinSvg).toBeInTheDocument();
  });

  it('provides Move Tab to Space in context menu when multiple spaces are available', () => {
    const onMoveTabToSpace = vi.fn();
    const mockSpaces = [
      { id: 'home', name: 'Home', folderId: 'f-home', colorTheme: 'glacier-blue' },
      { id: 'work', name: 'Work', folderId: 'f-work', colorTheme: 'emerald' }
    ];

    render(
      <OpenTabsSection
        {...defaultProps}
        spaces={mockSpaces}
        onMoveTabToSpace={onMoveTabToSpace}
      />
    );

    const firstTab = screen.getByText('Hacker News').closest('[role="button"]')!;
    fireEvent.contextMenu(firstTab);

    expect(defaultProps.onOpenContextMenu).toHaveBeenCalled();
    const menuItems = defaultProps.onOpenContextMenu.mock.calls[0][1];
    const moveItem = menuItems.find((item: { label: string }) => item.label === 'Move Tab to Space');
    expect(moveItem).toBeDefined();
    expect(moveItem.submenu).toHaveLength(2);

    // Trigger submenu move to Work space
    moveItem.submenu[1].action();
    expect(onMoveTabToSpace).toHaveBeenCalledWith(101, 'work');
  });
});
