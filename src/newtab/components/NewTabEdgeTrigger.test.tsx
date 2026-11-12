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
});
