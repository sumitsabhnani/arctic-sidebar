import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ScratchpadDrawer } from './ScratchpadDrawer';

describe('ScratchpadDrawer component', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    text: 'Test scratchpad content',
    onChange: vi.fn(),
    syncStatus: 'Synced' as const,
    onClear: vi.fn(),
    maxChars: 28000
  };

  it('renders header, sync badge, character counter, and textarea when open', () => {
    render(<ScratchpadDrawer {...defaultProps} />);

    expect(screen.getByText('Scratchpad')).toBeInTheDocument();
    expect(screen.getByText('Synced')).toBeInTheDocument();
    expect(screen.getByText('23 / 28,000')).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/Quick notes, URLs, or snippets/i);
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue('Test scratchpad content');
  });

  it('returns null when isOpen is false', () => {
    const { container } = render(<ScratchpadDrawer {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('handles typing and propagates changes to onChange', () => {
    render(<ScratchpadDrawer {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(/Quick notes, URLs, or snippets/i);
    fireEvent.change(textarea, { target: { value: 'Updated notes' } });

    expect(defaultProps.onChange).toHaveBeenCalledWith('Updated notes');
  });

  it('calls onClose when Escape key is pressed', () => {
    render(<ScratchpadDrawer {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(/Quick notes, URLs, or snippets/i);
    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onClose when close button is clicked', () => {
    render(<ScratchpadDrawer {...defaultProps} />);

    const closeBtn = screen.getByTitle(/Close Scratchpad/i);
    fireEvent.click(closeBtn);

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('confirms and calls onClear when Clear button is clicked', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ScratchpadDrawer {...defaultProps} />);

    const clearBtn = screen.getByTitle(/Clear Scratchpad/i);
    fireEvent.click(clearBtn);

    expect(window.confirm).toHaveBeenCalled();
    expect(defaultProps.onClear).toHaveBeenCalled();
  });

  it('copies text when Copy All button is clicked', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock
      }
    });

    render(<ScratchpadDrawer {...defaultProps} />);

    const copyBtn = screen.getByTitle(/Copy All/i);
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeTextMock).toHaveBeenCalledWith('Test scratchpad content');
  });
});
