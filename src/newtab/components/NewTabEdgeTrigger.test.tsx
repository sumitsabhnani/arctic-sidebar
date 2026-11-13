import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NewTabEdgeTrigger } from './NewTabEdgeTrigger';
import { mockChrome } from '../../test/setup';

describe('NewTabEdgeTrigger component', () => {
  it('renders only when edgeTriggerEnabled is true and sidebar is closed in window, and opens sidePanel on click', async () => {
    mockChrome.__setLocalStorage({
      edgeTriggerEnabled: true,
      sidebarDockSide: 'left'
    });
    mockChrome.__setSessionStorage({ openSidePanelWindowIds: [] });

    const winIdRef = { current: 10 } as React.MutableRefObject<number | null>;
    render(<NewTabEdgeTrigger theme="dark" colorTheme="glacier-blue" windowIdRef={winIdRef} />);

    const rail = await screen.findByTestId('newtab-edge-trigger');
    expect(rail).toBeInTheDocument();

    const expandBtn = screen.getByLabelText('Show Arctic Sidebar');
    expect(expandBtn).toBeInTheDocument();

    // Clicking the Expand button opens native sidePanel for windowId 10
    await act(async () => {
      fireEvent.click(expandBtn);
    });
    expect(mockChrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 10 });
  });

  it('renders Quick Access icons and activates bound tabs without reopening the full sidebar', async () => {
    mockChrome.__setLocalStorage({
      edgeTriggerEnabled: true,
      sidebarDockSide: 'left'
    });
    mockChrome.__setSessionStorage({ openSidePanelWindowIds: [] });

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
                id: 'qa-github',
                title: 'GitHub',
                url: 'https://github.com',
                faviconDataUrl: '',
                isActive: false,
                isOpen: true,
                isNavigatedAway: false
              }
            ]
          });
        }
      }
    );

    const winIdRef = { current: 10 } as React.MutableRefObject<number | null>;
    render(<NewTabEdgeTrigger theme="dark" colorTheme="glacier-blue" windowIdRef={winIdRef} />);

    const qaBtn = await screen.findByLabelText('GitHub');
    expect(qaBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(qaBtn);
    });

    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'ACTIVATE_QUICK_ACCESS_FROM_EDGE',
      bookmarkId: 'qa-github',
      windowId: 10,
      forceReset: false
    });
    expect(mockChrome.sidePanel.open).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.doubleClick(qaBtn);
    });

    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'ACTIVATE_QUICK_ACCESS_FROM_EDGE',
      bookmarkId: 'qa-github',
      windowId: 10,
      forceReset: true
    });
  });

  it('hides automatically when openSidePanelWindowIds includes current windowId', async () => {
    mockChrome.__setLocalStorage({ edgeTriggerEnabled: true });
    mockChrome.__setSessionStorage({ openSidePanelWindowIds: [10] });

    const winIdRef = { current: 10 } as React.MutableRefObject<number | null>;
    render(<NewTabEdgeTrigger theme="light" colorTheme="pure-monochrome" windowIdRef={winIdRef} />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

    expect(screen.queryByTestId('newtab-edge-trigger')).not.toBeInTheDocument();

    // When window 10 closes its side panel, trigger appears
    await act(async () => {
      await chrome.storage.session.set({ openSidePanelWindowIds: [] });
    });
    expect(await screen.findByTestId('newtab-edge-trigger')).toBeInTheDocument();
  });

  it('renders Space tabs and click-to-open Folder flyout alongside Quick Access with a separator', async () => {
    mockChrome.__setLocalStorage({ edgeTriggerEnabled: true, sidebarDockSide: 'left' });
    mockChrome.__setSessionStorage({ openSidePanelWindowIds: [] });

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
                id: 'qa-gh',
                title: 'GitHub',
                url: 'https://github.com',
                faviconDataUrl: '',
                isActive: false,
                isOpen: true,
                isNavigatedAway: false
              }
            ],
            spaceItems: [
              {
                type: 'bookmark',
                id: 'sp-lin',
                title: 'Linear',
                url: 'https://linear.app',
                faviconDataUrl: '',
                isActive: false,
                isOpen: false,
                isNavigatedAway: false
              },
              {
                type: 'folder',
                id: 'f-specs',
                title: 'Specs',
                hasActiveChild: false,
                hasOpenChild: false,
                hasNavigatedAwayChild: false,
                itemCount: 1,
                children: [
                  {
                    type: 'bookmark',
                    id: 'f-prd',
                    title: 'Product Spec',
                    url: 'https://docs.google.com/prd',
                    faviconDataUrl: '',
                    isActive: false,
                    isOpen: false,
                    isNavigatedAway: false
                  }
                ]
              }
            ]
          });
        }
      }
    );

    const winIdRef = { current: 10 } as React.MutableRefObject<number | null>;
    render(<NewTabEdgeTrigger theme="dark" colorTheme="glacier-blue" windowIdRef={winIdRef} />);

    expect(await screen.findByLabelText('GitHub')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(screen.getByLabelText('Linear')).toBeInTheDocument();

    const folderBtn = screen.getByLabelText('Specs');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    // Click folder -> opens flyout menu
    await act(async () => {
      fireEvent.click(folderBtn);
    });
    expect(screen.getByRole('menu', { name: 'Specs' })).toBeInTheDocument();
    expect(screen.getByText('Product Spec')).toBeInTheDocument();

    // Press Escape -> closes flyout menu
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    // Reopen folder and click 'Product Spec' -> activates bookmark and closes flyout
    await act(async () => {
      fireEvent.click(folderBtn);
    });
    mockChrome.runtime.sendMessage.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByText('Product Spec'));
    });

    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'ACTIVATE_QUICK_ACCESS_FROM_EDGE',
      bookmarkId: 'f-prd',
      windowId: 10,
      forceReset: false
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('applies 36px root padding in push mode and removes it when sidePanel opens or when switched to hover mode', async () => {
    mockChrome.__setLocalStorage({
      edgeTriggerEnabled: true,
      edgeTriggerMode: 'push',
      sidebarDockSide: 'left'
    });
    mockChrome.__setSessionStorage({ openSidePanelWindowIds: [] });

    const winIdRef = { current: 10 } as React.MutableRefObject<number | null>;
    render(<NewTabEdgeTrigger theme="dark" colorTheme="glacier-blue" windowIdRef={winIdRef} />);

    const rail = await screen.findByTestId('newtab-edge-trigger');
    expect(rail).toHaveAttribute('data-mode', 'push');
    expect(document.documentElement.style.paddingLeft).toBe('36px');

    // Switch to hover mode -> removes 36px push and collapses rail until edge sensor is hovered
    await act(async () => {
      await chrome.storage.local.set({ edgeTriggerMode: 'hover' });
    });

    expect(document.documentElement.style.paddingLeft).toBe('');
    expect(rail).toHaveAttribute('data-mode', 'hover');
    expect(rail).toHaveAttribute('data-expanded', 'false');

    const sensor = screen.getByTestId('newtab-edge-hover-sensor');
    await act(async () => {
      fireEvent.mouseEnter(sensor);
    });
    expect(rail).toHaveAttribute('data-expanded', 'true');

    // Moving cursor away from edge collapses rail on first hover-out even without rail.mouseLeave
    await act(async () => {
      fireEvent.mouseMove(window, { clientX: 140, clientY: 200 });
      await new Promise((r) => setTimeout(r, 180));
    });
    expect(rail).toHaveAttribute('data-expanded', 'false');

    // Switch back to push and open sidePanel -> padding resets cleanly when hidden
    await act(async () => {
      await chrome.storage.local.set({ edgeTriggerMode: 'push' });
    });
    expect(document.documentElement.style.paddingLeft).toBe('36px');

    await act(async () => {
      await chrome.storage.session.set({ openSidePanelWindowIds: [10] });
    });
    expect(document.documentElement.style.paddingLeft).toBe('');
  });

  it('renders Today Tabs with click, double-click, and middle-click close, and supports Option A overlay scrollbar drag without collapsing hover mode', async () => {
    mockChrome.__setLocalStorage({
      edgeTriggerEnabled: true,
      edgeTriggerMode: 'hover',
      sidebarDockSide: 'left'
    });
    mockChrome.__setSessionStorage({ openSidePanelWindowIds: [] });

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
                id: 'qa-gh',
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
                tabId: 501,
                title: 'Arctic PR Review',
                url: 'https://github.com/org/repo/pull/20',
                faviconDataUrl: '',
                isActive: true,
                isDiscarded: false,
                isAudible: true,
                isMuted: false
              },
              {
                tabId: 502,
                title: 'Design Notes',
                url: 'https://notion.so/design',
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

    const winIdRef = { current: 10 } as React.MutableRefObject<number | null>;
    render(<NewTabEdgeTrigger theme="dark" colorTheme="glacier-blue" windowIdRef={winIdRef} />);

    const sensor = await screen.findByTestId('newtab-edge-hover-sensor');
    await act(async () => {
      fireEvent.mouseEnter(sensor);
    });

    const rail = screen.getByTestId('newtab-edge-trigger');
    expect(rail).toHaveAttribute('data-expanded', 'true');

    const prTabBtn = screen.getByLabelText('Arctic PR Review');
    const notesTabBtn = screen.getByLabelText('Design Notes');
    expect(prTabBtn).toHaveAttribute('data-section', 'today');
    expect(notesTabBtn).toHaveAttribute('data-discarded', 'true');

    // Click -> activates Today tab
    mockChrome.runtime.sendMessage.mockClear();
    await act(async () => {
      fireEvent.click(notesTabBtn);
    });
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'ACTIVATE_TODAY_TAB_FROM_EDGE',
      tabId: 502,
      windowId: 10,
      forceReload: false
    });

    // Double-click -> activates & reloads Today tab
    mockChrome.runtime.sendMessage.mockClear();
    await act(async () => {
      fireEvent.doubleClick(prTabBtn);
    });
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'ACTIVATE_TODAY_TAB_FROM_EDGE',
      tabId: 501,
      windowId: 10,
      forceReload: true
    });

    // Middle-click (auxClick button=1) -> closes Today tab
    mockChrome.runtime.sendMessage.mockClear();
    await act(async () => {
      fireEvent(
        notesTabBtn,
        new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })
      );
    });
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'CLOSE_TODAY_TAB_FROM_EDGE',
      tabId: 502,
      windowId: 10
    });

    // Mock vertical overflow on scroll list for Option A overlay scrollbar
    const list = screen.getByTestId('newtab-edge-scroll-list');
    const track = screen.getByTestId('newtab-edge-scroll-track');
    const thumb = screen.getByTestId('newtab-edge-scroll-thumb');

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

    await act(async () => {
      fireEvent.scroll(list);
    });
    expect(track).toHaveAttribute('data-scrollable', 'true');
    expect(list).toHaveAttribute('data-can-scroll-up', 'false');
    expect(list).toHaveAttribute('data-can-scroll-down', 'true');

    // Drag thumb and move cursor well past 40px hover zone -> scrollTop updates and rail stays expanded
    await act(async () => {
      fireEvent.pointerDown(thumb, { button: 0, clientX: 34, clientY: 20 });
    });
    expect(track).toHaveAttribute('data-dragging', 'true');

    await act(async () => {
      fireEvent.pointerMove(window, { clientX: 180, clientY: 95 });
      fireEvent.mouseMove(window, { clientX: 180, clientY: 95 });
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(currentScrollTop).toBeGreaterThan(100);
    expect(list).toHaveAttribute('data-can-scroll-up', 'true');
    expect(rail).toHaveAttribute('data-expanded', 'true');

    // Release pointer outside rail -> collapses after hover timeout
    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 180, clientY: 95 });
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(track).toHaveAttribute('data-dragging', 'false');
    expect(rail).toHaveAttribute('data-expanded', 'false');
  });
});
