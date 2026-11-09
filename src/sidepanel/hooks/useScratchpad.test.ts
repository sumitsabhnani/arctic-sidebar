import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useScratchpad,
  splitIntoChunks,
  assembleChunks,
  reconcileScratchpadStorageAndBookmark,
  MAX_CHARS,
  SCRATCHPAD_META_KEY,
  SCRATCHPAD_CHUNK_PREFIX,
  SCRATCHPAD_LOCAL_DRAFT_KEY
} from './useScratchpad';
import { mockChrome } from '../../test/setup';

describe('useScratchpad and chunking helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('splitIntoChunks and assembleChunks', () => {
    it('handles empty text correctly', () => {
      const { chunks, chunkCount } = splitIntoChunks('');
      expect(chunkCount).toBe(0);
      expect(chunks).toEqual([]);
      expect(assembleChunks({}, 0)).toBe('');
    });

    it('splits text below chunk size into 1 chunk', () => {
      const smallText = 'Hello Arctic Scratchpad!';
      const { chunks, chunkCount } = splitIntoChunks(smallText);
      expect(chunkCount).toBe(1);
      expect(chunks).toEqual([smallText]);

      const record = { [`${SCRATCHPAD_CHUNK_PREFIX}0`]: smallText };
      expect(assembleChunks(record, 1)).toBe(smallText);
    });

    it('splits text larger than 7000 chars into multiple chunks', () => {
      const chunk1 = 'A'.repeat(7000);
      const chunk2 = 'B'.repeat(3000);
      const longText = chunk1 + chunk2;

      const { chunks, chunkCount } = splitIntoChunks(longText);
      expect(chunkCount).toBe(2);
      expect(chunks[0]).toBe(chunk1);
      expect(chunks[1]).toBe(chunk2);

      const record = {
        [`${SCRATCHPAD_CHUNK_PREFIX}0`]: chunk1,
        [`${SCRATCHPAD_CHUNK_PREFIX}1`]: chunk2
      };
      expect(assembleChunks(record, 2)).toBe(longText);
    });

    it('caps text at MAX_CHARS (28,000 characters)', () => {
      const overlyLongText = 'X'.repeat(35000);
      const { chunks, chunkCount } = splitIntoChunks(overlyLongText);
      expect(chunkCount).toBe(4);
      const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      expect(totalLen).toBe(MAX_CHARS);
    });
  });

  describe('useScratchpad hook lifecycle and sync', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('updates text state and saves local draft immediately on keystroke, debouncing sync', async () => {
      const { result } = renderHook(() => useScratchpad());

      await act(async () => {
        result.current.setText('Immediate typing note');
      });

      expect(result.current.text).toBe('Immediate typing note');
      expect(result.current.syncStatus).toBe('Saving...');

      // Fast local draft is updated immediately
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          [SCRATCHPAD_LOCAL_DRAFT_KEY]: expect.objectContaining({
            text: 'Immediate typing note'
          })
        })
      );

      // Storage.sync has not been called before 1000ms debounce
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();

      // Advance debounce timer by 1000ms
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      // Storage.sync is now called with chunked payload
      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          [SCRATCHPAD_META_KEY]: expect.objectContaining({
            chunkCount: 1
          }),
          [`${SCRATCHPAD_CHUNK_PREFIX}0`]: 'Immediate typing note'
        })
      );

      expect(result.current.syncStatus).toBe('Synced');
    });

    it('clears scratchpad text, updates local draft and sync immediately', async () => {
      const { result } = renderHook(() => useScratchpad());

      await act(async () => {
        result.current.setText('To be deleted');
        vi.advanceTimersByTime(1000);
      });

      await act(async () => {
        result.current.clearScratchpad();
      });

      expect(result.current.text).toBe('');
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          [SCRATCHPAD_LOCAL_DRAFT_KEY]: expect.objectContaining({
            text: ''
          })
        })
      );
    });

    it('toggles isOpen drawer state', async () => {
      const { result } = renderHook(() => useScratchpad());
      expect(result.current.isOpen).toBe(false);

      act(() => {
        result.current.toggleOpen();
      });
      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.setIsOpen(false);
      });
      expect(result.current.isOpen).toBe(false);
    });

    it('restores scratchpad note from bookmark backup when storage was wiped (reinstall scenario)', async () => {
      // Mock an existing bookmark with encoded note hash
      const mockBookmarks = [
        {
          id: 'bm-backup',
          title: 'Scratchpad Backup',
          url: 'https://arctic.local/scratchpad#Restored%20From%20Reinstall%20Backup'
        }
      ];
      vi.mocked(chrome.bookmarks.search).mockResolvedValueOnce(mockBookmarks as unknown as chrome.bookmarks.BookmarkTreeNode[]);

      const { result } = renderHook(() => useScratchpad());

      // Fast forward async loadInitial
      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(100);
      });

      expect(result.current.text).toBe('Restored From Reinstall Backup');
      expect(result.current.syncStatus).toBe('Synced');
    });

    it('restores scratchpad note from Arctic folder via direct tree inspection even if bookmarks.search returns empty', async () => {
      mockChrome.__setBookmarksTree([
        {
          id: '0',
          title: 'Root',
          children: [
            { id: '1', title: 'Bookmarks Bar', children: [] },
            {
              id: '2',
              title: 'Other Bookmarks',
              children: [
                {
                  id: '10',
                  title: 'Arctic',
                  children: [
                    {
                      id: 'bm-tree-backup',
                      parentId: '10',
                      title: 'Scratchpad Backup',
                      url: 'https://arctic.local/scratchpad#Direct%20Tree%20Recovery%20Note'
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]);
      vi.mocked(chrome.bookmarks.search).mockResolvedValue([]);

      const { result } = renderHook(() => useScratchpad());

      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(100);
      });

      expect(result.current.text).toBe('Direct Tree Recovery Note');
    });

    it('restores from bookmark backup even if storage.sync has an empty scratchpad_meta record', async () => {
      await chrome.storage.sync.set({
        [SCRATCHPAD_META_KEY]: { updatedAt: 1000, chunkCount: 0 }
      });
      mockChrome.__setBookmarksTree([
        {
          id: '0',
          title: 'Root',
          children: [
            {
              id: '2',
              title: 'Other Bookmarks',
              children: [
                {
                  id: '10',
                  title: 'Arctic',
                  children: [
                    {
                      id: 'bm-empty-rescue',
                      parentId: '10',
                      title: 'Scratchpad Backup',
                      url: 'https://arctic.local/scratchpad#Rescued%20When%20Meta%20Empty'
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]);

      const { result } = renderHook(() => useScratchpad());

      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(100);
      });

      expect(result.current.text).toBe('Rescued When Meta Empty');
    });

    it('automatically mirrors existing storage.sync notes to bookmark backup on initial load without requiring user edits', async () => {
      await chrome.storage.sync.set({
        [SCRATCHPAD_META_KEY]: { updatedAt: 5000, chunkCount: 1 },
        [`${SCRATCHPAD_CHUNK_PREFIX}0`]: 'Existing Pre-Update Note'
      });

      const { result } = renderHook(() => useScratchpad());

      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(100);
      });

      expect(result.current.text).toBe('Existing Pre-Update Note');
      expect(chrome.bookmarks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Scratchpad Backup',
          url: 'https://arctic.local/scratchpad#Existing%20Pre-Update%20Note'
        })
      );
    });

    it('reconcileScratchpadStorageAndBookmark backs up storage on update and restores from bookmark on reinstall', async () => {
      // 1. Pre-existing note in storage gets backed up to bookmark
      await chrome.storage.local.set({
        [SCRATCHPAD_LOCAL_DRAFT_KEY]: {
          text: 'Service Worker Reconciled Note',
          updatedAt: 9000
        }
      });

      const backedUp = await reconcileScratchpadStorageAndBookmark();
      expect(backedUp).toBe('Service Worker Reconciled Note');

      // 2. Simulate extension reinstall: wipe both local and sync storage while keeping bookmarks tree
      mockChrome.__setLocalStorage({});
      mockChrome.__setSyncStorage({});

      const restored = await reconcileScratchpadStorageAndBookmark();
      expect(restored).toBe('Service Worker Reconciled Note');

      const localAfter = await chrome.storage.local.get(SCRATCHPAD_LOCAL_DRAFT_KEY);
      expect((localAfter[SCRATCHPAD_LOCAL_DRAFT_KEY] as { text: string }).text).toBe(
        'Service Worker Reconciled Note'
      );
    });

    it('copies scratchpad text to clipboard', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock
        }
      });

      const { result } = renderHook(() => useScratchpad());
      act(() => {
        result.current.setText('Copy this clipboard test');
      });

      let copied = false;
      await act(async () => {
        copied = await result.current.copyScratchpad();
      });

      expect(copied).toBe(true);
      expect(writeTextMock).toHaveBeenCalledWith('Copy this clipboard test');
    });
  });
});
