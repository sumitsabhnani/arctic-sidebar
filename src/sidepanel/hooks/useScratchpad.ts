import { useState, useEffect, useRef, useCallback } from 'react';

export const CHUNK_SIZE = 7000;
export const MAX_CHUNKS = 4;
export const MAX_CHARS = CHUNK_SIZE * MAX_CHUNKS; // 28,000 chars

export const SCRATCHPAD_META_KEY = 'scratchpad_meta';
export const SCRATCHPAD_LOCAL_DRAFT_KEY = 'scratchpad_local_draft';
export const SCRATCHPAD_CHUNK_PREFIX = 'scratchpad_chunk_';

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
   * Save text to chrome.storage.sync across chunks with local backup
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
   * Initial load: reconcile local draft and sync storage
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
          const meta = syncData[SCRATCHPAD_META_KEY] as ScratchpadMeta | undefined;

          if (meta && typeof meta.updatedAt === 'number') {
            const syncTime = meta.updatedAt;
            const localTime = localDraft?.updatedAt || 0;

            if (syncTime >= localTime) {
              const assembled = assembleChunks(syncData, meta.chunkCount || 0);
              if (isMounted) {
                setTextState(assembled);
                lastSavedAtRef.current = syncTime;
                lastChunkCountRef.current = meta.chunkCount || 0;
                setSyncStatus('Synced');
                // Synchronize local draft
                if (chrome.storage && chrome.storage.local) {
                  chrome.storage.local.set({
                    [SCRATCHPAD_LOCAL_DRAFT_KEY]: {
                      text: assembled,
                      updatedAt: syncTime
                    } as ScratchpadLocalDraft
                  });
                }
              }
            } else if (localDraft && localDraft.text) {
              // Local draft is newer than sync (sidebar closed before debounce finished)
              if (isMounted) {
                flushToSync(localDraft.text, localDraft.updatedAt);
              }
            }
          } else if (localDraft && localDraft.text) {
            // No sync data yet, flush local draft to sync
            if (isMounted) {
              flushToSync(localDraft.text, localDraft.updatedAt);
            }
          }
        }
      } catch (err) {
        console.warn('[Arctic Scratchpad] Error loading from storage.sync:', err);
        if (isMounted) {
          setSyncStatus('Offline - Saved locally');
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
