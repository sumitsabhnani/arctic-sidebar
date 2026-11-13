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

  it('renders Today\'s tabs header cleanly and tab rows', () => {
    render(<OpenTabsSection {...defaultProps} />);
    expect(screen.getByText(/Today's Tabs/i)).toBeInTheDocument();
    expect(screen.queryByText('(2 ACTIVE)')).not.toBeInTheDocument();
    expect(screen.getByText('Hacker News')).toBeInTheDocument();
    expect(screen.getByText('GitHub Trending')).toBeInTheDocument();
  });

  it('renders Clear button and chevron dropdown menu with Clear all tabs option', () => {
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

  it('renders Copy link button on open tab rows on hover and copies URL to clipboard', () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
    const { container } = render(<OpenTabsSection {...defaultProps} />);

    const copyButtons = container.querySelectorAll('button[data-tooltip="Copy link"]');
    expect(copyButtons.length).toBe(2);
    copyButtons.forEach((btn) => {
      expect(btn.className).toContain('hidden');
      expect(btn.className).toContain('group-hover:flex');
    });

    fireEvent.click(copyButtons[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://news.ycombinator.com');
  });

  it('renders tab row buttons in consistent order: Pin -> Copy link -> Bell -> Close', () => {
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
        'button[data-tooltip="Pin to Active Space"], button[data-tooltip="Copy link"], button[data-tooltip="Set reminder"], button[data-tooltip="Close tab (Cmd+W)"]'
      )
    );

    expect(actionButtons.length).toBe(4);
    expect(actionButtons[0]).toHaveAttribute('data-tooltip', 'Pin to Active Space');
    expect(actionButtons[1]).toHaveAttribute('data-tooltip', 'Copy link');
    expect(actionButtons[2]).toHaveAttribute('data-tooltip', 'Set reminder');
    expect(actionButtons[3]).toHaveAttribute('data-tooltip', 'Close tab (Cmd+W)');
  });

  it('activates a tab when clicked', () => {
    render(<OpenTabsSection {...defaultProps} />);
    const secondTab = screen.getByText('GitHub Trending');
    fireEvent.click(secondTab);
    expect(defaultProps.onFocusTab).toHaveBeenCalledWith(102);
  });

  it('keeps Pin to Active Space button hidden on unhovered tabs (including active tab) to avoid layout shift', () => {
    const { container } = render(<OpenTabsSection {...defaultProps} />);
    const pinButtons = container.querySelectorAll('button[data-tooltip="Pin to Active Space"]');
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

  it('automatically scrolls down so the latest tab is in view when a new tab is opened', () => {
    const scrollIntoViewMock = vi.fn();
    const scrollToMock = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    try {
      const { rerender } = render(
        <div
          data-testid="scroll-container"
          className="overflow-y-auto"
          style={{ height: '200px' }}
        >
          <OpenTabsSection {...defaultProps} unpinnedTabs={mockTabs} activeTabId={101} />
        </div>
      );

      const scrollContainer = screen.getByTestId('scroll-container');
      Object.defineProperty(scrollContainer, 'scrollHeight', {
        value: 850,
        configurable: true
      });
      scrollContainer.scrollTop = 0;
      scrollContainer.scrollTo = scrollToMock;

      // Initial render does not trigger scroll
      expect(scrollIntoViewMock).not.toHaveBeenCalled();

      // Simulate opening a new tab (tab 103)
      const newTab: chrome.tabs.Tab = {
        id: 103,
        index: 2,
        windowId: 1,
        highlighted: true,
        active: true,
        pinned: false,
        incognito: false,
        url: 'https://react.dev',
        title: 'React Documentation'
      } as chrome.tabs.Tab;

      rerender(
        <div
          data-testid="scroll-container"
          className="overflow-y-auto"
          style={{ height: '200px' }}
        >
          <OpenTabsSection
            {...defaultProps}
            unpinnedTabs={[...mockTabs, newTab]}
            activeTabId={103}
          />
        </div>
      );

      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest'
      });
      expect(scrollToMock).toHaveBeenCalledWith({
        top: 850,
        behavior: 'smooth'
      });
      expect(scrollContainer.scrollTop).toBe(850);
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('shows Clear button and Clear options when unpinnedTabs is empty but hasOpenActiveSpaceTabs is true', () => {
    const onCloseAll = vi.fn();
    const onCloseAllWindowTabs = vi.fn();

    render(
      <OpenTabsSection
        {...defaultProps}
        unpinnedTabs={[]}
        hasOpenActiveSpaceTabs={true}
        onCloseAll={onCloseAll}
        onCloseAllWindowTabs={onCloseAllWindowTabs}
      />
    );

    expect(screen.getByText('No unpinned tabs open.')).toBeInTheDocument();

    const clearBtn = screen.getByTitle("Close temporary Today's tabs");
    const clearOptionsBtn = screen.getByTitle('Clear options');
    expect(clearBtn).toBeInTheDocument();
    expect(clearOptionsBtn).toBeInTheDocument();

    // Clicking the clear button when unpinnedTabs is empty opens the Clear options menu
    fireEvent.click(clearBtn);
    const clearAllOption = screen.getByTitle('Close all tabs in current window');
    expect(clearAllOption).toBeInTheDocument();

    fireEvent.click(clearAllOption);
    expect(onCloseAllWindowTabs).toHaveBeenCalledTimes(1);
  });

  it('hides Clear button when both unpinnedTabs is empty and hasOpenActiveSpaceTabs is false', () => {
    render(
      <OpenTabsSection
        {...defaultProps}
        unpinnedTabs={[]}
        hasOpenActiveSpaceTabs={false}
      />
    );

    expect(screen.queryByTitle("Close temporary Today's tabs")).not.toBeInTheDocument();
    expect(screen.queryByTitle('Clear options')).not.toBeInTheDocument();
  });

  it('smoothly scrolls an already-open Today Tab into view when activeTabId switches to an off-screen tab (e.g. from Command Bar)', () => {
    const scrollToMock = vi.fn();
    const tabsList: chrome.tabs.Tab[] = [
      ...mockTabs,
      {
        id: 142,
        index: 9,
        windowId: 1,
        highlighted: false,
        active: false,
        pinned: false,
        incognito: false,
        url: 'https://www.amazon.de/b/ref=dp_bc_1?ie=UTF8&node=3167641',
        title: 'Amazon.de: Home & Kitchen'
      } as chrome.tabs.Tab
    ];

    const { rerender } = render(
      <div
        data-testid="scroll-container"
        className="overflow-y-auto"
        style={{ height: '300px' }}
      >
        <OpenTabsSection {...defaultProps} unpinnedTabs={tabsList} activeTabId={101} />
      </div>
    );

    const scrollContainer = screen.getByTestId('scroll-container');
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      value: 900,
      configurable: true
    });
    Object.defineProperty(scrollContainer, 'clientHeight', {
      value: 300,
      configurable: true
    });
    scrollContainer.scrollTop = 0;
    scrollContainer.scrollTo = scrollToMock;
    scrollContainer.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 400,
        left: 0,
        right: 280,
        width: 280,
        height: 300,
        x: 0,
        y: 100,
        toJSON: () => ({})
      }) as DOMRect;

    const visibleRow = scrollContainer.querySelector('[data-tab-id="102"]') as HTMLElement;
    visibleRow.getBoundingClientRect = () =>
      ({
        top: 150,
        bottom: 184,
        left: 0,
        right: 280,
        width: 280,
        height: 34,
        x: 0,
        y: 150,
        toJSON: () => ({})
      }) as DOMRect;

    const offscreenAmazonRow = scrollContainer.querySelector(
      '[data-tab-id="142"]'
    ) as HTMLElement;
    offscreenAmazonRow.getBoundingClientRect = () =>
      ({
        top: 640,
        bottom: 674,
        left: 0,
        right: 280,
        width: 280,
        height: 34,
        x: 0,
        y: 640,
        toJSON: () => ({})
      }) as DOMRect;

    // 1. Switching to an ALREADY visible tab (102) does NOT jump/scroll
    rerender(
      <div
        data-testid="scroll-container"
        className="overflow-y-auto"
        style={{ height: '300px' }}
      >
        <OpenTabsSection {...defaultProps} unpinnedTabs={tabsList} activeTabId={102} />
      </div>
    );
    expect(scrollToMock).not.toHaveBeenCalled();

    // 2. Switching to off-screen Amazon.de tab (142) via Command Bar scrolls container down smoothly
    rerender(
      <div
        data-testid="scroll-container"
        className="overflow-y-auto"
        style={{ height: '300px' }}
      >
        <OpenTabsSection {...defaultProps} unpinnedTabs={tabsList} activeTabId={142} />
      </div>
    );

    // deltaDown = (674 - 400) + 12 = 286
    expect(scrollToMock).toHaveBeenCalledWith({
      top: 286,
      behavior: 'smooth'
    });
  });

  it('defers scrolling until Today Tabs uncollapses when revealRequest targets a tab while collapsed', () => {
    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    try {
      const { rerender } = render(
        <div className="overflow-y-auto">
          <OpenTabsSection
            {...defaultProps}
            unpinnedTabs={mockTabs}
            activeTabId={101}
            isCollapsed={true}
          />
        </div>
      );

      // Command Bar activates tab 102 while section is still collapsed on first tick
      rerender(
        <div className="overflow-y-auto">
          <OpenTabsSection
            {...defaultProps}
            unpinnedTabs={mockTabs}
            activeTabId={102}
            isCollapsed={true}
            revealRequest={{ tabId: 102, nonce: 1 }}
          />
        </div>
      );
      expect(scrollIntoViewMock).not.toHaveBeenCalled();

      // Sidebar auto-expands Today's Tabs -> deferred scroll fires immediately
      rerender(
        <div className="overflow-y-auto">
          <OpenTabsSection
            {...defaultProps}
            unpinnedTabs={mockTabs}
            activeTabId={102}
            isCollapsed={false}
            revealRequest={{ tabId: 102, nonce: 1 }}
          />
        </div>
      );
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest'
      });
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});
