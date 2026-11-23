import type React from 'react';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

export type DragItemType = 'openTab' | 'bookmark' | 'folder' | 'quickAccess';

export interface ActiveDragSession {
  type: DragItemType;
  id?: string;
  ids?: string[];
  tabId?: number;
  tabIds?: number[];
  parentId?: string;
  index?: number;
  url?: string;
  title?: string;
}

let currentDragSession: ActiveDragSession | null = null;
const dragListeners = new Set<() => void>();
const dragEndListeners = new Set<() => void>();

let recentlyMovedIds = new Set<string>();
const emptySet = new Set<string>();
let recentlyMovedTimer: ReturnType<typeof setTimeout> | null = null;
const movedListeners = new Set<() => void>();

let globalListenersAttached = false;

function emitDragChange() {
  for (const listener of dragListeners) {
    listener();
  }
}

function emitDragEnd() {
  for (const listener of dragEndListeners) {
    listener();
  }
}

function emitMovedChange() {
  for (const listener of movedListeners) {
    listener();
  }
}

function setBodyDraggingAttr(active: boolean) {
  if (typeof document === 'undefined' || !document.body) return;
  if (active) {
    document.body.dataset.dragging = 'true';
  } else {
    delete document.body.dataset.dragging;
  }
}

function handleGlobalDragEnd() {
  if (currentDragSession !== null) {
    endDragSession();
  }
}

function handleGlobalKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && currentDragSession !== null) {
    endDragSession();
  }
}

function handleGlobalDrop() {
  if (currentDragSession !== null) {
    endDragSession();
  }
}

function handleGlobalPointerDown() {
  // A new pointerdown cannot occur mid-HTML5-drag; if currentDragSession is still set,
  // a previous drag ended outside the Side Panel without firing dragend.
  if (currentDragSession !== null) {
    endDragSession();
  }
}

function ensureGlobalCleanupListeners() {
  if (globalListenersAttached || typeof window === 'undefined') return;
  globalListenersAttached = true;
  window.addEventListener('dragend', handleGlobalDragEnd, true);
  window.addEventListener('keydown', handleGlobalKeyDown, true);
  window.addEventListener('drop', handleGlobalDrop, false);
  window.addEventListener('pointerdown', handleGlobalPointerDown, true);
}

export function startDragSession(session: ActiveDragSession): void {
  ensureGlobalCleanupListeners();
  currentDragSession = session;
  setBodyDraggingAttr(true);
  emitDragChange();
}

export function endDragSession(): void {
  const hadSession = currentDragSession !== null;
  currentDragSession = null;
  setBodyDraggingAttr(false);
  if (hadSession) {
    emitDragChange();
  }
  emitDragEnd();
}

export function getActiveDrag(): ActiveDragSession | null {
  return currentDragSession;
}

function subscribeDrag(listener: () => void): () => void {
  dragListeners.add(listener);
  return () => {
    dragListeners.delete(listener);
  };
}

export function useActiveDrag(): ActiveDragSession | null {
  return useSyncExternalStore(subscribeDrag, getActiveDrag, () => null);
}

/**
 * Selector hook that only re-renders a BookmarkRow when its own ID enters or leaves an active bookmark drag.
 */
export function useIsDraggedBookmark(id: string): boolean {
  const getSnapshot = useCallback(() => {
    if (!currentDragSession || currentDragSession.type !== 'bookmark') {
      return false;
    }
    if (currentDragSession.id === id) return true;
    return Boolean(currentDragSession.ids?.includes(id));
  }, [id]);
  return useSyncExternalStore(subscribeDrag, getSnapshot, () => false);
}

/**
 * Selector hook that only re-renders a FolderNode when it (or one of its ancestors) enters/leaves an active folder drag.
 */
export function useIsDraggedFolderOrDescendant(
  roots: chrome.bookmarks.BookmarkTreeNode[],
  folderId: string
): boolean {
  const getSnapshot = useCallback(() => {
    if (!currentDragSession || currentDragSession.type !== 'folder' || !currentDragSession.id) {
      return false;
    }
    return isFolderSelfOrDescendant(roots, currentDragSession.id, folderId);
  }, [roots, folderId]);
  return useSyncExternalStore(subscribeDrag, getSnapshot, () => false);
}

/**
 * Subscribes to drag-session termination ONLY while `hasLocalDragState` is true,
 * ensuring local `isDragging` / `dropPosition` / `dropState` never remain stuck if `dragend`/`dragleave` is skipped.
 */
export function useResetOnDragEnd(hasLocalDragState: boolean, onReset: () => void): void {
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  useEffect(() => {
    if (!hasLocalDragState) return;
    ensureGlobalCleanupListeners();
    const listener = () => {
      onResetRef.current();
    };
    dragEndListeners.add(listener);
    return () => {
      dragEndListeners.delete(listener);
    };
  }, [hasLocalDragState]);
}

export function markRecentlyMoved(ids: Array<string | number>): void {
  const normalized = ids.map((id) => String(id)).filter(Boolean);
  if (normalized.length === 0) return;

  if (recentlyMovedTimer) {
    clearTimeout(recentlyMovedTimer);
  }
  recentlyMovedIds = new Set(normalized);
  emitMovedChange();

  recentlyMovedTimer = setTimeout(() => {
    recentlyMovedTimer = null;
    recentlyMovedIds = emptySet;
    emitMovedChange();
  }, 360);
}

function getRecentlyMovedSnapshot(): Set<string> {
  return recentlyMovedIds;
}

function subscribeMoved(listener: () => void): () => void {
  movedListeners.add(listener);
  return () => {
    movedListeners.delete(listener);
  };
}

export function useRecentlyMovedIds(): Set<string> {
  return useSyncExternalStore(subscribeMoved, getRecentlyMovedSnapshot, () => emptySet);
}

/**
 * Selector hook that only re-renders an item when its own ID enters or leaves `recentlyMovedIds`.
 */
export function useIsRecentlyMoved(id: string): boolean {
  const getSnapshot = useCallback(() => recentlyMovedIds.has(id), [id]);
  return useSyncExternalStore(subscribeMoved, getSnapshot, () => false);
}

/**
 * Parse drop payload from DataTransfer JSON first, falling back to in-memory active drag session.
 */
export function parseDragPayload(
  e: Pick<React.DragEvent, 'dataTransfer'>
): Record<string, unknown> | null {
  try {
    const raw = e.dataTransfer?.getData?.('application/json');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    }
  } catch {
    // Fall back to active drag session
  }

  if (currentDragSession) {
    return { ...currentDragSession };
  }
  return null;
}

/**
 * Compute drop zone on a FolderNode header row.
 * - Returns 'inside' when height <= 0 (e.g. JSDOM default rect) so synthetic drop tests work seamlessly.
 * - Collapsed folder: top 28% -> 'top', bottom 28% -> 'bottom', middle 44% -> 'inside'.
 * - Expanded folder header: top 28% -> 'top', lower 72% -> 'inside' (since its own children sit immediately below).
 */
export function getFolderDropZone(
  relY: number,
  height: number,
  isCollapsed: boolean
): 'top' | 'inside' | 'bottom' {
  if (!(height > 0) || !Number.isFinite(relY)) {
    return 'inside';
  }
  const edgeZone = Math.max(8, Math.min(11, height * 0.28));
  if (relY <= edgeZone) {
    return 'top';
  }
  if (isCollapsed && relY >= height - edgeZone) {
    return 'bottom';
  }
  return 'inside';
}

export function findNodeInTrees(
  roots: chrome.bookmarks.BookmarkTreeNode[],
  targetId: string
): chrome.bookmarks.BookmarkTreeNode | null {
  for (const node of roots) {
    if (node.id === targetId) return node;
    if (node.children && node.children.length > 0) {
      const found = findNodeInTrees(node.children, targetId);
      if (found) return found;
    }
  }
  return null;
}

function removeNodeFromTree(
  node: chrome.bookmarks.BookmarkTreeNode,
  targetId: string
): chrome.bookmarks.BookmarkTreeNode {
  if (!node.children || node.children.length === 0) {
    return node;
  }
  let changed = false;
  const nextChildren: chrome.bookmarks.BookmarkTreeNode[] = [];
  for (const child of node.children) {
    if (child.id === targetId) {
      changed = true;
      continue;
    }
    const updatedChild = removeNodeFromTree(child, targetId);
    if (updatedChild !== child) {
      changed = true;
    }
    nextChildren.push(updatedChild);
  }
  return changed ? { ...node, children: nextChildren } : node;
}

function insertNodesAtParent(
  node: chrome.bookmarks.BookmarkTreeNode,
  targetParentId: string,
  nodesToInsert: chrome.bookmarks.BookmarkTreeNode[],
  insertIndex?: number
): chrome.bookmarks.BookmarkTreeNode {
  if (node.id === targetParentId) {
    const existing = node.children ? [...node.children] : [];
    const prepared = nodesToInsert.map((n) => ({ ...n, parentId: targetParentId }));
    const idx =
      typeof insertIndex === 'number'
        ? Math.max(0, Math.min(insertIndex, existing.length))
        : existing.length;
    existing.splice(idx, 0, ...prepared);
    return { ...node, children: existing };
  }
  if (!node.children || node.children.length === 0) {
    return node;
  }
  let changed = false;
  const nextChildren = node.children.map((child) => {
    const updated = insertNodesAtParent(child, targetParentId, nodesToInsert, insertIndex);
    if (updated !== child) changed = true;
    return updated;
  });
  return changed ? { ...node, children: nextChildren } : node;
}

/**
 * Pure optimistic bookmark tree move matching Chromium BookmarkModel::Move pre-removal index semantics.
 */
export function optimisticallyMoveInTree(
  root: chrome.bookmarks.BookmarkTreeNode,
  movingNodes: chrome.bookmarks.BookmarkTreeNode[],
  targetParentId: string,
  targetIndex?: number
): chrome.bookmarks.BookmarkTreeNode {
  if (movingNodes.length === 0) return root;

  let currentRoot = root;
  let curIndex = targetIndex;
  const seenIds = new Set<string>();

  for (const movingNode of movingNodes) {
    const id = movingNode.id;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    if (isFolderSelfOrDescendant([currentRoot], id, targetParentId)) {
      continue;
    }

    const liveNode = findNodeInTrees([currentRoot], id) ?? movingNode;
    const targetParent = findNodeInTrees([currentRoot], targetParentId);
    if (!targetParent) {
      currentRoot = removeNodeFromTree(currentRoot, id);
      continue;
    }

    const children = targetParent.children || [];
    const oldIndex = children.findIndex((c) => c.id === id);

    if (typeof curIndex === 'number') {
      const clampedSlot = Math.max(0, Math.min(curIndex, children.length));
      if (oldIndex !== -1 && (clampedSlot === oldIndex || clampedSlot === oldIndex + 1)) {
        curIndex = oldIndex + 1;
        continue;
      }

      currentRoot = removeNodeFromTree(currentRoot, id);
      if (clampedSlot >= children.length) {
        currentRoot = insertNodesAtParent(currentRoot, targetParentId, [liveNode]);
        curIndex = oldIndex !== -1 ? children.length : children.length + 1;
      } else {
        const postRemovalIndex =
          oldIndex !== -1 && oldIndex < clampedSlot ? clampedSlot - 1 : clampedSlot;
        currentRoot = insertNodesAtParent(
          currentRoot,
          targetParentId,
          [liveNode],
          postRemovalIndex
        );
        curIndex = oldIndex !== -1 && oldIndex < clampedSlot ? clampedSlot : clampedSlot + 1;
      }
    } else {
      currentRoot = removeNodeFromTree(currentRoot, id);
      currentRoot = insertNodesAtParent(currentRoot, targetParentId, [liveNode]);
    }
  }

  return stampBookmarkTreeIndices(currentRoot);
}

/**
 * Pure optimistic insertion of newly created/moved bookmark nodes into a tree, deduping by ID.
 */
export function optimisticallyInsertIntoTree(
  root: chrome.bookmarks.BookmarkTreeNode,
  newNodes: chrome.bookmarks.BookmarkTreeNode[],
  targetParentId: string,
  targetIndex?: number
): chrome.bookmarks.BookmarkTreeNode {
  if (newNodes.length === 0) return root;

  const seenIds = new Set<string>();
  const uniqueNodes: chrome.bookmarks.BookmarkTreeNode[] = [];
  for (const n of newNodes) {
    if (!n.id || seenIds.has(n.id)) continue;
    if (isFolderSelfOrDescendant([root], n.id, targetParentId)) continue;
    seenIds.add(n.id);
    uniqueNodes.push(n);
  }
  if (uniqueNodes.length === 0) return root;

  let currentRoot = root;
  for (const n of uniqueNodes) {
    currentRoot = removeNodeFromTree(currentRoot, n.id);
  }

  if (findNodeInTrees([currentRoot], targetParentId)) {
    currentRoot = insertNodesAtParent(currentRoot, targetParentId, uniqueNodes, targetIndex);
  }

  return stampBookmarkTreeIndices(currentRoot);
}

function containsNodeId(
  node: chrome.bookmarks.BookmarkTreeNode,
  candidateId: string
): boolean {
  if (node.id === candidateId) return true;
  if (node.children) {
    for (const child of node.children) {
      if (containsNodeId(child, candidateId)) return true;
    }
  }
  return false;
}

/**
 * Returns true if `candidateId` is `folderId` itself or anywhere inside `folderId`'s subtree.
 */
export function isFolderSelfOrDescendant(
  roots: chrome.bookmarks.BookmarkTreeNode[],
  folderId: string | undefined,
  candidateId: string | undefined
): boolean {
  if (!folderId || !candidateId) return false;
  if (folderId === candidateId) return true;
  const folderNode = findNodeInTrees(roots, folderId);
  if (!folderNode) return false;
  return containsNodeId(folderNode, candidateId);
}

/**
 * Recursively stamps accurate 0-based `index` and `parentId` on every child in a bookmark tree.
 */
export function stampBookmarkTreeIndices<T extends chrome.bookmarks.BookmarkTreeNode>(
  node: T
): T {
  if (!node.children) {
    return { ...node };
  }
  return {
    ...node,
    children: node.children.map((child, idx) => {
      const stampedChild = stampBookmarkTreeIndices(child);
      return {
        ...stampedChild,
        parentId: node.id,
        index: idx
      };
    })
  };
}

/**
 * Attaches a compact pill drag preview when dragging multiple selected items.
 */
export function attachMultiDragPreview(
  e: React.DragEvent,
  count: number,
  singularLabel = 'tab'
): void {
  if (
    count <= 1 ||
    typeof document === 'undefined' ||
    !document.body ||
    typeof e.dataTransfer?.setDragImage !== 'function'
  ) {
    return;
  }

  const ghost = document.createElement('div');
  ghost.textContent = `${count} ${singularLabel}s`;
  ghost.style.position = 'fixed';
  ghost.style.top = '-9999px';
  ghost.style.left = '-9999px';
  ghost.style.padding = '5px 10px';
  ghost.style.borderRadius = '9999px';
  ghost.style.fontSize = '12px';
  ghost.style.fontWeight = '600';
  ghost.style.fontFamily =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ghost.style.background = 'rgba(24, 24, 27, 0.94)';
  ghost.style.color = '#ffffff';
  ghost.style.border = '1px solid var(--theme-accent, #06b6d4)';
  ghost.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.35)';
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '99999';

  document.body.appendChild(ghost);
  try {
    e.dataTransfer.setDragImage(ghost, 18, 14);
  } catch {
    // ignore if unsupported in environment
  }

  const cleanup = () => {
    if (ghost.parentNode) {
      ghost.parentNode.removeChild(ghost);
    }
  };
  setTimeout(cleanup, 60);
}
