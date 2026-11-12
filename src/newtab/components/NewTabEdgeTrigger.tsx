import React, { useEffect, useRef, useState } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';
import type {
  ColorThemeId,
  EdgeFolderNode,
  EdgeQuickAccessItem,
  EdgeSpaceNode,
  EdgeTriggerMode,
  ThemeMode
} from '../../types';
import { resolveEffectiveTheme } from '../../sidepanel/utils/theme';
import { getFaviconUrl } from '../../sidepanel/utils/url';

interface NewTabEdgeTriggerProps {
  theme: ThemeMode;
  colorTheme: ColorThemeId;
  windowIdRef: React.MutableRefObject<number | null>;
}

function getMonogram(title: string, url: string): string {
  const cleanTitle = (title || '').trim();
  if (cleanTitle) {
    const match = cleanTitle.match(/[A-Za-z0-9]/);
    if (match) return match[0].toUpperCase();
  }
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '');
    if (host) return host.charAt(0).toUpperCase();
  } catch {
    // ignore
  }
  return '•';
}

function findFolderById(nodes: EdgeSpaceNode[], targetId: string): EdgeFolderNode | null {
  for (const n of nodes) {
    if (n.type === 'folder') {
      if (n.id === targetId) return n;
      const nested = findFolderById(n.children, targetId);
      if (nested) return nested;
    }
  }
  return null;
}

export const NewTabEdgeTrigger: React.FC<NewTabEdgeTriggerProps> = ({
  theme,
  windowIdRef
}) => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [mode, setMode] = useState<EdgeTriggerMode>('push');
  const [isHoverExpanded, setIsHoverExpanded] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [dockSide, setDockSide] = useState<'left' | 'right'>('left');
  const [openWindowIds, setOpenWindowIds] = useState<number[]>([]);
  const [resolvedWindowId, setResolvedWindowId] = useState<number | null>(null);
  const [quickAccessItems, setQuickAccessItems] = useState<EdgeQuickAccessItem[]>([]);
  const [spaceItems, setSpaceItems] = useState<EdgeSpaceNode[]>([]);
  const [failedFavicons, setFailedFavicons] = useState<Record<string, boolean>>({});
  const [tooltip, setTooltip] = useState<{ text: string; top: number } | null>(null);
  const [openFolder, setOpenFolder] = useState<{ id: string; top: number } | null>(null);
  const [expandedSubfolders, setExpandedSubfolders] = useState<Record<string, boolean>>({});
  const [isOptimisticallyOpening, setIsOptimisticallyOpening] = useState(false);

  const resolvedWindowIdRef = useRef<number | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const hoverCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    resolvedWindowIdRef.current = resolvedWindowId ?? windowIdRef.current;
  }, [resolvedWindowId, windowIdRef]);

  useEffect(() => {
    let unmounted = false;

    if (chrome?.windows?.getCurrent) {
      Promise.resolve(chrome.windows.getCurrent())
        .then((win) => {
          if (!unmounted && win && typeof win.id === 'number') {
            resolvedWindowIdRef.current = win.id;
            setResolvedWindowId(win.id);
          }
        })
        .catch(() => {});
    }

    chrome?.storage?.local?.get?.(
      ['edgeTriggerEnabled', 'edgeTriggerMode', 'sidebarDockSide'],
      (res) => {
        if (unmounted) return;
        if (typeof res?.edgeTriggerEnabled === 'boolean') {
          setIsEnabled(res.edgeTriggerEnabled);
        }
        if (res?.edgeTriggerMode === 'push' || res?.edgeTriggerMode === 'hover') {
          setMode(res.edgeTriggerMode);
        }
        if (res?.sidebarDockSide === 'left' || res?.sidebarDockSide === 'right') {
          setDockSide(res.sidebarDockSide);
        }
      }
    );

    chrome?.storage?.session?.get?.(['openSidePanelWindowIds'], (res) => {
      if (unmounted) return;
      if (Array.isArray(res?.openSidePanelWindowIds)) {
        setOpenWindowIds(res.openSidePanelWindowIds as number[]);
      }
      setIsInitialized(true);
    });

    try {
      chrome?.runtime?.sendMessage?.({ type: 'GET_EDGE_TRIGGER_STATE' }, (resp) => {
        void chrome.runtime?.lastError;
        if (unmounted || !resp || typeof resp !== 'object') return;
        if (typeof resp.windowId === 'number') {
          resolvedWindowIdRef.current = resp.windowId;
          setResolvedWindowId(resp.windowId);
        }
        if (Array.isArray(resp.openWindowIds)) {
          setOpenWindowIds(resp.openWindowIds as number[]);
        }
        if (resp.side === 'left' || resp.side === 'right') {
          setDockSide(resp.side);
        }
        if (resp.mode === 'push' || resp.mode === 'hover') {
          setMode(resp.mode);
        }
        if (Array.isArray(resp.quickAccessItems)) {
          setQuickAccessItems(resp.quickAccessItems as EdgeQuickAccessItem[]);
        }
        if (Array.isArray(resp.spaceItems)) {
          setSpaceItems(resp.spaceItems as EdgeSpaceNode[]);
        }
        setIsInitialized(true);
      });
    } catch {
      // ignore
    }

    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'session' && changes.openSidePanelWindowIds) {
        const next = changes.openSidePanelWindowIds.newValue;
        setOpenWindowIds(Array.isArray(next) ? (next as number[]) : []);
        setIsOptimisticallyOpening(false);
      } else if (areaName === 'local') {
        if (changes.edgeTriggerEnabled !== undefined) {
          setIsEnabled(Boolean(changes.edgeTriggerEnabled.newValue));
        }
        if (
          changes.edgeTriggerMode?.newValue === 'push' ||
          changes.edgeTriggerMode?.newValue === 'hover'
        ) {
          setMode(changes.edgeTriggerMode.newValue);
          setIsHoverExpanded(false);
        }
        if (
          changes.sidebarDockSide?.newValue === 'left' ||
          changes.sidebarDockSide?.newValue === 'right'
        ) {
          setDockSide(changes.sidebarDockSide.newValue);
        }
      }
    };

    const handleRuntimeMessage = (message: {
      type?: string;
      windowId?: number;
      isSidePanelOpen?: boolean;
      openWindowIds?: number[];
      quickAccessItems?: EdgeQuickAccessItem[];
      spaceItems?: EdgeSpaceNode[];
    }) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ARCTIC_SIDEPANEL_VISIBILITY') {
        const myWin = resolvedWindowIdRef.current;
        if (typeof message.windowId === 'number' && myWin !== null && message.windowId !== myWin) {
          return;
        }
        if (typeof message.windowId === 'number' && myWin === null) {
          resolvedWindowIdRef.current = message.windowId;
          setResolvedWindowId(message.windowId);
        }
        if (Array.isArray(message.openWindowIds)) {
          setOpenWindowIds(message.openWindowIds);
        }
        if (!message.isSidePanelOpen) {
          if (Array.isArray(message.quickAccessItems)) {
            setQuickAccessItems(message.quickAccessItems);
          }
          if (Array.isArray(message.spaceItems)) {
            setSpaceItems(message.spaceItems);
          }
        }
        if (message.isSidePanelOpen === true) {
          setIsOptimisticallyOpening(false);
          setOpenFolder(null);
        }
      } else if (message.type === 'ARCTIC_EDGE_ITEMS_UPDATED') {
        const myWin = resolvedWindowIdRef.current;
        if (typeof message.windowId === 'number' && myWin !== null && message.windowId !== myWin) {
          return;
        }
        if (Array.isArray(message.quickAccessItems)) {
          setQuickAccessItems(message.quickAccessItems);
        }
        if (Array.isArray(message.spaceItems)) {
          setSpaceItems(message.spaceItems);
        }
      } else if (message.type === 'ARCTIC_REMOVE_EDGE_TRIGGER') {
        setIsEnabled(false);
        setOpenFolder(null);
      }
    };

    chrome?.storage?.onChanged?.addListener(handleStorageChange);
    chrome?.runtime?.onMessage?.addListener(handleRuntimeMessage);
    return () => {
      unmounted = true;
      chrome?.storage?.onChanged?.removeListener(handleStorageChange);
      chrome?.runtime?.onMessage?.removeListener(handleRuntimeMessage);
    };
  }, [windowIdRef]);

  // Dismiss folder flyout on outside click or Escape
  useEffect(() => {
    if (!openFolder) return;

    const handlePointerDown = (e: PointerEvent | MouseEvent) => {
      if (!(e.target instanceof Node)) {
        setOpenFolder(null);
        return;
      }
      if (flyoutRef.current?.contains(e.target)) return;
      if (railRef.current?.contains(e.target)) return;
      setOpenFolder(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenFolder(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [openFolder]);

  const winId = resolvedWindowId ?? windowIdRef.current;
  const hasWinId = typeof winId === 'number';
  const isSidePanelOpen = hasWinId && openWindowIds.includes(winId);
  const isVisible =
    isInitialized && hasWinId && isEnabled && !isSidePanelOpen && !isOptimisticallyOpening;

  // Shift New Tab root container in 'push' mode so the 36px stripe never overlaps content
  useEffect(() => {
    if (!isVisible || mode !== 'push') return;
    const prop = dockSide === 'left' ? 'paddingLeft' : 'paddingRight';
    const prev = document.documentElement.style[prop];
    document.documentElement.style[prop] = '36px';
    return () => {
      document.documentElement.style[prop] = prev;
    };
  }, [isVisible, mode, dockSide]);

  // Clear pending hover-collapse timer on unmount or when hidden
  useEffect(() => {
    if (!isVisible) {
      setIsHoverExpanded(false);
    }
    return () => {
      if (hoverCollapseTimerRef.current) {
        clearTimeout(hoverCollapseTimerRef.current);
        hoverCollapseTimerRef.current = null;
      }
    };
  }, [isVisible]);

  // Track cursor while expanded in 'hover' mode so quick darts across the 5px sensor
  // always collapse cleanly on the first hover-out even if rail.mouseenter never fired
  useEffect(() => {
    if (!isVisible || mode !== 'hover' || !isHoverExpanded || openFolder !== null) return;

    const handleMouseMove = (e: MouseEvent) => {
      const inZone =
        dockSide === 'left'
          ? e.clientX <= 40
          : e.clientX >= (window.innerWidth || 0) - 40;
      const inRail = Boolean(e.target instanceof Node && railRef.current?.contains(e.target));

      if (inZone || inRail) {
        if (hoverCollapseTimerRef.current) {
          clearTimeout(hoverCollapseTimerRef.current);
          hoverCollapseTimerRef.current = null;
        }
      } else if (!hoverCollapseTimerRef.current) {
        hoverCollapseTimerRef.current = setTimeout(() => {
          hoverCollapseTimerRef.current = null;
          setIsHoverExpanded(false);
          setTooltip(null);
        }, 150);
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isVisible, mode, isHoverExpanded, openFolder, dockSide]);

  if (!isVisible) {
    return null;
  }

  const effectiveTheme = resolveEffectiveTheme(theme);
  const isLeft = dockSide === 'left';
  const isExpanded = mode === 'push' || isHoverExpanded || openFolder !== null;

  const handleExpandHover = () => {
    if (hoverCollapseTimerRef.current) {
      clearTimeout(hoverCollapseTimerRef.current);
      hoverCollapseTimerRef.current = null;
    }
    setIsHoverExpanded(true);
  };

  const handleScheduleCollapseHover = () => {
    if (hoverCollapseTimerRef.current) {
      clearTimeout(hoverCollapseTimerRef.current);
    }
    hoverCollapseTimerRef.current = setTimeout(() => {
      hoverCollapseTimerRef.current = null;
      setIsHoverExpanded(false);
      setTooltip(null);
    }, 150);
  };

  const handleOpenSidePanel = () => {
    setTooltip(null);
    setOpenFolder(null);
    setIsOptimisticallyOpening(true);
    const targetWinId = windowIdRef.current ?? resolvedWindowId;

    if (typeof targetWinId === 'number' && chrome?.sidePanel?.open) {
      chrome.sidePanel.open({ windowId: targetWinId }).catch(() => {
        setIsOptimisticallyOpening(false);
      });
      return;
    }

    try {
      chrome?.runtime?.sendMessage?.({ type: 'OPEN_SIDE_PANEL_FROM_EDGE' }, (resp) => {
        if (!resp || resp.ok !== true) {
          setIsOptimisticallyOpening(false);
        }
      });
    } catch {
      setIsOptimisticallyOpening(false);
    }
  };

  const handleBookmarkClick = (bookmarkId: string, forceReset = false) => {
    setTooltip(null);
    setOpenFolder(null);
    try {
      chrome?.runtime?.sendMessage?.({
        type: 'ACTIVATE_QUICK_ACCESS_FROM_EDGE',
        bookmarkId,
        windowId: winId ?? undefined,
        forceReset
      });
    } catch {
      // ignore
    }
  };

  const showTip = (el: HTMLElement, text: string) => {
    const rect = el.getBoundingClientRect();
    setTooltip({ text, top: rect.top + rect.height / 2 });
  };

  const renderRailBookmarkBtn = (item: EdgeQuickAccessItem) => {
    const src = item.faviconDataUrl || getFaviconUrl(item.url, 48);
    const hasImg = Boolean(src) && !failedFavicons[item.id];
    let tipText = item.title || item.url;
    if (item.isActive && item.isNavigatedAway) {
      tipText = `${tipText} · Click to reset`;
    } else if (item.isNavigatedAway && item.currentTitle && item.currentTitle !== item.title) {
      tipText = `${tipText} → ${item.currentTitle}`;
    }

    return (
      <button
        key={item.id}
        type="button"
        aria-label={item.title || item.url}
        onClick={() => handleBookmarkClick(item.id, false)}
        onDoubleClick={(e) => {
          e.preventDefault();
          handleBookmarkClick(item.id, true);
        }}
        onMouseEnter={(e) => showTip(e.currentTarget, tipText)}
        onMouseLeave={() => setTooltip(null)}
        className={`relative w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all active:scale-95 cursor-pointer ${
          item.isActive
            ? 'theme-active-card'
            : item.isOpen
            ? 'bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.09] dark:hover:bg-white/[0.13]'
            : 'hover:bg-black/[0.06] dark:hover:bg-white/[0.09]'
        }`}
      >
        {item.isActive && (
          <span
            style={{ [isLeft ? 'left' : 'right']: -4 }}
            className="absolute top-1/2 -translate-y-1/2 w-[2.5px] h-3.5 rounded-full theme-active-indicator pointer-events-none"
          />
        )}
        {hasImg ? (
          <img
            src={src}
            alt=""
            onError={() => setFailedFavicons((prev) => ({ ...prev, [item.id]: true }))}
            className="w-4 h-4 rounded-[4px] object-contain pointer-events-none"
          />
        ) : (
          <span className="w-[17px] h-[17px] rounded-[4px] text-[10px] font-bold flex items-center justify-center bg-black/5 dark:bg-white/10 text-zinc-700 dark:text-zinc-200 pointer-events-none">
            {getMonogram(item.title, item.url)}
          </span>
        )}
        {item.isNavigatedAway && (
          <span className="absolute top-[3px] right-[3px] w-[5px] h-[5px] rounded-full bg-amber-400 pointer-events-none" />
        )}
        {item.isOpen && !item.isActive && (
          <span className="absolute bottom-[2px] left-1/2 -translate-x-1/2 w-[3.5px] h-[3.5px] rounded-full bg-zinc-400/85 pointer-events-none" />
        )}
      </button>
    );
  };

  const renderRailFolderBtn = (folder: EdgeFolderNode) => {
    const isFlyoutOpen = openFolder?.id === folder.id;
    const tipText = `${folder.title} (${folder.itemCount})`;

    return (
      <button
        key={folder.id}
        type="button"
        aria-label={folder.title}
        aria-expanded={isFlyoutOpen}
        onClick={(e) => {
          e.stopPropagation();
          setTooltip(null);
          if (isFlyoutOpen) {
            setOpenFolder(null);
          } else {
            const rect = e.currentTarget.getBoundingClientRect();
            const clampedTop = Math.max(8, Math.min(rect.top - 4, window.innerHeight - 240));
            setOpenFolder({ id: folder.id, top: clampedTop });
          }
        }}
        onMouseEnter={(e) => {
          if (!isFlyoutOpen) showTip(e.currentTarget, tipText);
        }}
        onMouseLeave={() => setTooltip(null)}
        className={`relative w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all active:scale-95 cursor-pointer text-amber-600 dark:text-amber-400 ${
          isFlyoutOpen || folder.hasActiveChild
            ? 'theme-active-card'
            : folder.hasOpenChild
            ? 'bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.09] dark:hover:bg-white/[0.13]'
            : 'hover:bg-black/[0.06] dark:hover:bg-white/[0.09]'
        }`}
      >
        {folder.hasActiveChild && (
          <span
            style={{ [isLeft ? 'left' : 'right']: -4 }}
            className="absolute top-1/2 -translate-y-1/2 w-[2.5px] h-3.5 rounded-full theme-active-indicator pointer-events-none"
          />
        )}
        {isFlyoutOpen ? (
          <FolderOpen className="w-[15px] h-[15px] pointer-events-none" />
        ) : (
          <Folder className="w-[15px] h-[15px] pointer-events-none" />
        )}
        {folder.hasNavigatedAwayChild && (
          <span className="absolute top-[3px] right-[3px] w-[5px] h-[5px] rounded-full bg-amber-400 pointer-events-none" />
        )}
        {folder.hasOpenChild && !folder.hasActiveChild && (
          <span className="absolute bottom-[2px] left-1/2 -translate-x-1/2 w-[3.5px] h-[3.5px] rounded-full bg-zinc-400/85 pointer-events-none" />
        )}
      </button>
    );
  };

  const activeFlyoutFolder = openFolder ? findFolderById(spaceItems, openFolder.id) : null;

  const renderFlyoutNodes = (nodes: EdgeSpaceNode[], depth = 0): React.ReactNode => {
    return nodes.map((node) => {
      if (node.type === 'bookmark') {
        const src = node.faviconDataUrl || getFaviconUrl(node.url, 48);
        const hasImg = Boolean(src) && !failedFavicons[node.id];
        const label =
          node.isNavigatedAway && node.currentTitle && node.currentTitle !== node.title
            ? `${node.title} → ${node.currentTitle}`
            : node.title || node.url;

        return (
          <button
            key={node.id}
            type="button"
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => handleBookmarkClick(node.id, false)}
            onDoubleClick={(e) => {
              e.preventDefault();
              handleBookmarkClick(node.id, true);
            }}
            className={`w-full min-h-[30px] pr-2 py-1 rounded-lg flex items-center gap-2 text-left transition-colors cursor-pointer ${
              node.isActive
                ? 'theme-active-card'
                : 'hover:bg-black/[0.06] dark:hover:bg-white/[0.09]'
            }`}
          >
            {hasImg ? (
              <img
                src={src}
                alt=""
                onError={() => setFailedFavicons((prev) => ({ ...prev, [node.id]: true }))}
                className="w-4 h-4 rounded-[4px] object-contain shrink-0 pointer-events-none"
              />
            ) : (
              <span className="w-4 h-4 rounded-[4px] text-[9px] font-bold flex items-center justify-center bg-black/5 dark:bg-white/10 text-zinc-700 dark:text-zinc-200 shrink-0 pointer-events-none">
                {getMonogram(node.title, node.url)}
              </span>
            )}
            <span className="flex-1 min-w-0 text-[11.5px] font-medium text-zinc-800 dark:text-zinc-100 truncate">
              {label}
            </span>
            {node.isNavigatedAway ? (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            ) : node.isActive ? (
              <span className="w-1.5 h-1.5 rounded-full theme-active-indicator shrink-0" />
            ) : node.isOpen ? (
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400/80 shrink-0" />
            ) : null}
          </button>
        );
      }

      const isSubExpanded =
        expandedSubfolders[node.id] !== undefined
          ? expandedSubfolders[node.id]
          : node.hasActiveChild;

      return (
        <React.Fragment key={node.id}>
          <button
            type="button"
            style={{ paddingLeft: 8 + depth * 14 }}
            aria-expanded={isSubExpanded}
            onClick={() =>
              setExpandedSubfolders((prev) => ({ ...prev, [node.id]: !isSubExpanded }))
            }
            className="w-full min-h-[30px] pr-2 py-1 rounded-lg flex items-center gap-1.5 text-left hover:bg-black/[0.06] dark:hover:bg-white/[0.09] transition-colors cursor-pointer"
          >
            {isSubExpanded ? (
              <ChevronDown className="w-3 h-3 text-zinc-400 shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
            )}
            {isSubExpanded ? (
              <FolderOpen className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            )}
            <span className="flex-1 min-w-0 text-[11.5px] font-semibold text-zinc-800 dark:text-zinc-100 truncate">
              {node.title}
            </span>
            <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded-full shrink-0">
              {node.itemCount}
            </span>
          </button>
          {isSubExpanded && node.children.length > 0 && renderFlyoutNodes(node.children, depth + 1)}
        </React.Fragment>
      );
    });
  };

  const hasQa = quickAccessItems.length > 0;
  const hasSpace = spaceItems.length > 0;

  return (
    <>
      {mode === 'hover' && !isExpanded && (
        <div
          data-testid="newtab-edge-hover-sensor"
          onMouseEnter={handleExpandHover}
          style={{
            position: 'fixed',
            top: 0,
            bottom: 0,
            height: '100vh',
            width: 5,
            [isLeft ? 'left' : 'right']: 0,
            zIndex: 49,
            cursor: 'pointer'
          }}
        />
      )}

      <aside
        ref={railRef}
        data-testid="newtab-edge-trigger"
        data-mode={mode}
        data-expanded={isExpanded ? 'true' : 'false'}
        aria-label="Arctic Quick Access Bar"
        onMouseEnter={mode === 'hover' ? handleExpandHover : undefined}
        onMouseLeave={mode === 'hover' ? handleScheduleCollapseHover : undefined}
        onClick={() => {
          if (openFolder) setOpenFolder(null);
        }}
        style={{
          position: 'fixed',
          top: 0,
          bottom: 0,
          height: '100vh',
          width: 36,
          [isLeft ? 'left' : 'right']: 0,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '8px 4px',
          background: 'var(--theme-bg-gradient)',
          borderRight: isLeft ? '1px solid var(--theme-border-subtle)' : undefined,
          borderLeft: !isLeft ? '1px solid var(--theme-border-subtle)' : undefined,
          boxShadow:
            mode === 'hover' && isExpanded
              ? '0 0 28px rgba(0, 0, 0, 0.22)'
              : '0 0 20px rgba(0, 0, 0, 0.08)',
          transform:
            mode === 'hover' && !isExpanded
              ? isLeft
                ? 'translateX(-100%)'
                : 'translateX(100%)'
              : 'translateX(0)',
          pointerEvents: mode === 'hover' && !isExpanded ? 'none' : 'auto',
          transition: 'transform 150ms cubic-bezier(0.22, 1, 0.36, 1)',
          userSelect: 'none'
        }}
      >
        <button
          type="button"
          aria-label="Show Arctic Sidebar"
          onClick={(e) => {
            e.stopPropagation();
            handleOpenSidePanel();
          }}
          onMouseEnter={(e) => showTip(e.currentTarget, 'Show Arctic Sidebar')}
          onMouseLeave={() => setTooltip(null)}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all shrink-0 cursor-pointer"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: isLeft ? 'none' : 'scaleX(-1)' }}
          >
            <rect width="18" height="18" x="3" y="3" rx="3" />
            <path d="M9 3v18" />
            <path d="m14 9 3 3-3 3" />
          </svg>
        </button>

        {(hasQa || hasSpace) && (
          <>
            <div
              style={{ backgroundColor: 'var(--theme-border-subtle)' }}
              className="w-[18px] h-px my-1.5 shrink-0"
            />
            <div
              onScroll={() => setTooltip(null)}
              className="flex flex-col items-center gap-[5px] w-full flex-1 overflow-y-auto overflow-x-hidden pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {quickAccessItems.map((item) => renderRailBookmarkBtn(item))}

              {hasQa && hasSpace && (
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  style={{ backgroundColor: 'var(--theme-border-subtle)' }}
                  className="w-[20px] h-px my-1 shrink-0"
                />
              )}

              {spaceItems.map((node) =>
                node.type === 'bookmark' ? renderRailBookmarkBtn(node) : renderRailFolderBtn(node)
              )}
            </div>
          </>
        )}
      </aside>

      {activeFlyoutFolder && openFolder && (
        <div
          ref={flyoutRef}
          role="menu"
          aria-label={activeFlyoutFolder.title}
          style={{
            position: 'fixed',
            top: openFolder.top,
            [isLeft ? 'left' : 'right']: 42,
            width: 244,
            maxHeight: 'min(400px, calc(100vh - 16px))',
            zIndex: 60,
            background: 'var(--theme-bg-gradient)',
            border: '1px solid var(--theme-border-subtle)',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.24)'
          }}
          className="rounded-xl flex flex-col overflow-hidden select-none"
        >
          <div
            style={{ borderBottom: '1px solid var(--theme-border-subtle)' }}
            className="flex items-center justify-between gap-2 px-2.5 py-2 shrink-0"
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <FolderOpen className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-[11.5px] font-bold text-zinc-900 dark:text-zinc-100 truncate">
                {activeFlyoutFolder.title}
              </span>
            </div>
            <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded-full shrink-0">
              {activeFlyoutFolder.itemCount}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 p-1.5 overflow-y-auto overflow-x-hidden">
            {activeFlyoutFolder.children.length === 0 ? (
              <div className="py-3 px-2 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
                Empty folder
              </div>
            ) : (
              renderFlyoutNodes(activeFlyoutFolder.children, 0)
            )}
          </div>
        </div>
      )}

      {tooltip && (
        <div
          style={{
            position: 'fixed',
            top: tooltip.top,
            [isLeft ? 'left' : 'right']: 42,
            transform: 'translateY(-50%)',
            zIndex: 65,
            background:
              effectiveTheme === 'dark' ? 'rgba(24, 24, 27, 0.96)' : 'rgba(24, 24, 27, 0.94)',
            color: '#fafafa',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.24)'
          }}
          className="px-2.5 py-1 rounded-[7px] text-[11px] font-semibold whitespace-nowrap max-w-[240px] truncate pointer-events-none"
        >
          {tooltip.text}
        </div>
      )}
    </>
  );
};
