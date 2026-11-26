import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScratchpadDrawer, ScratchpadPanel } from './ScratchpadDrawer';

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

  it('renders header, character counter, and textarea when open, omitting Synced badge', () => {
    render(<ScratchpadDrawer {...defaultProps} />);

    expect(screen.getByText('Scratchpad')).toBeInTheDocument();
    expect(screen.queryByText('Synced')).not.toBeInTheDocument();
    expect(screen.getByText('23 / 28,000')).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/Quick notes, URLs, or snippets/i);
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue('Test scratchpad content');
  });

  it('renders Saving... badge when syncStatus is Saving...', () => {
    render(<ScratchpadDrawer {...defaultProps} syncStatus="Saving..." />);

    expect(screen.getByText('Saving...')).toBeInTheDocument();
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

  it('calls onClose when minimize button is clicked', () => {
    render(<ScratchpadDrawer {...defaultProps} />);

    const minimizeBtn = screen.getByTitle(/Minimize Scratchpad/i);
    fireEvent.click(minimizeBtn);

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

  it('ignores Escape key while IME composition is active', () => {
    const onClose = vi.fn();
    render(<ScratchpadDrawer {...defaultProps} onClose={onClose} />);

    const textarea = screen.getByPlaceholderText(/Quick notes, URLs, or snippets/i);
    fireEvent.keyDown(textarea, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(textarea, { key: 'Escape', keyCode: 229 });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Escape', isComposing: false });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ScratchpadPanel isolates keystroke re-renders from parent once non-empty', () => {
    let parentRenderCount = 0;
    const onClose = vi.fn();

    const ParentHost: React.FC = () => {
      parentRenderCount += 1;
      const [hasText, setHasText] = useState(false);
      return (
        <div>
          <span data-testid="has-text">{String(hasText)}</span>
          <ScratchpadPanel isOpen={true} onClose={onClose} onHasTextChange={setHasText} />
        </div>
      );
    };

    render(<ParentHost />);
    const textarea = screen.getByPlaceholderText(/Quick notes, URLs, or snippets/i);
    expect(screen.getByTestId('has-text')).toHaveTextContent('false');

    // Transition empty -> non-empty updates parent once
    fireEvent.change(textarea, { target: { value: 'a' } });
    expect(screen.getByTestId('has-text')).toHaveTextContent('true');
    const rendersAfterFirstChar = parentRenderCount;

    // Subsequent keystrokes keep hasText === true and never re-render ParentHost
    fireEvent.change(textarea, { target: { value: 'ab' } });
    fireEvent.change(textarea, { target: { value: 'abc' } });
    fireEvent.change(textarea, { target: { value: 'abcd' } });
    expect(textarea).toHaveValue('abcd');
    expect(parentRenderCount).toBe(rendersAfterFirstChar);
  });
});
