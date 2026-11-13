(() => {
  if (typeof window === 'undefined' || window.top !== window.self) {
    return;
  }

  const RAIL_WIDTH_PX = 36;
  const PAGE_PUSH_STYLE_ID = 'arctic-edge-page-push-style';

  interface EdgeQuickAccessItem {
    id: string;
    title: string;
    url: string;
    faviconDataUrl: string;
    isActive: boolean;
    isOpen: boolean;
    isNavigatedAway: boolean;
    currentTitle?: string;
  }

  interface EdgeBookmarkNode extends EdgeQuickAccessItem {
    type: 'bookmark';
  }

  interface EdgeFolderNode {
    type: 'folder';
    id: string;
    title: string;
    children: EdgeSpaceNode[];
    hasActiveChild: boolean;
    hasOpenChild: boolean;
    hasNavigatedAwayChild: boolean;
    itemCount: number;
  }

  type EdgeSpaceNode = EdgeBookmarkNode | EdgeFolderNode;
  type EdgeTriggerMode = 'push' | 'hover';

  interface EdgeTodayTabItem {
    tabId: number;
    title: string;
    url: string;
    faviconDataUrl: string;
    isActive: boolean;
    isDiscarded?: boolean;
    isAudible?: boolean;
    isMuted?: boolean;
  }

  interface SavedFixedStyle {
    prop: 'left' | 'right';
    value: string;
    priority: string;
    maxWidthValue: string;
    maxWidthPriority: string;
    adjustedMaxWidth: boolean;
  }

  const HOST_ID = 'arctic-edge-trigger-host';
  const SUPERSEDE_EVENT = 'arctic-edge-trigger-supersede';

  interface GlobalWithCleanup extends Window {
    __arcticEdgeTriggerCleanup?: () => void;
  }

  const win = window as GlobalWithCleanup;
  if (typeof win.__arcticEdgeTriggerCleanup === 'function') {
    try {
      win.__arcticEdgeTriggerCleanup();
    } catch {
      // ignore previous cleanup errors
    }
  }

  // Tear down any orphaned DOM hosts/styles left behind by a previous extension isolated world (e.g. reload/update)
  try {
    document.dispatchEvent(new CustomEvent(SUPERSEDE_EVENT));
    document.querySelectorAll(`#${HOST_ID}`).forEach((el) => el.remove());
    document.querySelectorAll(`#${PAGE_PUSH_STYLE_ID}`).forEach((el) => el.remove());
    document.documentElement?.removeAttribute('data-arctic-edge-push');
  } catch {
    // ignore
  }

  interface RailPalette {
    bg: string;
    border: string;
    fg: string;
    mutedFg: string;
    hoverBg: string;
    activeBg: string;
    activeBorder: string;
    indicator: string;
    folderColor: string;
    tipBg: string;
    tipFg: string;
  }

  function getRailPalette(colorTheme: string, mode: 'dark' | 'light'): RailPalette {
    if (mode === 'dark') {
      switch (colorTheme) {
        case 'glacier-blue':
          return {
            bg: 'linear-gradient(180deg, rgba(14, 23, 38, 0.99) 0%, rgba(6, 10, 18, 0.99) 100%)',
            border: 'rgba(56, 189, 248, 0.18)',
            fg: '#f1f5f9',
            mutedFg: '#94a3b8',
            hoverBg: 'rgba(255, 255, 255, 0.09)',
            activeBg: 'rgba(6, 182, 212, 0.18)',
            activeBorder: 'rgba(56, 189, 248, 0.42)',
            indicator: '#38bdf8',
            folderColor: '#fbbf24',
            tipBg: 'rgba(14, 23, 38, 0.98)',
            tipFg: '#f8fafc'
          };
        case 'midnight-amethyst':
          return {
            bg: 'linear-gradient(180deg, rgba(22, 12, 36, 0.99) 0%, rgba(9, 5, 18, 0.99) 100%)',
            border: 'rgba(192, 132, 252, 0.18)',
            fg: '#f5f3ff',
            mutedFg: '#a78bfa',
            hoverBg: 'rgba(255, 255, 255, 0.09)',
            activeBg: 'rgba(168, 85, 247, 0.2)',
            activeBorder: 'rgba(192, 132, 252, 0.45)',
            indicator: '#e879f9',
            folderColor: '#fbbf24',
            tipBg: 'rgba(22, 12, 36, 0.98)',
            tipFg: '#faf5ff'
          };
        case 'forest-sage':
          return {
            bg: 'linear-gradient(180deg, rgba(13, 26, 20, 0.99) 0%, rgba(5, 10, 8, 0.99) 100%)',
            border: 'rgba(52, 211, 153, 0.18)',
            fg: '#ecfdf5',
            mutedFg: '#9ca3af',
            hoverBg: 'rgba(255, 255, 255, 0.09)',
            activeBg: 'rgba(16, 185, 129, 0.18)',
            activeBorder: 'rgba(52, 211, 153, 0.42)',
            indicator: '#f59e0b',
            folderColor: '#fbbf24',
            tipBg: 'rgba(13, 26, 20, 0.98)',
            tipFg: '#ecfdf5'
          };
        case 'warm-terracotta':
          return {
            bg: 'linear-gradient(180deg, rgba(32, 17, 10, 0.99) 0%, rgba(13, 5, 2, 0.99) 100%)',
            border: 'rgba(251, 146, 60, 0.18)',
            fg: '#fff7ed',
            mutedFg: '#a8a29e',
            hoverBg: 'rgba(255, 255, 255, 0.09)',
            activeBg: 'rgba(234, 88, 12, 0.2)',
            activeBorder: 'rgba(251, 146, 60, 0.45)',
            indicator: '#fed7aa',
            folderColor: '#fb923c',
            tipBg: 'rgba(32, 17, 10, 0.98)',
            tipFg: '#fff7ed'
          };
        case 'crystal-aqua':
        case 'aqua-lagoon':
          return {
            bg: 'linear-gradient(180deg, rgba(8, 36, 42, 0.99) 0%, rgba(6, 20, 28, 0.99) 100%)',
            border: 'rgba(45, 212, 191, 0.18)',
            fg: '#f0fdfa',
            mutedFg: '#94a3b8',
            hoverBg: 'rgba(255, 255, 255, 0.09)',
            activeBg: 'rgba(20, 184, 166, 0.2)',
            activeBorder: 'rgba(45, 212, 191, 0.44)',
            indicator: '#2dd4bf',
            folderColor: '#fbbf24',
            tipBg: 'rgba(8, 36, 42, 0.98)',
            tipFg: '#f0fdfa'
          };
        case 'arctic-aurora':
          return {
            bg: 'linear-gradient(180deg, rgba(10, 32, 42, 0.99) 0%, rgba(24, 22, 58, 0.99) 100%)',
            border: 'rgba(56, 189, 248, 0.18)',
            fg: '#f0f9ff',
            mutedFg: '#94a3b8',
            hoverBg: 'rgba(255, 255, 255, 0.09)',
            activeBg: 'rgba(56, 189, 248, 0.18)',
            activeBorder: 'rgba(45, 212, 191, 0.42)',
            indicator: '#2dd4bf',
            folderColor: '#fbbf24',
            tipBg: 'rgba(12, 28, 44, 0.98)',
            tipFg: '#f0f9ff'
          };
        case 'coral-breeze':
          return {
            bg: 'linear-gradient(180deg, rgba(38, 15, 28, 0.99) 0%, rgba(24, 12, 14, 0.99) 100%)',
            border: 'rgba(251, 113, 133, 0.18)',
            fg: '#fff1f2',
            mutedFg: '#a8a29e',
            hoverBg: 'rgba(255, 255, 255, 0.09)',
            activeBg: 'rgba(244, 63, 94, 0.18)',
            activeBorder: 'rgba(251, 113, 133, 0.42)',
            indicator: '#fb923c',
            folderColor: '#fbbf24',
            tipBg: 'rgba(38, 15, 28, 0.98)',
            tipFg: '#fff1f2'
          };
        case 'slate-grey':
          return {
            bg: 'linear-gradient(180deg, rgba(34, 34, 38, 0.99) 0%, rgba(19, 19, 21, 0.99) 100%)',
            border: 'rgba(255, 255, 255, 0.13)',
            fg: '#f4f4f5',
            mutedFg: '#a1a1aa',
            hoverBg: 'rgba(255, 255, 255, 0.09)',
            activeBg: 'rgba(212, 212, 216, 0.15)',
            activeBorder: 'rgba(212, 212, 216, 0.34)',
            indicator: '#e4e4e7',
            folderColor: '#fbbf24',
            tipBg: 'rgba(28, 28, 32, 0.98)',
            tipFg: '#f4f4f5'
          };
        default:
          return {
            bg: 'linear-gradient(180deg, rgba(24, 24, 27, 0.99) 0%, rgba(9, 9, 11, 0.99) 100%)',
            border: 'rgba(255, 255, 255, 0.13)',
            fg: '#fafafa',
            mutedFg: '#a1a1aa',
            hoverBg: 'rgba(255, 255, 255, 0.09)',
            activeBg: 'rgba(255, 255, 255, 0.13)',
            activeBorder: 'rgba(255, 255, 255, 0.34)',
            indicator: '#ffffff',
            folderColor: '#fbbf24',
            tipBg: 'rgba(24, 24, 27, 0.98)',
            tipFg: '#fafafa'
          };
      }
    } else {
      switch (colorTheme) {
        case 'glacier-blue':
          return {
            bg: 'linear-gradient(180deg, rgba(240, 247, 255, 0.99) 0%, rgba(224, 238, 250, 0.99) 100%)',
            border: 'rgba(2, 132, 199, 0.18)',
            fg: '#0f172a',
            mutedFg: '#475569',
            hoverBg: 'rgba(2, 132, 199, 0.09)',
            activeBg: 'rgba(2, 132, 199, 0.14)',
            activeBorder: 'rgba(2, 132, 199, 0.36)',
            indicator: '#0284c7',
            folderColor: '#d97706',
            tipBg: 'rgba(15, 23, 42, 0.95)',
            tipFg: '#f8fafc'
          };
        case 'midnight-amethyst':
          return {
            bg: 'linear-gradient(180deg, rgba(251, 247, 255, 0.99) 0%, rgba(238, 228, 250, 0.99) 100%)',
            border: 'rgba(139, 92, 246, 0.18)',
            fg: '#1e1b4b',
            mutedFg: '#5b21b6',
            hoverBg: 'rgba(139, 92, 246, 0.09)',
            activeBg: 'rgba(139, 92, 246, 0.14)',
            activeBorder: 'rgba(139, 92, 246, 0.36)',
            indicator: '#c026d3',
            folderColor: '#d97706',
            tipBg: 'rgba(24, 24, 27, 0.95)',
            tipFg: '#faf5ff'
          };
        case 'forest-sage':
          return {
            bg: 'linear-gradient(180deg, rgba(242, 248, 244, 0.99) 0%, rgba(222, 238, 227, 0.99) 100%)',
            border: 'rgba(5, 150, 105, 0.18)',
            fg: '#064e3b',
            mutedFg: '#374151',
            hoverBg: 'rgba(5, 150, 105, 0.09)',
            activeBg: 'rgba(5, 150, 105, 0.14)',
            activeBorder: 'rgba(5, 150, 105, 0.36)',
            indicator: '#d97706',
            folderColor: '#d97706',
            tipBg: 'rgba(24, 24, 27, 0.95)',
            tipFg: '#ecfdf5'
          };
        case 'warm-terracotta':
          return {
            bg: 'linear-gradient(180deg, rgba(255, 247, 237, 0.99) 0%, rgba(254, 232, 210, 0.99) 100%)',
            border: 'rgba(234, 88, 12, 0.18)',
            fg: '#431407',
            mutedFg: '#57534e',
            hoverBg: 'rgba(234, 88, 12, 0.09)',
            activeBg: 'rgba(234, 88, 12, 0.14)',
            activeBorder: 'rgba(234, 88, 12, 0.36)',
            indicator: '#ea580c',
            folderColor: '#ea580c',
            tipBg: 'rgba(24, 24, 27, 0.95)',
            tipFg: '#fff7ed'
          };
        case 'crystal-aqua':
        case 'aqua-lagoon':
          return {
            bg: 'linear-gradient(180deg, rgba(240, 253, 250, 0.99) 0%, rgba(209, 250, 240, 0.99) 100%)',
            border: 'rgba(13, 148, 136, 0.18)',
            fg: '#134e4a',
            mutedFg: '#475569',
            hoverBg: 'rgba(13, 148, 136, 0.09)',
            activeBg: 'rgba(20, 184, 166, 0.15)',
            activeBorder: 'rgba(13, 148, 136, 0.36)',
            indicator: '#0d9488',
            folderColor: '#d97706',
            tipBg: 'rgba(24, 24, 27, 0.95)',
            tipFg: '#f0fdfa'
          };
        case 'arctic-aurora':
          return {
            bg: 'linear-gradient(180deg, rgba(240, 253, 250, 0.99) 0%, rgba(224, 242, 254, 0.99) 55%, rgba(237, 233, 254, 0.99) 100%)',
            border: 'rgba(2, 132, 199, 0.18)',
            fg: '#0f172a',
            mutedFg: '#475569',
            hoverBg: 'rgba(2, 132, 199, 0.09)',
            activeBg: 'rgba(14, 165, 233, 0.14)',
            activeBorder: 'rgba(20, 184, 166, 0.36)',
            indicator: '#14b8a6',
            folderColor: '#d97706',
            tipBg: 'rgba(24, 24, 27, 0.95)',
            tipFg: '#f8fafc'
          };
        case 'coral-breeze':
          return {
            bg: 'linear-gradient(180deg, rgba(255, 251, 254, 0.99) 0%, rgba(255, 228, 230, 0.99) 55%, rgba(255, 237, 213, 0.99) 100%)',
            border: 'rgba(225, 29, 72, 0.17)',
            fg: '#4c0519',
            mutedFg: '#57534e',
            hoverBg: 'rgba(225, 29, 72, 0.08)',
            activeBg: 'rgba(244, 63, 94, 0.13)',
            activeBorder: 'rgba(244, 63, 94, 0.34)',
            indicator: '#f97316',
            folderColor: '#d97706',
            tipBg: 'rgba(24, 24, 27, 0.95)',
            tipFg: '#fff1f2'
          };
        case 'slate-grey':
          return {
            bg: 'linear-gradient(180deg, rgba(244, 244, 245, 0.99) 0%, rgba(228, 230, 235, 0.99) 100%)',
            border: 'rgba(0, 0, 0, 0.11)',
            fg: '#18181b',
            mutedFg: '#52525b',
            hoverBg: 'rgba(0, 0, 0, 0.06)',
            activeBg: 'rgba(63, 63, 70, 0.12)',
            activeBorder: 'rgba(63, 63, 70, 0.28)',
            indicator: '#27272a',
            folderColor: '#d97706',
            tipBg: 'rgba(24, 24, 27, 0.95)',
            tipFg: '#fafafa'
          };
        default:
          return {
            bg: 'linear-gradient(180deg, rgba(255, 255, 255, 0.99) 0%, rgba(244, 244, 245, 0.99) 100%)',
            border: 'rgba(0, 0, 0, 0.1)',
            fg: '#18181b',
            mutedFg: '#52525b',
            hoverBg: 'rgba(0, 0, 0, 0.06)',
            activeBg: 'rgba(0, 0, 0, 0.08)',
            activeBorder: 'rgba(0, 0, 0, 0.24)',
            indicator: '#18181b',
            folderColor: '#d97706',
            tipBg: 'rgba(24, 24, 27, 0.95)',
            tipFg: '#fafafa'
          };
      }
    }
  }

  const FOLDER_CLOSED_SVG = `<svg class="arctic-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;
  const FOLDER_OPEN_SVG = `<svg class="arctic-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>`;

  let myWindowId: number | null = null;
  let openWindowIds: number[] = [];
  let isEnabled = false;
  let triggerMode: EdgeTriggerMode = 'push';
  let isStateInitialized = false;
  let hasHydratedItems = false;
  let dockSide: 'left' | 'right' = 'left';
  let themeMode: 'light' | 'dark' | 'system' = 'light';
  let colorTheme = 'pure-monochrome';
  let quickAccessItems: EdgeQuickAccessItem[] = [];
  let spaceItems: EdgeSpaceNode[] = [];
  let todayTabItems: EdgeTodayTabItem[] = [];
  let isOptimisticallyOpening = false;
  let optimisticTimer: ReturnType<typeof setTimeout> | null = null;

  let isHoverExpanded = false;
  let isPointerInsideRail = false;
  let isHoverTrackingActive = false;
  let hoverCollapseTimer: ReturnType<typeof setTimeout> | null = null;

  const MIN_THUMB_HEIGHT_PX = 24;
  let isDraggingScrollbar = false;
  let scrollbarDragStartY = 0;
  let scrollbarDragStartScrollTop = 0;
  let scrollFadeTimer: ReturnType<typeof setTimeout> | null = null;
  let listResizeObserver: ResizeObserver | null = null;
  let lastActiveItemKey: string | null = null;

  let openFolderId: string | null = null;
  let openFolderAnchorTop = 48;
  const subfolderExpansionOverrides = new Map<string, boolean>();
  const localFaviconCache = new Map<string, string>();

  // Page-push state
  let activePushedSide: 'left' | 'right' | null = null;
  const shiftedFixedElements = new Map<HTMLElement, SavedFixedStyle>();
  let pagePushSettleTimer: ReturnType<typeof setTimeout> | null = null;
  let pagePushObserver: MutationObserver | null = null;

  // Viewport-synchronized handoff state (prevents opposite-direction page bounce in 'push' mode)
  let pendingOpenHandoff = false;
  let openHandoffBaselineWidth = 0;
  let openHandoffTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingCloseHandoff = false;
  let closeHandoffBaselineWidth = 0;
  let closeHandoffTimer: ReturnType<typeof setTimeout> | null = null;
  let wasSidePanelOpenInMyWindow = false;
  let lastOpenPanelViewportWidth: number | null = null;
  let openWidthSettleTimer: ReturnType<typeof setTimeout> | null = null;

  let hostEl: HTMLDivElement | null = null;
  let shadowRootRef: ShadowRoot | null = null;
  let hoverSensorEl: HTMLDivElement | null = null;
  let railEl: HTMLElement | null = null;
  let expandBtnEl: HTMLButtonElement | null = null;
  let dividerEl: HTMLDivElement | null = null;
  let scrollWrapEl: HTMLDivElement | null = null;
  let listEl: HTMLDivElement | null = null;
  let scrollTrackEl: HTMLDivElement | null = null;
  let scrollThumbEl: HTMLDivElement | null = null;
  let flyoutEl: HTMLDivElement | null = null;
  let tooltipEl: HTMLDivElement | null = null;

  function isExtensionContextValid(): boolean {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function resolveEffectiveTheme(): 'dark' | 'light' {
    if (themeMode === 'dark') return 'dark';
    if (themeMode === 'light') return 'light';
    try {
      if (typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
    } catch {
      // ignore
    }
    return 'light';
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

  function isSidePanelOpenInMyWindow(): boolean {
    if (typeof myWindowId !== 'number') return false;
    return openWindowIds.includes(myWindowId);
  }

  function shouldShowTrigger(): boolean {
    if (!isExtensionContextValid()) return false;
    if (!isStateInitialized) return false;
    if (typeof myWindowId !== 'number') return false;
    if (!isEnabled) return false;
    if (isOptimisticallyOpening) return false;
    if (isSidePanelOpenInMyWindow()) return false;
    if (typeof document !== 'undefined' && document.fullscreenElement) return false;
    return true;
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

  function clearOpenHandoff(restoreInteractivity = false): void {
    pendingOpenHandoff = false;
    openHandoffBaselineWidth = 0;
    if (openHandoffTimer) {
      clearTimeout(openHandoffTimer);
      openHandoffTimer = null;
    }
    if (restoreInteractivity && railEl) {
      railEl.removeAttribute('data-opening');
    }
  }

  function clearCloseHandoff(): void {
    pendingCloseHandoff = false;
    closeHandoffBaselineWidth = 0;
    if (closeHandoffTimer) {
      clearTimeout(closeHandoffTimer);
      closeHandoffTimer = null;
    }
  }

  function recordOpenPanelViewportWidth(immediate: boolean): void {
    if (!hasRealViewportLayout()) return;
    const vw = window.innerWidth;
    if (immediate || lastOpenPanelViewportWidth === null || vw < lastOpenPanelViewportWidth) {
      lastOpenPanelViewportWidth = vw;
      if (openWidthSettleTimer) {
        clearTimeout(openWidthSettleTimer);
        openWidthSettleTimer = null;
      }
      return;
    }
    if (openWidthSettleTimer) {
      clearTimeout(openWidthSettleTimer);
    }
    openWidthSettleTimer = setTimeout(() => {
      openWidthSettleTimer = null;
      if (isSidePanelOpenInMyWindow() && hasRealViewportLayout()) {
        lastOpenPanelViewportWidth = window.innerWidth;
      }
    }, 250);
  }

  function canHoldPushForOpening(): boolean {
    return (
      isExtensionContextValid() &&
      isStateInitialized &&
      typeof myWindowId === 'number' &&
      isEnabled &&
      triggerMode === 'push' &&
      !(typeof document !== 'undefined' && document.fullscreenElement) &&
      (isOptimisticallyOpening || isSidePanelOpenInMyWindow()) &&
      Boolean(hostEl) &&
      activePushedSide !== null &&
      hasRealViewportLayout()
    );
  }

  /* -------------------------------------------------------------
     NON-OVERLAPPING PAGE PUSH ENGINE (36px layout shift)
     ------------------------------------------------------------- */

  function restoreShiftedFixedElements(): void {
    for (const [el, saved] of shiftedFixedElements.entries()) {
      try {
        if (saved.value) {
          el.style.setProperty(saved.prop, saved.value, saved.priority);
        } else {
          el.style.removeProperty(saved.prop);
        }
        if (saved.adjustedMaxWidth) {
          if (saved.maxWidthValue) {
            el.style.setProperty('max-width', saved.maxWidthValue, saved.maxWidthPriority);
          } else {
            el.style.removeProperty('max-width');
          }
        }
      } catch {
        // ignore detached node errors
      }
    }
    shiftedFixedElements.clear();
  }

  function removePagePush(): void {
    if (pagePushSettleTimer) {
      clearTimeout(pagePushSettleTimer);
      pagePushSettleTimer = null;
    }
    if (pagePushObserver) {
      pagePushObserver.disconnect();
      pagePushObserver = null;
    }
    restoreShiftedFixedElements();
    activePushedSide = null;

    if (typeof document !== 'undefined') {
      document.documentElement?.removeAttribute('data-arctic-edge-push');
      document.getElementById(PAGE_PUSH_STYLE_ID)?.remove();
    }
  }

  function ensurePagePushStylesheet(): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById(PAGE_PUSH_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = PAGE_PUSH_STYLE_ID;
    style.textContent = `
      html[data-arctic-edge-push="left"] {
        margin-left: ${RAIL_WIDTH_PX}px !important;
        width: calc(100% - ${RAIL_WIDTH_PX}px) !important;
        max-width: calc(100vw - ${RAIL_WIDTH_PX}px) !important;
        box-sizing: border-box !important;
      }
      html[data-arctic-edge-push="right"] {
        margin-right: ${RAIL_WIDTH_PX}px !important;
        width: calc(100% - ${RAIL_WIDTH_PX}px) !important;
        max-width: calc(100vw - ${RAIL_WIDTH_PX}px) !important;
        box-sizing: border-box !important;
      }
      html[data-arctic-edge-push] > body {
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      html[data-arctic-edge-push] > body > div:not(#arctic-edge-trigger-host),
      html[data-arctic-edge-push] > body > main,
      html[data-arctic-edge-push] > body > app-root,
      html[data-arctic-edge-push] .w-screen {
        max-width: calc(100vw - ${RAIL_WIDTH_PX}px) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function shiftEdgeFixedElements(side: 'left' | 'right'): void {
    if (typeof document === 'undefined' || !document.body) return;

    // Pass 1 (Pure DOM Reads): collect any previously shifted elements that are no longer fixed,
    // plus all new outermost fixed elements overlapping the docked edge, without mutating styles mid-loop.
    const toRestore: Array<[HTMLElement, SavedFixedStyle]> = [];
    for (const [el, saved] of Array.from(shiftedFixedElements.entries())) {
      if (!el.isConnected) {
        shiftedFixedElements.delete(el);
        continue;
      }
      if (window.getComputedStyle(el).position !== 'fixed') {
        toRestore.push([el, saved]);
      }
    }

    const candidates = new Set<HTMLElement>();

    // 1. Fast C++ hit-test along the docked edge
    if (typeof document.elementsFromPoint === 'function' && window.innerHeight > 0) {
      const sampleX = side === 'left' ? 4 : Math.max(0, window.innerWidth - 4);
      const vh = window.innerHeight;
      const sampleYs = [
        12,
        64,
        160,
        Math.round(vh * 0.45),
        Math.round(vh * 0.72),
        Math.max(12, vh - 24)
      ];
      for (const y of sampleYs) {
        if (y < 0 || y >= vh) continue;
        try {
          const stack = document.elementsFromPoint(sampleX, y);
          for (const node of stack) {
            let curr = node as HTMLElement | null;
            while (curr && curr !== document.body && curr !== document.documentElement) {
              if (curr.id === 'arctic-edge-trigger-host') break;
              if (curr instanceof HTMLElement) {
                candidates.add(curr);
              }
              curr = curr.parentElement;
            }
          }
        } catch {
          // ignore
        }
      }
    }

    // 2. Shallow DOM scan (depth <= 4, capped at 240 elements) for fixed wrappers & headless/test environments
    let visited = 0;
    const walkShallow = (parent: Element, depth: number) => {
      if (depth > 4 || visited >= 240) return;
      const children = parent.children;
      for (let i = 0; i < children.length && visited < 240; i++) {
        const child = children[i];
        if (child.id === 'arctic-edge-trigger-host') continue;
        const tag = child.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'NOSCRIPT') continue;
        visited++;
        if (child instanceof HTMLElement) {
          candidates.add(child);
          walkShallow(child, depth + 1);
        }
      }
    };
    walkShallow(document.body, 1);

    const fixedCandidates: HTMLElement[] = [];
    const fixedCandidateSet = new Set<HTMLElement>();
    for (const el of candidates) {
      if (shiftedFixedElements.has(el)) continue;
      try {
        if (window.getComputedStyle(el).position === 'fixed') {
          fixedCandidates.push(el);
          fixedCandidateSet.add(el);
        }
      } catch {
        // ignore
      }
    }

    interface PendingFixedShift {
      el: HTMLElement;
      prop: 'left' | 'right';
      targetPx: number;
      spansFullViewport: boolean;
      saved: SavedFixedStyle;
    }

    const pendingShifts: PendingFixedShift[] = [];
    const vw = window.innerWidth || 0;

    // Only shift outermost fixed elements (avoid double-shifting a fixed child inside a fixed parent)
    for (const el of fixedCandidates) {
      let hasFixedAncestor = false;
      let parent = el.parentElement;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        if (shiftedFixedElements.has(parent) || fixedCandidateSet.has(parent)) {
          hasFixedAncestor = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (hasFixedAncestor) continue;

      const cs = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const hasLayoutBox = rect.width > 0 || rect.height > 0;

      let overlapsEdge = false;
      let baseOffsetPx = 0;

      if (hasLayoutBox && vw > 0) {
        if (side === 'left') {
          if (rect.left >= -2 && rect.left < RAIL_WIDTH_PX) {
            overlapsEdge = true;
            baseOffsetPx = Math.max(0, Math.round(rect.left));
          }
        } else {
          if (rect.right > vw - RAIL_WIDTH_PX && rect.right <= vw + 2) {
            overlapsEdge = true;
            baseOffsetPx = Math.max(0, Math.round(vw - rect.right));
          }
        }
      } else {
        // Fallback when layout metrics are 0 (e.g. JSDOM or pre-layout)
        if (side === 'left') {
          if (cs.left === '0px' || el.style.left === '0px' || el.style.left === '0') {
            overlapsEdge = true;
            baseOffsetPx = 0;
          }
        } else {
          if (cs.right === '0px' || el.style.right === '0px' || el.style.right === '0') {
            overlapsEdge = true;
            baseOffsetPx = 0;
          }
        }
      }

      if (!overlapsEdge) continue;

      const prop: 'left' | 'right' = side;
      const spansFullViewport = hasLayoutBox && vw > 0 && rect.width >= vw - 4;

      pendingShifts.push({
        el,
        prop,
        targetPx: baseOffsetPx + RAIL_WIDTH_PX,
        spansFullViewport,
        saved: {
          prop,
          value: el.style.getPropertyValue(prop),
          priority: el.style.getPropertyPriority(prop),
          maxWidthValue: el.style.getPropertyValue('max-width'),
          maxWidthPriority: el.style.getPropertyPriority('max-width'),
          adjustedMaxWidth: spansFullViewport
        }
      });
    }

    // Pass 2 (Pure DOM Writes): apply all style restorations and fixed shifts in a single batch
    for (const [el, saved] of toRestore) {
      if (saved.value) el.style.setProperty(saved.prop, saved.value, saved.priority);
      else el.style.removeProperty(saved.prop);
      if (saved.adjustedMaxWidth) {
        if (saved.maxWidthValue) {
          el.style.setProperty('max-width', saved.maxWidthValue, saved.maxWidthPriority);
        } else {
          el.style.removeProperty('max-width');
        }
      }
      shiftedFixedElements.delete(el);
    }

    for (const shift of pendingShifts) {
      shift.el.style.setProperty(shift.prop, `${shift.targetPx}px`, 'important');
      if (shift.spansFullViewport) {
        shift.el.style.setProperty('max-width', `calc(100vw - ${RAIL_WIDTH_PX}px)`, 'important');
      }
      shiftedFixedElements.set(shift.el, shift.saved);
    }
  }

  function schedulePagePushFixedPass(): void {
    if (pagePushSettleTimer) return;
    pagePushSettleTimer = setTimeout(() => {
      pagePushSettleTimer = null;
      if (activePushedSide && shouldShowTrigger() && triggerMode === 'push') {
        shiftEdgeFixedElements(activePushedSide);
      }
    }, 180);
  }

  function syncPagePush(): void {
    if (!shouldShowTrigger() || triggerMode !== 'push') {
      removePagePush();
      return;
    }

    if (activePushedSide && activePushedSide !== dockSide) {
      restoreShiftedFixedElements();
    }

    activePushedSide = dockSide;
    // Measure & shift viewport-anchored fixed elements BEFORE dirtying documentElement layout
    // so Blink performs zero forced synchronous reflows in JS.
    shiftEdgeFixedElements(dockSide);
    ensurePagePushStylesheet();
    document.documentElement?.setAttribute('data-arctic-edge-push', dockSide);

    if (!pagePushObserver && typeof MutationObserver !== 'undefined' && document.body) {
      pagePushObserver = new MutationObserver(() => {
        schedulePagePushFixedPass();
      });
      pagePushObserver.observe(document.body, { childList: true, subtree: false });
      const appRoot =
        document.getElementById('root') ||
        document.getElementById('__next') ||
        document.getElementById('app');
      if (appRoot) {
        pagePushObserver.observe(appRoot, { childList: true, subtree: false });
      }
    }

    schedulePagePushFixedPass();
  }

  /* -------------------------------------------------------------
     STYLES & SHADOW DOM RENDERING
     ------------------------------------------------------------- */

  function getStyles(): string {
    return `
      :host {
        all: initial;
      }
      .arctic-hover-sensor {
        position: fixed;
        top: 0;
        bottom: 0;
        height: 100vh;
        width: 5px;
        z-index: 2147483645;
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .arctic-hover-sensor[data-visible="false"] {
        display: none;
      }
      .arctic-hover-sensor[data-side="left"] {
        left: 0;
      }
      .arctic-hover-sensor[data-side="right"] {
        right: 0;
      }
      .arctic-hover-pill {
        width: 2.5px;
        height: 36px;
        border-radius: 99px;
        background: var(--arctic-indicator);
        opacity: 0.35;
        pointer-events: none;
        transition: opacity 150ms ease, height 150ms ease;
      }
      .arctic-hover-sensor:hover .arctic-hover-pill {
        opacity: 0.85;
        height: 48px;
      }
      .arctic-rail {
        position: fixed;
        top: 0;
        bottom: 0;
        height: 100vh;
        width: ${RAIL_WIDTH_PX}px;
        z-index: 2147483646;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 8px 4px;
        box-sizing: border-box;
        background: var(--arctic-rail-bg);
        contain: layout style;
        user-select: none;
        -webkit-user-select: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.14);
        transition: transform 150ms cubic-bezier(0.16, 1, 0.3, 1), opacity 140ms ease;
      }
      .arctic-rail[data-side="left"] {
        left: 0;
        border-right: 1px solid var(--arctic-rail-border);
        --arctic-slide-off: -100%;
      }
      .arctic-rail[data-side="right"] {
        right: 0;
        border-left: 1px solid var(--arctic-rail-border);
        --arctic-slide-off: 100%;
      }
      .arctic-rail[data-mode="hover"][data-expanded="false"] {
        transform: translateX(var(--arctic-slide-off, -100%));
        opacity: 0;
        pointer-events: none !important;
        box-shadow: none;
      }
      .arctic-rail[data-mode="hover"][data-expanded="true"],
      .arctic-rail[data-mode="push"] {
        transform: translateX(0);
        opacity: 1;
        pointer-events: auto;
      }
      .arctic-rail[data-opening="true"] {
        pointer-events: none !important;
      }
      .arctic-expand-btn {
        position: relative;
        width: 28px;
        height: 28px;
        padding: 0;
        margin: 0;
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: var(--arctic-muted-fg);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        outline: none;
        transition: background 140ms ease, color 140ms ease, transform 110ms ease;
      }
      .arctic-expand-btn:hover,
      .arctic-expand-btn:focus-visible {
        background: var(--arctic-hover-bg);
        color: var(--arctic-fg);
      }
      .arctic-expand-btn:active {
        transform: scale(0.93);
      }
      .arctic-expand-icon {
        width: 16px;
        height: 16px;
        pointer-events: none;
      }
      .arctic-rail[data-side="right"] .arctic-expand-icon {
        transform: scaleX(-1);
      }
      .arctic-divider {
        width: 18px;
        height: 1px;
        background: var(--arctic-rail-border);
        margin: 6px 0;
        flex-shrink: 0;
      }
      .arctic-divider[data-hidden="true"] {
        display: none;
      }
      .arctic-section-sep {
        width: 20px;
        height: 1px;
        background: var(--arctic-rail-border);
        margin: 4px 0;
        flex-shrink: 0;
      }
      .arctic-scroll-wrap {
        position: relative;
        display: flex;
        flex-direction: column;
        width: calc(100% + 8px);
        margin: 0 -4px;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .arctic-scroll-wrap[data-hidden="true"] {
        display: none;
      }
      .arctic-qa-list {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        width: 100%;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: none;
        padding: 1px 4px 8px 4px;
        box-sizing: border-box;
      }
      .arctic-qa-list::-webkit-scrollbar {
        display: none;
      }
      .arctic-qa-list[data-can-scroll-up="true"][data-can-scroll-down="false"] {
        -webkit-mask-image: linear-gradient(to bottom, transparent 0px, #000 12px, #000 100%);
        mask-image: linear-gradient(to bottom, transparent 0px, #000 12px, #000 100%);
      }
      .arctic-qa-list[data-can-scroll-up="false"][data-can-scroll-down="true"] {
        -webkit-mask-image: linear-gradient(to bottom, #000 0px, #000 calc(100% - 14px), transparent 100%);
        mask-image: linear-gradient(to bottom, #000 0px, #000 calc(100% - 14px), transparent 100%);
      }
      .arctic-qa-list[data-can-scroll-up="true"][data-can-scroll-down="true"] {
        -webkit-mask-image: linear-gradient(to bottom, transparent 0px, #000 12px, #000 calc(100% - 14px), transparent 100%);
        mask-image: linear-gradient(to bottom, transparent 0px, #000 12px, #000 calc(100% - 14px), transparent 100%);
      }
      .arctic-scroll-track {
        position: absolute;
        top: 2px;
        bottom: 4px;
        width: 6px;
        z-index: 4;
        display: flex;
        padding: 0 1px;
        box-sizing: border-box;
        cursor: pointer;
        touch-action: none;
        opacity: 0;
        pointer-events: none;
        transition: opacity 150ms ease;
      }
      .arctic-rail[data-side="left"] .arctic-scroll-track {
        right: 0;
        justify-content: flex-end;
      }
      .arctic-rail[data-side="right"] .arctic-scroll-track {
        left: 0;
        justify-content: flex-start;
      }
      .arctic-scroll-track[data-scrollable="true"] {
        opacity: 0.38;
        pointer-events: auto;
      }
      .arctic-rail:hover .arctic-scroll-track[data-scrollable="true"],
      .arctic-scroll-track[data-scrollable="true"][data-scrolling="true"] {
        opacity: 0.78;
      }
      .arctic-scroll-track[data-scrollable="true"]:hover,
      .arctic-scroll-track[data-scrollable="true"][data-dragging="true"] {
        opacity: 0.96;
      }
      .arctic-scroll-thumb {
        width: 2.5px;
        min-height: 24px;
        border-radius: 99px;
        background: var(--arctic-muted-fg);
        transform: translateY(0px);
        transition: width 120ms ease, background 120ms ease;
        will-change: transform, height;
      }
      .arctic-scroll-track:hover .arctic-scroll-thumb,
      .arctic-scroll-track[data-dragging="true"] .arctic-scroll-thumb {
        width: 4px;
        background: var(--arctic-indicator);
      }
      .arctic-qa-btn {
        position: relative;
        width: 28px;
        height: 28px;
        padding: 0;
        margin: 0;
        border-radius: 8px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--arctic-fg);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        outline: none;
        transition: background 140ms ease, border-color 140ms ease, transform 110ms ease;
      }
      .arctic-qa-btn:hover,
      .arctic-qa-btn:focus-visible {
        background: var(--arctic-hover-bg);
      }
      .arctic-qa-btn[data-open="true"]:not([data-active="true"]) {
        background: var(--arctic-hover-bg);
      }
      .arctic-qa-btn[data-active="true"],
      .arctic-qa-btn[data-flyout-open="true"] {
        background: var(--arctic-active-bg);
        border-color: var(--arctic-active-border);
      }
      .arctic-qa-btn:active {
        transform: scale(0.93);
      }
      .arctic-folder-btn {
        color: var(--arctic-folder-color);
      }
      .arctic-folder-icon {
        width: 15px;
        height: 15px;
        pointer-events: none;
      }
      .arctic-qa-favicon {
        width: 16px;
        height: 16px;
        border-radius: 4px;
        object-fit: contain;
        pointer-events: none;
        display: block;
      }
      .arctic-qa-monogram {
        width: 17px;
        height: 17px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--arctic-hover-bg);
        color: var(--arctic-fg);
        pointer-events: none;
        flex-shrink: 0;
      }
      .arctic-active-bar {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 2.5px;
        height: 14px;
        border-radius: 99px;
        background: var(--arctic-indicator);
        pointer-events: none;
      }
      .arctic-rail[data-side="left"] .arctic-active-bar {
        left: -4px;
      }
      .arctic-rail[data-side="right"] .arctic-active-bar {
        right: -4px;
      }
      .arctic-open-dot {
        position: absolute;
        bottom: 2px;
        left: 50%;
        transform: translateX(-50%);
        width: 3.5px;
        height: 3.5px;
        border-radius: 99px;
        background: var(--arctic-muted-fg);
        opacity: 0.85;
        pointer-events: none;
      }
      .arctic-drift-dot {
        position: absolute;
        top: 3px;
        right: 3px;
        width: 5px;
        height: 5px;
        border-radius: 99px;
        background: #fbbf24;
        pointer-events: none;
      }
      .arctic-audio-dot {
        position: absolute;
        top: 3px;
        right: 3px;
        width: 5px;
        height: 5px;
        border-radius: 99px;
        background: #34d399;
        pointer-events: none;
      }
      .arctic-qa-btn[data-discarded="true"]:not([data-active="true"]) .arctic-qa-favicon,
      .arctic-qa-btn[data-discarded="true"]:not([data-active="true"]) .arctic-qa-monogram {
        opacity: 0.52;
      }
      .arctic-folder-flyout {
        position: fixed;
        z-index: 2147483647;
        width: 244px;
        max-height: min(400px, calc(100vh - 16px));
        display: flex;
        flex-direction: column;
        border-radius: 12px;
        background: var(--arctic-rail-bg);
        border: 1px solid var(--arctic-rail-border);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
        color: var(--arctic-fg);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        overflow: hidden;
        pointer-events: auto;
        user-select: none;
        -webkit-user-select: none;
        animation: arctic-flyout-in 120ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .arctic-folder-flyout[data-visible="false"] {
        display: none;
      }
      @keyframes arctic-flyout-in {
        from {
          opacity: 0;
          transform: scale(0.97);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }
      .arctic-flyout-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 8px 10px 7px 10px;
        border-bottom: 1px solid var(--arctic-rail-border);
        flex-shrink: 0;
      }
      .arctic-flyout-title-wrap {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        flex: 1;
      }
      .arctic-flyout-header-icon {
        color: var(--arctic-folder-color);
        display: flex;
        align-items: center;
        flex-shrink: 0;
      }
      .arctic-flyout-title {
        font-size: 11.5px;
        font-weight: 700;
        color: var(--arctic-fg);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .arctic-flyout-count {
        font-size: 10px;
        font-weight: 600;
        color: var(--arctic-muted-fg);
        background: var(--arctic-hover-bg);
        padding: 1px 6px;
        border-radius: 99px;
        flex-shrink: 0;
      }
      .arctic-flyout-body {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 5px;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
      }
      .arctic-flyout-empty {
        padding: 12px 8px;
        text-align: center;
        font-size: 11px;
        color: var(--arctic-muted-fg);
      }
      .arctic-flyout-item,
      .arctic-flyout-subfolder {
        position: relative;
        width: 100%;
        min-height: 30px;
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: var(--arctic-fg);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 4px 8px;
        box-sizing: border-box;
        text-align: left;
        outline: none;
        transition: background 120ms ease, border-color 120ms ease;
      }
      .arctic-flyout-item:hover,
      .arctic-flyout-item:focus-visible,
      .arctic-flyout-subfolder:hover,
      .arctic-flyout-subfolder:focus-visible {
        background: var(--arctic-hover-bg);
      }
      .arctic-flyout-item[data-active="true"] {
        background: var(--arctic-active-bg);
        border-color: var(--arctic-active-border);
      }
      .arctic-flyout-label {
        flex: 1;
        min-width: 0;
        font-size: 11.5px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .arctic-flyout-subfolder .arctic-flyout-label {
        font-weight: 600;
      }
      .arctic-flyout-chevron {
        font-size: 9px;
        color: var(--arctic-muted-fg);
        width: 10px;
        text-align: center;
        flex-shrink: 0;
      }
      .arctic-flyout-status {
        width: 6px;
        height: 6px;
        border-radius: 99px;
        flex-shrink: 0;
      }
      .arctic-floating-tooltip {
        position: fixed;
        z-index: 2147483647;
        top: 0;
        transform: translateY(-50%);
        white-space: nowrap;
        max-width: 240px;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.01em;
        padding: 4px 9px;
        border-radius: 7px;
        background: var(--arctic-tip-bg);
        color: var(--arctic-tip-fg);
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
        opacity: 0;
        pointer-events: none;
        transition: opacity 120ms ease;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .arctic-floating-tooltip[data-visible="true"] {
        opacity: 1;
      }
    `;
  }

  function hideTooltip(): void {
    if (tooltipEl) {
      tooltipEl.setAttribute('data-visible', 'false');
    }
  }

  function showTooltipForElement(target: HTMLElement, text: string): void {
    if (!tooltipEl || !text) return;
    const rect = target.getBoundingClientRect();
    tooltipEl.textContent = text;
    tooltipEl.style.top = `${rect.top + rect.height / 2}px`;
    if (dockSide === 'left') {
      tooltipEl.style.left = '42px';
      tooltipEl.style.right = 'auto';
    } else {
      tooltipEl.style.right = '42px';
      tooltipEl.style.left = 'auto';
    }
    tooltipEl.setAttribute('data-visible', 'true');
  }

  const handleExpandedMouseMove = (e: MouseEvent) => {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }
    if (triggerMode !== 'hover' || !isHoverExpanded) {
      syncHoverTrackingListeners();
      return;
    }

    const inRailZone =
      dockSide === 'left'
        ? e.clientX <= RAIL_WIDTH_PX + 4
        : e.clientX >= (window.innerWidth || 0) - (RAIL_WIDTH_PX + 4);
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const inHost = Boolean(hostEl && (e.target === hostEl || path.includes(hostEl)));

    if (inRailZone || inHost) {
      isPointerInsideRail = true;
      if (hoverCollapseTimer) {
        clearTimeout(hoverCollapseTimer);
        hoverCollapseTimer = null;
      }
    } else {
      isPointerInsideRail = false;
      if (!openFolderId && !isDraggingScrollbar && !hoverCollapseTimer) {
        scheduleHoverCollapse();
      }
    }
  };

  const handleDocumentMouseLeave = (e: MouseEvent) => {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }
    if (triggerMode !== 'hover' || !isHoverExpanded || openFolderId || isDraggingScrollbar) return;
    // Do not collapse if cursor simply pressed right up against the docked screen bezel (x <= 2)
    const pressedAgainstDockedEdge =
      dockSide === 'left'
        ? e.clientX <= RAIL_WIDTH_PX && e.clientY >= 0 && e.clientY <= window.innerHeight
        : e.clientX >= (window.innerWidth || 0) - RAIL_WIDTH_PX &&
          e.clientY >= 0 &&
          e.clientY <= window.innerHeight;
    if (!pressedAgainstDockedEdge) {
      isPointerInsideRail = false;
      scheduleHoverCollapse();
    }
  };

  function syncHoverTrackingListeners(): void {
    const shouldTrack = Boolean(hostEl && triggerMode === 'hover' && isHoverExpanded);
    if (shouldTrack && !isHoverTrackingActive) {
      isHoverTrackingActive = true;
      window.addEventListener('mousemove', handleExpandedMouseMove, { passive: true });
      document.addEventListener('mouseleave', handleDocumentMouseLeave);
    } else if (!shouldTrack && isHoverTrackingActive) {
      isHoverTrackingActive = false;
      window.removeEventListener('mousemove', handleExpandedMouseMove);
      document.removeEventListener('mouseleave', handleDocumentMouseLeave);
    }
  }

  function scheduleHoverCollapse(): void {
    if (hoverCollapseTimer) clearTimeout(hoverCollapseTimer);
    hoverCollapseTimer = setTimeout(() => {
      hoverCollapseTimer = null;
      if (
        triggerMode === 'hover' &&
        !isPointerInsideRail &&
        !openFolderId &&
        !isDraggingScrollbar
      ) {
        isHoverExpanded = false;
        syncHoverTrackingListeners();
        hideTooltip();
        updateVisualAttributes();
      }
    }, 150);
  }

  function updateVisualAttributes(): void {
    if (!railEl) return;
    syncHoverTrackingListeners();
    const effective = resolveEffectiveTheme();
    const p = getRailPalette(colorTheme, effective);

    const expanded =
      triggerMode === 'push' ||
      isHoverExpanded ||
      Boolean(openFolderId) ||
      isDraggingScrollbar;

    railEl.setAttribute('data-side', dockSide);
    railEl.setAttribute('data-mode', triggerMode);
    railEl.setAttribute('data-expanded', expanded ? 'true' : 'false');

    if (hoverSensorEl) {
      hoverSensorEl.setAttribute('data-side', dockSide);
      hoverSensorEl.setAttribute(
        'data-visible',
        triggerMode === 'hover' && !expanded ? 'true' : 'false'
      );
    }

    if (expandBtnEl) {
      expandBtnEl.setAttribute('data-side', dockSide);
    }

    const targets = [hoverSensorEl, railEl, flyoutEl, tooltipEl].filter(Boolean) as HTMLElement[];
    for (const el of targets) {
      el.style.setProperty('--arctic-rail-bg', p.bg);
      el.style.setProperty('--arctic-rail-border', p.border);
      el.style.setProperty('--arctic-fg', p.fg);
      el.style.setProperty('--arctic-muted-fg', p.mutedFg);
      el.style.setProperty('--arctic-hover-bg', p.hoverBg);
      el.style.setProperty('--arctic-active-bg', p.activeBg);
      el.style.setProperty('--arctic-active-border', p.activeBorder);
      el.style.setProperty('--arctic-indicator', p.indicator);
      el.style.setProperty('--arctic-folder-color', p.folderColor);
      el.style.setProperty('--arctic-tip-bg', p.tipBg);
      el.style.setProperty('--arctic-tip-fg', p.tipFg);
    }
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

  function collectColdFolderUrls(folder: EdgeFolderNode): string[] {
    const urls: string[] = [];
    const walk = (nodes: EdgeSpaceNode[]) => {
      for (const n of nodes) {
        if (n.type === 'bookmark') {
          if (n.faviconDataUrl) {
            localFaviconCache.set(n.url, n.faviconDataUrl);
          } else if (n.url && !localFaviconCache.has(n.url)) {
            urls.push(n.url);
          }
        } else {
          walk(n.children);
        }
      }
    };
    walk(folder.children);
    return urls;
  }

  function hydrateFolderFavicons(folder: EdgeFolderNode): void {
    if (!isExtensionContextValid()) return;
    const coldUrls = collectColdFolderUrls(folder);
    if (coldUrls.length === 0) return;

    try {
      chrome.runtime.sendMessage(
        { type: 'GET_EDGE_FOLDER_FAVICONS', urls: coldUrls },
        (resp: { ok?: boolean; favicons?: Record<string, string> } | undefined) => {
          void chrome.runtime.lastError;
          if (!resp || !resp.favicons || typeof resp.favicons !== 'object') return;
          let updatedAny = false;
          for (const [u, dataUrl] of Object.entries(resp.favicons)) {
            if (dataUrl) {
              localFaviconCache.set(u, dataUrl);
              updatedAny = true;
            }
          }
          if (updatedAny && openFolderId === folder.id && flyoutEl) {
            renderFolderFlyout();
          }
        }
      );
    } catch {
      // ignore
    }
  }

  function syncFolderButtonsOpenAttr(): void {
    if (!listEl) return;
    const folderBtns = listEl.querySelectorAll<HTMLButtonElement>('button.arctic-folder-btn');
    folderBtns.forEach((btn) => {
      const id = btn.getAttribute('data-folder-id');
      const isOpen = Boolean(openFolderId && id === openFolderId);
      btn.setAttribute('data-flyout-open', isOpen ? 'true' : 'false');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      const iconHolder = btn.querySelector('.arctic-folder-icon-wrap');
      if (iconHolder) {
        iconHolder.innerHTML = isOpen ? FOLDER_OPEN_SVG : FOLDER_CLOSED_SVG;
      }
    });
  }

  function closeFolderFlyout(): void {
    if (!openFolderId && (!flyoutEl || flyoutEl.getAttribute('data-visible') === 'false')) {
      return;
    }
    openFolderId = null;
    if (flyoutEl) {
      flyoutEl.setAttribute('data-visible', 'false');
      flyoutEl.textContent = '';
    }
    syncFolderButtonsOpenAttr();
    if (triggerMode === 'hover' && !isPointerInsideRail) {
      scheduleHoverCollapse();
    } else {
      updateVisualAttributes();
    }
  }

  function sendActivateBookmark(bookmarkId: string, forceReset: boolean): void {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }
    hideTooltip();
    closeFolderFlyout();
    try {
      chrome.runtime.sendMessage(
        {
          type: 'ACTIVATE_QUICK_ACCESS_FROM_EDGE',
          bookmarkId,
          forceReset
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch {
      cleanupAll();
    }
  }

  function renderFolderFlyout(): void {
    if (!flyoutEl) return;
    if (!openFolderId) {
      flyoutEl.setAttribute('data-visible', 'false');
      flyoutEl.textContent = '';
      return;
    }

    const folder = findFolderById(spaceItems, openFolderId);
    if (!folder) {
      closeFolderFlyout();
      return;
    }

    flyoutEl.textContent = '';

    const header = document.createElement('div');
    header.className = 'arctic-flyout-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'arctic-flyout-title-wrap';

    const headerIcon = document.createElement('span');
    headerIcon.className = 'arctic-flyout-header-icon';
    headerIcon.innerHTML = FOLDER_OPEN_SVG;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'arctic-flyout-title';
    titleSpan.textContent = folder.title;

    titleWrap.appendChild(headerIcon);
    titleWrap.appendChild(titleSpan);

    const countBadge = document.createElement('span');
    countBadge.className = 'arctic-flyout-count';
    countBadge.textContent = String(folder.itemCount);

    header.appendChild(titleWrap);
    header.appendChild(countBadge);
    flyoutEl.appendChild(header);

    const body = document.createElement('div');
    body.className = 'arctic-flyout-body';

    if (folder.children.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'arctic-flyout-empty';
      empty.textContent = 'Empty folder';
      body.appendChild(empty);
    } else {
      const appendNodes = (nodes: EdgeSpaceNode[], depth: number) => {
        for (const node of nodes) {
          if (node.type === 'bookmark') {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'arctic-flyout-item';
            row.style.paddingLeft = `${8 + depth * 14}px`;
            row.setAttribute('data-bookmark-id', node.id);
            row.setAttribute('data-active', node.isActive ? 'true' : 'false');
            row.setAttribute('data-open', node.isOpen ? 'true' : 'false');
            row.setAttribute('data-drifted', node.isNavigatedAway ? 'true' : 'false');

            const favSrc = node.faviconDataUrl || localFaviconCache.get(node.url) || '';
            const appendRowMonogram = () => {
              const mono = document.createElement('span');
              mono.className = 'arctic-qa-monogram';
              mono.textContent = getMonogram(node.title, node.url);
              row.insertBefore(mono, row.firstChild);
            };

            if (favSrc) {
              const img = document.createElement('img');
              img.className = 'arctic-qa-favicon';
              img.alt = '';
              img.src = favSrc;
              img.addEventListener('error', () => {
                img.remove();
                appendRowMonogram();
              });
              row.appendChild(img);
            } else {
              const mono = document.createElement('span');
              mono.className = 'arctic-qa-monogram';
              mono.textContent = getMonogram(node.title, node.url);
              row.appendChild(mono);
            }

            const label = document.createElement('span');
            label.className = 'arctic-flyout-label';
            label.textContent =
              node.isNavigatedAway && node.currentTitle && node.currentTitle !== node.title
                ? `${node.title} → ${node.currentTitle}`
                : node.title || node.url;
            row.appendChild(label);

            if (node.isNavigatedAway) {
              const dot = document.createElement('span');
              dot.className = 'arctic-flyout-status';
              dot.style.background = '#fbbf24';
              row.appendChild(dot);
            } else if (node.isActive) {
              const dot = document.createElement('span');
              dot.className = 'arctic-flyout-status';
              dot.style.background = 'var(--arctic-indicator)';
              row.appendChild(dot);
            } else if (node.isOpen) {
              const dot = document.createElement('span');
              dot.className = 'arctic-flyout-status';
              dot.style.background = 'var(--arctic-muted-fg)';
              dot.style.opacity = '0.8';
              row.appendChild(dot);
            }

            row.addEventListener('click', (e) => {
              e.stopPropagation();
              sendActivateBookmark(node.id, false);
            });

            row.addEventListener('dblclick', (e) => {
              e.preventDefault();
              e.stopPropagation();
              sendActivateBookmark(node.id, true);
            });

            body.appendChild(row);
          } else {
            const isExpanded = subfolderExpansionOverrides.has(node.id)
              ? Boolean(subfolderExpansionOverrides.get(node.id))
              : node.hasActiveChild;
            const subBtn = document.createElement('button');
            subBtn.type = 'button';
            subBtn.className = 'arctic-flyout-subfolder';
            subBtn.style.paddingLeft = `${8 + depth * 14}px`;
            subBtn.setAttribute('data-subfolder-id', node.id);
            subBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

            const chev = document.createElement('span');
            chev.className = 'arctic-flyout-chevron';
            chev.textContent = isExpanded ? '▾' : '▸';
            subBtn.appendChild(chev);

            const fIcon = document.createElement('span');
            fIcon.className = 'arctic-flyout-header-icon';
            fIcon.innerHTML = isExpanded ? FOLDER_OPEN_SVG : FOLDER_CLOSED_SVG;
            subBtn.appendChild(fIcon);

            const label = document.createElement('span');
            label.className = 'arctic-flyout-label';
            label.textContent = node.title;
            subBtn.appendChild(label);

            const subCount = document.createElement('span');
            subCount.className = 'arctic-flyout-count';
            subCount.textContent = String(node.itemCount);
            subBtn.appendChild(subCount);

            subBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              subfolderExpansionOverrides.set(node.id, !isExpanded);
              renderFolderFlyout();
            });

            body.appendChild(subBtn);

            if (isExpanded && node.children.length > 0) {
              appendNodes(node.children, depth + 1);
            }
          }
        }
      };

      appendNodes(folder.children, 0);
    }

    flyoutEl.appendChild(body);
    flyoutEl.setAttribute('data-visible', 'true');

    if (dockSide === 'left') {
      flyoutEl.style.left = '42px';
      flyoutEl.style.right = 'auto';
    } else {
      flyoutEl.style.right = '42px';
      flyoutEl.style.left = 'auto';
    }

    const measuredHeight = flyoutEl.offsetHeight || 220;
    const maxTop = Math.max(8, window.innerHeight - measuredHeight - 8);
    const clampedTop = Math.max(8, Math.min(openFolderAnchorTop - 4, maxTop));
    flyoutEl.style.top = `${clampedTop}px`;
  }

  function createBookmarkRailButton(
    item: EdgeQuickAccessItem,
    section: 'quick-access' | 'space'
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'arctic-qa-btn';
    btn.setAttribute('data-section', section);
    btn.setAttribute('data-bookmark-id', item.id);
    btn.setAttribute('data-active', item.isActive ? 'true' : 'false');
    btn.setAttribute('data-open', item.isOpen ? 'true' : 'false');
    btn.setAttribute('data-drifted', item.isNavigatedAway ? 'true' : 'false');
    btn.setAttribute('aria-label', item.title || item.url);

    if (item.isActive) {
      const bar = document.createElement('span');
      bar.className = 'arctic-active-bar';
      btn.appendChild(bar);
    }

    const appendMonogram = () => {
      const mono = document.createElement('span');
      mono.className = 'arctic-qa-monogram';
      mono.textContent = getMonogram(item.title, item.url);
      btn.appendChild(mono);
    };

    const favSrc = item.faviconDataUrl || localFaviconCache.get(item.url) || '';
    if (item.faviconDataUrl) {
      localFaviconCache.set(item.url, item.faviconDataUrl);
    }

    if (favSrc) {
      const img = document.createElement('img');
      img.className = 'arctic-qa-favicon';
      img.alt = '';
      img.src = favSrc;
      img.addEventListener('error', () => {
        img.remove();
        appendMonogram();
      });
      btn.appendChild(img);
    } else {
      appendMonogram();
    }

    if (item.isNavigatedAway) {
      const drift = document.createElement('span');
      drift.className = 'arctic-drift-dot';
      btn.appendChild(drift);
    }

    if (item.isOpen && !item.isActive) {
      const dot = document.createElement('span');
      dot.className = 'arctic-open-dot';
      btn.appendChild(dot);
    }

    let tipLabel = item.title || item.url;
    if (item.isActive && item.isNavigatedAway) {
      tipLabel = `${tipLabel} · Click to reset`;
    } else if (item.isNavigatedAway && item.currentTitle && item.currentTitle !== item.title) {
      tipLabel = `${tipLabel} → ${item.currentTitle}`;
    }

    btn.addEventListener('mouseenter', () => showTooltipForElement(btn, tipLabel));
    btn.addEventListener('mouseleave', hideTooltip);
    btn.addEventListener('focus', () => showTooltipForElement(btn, tipLabel));
    btn.addEventListener('blur', hideTooltip);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendActivateBookmark(item.id, false);
    });

    btn.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendActivateBookmark(item.id, true);
    });

    return btn;
  }

  function createFolderRailButton(folder: EdgeFolderNode): HTMLButtonElement {
    const isFlyoutOpen = openFolderId === folder.id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'arctic-qa-btn arctic-folder-btn';
    btn.setAttribute('data-section', 'space');
    btn.setAttribute('data-folder-id', folder.id);
    btn.setAttribute('data-active', folder.hasActiveChild ? 'true' : 'false');
    btn.setAttribute('data-open', folder.hasOpenChild ? 'true' : 'false');
    btn.setAttribute('data-drifted', folder.hasNavigatedAwayChild ? 'true' : 'false');
    btn.setAttribute('data-flyout-open', isFlyoutOpen ? 'true' : 'false');
    btn.setAttribute('aria-label', folder.title);
    btn.setAttribute('aria-expanded', isFlyoutOpen ? 'true' : 'false');

    if (folder.hasActiveChild) {
      const bar = document.createElement('span');
      bar.className = 'arctic-active-bar';
      btn.appendChild(bar);
    }

    const iconWrap = document.createElement('span');
    iconWrap.className = 'arctic-folder-icon-wrap';
    iconWrap.style.display = 'flex';
    iconWrap.style.alignItems = 'center';
    iconWrap.style.justifyContent = 'center';
    iconWrap.innerHTML = isFlyoutOpen ? FOLDER_OPEN_SVG : FOLDER_CLOSED_SVG;
    btn.appendChild(iconWrap);

    if (folder.hasNavigatedAwayChild) {
      const drift = document.createElement('span');
      drift.className = 'arctic-drift-dot';
      btn.appendChild(drift);
    }

    if (folder.hasOpenChild && !folder.hasActiveChild) {
      const dot = document.createElement('span');
      dot.className = 'arctic-open-dot';
      btn.appendChild(dot);
    }

    const tipLabel = `${folder.title} (${folder.itemCount})`;
    btn.addEventListener('mouseenter', () => {
      if (openFolderId !== folder.id) {
        showTooltipForElement(btn, tipLabel);
      }
    });
    btn.addEventListener('mouseleave', hideTooltip);
    btn.addEventListener('focus', () => {
      if (openFolderId !== folder.id) {
        showTooltipForElement(btn, tipLabel);
      }
    });
    btn.addEventListener('blur', hideTooltip);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTooltip();
      if (openFolderId === folder.id) {
        closeFolderFlyout();
        return;
      }
      openFolderId = folder.id;
      const rect = btn.getBoundingClientRect();
      openFolderAnchorTop = rect.top;
      syncFolderButtonsOpenAttr();
      updateVisualAttributes();
      renderFolderFlyout();
      hydrateFolderFavicons(folder);
    });

    return btn;
  }

  function sendActivateTodayTab(tabId: number, forceReload: boolean): void {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }
    hideTooltip();
    closeFolderFlyout();
    try {
      chrome.runtime.sendMessage(
        {
          type: 'ACTIVATE_TODAY_TAB_FROM_EDGE',
          tabId,
          forceReload
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch {
      cleanupAll();
    }
  }

  function sendCloseTodayTab(tabId: number): void {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }
    hideTooltip();
    closeFolderFlyout();
    try {
      chrome.runtime.sendMessage(
        {
          type: 'CLOSE_TODAY_TAB_FROM_EDGE',
          tabId
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch {
      cleanupAll();
    }
  }

  function createTodayTabRailButton(item: EdgeTodayTabItem): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'arctic-qa-btn arctic-today-btn';
    btn.setAttribute('data-section', 'today');
    btn.setAttribute('data-tab-id', String(item.tabId));
    btn.setAttribute('data-active', item.isActive ? 'true' : 'false');
    btn.setAttribute('data-open', 'true');
    btn.setAttribute('data-discarded', item.isDiscarded ? 'true' : 'false');
    btn.setAttribute('aria-label', item.title || item.url);

    if (item.isActive) {
      const bar = document.createElement('span');
      bar.className = 'arctic-active-bar';
      btn.appendChild(bar);
    }

    const appendMonogram = () => {
      const mono = document.createElement('span');
      mono.className = 'arctic-qa-monogram';
      mono.textContent = getMonogram(item.title, item.url);
      btn.appendChild(mono);
    };

    const favSrc = item.faviconDataUrl || localFaviconCache.get(item.url) || '';
    if (item.faviconDataUrl && item.url) {
      localFaviconCache.set(item.url, item.faviconDataUrl);
    }

    if (favSrc) {
      const img = document.createElement('img');
      img.className = 'arctic-qa-favicon';
      img.alt = '';
      img.src = favSrc;
      img.addEventListener('error', () => {
        img.remove();
        appendMonogram();
      });
      btn.appendChild(img);
    } else {
      appendMonogram();
    }

    if (item.isAudible && !item.isMuted) {
      const audioDot = document.createElement('span');
      audioDot.className = 'arctic-audio-dot';
      btn.appendChild(audioDot);
    }

    let tipLabel = item.title || item.url;
    if (item.isDiscarded) {
      tipLabel = `${tipLabel} · Sleeping`;
    }

    btn.addEventListener('mouseenter', () => showTooltipForElement(btn, tipLabel));
    btn.addEventListener('mouseleave', hideTooltip);
    btn.addEventListener('focus', () => showTooltipForElement(btn, tipLabel));
    btn.addEventListener('blur', hideTooltip);

    btn.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    });

    btn.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        sendCloseTodayTab(item.tabId);
      }
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendActivateTodayTab(item.tabId, false);
    });

    btn.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendActivateTodayTab(item.tabId, true);
    });

    return btn;
  }

  function updateScrollbarMetrics(): void {
    if (!listEl || !scrollTrackEl || !scrollThumbEl) return;
    const scrollHeight = listEl.scrollHeight || 0;
    const clientHeight = listEl.clientHeight || 0;
    const scrollTop = listEl.scrollTop || 0;
    const maxScrollTop = scrollHeight - clientHeight;
    const isScrollable = clientHeight > 0 && maxScrollTop > 1;

    scrollTrackEl.setAttribute('data-scrollable', isScrollable ? 'true' : 'false');

    const canScrollUp = isScrollable && scrollTop > 2;
    const canScrollDown = isScrollable && scrollTop < maxScrollTop - 2;
    listEl.setAttribute('data-can-scroll-up', canScrollUp ? 'true' : 'false');
    listEl.setAttribute('data-can-scroll-down', canScrollDown ? 'true' : 'false');

    if (!isScrollable) {
      scrollThumbEl.style.height = '0px';
      scrollThumbEl.style.transform = 'translateY(0px)';
      return;
    }

    const trackHeight = Math.max(MIN_THUMB_HEIGHT_PX, clientHeight - 6);
    const rawThumbH = (clientHeight / scrollHeight) * trackHeight;
    const thumbHeight = Math.max(
      MIN_THUMB_HEIGHT_PX,
      Math.min(trackHeight, Math.round(rawThumbH))
    );
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    const ratio = Math.max(0, Math.min(1, scrollTop / Math.max(1, maxScrollTop)));
    const thumbTop = Math.round(ratio * maxThumbTop * 10) / 10;

    scrollThumbEl.style.height = `${thumbHeight}px`;
    scrollThumbEl.style.transform = `translateY(${thumbTop}px)`;
  }

  function handleScrollbarPointerMove(e: PointerEvent | MouseEvent): void {
    if (!isDraggingScrollbar || !listEl) return;
    const scrollHeight = listEl.scrollHeight || 0;
    const clientHeight = listEl.clientHeight || 0;
    const maxScrollTop = Math.max(1, scrollHeight - clientHeight);
    const trackHeight = Math.max(MIN_THUMB_HEIGHT_PX, clientHeight - 6);
    const thumbHeight = Math.max(
      MIN_THUMB_HEIGHT_PX,
      Math.min(trackHeight, Math.round((clientHeight / scrollHeight) * trackHeight))
    );
    const maxThumbTop = Math.max(1, trackHeight - thumbHeight);
    const deltaY = e.clientY - scrollbarDragStartY;
    const nextScrollTop = Math.max(
      0,
      Math.min(maxScrollTop, scrollbarDragStartScrollTop + (deltaY / maxThumbTop) * maxScrollTop)
    );
    listEl.scrollTop = nextScrollTop;
    updateScrollbarMetrics();
  }

  function stopScrollbarDrag(): void {
    if (!isDraggingScrollbar) return;
    isDraggingScrollbar = false;
    scrollTrackEl?.setAttribute('data-dragging', 'false');
    window.removeEventListener('pointermove', handleScrollbarPointerMove);
    window.removeEventListener('pointerup', stopScrollbarDrag);
    window.removeEventListener('pointercancel', stopScrollbarDrag);
    if (triggerMode === 'hover' && !isPointerInsideRail && !openFolderId) {
      scheduleHoverCollapse();
    } else {
      updateVisualAttributes();
    }
  }

  function resolveCurrentActiveItemKey(): string | null {
    for (const qa of quickAccessItems) {
      if (qa.isActive) return `qa:${qa.id}`;
    }
    for (const node of spaceItems) {
      if (node.type === 'bookmark' && node.isActive) return `space:${node.id}`;
      if (node.type === 'folder' && node.hasActiveChild) return `folder:${node.id}`;
    }
    for (const tab of todayTabItems) {
      if (tab.isActive) return `today:${tab.tabId}`;
    }
    return null;
  }

  function renderRailItems(): void {
    if (!listEl || !dividerEl) return;
    hideTooltip();
    listEl.textContent = '';

    const hasQa = Array.isArray(quickAccessItems) && quickAccessItems.length > 0;
    const hasSpace = Array.isArray(spaceItems) && spaceItems.length > 0;
    const hasToday = Array.isArray(todayTabItems) && todayTabItems.length > 0;

    if (!hasQa && !hasSpace && !hasToday) {
      dividerEl.setAttribute('data-hidden', 'true');
      scrollWrapEl?.setAttribute('data-hidden', 'true');
      lastActiveItemKey = null;
      closeFolderFlyout();
      updateScrollbarMetrics();
      return;
    }

    dividerEl.setAttribute('data-hidden', 'false');
    scrollWrapEl?.setAttribute('data-hidden', 'false');

    const appendSeparator = () => {
      const sep = document.createElement('div');
      sep.className = 'arctic-section-sep';
      sep.setAttribute('role', 'separator');
      sep.setAttribute('aria-orientation', 'horizontal');
      listEl!.appendChild(sep);
    };

    if (hasQa) {
      for (const item of quickAccessItems) {
        listEl.appendChild(createBookmarkRailButton(item, 'quick-access'));
      }
    }

    if (hasQa && hasSpace) {
      appendSeparator();
    }

    if (hasSpace) {
      for (const node of spaceItems) {
        if (node.type === 'bookmark') {
          listEl.appendChild(createBookmarkRailButton(node, 'space'));
        } else {
          listEl.appendChild(createFolderRailButton(node));
        }
      }
    }

    if ((hasQa || hasSpace) && hasToday) {
      appendSeparator();
    }

    if (hasToday) {
      for (const tab of todayTabItems) {
        listEl.appendChild(createTodayTabRailButton(tab));
      }
    }

    if (openFolderId) {
      renderFolderFlyout();
    }

    const nextActiveKey = resolveCurrentActiveItemKey();
    if (nextActiveKey && nextActiveKey !== lastActiveItemKey) {
      lastActiveItemKey = nextActiveKey;
      const activeBtn = listEl.querySelector<HTMLElement>('button.arctic-qa-btn[data-active="true"]');
      if (activeBtn && typeof activeBtn.scrollIntoView === 'function') {
        try {
          activeBtn.scrollIntoView({ block: 'nearest' });
        } catch {
          // ignore
        }
      }
    } else if (!nextActiveKey) {
      lastActiveItemKey = null;
    }

    updateScrollbarMetrics();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => updateScrollbarMetrics());
    }
  }

  function unmountHost(): void {
    stopScrollbarDrag();
    if (scrollFadeTimer) {
      clearTimeout(scrollFadeTimer);
      scrollFadeTimer = null;
    }
    if (listResizeObserver) {
      listResizeObserver.disconnect();
      listResizeObserver = null;
    }
    openFolderId = null;
    lastActiveItemKey = null;
    isHoverExpanded = false;
    isPointerInsideRail = false;
    syncHoverTrackingListeners();
    if (hoverCollapseTimer) {
      clearTimeout(hoverCollapseTimer);
      hoverCollapseTimer = null;
    }
    removePagePush();
    if (hostEl) {
      hostEl.remove();
      hostEl = null;
      shadowRootRef = null;
      hoverSensorEl = null;
      railEl = null;
      expandBtnEl = null;
      dividerEl = null;
      scrollWrapEl = null;
      listEl = null;
      scrollTrackEl = null;
      scrollThumbEl = null;
      flyoutEl = null;
      tooltipEl = null;
    }
  }

  function mountHost(): void {
    if (hostEl || !document.documentElement) return;
    // Defensively ensure no orphaned duplicate host exists in the page DOM
    document.querySelectorAll(`#${HOST_ID}`).forEach((el) => el.remove());

    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    hostEl.style.cssText =
      'all: initial !important; position: fixed !important; z-index: 2147483646 !important; pointer-events: none !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important;';

    shadowRootRef = hostEl.attachShadow({ mode: 'closed' });

    const styleEl = document.createElement('style');
    styleEl.textContent = getStyles();

    const sensor = document.createElement('div');
    sensor.className = 'arctic-hover-sensor';
    sensor.setAttribute('data-visible', 'false');
    const sensorPill = document.createElement('span');
    sensorPill.className = 'arctic-hover-pill';
    sensor.appendChild(sensorPill);

    sensor.addEventListener('mouseenter', () => {
      if (!isExtensionContextValid()) {
        cleanupAll();
        return;
      }
      if (!shouldShowTrigger()) {
        unmountHost();
        return;
      }
      if (hoverCollapseTimer) {
        clearTimeout(hoverCollapseTimer);
        hoverCollapseTimer = null;
      }
      isHoverExpanded = true;
      isPointerInsideRail = true;
      updateVisualAttributes();
    });

    const rail = document.createElement('aside');
    rail.className = 'arctic-rail';
    rail.setAttribute('aria-label', 'Arctic Quick Access Bar');

    rail.addEventListener('mouseenter', () => {
      if (!isExtensionContextValid()) {
        cleanupAll();
        return;
      }
      isPointerInsideRail = true;
      if (hoverCollapseTimer) {
        clearTimeout(hoverCollapseTimer);
        hoverCollapseTimer = null;
      }
      if (triggerMode === 'hover' && !isHoverExpanded) {
        isHoverExpanded = true;
        updateVisualAttributes();
      }
    });

    rail.addEventListener('mouseleave', () => {
      if (!isExtensionContextValid()) {
        cleanupAll();
        return;
      }
      isPointerInsideRail = false;
      if (triggerMode === 'hover') {
        scheduleHoverCollapse();
      }
    });

    rail.addEventListener('click', () => {
      if (!isExtensionContextValid()) {
        cleanupAll();
        return;
      }
      if (openFolderId) {
        closeFolderFlyout();
      }
    });

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'arctic-edge-root arctic-expand-btn';
    expandBtn.setAttribute('aria-label', 'Show Arctic Sidebar');
    expandBtn.innerHTML = `
      <svg class="arctic-expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect width="18" height="18" x="3" y="3" rx="3"></rect>
        <path d="M9 3v18"></path>
        <path d="m14 9 3 3-3 3"></path>
      </svg>
    `;

    expandBtn.addEventListener('mouseenter', () =>
      showTooltipForElement(expandBtn, 'Show Arctic Sidebar')
    );
    expandBtn.addEventListener('mouseleave', hideTooltip);
    expandBtn.addEventListener('focus', () =>
      showTooltipForElement(expandBtn, 'Show Arctic Sidebar')
    );
    expandBtn.addEventListener('blur', hideTooltip);

    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isExtensionContextValid()) {
        cleanupAll();
        return;
      }

      hideTooltip();
      closeFolderFlyout();

      // Optimistically hide immediately while Chrome opens the native side panel
      isOptimisticallyOpening = true;
      syncMountState();

      if (optimisticTimer) clearTimeout(optimisticTimer);
      optimisticTimer = setTimeout(() => {
        if (isOptimisticallyOpening) {
          isOptimisticallyOpening = false;
          syncMountState();
        }
      }, 800);

      try {
        // CRITICAL: Call sendMessage synchronously within the click handler
        // so Chromium forwards transient user activation to chrome.sidePanel.open()
        chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL_FROM_EDGE' }, (response) => {
          void chrome.runtime.lastError;
          if (!response || response.ok !== true) {
            isOptimisticallyOpening = false;
            if (optimisticTimer) clearTimeout(optimisticTimer);
            syncMountState();
          }
        });
      } catch {
        isOptimisticallyOpening = false;
        if (optimisticTimer) clearTimeout(optimisticTimer);
        cleanupAll();
      }
    });

    const divider = document.createElement('div');
    divider.className = 'arctic-divider';

    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'arctic-scroll-wrap';

    const list = document.createElement('div');
    list.className = 'arctic-qa-list';
    list.setAttribute('role', 'toolbar');
    list.setAttribute('aria-label', 'Quick Access and Space Tabs');
    list.setAttribute('data-can-scroll-up', 'false');
    list.setAttribute('data-can-scroll-down', 'false');
    list.addEventListener(
      'scroll',
      () => {
        hideTooltip();
        updateScrollbarMetrics();
        if (scrollTrackEl) {
          scrollTrackEl.setAttribute('data-scrolling', 'true');
          if (scrollFadeTimer) clearTimeout(scrollFadeTimer);
          scrollFadeTimer = setTimeout(() => {
            scrollFadeTimer = null;
            scrollTrackEl?.setAttribute('data-scrolling', 'false');
          }, 650);
        }
      },
      { passive: true }
    );

    const scrollTrack = document.createElement('div');
    scrollTrack.className = 'arctic-scroll-track';
    scrollTrack.setAttribute('data-scrollable', 'false');
    scrollTrack.setAttribute('data-scrolling', 'false');
    scrollTrack.setAttribute('data-dragging', 'false');
    scrollTrack.setAttribute('aria-hidden', 'true');

    const scrollThumb = document.createElement('div');
    scrollThumb.className = 'arctic-scroll-thumb';
    scrollTrack.appendChild(scrollThumb);

    scrollTrack.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    scrollTrack.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0 || !listEl) return;
      e.preventDefault();
      e.stopPropagation();
      hideTooltip();

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

      if (e.target !== scrollThumb) {
        const trackRect = scrollTrack.getBoundingClientRect();
        const trackTop = trackRect.height > 0 ? trackRect.top : 0;
        const clickOffsetY = e.clientY - trackTop - thumbHeight / 2;
        const targetRatio = Math.max(0, Math.min(1, clickOffsetY / maxThumbTop));
        listEl.scrollTop = targetRatio * maxScrollTop;
        updateScrollbarMetrics();
      }

      isDraggingScrollbar = true;
      scrollbarDragStartY = e.clientY;
      scrollbarDragStartScrollTop = listEl.scrollTop;
      scrollTrack.setAttribute('data-dragging', 'true');
      updateVisualAttributes();

      try {
        scrollTrack.setPointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }

      window.addEventListener('pointermove', handleScrollbarPointerMove);
      window.addEventListener('pointerup', stopScrollbarDrag);
      window.addEventListener('pointercancel', stopScrollbarDrag);
    });

    scrollWrap.appendChild(list);
    scrollWrap.appendChild(scrollTrack);

    const flyout = document.createElement('div');
    flyout.className = 'arctic-folder-flyout';
    flyout.setAttribute('role', 'menu');
    flyout.setAttribute('data-visible', 'false');
    flyout.addEventListener('click', (e) => e.stopPropagation());

    const tip = document.createElement('div');
    tip.className = 'arctic-floating-tooltip';
    tip.setAttribute('data-visible', 'false');

    rail.appendChild(expandBtn);
    rail.appendChild(divider);
    rail.appendChild(scrollWrap);

    hoverSensorEl = sensor;
    railEl = rail;
    expandBtnEl = expandBtn;
    dividerEl = divider;
    scrollWrapEl = scrollWrap;
    listEl = list;
    scrollTrackEl = scrollTrack;
    scrollThumbEl = scrollThumb;
    flyoutEl = flyout;
    tooltipEl = tip;

    if (typeof ResizeObserver !== 'undefined') {
      try {
        listResizeObserver = new ResizeObserver(() => {
          updateScrollbarMetrics();
        });
        listResizeObserver.observe(list);
      } catch {
        // ignore
      }
    }

    shadowRootRef.appendChild(styleEl);
    shadowRootRef.appendChild(sensor);
    shadowRootRef.appendChild(rail);
    shadowRootRef.appendChild(flyout);
    shadowRootRef.appendChild(tip);

    document.documentElement.appendChild(hostEl);
    updateVisualAttributes();
    renderRailItems();
  }

  function mountAndPushNow(): void {
    const wasMounted = Boolean(hostEl);
    mountHost();
    syncPagePush();
    updateVisualAttributes();
    if (wasMounted) {
      renderRailItems();
    }
  }

  function syncMountState(justCollapsedHint = false): void {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }

    const currentlyOpenInMyWin = isSidePanelOpenInMyWindow();
    const justTransitionedFromOpen =
      (wasSidePanelOpenInMyWindow && !currentlyOpenInMyWin) ||
      (justCollapsedHint && !currentlyOpenInMyWin);

    if (currentlyOpenInMyWin) {
      recordOpenPanelViewportWidth(!wasSidePanelOpenInMyWindow);
    }
    wasSidePanelOpenInMyWindow = currentlyOpenInMyWin;

    if (shouldShowTrigger()) {
      clearOpenHandoff(true);

      if (
        !hostEl &&
        triggerMode === 'push' &&
        justTransitionedFromOpen &&
        hasRealViewportLayout()
      ) {
        const vw = window.innerWidth;
        const alreadyExpanded =
          lastOpenPanelViewportWidth !== null && vw > lastOpenPanelViewportWidth + 8;

        if (!alreadyExpanded) {
          if (!pendingCloseHandoff) {
            pendingCloseHandoff = true;
            closeHandoffBaselineWidth = vw;
            if (closeHandoffTimer) clearTimeout(closeHandoffTimer);
            closeHandoffTimer = setTimeout(() => {
              clearCloseHandoff();
              lastOpenPanelViewportWidth = null;
              if (shouldShowTrigger()) {
                mountAndPushNow();
              }
            }, 80);
          }
          return;
        }
      }

      if (pendingCloseHandoff) {
        if (
          triggerMode === 'push' &&
          !hostEl &&
          hasRealViewportLayout() &&
          window.innerWidth <= closeHandoffBaselineWidth + 2
        ) {
          return;
        }
        clearCloseHandoff();
      }

      lastOpenPanelViewportWidth = null;
      mountAndPushNow();
    } else {
      clearCloseHandoff();

      if (canHoldPushForOpening()) {
        if (!pendingOpenHandoff) {
          pendingOpenHandoff = true;
          openHandoffBaselineWidth = window.innerWidth;
          hideTooltip();
          closeFolderFlyout();
          railEl?.setAttribute('data-opening', 'true');
          if (openHandoffTimer) clearTimeout(openHandoffTimer);
          openHandoffTimer = setTimeout(() => {
            clearOpenHandoff(false);
            if (!shouldShowTrigger()) {
              unmountHost();
            }
          }, 280);
        }
        return;
      }

      clearOpenHandoff(false);
      unmountHost();
    }
  }

  function refreshStateFromBackgroundIfVisible(): void {
    if (!isExtensionContextValid()) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (!shouldShowTrigger() || hasHydratedItems) return;

    try {
      chrome.runtime.sendMessage({ type: 'GET_EDGE_TRIGGER_STATE' }, (resp) => {
        void chrome.runtime.lastError;
        if (!isExtensionContextValid() || !resp || typeof resp !== 'object') return;
        if (Array.isArray(resp.quickAccessItems)) {
          quickAccessItems = resp.quickAccessItems;
          hasHydratedItems = true;
        }
        if (Array.isArray(resp.spaceItems)) {
          spaceItems = resp.spaceItems;
          hasHydratedItems = true;
        }
        if (Array.isArray(resp.todayTabItems)) {
          todayTabItems = resp.todayTabItems;
          hasHydratedItems = true;
        }
        if (resp.mode === 'push' || resp.mode === 'hover') {
          triggerMode = resp.mode;
        }
        if (hostEl) {
          syncPagePush();
          updateVisualAttributes();
          renderRailItems();
        }
      });
    } catch {
      // ignore
    }
  }

  const handleStorageChanged = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string
  ) => {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }

    if (areaName === 'session' && changes.openSidePanelWindowIds) {
      const next = changes.openSidePanelWindowIds.newValue;
      openWindowIds = Array.isArray(next) ? (next as number[]) : [];
      if (isSidePanelOpenInMyWindow()) {
        isOptimisticallyOpening = false;
        if (optimisticTimer) clearTimeout(optimisticTimer);
      }
      syncMountState();
      if (shouldShowTrigger() && !hasHydratedItems) {
        refreshStateFromBackgroundIfVisible();
      }
      return;
    }

    if (areaName === 'local') {
      let changed = false;
      if (changes.edgeTriggerEnabled !== undefined) {
        isEnabled = Boolean(changes.edgeTriggerEnabled.newValue);
        changed = true;
      }
      if (
        changes.edgeTriggerMode?.newValue === 'push' ||
        changes.edgeTriggerMode?.newValue === 'hover'
      ) {
        triggerMode = changes.edgeTriggerMode.newValue;
        isHoverExpanded = false;
        changed = true;
      }
      if (
        changes.sidebarDockSide?.newValue === 'left' ||
        changes.sidebarDockSide?.newValue === 'right'
      ) {
        dockSide = changes.sidebarDockSide.newValue;
        changed = true;
      }
      if (
        changes.theme?.newValue === 'light' ||
        changes.theme?.newValue === 'dark' ||
        changes.theme?.newValue === 'system'
      ) {
        themeMode = changes.theme.newValue;
        changed = true;
      }
      if (typeof changes.colorTheme?.newValue === 'string') {
        colorTheme = changes.colorTheme.newValue;
        changed = true;
      }
      if (changed) {
        syncMountState();
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
      if (typeof message.windowId === 'number' && myWindowId === null) {
        myWindowId = message.windowId;
      }
      if (
        typeof message.windowId === 'number' &&
        myWindowId !== null &&
        message.windowId !== myWindowId
      ) {
        return;
      }
      if (Array.isArray(message.openWindowIds)) {
        openWindowIds = message.openWindowIds;
      } else if (
        typeof message.windowId === 'number' &&
        typeof message.isSidePanelOpen === 'boolean'
      ) {
        const next = new Set(openWindowIds);
        if (message.isSidePanelOpen) next.add(message.windowId);
        else next.delete(message.windowId);
        openWindowIds = Array.from(next);
      }
      if (!message.isSidePanelOpen) {
        if (Array.isArray(message.quickAccessItems)) {
          quickAccessItems = message.quickAccessItems;
          hasHydratedItems = true;
        }
        if (Array.isArray(message.spaceItems)) {
          spaceItems = message.spaceItems;
          hasHydratedItems = true;
        }
        if (Array.isArray(message.todayTabItems)) {
          todayTabItems = message.todayTabItems;
          hasHydratedItems = true;
        }
      }
      if (message.isSidePanelOpen === true) {
        isOptimisticallyOpening = false;
        if (optimisticTimer) clearTimeout(optimisticTimer);
      }
      syncMountState(Boolean(message.justCollapsed));
    } else if (message.type === 'ARCTIC_EDGE_ITEMS_UPDATED') {
      if (
        typeof message.windowId === 'number' &&
        myWindowId !== null &&
        message.windowId !== myWindowId
      ) {
        return;
      }
      let updated = false;
      if (Array.isArray(message.quickAccessItems)) {
        quickAccessItems = message.quickAccessItems;
        hasHydratedItems = true;
        updated = true;
      }
      if (Array.isArray(message.spaceItems)) {
        spaceItems = message.spaceItems;
        hasHydratedItems = true;
        updated = true;
      }
      if (Array.isArray(message.todayTabItems)) {
        todayTabItems = message.todayTabItems;
        hasHydratedItems = true;
        updated = true;
      }
      if (updated && hostEl) {
        renderRailItems();
      }
    } else if (message.type === 'EDGE_WINDOW_CHANGED' && typeof eWindowIdValid(message.windowId)) {
      myWindowId = message.windowId as number;
      if (Array.isArray(message.openWindowIds)) {
        openWindowIds = message.openWindowIds;
      }
      syncMountState();
    } else if (message.type === 'ARCTIC_REMOVE_EDGE_TRIGGER') {
      isEnabled = false;
      clearOpenHandoff(false);
      clearCloseHandoff();
      unmountHost();
    }
  };

  function eWindowIdValid(val: unknown): val is number {
    return typeof val === 'number';
  }

  const handleWindowPointerDown = (e: PointerEvent | MouseEvent) => {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }
    if (!openFolderId || !hostEl) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (e.target !== hostEl && !path.includes(hostEl)) {
      closeFolderFlyout();
    }
  };

  const handleWindowKeyDown = (e: KeyboardEvent) => {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }
    if (e.key === 'Escape' && openFolderId) {
      closeFolderFlyout();
    }
  };

  const handleWindowResize = () => {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }

    if (pendingOpenHandoff) {
      if (!canHoldPushForOpening() || window.innerWidth < openHandoffBaselineWidth - 2) {
        clearOpenHandoff(false);
        if (isSidePanelOpenInMyWindow()) {
          recordOpenPanelViewportWidth(true);
        }
        if (!shouldShowTrigger()) {
          unmountHost();
        }
        return;
      }
    }

    if (pendingCloseHandoff) {
      if (!shouldShowTrigger()) {
        clearCloseHandoff();
        return;
      }
      if (triggerMode !== 'push' || window.innerWidth > closeHandoffBaselineWidth + 2) {
        clearCloseHandoff();
        lastOpenPanelViewportWidth = null;
        mountAndPushNow();
        return;
      }
    }

    if (isSidePanelOpenInMyWindow()) {
      recordOpenPanelViewportWidth(false);
    }

    if (activePushedSide && shouldShowTrigger() && triggerMode === 'push') {
      schedulePagePushFixedPass();
    }
    updateScrollbarMetrics();
  };

  const handleFullscreenChange = () => {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }
    syncMountState();
  };

  const handleVisibilityChange = () => {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      refreshStateFromBackgroundIfVisible();
    }
  };

  const handleSupersede = () => {
    cleanupAll();
  };

  const mediaQuery =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  const handleSystemThemeChange = () => {
    if (themeMode === 'system') {
      updateVisualAttributes();
    }
  };

  function cleanupAll(): void {
    if (optimisticTimer) {
      clearTimeout(optimisticTimer);
      optimisticTimer = null;
    }
    if (openWidthSettleTimer) {
      clearTimeout(openWidthSettleTimer);
      openWidthSettleTimer = null;
    }
    clearOpenHandoff(false);
    clearCloseHandoff();
    unmountHost();
    window.removeEventListener('pointerdown', handleWindowPointerDown, true);
    window.removeEventListener('keydown', handleWindowKeyDown, true);
    window.removeEventListener('resize', handleWindowResize);
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    document.removeEventListener(SUPERSEDE_EVENT, handleSupersede);
    if (mediaQuery && typeof mediaQuery.removeEventListener === 'function') {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
    }
    try {
      chrome.storage?.onChanged?.removeListener(handleStorageChanged);
      chrome.runtime?.onMessage?.removeListener(handleRuntimeMessage);
    } catch {
      // ignore invalidated context
    }
  }

  win.__arcticEdgeTriggerCleanup = cleanupAll;

  window.addEventListener('pointerdown', handleWindowPointerDown, true);
  window.addEventListener('keydown', handleWindowKeyDown, true);
  window.addEventListener('resize', handleWindowResize, { passive: true });
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener(SUPERSEDE_EVENT, handleSupersede);
  if (mediaQuery && typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleSystemThemeChange);
  }

  if (isExtensionContextValid()) {
    try {
      chrome.storage.onChanged.addListener(handleStorageChanged);
      chrome.runtime.onMessage.addListener(handleRuntimeMessage);

      chrome.storage.local.get(
        ['edgeTriggerEnabled', 'edgeTriggerMode', 'sidebarDockSide', 'theme', 'colorTheme'],
        (localRes) => {
          void chrome.runtime.lastError;
          if (!isExtensionContextValid()) return;

          if (typeof localRes?.edgeTriggerEnabled === 'boolean') {
            isEnabled = localRes.edgeTriggerEnabled;
          }
          if (localRes?.edgeTriggerMode === 'push' || localRes?.edgeTriggerMode === 'hover') {
            triggerMode = localRes.edgeTriggerMode;
          }
          if (localRes?.sidebarDockSide === 'left' || localRes?.sidebarDockSide === 'right') {
            dockSide = localRes.sidebarDockSide;
          }
          if (
            localRes?.theme === 'light' ||
            localRes?.theme === 'dark' ||
            localRes?.theme === 'system'
          ) {
            themeMode = localRes.theme;
          }
          if (typeof localRes?.colorTheme === 'string') {
            colorTheme = localRes.colorTheme;
          }

          chrome.runtime.sendMessage({ type: 'GET_EDGE_TRIGGER_STATE' }, (resp) => {
            void chrome.runtime.lastError;
            if (!isExtensionContextValid()) return;

            if (resp && typeof resp === 'object') {
              if (typeof resp.windowId === 'number') {
                myWindowId = resp.windowId;
              }
              if (Array.isArray(resp.openWindowIds)) {
                openWindowIds = resp.openWindowIds;
              }
              if (typeof resp.edgeTriggerEnabled === 'boolean') {
                isEnabled = resp.edgeTriggerEnabled;
              }
              if (resp.mode === 'push' || resp.mode === 'hover') {
                triggerMode = resp.mode;
              }
              if (resp.side === 'left' || resp.side === 'right') {
                dockSide = resp.side;
              }
              if (Array.isArray(resp.quickAccessItems)) {
                quickAccessItems = resp.quickAccessItems;
                if (!openWindowIds.includes(resp.windowId)) {
                  hasHydratedItems = true;
                }
              }
              if (Array.isArray(resp.spaceItems)) {
                spaceItems = resp.spaceItems;
                if (!openWindowIds.includes(resp.windowId)) {
                  hasHydratedItems = true;
                }
              }
              if (Array.isArray(resp.todayTabItems)) {
                todayTabItems = resp.todayTabItems;
                if (!openWindowIds.includes(resp.windowId)) {
                  hasHydratedItems = true;
                }
              }
            }
            isStateInitialized = true;
            syncMountState();
          });
        }
      );
    } catch {
      cleanupAll();
    }
  }
})();

export type {};
