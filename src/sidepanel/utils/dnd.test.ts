import { describe, it, expect, afterEach } from 'vitest';
import {
  endDragSession,
  getActiveDrag,
  getFolderDropZone,
  isFolderSelfOrDescendant,
  optimisticallyInsertIntoTree,
  optimisticallyMoveInTree,
  parseDragPayload,
  stampBookmarkTreeIndices,
  startDragSession
} from './dnd';

describe('dnd utilities', () => {
  afterEach(() => {
    endDragSession();
  });

  describe('getFolderDropZone', () => {
    it('returns top, inside, and bottom zones accurately for a collapsed folder', () => {
      // 34px row -> edgeZone = min(11, max(8, 9.52)) = 9.52px
      expect(getFolderDropZone(3, 34, true)).toBe('top');
      expect(getFolderDropZone(9, 34, true)).toBe('top');
      expect(getFolderDropZone(17, 34, true)).toBe('inside');
      expect(getFolderDropZone(26, 34, true)).toBe('bottom');
      expect(getFolderDropZone(33, 34, true)).toBe('bottom');
    });

    it('routes bottom hover on an expanded folder header to inside (children sit directly below)', () => {
      expect(getFolderDropZone(4, 34, false)).toBe('top');
      expect(getFolderDropZone(17, 34, false)).toBe('inside');
      expect(getFolderDropZone(32, 34, false)).toBe('inside');
    });

    it('falls back to inside when height is 0 (e.g. JSDOM synthetic drop)', () => {
      expect(getFolderDropZone(0, 0, true)).toBe('inside');
      expect(getFolderDropZone(0, 0, false)).toBe('inside');
    });
  });

  describe('isFolderSelfOrDescendant', () => {
    const tree: chrome.bookmarks.BookmarkTreeNode[] = [
      {
        id: 'space-root',
        title: 'Home',
        children: [
          {
            id: 'f-parent',
            title: 'Parent',
            children: [
              {
                id: 'f-child',
                title: 'Child',
                children: [
                  {
                    id: 'f-grandchild',
                    title: 'Grandchild',
                    children: []
                  }
                ]
              }
            ]
          },
          {
            id: 'f-sibling',
            title: 'Sibling',
            children: []
          }
        ]
      }
    ];

    it('detects self and nested descendants while allowing siblings and ancestors', () => {
      expect(isFolderSelfOrDescendant(tree, 'f-parent', 'f-parent')).toBe(true);
      expect(isFolderSelfOrDescendant(tree, 'f-parent', 'f-child')).toBe(true);
      expect(isFolderSelfOrDescendant(tree, 'f-parent', 'f-grandchild')).toBe(true);

      expect(isFolderSelfOrDescendant(tree, 'f-parent', 'f-sibling')).toBe(false);
      expect(isFolderSelfOrDescendant(tree, 'f-child', 'f-parent')).toBe(false);
      expect(isFolderSelfOrDescendant(tree, 'f-parent', 'space-root')).toBe(false);
    });
  });

  describe('stampBookmarkTreeIndices & optimistic tree mutations', () => {
    const makeSampleRoot = (): chrome.bookmarks.BookmarkTreeNode =>
      stampBookmarkTreeIndices({
        id: 'root',
        title: 'Home',
        children: [
          { id: 'qa', title: 'Quick Access', children: [] },
          { id: 'f1', title: 'Folder 1', children: [] },
          { id: 'b1', title: 'Bookmark 1', url: 'https://one.com' },
          { id: 'f2', title: 'Folder 2', children: [] }
        ]
      });

    it('moves an earlier item to the very last position using Chromium pre-removal index semantics', () => {
      const root = makeSampleRoot();
      const f1 = root.children![1];
      // Pre-removal slot after f2 (index 3) is 4 (= children.length)
      const moved = optimisticallyMoveInTree(root, [f1], 'root', 4);
      expect(moved.children?.map((c) => c.id)).toEqual(['qa', 'b1', 'f2', 'f1']);
      expect(moved.children?.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    });

    it('moves a later item upward between earlier siblings and stamps accurate indices', () => {
      const root = makeSampleRoot();
      const f2 = root.children![3];
      // Insert before f1 (index 1)
      const moved = optimisticallyMoveInTree(root, [f2], 'root', 1);
      expect(moved.children?.map((c) => c.id)).toEqual(['qa', 'f2', 'f1', 'b1']);
      expect(moved.children?.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    });

    it('treats dropping at oldIndex or oldIndex + 1 as a no-op', () => {
      const root = makeSampleRoot();
      const b1 = root.children![2];
      expect(optimisticallyMoveInTree(root, [b1], 'root', 2).children?.map((c) => c.id)).toEqual([
        'qa',
        'f1',
        'b1',
        'f2'
      ]);
      expect(optimisticallyMoveInTree(root, [b1], 'root', 3).children?.map((c) => c.id)).toEqual([
        'qa',
        'f1',
        'b1',
        'f2'
      ]);
    });

    it('inserts newly created bookmarks at an exact slot and deduplicates by id', () => {
      const root = makeSampleRoot();
      const newBm: chrome.bookmarks.BookmarkTreeNode = {
        id: 'b-new',
        title: 'Pinned Tab',
        url: 'https://pinned.com'
      };
      const once = optimisticallyInsertIntoTree(root, [newBm], 'root', 2);
      const twice = optimisticallyInsertIntoTree(once, [newBm], 'root', 2);
      expect(twice.children?.map((c) => c.id)).toEqual(['qa', 'f1', 'b-new', 'b1', 'f2']);
      expect(twice.children?.find((c) => c.id === 'b-new')?.parentId).toBe('root');
    });
  });

  describe('drag session store & parseDragPayload', () => {
    it('tracks active drag session, sets body[data-dragging], and falls back cleanly in parseDragPayload', () => {
      expect(getActiveDrag()).toBeNull();
      expect(document.body.dataset.dragging).toBeUndefined();

      startDragSession({ type: 'folder', id: 'folder-9', parentId: 'root', index: 2 });
      expect(getActiveDrag()).toEqual({
        type: 'folder',
        id: 'folder-9',
        parentId: 'root',
        index: 2
      });
      expect(document.body.dataset.dragging).toBe('true');

      // Fallback when dataTransfer returns empty string
      const fallback = parseDragPayload({
        dataTransfer: { getData: () => '' } as unknown as DataTransfer
      });
      expect(fallback).toEqual({
        type: 'folder',
        id: 'folder-9',
        parentId: 'root',
        index: 2
      });

      endDragSession();
      expect(getActiveDrag()).toBeNull();
      expect(document.body.dataset.dragging).toBeUndefined();
    });
  });
});
