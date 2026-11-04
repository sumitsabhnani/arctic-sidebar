import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('renders both Clear (temporary tabs) and Clear All (all window tabs) buttons and handles clicks', () => {
    render(<OpenTabsSection {...defaultProps} />);

    const clearBtn = screen.getByTitle('Close temporary Today\'s tabs');
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);
    expect(defaultProps.onCloseAll).toHaveBeenCalledTimes(1);

    const clearAllBtn = screen.getByTitle('Close all tabs in current window');
    expect(clearAllBtn).toBeInTheDocument();
    fireEvent.click(clearAllBtn);
    expect(defaultProps.onCloseAllWindowTabs).toHaveBeenCalledTimes(1);
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
});
