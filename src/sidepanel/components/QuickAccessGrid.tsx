import React, { useState } from 'react';
import { Globe, RotateCcw } from 'lucide-react';
import type { TabBinding } from '../../types';
import { getFaviconUrl } from '../utils/url';

interface QuickAccessGridProps {
  bookmarks: chrome.bookmarks.BookmarkTreeNode[];
  bindingsByBookmarkId: Record<string, TabBinding>;
  activeTabId: number | null;
  onTileClick: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
}

export const QuickAccessGrid: React.FC<QuickAccessGridProps> = ({
  bookmarks,
  bindingsByBookmarkId,
  activeTabId,
  onTileClick
}) => {
  // Filter only items that are URLs
  const items = bookmarks.filter((b) => Boolean(b.url));

  if (items.length === 0) {
    return (
      <div className="px-3 py-3 rounded-xl border border-dashed border-white/10 bg-white/[0.02] text-center">
        <p className="text-xs text-zinc-500">
          No Quick Access favorites yet.
        </p>
        <p className="text-[11px] text-zinc-600 mt-0.5">
          Bookmarks placed in &quot;Quick Access&quot; appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-1.5 w-full">
      {items.map((bookmark) => (
        <QuickAccessTile
          key={bookmark.id}
          bookmark={bookmark}
          binding={bindingsByBookmarkId[bookmark.id]}
          activeTabId={activeTabId}
          onTileClick={onTileClick}
        />
      ))}
    </div>
  );
};

interface QuickAccessTileProps {
  bookmark: chrome.bookmarks.BookmarkTreeNode;
  binding?: TabBinding;
  activeTabId: number | null;
  onTileClick: (bookmark: chrome.bookmarks.BookmarkTreeNode) => void;
}

const QuickAccessTile: React.FC<QuickAccessTileProps> = ({
  bookmark,
  binding,
  activeTabId,
  onTileClick
}) => {
  const [faviconError, setFaviconError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const isActive = Boolean(binding && binding.tabId === activeTabId);
  const isRunningInBackground = Boolean(binding && binding.tabId !== activeTabId);
  const isNavAway = binding?.isNavigatedAway ?? false;

  const titleText = bookmark.title || bookmark.url || 'Favorite';
  const faviconSrc = bookmark.url ? getFaviconUrl(bookmark.url, 48) : '';

  let tooltip = titleText;
  if (isActive && isNavAway) {
    tooltip = `${titleText} (Navigated away: click to reset to original bookmark)`;
  } else if (isNavAway && binding) {
    tooltip = `${titleText}\n↳ Current: ${binding.currentTitle || binding.currentUrl}`;
  }

  return (
    <button
      type="button"
      title={tooltip}
      onClick={() => onTileClick(bookmark)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative flex flex-col items-center justify-center h-12 rounded-xl transition-all duration-150 select-none outline-none ${
        isActive
          ? 'bg-white/15 border border-blue-400/40 shadow-[0_0_12px_rgba(59,130,246,0.3)] text-white'
          : isRunningInBackground
          ? 'bg-white/[0.07] border border-white/10 hover:bg-white/12 text-zinc-200'
          : 'bg-white/[0.03] border border-white/5 hover:bg-white/[0.08] hover:border-white/10 text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {/* Favicon or Reset Icon */}
      <div className="relative w-5 h-5 flex items-center justify-center">
        {/* Reset Icon when Active and Navigated Away (on hover) */}
        {isActive && isNavAway && isHovered ? (
          <RotateCcw className="w-4 h-4 text-amber-300 animate-spin-reverse stroke-[2.5]" />
        ) : !faviconError && faviconSrc ? (
          <img
            src={faviconSrc}
            alt=""
            onError={() => setFaviconError(true)}
            className="w-5 h-5 object-contain rounded-[4px] drop-shadow-sm transition-transform group-hover:scale-105"
          />
        ) : (
          <Globe className="w-4 h-4 text-zinc-400 group-hover:text-zinc-200" />
        )}

        {/* Small drifted dot indicator if navigated away & not hovering */}
        {isNavAway && !(isActive && isHovered) && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-[#1c1c1f]" />
        )}
      </div>

      {/* Background Tab Running Dot (bottom center) */}
      {isRunningInBackground && (
        <span className="absolute bottom-1 w-1 h-1 rounded-full bg-zinc-400/70" />
      )}

      {/* Active Tab Glow Bar (bottom center) */}
      {isActive && (
        <span className="absolute bottom-1 w-3 h-0.5 rounded-full bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.8)]" />
      )}
    </button>
  );
};
