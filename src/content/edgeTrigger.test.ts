import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockChrome } from '../test/setup';

describe('edgeTrigger content script (full-height Quick Access stripe)', () => {
  let capturedShadowRoots: ShadowRoot[] = [];
  const origAttachShadow = Element.prototype.attachShadow;

  beforeEach(() => {
    capturedShadowRoots = [];
    vi.resetModules();
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      const root = origAttachShadow.call(this, { ...init, mode: 'open' });
      capturedShadowRoots.push(root);
      return root;
    };
  });

  afterEach(() => {
    const win = window as Window & { __arcticEdgeTriggerCleanup?: () => void };
    if (typeof win.__arcticEdgeTriggerCleanup === 'function') {
      win.__arcticEdgeTriggerCleanup();
      delete win.__arcticEdgeTriggerCleanup;
    }
    Element.prototype.attachShadow = origAttachShadow;
    document.getElementById('arctic-edge-trigger-host')?.remove();
  });

  it('mounts full-height Quick Access rail ONLY when edgeTriggerEnabled is true and sidePanel is closed, and unmounts when opened', async () => {
    mockChrome.__setLocalStorage({
      edgeTriggerEnabled: true,
      sidebarDockSide: 'left',
      theme: 'dark',
      colorTheme: 'glacier-blue'
    });

    mockChrome.runtime.onMessage.addListener(
      (
        msg: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (resp?: unknown) => void
      ) => {
        const m = msg as { type?: string };
        if (m?.type === 'GET_EDGE_TRIGGER_STATE') {
          sendResponse({
            windowId: 10,
            openWindowIds: [],
            edgeTriggerEnabled: true,
            side: 'left',
            quickAccessItems: [
              {
                id: 'qa-1',
                title: 'GitHub',
                url: 'https://github.com',
                faviconDataUrl: '',
                isActive: true,
                isOpen: true,
                isNavigatedAway: false
              },
              {
                id: 'qa-2',
                title: 'Linear',
                url: 'https://linear.app',
                faviconDataUrl: '',
                isActive: false,
                isOpen: true,
                isNavigatedAway: true
              }
            ]
          });
        }
        if (m?.type === 'OPEN_SIDE_PANEL_FROM_EDGE') {
          sendResponse({ ok: true });
        }
      }
    );

    await import('./edgeTrigger');
    await new Promise((r) => setTimeout(r, 10));

    expect(document.getElementById('arctic-edge-trigger-host')).not.toBeNull();
    expect(capturedShadowRoots.length).toBe(1);

    const rail = capturedShadowRoots[0].querySelector('aside.arctic-rail') as HTMLElement;
    expect(rail).not.toBeNull();
    expect(rail.getAttribute('data-side')).toBe('left');

    const qaButtons = capturedShadowRoots[0].querySelectorAll('button.arctic-qa-btn');
    expect(qaButtons.length).toBe(2);
    expect(qaButtons[0].getAttribute('data-active')).toBe('true');
    expect(qaButtons[1].getAttribute('data-drifted')).toBe('true');

    // When sidePanel opens in window 10 -> unmounts completely (0px footprint)
    await chrome.storage.session.set({ openSidePanelWindowIds: [10] });
    expect(document.getElementById('arctic-edge-trigger-host')).toBeNull();

    // When sidePanel closes in window 10 -> mounts again automatically
    await chrome.storage.session.set({ openSidePanelWindowIds: [] });
    expect(document.getElementById('arctic-edge-trigger-host')).not.toBeNull();
  });

  it('clicking a Quick Access icon sends ACTIVATE_QUICK_ACCESS_FROM_EDGE while keeping the slim rail visible', async () => {
    mockChrome.__setLocalStorage({ edgeTriggerEnabled: true });

    mockChrome.runtime.onMessage.addListener(
      (
        msg: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (resp?: unknown) => void
      ) => {
        const m = msg as { type?: string };
        if (m?.type === 'GET_EDGE_TRIGGER_STATE') {
          sendResponse({
            windowId: 10,
            openWindowIds: [],
            edgeTriggerEnabled: true,
            side: 'left',
            quickAccessItems: [
              {
                id: 'qa-gmail',
                title: 'Gmail',
                url: 'https://gmail.com',
                faviconDataUrl: '',
                isActive: false,
                isOpen: false,
                isNavigatedAway: false
              }
            ]
          });
        }
      }
    );

    await import('./edgeTrigger');
    await new Promise((r) => setTimeout(r, 10));

    const qaBtn = capturedShadowRoots[0].querySelector('button.arctic-qa-btn') as HTMLButtonElement;
    mockChrome.runtime.sendMessage.mockClear();

    qaBtn.click();

    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'ACTIVATE_QUICK_ACCESS_FROM_EDGE',
        bookmarkId: 'qa-gmail',
        forceReset: false
      },
      expect.any(Function)
    );
    // Rail remains mounted (full sidebar stays hidden)
    expect(document.getElementById('arctic-edge-trigger-host')).not.toBeNull();
    expect(mockChrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      { type: 'OPEN_SIDE_PANEL_FROM_EDGE' },
      expect.any(Function)
    );
  });

  it('clicking the Expand button sends OPEN_SIDE_PANEL_FROM_EDGE synchronously and hides optimistically', async () => {
    mockChrome.__setLocalStorage({ edgeTriggerEnabled: true });

    mockChrome.runtime.onMessage.addListener(
      (
        msg: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (resp?: unknown) => void
      ) => {
        const m = msg as { type?: string };
        if (m?.type === 'GET_EDGE_TRIGGER_STATE') {
          sendResponse({
            windowId: 10,
            openWindowIds: [],
            edgeTriggerEnabled: true,
            side: 'left',
            quickAccessItems: []
          });
        }
        if (m?.type === 'OPEN_SIDE_PANEL_FROM_EDGE') {
          sendResponse({ ok: true });
        }
      }
    );

    await import('./edgeTrigger');
    await new Promise((r) => setTimeout(r, 10));

    const expandBtn = capturedShadowRoots[0].querySelector(
      'button.arctic-expand-btn'
    ) as HTMLButtonElement;
    mockChrome.runtime.sendMessage.mockClear();

    expandBtn.click();

    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'OPEN_SIDE_PANEL_FROM_EDGE' },
      expect.any(Function)
    );
    expect(document.getElementById('arctic-edge-trigger-host')).toBeNull();
  });

  it('updates Quick Access icons dynamically on ARCTIC_SIDEPANEL_VISIBILITY and ARCTIC_EDGE_ITEMS_UPDATED', async () => {
    mockChrome.__setLocalStorage({ edgeTriggerEnabled: true });

    mockChrome.runtime.onMessage.addListener(
      (
        msg: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (resp?: unknown) => void
      ) => {
        const m = msg as { type?: string };
        if (m?.type === 'GET_EDGE_TRIGGER_STATE') {
          sendResponse({
            windowId: 10,
            openWindowIds: [10],
            edgeTriggerEnabled: true,
            side: 'left',
            quickAccessItems: []
          });
        }
      }
    );

    await import('./edgeTrigger');
    await new Promise((r) => setTimeout(r, 10));

    expect(document.getElementById('arctic-edge-trigger-host')).toBeNull();

    // Broadcast visibility closed with 1 Quick Access item
    chrome.runtime.sendMessage({
      type: 'ARCTIC_SIDEPANEL_VISIBILITY',
      windowId: 10,
      isSidePanelOpen: false,
      openWindowIds: [],
      quickAccessItems: [
        {
          id: 'qa-1',
          title: 'Docs',
          url: 'https://docs.google.com',
          faviconDataUrl: '',
          isActive: false,
          isOpen: true,
          isNavigatedAway: false
        }
      ]
    });

    expect(document.getElementById('arctic-edge-trigger-host')).not.toBeNull();
    expect(capturedShadowRoots[0].querySelectorAll('button.arctic-qa-btn').length).toBe(1);

    // Live update adding a second item and marking it active
    chrome.runtime.sendMessage({
      type: 'ARCTIC_EDGE_ITEMS_UPDATED',
      windowId: 10,
      quickAccessItems: [
        {
          id: 'qa-1',
          title: 'Docs',
          url: 'https://docs.google.com',
          faviconDataUrl: '',
          isActive: false,
          isOpen: true,
          isNavigatedAway: false
        },
        {
          id: 'qa-2',
          title: 'Figma',
          url: 'https://figma.com',
          faviconDataUrl: '',
          isActive: true,
          isOpen: true,
          isNavigatedAway: false
        }
      ]
    });

    const updatedBtns = capturedShadowRoots[0].querySelectorAll('button.arctic-qa-btn');
    expect(updatedBtns.length).toBe(2);
    expect(updatedBtns[1].getAttribute('data-active')).toBe('true');
  });

  it('renders Quick Access, horizontal separator, Space tabs, and click-to-open Folder flyout (closing on Esc, outside click, or selecting a URL)', async () => {
    mockChrome.__setLocalStorage({ edgeTriggerEnabled: true, sidebarDockSide: 'left' });

    mockChrome.runtime.onMessage.addListener(
      (
        msg: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (resp?: unknown) => void
      ) => {
        const m = msg as { type?: string; urls?: string[] };
        if (m?.type === 'GET_EDGE_TRIGGER_STATE') {
          sendResponse({
            windowId: 10,
            openWindowIds: [],
            edgeTriggerEnabled: true,
            side: 'left',
            quickAccessItems: [
              {
                id: 'qa-1',
                title: 'Gmail',
                url: 'https://mail.google.com',
                faviconDataUrl: '',
                isActive: false,
                isOpen: true,
                isNavigatedAway: false
              }
            ],
            spaceItems: [
              {
                type: 'bookmark',
                id: 'sp-1',
                title: 'Notion',
                url: 'https://notion.so',
                faviconDataUrl: '',
                isActive: false,
                isOpen: false,
                isNavigatedAway: false
              },
              {
                type: 'folder',
                id: 'folder-eng',
                title: 'Engineering',
                hasActiveChild: true,
                hasOpenChild: true,
                hasNavigatedAwayChild: false,
                itemCount: 2,
                children: [
                  {
                    type: 'bookmark',
                    id: 'f-pr',
                    title: 'Pull Requests',
                    url: 'https://github.com/pulls',
                    faviconDataUrl: '',
                    isActive: true,
                    isOpen: true,
                    isNavigatedAway: false
                  },
                  {
                    type: 'folder',
                    id: 'sub-rfc',
                    title: 'RFCs',
                    hasActiveChild: false,
                    hasOpenChild: false,
                    hasNavigatedAwayChild: false,
                    itemCount: 1,
                    children: [
                      {
                        type: 'bookmark',
                        id: 'f-rfc-1',
                        title: 'RFC 001',
                        url: 'https://docs.example.com/rfc1',
                        faviconDataUrl: '',
                        isActive: false,
                        isOpen: false,
                        isNavigatedAway: false
                      }
                    ]
                  }
                ]
              }
            ]
          });
        }
        if (m?.type === 'GET_EDGE_FOLDER_FAVICONS') {
          sendResponse({
            ok: true,
            favicons: {
              'https://github.com/pulls':
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
            }
          });
        }
        if (m?.type === 'ACTIVATE_QUICK_ACCESS_FROM_EDGE') {
          sendResponse({ ok: true });
        }
      }
    );

    await import('./edgeTrigger');
    await new Promise((r) => setTimeout(r, 15));

    const root = capturedShadowRoots[0];
    // Horizontal separator rendered between Quick Access and Active Space items
    expect(root.querySelector('div.arctic-section-sep')).not.toBeNull();

    // 1 QA button + 1 Space bookmark button + 1 Space folder button = 3 rail buttons
    const railBtns = root.querySelectorAll('button.arctic-qa-btn');
    expect(railBtns.length).toBe(3);

    const folderBtn = root.querySelector('button.arctic-folder-btn') as HTMLButtonElement;
    expect(folderBtn).not.toBeNull();
    expect(folderBtn.getAttribute('aria-label')).toBe('Engineering');
    expect(folderBtn.getAttribute('data-active')).toBe('true');

    const flyout = root.querySelector('div.arctic-folder-flyout') as HTMLDivElement;
    expect(flyout.getAttribute('data-visible')).toBe('false');

    // Click folder button -> opens floating flyout & requests lazy favicons
    mockChrome.runtime.sendMessage.mockClear();
    folderBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(flyout.getAttribute('data-visible')).toBe('true');
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'GET_EDGE_FOLDER_FAVICONS',
        urls: ['https://github.com/pulls', 'https://docs.example.com/rfc1']
      },
      expect.any(Function)
    );

    // Expand nested subfolder 'RFCs' inside the flyout
    const subBtn = flyout.querySelector('button.arctic-flyout-subfolder') as HTMLButtonElement;
    expect(subBtn).not.toBeNull();
    subBtn.click();
    expect(flyout.querySelectorAll('button.arctic-flyout-item').length).toBe(2);

    // Press Escape -> closes flyout without unmounting rail
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(flyout.getAttribute('data-visible')).toBe('false');

    // Reopen folder, then click outside on document.body -> closes flyout
    folderBtn.click();
    expect(flyout.getAttribute('data-visible')).toBe('true');
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(flyout.getAttribute('data-visible')).toBe('false');

    // Reopen folder and click 'Pull Requests' item -> activates bookmark & closes flyout while rail stays mounted
    folderBtn.click();
    mockChrome.runtime.sendMessage.mockClear();
    const prItem = flyout.querySelector(
      'button.arctic-flyout-item[data-bookmark-id="f-pr"]'
    ) as HTMLButtonElement;
    prItem.click();

    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'ACTIVATE_QUICK_ACCESS_FROM_EDGE',
        bookmarkId: 'f-pr',
        forceReset: false
      },
      expect.any(Function)
    );
    expect(flyout.getAttribute('data-visible')).toBe('false');
    expect(document.getElementById('arctic-edge-trigger-host')).not.toBeNull();
  });

  it('pushes page layout and flush position:fixed sidebars by 36px in push mode (default), and restores original styles cleanly when sidePanel opens', async () => {
    const fixedAppSidebar = document.createElement('aside');
    fixedAppSidebar.id = 'app-left-nav';
    fixedAppSidebar.style.position = 'fixed';
    fixedAppSidebar.style.left = '0px';
    fixedAppSidebar.style.top = '0px';
    fixedAppSidebar.style.width = '240px';
    document.body.appendChild(fixedAppSidebar);

    mockChrome.__setLocalStorage({
      edgeTriggerEnabled: true,
      edgeTriggerMode: 'push',
      sidebarDockSide: 'left'
    });

    mockChrome.runtime.onMessage.addListener(
      (
        msg: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (resp?: unknown) => void
      ) => {
        const m = msg as { type?: string };
        if (m?.type === 'GET_EDGE_TRIGGER_STATE') {
          sendResponse({
            windowId: 10,
            openWindowIds: [],
            edgeTriggerEnabled: true,
            side: 'left',
            mode: 'push',
            quickAccessItems: []
          });
        }
      }
    );

    try {
      await import('./edgeTrigger');
      await new Promise((r) => setTimeout(r, 15));

      expect(document.documentElement.getAttribute('data-arctic-edge-push')).toBe('left');
      expect(document.getElementById('arctic-edge-page-push-style')).not.toBeNull();
      expect(fixedAppSidebar.style.left).toBe('36px');

      // Opening sidePanel in window 10 restores page styles and fixed element left: 0px immediately
      await chrome.storage.session.set({ openSidePanelWindowIds: [10] });
      expect(document.documentElement.getAttribute('data-arctic-edge-push')).toBeNull();
      expect(document.getElementById('arctic-edge-page-push-style')).toBeNull();
      expect(fixedAppSidebar.style.left).toBe('0px');
    } finally {
      fixedAppSidebar.remove();
    }
  });

  it('supports hover mode with zero page layout push, sliding out on edge hover and collapsing after mouseleave', async () => {
    mockChrome.__setLocalStorage({
      edgeTriggerEnabled: true,
      edgeTriggerMode: 'hover',
      sidebarDockSide: 'left'
    });

    mockChrome.runtime.onMessage.addListener(
      (
        msg: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (resp?: unknown) => void
      ) => {
        const m = msg as { type?: string };
        if (m?.type === 'GET_EDGE_TRIGGER_STATE') {
          sendResponse({
            windowId: 10,
            openWindowIds: [],
            edgeTriggerEnabled: true,
            side: 'left',
            mode: 'hover',
            quickAccessItems: []
          });
        }
      }
    );

    await import('./edgeTrigger');
    await new Promise((r) => setTimeout(r, 15));

    // Zero page push in hover mode
    expect(document.documentElement.getAttribute('data-arctic-edge-push')).toBeNull();
    expect(document.getElementById('arctic-edge-page-push-style')).toBeNull();

    const root = capturedShadowRoots[0];
    const rail = root.querySelector('aside.arctic-rail') as HTMLElement;
    const sensor = root.querySelector('div.arctic-hover-sensor') as HTMLDivElement;

    expect(rail.getAttribute('data-mode')).toBe('hover');
    expect(rail.getAttribute('data-expanded')).toBe('false');
    expect(sensor.getAttribute('data-visible')).toBe('true');

    // Touching the 5px edge sensor slides the rail open
    sensor.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(rail.getAttribute('data-expanded')).toBe('true');
    expect(sensor.getAttribute('data-visible')).toBe('false');

    // Leaving the rail collapses it after the 150ms grace delay
    rail.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 190));
    expect(rail.getAttribute('data-expanded')).toBe('false');

    // Quick-dart regression: touch the 5px sensor, then immediately move cursor to clientX=140
    // BEFORE rail.mouseenter or rail.mouseleave ever fires -> must collapse on the FIRST hover-out!
    sensor.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(rail.getAttribute('data-expanded')).toBe('true');

    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 140, clientY: 200, bubbles: true })
    );
    await new Promise((r) => setTimeout(r, 190));
    expect(rail.getAttribute('data-expanded')).toBe('false');
    expect(sensor.getAttribute('data-visible')).toBe('true');
  });

  it('purges orphaned #arctic-edge-trigger-host zombies from prior extension reloads and stays unmounted while Side Panel is open', async () => {
    // Simulate a leftover DOM host & push style from a prior invalidated isolated world after chrome://extensions reload
    const zombieHost = document.createElement('div');
    zombieHost.id = 'arctic-edge-trigger-host';
    document.documentElement.appendChild(zombieHost);

    const zombieStyle = document.createElement('style');
    zombieStyle.id = 'arctic-edge-page-push-style';
    document.head.appendChild(zombieStyle);
    document.documentElement.setAttribute('data-arctic-edge-push', 'left');

    mockChrome.__setLocalStorage({
      edgeTriggerEnabled: true,
      edgeTriggerMode: 'hover',
      sidebarDockSide: 'left'
    });
    mockChrome.__setSessionStorage({ openSidePanelWindowIds: [10] });

    mockChrome.runtime.onMessage.addListener(
      (
        msg: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (resp?: unknown) => void
      ) => {
        const m = msg as { type?: string };
        if (m?.type === 'GET_EDGE_TRIGGER_STATE') {
          sendResponse({
            windowId: 10,
            openWindowIds: [10],
            edgeTriggerEnabled: true,
            side: 'left',
            mode: 'hover',
            quickAccessItems: []
          });
        }
      }
    );

    await import('./edgeTrigger');
    await new Promise((r) => setTimeout(r, 15));

    // Zombie host and push style must be purged immediately, and 0 hosts remain while window 10 has Side Panel open
    expect(document.querySelectorAll('#arctic-edge-trigger-host').length).toBe(0);
    expect(document.getElementById('arctic-edge-page-push-style')).toBeNull();
    expect(document.documentElement.getAttribute('data-arctic-edge-push')).toBeNull();

    // When Side Panel closes in window 10, exactly 1 clean host mounts
    await chrome.storage.session.set({ openSidePanelWindowIds: [] });
    expect(document.querySelectorAll('#arctic-edge-trigger-host').length).toBe(1);
  });

  it('supports right-side docking, fullscreen auto-unmount/restore, double-click forceReset, and collapsing an auto-expanded active subfolder', async () => {
    const fixedRightPanel = document.createElement('aside');
    fixedRightPanel.style.position = 'fixed';
    fixedRightPanel.style.right = '0px';
    fixedRightPanel.style.top = '0px';
    fixedRightPanel.style.width = '200px';
    document.body.appendChild(fixedRightPanel);

    mockChrome.__setLocalStorage({
      edgeTriggerEnabled: true,
      edgeTriggerMode: 'push',
      sidebarDockSide: 'right'
    });

    mockChrome.runtime.onMessage.addListener(
      (
        msg: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (resp?: unknown) => void
      ) => {
        const m = msg as { type?: string };
        if (m?.type === 'GET_EDGE_TRIGGER_STATE') {
          sendResponse({
            windowId: 10,
            openWindowIds: [],
            edgeTriggerEnabled: true,
            side: 'right',
            mode: 'push',
            quickAccessItems: [
              {
                id: 'qa-docs',
                title: 'Docs',
                url: 'https://docs.google.com',
                faviconDataUrl: '',
                isActive: false,
                isOpen: true,
                isNavigatedAway: true
              }
            ],
            spaceItems: [
              {
                type: 'folder',
                id: 'f-parent',
                title: 'Projects',
                hasActiveChild: true,
                hasOpenChild: true,
                hasNavigatedAwayChild: false,
                itemCount: 1,
                children: [
                  {
                    type: 'folder',
                    id: 'f-active-sub',
                    title: 'Active Sprint',
                    hasActiveChild: true,
                    hasOpenChild: true,
                    hasNavigatedAwayChild: false,
                    itemCount: 1,
                    children: [
                      {
                        type: 'bookmark',
                        id: 'bm-board',
                        title: 'Sprint Board',
                        url: 'https://linear.app/board',
                        faviconDataUrl: '',
                        isActive: true,
                        isOpen: true,
                        isNavigatedAway: false
                      }
                    ]
                  }
                ]
              }
            ]
          });
        }
      }
    );

    try {
      await import('./edgeTrigger');
      await new Promise((r) => setTimeout(r, 15));

      const root = capturedShadowRoots[0];
      const rail = root.querySelector('aside.arctic-rail') as HTMLElement;
      expect(rail.getAttribute('data-side')).toBe('right');
      expect(document.documentElement.getAttribute('data-arctic-edge-push')).toBe('right');
      expect(fixedRightPanel.style.right).toBe('36px');

      // Double-clicking a Quick Access icon sends forceReset: true
      const qaBtn = root.querySelector('button.arctic-qa-btn[data-bookmark-id="qa-docs"]') as HTMLButtonElement;
      mockChrome.runtime.sendMessage.mockClear();
      qaBtn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
        {
          type: 'ACTIVATE_QUICK_ACCESS_FROM_EDGE',
          bookmarkId: 'qa-docs',
          forceReset: true
        },
        expect.any(Function)
      );

      // Opening Projects folder shows Active Sprint auto-expanded because hasActiveChild === true,
      // and clicking Active Sprint collapses it cleanly
      const folderBtn = root.querySelector('button.arctic-folder-btn') as HTMLButtonElement;
      folderBtn.click();
      const flyout = root.querySelector('div.arctic-folder-flyout') as HTMLDivElement;
      let subBtn = flyout.querySelector('button.arctic-flyout-subfolder') as HTMLButtonElement;
      expect(subBtn.getAttribute('aria-expanded')).toBe('true');
      expect(flyout.querySelectorAll('button.arctic-flyout-item').length).toBe(1);

      subBtn.click();
      subBtn = flyout.querySelector('button.arctic-flyout-subfolder') as HTMLButtonElement;
      expect(subBtn.getAttribute('aria-expanded')).toBe('false');
      expect(flyout.querySelectorAll('button.arctic-flyout-item').length).toBe(0);

      // Entering fullscreen unmounts rail and restores fixedRightPanel.style.right === '0px'
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        value: document.documentElement
      });
      document.dispatchEvent(new Event('fullscreenchange'));
      expect(document.getElementById('arctic-edge-trigger-host')).toBeNull();
      expect(document.documentElement.getAttribute('data-arctic-edge-push')).toBeNull();
      expect(fixedRightPanel.style.right).toBe('0px');

      // Exiting fullscreen remounts rail and re-applies right push
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        value: null
      });
      document.dispatchEvent(new Event('fullscreenchange'));
      expect(document.getElementById('arctic-edge-trigger-host')).not.toBeNull();
      expect(document.documentElement.getAttribute('data-arctic-edge-push')).toBe('right');
      expect(fixedRightPanel.style.right).toBe('36px');
    } finally {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        value: null
      });
      fixedRightPanel.remove();
    }
  });

  it('renders Today Tabs with click, double-click reload, and middle-click close, and supports Option A overlay scrollbar drag without collapsing hover mode', async () => {
    mockChrome.__setLocalStorage({
      edgeTriggerEnabled: true,
      edgeTriggerMode: 'hover',
      sidebarDockSide: 'left'
    });

    mockChrome.runtime.onMessage.addListener(
      (
        msg: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (resp?: unknown) => void
      ) => {
        const m = msg as { type?: string };
        if (m?.type === 'GET_EDGE_TRIGGER_STATE') {
          sendResponse({
            windowId: 10,
            openWindowIds: [],
            edgeTriggerEnabled: true,
            side: 'left',
            mode: 'hover',
            quickAccessItems: [
              {
                id: 'qa-1',
                title: 'GitHub',
                url: 'https://github.com',
                faviconDataUrl: '',
                isActive: false,
                isOpen: false,
                isNavigatedAway: false
              }
            ],
            spaceItems: [],
            todayTabItems: [
              {
                tabId: 777,
                title: 'Hacker News',
                url: 'https://news.ycombinator.com',
                faviconDataUrl: '',
                isActive: true,
                isDiscarded: false,
                isAudible: true,
                isMuted: false
              },
              {
                tabId: 778,
                title: 'Sleeping Article',
                url: 'https://blog.example.com',
                faviconDataUrl: '',
                isActive: false,
                isDiscarded: true,
                isAudible: false,
                isMuted: false
              }
            ]
          });
        }
      }
    );

    await import('./edgeTrigger');
    await new Promise((r) => setTimeout(r, 15));

    const root = capturedShadowRoots[0];
    const sensor = root.querySelector('div.arctic-hover-sensor') as HTMLDivElement;
    const rail = root.querySelector('aside.arctic-rail') as HTMLElement;
    const list = root.querySelector('div.arctic-qa-list') as HTMLDivElement;
    const track = root.querySelector('div.arctic-scroll-track') as HTMLDivElement;
    const thumb = root.querySelector('div.arctic-scroll-thumb') as HTMLDivElement;

    // Expand rail via hover sensor
    sensor.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(rail.getAttribute('data-expanded')).toBe('true');

    // Today's Tabs rendered below Quick Access with separator and status attributes
    const separators = list.querySelectorAll('div.arctic-section-sep');
    expect(separators.length).toBe(1);

    const hnBtn = list.querySelector('button[data-section="today"][data-tab-id="777"]') as HTMLButtonElement;
    const sleepBtn = list.querySelector('button[data-section="today"][data-tab-id="778"]') as HTMLButtonElement;
    expect(hnBtn).not.toBeNull();
    expect(hnBtn.getAttribute('data-active')).toBe('true');
    expect(hnBtn.querySelector('.arctic-audio-dot')).not.toBeNull();
    expect(sleepBtn.getAttribute('data-discarded')).toBe('true');

    // Single-click activates Today tab
    mockChrome.runtime.sendMessage.mockClear();
    sleepBtn.click();
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'ACTIVATE_TODAY_TAB_FROM_EDGE', tabId: 778, forceReload: false },
      expect.any(Function)
    );

    // Double-click reloads Today tab
    mockChrome.runtime.sendMessage.mockClear();
    hnBtn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'ACTIVATE_TODAY_TAB_FROM_EDGE', tabId: 777, forceReload: true },
      expect.any(Function)
    );

    // Middle-click closes Today tab
    mockChrome.runtime.sendMessage.mockClear();
    sleepBtn.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'CLOSE_TODAY_TAB_FROM_EDGE', tabId: 778 },
      expect.any(Function)
    );

    // Simulate vertical overflow on list container for Option A overlay scrollbar
    let currentScrollTop = 0;
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => 600 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(list, 'scrollTop', {
      configurable: true,
      get: () => currentScrollTop,
      set: (val: number) => {
        currentScrollTop = val;
      }
    });

    list.dispatchEvent(new Event('scroll'));
    expect(track.getAttribute('data-scrollable')).toBe('true');
    expect(list.getAttribute('data-can-scroll-up')).toBe('false');
    expect(list.getAttribute('data-can-scroll-down')).toBe('true');
    expect(parseFloat(thumb.style.height)).toBeGreaterThanOrEqual(24);

    // Dragging the scrollbar thumb updates scrollTop AND keeps hover rail expanded even when cursor drifts outside 40px zone
    const PointerEv = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
    thumb.dispatchEvent(
      new PointerEv('pointerdown', { button: 0, clientX: 34, clientY: 20, bubbles: true })
    );
    expect(track.getAttribute('data-dragging')).toBe('true');

    window.dispatchEvent(
      new PointerEv('pointermove', { clientX: 180, clientY: 90, bubbles: true })
    );
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 180, clientY: 90, bubbles: true })
    );

    expect(currentScrollTop).toBeGreaterThan(100);
    expect(list.getAttribute('data-can-scroll-up')).toBe('true');
    await new Promise((r) => setTimeout(r, 200));
    // Must remain expanded while dragging scrollbar!
    expect(rail.getAttribute('data-expanded')).toBe('true');

    // Releasing pointer outside the rail schedules normal hover collapse
    window.dispatchEvent(new PointerEv('pointerup', { clientX: 180, clientY: 90, bubbles: true }));
    expect(track.getAttribute('data-dragging')).toBe('false');
    await new Promise((r) => setTimeout(r, 200));
    expect(rail.getAttribute('data-expanded')).toBe('false');
  });

  it('synchronizes push-mode open and close transitions with viewport resize frames to prevent opposite-direction page bounce', async () => {
    const origInnerWidth = window.innerWidth;
    let mockViewportWidth = 1440;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      get: () => mockViewportWidth
    });
    const rectSpy = vi
      .spyOn(document.documentElement, 'getBoundingClientRect')
      .mockImplementation(
        () =>
          ({
            width: mockViewportWidth,
            height: 900,
            top: 0,
            left: 0,
            right: mockViewportWidth,
            bottom: 900,
            x: 0,
            y: 0,
            toJSON: () => ({})
          }) as DOMRect
      );

    try {
      mockChrome.__setLocalStorage({
        edgeTriggerEnabled: true,
        edgeTriggerMode: 'push',
        sidebarDockSide: 'left'
      });

      mockChrome.runtime.onMessage.addListener(
        (
          msg: unknown,
          _sender: chrome.runtime.MessageSender,
          sendResponse: (resp?: unknown) => void
        ) => {
          const m = msg as { type?: string };
          if (m?.type === 'GET_EDGE_TRIGGER_STATE') {
            sendResponse({
              windowId: 10,
              openWindowIds: [],
              edgeTriggerEnabled: true,
              side: 'left',
              mode: 'push',
              quickAccessItems: []
            });
          } else if (m?.type === 'OPEN_SIDE_PANEL_FROM_EDGE') {
            sendResponse({ ok: true });
          }
        }
      );

      await import('./edgeTrigger');
      await new Promise((r) => setTimeout(r, 15));

      expect(document.documentElement.getAttribute('data-arctic-edge-push')).toBe('left');
      const root = capturedShadowRoots[0];
      const rail = root.querySelector('aside.arctic-rail') as HTMLElement;
      const expandBtn = root.querySelector('button.arctic-expand-btn') as HTMLButtonElement;

      // 1. Opening: clicking Expand holds the 36px push while sidepanel.html boots (viewport still 1440px)
      expandBtn.click();
      await chrome.storage.session.set({ openSidePanelWindowIds: [10] });

      expect(document.documentElement.getAttribute('data-arctic-edge-push')).toBe('left');
      expect(document.getElementById('arctic-edge-trigger-host')).not.toBeNull();
      expect(rail.getAttribute('data-opening')).toBe('true');

      // First physical frame where Chrome's Side Panel enters viewport (1440 -> 1390 -> 1120)
      mockViewportWidth = 1390;
      window.dispatchEvent(new Event('resize'));

      expect(document.documentElement.getAttribute('data-arctic-edge-push')).toBeNull();
      expect(document.getElementById('arctic-edge-trigger-host')).toBeNull();

      mockViewportWidth = 1120;
      window.dispatchEvent(new Event('resize'));

      // 2. Closing: receiving visibility close BEFORE Chrome's first close resize frame holds off mounting 36px push
      await chrome.storage.session.set({ openSidePanelWindowIds: [] });
      expect(document.documentElement.getAttribute('data-arctic-edge-push')).toBeNull();
      expect(document.getElementById('arctic-edge-trigger-host')).toBeNull();

      // First physical frame where Chrome's Side Panel begins shrinking (1120 -> 1170) mounts 36px push in lockstep
      mockViewportWidth = 1170;
      window.dispatchEvent(new Event('resize'));

      expect(document.documentElement.getAttribute('data-arctic-edge-push')).toBe('left');
      expect(document.getElementById('arctic-edge-trigger-host')).not.toBeNull();
    } finally {
      rectSpy.mockRestore();
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: origInnerWidth
      });
    }
  });
});
