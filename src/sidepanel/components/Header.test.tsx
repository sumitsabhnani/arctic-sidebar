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
  });

  it('does NOT render the top + (new tab) button', () => {
    const { container } = render(<Header {...defaultProps} />);
    expect(container.querySelector('[data-tooltip*="New Tab"]')).not.toBeInTheDocument();
  });

  it('uses bottom-left and bottom-right tooltip alignments to avoid screen edge clipping', () => {
    const { container } = render(<Header {...defaultProps} />);

    // Search button is on the left edge -> must use data-tooltip-pos="bottom-left"
    const searchBtn = container.querySelector('[data-tooltip="Search (Cmd+K)"]');
    expect(searchBtn).toHaveAttribute('data-tooltip-pos', 'bottom-left');

    // Reload button on the right edge -> must use data-tooltip-pos="bottom-right"
    const reloadBtn = container.querySelector('[data-tooltip="Reload (Cmd+R)"]');
    expect(reloadBtn).toHaveAttribute('data-tooltip-pos', 'bottom-right');

    // Settings button on the right edge -> must use data-tooltip-pos="bottom-right"
    const settingsBtn = container.querySelector('[data-tooltip*="Settings"]');
    expect(settingsBtn).toHaveAttribute('data-tooltip-pos', 'bottom-right');
  });

  it('toggles settings panel and includes Theme & Appearance with Dark/Light toggle and color themes', () => {
    const { container } = render(<Header {...defaultProps} />);

    // Settings is initially closed
    expect(screen.queryByText('Folder Mapping')).not.toBeInTheDocument();

    // Open settings
    const settingsBtn = container.querySelector('[data-tooltip*="Settings"]') as HTMLElement;
    fireEvent.click(settingsBtn);

    expect(screen.getByText('Folder Mapping')).toBeInTheDocument();
    expect(screen.getByText('Theme & Appearance')).toBeInTheDocument();

    // Dark/Light buttons are present together in settings
    const lightBtn = screen.getByRole('button', { name: /Light/i });
    const darkBtn = screen.getByRole('button', { name: /Dark/i });
    expect(lightBtn).toBeInTheDocument();
    expect(darkBtn).toBeInTheDocument();

    // Toggle theme
    fireEvent.click(lightBtn);
    expect(defaultProps.onToggleTheme).toHaveBeenCalled();

    // Select color theme
    const midnightBtn = screen.getByText('Midnight Amethyst');
    fireEvent.click(midnightBtn);
    expect(defaultProps.onSelectColorTheme).toHaveBeenCalledWith('midnight-amethyst');
  });
});
