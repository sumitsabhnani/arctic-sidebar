import {
  doesTabUrlMatchBookmark,
  getEffectiveTabUrl,
  isScratchpadUrl,
  isUrlNavigatedAway,
  normalizeUrl
} from '../sidepanel/utils/url';
import {
  fetchAllArcticBookmarkNodes,
  findMatchingUnboundTabForBookmark,
  getPersistedBindings,
  isArcticCommandTab,
  reconcileTabsAndBookmarksState,
  removePersistedBindings,
  upsertPersistedBindings
} from '../sidepanel/utils/reconcileBindings';
import {
  QUICK_ACCESS_FOLDER_NAME,
  type EdgeBookmarkNode,
  type EdgeFolderNode,
  type EdgeQuickAccessItem,
  type EdgeRailData,
  type EdgeSpaceNode,
  type SessionState,
  type SpaceItem,
  type TabBinding,
  type TabReminder
} from '../types';
import {
  getStoredReminders,
  saveStoredReminders,
  updateBadgeCount,
  REMINDERS_STORAGE_KEY
} from '../sidepanel/utils/reminderStorage';
import { reconcileScratchpadStorageAndBookmark } from '../sidepanel/hooks/useScratchpad';
import { closeInactiveArcticCommandTabs } from '../sidepanel/hooks/useTabBindings';

let sessionLock: Promise<void> = Promise.resolve();

function withSessionLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = sessionLock.then(fn, fn);
  sessionLock = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

// Configure side panel behavior on installation & startup
export async function handleInstalled(): Promise<void> {
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

  // Reconcile scratchpad backup bookmark & storage on install / update
  await reconcileScratchpadStorageAndBookmark();

  // Reconcile open/sleeping browser tabs with bookmarks across all Spaces
  await reconcileTabBindingsInBackground();

  // Sync side panel dock side & dynamic edge trigger content script
  await syncSidePanelLayoutSide();
  await syncEdgeTriggerContentScript(true);

  // Reconcile and schedule alarms on installation
  await reconcileReminders();
}

export async function handleStartup(): Promise<void> {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  // Ensure storage.session is accessible to extension contexts
  if (chrome.storage.session && 'setAccessLevel' in chrome.storage.session) {
    try {
      await chrome.storage.session.setAccessLevel({
        accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'
      });
    } catch {
      // ignore
    }
  }

  // Reconcile scratchpad backup bookmark & storage on startup
  await reconcileScratchpadStorageAndBookmark();

  // Reconcile open/sleeping browser tabs with bookmarks across all Spaces
  await reconcileTabBindingsInBackground();

  // Sync side panel dock side & dynamic edge trigger content script
  await syncSidePanelLayoutSide();
  await syncEdgeTriggerContentScript(true);

  // Reconcile and schedule alarms on startup
  await reconcileReminders();
}

chrome.runtime.onInstalled.addListener(handleInstalled);
chrome.runtime.onStartup.addListener(handleStartup);

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
 * Reconciles open/sleeping tabs against bookmarks across all Spaces in background
 * (runs on browser startup, extension install/reload, and sleeping/session-restored tab arrival).
 */
export async function reconcileTabBindingsInBackground(): Promise<void> {
  if (!chrome.tabs?.query || !chrome.storage?.session) return;

  await withSessionLock(async () => {
    try {
      const [bookmarkNodes, allOpenTabs, session, persistedBindings] = await Promise.all([
        fetchAllArcticBookmarkNodes(),
        chrome.tabs.query({}),
        getSessionState(),
        getPersistedBindings()
      ]);

      let preferredWindowId: number | null = null;
      if (chrome.windows?.getCurrent) {
        try {
          const win = await chrome.windows.getCurrent();
          if (typeof win?.id === 'number') {
            preferredWindowId = win.id;
          }
        } catch {
          // ignore
        }
      }

      const result = reconcileTabsAndBookmarksState({
        bookmarkNodes,
        allOpenTabs,
        preferredWindowId,
        currentBindings: session.bindingsByBookmarkId,
        currentByTab: session.bookmarkIdByTabId,
        persistedBindings
      });

      if (result.changed) {
        await saveSessionState({
          bindingsByBookmarkId: result.bindingsByBookmarkId,
          bookmarkIdByTabId: result.bookmarkIdByTabId
        });
        await upsertPersistedBindings(result.bindingsByBookmarkId);
        scheduleEdgeItemsBroadcast();
      }
    } catch (err) {
      console.warn('[Arctic Background] Error reconciling tab bindings:', err);
    }
  });
}

let backgroundReconcileQueued = false;
function scheduleBackgroundReconcile(): void {
  if (backgroundReconcileQueued) return;
  backgroundReconcileQueued = true;
  Promise.resolve().then(() => {
    backgroundReconcileQueued = false;
    void reconcileTabBindingsInBackground();
  });
}

/**
 * Handle tab removal: unbind closed tab from bookmark (preserving persistedBindings on browser/window close)
 */
export async function handleTabRemoved(
  tabId: number,
  removeInfo?: chrome.tabs.TabRemoveInfo
): Promise<void> {
  await withSessionLock(async () => {
    const session = await getSessionState();
    const bookmarkId = session.bookmarkIdByTabId[tabId];

    if (bookmarkId) {
      delete session.bookmarkIdByTabId[tabId];
      delete session.bindingsByBookmarkId[bookmarkId];
      await saveSessionState(session);
      if (!removeInfo?.isWindowClosing) {
        await removePersistedBindings([bookmarkId]);
      }
      scheduleEdgeItemsBroadcast(removeInfo?.windowId);
    }
  });
}

chrome.tabs.onRemoved.addListener(handleTabRemoved);

/**
 * Handle tab activation: close any unfocused empty Arctic Command / New Tab pages in the window
 */
export async function handleTabActivated(
  activeInfo: chrome.tabs.TabActiveInfo
): Promise<void> {
  const session = await getSessionState();
  await closeInactiveArcticCommandTabs(
    activeInfo.windowId,
    activeInfo.tabId,
    session.bookmarkIdByTabId
  );
  scheduleEdgeItemsBroadcast(activeInfo.windowId);
}

if (chrome.tabs && chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener(handleTabActivated);
}

/**
 * Handle active tab creation: close any previously open empty Arctic Command / New Tab pages
 * and reconcile session-restored sleeping tabs if created after startup.
 */
export async function handleTabCreated(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.active && typeof tab.id === 'number' && typeof tab.windowId === 'number') {
    const session = await getSessionState();
    await closeInactiveArcticCommandTabs(
      tab.windowId,
      tab.id,
      session.bookmarkIdByTabId
    );
  }

  if (
    typeof tab.id === 'number' &&
    Boolean(tab.discarded) &&
    tab.openerTabId === undefined &&
    !isArcticCommandTab(tab) &&
    Boolean(getEffectiveTabUrl(tab))
  ) {
    scheduleBackgroundReconcile();
  }
}

if (chrome.tabs && chrome.tabs.onCreated) {
  chrome.tabs.onCreated.addListener(handleTabCreated);
}

/**
 * Handle tab replacement (e.g. Chrome sleeping/discarded tab wake or prerendering swap)
 */
export async function handleTabReplaced(
  addedTabId: number,
  removedTabId: number
): Promise<void> {
  if (addedTabId === removedTabId) return;

  await withSessionLock(async () => {
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

    if (chrome.storage?.local?.get && chrome.storage?.local?.set) {
      try {
        const local = await chrome.storage.local.get(['tabSpaceByTabId', 'tabOpenedAt']);
        const updates: Record<string, unknown> = {};

        const tabSpaces = local.tabSpaceByTabId as Record<number, string> | undefined;
        if (tabSpaces && tabSpaces[removedTabId]) {
          const nextSpaces = { ...tabSpaces, [addedTabId]: tabSpaces[removedTabId] };
          delete nextSpaces[removedTabId];
          updates.tabSpaceByTabId = nextSpaces;
        }

        const tabOpenedAt = local.tabOpenedAt as Record<number, number> | undefined;
        if (tabOpenedAt && tabOpenedAt[removedTabId]) {
          const nextTimestamps = { ...tabOpenedAt, [addedTabId]: tabOpenedAt[removedTabId] };
          delete nextTimestamps[removedTabId];
          updates.tabOpenedAt = nextTimestamps;
        }

        if (Object.keys(updates).length > 0) {
          await chrome.storage.local.set(updates);
        }
      } catch {
        // ignore
      }
    }
  });
}

chrome.tabs.onReplaced.addListener(handleTabReplaced);

/**
 * Handle tab navigation & status update
 */
export async function handleTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
): Promise<void> {
  if (
    !changeInfo.url &&
    changeInfo.status !== 'complete' &&
    !changeInfo.title &&
    !tab.pendingUrl
  ) {
    return;
  }

  await withSessionLock(async () => {
    const session = await getSessionState();
    const bookmarkId = session.bookmarkIdByTabId[tabId];

    if (!bookmarkId) {
      if (
        Boolean(tab.discarded) &&
        tab.openerTabId === undefined &&
        !isArcticCommandTab(tab) &&
        Boolean(changeInfo.url || getEffectiveTabUrl(tab))
      ) {
        scheduleBackgroundReconcile();
      }
      return;
    }

    const binding = session.bindingsByBookmarkId[bookmarkId];
    if (!binding) return;

    let hasChanged = false;
    const effectiveUrl = changeInfo.url || getEffectiveTabUrl(tab);

    if (effectiveUrl && effectiveUrl !== binding.currentUrl) {
      binding.currentUrl = effectiveUrl;
      binding.isNavigatedAway = isUrlNavigatedAway(effectiveUrl, binding.originalUrl);
      hasChanged = true;
    }

    const nextTitle = changeInfo.title || tab.title;
    if (nextTitle && nextTitle !== binding.currentTitle) {
      binding.currentTitle = nextTitle;
      hasChanged = true;
    }

    if (hasChanged) {
      session.bindingsByBookmarkId[bookmarkId] = binding;
      await saveSessionState(session);
      await upsertPersistedBindings({ [bookmarkId]: binding });
      scheduleEdgeItemsBroadcast(tab.windowId);
    }
  });
}

chrome.tabs.onUpdated.addListener(handleTabUpdated);

/* -------------------------------------------------------------
   TAB REMINDERS SERVICE WORKER LIFECYCLE (chrome.alarms)
   ------------------------------------------------------------- */

let alarmLock: Promise<void> = Promise.resolve();
const recentlyNotified = new Map<string, number>();

/**
 * Trigger native browser notification for a due/overdue reminder
 */
export async function showReminderNotification(reminder: TabReminder): Promise<void> {
  const lastNotified = recentlyNotified.get(reminder.id);
  const now = Date.now();
  if (lastNotified && now - lastNotified < 10000) {
    // Already notified within the last 10 seconds, avoid duplicate notification
    return;
  }
  recentlyNotified.set(reminder.id, now);
  if (recentlyNotified.size > 100) {
    for (const [id, time] of recentlyNotified.entries()) {
      if (now - time > 60000) recentlyNotified.delete(id);
    }
  }

  if (!chrome.notifications || !chrome.notifications.create) return;
  try {
    await chrome.notifications.create(`notif:${reminder.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: `Reminder: ${reminder.title}`,
      message: reminder.note || 'Time to check this tab',
      priority: 2,
      requireInteraction: true,
      buttons: [
        { title: 'Open Tab' },
        { title: 'Dismiss' }
      ]
    });
  } catch (err) {
    console.error('[Arctic Background] Failed to create notification:', err);
  }
}

/**
 * Handle Alarm Trigger: mark status 'fired', display notification, update badge
 * Safely serialized via alarmLock mutex to prevent read-modify-write race conditions,
 * and batches all simultaneous/due reminders together.
 */
export async function handleAlarmTrigger(alarm: chrome.alarms.Alarm): Promise<void> {
  if (!alarm.name || !alarm.name.startsWith('reminder:')) return;
  const reminderId = alarm.name.slice('reminder:'.length);

  alarmLock = alarmLock.then(async () => {
    try {
      const reminders = await getStoredReminders();
      const now = Date.now();
      const dueToNotify: TabReminder[] = [];
      let hasUpdates = false;

      for (const r of reminders) {
        const isTarget = r.id === reminderId;
        const isDue = r.status === 'scheduled' && r.triggerAt <= now + 2000;

        if (isTarget || isDue) {
          if (r.status !== 'fired') {
            r.status = 'fired';
            hasUpdates = true;
          }
          dueToNotify.push(r);
        }
      }

      if (hasUpdates) {
        await saveStoredReminders(reminders);
        await updateBadgeCount(reminders);
      }

      for (const r of dueToNotify) {
        await showReminderNotification(r);
      }
    } catch (err) {
      console.error('[Arctic Background] Error handling alarm trigger:', err);
    }
  });

  await alarmLock;
}

if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener(handleAlarmTrigger);
}

/**
 * Handle Notification Clicks: Focus or open tab, remove reminder, clear notification
 */
export async function handleNotificationOpenTab(reminderId: string): Promise<void> {
  try {
    const reminders = await getStoredReminders();
    const reminder = reminders.find((r) => r.id === reminderId);

    if (reminder) {
      const tabs = await chrome.tabs.query({});
      const targetNormalized = normalizeUrl(reminder.url);

      const matchingTab = tabs.find((t) => {
        if (typeof reminder.tabId === 'number' && t.id === reminder.tabId) {
          return true;
        }
        const effectiveUrl = getEffectiveTabUrl(t);
        if (
          effectiveUrl &&
          (normalizeUrl(effectiveUrl) === targetNormalized ||
            doesTabUrlMatchBookmark(effectiveUrl, reminder.url))
        ) {
          return true;
        }
        return false;
      });

      if (matchingTab && typeof matchingTab.id === 'number') {
        if (typeof matchingTab.windowId === 'number') {
          try {
            await chrome.windows.update(matchingTab.windowId, { focused: true });
          } catch {
            // ignore
          }
        }
        await chrome.tabs.update(matchingTab.id, { active: true });
      } else {
        await chrome.tabs.create({ url: reminder.url, active: true });
      }
    }
  } catch (err) {
    console.warn('[Arctic Background] Could not focus/open tab for reminder:', err);
  }

  await handleNotificationDismiss(reminderId);
}

/**
 * Dismiss Notification: Remove from storage, clear notification, update badge
 */
export async function handleNotificationDismiss(reminderId: string): Promise<void> {
  try {
    const notifId = `notif:${reminderId}`;
    if (chrome.notifications && chrome.notifications.clear) {
      await chrome.notifications.clear(notifId);
    }

    const reminders = await getStoredReminders();
    const filtered = reminders.filter((r) => r.id !== reminderId);
    await saveStoredReminders(filtered);
    await updateBadgeCount(filtered);
  } catch (err) {
    console.error('[Arctic Background] Error dismissing reminder:', err);
  }
}

if (chrome.notifications) {
  if (chrome.notifications.onButtonClicked) {
    chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
      if (notificationId.startsWith('notif:')) {
        const reminderId = notificationId.slice('notif:'.length);
        if (buttonIndex === 0) {
          await handleNotificationOpenTab(reminderId);
        } else {
          await handleNotificationDismiss(reminderId);
        }
      }
    });
  }

  if (chrome.notifications.onClicked) {
    chrome.notifications.onClicked.addListener(async (notificationId) => {
      if (notificationId.startsWith('notif:')) {
        const reminderId = notificationId.slice('notif:'.length);
        await handleNotificationOpenTab(reminderId);
      }
    });
  }
}

/**
 * Startup Reconciliation: Check scheduled reminders; fire if overdue, otherwise ensure alarm exists
 */
export async function reconcileReminders(): Promise<void> {
  try {
    const reminders = await getStoredReminders();
    let hasChanges = false;
    const now = Date.now();

    for (const reminder of reminders) {
      if (reminder.status === 'scheduled') {
        if (reminder.triggerAt <= now) {
          reminder.status = 'fired';
          hasChanges = true;
          await showReminderNotification(reminder);
        } else if (chrome.alarms && chrome.alarms.create) {
          await chrome.alarms.create(`reminder:${reminder.id}`, { when: reminder.triggerAt });
        }
      }
    }

    if (hasChanges) {
      await saveStoredReminders(reminders);
    }
    await updateBadgeCount(reminders);
  } catch (err) {
    console.error('[Arctic Background] Error reconciling reminders:', err);
  }
}

// Keep badge count and edge trigger registration synced when storage changes
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' || areaName === 'local') {
      if (changes[REMINDERS_STORAGE_KEY]) {
        const newReminders = changes[REMINDERS_STORAGE_KEY].newValue as TabReminder[] | undefined;
        updateBadgeCount(newReminders);
      }
    }
    if (areaName === 'local' && changes.edgeTriggerEnabled !== undefined) {
      const enabled = Boolean(changes.edgeTriggerEnabled.newValue);
      void syncEdgeTriggerContentScript(enabled);
    }
    if (
      areaName === 'local' &&
      (changes.activeSpaceId !== undefined ||
        changes.spaces !== undefined ||
        changes.quickAccessFolderId !== undefined ||
        changes.workspaceFolderId !== undefined)
    ) {
      scheduleEdgeItemsBroadcast();
    }
  });
}

/* -------------------------------------------------------------
   EDGE TRIGGER & SIDE PANEL VISIBILITY TRACKING
   ------------------------------------------------------------- */

export const EDGE_TRIGGER_SCRIPT_ID = 'arctic-edge-trigger';
export const EDGE_TRIGGER_ORIGINS = ['http://*/*', 'https://*/*'];
const SIDEPANEL_PORT_NAME = 'arctic-sidepanel';

// Ensure session storage is always accessible to content scripts even after SW wake/reload
if (chrome.storage?.session && 'setAccessLevel' in chrome.storage.session) {
  chrome.storage.session
    .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
    .catch(() => {});
}

const sidePanelPorts = new Map<chrome.runtime.Port, number>();
const closingGuardUntilByWindow = new Map<number, number>();
const openingGuardUntilByWindow = new Map<number, number>();
const recentlyCollapsedAtByWindow = new Map<number, number>();
const faviconDataCache = new Map<string, string>();
let visibilityLock: Promise<void> = Promise.resolve();
let scriptSyncLock: Promise<void> = Promise.resolve();
let edgeBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
const pendingEdgeBroadcastWinIds = new Set<number | 'ALL'>();

function normalizeShortcutFaviconUrl(pageUrl: string): string {
  try {
    const host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'docs.new' || host === 'document.new') {
      return 'https://docs.google.com/document/';
    }
    if (host === 'sheets.new' || host === 'spreadsheet.new') {
      return 'https://docs.google.com/spreadsheets/';
    }
    if (host === 'slides.new' || host === 'presentation.new') {
      return 'https://docs.google.com/presentation/';
    }
    if (host === 'notion.new') {
      return 'https://www.notion.so/';
    }
    if (host === 'gist.new') {
      return 'https://gist.github.com/';
    }
  } catch {
    // ignore
  }
  return pageUrl;
}

function getCachedFaviconDataUrl(pageUrl: string, boundTabFavIconUrl?: string): string {
  if (!pageUrl) return '';
  const resolvedUrl = normalizeShortcutFaviconUrl(pageUrl);
  const cached = faviconDataCache.get(resolvedUrl);
  if (cached) return cached;
  if (boundTabFavIconUrl && boundTabFavIconUrl.startsWith('data:image/')) {
    if (faviconDataCache.size >= 300) {
      const oldestKey = faviconDataCache.keys().next().value;
      if (oldestKey) faviconDataCache.delete(oldestKey);
    }
    faviconDataCache.set(resolvedUrl, boundTabFavIconUrl);
    return boundTabFavIconUrl;
  }
  return '';
}

async function resolveFaviconDataUrl(
  pageUrl: string,
  boundTabFavIconUrl?: string
): Promise<string> {
  if (!pageUrl) return '';
  const warm = getCachedFaviconDataUrl(pageUrl, boundTabFavIconUrl);
  if (warm) return warm;

  if (typeof fetch !== 'function' || !chrome.runtime?.id) {
    return '';
  }

  const resolvedUrl = normalizeShortcutFaviconUrl(pageUrl);
  try {
    const endpoint = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(
      resolvedUrl
    )}&size=32`;
    const resp = await fetch(endpoint);
    if (!resp || !resp.ok) return '';
    const buf = await resp.arrayBuffer();
    if (!buf || buf.byteLength === 0) return '';
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const mime = resp.headers?.get?.('content-type') || 'image/png';
    const dataUrl = `data:${mime};base64,${btoa(binary)}`;
    if (faviconDataCache.size >= 300) {
      const oldestKey = faviconDataCache.keys().next().value;
      if (oldestKey) faviconDataCache.delete(oldestKey);
    }
    faviconDataCache.set(resolvedUrl, dataUrl);
    return dataUrl;
  } catch {
    return '';
  }
}

function isExcludedInternalBookmarkNode(node: chrome.bookmarks.BookmarkTreeNode): boolean {
  if (isScratchpadUrl(node.url)) return true;
  if (node.title === 'Scratchpad Backup') return true;
  if (!node.url && node.title.trim().toLowerCase() === QUICK_ACCESS_FOLDER_NAME.toLowerCase()) {
    return true;
  }
  return false;
}

async function resolveActiveSpaceBookmarkTrees(): Promise<{
  qaBookmarks: chrome.bookmarks.BookmarkTreeNode[];
  spaceNodes: chrome.bookmarks.BookmarkTreeNode[];
  spaceName: string;
}> {
  if (!chrome.bookmarks) {
    return { qaBookmarks: [], spaceNodes: [], spaceName: 'Home' };
  }

  try {
    const local = await chrome.storage.local.get([
      'spaces',
      'activeSpaceId',
      'quickAccessFolderId',
      'workspaceFolderId'
    ]);
    const spaces = Array.isArray(local.spaces) ? (local.spaces as SpaceItem[]) : [];
    const activeSpaceId = typeof local.activeSpaceId === 'string' ? local.activeSpaceId : 'home';
    const activeSpace = spaces.find((s) => s.id === activeSpaceId) || spaces[0];
    const spaceName = activeSpace?.name || 'Home';

    const candidateSpaceFolderId =
      activeSpace?.folderId ||
      ((!activeSpace || activeSpace.id === 'home') && typeof local.workspaceFolderId === 'string'
        ? local.workspaceFolderId
        : '');

    const candidateQaFolderIds: string[] = [];
    if ((!activeSpace || activeSpace.id === 'home') && typeof local.quickAccessFolderId === 'string') {
      candidateQaFolderIds.push(local.quickAccessFolderId);
    }
    if (activeSpace?.quickAccessFolderId && !candidateQaFolderIds.includes(activeSpace.quickAccessFolderId)) {
      candidateQaFolderIds.push(activeSpace.quickAccessFolderId);
    }

    let spaceTreeNode: chrome.bookmarks.BookmarkTreeNode | undefined;
    if (candidateSpaceFolderId && chrome.bookmarks.getSubTree) {
      try {
        const [sub] = await chrome.bookmarks.getSubTree(candidateSpaceFolderId);
        if (sub) spaceTreeNode = sub;
      } catch {
        // Folder may have been moved/deleted; fall back to full tree lookup below
      }
    }

    let arcticRoot: chrome.bookmarks.BookmarkTreeNode | undefined;
    if (!spaceTreeNode && chrome.bookmarks.getTree) {
      try {
        const tree = await chrome.bookmarks.getTree();
        const root = tree[0];
        const other =
          root?.children?.find((c) => c.id === '2' || c.title.toLowerCase().includes('other')) ||
          root?.children?.[1] ||
          root?.children?.[0];
        arcticRoot = other?.children?.find(
          (c) =>
            !c.url &&
            (c.title === 'Arctic' || c.title === 'Arctic Sidebar' || c.title.includes('Sidebar'))
        );
        if (arcticRoot?.children) {
          const targetSpaceName = (activeSpace?.name || 'home').trim().toLowerCase();
          spaceTreeNode =
            arcticRoot.children.find(
              (c) =>
                !c.url &&
                (c.title.trim().toLowerCase() === targetSpaceName ||
                  (targetSpaceName === 'home' && c.title.trim().toLowerCase() === 'workspace'))
            ) ||
            arcticRoot.children.find(
              (c) =>
                !c.url &&
                (c.title.trim().toLowerCase() === 'home' ||
                  c.title.trim().toLowerCase() === 'workspace')
            );
        }
      } catch {
        // ignore
      }
    }

    let qaBookmarks: chrome.bookmarks.BookmarkTreeNode[] | null = null;
    let resolvedQaFolderId = '';

    // 1. Reuse Quick Access folder already loaded inside spaceTreeNode if ID matches
    if (spaceTreeNode?.children) {
      for (const qaId of candidateQaFolderIds) {
        const matchInSpace = spaceTreeNode.children.find((c) => !c.url && c.id === qaId);
        if (matchInSpace?.children) {
          resolvedQaFolderId = matchInSpace.id;
          qaBookmarks = matchInSpace.children.filter(
            (b) => Boolean(b.url) && !isScratchpadUrl(b.url) && b.title !== 'Scratchpad Backup'
          );
          break;
        }
      }
    }

    // 2. Otherwise query explicit candidate Quick Access folder IDs directly
    if (!qaBookmarks) {
      for (const qaId of candidateQaFolderIds) {
        if (!qaId) continue;
        try {
          const children = await chrome.bookmarks.getChildren(qaId);
          resolvedQaFolderId = qaId;
          qaBookmarks = children.filter(
            (b) => Boolean(b.url) && !isScratchpadUrl(b.url) && b.title !== 'Scratchpad Backup'
          );
          break;
        } catch {
          // continue fallback
        }
      }
    }

    // 3. Fallback to nested 'Quick Access' subfolder inside spaceTreeNode or Arctic root
    if (!qaBookmarks && spaceTreeNode?.children) {
      const nestedQa = spaceTreeNode.children.find(
        (c) => !c.url && c.title.trim().toLowerCase() === QUICK_ACCESS_FOLDER_NAME.toLowerCase()
      );
      if (nestedQa?.children) {
        resolvedQaFolderId = nestedQa.id;
        qaBookmarks = nestedQa.children.filter(
          (b) => Boolean(b.url) && !isScratchpadUrl(b.url) && b.title !== 'Scratchpad Backup'
        );
      }
    }
    if (!qaBookmarks && arcticRoot?.children) {
      const rootQa = arcticRoot.children.find(
        (c) => !c.url && c.title.trim().toLowerCase() === QUICK_ACCESS_FOLDER_NAME.toLowerCase()
      );
      if (rootQa?.children) {
        resolvedQaFolderId = rootQa.id;
        qaBookmarks = rootQa.children.filter(
          (b) => Boolean(b.url) && !isScratchpadUrl(b.url) && b.title !== 'Scratchpad Backup'
        );
      }
    }

    const spaceNodes = (spaceTreeNode?.children || []).filter(
      (child) => child.id !== resolvedQaFolderId && !isExcludedInternalBookmarkNode(child)
    );

    return {
      qaBookmarks: qaBookmarks || [],
      spaceNodes,
      spaceName
    };
  } catch {
    return { qaBookmarks: [], spaceNodes: [], spaceName: 'Home' };
  }
}

export async function getEdgeRailDataForWindow(
  windowId: number | null
): Promise<EdgeRailData> {
  try {
    const [{ qaBookmarks, spaceNodes, spaceName }, session, allTabs] = await Promise.all([
      resolveActiveSpaceBookmarkTrees(),
      getSessionState(),
      chrome.tabs?.query ? chrome.tabs.query({}).catch(() => []) : Promise.resolve([])
    ]);

    if (qaBookmarks.length === 0 && spaceNodes.length === 0) {
      return { quickAccessItems: [], spaceItems: [], spaceName };
    }

    const tabsById = new Map<number, chrome.tabs.Tab>();
    for (const t of allTabs) {
      if (typeof t.id === 'number') {
        tabsById.set(t.id, t);
      }
    }

    const activeTabInWindow =
      typeof windowId === 'number'
        ? allTabs.find((t) => t.windowId === windowId && t.active)
        : allTabs.find((t) => t.active);

    const buildBookmarkItem = async (
      bm: chrome.bookmarks.BookmarkTreeNode,
      eagerFavicon: boolean
    ): Promise<EdgeQuickAccessItem> => {
      const url = bm.url || '';
      const binding = session.bindingsByBookmarkId[bm.id];
      const boundTab = binding ? tabsById.get(binding.tabId) : undefined;
      const isOpen = Boolean(boundTab);
      const isActive = Boolean(
        boundTab && activeTabInWindow && boundTab.id === activeTabInWindow.id
      );
      const isNavigatedAway = Boolean(isOpen && binding?.isNavigatedAway);
      const faviconDataUrl = eagerFavicon
        ? await resolveFaviconDataUrl(url, boundTab?.favIconUrl)
        : getCachedFaviconDataUrl(url, boundTab?.favIconUrl);

      return {
        id: bm.id,
        title: bm.title || url,
        url,
        faviconDataUrl,
        isActive,
        isOpen,
        isNavigatedAway,
        currentTitle: binding?.currentTitle || boundTab?.title || bm.title || url
      };
    };

    const buildFolderNode = async (
      folder: chrome.bookmarks.BookmarkTreeNode
    ): Promise<EdgeFolderNode> => {
      const rawChildren = (folder.children || []).filter((c) => !isExcludedInternalBookmarkNode(c));
      const children: EdgeSpaceNode[] = await Promise.all(
        rawChildren.map(async (child): Promise<EdgeSpaceNode> => {
          if (child.url) {
            // Lazy favicons inside folders: use warm cache if available, fetch cold ones on folder open
            const item = await buildBookmarkItem(child, false);
            return { type: 'bookmark', ...item } satisfies EdgeBookmarkNode;
          }
          return buildFolderNode(child);
        })
      );

      let hasActiveChild = false;
      let hasOpenChild = false;
      let hasNavigatedAwayChild = false;
      let itemCount = 0;

      for (const child of children) {
        if (child.type === 'bookmark') {
          itemCount += 1;
          if (child.isActive) hasActiveChild = true;
          if (child.isOpen) hasOpenChild = true;
          if (child.isNavigatedAway) hasNavigatedAwayChild = true;
        } else {
          itemCount += child.itemCount;
          if (child.hasActiveChild) hasActiveChild = true;
          if (child.hasOpenChild) hasOpenChild = true;
          if (child.hasNavigatedAwayChild) hasNavigatedAwayChild = true;
        }
      }

      return {
        type: 'folder',
        id: folder.id,
        title: folder.title || 'Untitled Folder',
        children,
        hasActiveChild,
        hasOpenChild,
        hasNavigatedAwayChild,
        itemCount
      };
    };

    const [quickAccessItems, spaceItems] = await Promise.all([
      Promise.all(qaBookmarks.map((bm) => buildBookmarkItem(bm, true))),
      Promise.all(
        spaceNodes.map(async (node): Promise<EdgeSpaceNode> => {
          if (node.url) {
            const item = await buildBookmarkItem(node, true);
            return { type: 'bookmark', ...item };
          }
          return buildFolderNode(node);
        })
      )
    ]);

    return { quickAccessItems, spaceItems, spaceName };
  } catch {
    return { quickAccessItems: [], spaceItems: [], spaceName: 'Home' };
  }
}

export async function getQuickAccessItemsForWindow(
  windowId: number | null
): Promise<EdgeQuickAccessItem[]> {
  const data = await getEdgeRailDataForWindow(windowId);
  return data.quickAccessItems;
}

export async function activateQuickAccessFromEdge(
  bookmarkId: string,
  windowId?: number,
  forceReset = false
): Promise<boolean> {
  if (!bookmarkId || !chrome.bookmarks?.getSubTree) return false;

  const ok = await withSessionLock(async () => {
    let bookmark: chrome.bookmarks.BookmarkTreeNode | undefined;
    try {
      const nodes = await chrome.bookmarks.getSubTree(bookmarkId);
      bookmark = nodes?.[0];
    } catch {
      return false;
    }
    if (!bookmark || !bookmark.url) return false;

    const [session, allTabs, persistedBindings] = await Promise.all([
      getSessionState(),
      chrome.tabs.query({}),
      getPersistedBindings()
    ]);

    const activeTabInWindow =
      typeof windowId === 'number'
        ? allTabs.find((t) => t.windowId === windowId && t.active)
        : allTabs.find((t) => t.active);

    const existingBinding = session.bindingsByBookmarkId[bookmark.id];
    if (existingBinding) {
      const existingTab = allTabs.find((t) => t.id === existingBinding.tabId);
      if (existingTab && typeof existingTab.id === 'number') {
        const isAlreadyActiveInWin =
          Boolean(activeTabInWindow) && existingTab.id === activeTabInWindow?.id;

        if (forceReset || (isAlreadyActiveInWin && existingBinding.isNavigatedAway)) {
          const effUrl = getEffectiveTabUrl(existingTab) || existingBinding.currentUrl || '';
          const needsReset =
            existingBinding.isNavigatedAway || isUrlNavigatedAway(effUrl, bookmark.url);

          if (needsReset) {
            await chrome.tabs.update(existingTab.id, { url: bookmark.url, active: true });
          } else {
            await chrome.tabs.update(existingTab.id, { active: true });
            if (chrome.tabs.reload) {
              await chrome.tabs.reload(existingTab.id);
            }
          }

          existingBinding.currentUrl = bookmark.url;
          existingBinding.currentTitle = bookmark.title || bookmark.url;
          existingBinding.isNavigatedAway = false;
          session.bindingsByBookmarkId[bookmark.id] = existingBinding;
          await saveSessionState(session);
          await upsertPersistedBindings({ [bookmark.id]: existingBinding });
        } else {
          await chrome.tabs.update(existingTab.id, { active: true });
        }

        if (typeof existingTab.windowId === 'number' && chrome.windows?.update) {
          try {
            await chrome.windows.update(existingTab.windowId, { focused: true });
          } catch {
            // ignore
          }
        }
        return true;
      }

      // Clean stale dead binding
      delete session.bookmarkIdByTabId[existingBinding.tabId];
      delete session.bindingsByBookmarkId[bookmark.id];
    }

    const orderedTabs =
      typeof windowId === 'number'
        ? [
            ...allTabs.filter((t) => t.windowId === windowId),
            ...allTabs.filter((t) => t.windowId !== windowId)
          ]
        : allTabs;

    const unboundMatch = findMatchingUnboundTabForBookmark({
      bookmark: { id: bookmark.id, url: bookmark.url },
      tabs: orderedTabs,
      boundTabIds: session.bookmarkIdByTabId,
      persistedBindings
    });

    if (unboundMatch && typeof unboundMatch.id === 'number') {
      const matchUrl = getEffectiveTabUrl(unboundMatch) || bookmark.url;
      const newBinding: TabBinding = {
        bookmarkId: bookmark.id,
        tabId: unboundMatch.id,
        windowId: unboundMatch.windowId,
        originalUrl: bookmark.url,
        currentUrl: matchUrl,
        currentTitle: unboundMatch.title || bookmark.title || '',
        isNavigatedAway: isUrlNavigatedAway(matchUrl, bookmark.url)
      };
      session.bindingsByBookmarkId[bookmark.id] = newBinding;
      session.bookmarkIdByTabId[unboundMatch.id] = bookmark.id;
      await saveSessionState(session);
      await upsertPersistedBindings({ [bookmark.id]: newBinding });

      await chrome.tabs.update(unboundMatch.id, { active: true });
      if (typeof unboundMatch.windowId === 'number' && chrome.windows?.update) {
        try {
          await chrome.windows.update(unboundMatch.windowId, { focused: true });
        } catch {
          // ignore
        }
      }
      return true;
    }

    const createdTab = await chrome.tabs.create({
      url: bookmark.url,
      active: true,
      ...(typeof windowId === 'number' ? { windowId } : {})
    });

    if (typeof createdTab.id === 'number') {
      const newBinding: TabBinding = {
        bookmarkId: bookmark.id,
        tabId: createdTab.id,
        windowId: createdTab.windowId,
        originalUrl: bookmark.url,
        currentUrl: bookmark.url,
        currentTitle: bookmark.title || bookmark.url,
        isNavigatedAway: false
      };
      session.bindingsByBookmarkId[bookmark.id] = newBinding;
      session.bookmarkIdByTabId[createdTab.id] = bookmark.id;
      await saveSessionState(session);
      await upsertPersistedBindings({ [bookmark.id]: newBinding });
    }
    return true;
  });

  if (ok) {
    scheduleEdgeItemsBroadcast(windowId);
  }
  return ok;
}

function scheduleEdgeItemsBroadcast(windowId?: number): void {
  pendingEdgeBroadcastWinIds.add(typeof windowId === 'number' ? windowId : 'ALL');
  if (edgeBroadcastTimer) return;
  edgeBroadcastTimer = setTimeout(() => {
    edgeBroadcastTimer = null;
    const targets = Array.from(pendingEdgeBroadcastWinIds);
    pendingEdgeBroadcastWinIds.clear();

    void (async () => {
      if (!chrome.storage?.local?.get || !chrome.tabs?.query || !chrome.tabs?.sendMessage) return;
      const local = await chrome.storage.local.get(['edgeTriggerEnabled']).catch(() => ({}));
      if (!(local as { edgeTriggerEnabled?: boolean }).edgeTriggerEnabled) return;

      const [openWindowIds, allTabs] = await Promise.all([
        getStoredOpenWindowIds(),
        chrome.tabs.query({}).catch(() => [])
      ]);

      const windowIds = new Set<number>();
      if (targets.includes('ALL')) {
        for (const t of allTabs) {
          if (typeof t.windowId === 'number') windowIds.add(t.windowId);
        }
      } else {
        for (const w of targets) {
          if (typeof w === 'number') windowIds.add(w);
        }
      }

      for (const winId of windowIds) {
        if (openWindowIds.includes(winId)) continue;
        // Optimization: only push live rail updates to the currently visible (active) tab in the window
        const activeWinTabs = allTabs.filter(
          (t) => t.windowId === winId && t.active && typeof t.id === 'number' && !t.discarded
        );
        if (activeWinTabs.length === 0) continue;

        const railData = await getEdgeRailDataForWindow(winId);
        for (const t of activeWinTabs) {
          chrome.tabs
            .sendMessage(t.id as number, {
              type: 'ARCTIC_EDGE_ITEMS_UPDATED',
              windowId: winId,
              quickAccessItems: railData.quickAccessItems,
              spaceItems: railData.spaceItems,
              spaceName: railData.spaceName
            })
            .catch(() => {});
        }
      }
    })();
  }, 30);
}

if (chrome.bookmarks) {
  const onBookmarkMutated = () => scheduleEdgeItemsBroadcast();
  chrome.bookmarks.onCreated?.addListener(onBookmarkMutated);
  chrome.bookmarks.onRemoved?.addListener(onBookmarkMutated);
  chrome.bookmarks.onChanged?.addListener(onBookmarkMutated);
  chrome.bookmarks.onMoved?.addListener(onBookmarkMutated);
}

function withVisibilityLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = visibilityLock.then(fn, fn);
  visibilityLock = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function withScriptSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = scriptSyncLock.then(fn, fn);
  scriptSyncLock = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function isInjectableWebUrl(url?: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (
    url.startsWith('https://chromewebstore.google.com/') ||
    url.startsWith('https://chrome.google.com/webstore')
  ) {
    return false;
  }
  return true;
}

export async function syncSidePanelLayoutSide(): Promise<'left' | 'right' | null> {
  const sp = chrome.sidePanel as typeof chrome.sidePanel & {
    getLayout?: () => Promise<{ side?: 'left' | 'right' }>;
  };
  if (sp && typeof sp.getLayout === 'function') {
    try {
      const layout = await sp.getLayout();
      if (layout?.side === 'left' || layout?.side === 'right') {
        await chrome.storage.local.set({ sidebarDockSide: layout.side });
        return layout.side;
      }
    } catch {
      // ignore if unsupported
    }
  }
  return null;
}

async function getStoredOpenWindowIds(): Promise<number[]> {
  if (!chrome.storage?.session?.get) return [];
  try {
    const now = Date.now();
    const data = await chrome.storage.session.get(['openSidePanelWindowIds']);
    const stored = Array.isArray(data.openSidePanelWindowIds)
      ? (data.openSidePanelWindowIds as number[]).filter(
          (id) => typeof id === 'number' && (closingGuardUntilByWindow.get(id) || 0) <= now
        )
      : [];

    // Combine active connected ports with session state
    const portWinIds = Array.from(sidePanelPorts.values()).filter(
      (id) => typeof id === 'number' && (closingGuardUntilByWindow.get(id) || 0) <= now
    );
    // Protect stored IDs that were just opened via OPEN_SIDE_PANEL_FROM_EDGE while sidepanel.html boots
    const recentlyOpenedStoredIds = stored.filter((id) => {
      const until = openingGuardUntilByWindow.get(id) || 0;
      if (until <= now) {
        openingGuardUntilByWindow.delete(id);
        return false;
      }
      return true;
    });

    // Query authoritative Chromium SIDE_PANEL contexts whenever available:
    // - Hydrates open window IDs immediately after extension reload while Side Panel is already open
    // - Clears stale session state if SW terminated and Side Panel closed while inactive
    const rt = chrome.runtime as typeof chrome.runtime & {
      getContexts?: (filter: { contextTypes: string[] }) => Promise<Array<{ windowId?: number }>>;
    };
    if (typeof rt?.getContexts === 'function') {
      try {
        const contexts = await rt.getContexts({ contextTypes: ['SIDE_PANEL'] });
        if (Array.isArray(contexts)) {
          if (
            contexts.length === 0 &&
            portWinIds.length === 0 &&
            recentlyOpenedStoredIds.length === 0
          ) {
            if (stored.length > 0) {
              await chrome.storage.session.set({ openSidePanelWindowIds: [] });
            }
            return [];
          }
          const contextWinIds = contexts
            .map((c) => c.windowId)
            .filter(
              (id): id is number =>
                typeof id === 'number' && id > 0 && (closingGuardUntilByWindow.get(id) || 0) <= now
            );
          const merged = Array.from(new Set([...stored, ...portWinIds, ...contextWinIds]));
          if (merged.length !== stored.length || merged.some((id) => !stored.includes(id))) {
            await chrome.storage.session.set({ openSidePanelWindowIds: merged });
          }
          return merged;
        }
      } catch {
        // ignore
      }
    }

    if (portWinIds.length > 0) {
      return Array.from(new Set([...stored, ...portWinIds]));
    }

    return stored;
  } catch {
    return [];
  }
}

async function broadcastWindowVisibility(
  windowId: number,
  isOpen: boolean,
  openWindowIds: number[],
  justCollapsed = false
): Promise<void> {
  if (chrome.tabs?.query && chrome.tabs?.sendMessage) {
    try {
      const tabs = await chrome.tabs.query({ windowId });
      const activeTabs = tabs.filter((t) => typeof t.id === 'number' && !t.discarded && t.active);
      const railData =
        !isOpen && activeTabs.length > 0
          ? await getEdgeRailDataForWindow(windowId)
          : { quickAccessItems: [], spaceItems: [], spaceName: 'Home' };

      for (const t of tabs) {
        if (typeof t.id === 'number' && !t.discarded) {
          const isTabActive = Boolean(t.active);
          chrome.tabs
            .sendMessage(t.id, {
              type: 'ARCTIC_SIDEPANEL_VISIBILITY',
              windowId,
              isSidePanelOpen: isOpen,
              openWindowIds,
              justCollapsed,
              ...(isTabActive && !isOpen
                ? {
                    quickAccessItems: railData.quickAccessItems,
                    spaceItems: railData.spaceItems,
                    spaceName: railData.spaceName
                  }
                : {})
            })
            .catch(() => {});
        }
      }
    } catch {
      // ignore
    }
  }
}

export async function markSidePanelWindowState(
  windowId: number,
  isOpen: boolean,
  justCollapsed = false
): Promise<number[]> {
  return withVisibilityLock(async () => {
    if (!chrome.storage?.session?.get || !chrome.storage?.session?.set) return [];
    const data = await chrome.storage.session.get(['openSidePanelWindowIds']);
    const current = new Set<number>(
      Array.isArray(data.openSidePanelWindowIds)
        ? (data.openSidePanelWindowIds as number[]).filter((id) => typeof id === 'number')
        : []
    );

    if (isOpen) {
      if ((closingGuardUntilByWindow.get(windowId) || 0) > Date.now()) {
        return Array.from(current);
      }
      recentlyCollapsedAtByWindow.delete(windowId);
      current.add(windowId);
    } else {
      // Only mark closed if no other live port is still bound to this windowId
      const hasOtherPortForWin = Array.from(sidePanelPorts.values()).some((id) => id === windowId);
      if (!hasOtherPortForWin) {
        current.delete(windowId);
        if (justCollapsed) {
          recentlyCollapsedAtByWindow.set(windowId, Date.now());
        }
      }
    }

    const updated = Array.from(current);
    await chrome.storage.session.set({ openSidePanelWindowIds: updated });
    await broadcastWindowVisibility(windowId, isOpen, updated, justCollapsed);
    return updated;
  });
}

export function handleSidePanelPortConnect(port: chrome.runtime.Port): void {
  if (!port || port.name !== SIDEPANEL_PORT_NAME) return;

  const handlePortMessage = (msg: { type?: string; windowId?: number }) => {
    if (msg && msg.type === 'SIDEPANEL_INIT' && typeof msg.windowId === 'number') {
      closingGuardUntilByWindow.delete(msg.windowId);
      openingGuardUntilByWindow.delete(msg.windowId);
      sidePanelPorts.set(port, msg.windowId);
      void markSidePanelWindowState(msg.windowId, true);
      void syncSidePanelLayoutSide();
    }
  };

  const handlePortDisconnect = () => {
    const winId = sidePanelPorts.get(port);
    sidePanelPorts.delete(port);
    if (typeof winId === 'number') {
      void markSidePanelWindowState(winId, false, true);
    }
  };

  port.onMessage.addListener(handlePortMessage);
  port.onDisconnect.addListener(handlePortDisconnect);
}

if (chrome.runtime && chrome.runtime.onConnect) {
  chrome.runtime.onConnect.addListener(handleSidePanelPortConnect);
}

export async function hasEdgeTriggerHostPermission(): Promise<boolean> {
  if (!chrome.permissions?.contains) return false;
  try {
    return await chrome.permissions.contains({ origins: EDGE_TRIGGER_ORIGINS });
  } catch {
    return false;
  }
}

export async function syncEdgeTriggerContentScript(
  injectIntoOpenTabs = false
): Promise<boolean> {
  return withScriptSyncLock(async () => {
    if (!chrome.scripting?.registerContentScripts || !chrome.storage?.local?.get) {
      return false;
    }

    try {
      const [local, hasPerm] = await Promise.all([
        chrome.storage.local.get(['edgeTriggerEnabled']),
        hasEdgeTriggerHostPermission()
      ]);

      const shouldBeActive = Boolean(local.edgeTriggerEnabled) && hasPerm;
      const existing = await chrome.scripting
        .getRegisteredContentScripts({ ids: [EDGE_TRIGGER_SCRIPT_ID] })
        .catch(() => []);
      const isRegistered = Array.isArray(existing) && existing.length > 0;

      if (shouldBeActive) {
        if (!isRegistered) {
          try {
            await chrome.scripting.registerContentScripts([
              {
                id: EDGE_TRIGGER_SCRIPT_ID,
                matches: EDGE_TRIGGER_ORIGINS,
                js: ['edgeTrigger.js'],
                runAt: 'document_idle'
              }
            ]);
          } catch (regErr) {
            // Ignore duplicate script ID if already registered concurrently
            console.debug('[Arctic Background] registerContentScripts note:', regErr);
          }
        }

        if (injectIntoOpenTabs && chrome.tabs?.query && chrome.scripting?.executeScript) {
          const allTabs = await chrome.tabs.query({}).catch(() => []);
          const targetTabs = allTabs.filter(
            (t) => typeof t.id === 'number' && !t.discarded && isInjectableWebUrl(t.url)
          );
          await Promise.allSettled(
            targetTabs.map((t) =>
              chrome.scripting.executeScript({
                target: { tabId: t.id as number },
                files: ['edgeTrigger.js']
              })
            )
          );
        }
        return true;
      } else {
        if (isRegistered && chrome.scripting.unregisterContentScripts) {
          await chrome.scripting
            .unregisterContentScripts({ ids: [EDGE_TRIGGER_SCRIPT_ID] })
            .catch(() => {});
        }

        if (chrome.tabs?.query && chrome.tabs?.sendMessage) {
          const tabs = await chrome.tabs.query({}).catch(() => []);
          for (const t of tabs) {
            if (typeof t.id === 'number' && !t.discarded) {
              chrome.tabs
                .sendMessage(t.id, { type: 'ARCTIC_REMOVE_EDGE_TRIGGER' })
                .catch(() => {});
            }
          }
        }
        return false;
      }
    } catch (err) {
      console.warn('[Arctic Background] Failed to sync edge trigger script:', err);
      return false;
    }
  });
}

export function handleRuntimeMessage(
  message: {
    type?: string;
    windowId?: number;
    injectIntoOpenTabs?: boolean;
    bookmarkId?: string;
    forceReset?: boolean;
    urls?: string[];
  },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): boolean {
  if (!message || typeof message !== 'object') return false;

  // CRITICAL: Must invoke chrome.sidePanel.open() SYNCHRONOUSLY before any await
  // so Chromium's transient user gesture token forwarded from the content script click stays valid!
  if (message.type === 'OPEN_SIDE_PANEL_FROM_EDGE') {
    const windowId =
      typeof sender?.tab?.windowId === 'number'
        ? sender.tab.windowId
        : typeof message.windowId === 'number'
        ? message.windowId
        : undefined;
    const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : undefined;

    if (typeof windowId === 'number') {
      closingGuardUntilByWindow.delete(windowId);
      openingGuardUntilByWindow.set(windowId, Date.now() + 2500);
    }

    if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
      const openPromise =
        typeof windowId === 'number'
          ? chrome.sidePanel.open({ windowId })
          : typeof tabId === 'number'
          ? chrome.sidePanel.open({ tabId })
          : Promise.reject(new Error('Missing windowId and tabId'));

      openPromise
        .then(() => {
          if (typeof windowId === 'number') {
            void markSidePanelWindowState(windowId, true);
          }
          sendResponse({ ok: true });
        })
        .catch((err) => {
          if (typeof windowId === 'number') {
            openingGuardUntilByWindow.delete(windowId);
          }
          console.warn('[Arctic Background] Could not open sidePanel from edge trigger:', err);
          sendResponse({ ok: false, error: String(err) });
        });
      return true;
    }

    sendResponse({ ok: false, error: 'sidePanel.open unavailable' });
    return false;
  }

  if (message.type === 'ACTIVATE_QUICK_ACCESS_FROM_EDGE' && typeof message.bookmarkId === 'string') {
    const windowId =
      typeof sender?.tab?.windowId === 'number'
        ? sender.tab.windowId
        : typeof message.windowId === 'number'
        ? message.windowId
        : undefined;
    void activateQuickAccessFromEdge(
      message.bookmarkId,
      windowId,
      Boolean(message.forceReset)
    ).then((ok) => {
      sendResponse({ ok });
    });
    return true;
  }

  if (message.type === 'GET_EDGE_FOLDER_FAVICONS' && Array.isArray(message.urls)) {
    const uniqueUrls = Array.from(
      new Set(
        message.urls
          .filter((u): u is string => typeof u === 'string' && u.length > 0)
          .slice(0, 80)
      )
    );
    void (async () => {
      try {
        const entries = await Promise.all(
          uniqueUrls.map(async (u) => [u, await resolveFaviconDataUrl(u)] as const)
        );
        const favicons: Record<string, string> = {};
        for (const [u, dataUrl] of entries) {
          if (dataUrl) favicons[u] = dataUrl;
        }
        sendResponse({ ok: true, favicons });
      } catch {
        sendResponse({ ok: false, favicons: {} });
      }
    })();
    return true;
  }

  if (message.type === 'GET_EDGE_TRIGGER_STATE') {
    const windowId =
      typeof sender?.tab?.windowId === 'number'
        ? sender.tab.windowId
        : typeof message.windowId === 'number'
        ? message.windowId
        : null;

    void (async () => {
      try {
        const [openWindowIds, local, hasPerm] = await Promise.all([
          getStoredOpenWindowIds(),
          chrome.storage.local.get(['edgeTriggerEnabled', 'edgeTriggerMode', 'sidebarDockSide']),
          hasEdgeTriggerHostPermission()
        ]);
        const isOpenInWin = typeof windowId === 'number' && openWindowIds.includes(windowId);
        // Optimization: skip resolving bookmark trees & favicons when full sidebar is open or edge trigger is off
        const shouldLoadItems = Boolean(local.edgeTriggerEnabled) && !isOpenInWin;
        const railData = shouldLoadItems
          ? await getEdgeRailDataForWindow(windowId)
          : { quickAccessItems: [], spaceItems: [], spaceName: 'Home' };

        const detectedSide = await syncSidePanelLayoutSide();
        const side =
          detectedSide ||
          (local.sidebarDockSide === 'left' || local.sidebarDockSide === 'right'
            ? local.sidebarDockSide
            : 'left');
        const mode = local.edgeTriggerMode === 'hover' ? 'hover' : 'push';
        const collapsedAt =
          typeof windowId === 'number' ? recentlyCollapsedAtByWindow.get(windowId) || 0 : 0;
        const justCollapsed = collapsedAt > 0 && Date.now() - collapsedAt < 2500;

        sendResponse({
          windowId,
          openWindowIds,
          edgeTriggerEnabled: Boolean(local.edgeTriggerEnabled) && hasPerm,
          mode,
          side,
          justCollapsed,
          quickAccessItems: railData.quickAccessItems,
          spaceItems: railData.spaceItems,
          spaceName: railData.spaceName
        });
      } catch {
        sendResponse({
          windowId,
          openWindowIds: [],
          edgeTriggerEnabled: false,
          mode: 'push',
          side: 'left',
          justCollapsed: false,
          quickAccessItems: [],
          spaceItems: [],
          spaceName: 'Home'
        });
      }
    })();
    return true;
  }

  if (message.type === 'SYNC_EDGE_TRIGGER') {
    void syncEdgeTriggerContentScript(Boolean(message.injectIntoOpenTabs)).then((active) => {
      sendResponse({ ok: true, active });
    });
    return true;
  }

  if (message.type === 'PREPARE_HIDE_SIDEBAR') {
    void (async () => {
      let winId = typeof message.windowId === 'number' ? message.windowId : undefined;
      if (typeof winId !== 'number' && chrome.windows?.getCurrent) {
        try {
          const currentWin = await chrome.windows.getCurrent();
          if (typeof currentWin?.id === 'number') {
            winId = currentWin.id;
          }
        } catch {
          // ignore
        }
      }
      if (typeof winId === 'number') {
        openingGuardUntilByWindow.delete(winId);
        closingGuardUntilByWindow.set(winId, Date.now() + 1200);
        for (const [port, pWinId] of sidePanelPorts.entries()) {
          if (pWinId === winId) {
            sidePanelPorts.delete(port);
          }
        }
        await markSidePanelWindowState(winId, false, true);
      }
      const active = await syncEdgeTriggerContentScript(Boolean(message.injectIntoOpenTabs));
      if (typeof winId === 'number') {
        const openWindowIds = await getStoredOpenWindowIds();
        await broadcastWindowVisibility(winId, false, openWindowIds, true);
      }
      sendResponse({ ok: true, active });
    })();
    return true;
  }

  if (message.type === 'SIDEPANEL_WILL_CLOSE' && typeof message.windowId === 'number') {
    openingGuardUntilByWindow.delete(message.windowId);
    closingGuardUntilByWindow.set(message.windowId, Date.now() + 1200);
    for (const [port, winId] of sidePanelPorts.entries()) {
      if (winId === message.windowId) {
        sidePanelPorts.delete(port);
      }
    }
    void markSidePanelWindowState(message.windowId, false, true).then((openWindowIds) => {
      sendResponse({ ok: true, openWindowIds });
    });
    return true;
  }

  return false;
}

if (chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
}

if (chrome.tabs && chrome.tabs.onAttached) {
  chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
    void getStoredOpenWindowIds().then((openWindowIds) => {
      chrome.tabs
        .sendMessage(tabId, {
          type: 'EDGE_WINDOW_CHANGED',
          windowId: attachInfo.newWindowId,
          openWindowIds
        })
        .catch(() => {});
    });
  });
}

if (chrome.windows && chrome.windows.onRemoved) {
  chrome.windows.onRemoved.addListener((windowId) => {
    openingGuardUntilByWindow.delete(windowId);
    closingGuardUntilByWindow.delete(windowId);
    recentlyCollapsedAtByWindow.delete(windowId);
    for (const [port, winId] of sidePanelPorts.entries()) {
      if (winId === windowId) {
        sidePanelPorts.delete(port);
      }
    }
    void markSidePanelWindowState(windowId, false);
  });
}

if (chrome.permissions && 'onRemoved' in chrome.permissions) {
  (
    chrome.permissions as typeof chrome.permissions & {
      onRemoved?: { addListener: (cb: () => void) => void };
    }
  ).onRemoved?.addListener(() => {
    void syncEdgeTriggerContentScript(false);
  });
}
