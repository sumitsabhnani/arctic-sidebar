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
});
