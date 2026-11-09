import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ARCTIC_GLOBAL_SCRATCHPAD_URL,
  encodeNoteHash,
  extractNoteContentFromUrl,
  isScratchpadUrl
} from '../utils/url';

export const CHUNK_SIZE = 7000;
export const MAX_CHUNKS = 4;
export const MAX_CHARS = CHUNK_SIZE * MAX_CHUNKS; // 28,000 chars

export const SCRATCHPAD_META_KEY = 'scratchpad_meta';
export const SCRATCHPAD_LOCAL_DRAFT_KEY = 'scratchpad_local_draft';
export const SCRATCHPAD_CHUNK_PREFIX = 'scratchpad_chunk_';
export const SCRATCHPAD_BACKUP_TITLE = 'Scratchpad Backup';

export interface ScratchpadMeta {
  updatedAt: number;
  chunkCount: number;
}

export interface ScratchpadLocalDraft {
  text: string;
  updatedAt: number;
}

export type ScratchpadSyncStatus = 'Synced' | 'Saving...' | 'Offline - Saved locally';

/**
 * Split plain text into up to 4 chunks of max 7,000 characters each.
 */
export function splitIntoChunks(text: string): { chunks: string[]; chunkCount: number } {
  const bounded = text.slice(0, MAX_CHARS);
  if (!bounded) {
    return { chunks: [], chunkCount: 0 };
  }
  const chunks: string[] = [];
  const chunkCount = Math.ceil(bounded.length / CHUNK_SIZE);
  for (let i = 0; i < chunkCount; i++) {
    chunks.push(bounded.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
  }
  return { chunks, chunkCount };
}

/**
 * Reassemble text from chunk dictionary
 */
export function assembleChunks(items: Record<string, unknown>, chunkCount: number): string {
  let assembled = '';
  for (let i = 0; i < chunkCount; i++) {
    const chunk = items[`${SCRATCHPAD_CHUNK_PREFIX}${i}`];
    if (typeof chunk === 'string') {
      assembled += chunk;
    }
  }
  return assembled;
}

function isScratchpadBackupNode(node: chrome.bookmarks.BookmarkTreeNode): boolean {
  if (!node.url) return false;
  return (
    node.url.includes('arctic.local/scratchpad') ||
    isScratchpadUrl(node.url) ||
    node.title === SCRATCHPAD_BACKUP_TITLE
  );
}

/**
 * Locate all scratchpad backup bookmarks using both direct bookmark tree inspection
 * (under Other Bookmarks / Arctic and root folders) and chrome.bookmarks.search fallbacks.
 */
export async function findScratchpadBackupBookmarks(): Promise<{
  bookmarks: chrome.bookmarks.BookmarkTreeNode[];
  arcticFolderId: string | null;
  otherFolderId: string | null;
}> {
  const seenIds = new Set<string>();
  const bookmarks: chrome.bookmarks.BookmarkTreeNode[] = [];
  let arcticFolderId: string | null = null;
  let otherFolderId: string | null = null;

  const addMatch = (node: chrome.bookmarks.BookmarkTreeNode) => {
    if (node && node.id && !seenIds.has(node.id) && isScratchpadBackupNode(node)) {
      seenIds.add(node.id);
      bookmarks.push(node);
    }
  };

  // 1. Direct tree inspection (immune to chrome.bookmarks.search URL tokenizer / truncation quirks)
  if (typeof chrome !== 'undefined' && chrome.bookmarks?.getChildren) {
    try {
      const roots = await chrome.bookmarks.getChildren('0');
      const otherNode =
        roots.find((r) => r.id === '2' || r.title.toLowerCase().includes('other')) ||
        roots[1] ||
        roots[0];

      if (otherNode) {
        otherFolderId = otherNode.id;
      }

      // Inspect Other Bookmarks first, then any remaining root folders
      const orderedRoots = otherNode
        ? [otherNode, ...roots.filter((r) => r.id !== otherNode.id)]
        : roots;

      for (const root of orderedRoots) {
        try {
          const children = await chrome.bookmarks.getChildren(root.id);
          const legacyPrefix = 'Ar' + 'c Sidebar';
          const arcticFolders = children.filter(
            (c) =>
              !c.url &&
              (c.title === 'Arctic' || c.title === 'Arctic Sidebar' || c.title === legacyPrefix)
          );

          for (const af of arcticFolders) {
            if (!arcticFolderId) {
              arcticFolderId = af.id;
            }
            try {
              const arcticChildren = await chrome.bookmarks.getChildren(af.id);
              for (const ac of arcticChildren) {
                addMatch(ac);
              }
            } catch {
              // ignore
            }
          }

          for (const child of children) {
            addMatch(child);
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Search API fallback (covers custom folder locations and unit test mocks)
  if (typeof chrome !== 'undefined' && chrome.bookmarks?.search) {
    try {
      const urlMatches = await chrome.bookmarks.search('arctic.local/scratchpad');
      if (Array.isArray(urlMatches)) {
        for (const m of urlMatches) {
          addMatch(m);
        }
      }
    } catch {
      // ignore
    }

    if (bookmarks.length === 0) {
      try {
        const titleMatches = await chrome.bookmarks.search(SCRATCHPAD_BACKUP_TITLE);
        if (Array.isArray(titleMatches)) {
          for (const m of titleMatches) {
            addMatch(m);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return { bookmarks, arcticFolderId, otherFolderId };
}

let bookmarkMirrorLock: Promise<void> = Promise.resolve();

/**
 * Mirror scratchpad content to the backup bookmark in Other Bookmarks / Arctic.
 * Serialized via bookmarkMirrorLock and deduplicates any redundant backup bookmarks.
 */
export function mirrorScratchpadToBookmark(contentToSave: string): Promise<void> {
  const bounded = contentToSave.slice(0, MAX_CHARS);
  bookmarkMirrorLock = bookmarkMirrorLock
    .catch(() => {})
    .then(async () => {
      if (typeof chrome === 'undefined' || !chrome.bookmarks) return;

      try {
        const { bookmarks, arcticFolderId, otherFolderId } = await findScratchpadBackupBookmarks();
        const newUrl = bounded
          ? `${ARCTIC_GLOBAL_SCRATCHPAD_URL}#${encodeNoteHash(bounded)}`
          : ARCTIC_GLOBAL_SCRATCHPAD_URL;

        const createBackupBookmark = async () => {
          if (!bounded || !chrome.bookmarks.create) return;
          let parentId = arcticFolderId || otherFolderId || '2';
          if (!arcticFolderId && otherFolderId) {
            try {
              const createdArctic = await chrome.bookmarks.create({
                parentId: otherFolderId,
                title: 'Arctic'
              });
              parentId = createdArctic.id;
            } catch {
              parentId = otherFolderId;
            }
          }

          await chrome.bookmarks.create({
            parentId,
            title: SCRATCHPAD_BACKUP_TITLE,
            url: newUrl
          });
        };

        if (bookmarks.length > 0) {
          // Prefer a bookmark that already has content or is inside the Arctic folder
          const primary =
            bookmarks.find((b) => b.parentId === arcticFolderId && extractNoteContentFromUrl(b.url)) ||
            bookmarks.find((b) => Boolean(extractNoteContentFromUrl(b.url))) ||
            bookmarks.find((b) => b.parentId === arcticFolderId) ||
            bookmarks[0];

          if (primary.url !== newUrl && chrome.bookmarks.update) {
            try {
              await chrome.bookmarks.update(primary.id, { url: newUrl });
            } catch {
              await createBackupBookmark();
            }
          }

          // Clean up any duplicate Scratchpad Backup bookmarks so stale/empty nodes never shadow the primary
          if (bookmarks.length > 1 && chrome.bookmarks.remove) {
            for (const dup of bookmarks) {
              if (dup.id !== primary.id) {
                try {
                  await chrome.bookmarks.remove(dup.id);
                } catch {
                  // ignore
                }
              }
            }
          }
        } else {
          await createBackupBookmark();
        }
      } catch (bmErr) {
        console.warn('[Arctic Scratchpad] Failed to mirror note to bookmark backup:', bmErr);
      }
    });

  return bookmarkMirrorLock;
}

/**
 * Restore scratchpad note content from backup bookmark if present.
 * Prefers bookmarks with non-empty hash content in case multiple backup nodes exist.
 */
export async function restoreScratchpadFromBookmark(): Promise<string> {
  try {
    const { bookmarks } = await findScratchpadBackupBookmarks();
    for (const bm of bookmarks) {
      if (bm.url) {
        const restored = extractNoteContentFromUrl(bm.url);
        if (restored) {
          return restored.slice(0, MAX_CHARS);
        }
      }
    }
  } catch (recoveryErr) {
    console.warn('[Arctic Scratchpad] Error restoring from backup bookmark:', recoveryErr);
  }
  return '';
}

/**
 * Background / startup reconciliation helper:
 * - If storage (local or sync) has scratchpad text, ensures both storage areas and the backup bookmark are synced.
 * - If storage is empty (e.g. fresh reinstall), restores from the backup bookmark into local and sync storage.
 */
export async function reconcileScratchpadStorageAndBookmark(): Promise<string> {
  let localDraft: ScratchpadLocalDraft | null = null;
  let syncText = '';
  let syncTime = 0;

  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const localData = await chrome.storage.local.get(SCRATCHPAD_LOCAL_DRAFT_KEY);
      if (localData[SCRATCHPAD_LOCAL_DRAFT_KEY]) {
        localDraft = localData[SCRATCHPAD_LOCAL_DRAFT_KEY] as ScratchpadLocalDraft;
      }
    }
  } catch {
    // ignore
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      const allChunkKeys = [
        SCRATCHPAD_META_KEY,
        `${SCRATCHPAD_CHUNK_PREFIX}0`,
        `${SCRATCHPAD_CHUNK_PREFIX}1`,
        `${SCRATCHPAD_CHUNK_PREFIX}2`,
        `${SCRATCHPAD_CHUNK_PREFIX}3`
      ];
      const syncData = await chrome.storage.sync.get(allChunkKeys);
      const meta = syncData[SCRATCHPAD_META_KEY] as ScratchpadMeta | undefined;
      if (meta && typeof meta.updatedAt === 'number') {
        syncTime = meta.updatedAt;
        syncText = assembleChunks(syncData, meta.chunkCount || 0);
      }
    }
  } catch {
    // ignore
  }

  const localTime = localDraft?.updatedAt || 0;
  const localText = typeof localDraft?.text === 'string' ? localDraft.text : '';

  const resolvedText =
    syncTime >= localTime ? syncText || localText : localText || syncText;
  const resolvedTime = Math.max(syncTime, localTime) || Date.now();

  if (resolvedText) {
    // Ensure local draft, sync chunks, and bookmark backup all have the existing note
    try {
      if (chrome.storage?.local && (!localDraft || localDraft.text !== resolvedText)) {
        await chrome.storage.local.set({
          [SCRATCHPAD_LOCAL_DRAFT_KEY]: {
            text: resolvedText,
            updatedAt: resolvedTime
          } as ScratchpadLocalDraft
        });
      }
    } catch {
      // ignore
    }

    try {
      if (chrome.storage?.sync && syncText !== resolvedText) {
        const { chunks, chunkCount } = splitIntoChunks(resolvedText);
        const payload: Record<string, unknown> = {
          [SCRATCHPAD_META_KEY]: { updatedAt: resolvedTime, chunkCount } as ScratchpadMeta
        };
        for (let i = 0; i < chunkCount; i++) {
          payload[`${SCRATCHPAD_CHUNK_PREFIX}${i}`] = chunks[i];
        }
        await chrome.storage.sync.set(payload);
      }
    } catch {
      // ignore
    }

    await mirrorScratchpadToBookmark(resolvedText);
    return resolvedText;
  }

  // Storage has no text: check bookmark backup (reinstall scenario)
  const restored = await restoreScratchpadFromBookmark();
  if (restored) {
    const now = Date.now();
    try {
      if (chrome.storage?.local) {
        await chrome.storage.local.set({
          [SCRATCHPAD_LOCAL_DRAFT_KEY]: {
            text: restored,
            updatedAt: now
          } as ScratchpadLocalDraft
        });
      }
    } catch {
      // ignore
    }

    try {
      if (chrome.storage?.sync) {
        const { chunks, chunkCount } = splitIntoChunks(restored);
        const payload: Record<string, unknown> = {
          [SCRATCHPAD_META_KEY]: { updatedAt: now, chunkCount } as ScratchpadMeta
        };
        for (let i = 0; i < chunkCount; i++) {
          payload[`${SCRATCHPAD_CHUNK_PREFIX}${i}`] = chunks[i];
        }
        await chrome.storage.sync.set(payload);
      }
    } catch {
      // ignore
    }

    await mirrorScratchpadToBookmark(restored);
    return restored;
  }

  return '';
}

export function useScratchpad() {
  const [text, setTextState] = useState<string>('');
  const [syncStatus, setSyncStatus] = useState<ScratchpadSyncStatus>('Synced');
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedAtRef = useRef<number>(0);
  const lastChunkCountRef = useRef<number>(0);
  const currentTextRef = useRef<string>('');

  currentTextRef.current = text;

  /**
   * Save text to chrome.storage.sync across chunks with local & bookmark backup
   */
  const flushToSync = useCallback(async (contentToSave: string, timestamp = Date.now()) => {
    const { chunks, chunkCount } = splitIntoChunks(contentToSave);
    const meta: ScratchpadMeta = {
      updatedAt: timestamp,
      chunkCount
    };

    const payload: Record<string, unknown> = {
      [SCRATCHPAD_META_KEY]: meta
    };

    // Populate chunks to set
    for (let i = 0; i < chunkCount; i++) {
      payload[`${SCRATCHPAD_CHUNK_PREFIX}${i}`] = chunks[i];
    }

    // Determine unused chunk keys to remove only if chunk count decreased
    const keysToRemove: string[] = [];
    if (chunkCount < lastChunkCountRef.current) {
      for (let i = chunkCount; i < MAX_CHUNKS; i++) {
        keysToRemove.push(`${SCRATCHPAD_CHUNK_PREFIX}${i}`);
      }
    }

    try {
      if (chrome.storage && chrome.storage.sync) {
        if (keysToRemove.length > 0) {
          try {
            await chrome.storage.sync.remove(keysToRemove);
          } catch {
            // ignore removal error if keys don't exist
          }
        }
        await chrome.storage.sync.set(payload);
        lastSavedAtRef.current = timestamp;
        lastChunkCountRef.current = chunkCount;
        setSyncStatus('Synced');
      } else {
        setSyncStatus('Offline - Saved locally');
      }
    } catch (err) {
      console.warn('[Arctic Scratchpad] Failed to save to storage.sync, keeping local backup:', err);
      setSyncStatus('Offline - Saved locally');
    }

    // Always mirror content into bookmark hash even if storage.sync failed or quota was exceeded
    await mirrorScratchpadToBookmark(contentToSave);
  }, []);

  /**
   * Handle user typing / text changes
   */
  const setText = useCallback((newText: string) => {
    const bounded = newText.slice(0, MAX_CHARS);
    setTextState(bounded);
    setSyncStatus('Saving...');

    const timestamp = Date.now();
    lastSavedAtRef.current = timestamp;

    // Fast local draft backup (never lost if sidepanel unloads mid-typing)
    if (chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.set({
          [SCRATCHPAD_LOCAL_DRAFT_KEY]: {
            text: bounded,
            updatedAt: timestamp
          } as ScratchpadLocalDraft
        });
      } catch (err) {
        console.warn('[Arctic Scratchpad] Error saving local draft:', err);
      }
    }

    // Immediately mirror to bookmark backup so closing sidepanel or reinstalling before 1000ms never loses notes
    mirrorScratchpadToBookmark(bounded);

    // Debounce sync write by 1000ms
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      flushToSync(bounded, timestamp);
    }, 1000);
  }, [flushToSync]);

  /**
   * Clear scratchpad content completely
   */
  const clearScratchpad = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    setTextState('');
    setSyncStatus('Saving...');
    const timestamp = Date.now();
    lastSavedAtRef.current = timestamp;

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        [SCRATCHPAD_LOCAL_DRAFT_KEY]: {
          text: '',
          updatedAt: timestamp
        } as ScratchpadLocalDraft
      });
    }

    flushToSync('', timestamp);
  }, [flushToSync]);

  /**
   * Copy scratchpad content to system clipboard
   */
  const copyScratchpad = useCallback(async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(currentTextRef.current);
      return true;
    } catch (err) {
      console.warn('[Arctic Scratchpad] Could not copy to clipboard:', err);
      return false;
    }
  }, []);

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  /**
   * Initial load: reconcile local draft, sync storage, and bookmark backup
   */
  useEffect(() => {
    let isMounted = true;

    async function loadInitial() {
      let localDraft: ScratchpadLocalDraft | null = null;

      // 1. Load fast local draft first
      try {
        if (chrome.storage && chrome.storage.local) {
          const localData = await chrome.storage.local.get(SCRATCHPAD_LOCAL_DRAFT_KEY);
          if (localData[SCRATCHPAD_LOCAL_DRAFT_KEY]) {
            localDraft = localData[SCRATCHPAD_LOCAL_DRAFT_KEY] as ScratchpadLocalDraft;
            if (isMounted && typeof localDraft.text === 'string') {
              setTextState(localDraft.text);
              lastSavedAtRef.current = localDraft.updatedAt || 0;
            }
          }
        }
      } catch (err) {
        console.warn('[Arctic Scratchpad] Error reading initial local draft:', err);
      }

      // 2. Fetch sync storage chunks
      let meta: ScratchpadMeta | undefined;
      let syncAssembled = '';
      try {
        if (chrome.storage && chrome.storage.sync) {
          const allChunkKeys = [
            SCRATCHPAD_META_KEY,
            `${SCRATCHPAD_CHUNK_PREFIX}0`,
            `${SCRATCHPAD_CHUNK_PREFIX}1`,
            `${SCRATCHPAD_CHUNK_PREFIX}2`,
            `${SCRATCHPAD_CHUNK_PREFIX}3`
          ];
          const syncData = await chrome.storage.sync.get(allChunkKeys);
          meta = syncData[SCRATCHPAD_META_KEY] as ScratchpadMeta | undefined;
          if (meta && typeof meta.updatedAt === 'number') {
            syncAssembled = assembleChunks(syncData, meta.chunkCount || 0);
          }
        }
      } catch (err) {
        console.warn('[Arctic Scratchpad] Error loading from storage.sync:', err);
        if (isMounted) {
          setSyncStatus('Offline - Saved locally');
        }
      }

      const syncTime = meta && typeof meta.updatedAt === 'number' ? meta.updatedAt : 0;
      const localTime = localDraft?.updatedAt || 0;
      const localText = typeof localDraft?.text === 'string' ? localDraft.text : '';

      if (meta && typeof meta.updatedAt === 'number' && syncTime >= localTime && syncAssembled) {
        if (isMounted) {
          setTextState(syncAssembled);
          lastSavedAtRef.current = syncTime;
          lastChunkCountRef.current = meta.chunkCount || 0;
          setSyncStatus('Synced');
          if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({
              [SCRATCHPAD_LOCAL_DRAFT_KEY]: {
                text: syncAssembled,
                updatedAt: syncTime
              } as ScratchpadLocalDraft
            });
          }
        }
        // Ensure existing synced notes are mirrored into the backup bookmark for reinstall retention
        await mirrorScratchpadToBookmark(syncAssembled);
      } else if (localText) {
        // Local draft is newer than sync (or sync has no text yet): flush local draft to sync & bookmark
        if (isMounted) {
          await flushToSync(localText, localDraft?.updatedAt || Date.now());
        }
      } else {
        // 3. Fallback: Both local and sync storage have no text (reinstall scenario) - restore from bookmark hash if present
        const restored = await restoreScratchpadFromBookmark();
        if (restored && isMounted) {
          const now = Date.now();
          setTextState(restored);
          lastSavedAtRef.current = now;
          setSyncStatus('Synced');
          if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({
              [SCRATCHPAD_LOCAL_DRAFT_KEY]: {
                text: restored,
                updatedAt: now
              } as ScratchpadLocalDraft
            });
          }
          await flushToSync(restored, now);
        }
      }
    }

    loadInitial();

    return () => {
      isMounted = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        flushToSync(currentTextRef.current, lastSavedAtRef.current);
      }
    };
  }, [flushToSync]);

  /**
   * Real-time cross-device sync: Listen for changes from chrome.storage.sync
   */
  useEffect(() => {
    if (!chrome.storage || !chrome.storage.onChanged) return;

    const handleStorageChange = async (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== 'sync') return;

      const hasMetaChange = Boolean(changes[SCRATCHPAD_META_KEY]);
      const hasChunkChange = Object.keys(changes).some((k) => k.startsWith(SCRATCHPAD_CHUNK_PREFIX));

      if (!hasMetaChange && !hasChunkChange) return;

      try {
        let meta = changes[SCRATCHPAD_META_KEY]?.newValue as ScratchpadMeta | undefined;
        if (!meta) {
          const syncMeta = await chrome.storage.sync.get(SCRATCHPAD_META_KEY);
          meta = syncMeta[SCRATCHPAD_META_KEY] as ScratchpadMeta | undefined;
        }

        // If new sync timestamp is newer than our local state, update
        if (meta && typeof meta.updatedAt === 'number' && meta.updatedAt > lastSavedAtRef.current) {
          const allChunkKeys = [
            SCRATCHPAD_META_KEY,
            `${SCRATCHPAD_CHUNK_PREFIX}0`,
            `${SCRATCHPAD_CHUNK_PREFIX}1`,
            `${SCRATCHPAD_CHUNK_PREFIX}2`,
            `${SCRATCHPAD_CHUNK_PREFIX}3`
          ];
          const syncData = await chrome.storage.sync.get(allChunkKeys);
          const assembled = assembleChunks(syncData, meta.chunkCount || 0);

          setTextState(assembled);
          lastSavedAtRef.current = meta.updatedAt;
          lastChunkCountRef.current = meta.chunkCount || 0;
          setSyncStatus('Synced');

          if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({
              [SCRATCHPAD_LOCAL_DRAFT_KEY]: {
                text: assembled,
                updatedAt: meta.updatedAt
              } as ScratchpadLocalDraft
            });
          }

          await mirrorScratchpadToBookmark(assembled);
        }
      } catch (err) {
        console.warn('[Arctic Scratchpad] Error handling cross-device sync change:', err);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  return {
    text,
    setText,
    syncStatus,
    clearScratchpad,
    copyScratchpad,
    isOpen,
    setIsOpen,
    toggleOpen,
    charCount: text.length,
    maxChars: MAX_CHARS
  };
}
