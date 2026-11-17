// @chrome-workaround(tab-page-focus-and-media-keys): Clicking a tab in chrome.sidePanel keeps OS focus inside sidepanel.html instead of focusing the active web page.
export const PAGE_SCRIPTING_ORIGINS = ['http://*/*', 'https://*/*'];

export interface ForwardedKeyPayload {
  key: string;
  code: string;
  shiftKey: boolean;
}

let lastKeyboardActivationAt = 0;

/**
 * Marks that a sidebar row or tile was just activated via keyboard (Enter/Space)
 * so pointer-only row blurring preserves keyboard Tab navigation focus.
 */
export function markKeyboardRowActivation(): void {
  lastKeyboardActivationAt = Date.now();
}

export function isEditableSidebarElement(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  const ce = el.getAttribute('contenteditable');
  return ce === '' || ce === 'true';
}

/**
 * Blurs the currently focused sidebar row/button after a pointer click so
 * document.activeElement returns to document.body (preventing Space/Enter from
 * re-clicking the row and allowing media/scroll keys to bridge to the active tab).
 * Preserves focus when activated via keyboard or when an input/editor is focused.
 */
export function blurSidebarActiveElementIfPointer(): void {
  if (typeof document === 'undefined') return;
  if (Date.now() - lastKeyboardActivationAt < 120) {
    return;
  }
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    active !== document.documentElement &&
    !isEditableSidebarElement(active)
  ) {
    active.blur();
  }
}

export function isInjectableWebUrl(url?: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (
    url.startsWith('https://chromewebstore.google.com/') ||
    url.startsWith('https://chrome.google.com/webstore')
  ) {
    return false;
  }
  return true;
}

export async function hasPageScriptingPermission(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) return false;
  try {
    return Boolean(await chrome.permissions.contains({ origins: PAGE_SCRIPTING_ORIGINS }));
  } catch {
    return false;
  }
}

export async function isTabPageFocusSettingEnabled(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) return true;
  try {
    const res = await chrome.storage.local.get(['tabPageFocusEnabled']);
    return res.tabPageFocusEnabled !== false;
  } catch {
    return true;
  }
}

export function isBridgedTabKey(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>
): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.key === ' ') return true;
  if (e.shiftKey) return false;

  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown':
    case 'PageUp':
    case 'PageDown':
    case 'Home':
    case 'End':
      return true;
    default: {
      const lower = e.key.toLowerCase();
      return lower === 'j' || lower === 'k' || lower === 'l' || lower === 'm';
    }
  }
}

/**
 * Self-contained function executed inside the target tab via chrome.scripting.executeScript.
 * IMPORTANT: Must not reference any outer module closures.
 */
export function focusPageOrPlayerInDocument(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;

  let active = document.activeElement as HTMLElement | null;
  if (active && active.id === 'arctic-edge-trigger-host' && typeof active.blur === 'function') {
    active.blur();
    active = document.activeElement as HTMLElement | null;
  }

  // Never steal cursor/focus if the page already has a focused input, editor, iframe, or control
  const isIdleBody =
    !active || active === document.body || active === document.documentElement;
  if (!isIdleBody) {
    return false;
  }

  try {
    window.focus();
  } catch {
    // ignore
  }

  const host = (window.location?.hostname || '').toLowerCase();
  const path = window.location?.pathname || '';
  const isYouTube =
    host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
  const isYouTubeShorts = isYouTube && path.startsWith('/shorts/');
  const isYouTubeWatch =
    isYouTube &&
    (path === '/watch' || path.startsWith('/embed/') || path.startsWith('/live/'));

  const isVisibleElement = (el: HTMLElement): boolean => {
    if (el.closest('[hidden]')) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return true;
  };

  const focusSafely = (el: HTMLElement): boolean => {
    if (!el.hasAttribute('tabindex') && el.tabIndex < 0) {
      el.tabIndex = -1;
    }
    try {
      el.focus({ preventScroll: true });
      return true;
    } catch {
      return false;
    }
  };

  if (isYouTubeShorts || isYouTubeWatch) {
    const preferred = isYouTubeShorts
      ? document.getElementById('shorts-player') ||
        document.querySelector<HTMLElement>('#shorts-container .html5-video-player') ||
        document.getElementById('movie_player')
      : document.getElementById('movie_player') ||
        document.querySelector<HTMLElement>('.html5-video-player');

    if (preferred && isVisibleElement(preferred)) {
      return focusSafely(preferred);
    }
  }

  const videos = Array.from(document.querySelectorAll('video'));
  const qualifyingVideos = videos
    .map((v) => {
      if (!isVisibleElement(v)) return null;
      const rect = v.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 120) return null;
      // Ignore muted looping decorative hero/background videos without controls
      if (v.muted && v.loop && !v.controls) return null;
      const hasPlayerWrapper = Boolean(
        v.closest('.html5-video-player, .video-js, .plyr, [data-player]')
      );
      const isRealPlayer =
        Boolean(v.controls) || (!v.paused && !v.ended && !v.muted) || hasPlayerWrapper;
      if (!isRealPlayer) return null;
      return { video: v, area: rect.width * rect.height, playing: !v.paused };
    })
    .filter(
      (item): item is { video: HTMLVideoElement; area: number; playing: boolean } =>
        item !== null
    )
    .sort((a, b) => {
      if (a.playing !== b.playing) return a.playing ? -1 : 1;
      return b.area - a.area;
    });

  if (qualifyingVideos.length > 0) {
    const targetVideo = qualifyingVideos[0].video;
    const wrapper = targetVideo.closest<HTMLElement>('.html5-video-player, .video-js, .plyr');
    return focusSafely(wrapper || targetVideo);
  }

  return false;
}

/**
 * Self-contained function executed inside the target tab to handle a bridged keystroke
 * from the Side Panel when sidepanel.html holds pane focus on document.body.
 * IMPORTANT: Must not reference any outer module closures.
 */
export function handleForwardedKeyInDocument(payload: ForwardedKeyPayload): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined' || !payload) {
    return false;
  }

  let active = document.activeElement as HTMLElement | null;
  if (active && active.id === 'arctic-edge-trigger-host' && typeof active.blur === 'function') {
    active.blur();
    active = document.activeElement as HTMLElement | null;
  }

  if (active) {
    const tag = active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    if (active.isContentEditable) return false;
    const ce = active.getAttribute?.('contenteditable');
    if (ce === '' || ce === 'true') return false;
    const role = (active.getAttribute?.('role') || '').toLowerCase();
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return false;
  }

  const host = (window.location?.hostname || '').toLowerCase();
  const path = window.location?.pathname || '';
  const isYouTube =
    host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
  const isYouTubeShorts = isYouTube && path.startsWith('/shorts/');
  const isYouTubeWatch =
    isYouTube &&
    (path === '/watch' || path.startsWith('/embed/') || path.startsWith('/live/'));
  const isYouTubePlayerRoute = isYouTubeShorts || isYouTubeWatch;

  const isVisibleElement = (el: HTMLElement): boolean => {
    if (el.closest('[hidden]')) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return true;
  };

  const allVideos = Array.from(document.querySelectorAll('video'));
  const videoCandidates = allVideos
    .map((v) => {
      if (!isVisibleElement(v)) return null;
      const rect = v.getBoundingClientRect();
      const hasFallbackZeroLayout =
        isYouTubePlayerRoute && allVideos.length === 1 && rect.width === 0 && rect.height === 0;
      if (!hasFallbackZeroLayout && (rect.width < 200 || rect.height < 120)) {
        return null;
      }
      if (!isYouTubePlayerRoute) {
        if (v.muted && v.loop && !v.controls) return null;
        const hasPlayerWrapper = Boolean(
          v.closest('.html5-video-player, .video-js, .plyr, [data-player]')
        );
        const isRealPlayer =
          Boolean(v.controls) ||
          (!v.paused && !v.ended && !v.muted) ||
          active === v ||
          hasPlayerWrapper;
        if (!isRealPlayer) return null;
      }
      return { video: v, area: rect.width * rect.height, playing: !v.paused };
    })
    .filter(
      (item): item is { video: HTMLVideoElement; area: number; playing: boolean } =>
        item !== null
    )
    .sort((a, b) => {
      if (a.playing !== b.playing) return a.playing ? -1 : 1;
      return b.area - a.area;
    });

  const targetVideo = videoCandidates[0]?.video || null;
  const playerEl = isYouTubeShorts
    ? document.getElementById('shorts-player') ||
      targetVideo?.closest<HTMLElement>('.html5-video-player') ||
      null
    : isYouTubeWatch
    ? document.getElementById('movie_player') ||
      targetVideo?.closest<HTMLElement>('.html5-video-player') ||
      null
    : targetVideo?.closest<HTMLElement>('.html5-video-player, .video-js, .plyr') || null;

  const key = payload.key;
  const lowerKey = key.toLowerCase();
  const shiftKey = Boolean(payload.shiftKey);

  const isMediaOnlyKey =
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    lowerKey === 'j' ||
    lowerKey === 'k' ||
    lowerKey === 'l' ||
    lowerKey === 'm';

  const isPlayPauseSpace = key === ' ' && !shiftKey;
  const isPlayerVolumeArrow =
    (key === 'ArrowUp' || key === 'ArrowDown') &&
    !shiftKey &&
    (isYouTubeWatch ||
      (!isYouTubeShorts &&
        Boolean(
          (targetVideo && active === targetVideo) ||
            (playerEl && active && playerEl.contains(active))
        )));

  if (
    (targetVideo || playerEl) &&
    (isMediaOnlyKey || isPlayPauseSpace || isPlayerVolumeArrow)
  ) {
    if (playerEl && isVisibleElement(playerEl)) {
      if (!playerEl.hasAttribute('tabindex') && playerEl.tabIndex < 0) {
        playerEl.tabIndex = -1;
      }
      try {
        playerEl.focus({ preventScroll: true });
      } catch {
        // ignore
      }

      const keyCodeMap: Record<string, number> = {
        ArrowLeft: 37,
        ArrowUp: 38,
        ArrowRight: 39,
        ArrowDown: 40,
        ' ': 32,
        j: 74,
        k: 75,
        l: 76,
        m: 77
      };
      const keyCode = keyCodeMap[key] ?? keyCodeMap[lowerKey] ?? 0;

      const beforeTime = targetVideo ? targetVideo.currentTime : 0;
      const beforePaused = targetVideo ? targetVideo.paused : true;
      const beforeMuted = targetVideo ? targetVideo.muted : false;
      const beforeVolume = targetVideo ? targetVideo.volume : 1;

      const ev = new KeyboardEvent('keydown', {
        key,
        code: payload.code,
        keyCode,
        which: keyCode,
        shiftKey,
        bubbles: true,
        cancelable: true
      });
      playerEl.dispatchEvent(ev);

      const videoStateChanged = Boolean(
        targetVideo &&
          (targetVideo.currentTime !== beforeTime ||
            targetVideo.paused !== beforePaused ||
            targetVideo.muted !== beforeMuted ||
            Math.abs(targetVideo.volume - beforeVolume) > 0.001)
      );

      if (ev.defaultPrevented || videoStateChanged) {
        return true;
      }
    }

    if (targetVideo) {
      const dur = Number.isFinite(targetVideo.duration) ? targetVideo.duration : Infinity;
      if (key === 'ArrowLeft') {
        targetVideo.currentTime = Math.max(0, (targetVideo.currentTime || 0) - 5);
        return true;
      }
      if (key === 'ArrowRight') {
        targetVideo.currentTime = Math.min(dur, (targetVideo.currentTime || 0) + 5);
        return true;
      }
      if (lowerKey === 'j') {
        targetVideo.currentTime = Math.max(0, (targetVideo.currentTime || 0) - 10);
        return true;
      }
      if (lowerKey === 'l') {
        targetVideo.currentTime = Math.min(dur, (targetVideo.currentTime || 0) + 10);
        return true;
      }
      if (isPlayPauseSpace || lowerKey === 'k') {
        if (targetVideo.paused) {
          const playPromise = targetVideo.play?.();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
          }
        } else {
          targetVideo.pause?.();
        }
        return true;
      }
      if (lowerKey === 'm') {
        targetVideo.muted = !targetVideo.muted;
        return true;
      }
      if (key === 'ArrowUp') {
        if (targetVideo.muted) targetVideo.muted = false;
        targetVideo.volume = Math.min(
          1,
          Math.round(((targetVideo.volume ?? 1) + 0.05) * 100) / 100
        );
        return true;
      }
      if (key === 'ArrowDown') {
        targetVideo.volume = Math.max(
          0,
          Math.round(((targetVideo.volume ?? 1) - 0.05) * 100) / 100
        );
        return true;
      }
    }
  }

  // Strictly ignore media-only keys (Arrows Left/Right, J/K/L/M) on non-video pages
  if (isMediaOnlyKey) {
    return false;
  }

  // Safe vertical scrolling for articles, docs, and web apps
  const findScrollContainer = (): HTMLElement | null => {
    const docScroller = (document.scrollingElement ||
      document.documentElement) as HTMLElement | null;
    if (docScroller && docScroller.scrollHeight > docScroller.clientHeight + 2) {
      return docScroller;
    }
    if (typeof document.elementFromPoint === 'function') {
      const centerEl = document.elementFromPoint(
        Math.max(1, Math.floor((window.innerWidth || 800) / 2)),
        Math.max(1, Math.floor((window.innerHeight || 600) / 2))
      ) as HTMLElement | null;
      let curr: HTMLElement | null = centerEl;
      while (curr && curr !== document.body && curr !== document.documentElement) {
        if (curr.scrollHeight > curr.clientHeight + 2 && window.getComputedStyle) {
          const oy = window.getComputedStyle(curr).overflowY;
          if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') {
            return curr;
          }
        }
        curr = curr.parentElement;
      }
    }
    return null;
  };

  const scroller = findScrollContainer();
  const viewportHeight =
    (scroller && scroller.clientHeight > 0 ? scroller.clientHeight : window.innerHeight) || 600;
  const pageStep = Math.round(viewportHeight * 0.85);

  const scrollByY = (deltaY: number): boolean => {
    const docScroller = document.scrollingElement || document.documentElement;
    if (scroller && scroller !== docScroller && typeof scroller.scrollBy === 'function') {
      scroller.scrollBy({ top: deltaY, behavior: 'auto' });
      return true;
    }
    if (scroller && scroller !== docScroller) {
      scroller.scrollTop += deltaY;
      return true;
    }
    window.scrollBy({ top: deltaY, behavior: 'auto' });
    return true;
  };

  const scrollToEdge = (toTop: boolean): boolean => {
    const docScroller = document.scrollingElement || document.documentElement;
    if (scroller && scroller !== docScroller) {
      const top = toTop ? 0 : scroller.scrollHeight;
      if (typeof scroller.scrollTo === 'function') {
        scroller.scrollTo({ top, behavior: 'auto' });
      } else {
        scroller.scrollTop = top;
      }
      return true;
    }
    const maxScroll = Math.max(
      docScroller?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
      100000
    );
    window.scrollTo({ top: toTop ? 0 : maxScroll, behavior: 'auto' });
    return true;
  };

  if (key === 'ArrowDown') return scrollByY(isYouTubeShorts ? viewportHeight : 60);
  if (key === 'ArrowUp') return scrollByY(isYouTubeShorts ? -viewportHeight : -60);
  if (key === 'PageDown') return scrollByY(pageStep);
  if (key === 'PageUp') return scrollByY(-pageStep);
  if (key === ' ') return scrollByY(shiftKey ? -pageStep : pageStep);
  if (key === 'Home') return scrollToEdge(true);
  if (key === 'End') return scrollToEdge(false);

  return false;
}

/**
 * Safely focuses the active tab's media player (e.g. YouTube #movie_player) or window
 * when host permissions are granted and the setting is enabled. Never prompts permissions.
 */
export async function focusActiveMediaOrPageInTab(
  tabId: number,
  tabUrl?: string
): Promise<boolean> {
  if (typeof tabId !== 'number' || typeof chrome === 'undefined' || !chrome.scripting?.executeScript) {
    return false;
  }

  let resolvedUrl = tabUrl;
  if (!resolvedUrl && chrome.tabs?.get) {
    try {
      const tab = await chrome.tabs.get(tabId);
      resolvedUrl = tab?.pendingUrl || tab?.url;
    } catch {
      return false;
    }
  }

  if (!isInjectableWebUrl(resolvedUrl)) return false;

  const [enabled, hasPerm] = await Promise.all([
    isTabPageFocusSettingEnabled(),
    hasPageScriptingPermission()
  ]);
  if (!enabled || !hasPerm) return false;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: focusPageOrPlayerInDocument
    });
    return Boolean(results?.[0]?.result);
  } catch {
    return false;
  }
}

/**
 * Forwards a media or navigation keystroke from the Side Panel into the active tab.
 */
export async function forwardKeyToTab(
  tabId: number,
  payload: ForwardedKeyPayload,
  tabUrl?: string
): Promise<boolean> {
  if (typeof tabId !== 'number' || typeof chrome === 'undefined' || !chrome.scripting?.executeScript) {
    return false;
  }
  if (!isInjectableWebUrl(tabUrl)) return false;

  const hasPerm = await hasPageScriptingPermission();
  if (!hasPerm) return false;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: handleForwardedKeyInDocument,
      args: [payload]
    });
    return Boolean(results?.[0]?.result);
  } catch {
    return false;
  }
}
