import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useScratchpad,
  splitIntoChunks,
  assembleChunks,
  MAX_CHARS,
  SCRATCHPAD_META_KEY,
  SCRATCHPAD_CHUNK_PREFIX,
  SCRATCHPAD_LOCAL_DRAFT_KEY
} from './useScratchpad';

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
      vi.mocked(chrome.bookmarks.search).mockResolvedValue(mockBookmarks as unknown as chrome.bookmarks.BookmarkTreeNode[]);

      const { result } = renderHook(() => useScratchpad());

      // Fast forward async loadInitial
      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(100);
      });

      expect(result.current.text).toBe('Restored From Reinstall Backup');
      expect(result.current.syncStatus).toBe('Synced');
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
