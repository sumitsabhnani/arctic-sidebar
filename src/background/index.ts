import { normalizeUrl } from '../sidepanel/utils/url';
import type { SessionState, TabBinding } from '../types';

// Configure side panel behavior on installation & startup
chrome.runtime.onInstalled.addListener(async () => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  // Ensure storage.session is accessible to extension contexts
  if (chrome.storage.session && 'setAccessLevel' in chrome.storage.session) {
    try {
      await chrome.storage.session.setAccessLevel({
        accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'
      });
    } catch (err) {
      console.warn('[Arctic Background] Could not set session access level:', err);
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

/**
 * Helper to fetch session state safely
 */
async function getSessionState(): Promise<SessionState> {
  try {
    const data = await chrome.storage.session.get(['bindingsByBookmarkId', 'bookmarkIdByTabId']);
    return {
      bindingsByBookmarkId: (data.bindingsByBookmarkId as Record<string, TabBinding>) || {},
      bookmarkIdByTabId: (data.bookmarkIdByTabId as Record<number, string>) || {}
    };
  } catch (err) {
    console.error('[Arctic Background] Error reading session state:', err);
    return {
      bindingsByBookmarkId: {},
      bookmarkIdByTabId: {}
    };
  }
}

/**
 * Helper to persist session state
 */
async function saveSessionState(state: SessionState): Promise<void> {
  try {
    await chrome.storage.session.set({
      bindingsByBookmarkId: state.bindingsByBookmarkId,
      bookmarkIdByTabId: state.bookmarkIdByTabId
    });
  } catch (err) {
    console.error('[Arctic Background] Error saving session state:', err);
  }
}

/**
 * Handle tab removal: unbind closed tab from bookmark
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getSessionState();
  const bookmarkId = session.bookmarkIdByTabId[tabId];

  if (bookmarkId) {
    delete session.bookmarkIdByTabId[tabId];
    delete session.bindingsByBookmarkId[bookmarkId];
    await saveSessionState(session);
  }
});

/**
 * Handle tab replacement (e.g. Chrome prerendering swap)
 */
chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  const session = await getSessionState();
  const bookmarkId = session.bookmarkIdByTabId[removedTabId];

  if (bookmarkId) {
    const existingBinding = session.bindingsByBookmarkId[bookmarkId];
    if (existingBinding) {
      existingBinding.tabId = addedTabId;
    }
    delete session.bookmarkIdByTabId[removedTabId];
    session.bookmarkIdByTabId[addedTabId] = bookmarkId;
    await saveSessionState(session);
  }
});

/**
 * Handle tab navigation & status update
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete' && !changeInfo.title) {
    return;
  }

  const session = await getSessionState();
  const bookmarkId = session.bookmarkIdByTabId[tabId];

  if (!bookmarkId) return;

  const binding = session.bindingsByBookmarkId[bookmarkId];
  if (!binding) return;

  let hasChanged = false;

  if (tab.url && tab.url !== binding.currentUrl) {
    binding.currentUrl = tab.url;
    binding.isNavigatedAway = normalizeUrl(tab.url) !== normalizeUrl(binding.originalUrl);
    hasChanged = true;
  }

  if (tab.title && tab.title !== binding.currentTitle) {
    binding.currentTitle = tab.title;
    hasChanged = true;
  }

  if (hasChanged) {
    session.bindingsByBookmarkId[bookmarkId] = binding;
    await saveSessionState(session);
  }
});
