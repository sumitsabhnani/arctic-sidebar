import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';
import type {
  ColorThemeId,
  EdgeFolderNode,
  EdgeQuickAccessItem,
  EdgeSpaceNode,
  EdgeTodayTabItem,
  EdgeTriggerMode,
  ThemeMode
} from '../../types';
import { resolveEffectiveTheme } from '../../sidepanel/utils/theme';
import { getFaviconUrl } from '../../sidepanel/utils/url';

const MIN_THUMB_HEIGHT_PX = 24;

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

function hasRealViewportLayout(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    !document.documentElement
  ) {
    return false;
  }
  const vw = window.innerWidth || 0;
  if (vw <= 0) return false;
  const rect = document.documentElement.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
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
  const [todayTabItems, setTodayTabItems] = useState<EdgeTodayTabItem[]>([]);
  const [failedFavicons, setFailedFavicons] = useState<Record<string, boolean>>({});
  const [tooltip, setTooltip] = useState<{ text: string; top: number } | null>(null);
  const [openFolder, setOpenFolder] = useState<{ id: string; top: number } | null>(null);
  const [expandedSubfolders, setExpandedSubfolders] = useState<Record<string, boolean>>({});
  const [isOptimisticallyOpening, setIsOptimisticallyOpening] = useState(false);
  const [isHoldingForOpen, setIsHoldingForOpen] = useState(false);
  const [isDeferringForClose, setIsDeferringForClose] = useState(false);
  const [scrollMetrics, setScrollMetrics] = useState({
    isScrollable: false,
    thumbHeight: 0,
    thumbTop: 0,
    canScrollUp: false,
    canScrollDown: false
  });
  const [isScrolling, setIsScrolling] = useState(false);
  const [isDraggingScrollbar, setIsDraggingScrollbar] = useState(false);
  const [isTrackHovered, setIsTrackHovered] = useState(false);
  const [isRailHovered, setIsRailHovered] = useState(false);

  const resolvedWindowIdRef = useRef<number | null>(null);
  const modeRef = useRef<EdgeTriggerMode>('push');
  const isEnabledRef = useRef(false);
  const openWindowIdsRef = useRef<number[]>([]);
  const openBaselineWidthRef = useRef(0);
  const closeBaselineWidthRef = useRef(0);
  const lastOpenWidthRef = useRef<number | null>(null);
  const openHandoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeHandoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollTrackRef = useRef<HTMLDivElement | null>(null);
  const scrollThumbRef = useRef<HTMLDivElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const hoverCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollbarDragCleanupRef = useRef<(() => void) | null>(null);
  const isDraggingScrollbarRef = useRef(false);
  const isPointerInRailRef = useRef(false);
  const lastActiveItemKeyRef = useRef<string | null>(null);

  modeRef.current = mode;
  isEnabledRef.current = isEnabled;
  openWindowIdsRef.current = openWindowIds;

  const cancelOpenHold = useCallback(() => {
    if (openHandoffTimerRef.current) {
      clearTimeout(openHandoffTimerRef.current);
      openHandoffTimerRef.current = null;
    }
    setIsHoldingForOpen(false);
  }, []);

  const cancelCloseDefer = useCallback(() => {
    if (closeHandoffTimerRef.current) {
      clearTimeout(closeHandoffTimerRef.current);
      closeHandoffTimerRef.current = null;
    }
    setIsDeferringForClose(false);
  }, []);

  const startOpenHoldIfNeeded = useCallback(() => {
    if (modeRef.current !== 'push' || !isEnabledRef.current || !hasRealViewportLayout()) {
      return;
    }
    if (openHandoffTimerRef.current) return;
    openBaselineWidthRef.current = window.innerWidth;
    setIsHoldingForOpen(true);
    openHandoffTimerRef.current = setTimeout(() => {
      openHandoffTimerRef.current = null;
      setIsHoldingForOpen(false);
    }, 280);
  }, []);

  const startCloseDeferIfNeeded = useCallback(() => {
    if (modeRef.current !== 'push' || !isEnabledRef.current || !hasRealViewportLayout()) {
      return;
    }
    const vw = window.innerWidth;
    if (lastOpenWidthRef.current !== null && vw > lastOpenWidthRef.current + 8) {
      lastOpenWidthRef.current = null;
      return;
    }
    if (closeHandoffTimerRef.current) return;
    closeBaselineWidthRef.current = vw;
    setIsDeferringForClose(true);
    closeHandoffTimerRef.current = setTimeout(() => {
      closeHandoffTimerRef.current = null;
      lastOpenWidthRef.current = null;
      setIsDeferringForClose(false);
    }, 80);
  }, []);

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
          isEnabledRef.current = res.edgeTriggerEnabled;
          setIsEnabled(res.edgeTriggerEnabled);
        }
        if (res?.edgeTriggerMode === 'push' || res?.edgeTriggerMode === 'hover') {
          modeRef.current = res.edgeTriggerMode;
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
        openWindowIdsRef.current = res.openSidePanelWindowIds as number[];
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
          openWindowIdsRef.current = resp.openWindowIds as number[];
          setOpenWindowIds(resp.openWindowIds as number[]);
        }
        if (resp.side === 'left' || resp.side === 'right') {
          setDockSide(resp.side);
        }
        if (resp.mode === 'push' || resp.mode === 'hover') {
          modeRef.current = resp.mode;
          setMode(resp.mode);
        }
        if (Array.isArray(resp.quickAccessItems)) {
          setQuickAccessItems(resp.quickAccessItems as EdgeQuickAccessItem[]);
        }
        if (Array.isArray(resp.spaceItems)) {
          setSpaceItems(resp.spaceItems as EdgeSpaceNode[]);
        }
        if (Array.isArray(resp.todayTabItems)) {
          setTodayTabItems(resp.todayTabItems as EdgeTodayTabItem[]);
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
        const nextIds = Array.isArray(changes.openSidePanelWindowIds.newValue)
          ? (changes.openSidePanelWindowIds.newValue as number[])
          : [];
        const myWin = resolvedWindowIdRef.current ?? windowIdRef.current;
        const wasOpen = typeof myWin === 'number' && openWindowIdsRef.current.includes(myWin);
        const nowOpen = typeof myWin === 'number' && nextIds.includes(myWin);
        if (!wasOpen && nowOpen) {
          startOpenHoldIfNeeded();
          cancelCloseDefer();
          if (hasRealViewportLayout()) {
            lastOpenWidthRef.current = window.innerWidth;
          }
        } else if (wasOpen && !nowOpen) {
          cancelOpenHold();
          startCloseDeferIfNeeded();
        }
        openWindowIdsRef.current = nextIds;
        setOpenWindowIds(nextIds);
        setIsOptimisticallyOpening(false);
      } else if (areaName === 'local') {
        if (changes.edgeTriggerEnabled !== undefined) {
          const nextEnabled = Boolean(changes.edgeTriggerEnabled.newValue);
          isEnabledRef.current = nextEnabled;
          if (!nextEnabled) {
            cancelOpenHold();
            cancelCloseDefer();
          }
          setIsEnabled(nextEnabled);
        }
        if (
          changes.edgeTriggerMode?.newValue === 'push' ||
          changes.edgeTriggerMode?.newValue === 'hover'
        ) {
          const nextMode = changes.edgeTriggerMode.newValue;
          modeRef.current = nextMode;
          if (nextMode !== 'push') {
            cancelOpenHold();
            cancelCloseDefer();
          }
          setMode(nextMode);
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
      justCollapsed?: boolean;
      quickAccessItems?: EdgeQuickAccessItem[];
      spaceItems?: EdgeSpaceNode[];
      todayTabItems?: EdgeTodayTabItem[];
    }) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ARCTIC_SIDEPANEL_VISIBILITY') {
        const myWin = resolvedWindowIdRef.current ?? windowIdRef.current;
        if (typeof message.windowId === 'number' && myWin !== null && message.windowId !== myWin) {
          return;
        }
        const effectiveWin = typeof myWin === 'number' ? myWin : message.windowId ?? null;
        if (typeof message.windowId === 'number' && myWin === null) {
          resolvedWindowIdRef.current = message.windowId;
          setResolvedWindowId(message.windowId);
        }
        const wasOpen =
          typeof effectiveWin === 'number' && openWindowIdsRef.current.includes(effectiveWin);
        const nextIds = Array.isArray(message.openWindowIds)
          ? message.openWindowIds
          : openWindowIdsRef.current;
        const nowOpen =
          typeof message.isSidePanelOpen === 'boolean'
            ? message.isSidePanelOpen
            : typeof effectiveWin === 'number' && nextIds.includes(effectiveWin);

        if (!wasOpen && nowOpen) {
          startOpenHoldIfNeeded();
          cancelCloseDefer();
          if (hasRealViewportLayout()) {
            lastOpenWidthRef.current = window.innerWidth;
          }
        } else if ((wasOpen || message.justCollapsed) && !nowOpen) {
          cancelOpenHold();
          startCloseDeferIfNeeded();
        }

        if (Array.isArray(message.openWindowIds)) {
          openWindowIdsRef.current = message.openWindowIds;
          setOpenWindowIds(message.openWindowIds);
        }
        if (!message.isSidePanelOpen) {
          if (Array.isArray(message.quickAccessItems)) {
            setQuickAccessItems(message.quickAccessItems);
          }
          if (Array.isArray(message.spaceItems)) {
            setSpaceItems(message.spaceItems);
          }
          if (Array.isArray(message.todayTabItems)) {
            setTodayTabItems(message.todayTabItems);
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
        if (Array.isArray(message.todayTabItems)) {
          setTodayTabItems(message.todayTabItems);
        }
      } else if (message.type === 'ARCTIC_REMOVE_EDGE_TRIGGER') {
        isEnabledRef.current = false;
        cancelOpenHold();
        cancelCloseDefer();
        setIsEnabled(false);
        setOpenFolder(null);
      }
    };

    chrome?.storage?.onChanged?.addListener(handleStorageChange);
    chrome?.runtime?.onMessage?.addListener(handleRuntimeMessage);
    return () => {
      unmounted = true;
      if (openHandoffTimerRef.current) {
        clearTimeout(openHandoffTimerRef.current);
        openHandoffTimerRef.current = null;
      }
      if (closeHandoffTimerRef.current) {
        clearTimeout(closeHandoffTimerRef.current);
        closeHandoffTimerRef.current = null;
      }
      chrome?.storage?.onChanged?.removeListener(handleStorageChange);
      chrome?.runtime?.onMessage?.removeListener(handleRuntimeMessage);
    };
  }, [windowIdRef, cancelCloseDefer, cancelOpenHold, startCloseDeferIfNeeded, startOpenHoldIfNeeded]);

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
  const baseCanShow = isInitialized && hasWinId && isEnabled;
  const rawShouldShow = baseCanShow && !isSidePanelOpen && !isOptimisticallyOpening;
  const effectiveHoldOpen =
    isHoldingForOpen && baseCanShow && mode === 'push' && (isSidePanelOpen || isOptimisticallyOpening);
  const effectiveDeferClose = isDeferringForClose && rawShouldShow && mode === 'push';
  const isVisible = (rawShouldShow && !effectiveDeferClose) || effectiveHoldOpen;

  // Synchronize open/close layout push handoff with Chrome's physical Side Panel resize frames
  useEffect(() => {
    if (!effectiveHoldOpen && !effectiveDeferClose && !isSidePanelOpen) return;

    if (isSidePanelOpen && hasRealViewportLayout()) {
      if (lastOpenWidthRef.current === null || window.innerWidth < lastOpenWidthRef.current) {
        lastOpenWidthRef.current = window.innerWidth;
      }
    }

    const handleViewportResize = () => {
      const vw = window.innerWidth;
      if (effectiveHoldOpen && vw < openBaselineWidthRef.current - 2) {
        lastOpenWidthRef.current = vw;
        cancelOpenHold();
        return;
      }
      if (effectiveDeferClose && vw > closeBaselineWidthRef.current + 2) {
        lastOpenWidthRef.current = null;
        cancelCloseDefer();
        return;
      }
      if (isSidePanelOpen && hasRealViewportLayout()) {
        if (lastOpenWidthRef.current === null || vw < lastOpenWidthRef.current) {
          lastOpenWidthRef.current = vw;
        }
      }
    };

    window.addEventListener('resize', handleViewportResize, { passive: true });
    return () => {
      window.removeEventListener('resize', handleViewportResize);
    };
  }, [effectiveHoldOpen, effectiveDeferClose, isSidePanelOpen, cancelOpenHold, cancelCloseDefer]);

  const updateScrollbarMetrics = useCallback(() => {
    const el = listRef.current;
    if (!el) {
      setScrollMetrics((prev) =>
        prev.isScrollable || prev.canScrollUp || prev.canScrollDown
          ? { isScrollable: false, thumbHeight: 0, thumbTop: 0, canScrollUp: false, canScrollDown: false }
          : prev
      );
      return;
    }

    const scrollHeight = el.scrollHeight || 0;
    const clientHeight = el.clientHeight || 0;
    const scrollTop = el.scrollTop || 0;
    const maxScrollTop = scrollHeight - clientHeight;
    const isScrollable = clientHeight > 0 && maxScrollTop > 1;

    if (!isScrollable) {
      setScrollMetrics((prev) =>
        prev.isScrollable || prev.canScrollUp || prev.canScrollDown
          ? { isScrollable: false, thumbHeight: 0, thumbTop: 0, canScrollUp: false, canScrollDown: false }
          : prev
      );
      return;
    }

    const canScrollUp = scrollTop > 2;
    const canScrollDown = scrollTop < maxScrollTop - 2;
    const trackHeight = Math.max(MIN_THUMB_HEIGHT_PX, clientHeight - 6);
    const rawThumbH = (clientHeight / scrollHeight) * trackHeight;
    const thumbHeight = Math.max(
      MIN_THUMB_HEIGHT_PX,
      Math.min(trackHeight, Math.round(rawThumbH))
    );
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    const ratio = Math.max(0, Math.min(1, scrollTop / Math.max(1, maxScrollTop)));
    const thumbTop = Math.round(ratio * maxThumbTop * 10) / 10;

    setScrollMetrics((prev) => {
      if (
        prev.isScrollable === isScrollable &&
        prev.thumbHeight === thumbHeight &&
        prev.thumbTop === thumbTop &&
        prev.canScrollUp === canScrollUp &&
        prev.canScrollDown === canScrollDown
      ) {
        return prev;
      }
      return { isScrollable, thumbHeight, thumbTop, canScrollUp, canScrollDown };
    });
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    updateScrollbarMetrics();
    const el = listRef.current;
    let ro: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => updateScrollbarMetrics());
      ro.observe(el);
    }
    window.addEventListener('resize', updateScrollbarMetrics);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updateScrollbarMetrics);
    };
  }, [isVisible, quickAccessItems, spaceItems, todayTabItems, updateScrollbarMetrics]);

  // Auto-scroll active item into view when active item changes
  useEffect(() => {
    if (!isVisible) {
      lastActiveItemKeyRef.current = null;
      return;
    }

    let activeKey: string | null = null;
    for (const qa of quickAccessItems) {
      if (qa.isActive) {
        activeKey = `qa:${qa.id}`;
        break;
      }
    }
    if (!activeKey) {
      for (const node of spaceItems) {
        if (node.type === 'bookmark' && node.isActive) {
          activeKey = `space:${node.id}`;
          break;
        }
        if (node.type === 'folder' && node.hasActiveChild) {
          activeKey = `folder:${node.id}`;
          break;
        }
      }
    }
    if (!activeKey) {
      for (const tab of todayTabItems) {
        if (tab.isActive) {
          activeKey = `today:${tab.tabId}`;
          break;
        }
      }
    }

    if (activeKey && activeKey !== lastActiveItemKeyRef.current) {
      lastActiveItemKeyRef.current = activeKey;
      const activeBtn = listRef.current?.querySelector<HTMLElement>('button[data-active="true"]');
      if (activeBtn && typeof activeBtn.scrollIntoView === 'function') {
        try {
          activeBtn.scrollIntoView({ block: 'nearest' });
        } catch {
          // ignore
        }
      }
    } else if (!activeKey) {
      lastActiveItemKeyRef.current = null;
    }
  }, [isVisible, quickAccessItems, spaceItems, todayTabItems]);

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

  // Clear pending timers & active scrollbar drag listeners on unmount or when hidden
  useEffect(() => {
    if (!isVisible) {
      setIsHoverExpanded(false);
      setIsRailHovered(false);
      setIsTrackHovered(false);
      isPointerInRailRef.current = false;
      scrollbarDragCleanupRef.current?.();
    }
    return () => {
      if (hoverCollapseTimerRef.current) {
        clearTimeout(hoverCollapseTimerRef.current);
        hoverCollapseTimerRef.current = null;
      }
      if (scrollFadeTimerRef.current) {
        clearTimeout(scrollFadeTimerRef.current);
        scrollFadeTimerRef.current = null;
      }
      scrollbarDragCleanupRef.current?.();
    };
  }, [isVisible]);

  // Track cursor while expanded in 'hover' mode so quick darts across the 5px sensor
  // always collapse cleanly on the first hover-out even if rail.mouseenter never fired
  useEffect(() => {
    if (
      !isVisible ||
      mode !== 'hover' ||
      !isHoverExpanded ||
      openFolder !== null ||
      isDraggingScrollbar
    ) {
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingScrollbarRef.current) {
        if (hoverCollapseTimerRef.current) {
          clearTimeout(hoverCollapseTimerRef.current);
          hoverCollapseTimerRef.current = null;
        }
        return;
      }

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
  }, [isVisible, mode, isHoverExpanded, openFolder, isDraggingScrollbar, dockSide]);

  if (!isVisible) {
    return null;
  }

  const effectiveTheme = resolveEffectiveTheme(theme);
  const isLeft = dockSide === 'left';
  const isExpanded = mode === 'push' || isHoverExpanded || openFolder !== null || isDraggingScrollbar;

  const handleExpandHover = () => {
    if (hoverCollapseTimerRef.current) {
      clearTimeout(hoverCollapseTimerRef.current);
      hoverCollapseTimerRef.current = null;
    }
    setIsHoverExpanded(true);
  };

  const handleScheduleCollapseHover = () => {
    if (isDraggingScrollbarRef.current) return;
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
    startOpenHoldIfNeeded();
    setIsOptimisticallyOpening(true);
    const targetWinId = windowIdRef.current ?? resolvedWindowId;

    if (typeof targetWinId === 'number' && chrome?.sidePanel?.open) {
      chrome.sidePanel.open({ windowId: targetWinId }).catch(() => {
        cancelOpenHold();
        setIsOptimisticallyOpening(false);
      });
      return;
    }

    try {
      chrome?.runtime?.sendMessage?.({ type: 'OPEN_SIDE_PANEL_FROM_EDGE' }, (resp) => {
        if (!resp || resp.ok !== true) {
          cancelOpenHold();
          setIsOptimisticallyOpening(false);
        }
      });
    } catch {
      cancelOpenHold();
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

  const handleTodayTabClick = (tabId: number, forceReload = false) => {
    setTooltip(null);
    setOpenFolder(null);
    try {
      chrome?.runtime?.sendMessage?.({
        type: 'ACTIVATE_TODAY_TAB_FROM_EDGE',
        tabId,
        windowId: winId ?? undefined,
        forceReload
      });
    } catch {
      // ignore
    }
  };

  const handleTodayTabClose = (tabId: number) => {
    setTooltip(null);
    setOpenFolder(null);
    try {
      chrome?.runtime?.sendMessage?.({
        type: 'CLOSE_TODAY_TAB_FROM_EDGE',
        tabId,
        windowId: winId ?? undefined
      });
    } catch {
      // ignore
    }
  };

  const handleListScroll = () => {
    setTooltip(null);
    updateScrollbarMetrics();
    setIsScrolling(true);
    if (scrollFadeTimerRef.current) {
      clearTimeout(scrollFadeTimerRef.current);
    }
    scrollFadeTimerRef.current = setTimeout(() => {
      scrollFadeTimerRef.current = null;
      setIsScrolling(false);
    }, 650);
  };

  const handleScrollbarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !listRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    setTooltip(null);

    const listEl = listRef.current;
    const scrollHeight = listEl.scrollHeight || 0;
    const clientHeight = listEl.clientHeight || 0;
    const maxScrollTop = scrollHeight - clientHeight;
    if (clientHeight <= 0 || maxScrollTop <= 1) return;

    const trackHeight = Math.max(MIN_THUMB_HEIGHT_PX, clientHeight - 6);
    const thumbHeight = Math.max(
      MIN_THUMB_HEIGHT_PX,
      Math.min(trackHeight, Math.round((clientHeight / scrollHeight) * trackHeight))
    );
    const maxThumbTop = Math.max(1, trackHeight - thumbHeight);

    if (e.target !== scrollThumbRef.current && scrollTrackRef.current) {
      const trackRect = scrollTrackRef.current.getBoundingClientRect();
      const trackTop = trackRect.height > 0 ? trackRect.top : 0;
      const clickOffsetY = e.clientY - trackTop - thumbHeight / 2;
      const targetRatio = Math.max(0, Math.min(1, clickOffsetY / maxThumbTop));
      listEl.scrollTop = targetRatio * maxScrollTop;
      updateScrollbarMetrics();
    }

    const startY = e.clientY;
    const startScrollTop = listEl.scrollTop;

    scrollbarDragCleanupRef.current?.();
    isDraggingScrollbarRef.current = true;
    setIsDraggingScrollbar(true);

    try {
      scrollTrackRef.current?.setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }

    const handlePointerMove = (ev: PointerEvent) => {
      if (!isDraggingScrollbarRef.current || !listRef.current) return;
      const curEl = listRef.current;
      const curScrollHeight = curEl.scrollHeight || 0;
      const curClientHeight = curEl.clientHeight || 0;
      const curMaxScrollTop = Math.max(1, curScrollHeight - curClientHeight);
      const curTrackHeight = Math.max(MIN_THUMB_HEIGHT_PX, curClientHeight - 6);
      const curThumbHeight = Math.max(
        MIN_THUMB_HEIGHT_PX,
        Math.min(curTrackHeight, Math.round((curClientHeight / curScrollHeight) * curTrackHeight))
      );
      const curMaxThumbTop = Math.max(1, curTrackHeight - curThumbHeight);
      const deltaY = ev.clientY - startY;
      curEl.scrollTop = Math.max(
        0,
        Math.min(curMaxScrollTop, startScrollTop + (deltaY / curMaxThumbTop) * curMaxScrollTop)
      );
      updateScrollbarMetrics();
    };

    const stopDrag = () => {
      if (!isDraggingScrollbarRef.current) return;
      isDraggingScrollbarRef.current = false;
      scrollbarDragCleanupRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
      setIsDraggingScrollbar(false);
      if (mode === 'hover' && !isPointerInRailRef.current && openFolder === null) {
        handleScheduleCollapseHover();
      }
    };

    scrollbarDragCleanupRef.current = () => {
      isDraggingScrollbarRef.current = false;
      scrollbarDragCleanupRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
      setIsDraggingScrollbar(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
  };

  const showTip = (el: HTMLElement, text: string) => {
    const rect = el.getBoundingClientRect();
    setTooltip({ text, top: rect.top + rect.height / 2 });
  };

  const renderRailBookmarkBtn = (
    item: EdgeQuickAccessItem,
    section: 'quick-access' | 'space'
  ) => {
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
        data-section={section}
        data-bookmark-id={item.id}
        data-active={item.isActive ? 'true' : 'false'}
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
        data-section="space"
        data-folder-id={folder.id}
        data-active={folder.hasActiveChild ? 'true' : 'false'}
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

  const renderRailTodayTabBtn = (item: EdgeTodayTabItem) => {
    const faviconKey = `today:${item.tabId}`;
    const src = item.faviconDataUrl || getFaviconUrl(item.url, 48);
    const hasImg = Boolean(src) && !failedFavicons[faviconKey];
    const baseLabel = item.title || item.url;
    const tipText = item.isDiscarded ? `${baseLabel} · Sleeping` : baseLabel;
    const dimContent = item.isDiscarded && !item.isActive;

    return (
      <button
        key={faviconKey}
        type="button"
        data-section="today"
        data-tab-id={item.tabId}
        data-active={item.isActive ? 'true' : 'false'}
        data-discarded={item.isDiscarded ? 'true' : 'false'}
        aria-label={baseLabel}
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
            handleTodayTabClose(item.tabId);
          }
        }}
        onClick={(e) => {
          e.stopPropagation();
          handleTodayTabClick(item.tabId, false);
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleTodayTabClick(item.tabId, true);
        }}
        onMouseEnter={(e) => showTip(e.currentTarget, tipText)}
        onMouseLeave={() => setTooltip(null)}
        className={`relative w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all active:scale-95 cursor-pointer ${
          item.isActive
            ? 'theme-active-card'
            : 'bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.09] dark:hover:bg-white/[0.13]'
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
            onError={() => setFailedFavicons((prev) => ({ ...prev, [faviconKey]: true }))}
            className={`w-4 h-4 rounded-[4px] object-contain pointer-events-none ${
              dimContent ? 'opacity-50' : ''
            }`}
          />
        ) : (
          <span
            className={`w-[17px] h-[17px] rounded-[4px] text-[10px] font-bold flex items-center justify-center bg-black/5 dark:bg-white/10 text-zinc-700 dark:text-zinc-200 pointer-events-none ${
              dimContent ? 'opacity-50' : ''
            }`}
          >
            {getMonogram(item.title, item.url)}
          </span>
        )}
        {item.isAudible && !item.isMuted && (
          <span className="absolute top-[3px] right-[3px] w-[5px] h-[5px] rounded-full bg-emerald-400 pointer-events-none" />
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
  const hasToday = todayTabItems.length > 0;

  const listMaskImage =
    scrollMetrics.canScrollUp && scrollMetrics.canScrollDown
      ? 'linear-gradient(to bottom, transparent 0px, #000 12px, #000 calc(100% - 14px), transparent 100%)'
      : scrollMetrics.canScrollUp
      ? 'linear-gradient(to bottom, transparent 0px, #000 12px, #000 100%)'
      : scrollMetrics.canScrollDown
      ? 'linear-gradient(to bottom, #000 0px, #000 calc(100% - 14px), transparent 100%)'
      : undefined;

  const isThumbActive = isTrackHovered || isDraggingScrollbar;
  const trackOpacity = !scrollMetrics.isScrollable
    ? 0
    : isThumbActive
    ? 0.96
    : isRailHovered || isScrolling
    ? 0.78
    : 0.38;

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
        onMouseEnter={() => {
          isPointerInRailRef.current = true;
          setIsRailHovered(true);
          if (mode === 'hover') handleExpandHover();
        }}
        onMouseLeave={() => {
          isPointerInRailRef.current = false;
          setIsRailHovered(false);
          if (mode === 'hover') handleScheduleCollapseHover();
        }}
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
          pointerEvents:
            effectiveHoldOpen || (mode === 'hover' && !isExpanded) ? 'none' : 'auto',
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

        {(hasQa || hasSpace || hasToday) && (
          <>
            <div
              style={{ backgroundColor: 'var(--theme-border-subtle)' }}
              className="w-[18px] h-px my-1.5 shrink-0"
            />
            <div className="relative flex flex-col flex-1 min-h-0 w-[calc(100%+8px)] -mx-1 overflow-hidden">
              <div
                ref={listRef}
                data-testid="newtab-edge-scroll-list"
                data-can-scroll-up={scrollMetrics.canScrollUp ? 'true' : 'false'}
                data-can-scroll-down={scrollMetrics.canScrollDown ? 'true' : 'false'}
                onScroll={handleListScroll}
                style={{
                  WebkitMaskImage: listMaskImage,
                  maskImage: listMaskImage
                }}
                className="flex flex-col items-center gap-[5px] w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-1 pt-[1px] pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {quickAccessItems.map((item) => renderRailBookmarkBtn(item, 'quick-access'))}

                {hasQa && hasSpace && (
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    style={{ backgroundColor: 'var(--theme-border-subtle)' }}
                    className="w-[20px] h-px my-1 shrink-0"
                  />
                )}

                {spaceItems.map((node) =>
                  node.type === 'bookmark'
                    ? renderRailBookmarkBtn(node, 'space')
                    : renderRailFolderBtn(node)
                )}

                {(hasQa || hasSpace) && hasToday && (
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    style={{ backgroundColor: 'var(--theme-border-subtle)' }}
                    className="w-[20px] h-px my-1 shrink-0"
                  />
                )}

                {todayTabItems.map((tab) => renderRailTodayTabBtn(tab))}
              </div>

              <div
                ref={scrollTrackRef}
                data-testid="newtab-edge-scroll-track"
                data-scrollable={scrollMetrics.isScrollable ? 'true' : 'false'}
                data-scrolling={isScrolling ? 'true' : 'false'}
                data-dragging={isDraggingScrollbar ? 'true' : 'false'}
                aria-hidden="true"
                onMouseEnter={() => setIsTrackHovered(true)}
                onMouseLeave={() => setIsTrackHovered(false)}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={handleScrollbarPointerDown}
                style={{
                  position: 'absolute',
                  top: 2,
                  bottom: 4,
                  width: 6,
                  [isLeft ? 'right' : 'left']: 0,
                  justifyContent: isLeft ? 'flex-end' : 'flex-start',
                  zIndex: 4,
                  display: 'flex',
                  padding: '0 1px',
                  boxSizing: 'border-box',
                  cursor: 'pointer',
                  touchAction: 'none',
                  opacity: trackOpacity,
                  pointerEvents: scrollMetrics.isScrollable ? 'auto' : 'none',
                  transition: 'opacity 150ms ease'
                }}
              >
                <div
                  ref={scrollThumbRef}
                  data-testid="newtab-edge-scroll-thumb"
                  style={{
                    width: isThumbActive ? 4 : 2.5,
                    height: scrollMetrics.thumbHeight,
                    minHeight: scrollMetrics.isScrollable ? MIN_THUMB_HEIGHT_PX : 0,
                    borderRadius: 99,
                    background: isThumbActive
                      ? 'var(--theme-indicator)'
                      : effectiveTheme === 'dark'
                      ? 'rgba(255, 255, 255, 0.42)'
                      : 'rgba(63, 63, 70, 0.48)',
                    transform: `translateY(${scrollMetrics.thumbTop}px)`,
                    transition: 'width 120ms ease, background 120ms ease',
                    willChange: 'transform, height'
                  }}
                />
              </div>
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
