import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockChrome } from '../../test/setup';
import {
  blurSidebarActiveElementIfPointer,
  focusActiveMediaOrPageInTab,
  focusPageOrPlayerInDocument,
  forwardKeyToTab,
  handleForwardedKeyInDocument,
  isBridgedTabKey,
  isInjectableWebUrl,
  markKeyboardRowActivation
} from './tabPageFocus';

function setMockLocation(urlStr: string) {
  const parsed = new URL(urlStr);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: parsed.href,
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      search: parsed.search
    }
  });
}

function mockVideoRect(video: HTMLVideoElement, width = 854, height = 480) {
  vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({})
  } as DOMRect);
}

describe('tabPageFocus utilities', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    mockChrome.__resetAll();
    document.body.innerHTML = '';
    setMockLocation('https://example.com/');
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('validates injectable HTTP(S) URLs and excludes chrome:// and Web Store URLs', () => {
    expect(isInjectableWebUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isInjectableWebUrl('http://localhost:3000/app')).toBe(true);
    expect(isInjectableWebUrl('chrome://extensions')).toBe(false);
    expect(isInjectableWebUrl('about:blank')).toBe(false);
    expect(isInjectableWebUrl('https://chromewebstore.google.com/detail/xyz')).toBe(false);
    expect(isInjectableWebUrl('https://chrome.google.com/webstore/detail/xyz')).toBe(false);
    expect(isInjectableWebUrl(undefined)).toBe(false);
  });

  it('identifies supported media and scroll keys while rejecting modifiers and unrelated keys', () => {
    expect(
      isBridgedTabKey({
        key: 'ArrowRight',
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false
      })
    ).toBe(true);
    expect(
      isBridgedTabKey({
        key: ' ',
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: false
      })
    ).toBe(true);
    expect(
      isBridgedTabKey({
        key: 'k',
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false
      })
    ).toBe(true);
    expect(
      isBridgedTabKey({
        key: 'K',
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false
      })
    ).toBe(true);

    // Reject modifiers, Shift+Arrow, and arbitrary letters
    expect(
      isBridgedTabKey({
        key: 'ArrowRight',
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: false
      })
    ).toBe(false);
    expect(
      isBridgedTabKey({
        key: 'ArrowRight',
        shiftKey: false,
        metaKey: true,
        ctrlKey: false,
        altKey: false
      })
    ).toBe(false);
    expect(
      isBridgedTabKey({
        key: 'a',
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false
      })
    ).toBe(false);
    expect(
      isBridgedTabKey({
        key: 'Enter',
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false
      })
    ).toBe(false);
  });

  it('blurs pointer-clicked sidebar buttons to document.body while preserving keyboard activation and inputs', () => {
    const btn = document.createElement('button');
    const input = document.createElement('input');
    document.body.appendChild(btn);
    document.body.appendChild(input);

    // 1. Pointer click blurs button back to document.body
    btn.focus();
    expect(document.activeElement).toBe(btn);
    blurSidebarActiveElementIfPointer();
    expect(document.activeElement).toBe(document.body);

    // 2. Keyboard activation preserves button focus
    btn.focus();
    markKeyboardRowActivation();
    blurSidebarActiveElementIfPointer();
    expect(document.activeElement).toBe(btn);

    // Wait past keyboard grace window -> never blurs focused <input>
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    input.focus();
    blurSidebarActiveElementIfPointer();
    expect(document.activeElement).toBe(input);
    vi.useRealTimers();
  });

  describe('focusPageOrPlayerInDocument', () => {
    it('focuses #movie_player with preventScroll on YouTube /watch when document.body is active', () => {
      setMockLocation('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.tabIndex = -1;
      const focusSpy = vi.spyOn(player, 'focus');
      document.body.appendChild(player);

      expect(document.activeElement).toBe(document.body);
      const focused = focusPageOrPlayerInDocument();

      expect(focused).toBe(true);
      expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
      expect(document.activeElement).toBe(player);
    });

    it('blurs #arctic-edge-trigger-host first before focusing YouTube #movie_player', () => {
      setMockLocation('https://www.youtube.com/watch?v=abc123');
      const edgeHost = document.createElement('div');
      edgeHost.id = 'arctic-edge-trigger-host';
      edgeHost.tabIndex = -1;
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.tabIndex = -1;
      document.body.appendChild(edgeHost);
      document.body.appendChild(player);

      edgeHost.focus();
      expect(document.activeElement).toBe(edgeHost);

      expect(focusPageOrPlayerInDocument()).toBe(true);
      expect(document.activeElement).toBe(player);
    });

    it('never steals focus when an input, textarea, contenteditable, or iframe is active on the page', () => {
      setMockLocation('https://www.youtube.com/watch?v=abc123');
      const searchInput = document.createElement('input');
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.tabIndex = -1;
      document.body.appendChild(searchInput);
      document.body.appendChild(player);

      searchInput.focus();
      expect(focusPageOrPlayerInDocument()).toBe(false);
      expect(document.activeElement).toBe(searchInput);
    });

    it('ignores muted looping decorative background videos while focusing real HTML5 video players', () => {
      setMockLocation('https://marketing.example.com/');

      const heroBgVideo = document.createElement('video');
      heroBgVideo.muted = true;
      heroBgVideo.loop = true;
      heroBgVideo.controls = false;
      mockVideoRect(heroBgVideo, 1280, 720);
      document.body.appendChild(heroBgVideo);

      expect(focusPageOrPlayerInDocument()).toBe(false);
      expect(document.activeElement).toBe(document.body);

      // Add a real video player with controls
      const realVideo = document.createElement('video');
      realVideo.controls = true;
      mockVideoRect(realVideo, 800, 450);
      document.body.appendChild(realVideo);

      expect(focusPageOrPlayerInDocument()).toBe(true);
      expect(document.activeElement).toBe(realVideo);
    });
  });

  describe('handleForwardedKeyInDocument', () => {
    it('controls YouTube #movie_player video (seek +/-5s, +/-10s, play/pause, mute, volume) without double-firing', () => {
      setMockLocation('https://www.youtube.com/watch?v=xyz');
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.className = 'html5-video-player';
      const video = document.createElement('video');
      mockVideoRect(video, 854, 480);

      let pausedState = false;
      Object.defineProperty(video, 'duration', { configurable: true, value: 300 });
      Object.defineProperty(video, 'paused', {
        configurable: true,
        get: () => pausedState
      });
      video.play = vi.fn(async () => {
        pausedState = false;
      });
      video.pause = vi.fn(() => {
        pausedState = true;
      });
      video.currentTime = 50;
      video.volume = 0.5;
      video.muted = false;

      player.appendChild(video);
      document.body.appendChild(player);

      // ArrowRight -> +5s
      expect(
        handleForwardedKeyInDocument({ key: 'ArrowRight', code: 'ArrowRight', shiftKey: false })
      ).toBe(true);
      expect(video.currentTime).toBe(55);
      expect(document.activeElement).toBe(player);

      // ArrowLeft -> -5s
      handleForwardedKeyInDocument({ key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: false });
      expect(video.currentTime).toBe(50);

      // l -> +10s, j -> -10s
      handleForwardedKeyInDocument({ key: 'l', code: 'KeyL', shiftKey: false });
      expect(video.currentTime).toBe(60);
      handleForwardedKeyInDocument({ key: 'j', code: 'KeyJ', shiftKey: false });
      expect(video.currentTime).toBe(50);

      // Space -> pauses, k -> plays
      handleForwardedKeyInDocument({ key: ' ', code: 'Space', shiftKey: false });
      expect(video.pause).toHaveBeenCalledTimes(1);
      expect(video.paused).toBe(true);

      handleForwardedKeyInDocument({ key: 'k', code: 'KeyK', shiftKey: false });
      expect(video.play).toHaveBeenCalledTimes(1);
      expect(video.paused).toBe(false);

      // m -> mutes, ArrowUp -> unmutes & bumps volume +5%, ArrowDown -> lowers volume -5%
      handleForwardedKeyInDocument({ key: 'm', code: 'KeyM', shiftKey: false });
      expect(video.muted).toBe(true);

      handleForwardedKeyInDocument({ key: 'ArrowUp', code: 'ArrowUp', shiftKey: false });
      expect(video.muted).toBe(false);
      expect(video.volume).toBe(0.55);

      handleForwardedKeyInDocument({ key: 'ArrowDown', code: 'ArrowDown', shiftKey: false });
      expect(video.volume).toBe(0.5);

      // Verify zero double-seeking if YouTube's own keydown listener already handled the event
      player.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') {
          video.currentTime += 5;
          e.preventDefault();
        }
      });
      handleForwardedKeyInDocument({ key: 'ArrowRight', code: 'ArrowRight', shiftKey: false });
      expect(video.currentTime).toBe(55); // +5s once, NOT +10s!
    });

    it('does nothing when an editable element on the webpage currently has focus', () => {
      setMockLocation('https://www.youtube.com/watch?v=xyz');
      const player = document.createElement('div');
      player.id = 'movie_player';
      const video = document.createElement('video');
      mockVideoRect(video, 854, 480);
      video.currentTime = 40;
      player.appendChild(video);

      const commentBox = document.createElement('div');
      commentBox.setAttribute('contenteditable', 'true');
      commentBox.tabIndex = 0;

      document.body.appendChild(player);
      document.body.appendChild(commentBox);
      commentBox.focus();

      expect(
        handleForwardedKeyInDocument({ key: 'ArrowRight', code: 'ArrowRight', shiftKey: false })
      ).toBe(false);
      expect(video.currentTime).toBe(40);
    });

    it('ignores J/K/L/M and Left/Right on non-video pages (like Gmail) while scrolling cleanly on vertical keys', () => {
      setMockLocation('https://mail.google.com/mail/u/0/#inbox');
      const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
      const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
      const docKeySpy = vi.fn();
      document.addEventListener('keydown', docKeySpy);

      // Media-only keys do NOT fire synthetic keydown or scroll on Gmail
      expect(handleForwardedKeyInDocument({ key: 'm', code: 'KeyM', shiftKey: false })).toBe(false);
      expect(handleForwardedKeyInDocument({ key: 'j', code: 'KeyJ', shiftKey: false })).toBe(false);
      expect(
        handleForwardedKeyInDocument({ key: 'ArrowRight', code: 'ArrowRight', shiftKey: false })
      ).toBe(false);
      expect(docKeySpy).not.toHaveBeenCalled();
      expect(scrollBySpy).not.toHaveBeenCalled();

      // Vertical scroll keys scroll the page cleanly
      expect(
        handleForwardedKeyInDocument({ key: 'ArrowDown', code: 'ArrowDown', shiftKey: false })
      ).toBe(true);
      expect(scrollBySpy).toHaveBeenCalledWith({ top: 60, behavior: 'auto' });

      expect(handleForwardedKeyInDocument({ key: 'Home', code: 'Home', shiftKey: false })).toBe(
        true
      );
      expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });

      document.removeEventListener('keydown', docKeySpy);
    });
  });

  describe('focusActiveMediaOrPageInTab & forwardKeyToTab IPC wrappers', () => {
    it('silently skips executeScript without prompting permissions when host permission is not granted or disabled', async () => {
      mockChrome.__setHostPermissionsGranted(false);

      expect(
        await focusActiveMediaOrPageInTab(1, 'https://www.youtube.com/watch?v=123')
      ).toBe(false);
      expect(
        await forwardKeyToTab(
          1,
          { key: 'ArrowRight', code: 'ArrowRight', shiftKey: false },
          'https://www.youtube.com/watch?v=123'
        )
      ).toBe(false);
      expect(chrome.permissions.request).not.toHaveBeenCalled();
      expect(chrome.scripting.executeScript).not.toHaveBeenCalled();

      // Grant permission, then disable setting -> focusActiveMediaOrPageInTab respects setting
      mockChrome.__setHostPermissionsGranted(true);
      mockChrome.__setLocalStorage({ tabPageFocusEnabled: false });
      expect(
        await focusActiveMediaOrPageInTab(1, 'https://www.youtube.com/watch?v=123')
      ).toBe(false);
      expect(chrome.scripting.executeScript).not.toHaveBeenCalled();

      // Enable setting -> invokes executeScript targeting tabId
      mockChrome.__setLocalStorage({ tabPageFocusEnabled: true });
      await focusActiveMediaOrPageInTab(1, 'https://www.youtube.com/watch?v=123');
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId: 1 },
          func: focusPageOrPlayerInDocument
        })
      );
    });
  });
});
