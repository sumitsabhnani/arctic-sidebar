import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

describe('ContextMenu component', () => {
  it('renders menu items and triggers actions on click', () => {
    const handleAction = vi.fn();
    const handleClose = vi.fn();

    const items: ContextMenuItem[] = [
      { label: 'Copy Link', action: handleAction },
      { label: 'Disabled Action', action: vi.fn(), disabled: true },
      { label: 'Delete', action: vi.fn(), danger: true, dividerBefore: true }
    ];

    render(<ContextMenu x={100} y={100} items={items} onClose={handleClose} />);

    expect(screen.getByText('Copy Link')).toBeInTheDocument();
    expect(screen.getByText('Disabled Action')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();

    // Click regular action
    fireEvent.click(screen.getByText('Copy Link'));
    expect(handleAction).toHaveBeenCalledTimes(1);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('prevents clicking disabled items (negative scenario)', () => {
    const disabledAction = vi.fn();
    const handleClose = vi.fn();

    const items: ContextMenuItem[] = [
      { label: 'Disabled Item', action: disabledAction, disabled: true }
    ];

    render(<ContextMenu x={50} y={50} items={items} onClose={handleClose} />);
    const btn = screen.getByText('Disabled Item').closest('button')!;
    expect(btn).toBeDisabled();

    fireEvent.click(btn);
    expect(disabledAction).not.toHaveBeenCalled();
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('supports expandable submenus for Move to Space', () => {
    const handleSubAction = vi.fn();
    const handleClose = vi.fn();

    const items: ContextMenuItem[] = [
      {
        label: 'Move to Space',
        submenu: [
          { label: 'Work Space', action: handleSubAction },
          { label: 'Personal Space', action: vi.fn() }
        ]
      }
    ];

    render(<ContextMenu x={50} y={50} items={items} onClose={handleClose} />);

    // Submenu is initially not visible
    expect(screen.queryByText('Work Space')).not.toBeInTheDocument();

    // Click parent item to expand submenu
    fireEvent.click(screen.getByText('Move to Space'));
    expect(screen.getByText('Work Space')).toBeInTheDocument();
    expect(screen.getByText('Personal Space')).toBeInTheDocument();

    // Click child option
    fireEvent.click(screen.getByText('Work Space'));
    expect(handleSubAction).toHaveBeenCalledTimes(1);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('closes menu when Escape key is pressed', () => {
    const handleClose = vi.fn();
    render(<ContextMenu x={50} y={50} items={[{ label: 'Item 1', action: vi.fn() }]} onClose={handleClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
