import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpacesSwitcher } from './SpacesSwitcher';
import type { SpaceItem } from '../../types';

describe('SpacesSwitcher component', () => {
  const mockSpaces: SpaceItem[] = [
    { id: 'home', name: 'Home', folderId: '10', icon: 'home' },
    { id: 'work', name: 'Work', folderId: '11', icon: 'briefcase' },
    { id: 'personal', name: 'Personal', folderId: '12', icon: 'user' }
  ];

  const defaultProps = {
    spaces: mockSpaces,
    activeSpaceId: 'home',
    onSelectSpace: vi.fn(),
    onCreateSpace: vi.fn(),
    onRenameSpace: vi.fn(),
    onDeleteSpace: vi.fn(),
    onDropItemToSpace: vi.fn(),
    onOpenContextMenu: vi.fn()
  };

  it('renders all space tabs and marks the active space', () => {
    render(<SpacesSwitcher {...defaultProps} />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument();

    const homeBtn = screen.getByText('Home').closest('button');
    expect(homeBtn).toHaveClass('theme-active-card');
  });

  it('switches space on click', () => {
    render(<SpacesSwitcher {...defaultProps} />);
    const workBtn = screen.getByText('Work').closest('button')!;
    fireEvent.click(workBtn);

    expect(defaultProps.onSelectSpace).toHaveBeenCalledWith('work');
  });

  it('opens new space form, selects icon and submits new space', () => {
    render(<SpacesSwitcher {...defaultProps} />);
    const addBtn = screen.getByTitle('Add New Space');
    fireEvent.click(addBtn);

    const input = screen.getByPlaceholderText(/Space name/i);
    expect(input).toBeInTheDocument();

    // Select 'Dev' icon
    const devIconBtn = screen.getByTitle('Dev');
    fireEvent.click(devIconBtn);

    fireEvent.change(input, { target: { value: 'Study & Research' } });
    fireEvent.submit(input.closest('form')!);

    expect(defaultProps.onCreateSpace).toHaveBeenCalledWith('Study & Research', 'code');
  });

  it('triggers right-click context menu with rename and delete options', () => {
    render(<SpacesSwitcher {...defaultProps} />);
    const workBtn = screen.getByText('Work').closest('button')!;
    fireEvent.contextMenu(workBtn);

    expect(defaultProps.onOpenContextMenu).toHaveBeenCalled();
    const contextMenuItems = defaultProps.onOpenContextMenu.mock.calls[0][1];
    expect(contextMenuItems.some((item: { label: string }) => item.label.includes('Rename "Work"'))).toBe(true);
    expect(contextMenuItems.some((item: { label: string }) => item.label.includes('Remove "Work" Space'))).toBe(true);
  });

  it('handles item drop onto a space tab', () => {
    render(<SpacesSwitcher {...defaultProps} />);
    const personalBtn = screen.getByText('Personal').closest('button')!;

    const dropData = JSON.stringify({ type: 'openTab', tabId: 42, url: 'https://example.com' });
    fireEvent.drop(personalBtn, {
      dataTransfer: {
        getData: (type: string) => (type === 'application/json' ? dropData : '')
      }
    });

    expect(defaultProps.onDropItemToSpace).toHaveBeenCalledWith(
      { type: 'openTab', tabId: 42, url: 'https://example.com' },
      '12'
    );
  });
});
