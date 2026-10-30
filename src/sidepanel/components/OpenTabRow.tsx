import React, { useState } from 'react';
import { Globe, X, Volume2, VolumeX, Sparkles, FolderPlus, Copy, RotateCw, CopyPlus } from 'lucide-react';
import { getFaviconUrl } from '../utils/url';
import type { ContextMenuItem } from './ContextMenu';

interface OpenTabRowProps {
  tab: chrome.tabs.Tab;
  isActive: boolean;
  onFocus: (tabId: number) => void;
  onClose: (tabId: number, e: React.MouseEvent) => void;
  onPinToQuickAccess: (tab: chrome.tabs.Tab) => void;
  onPinToWorkspace: (tab: chrome.tabs.Tab) => void;
  onDuplicate: (tabId: number) => void;
  onReload: (tabId: number) => void;
  onToggleMute: (tab: chrome.tabs.Tab) => void;
  onOpenContextMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
}

export const OpenTabRow: React.FC<OpenTabRowProps> = ({
  tab,
  isActive,
  onFocus,
  onClose,
  onPinToQuickAccess,
  onPinToWorkspace,
  onDuplicate,
  onReload,
  onToggleMute,
  onOpenContextMenu
}) => {
  const [faviconError, setFaviconError] = useState(false);

  const tabId = tab.id;
  const isNewTab = !tab.url || tab.url.startsWith('chrome://newtab') || tab.url === 'about:blank';
  const titleText = tab.title || (isNewTab ? 'New Tab' : tab.url || 'Untitled Tab');
  const faviconSrc = tab.favIconUrl || (tab.url ? getFaviconUrl(tab.url, 32) : '');

  const isAudible = Boolean(tab.audible);
  const isMuted = Boolean(tab.mutedInfo?.muted);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (typeof tabId !== 'number') return;

    const items: ContextMenuItem[] = [
      {
        label: 'Pin to Quick Access',
        icon: <Sparkles className="w-3.5 h-3.5 text-cyan-400" />,
        action: () => onPinToQuickAccess(tab),
        disabled: !tab.url || isNewTab
      },
      {
        label: 'Pin to Workspace',
        icon: <FolderPlus className="w-3.5 h-3.5 text-amber-400" />,
        action: () => onPinToWorkspace(tab),
        disabled: !tab.url || isNewTab
      },
      {
        label: 'Copy URL',
        icon: <Copy className="w-3.5 h-3.5" />,
        action: () => {
          if (tab.url) navigator.clipboard.writeText(tab.url);
        },
        disabled: !tab.url || isNewTab,
        dividerBefore: true
      },
      {
        label: 'Reload Tab',
        icon: <RotateCw className="w-3.5 h-3.5" />,
        action: () => onReload(tabId)
      },
      {
        label: isMuted ? 'Unmute Tab' : 'Mute Tab',
        icon: isMuted ? <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> : <VolumeX className="w-3.5 h-3.5" />,
        action: () => onToggleMute(tab)
      },
      {
        label: 'Duplicate Tab',
        icon: <CopyPlus className="w-3.5 h-3.5" />,
        action: () => onDuplicate(tabId)
      },
      {
        label: 'Close Tab',
        icon: <X className="w-3.5 h-3.5 text-rose-400" />,
        action: () => onClose(tabId, e),
        danger: true,
        dividerBefore: true
      }
    ];

    onOpenContextMenu(e, items);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      title={`${titleText}\n${tab.url || ''}`}
      onClick={() => tabId && onFocus(tabId)}
      onContextMenu={handleContextMenu}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && tabId) {
          e.preventDefault();
          onFocus(tabId);
        }
      }}
      className={`group relative flex items-center justify-between h-[34px] px-2.5 my-[1px] rounded-lg cursor-pointer select-none transition-all duration-150 outline-none ${
        isActive
          ? 'bg-white/15 text-white font-medium shadow-[0_1px_3px_rgba(0,0,0,0.3)] backdrop-blur-md'
          : 'text-zinc-300 hover:text-white hover:bg-white/5'
      }`}
    >
      {/* Left: Favicon & Title */}
      <div className="flex items-center min-w-0 flex-1 space-x-2 mr-2">
        <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
          {!faviconError && faviconSrc ? (
            <img
              src={faviconSrc}
              alt=""
              onError={() => setFaviconError(true)}
              className="w-4 h-4 object-contain rounded-sm"
            />
          ) : (
            <Globe className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-400" />
          )}
        </div>

        <span
          className={`truncate text-[13px] leading-tight transition-colors duration-150 ${
            isActive ? 'text-white' : 'text-zinc-300 group-hover:text-white'
          }`}
        >
          {titleText}
        </span>
      </div>

      {/* Right: Audio Indicator & Close Button */}
      <div className="flex items-center space-x-1.5 flex-shrink-0">
        {/* Audio status */}
        {(isAudible || isMuted) && (
          <button
            type="button"
            title={isMuted ? 'Tab is muted' : 'Tab is playing audio'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleMute(tab);
            }}
            className="p-0.5 rounded text-zinc-400 hover:text-white"
          >
            {isMuted ? (
              <VolumeX className="w-3 h-3 text-zinc-500" />
            ) : (
              <Volume2 className="w-3 h-3 text-cyan-400 animate-pulse" />
            )}
          </button>
        )}

        {/* Close Button on hover */}
        {typeof tabId === 'number' && (
          <button
            type="button"
            title="Close tab (Cmd+W)"
            onClick={(e) => onClose(tabId, e)}
            className="flex items-center justify-center w-4 h-4 rounded text-zinc-500 hover:text-white hover:bg-white/20 transition-all duration-100"
          >
            <X className="w-3 h-3 stroke-[2.5]" />
          </button>
        )}
      </div>
    </div>
  );
};
