import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from './Header';

describe('Header component', () => {
  const defaultProps = {
    allFolders: [
      { id: '10', title: 'Home', path: 'Arctic Sidebar / Home' },
      { id: '11', title: 'Work', path: 'Arctic Sidebar / Work' }
    ],
    activeFolderIds: {
      quickAccessId: '1',
      workspaceId: '10',
      defaultRootId: '0'
    },
    autoArchiveInterval: '24h' as const,
    activeTabUrl: 'https://news.ycombinator.com/news',
    isActiveTabLoading: false,
    isSearchOpen: false,
    theme: 'dark' as const,
    colorTheme: 'glacier-blue' as const,
    onSelectQuickAccessFolder: vi.fn(),
    onSelectWorkspaceFolder: vi.fn(),
    onResetFolders: vi.fn(),
    onToggleAllCollapsed: vi.fn(),
    onCreateFolder: vi.fn(),
    onCreateBookmark: vi.fn(),
    onSetAutoArchiveInterval: vi.fn(),
    onReloadActiveTab: vi.fn(),
    onNavigateActiveTab: vi.fn(),
    onGoBackActiveTab: vi.fn(),
    onToggleSearch: vi.fn(),
    onToggleTheme: vi.fn(),
    onSelectColorTheme: vi.fn(),
    onDiscardAllBackgroundTabs: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock navigator.clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
  });

  it('renders top address bar displaying clean domain and path', () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByText('news.ycombinator.com/news')).toBeInTheDocument();
  });

  it('allows clicking address bar to edit URL and submitting navigation', () => {
    render(<Header {...defaultProps} />);
    const urlButton = screen.getByText('news.ycombinator.com/news');
    fireEvent.click(urlButton);

    const input = screen.getByPlaceholderText('Search Google or enter URL...');
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'github.com' } });
    fireEvent.submit(input.closest('form')!);

    expect(defaultProps.onNavigateActiveTab).toHaveBeenCalledWith('github.com');
  });

  it('copies current URL to clipboard on copy button click', () => {
    const { container } = render(<Header {...defaultProps} />);
    const copyBtn = container.querySelector('[data-tooltip="Copy URL"]') as HTMLElement;
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://news.ycombinator.com/news');
  });

  it('triggers reload when reload button is clicked', () => {
    const { container } = render(<Header {...defaultProps} />);
    const reloadBtn = container.querySelector('[data-tooltip="Reload (Cmd+R)"]') as HTMLElement;
    fireEvent.click(reloadBtn);

    expect(defaultProps.onReloadActiveTab).toHaveBeenCalledTimes(1);
    expect(defaultProps.onReloadActiveTab).toHaveBeenCalledWith(false);
  });

  it('renders single clean reload button (no split dropdown arrow) and toggles reload menu with hard reload option on right-click', () => {
    const { container } = render(<Header {...defaultProps} />);
    const reloadBtn = container.querySelector('[data-tooltip="Reload (Cmd+R)"]') as HTMLElement;
    expect(reloadBtn).toBeInTheDocument();
    expect(screen.queryByLabelText('Reload options')).not.toBeInTheDocument();

    // Menu not visible initially
    expect(screen.queryByText('Hard Reload')).not.toBeInTheDocument();

    // Right-click reload button to open menu
    fireEvent.contextMenu(reloadBtn);
    expect(screen.getByText('Hard Reload')).toBeInTheDocument();
    expect(screen.getByText('Clear cache & reload')).toBeInTheDocument();
    expect(screen.getByText('Normal Reload')).toBeInTheDocument();

    // Click Hard Reload -> calls onReloadActiveTab(true)
    const hardReloadBtn = screen.getByText('Hard Reload').closest('button')!;
    fireEvent.click(hardReloadBtn);
    expect(defaultProps.onReloadActiveTab).toHaveBeenCalledWith(true);

    // Menu closes after selection
    expect(screen.queryByText('Hard Reload')).not.toBeInTheDocument();
  });

  it('allows normal reload from the right-click dropdown menu', () => {
    const { container } = render(<Header {...defaultProps} />);
    const reloadBtn = container.querySelector('[data-tooltip="Reload (Cmd+R)"]') as HTMLElement;
    fireEvent.contextMenu(reloadBtn);

    const normalReloadBtn = screen.getByText('Normal Reload').closest('button')!;
    fireEvent.click(normalReloadBtn);
    expect(defaultProps.onReloadActiveTab).toHaveBeenCalledWith(false);
    expect(screen.queryByText('Hard Reload')).not.toBeInTheDocument();
  });

  it('opens reload dropdown on contextmenu right-click on reload button and closes on Escape', () => {
    const { container } = render(<Header {...defaultProps} />);
    const reloadBtn = container.querySelector('[data-tooltip="Reload (Cmd+R)"]') as HTMLElement;

    fireEvent.contextMenu(reloadBtn);
    expect(screen.getByText('Hard Reload')).toBeInTheDocument();

    // Press Escape to close
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Hard Reload')).not.toBeInTheDocument();
  });

  it('closes reload dropdown when window loses focus (e.g. clicking on webpage)', () => {
    const { container } = render(<Header {...defaultProps} />);
    const reloadBtn = container.querySelector('[data-tooltip="Reload (Cmd+R)"]') as HTMLElement;
    fireEvent.contextMenu(reloadBtn);
    expect(screen.getByText('Hard Reload')).toBeInTheDocument();

    // Click outside on the webpage triggers window blur
    fireEvent.blur(window);
    expect(screen.queryByText('Hard Reload')).not.toBeInTheDocument();
  });

  it('does NOT render the top + (new tab) button', () => {
    const { container } = render(<Header {...defaultProps} />);
    expect(container.querySelector('[data-tooltip*="New Tab"]')).not.toBeInTheDocument();
  });

  it('uses bottom-left and bottom-right tooltip alignments to avoid screen edge clipping', () => {
    const { container } = render(<Header {...defaultProps} />);

    // Backward button on the left edge -> must use data-tooltip-pos="bottom-left"
    const backBtn = container.querySelector('[data-tooltip="Back"]');
    expect(backBtn).toHaveAttribute('data-tooltip-pos', 'bottom-left');

    // Reload button on the right edge -> must use data-tooltip-pos="bottom-right"
    const reloadBtn = container.querySelector('[data-tooltip="Reload (Cmd+R)"]');
    expect(reloadBtn).toHaveAttribute('data-tooltip-pos', 'bottom-right');

    // Copy URL button on the right edge -> must use data-tooltip-pos="bottom-right"
    const copyBtn = container.querySelector('[data-tooltip="Copy URL"]');
    expect(copyBtn).toHaveAttribute('data-tooltip-pos', 'bottom-right');
  });

  it('does NOT render sub-action bar buttons (search, collapse folders, settings)', () => {
    const { container } = render(<Header {...defaultProps} />);

    expect(container.querySelector('[data-tooltip*="Search"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-tooltip*="Collapse"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-tooltip*="Settings"]')).not.toBeInTheDocument();
  });

  it('renders small backward button in the url bar and triggers onGoBackActiveTab', () => {
    const { container } = render(<Header {...defaultProps} />);

    const backBtn = container.querySelector('[data-tooltip="Back"]') as HTMLElement;
    expect(backBtn).toBeInTheDocument();
    fireEvent.click(backBtn);

    expect(defaultProps.onGoBackActiveTab).toHaveBeenCalledTimes(1);
  });

  it('renders top progress bar without reloading text badge or spinning reload button when isActiveTabLoading is true', () => {
    const { container } = render(<Header {...defaultProps} isActiveTabLoading={true} />);

    // Glowing progress bar rendered at top
    expect(container.querySelector('.arctic-nav-progress')).toBeInTheDocument();

    // Reloading indicator text badge is omitted for a cleaner URL bar
    expect(screen.queryByText('Reloading')).not.toBeInTheDocument();

    // Reload button should not have animate-spin
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
  });
});
