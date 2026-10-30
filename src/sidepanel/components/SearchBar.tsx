import React, { useRef, useEffect } from 'react';
import { Search, X, Command } from 'lucide-react';

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onClose: () => void;
  matchCount?: number;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  searchQuery,
  onSearchChange,
  onClose,
  matchCount
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="relative flex items-center w-full px-2.5 py-1.5 bg-[#18181c] border-b border-white/[0.08] animate-in fade-in slide-in-from-top-1 duration-150">
      <Search className="w-3.5 h-3.5 text-zinc-400 mr-2 flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onClose();
          }
        }}
        placeholder="Filter bookmarks & tabs... (Esc to exit)"
        className="flex-1 bg-transparent text-xs text-white placeholder-zinc-500 focus:outline-none"
      />

      {searchQuery && typeof matchCount === 'number' && (
        <span className="text-[10px] text-zinc-500 font-mono mr-2">
          {matchCount} {matchCount === 1 ? 'match' : 'matches'}
        </span>
      )}

      {searchQuery ? (
        <button
          type="button"
          title="Clear search"
          onClick={() => {
            onSearchChange('');
            inputRef.current?.focus();
          }}
          className="p-0.5 rounded text-zinc-400 hover:text-white"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      ) : (
        <span className="flex items-center space-x-0.5 text-[10px] text-zinc-500 bg-white/5 border border-white/10 px-1 py-0.5 rounded">
          <Command className="w-2.5 h-2.5" />
          <span>K</span>
        </span>
      )}
    </div>
  );
};
