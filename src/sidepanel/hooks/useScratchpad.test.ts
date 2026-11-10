import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useScratchpad,
  splitIntoChunks,
  assembleChunks,
  reconcileScratchpadStorageAndBookmark,
  resolveScratchpad,
  readSyncScratchpad,
  writeSyncScratchpad,
  classifySyncError,
  hashText,
  jsonByteLength,
  ScratchpadTooLargeError,
  MAX_CHARS,
  MAX_CHUNKS,
  SYNC_DEBOUNCE_MS,
  SYNC_ITEM_QUOTA_BYTES,
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

    it('splits text larger than one chunk into multiple chunks that fit the sync item quota', () => {
      const longText = 'A'.repeat(7000) + 'B'.repeat(3000);

      const { chunks, chunkCount } = splitIntoChunks(longText);
      expect(chunkCount).toBe(2);
      expect(chunks.join('')).toBe(longText);
      chunks.forEach((c, i) => {
        expect(jsonByteLength(c) + `${SCRATCHPAD_CHUNK_PREFIX}${i}`.length).toBeLessThanOrEqual(
          SYNC_ITEM_QUOTA_BYTES
        );
      });

      const record = {
        [`${SCRATCHPAD_CHUNK_PREFIX}0`]: chunks[0],
        [`${SCRATCHPAD_CHUNK_PREFIX}1`]: chunks[1]
      };
      expect(assembleChunks(record, 2)).toBe(longText);
    });

    it('splits multi-byte text by UTF-8 byte size so no chunk exceeds QUOTA_BYTES_PER_ITEM', () => {
      // 7,000 CJK chars = 21,000 UTF-8 bytes: previously a single (rejected) 7,000-char chunk
      const cjk = '漢'.repeat(7000);
      const emoji = '😀'.repeat(1500); // surrogate pairs, 4 bytes each
      const escapes = '"\\\n'.repeat(1000); // JSON escapes double the byte size
      const text = cjk + emoji + escapes;

      const { chunks, chunkCount } = splitIntoChunks(text);
      expect(chunkCount).toBeGreaterThan(3);
      expect(chunks.join('')).toBe(text);
      chunks.forEach((c, i) => {
        const itemBytes =
          new TextEncoder().encode(JSON.stringify(c)).length + `${SCRATCHPAD_CHUNK_PREFIX}${i}`.length;
        expect(itemBytes).toBeLessThanOrEqual(SYNC_ITEM_QUOTA_BYTES);
        expect(jsonByteLength(c)).toBe(new TextEncoder().encode(JSON.stringify(c)).length);
        // Never splits a surrogate pair
        expect(/^[\uDC00-\uDFFF]/.test(c)).toBe(false);
        expect(/[\uD800-\uDBFF]$/.test(c)).toBe(false);
      });
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

      // Storage.sync has not been called before the debounce elapses
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();

      // Advance debounce timer
      await act(async () => {
        vi.advanceTimersByTime(SYNC_DEBOUNCE_MS);
      });

      // Storage.sync is now called with chunked payload
      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          [SCRATCHPAD_META_KEY]: expect.objectContaining({
            chunkCount: 1,
            hash: hashText('Immediate typing note')
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

  describe('sync storage helpers', () => {
    it('resolveScratchpad: an intentional clear (hashed empty meta) beats an older local draft', () => {
      const resolved = resolveScratchpad(
        { text: 'Old note', updatedAt: 100 },
        { meta: { updatedAt: 200, chunkCount: 0, hash: hashText('') }, text: '', complete: true }
      );
      expect(resolved).toEqual({ text: '', updatedAt: 200, source: 'sync' });
    });

    it('resolveScratchpad: a legacy empty meta does not override local text, and the push gets a newer timestamp', () => {
      const resolved = resolveScratchpad(
        { text: 'Local note', updatedAt: 100 },
        { meta: { updatedAt: 500, chunkCount: 0 }, text: '', complete: true }
      );
      expect(resolved).toEqual({ text: 'Local note', updatedAt: 501, source: 'local' });
    });

    it('resolveScratchpad: newer local draft wins over older sync revision', () => {
      const resolved = resolveScratchpad(
        { text: 'Newer local', updatedAt: 300 },
        { meta: { updatedAt: 200, chunkCount: 1, hash: hashText('Older sync') }, text: 'Older sync', complete: true }
      );
      expect(resolved).toEqual({ text: 'Newer local', updatedAt: 300, source: 'local' });
    });

    it('resolveScratchpad: partially-arrived sync revision is reported as pending', () => {
      const resolved = resolveScratchpad(
        { text: 'Local', updatedAt: 100 },
        { meta: { updatedAt: 200, chunkCount: 2, hash: 'x' }, text: 'partial', complete: false }
      );
      expect(resolved.source).toBe('pending');
      expect(resolved.text).toBe('Local');
    });

    it('readSyncScratchpad flags revisions whose chunks do not match the meta hash', async () => {
      mockChrome.__setSyncStorage({
        [SCRATCHPAD_META_KEY]: { updatedAt: 10, chunkCount: 1, hash: hashText('New text') },
        [`${SCRATCHPAD_CHUNK_PREFIX}0`]: 'Old text'
      });
      const snapshot = await readSyncScratchpad();
      expect(snapshot.complete).toBe(false);
    });

    it('writeSyncScratchpad writes new chunks before removing stale ones', async () => {
      mockChrome.__setSyncStorage({
        [SCRATCHPAD_META_KEY]: { updatedAt: 1, chunkCount: 3 },
        [`${SCRATCHPAD_CHUNK_PREFIX}0`]: 'a',
        [`${SCRATCHPAD_CHUNK_PREFIX}1`]: 'b',
        [`${SCRATCHPAD_CHUNK_PREFIX}2`]: 'c'
      });

      await writeSyncScratchpad('short', 2);

      const sync = mockChrome.__getSyncStorage();
      expect(sync[`${SCRATCHPAD_CHUNK_PREFIX}0`]).toBe('short');
      expect(sync[`${SCRATCHPAD_CHUNK_PREFIX}1`]).toBeUndefined();
      expect(sync[`${SCRATCHPAD_CHUNK_PREFIX}2`]).toBeUndefined();
      expect(sync[SCRATCHPAD_META_KEY]).toEqual({ updatedAt: 2, chunkCount: 1, hash: hashText('short') });

      const setOrder = vi.mocked(chrome.storage.sync.set).mock.invocationCallOrder[0];
      const removeOrder = vi.mocked(chrome.storage.sync.remove).mock.invocationCallOrder[0];
      expect(setOrder).toBeLessThan(removeOrder);
    });

    it('writeSyncScratchpad rejects notes that cannot fit in MAX_CHUNKS without touching storage', async () => {
      const huge = '漢'.repeat(MAX_CHARS);
      expect(splitIntoChunks(huge).chunkCount).toBeGreaterThan(MAX_CHUNKS);
      await expect(writeSyncScratchpad(huge, 1)).rejects.toBeInstanceOf(ScratchpadTooLargeError);
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    });

    it('classifySyncError distinguishes quota-size errors from retryable rate limits', () => {
      expect(classifySyncError(new Error('QUOTA_BYTES_PER_ITEM quota exceeded'), 0).tooLarge).toBe(true);
      expect(classifySyncError(new ScratchpadTooLargeError(), 0).tooLarge).toBe(true);

      const perMinute = classifySyncError(new Error('exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota'), 0);
      expect(perMinute.tooLarge).toBe(false);
      expect(perMinute.retryDelayMs).toBeGreaterThanOrEqual(60000);

      const generic = classifySyncError(new Error('boom'), 2);
      expect(generic.tooLarge).toBe(false);
      expect(generic.retryDelayMs).toBe(20000);
    });

    it('reconcileScratchpadStorageAndBookmark propagates an intentional clear instead of resurrecting the old draft', async () => {
      mockChrome.__setLocalStorage({
        [SCRATCHPAD_LOCAL_DRAFT_KEY]: { text: 'Stale draft', updatedAt: 100 }
      });
      mockChrome.__setSyncStorage({
        [SCRATCHPAD_META_KEY]: { updatedAt: 200, chunkCount: 0, hash: hashText('') }
      });

      const result = await reconcileScratchpadStorageAndBookmark();

      expect(result).toBe('');
      expect(mockChrome.__getLocalStorage()[SCRATCHPAD_LOCAL_DRAFT_KEY]).toEqual({ text: '', updatedAt: 200 });
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    });

    it('reconcileScratchpadStorageAndBookmark stamps bookmark-restored text with updatedAt 0', async () => {
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
                      id: 'bm',
                      parentId: '10',
                      title: 'Scratchpad Backup',
                      url: 'https://arctic.local/scratchpad#Bookmark%20copy'
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]);

      await reconcileScratchpadStorageAndBookmark();

      const meta = mockChrome.__getSyncStorage()[SCRATCHPAD_META_KEY] as { updatedAt: number };
      expect(meta.updatedAt).toBe(0);
      expect(mockChrome.__getLocalStorage()[SCRATCHPAD_LOCAL_DRAFT_KEY]).toEqual({
        text: 'Bookmark copy',
        updatedAt: 0
      });
    });
  });

  describe('cross-device sync behaviour', () => {
    const flush = async () => {
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    async function renderLoaded() {
      const hook = renderHook(() => useScratchpad());
      await act(async () => {
        await flush();
      });
      return hook;
    }

    it('waits for all chunks before applying a remote revision whose meta arrived first', async () => {
      const { result } = await renderLoaded();
      const remoteText = 'Remote note from another device';
      const remoteTime = Date.now() + 10000;

      // Meta arrives before its chunk
      await act(async () => {
        await chrome.storage.sync.set({
          [SCRATCHPAD_META_KEY]: { updatedAt: remoteTime, chunkCount: 1, hash: hashText(remoteText) }
        });
        await flush();
      });
      expect(result.current.text).toBe('');

      // Chunk arrives in a later change event
      await act(async () => {
        await chrome.storage.sync.set({ [`${SCRATCHPAD_CHUNK_PREFIX}0`]: remoteText });
        await flush();
      });
      expect(result.current.text).toBe(remoteText);
    });

    it('stamps local edits after a remote revision with a newer timestamp, even if the remote clock is ahead', async () => {
      const { result } = await renderLoaded();
      const aheadTime = Date.now() + 60 * 60 * 1000; // other device's clock is an hour ahead

      await act(async () => {
        await chrome.storage.sync.set({
          [SCRATCHPAD_META_KEY]: { updatedAt: aheadTime, chunkCount: 1, hash: hashText('Remote') },
          [`${SCRATCHPAD_CHUNK_PREFIX}0`]: 'Remote'
        });
        await flush();
      });
      expect(result.current.text).toBe('Remote');

      await act(async () => {
        result.current.setText('Remote + local edit');
      });
      await act(async () => {
        vi.advanceTimersByTime(SYNC_DEBOUNCE_MS);
        await flush();
      });

      const sync = mockChrome.__getSyncStorage();
      expect((sync[SCRATCHPAD_META_KEY] as { updatedAt: number }).updatedAt).toBeGreaterThan(aheadTime);
      expect(sync[`${SCRATCHPAD_CHUNK_PREFIX}0`]).toBe('Remote + local edit');
    });

    it('a newer remote revision cancels a pending local write instead of being overwritten by it', async () => {
      const { result } = await renderLoaded();

      await act(async () => {
        result.current.setText('Local typing');
      });

      await act(async () => {
        await chrome.storage.sync.set({
          [SCRATCHPAD_META_KEY]: { updatedAt: Date.now() + 5000, chunkCount: 1, hash: hashText('Remote wins') },
          [`${SCRATCHPAD_CHUNK_PREFIX}0`]: 'Remote wins'
        });
        await flush();
      });

      await act(async () => {
        vi.advanceTimersByTime(SYNC_DEBOUNCE_MS);
        await flush();
      });

      expect(result.current.text).toBe('Remote wins');
      expect(mockChrome.__getSyncStorage()[`${SCRATCHPAD_CHUNK_PREFIX}0`]).toBe('Remote wins');
    });

    it('loads an intentional clear from sync instead of restoring the old draft or bookmark', async () => {
      mockChrome.__setLocalStorage({
        [SCRATCHPAD_LOCAL_DRAFT_KEY]: { text: 'Old draft', updatedAt: 100 }
      });
      mockChrome.__setSyncStorage({
        [SCRATCHPAD_META_KEY]: { updatedAt: 200, chunkCount: 0, hash: hashText('') }
      });
      vi.mocked(chrome.bookmarks.search).mockResolvedValueOnce([
        { id: 'bm', title: 'Scratchpad Backup', url: 'https://arctic.local/scratchpad#Old%20draft' }
      ] as unknown as chrome.bookmarks.BookmarkTreeNode[]);

      const { result } = await renderLoaded();

      expect(result.current.text).toBe('');
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    });

    it('retries a rate-limited sync write and recovers', async () => {
      const { result } = await renderLoaded();
      vi.mocked(chrome.storage.sync.set).mockRejectedValueOnce(
        new Error('This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.')
      );

      await act(async () => {
        result.current.setText('Rate limited note');
      });
      await act(async () => {
        vi.advanceTimersByTime(SYNC_DEBOUNCE_MS);
        await flush();
      });
      expect(result.current.syncStatus).toBe('Retrying sync...');
      expect(mockChrome.__getSyncStorage()[`${SCRATCHPAD_CHUNK_PREFIX}0`]).toBeUndefined();

      await act(async () => {
        vi.advanceTimersByTime(60000);
        await flush();
      });
      expect(result.current.syncStatus).toBe('Synced');
      expect(mockChrome.__getSyncStorage()[`${SCRATCHPAD_CHUNK_PREFIX}0`]).toBe('Rate limited note');
    });

    it('debounces the bookmark backup mirror together with the sync write', async () => {
      const { result } = await renderLoaded();

      await act(async () => {
        result.current.setText('a');
        result.current.setText('ab');
        result.current.setText('abc');
        await flush();
      });
      expect(chrome.bookmarks.create).not.toHaveBeenCalled();
      expect(chrome.bookmarks.update).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(SYNC_DEBOUNCE_MS);
        await flush();
      });
      expect(chrome.bookmarks.create).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://arctic.local/scratchpad#abc' })
      );
    });

    it('a remote revision applies over a bookmark-restored note after reinstall', async () => {
      vi.mocked(chrome.bookmarks.search).mockResolvedValueOnce([
        { id: 'bm', title: 'Scratchpad Backup', url: 'https://arctic.local/scratchpad#Stale%20bookmark' }
      ] as unknown as chrome.bookmarks.BookmarkTreeNode[]);

      const { result } = await renderLoaded();
      expect(result.current.text).toBe('Stale bookmark');
      expect((mockChrome.__getSyncStorage()[SCRATCHPAD_META_KEY] as { updatedAt: number }).updatedAt).toBe(0);

      // The real (older wall-clock) revision arrives from Chrome Sync afterwards
      await act(async () => {
        await chrome.storage.sync.set({
          [SCRATCHPAD_META_KEY]: { updatedAt: 5, chunkCount: 1, hash: hashText('Latest real note') },
          [`${SCRATCHPAD_CHUNK_PREFIX}0`]: 'Latest real note'
        });
        await flush();
      });
      expect(result.current.text).toBe('Latest real note');
    });
  });
});
