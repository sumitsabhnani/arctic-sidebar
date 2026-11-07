import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';

describe('SettingsModal component', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    theme: 'dark' as const,
    colorTheme: 'glacier-blue' as const,
    quickAccessDensity: 'relaxed' as const,
    tabsDensity: 'relaxed' as const,
    showMemorySaverBar: true,
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
    onToggleTheme: vi.fn(),
    onSelectColorTheme: vi.fn(),
    onToggleQuickAccessDensity: vi.fn(),
    onToggleTabsDensity: vi.fn(),
    onToggleMemorySaverBar: vi.fn(),
    onSelectQuickAccessFolder: vi.fn(),
    onSelectWorkspaceFolder: vi.fn(),
    onResetFolders: vi.fn(),
    onSetAutoArchiveInterval: vi.fn(),
    onDiscardAllBackgroundTabs: vi.fn()
  };

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<SettingsModal {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders settings sections when isOpen is true', () => {
    render(<SettingsModal {...defaultProps} />);
    expect(screen.getByText('Settings & Appearance')).toBeInTheDocument();
    expect(screen.getByText('Theme & Appearance')).toBeInTheDocument();
    expect(screen.getByText('Quick Access Density')).toBeInTheDocument();
    expect(screen.getByText('Tabs Density')).toBeInTheDocument();
    expect(screen.getByText('Memory Saver Status Bar')).toBeInTheDocument();
    expect(screen.getByText('Folder Mapping')).toBeInTheDocument();
  });

  it('allows toggling dark and light mode', () => {
    render(<SettingsModal {...defaultProps} />);
    const lightBtn = screen.getByRole('button', { name: /Light/i });
    fireEvent.click(lightBtn);
    expect(defaultProps.onToggleTheme).toHaveBeenCalled();
  });

  it('allows selecting a color theme', () => {
    render(<SettingsModal {...defaultProps} />);
    const midnightBtn = screen.getByText('Midnight Amethyst');
    fireEvent.click(midnightBtn);
    expect(defaultProps.onSelectColorTheme).toHaveBeenCalledWith('midnight-amethyst');
  });

  it('allows switching between relaxed and compact density modes separately', () => {
    render(<SettingsModal {...defaultProps} />);
    const compactButtons = screen.getAllByRole('button', { name: 'Compact' });
    expect(compactButtons.length).toBe(2);

    // Toggle Quick Access density
    fireEvent.click(compactButtons[0]);
    expect(defaultProps.onToggleQuickAccessDensity).toHaveBeenCalledWith('compact');

    // Toggle Tabs & Bookmarks density
    fireEvent.click(compactButtons[1]);
    expect(defaultProps.onToggleTabsDensity).toHaveBeenCalledWith('compact');
  });

  it('allows toggling the memory saver status bar', () => {
    render(<SettingsModal {...defaultProps} />);
    const switchBtn = screen.getByRole('switch');
    fireEvent.click(switchBtn);
    expect(defaultProps.onToggleMemorySaverBar).toHaveBeenCalledWith(false);
  });

  it('triggers onDiscardAllBackgroundTabs and displays confirmation feedback', async () => {
    const onDiscard = vi.fn().mockResolvedValue(3);
    render(<SettingsModal {...defaultProps} onDiscardAllBackgroundTabs={onDiscard} />);
    const hibernateBtn = screen.getByRole('button', { name: 'Hibernate Tabs' });
    fireEvent.click(hibernateBtn);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Hibernated 3 background tabs/i)).toBeInTheDocument();
  });

  it('renders Sidebar Position section and clicking Open Settings opens Chrome Appearance', () => {
    render(<SettingsModal {...defaultProps} />);
    expect(screen.getByText('Sidebar Position (Left / Right)')).toBeInTheDocument();
    expect(screen.getByText(/Chrome places side panels on the right by default/i)).toBeInTheDocument();

    const openSettingsBtn = screen.getByRole('button', { name: /Open Settings/i });
    fireEvent.click(openSettingsBtn);

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome://settings/appearance' });
  });
});
