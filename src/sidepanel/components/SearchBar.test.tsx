import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchBar } from './SearchBar';

describe('SearchBar Component', () => {
  it('auto-focuses input on mount and displays shortcut badge when query is empty', () => {
    render(
      <SearchBar
        searchQuery=""
        onSearchChange={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Filter tabs... (Esc to exit)');
    expect(input).toBeInTheDocument();
    expect(document.activeElement).toBe(input);
    expect(screen.getByText('K')).toBeInTheDocument();
    expect(screen.queryByTitle('Clear search')).not.toBeInTheDocument();
  });

  it('calls onSearchChange when typing and displays singular/plural match count', () => {
    const onSearchChange = vi.fn();
    const { rerender } = render(
      <SearchBar
        searchQuery="git"
        onSearchChange={onSearchChange}
        onClose={vi.fn()}
        matchCount={1}
      />
    );

    expect(screen.getByText('1 match')).toBeInTheDocument();

    rerender(
      <SearchBar
        searchQuery="git"
        onSearchChange={onSearchChange}
        onClose={vi.fn()}
        matchCount={4}
      />
    );

    expect(screen.getByText('4 matches')).toBeInTheDocument();

    const input = screen.getByPlaceholderText('Filter tabs... (Esc to exit)');
    fireEvent.change(input, { target: { value: 'github' } });
    expect(onSearchChange).toHaveBeenCalledWith('github');
  });

  it('clears search query when clicking the Clear search button', () => {
    const onSearchChange = vi.fn();
    render(
      <SearchBar
        searchQuery="docs"
        onSearchChange={onSearchChange}
        onClose={vi.fn()}
        matchCount={2}
      />
    );

    const clearBtn = screen.getByTitle('Clear search');
    fireEvent.click(clearBtn);
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  it('calls onClose when pressing Escape inside the input', () => {
    const onClose = vi.fn();
    render(
      <SearchBar
        searchQuery="test"
        onSearchChange={vi.fn()}
        onClose={onClose}
      />
    );

    const input = screen.getByPlaceholderText('Filter tabs... (Esc to exit)');
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
