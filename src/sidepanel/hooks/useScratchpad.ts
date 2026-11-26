import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ARCTIC_GLOBAL_SCRATCHPAD_URL,
  encodeNoteHash,
  extractNoteContentFromUrl,
  isScratchpadUrl
} from '../utils/url';

/** Maximum number of characters the scratchpad editor accepts. */
export const MAX_CHARS = 28000;

/**
 * chrome.storage.sync enforces QUOTA_BYTES_PER_ITEM (8,192 bytes), measured as the UTF-8 size of
 * the JSON-stringified value plus the key length. Chunks are therefore split by byte size rather
 * than character count (multi-byte characters and JSON escapes would otherwise overflow the quota
 * and make the whole write fail). The budget leaves headroom below the hard limit.
 */
export const SYNC_ITEM_QUOTA_BYTES = 8192;
export const CHUNK_BYTE_BUDGET = 8000;

/**
 * Maximum number of sync chunks. Plain ASCII notes need at most 4 chunks for MAX_CHARS; heavily
 * multi-byte notes may need more. Capped so the scratchpad leaves room in the shared 100 KB
 * chrome.storage.sync quota for spaces and reminders.
 */
export const MAX_CHUNKS = 10;

/**
 * Delay between the last keystroke and the chrome.storage.sync write. chrome.storage.sync allows
 * at most 120 writes per minute and 1,800 per hour (one write every 2s on average).
 */
export const SYNC_DEBOUNCE_MS = 2000;

const RETRY_BASE_DELAY_MS = 5000;
const RETRY_MAX_DELAY_MS = 5 * 60 * 1000;

/**
 * Minimum interval between non-urgent Scratchpad Backup bookmark updates during continuous typing.
 * The first debounced save mirrors immediately; subsequent edits within this window coalesce into a
 * trailing mirror (and flush immediately on clear, sync failure, panel hide, or unmount).
 */
export const BOOKMARK_MIRROR_MIN_INTERVAL_MS = 30_000;

export const SCRATCHPAD_META_KEY = 'scratchpad_meta';
export const SCRATCHPAD_LOCAL_DRAFT_KEY = 'scratchpad_local_draft';
export const SCRATCHPAD_CHUNK_PREFIX = 'scratchpad_chunk_';
export const SCRATCHPAD_BACKUP_TITLE = 'Scratchpad Backup';

const ALL_CHUNK_KEYS = Array.from({ length: MAX_CHUNKS }, (_, i) => `${SCRATCHPAD_CHUNK_PREFIX}${i}`);
const ALL_SYNC_KEYS = [SCRATCHPAD_META_KEY, ...ALL_CHUNK_KEYS];

export interface ScratchpadMeta {
  updatedAt: number;
  chunkCount: number;
  /**
   * Fingerprint of the full note text (see hashText). Lets readers detect that chunks from another
   * device have only partially arrived, and marks an empty note as an intentional clear.
   * Absent in metas written by versions before 1.8.4.
   */
  hash?: string;
}

export interface ScratchpadLocalDraft {
  text: string;
  updatedAt: number;
}

export type ScratchpadSyncStatus =
  | 'Synced'
  | 'Saving...'
  | 'Offline - Saved locally'
  | 'Retrying sync...'
  | 'Too large to sync';

export interface ScratchpadSyncSnapshot {
  meta: ScratchpadMeta | null;
  text: string;
  /** False while the stored chunks don't match meta.hash yet (still arriving from another device). */
  complete: boolean;
}

export const EMPTY_SYNC_SNAPSHOT: ScratchpadSyncSnapshot = { meta: null, text: '', complete: true };

export class ScratchpadTooLargeError extends Error {
  constructor(message = 'Scratchpad note exceeds chrome.storage.sync limits') {
    super(message);
    this.name = 'ScratchpadTooLargeError';
  }
}

/**
 * UTF-8 byte cost of the UTF-16 code unit(s) at `index` once serialized by Chromium's
 * `base::JSONWriter` (which `chrome.storage.sync` uses for `QUOTA_BYTES_PER_ITEM`).
 * In addition to standard `JSON.stringify` escapes, Chromium's JSONWriter escapes `<` (0x3C)
 * as `\u003C` (6 bytes) and U+2028 / U+2029 as `\u2028` / `\u2029` (6 bytes).
 * Returns how many code units were consumed so surrogate pairs are never split.
 */
function jsonCharCost(text: string, index: number): { units: number; bytes: number } {
  const code = text.charCodeAt(index);
  if (code === 0x22 || code === 0x5c) return { units: 1, bytes: 2 }; // \" and \\
  if (code === 0x3c) return { units: 1, bytes: 6 }; // Chromium base::JSONWriter escapes '<' as \u003C
  if (code < 0x20) {
    // \b \t \n \f \r have short escapes, other control chars become \u00XX
    const shortEscape = code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;
    return { units: 1, bytes: shortEscape ? 2 : 6 };
  }
  if (code < 0x80) return { units: 1, bytes: 1 };
  if (code < 0x800) return { units: 1, bytes: 2 };
  if (code === 0x2028 || code === 0x2029) return { units: 1, bytes: 6 }; // \u2028 and \u2029
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = text.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return { units: 2, bytes: 4 };
    return { units: 1, bytes: 6 }; // lone surrogate is escaped as \uXXXX
  }
  if (code >= 0xdc00 && code <= 0xdfff) return { units: 1, bytes: 6 };
  return { units: 1, bytes: 3 };
}

function toWellFormedString(value: string): string {
  const strWithWellFormed = value as string & { toWellFormed?: () => string };
  if (typeof strWithWellFormed.toWellFormed === 'function') {
    return strWithWellFormed.toWellFormed();
  }
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value.slice(i, i + 2);
        i += 1;
        continue;
      }
      out += '\uFFFD';
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += '\uFFFD';
    } else {
      out += value[i];
    }
  }
  return out;
}

/**
 * Bounds scratchpad text to `maxChars` without splitting a UTF-16 surrogate pair at the boundary,
 * and normalizes any unpaired surrogates to U+FFFD so `hashText` always matches the UTF-8
 * round-tripped string stored by `chrome.storage.sync`.
 */
export function sanitizeScratchpadText(text: string, maxChars = MAX_CHARS): string {
  if (!text) return '';
  let bounded = text;
  if (bounded.length > maxChars) {
    let end = maxChars;
    const lastCode = bounded.charCodeAt(end - 1);
    const nextCode = bounded.charCodeAt(end);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff && nextCode >= 0xdc00 && nextCode <= 0xdfff) {
      end -= 1;
    }
    bounded = bounded.slice(0, end);
  }
  return toWellFormedString(bounded);
}

/** UTF-8 byte size of the JSON value as counted by Chromium's `chrome.storage.sync` quotas. */
export function jsonByteLength(text: string): number {
  let bytes = 2; // surrounding quotes
  for (let i = 0; i < text.length; ) {
    const { units, bytes: cost } = jsonCharCost(text, i);
    bytes += cost;
    i += units;
  }
  return bytes;
}

/**
 * Split plain text (capped at MAX_CHARS) into chunks that each fit within chrome.storage.sync's
 * per-item quota. May return more than MAX_CHUNKS chunks for very large multi-byte notes; callers
 * writing to sync must check for that.
 */
export function splitIntoChunks(text: string): { chunks: string[]; chunkCount: number } {
  const bounded = sanitizeScratchpadText(text, MAX_CHARS);
  if (!bounded) {
    return { chunks: [], chunkCount: 0 };
  }

  // Budget for the JSON value bytes: total budget minus the longest key and the two quotes
  const keyLength = `${SCRATCHPAD_CHUNK_PREFIX}${MAX_CHUNKS * 10}`.length;
  const valueBudget = CHUNK_BYTE_BUDGET - keyLength - 2;

  const chunks: string[] = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < bounded.length; ) {
    const { units, bytes: cost } = jsonCharCost(bounded, i);
    if (bytes + cost > valueBudget && i > start) {
      chunks.push(bounded.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += cost;
    i += units;
  }
  chunks.push(bounded.slice(start));
  return { chunks, chunkCount: chunks.length };
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

/**
 * Fast non-cryptographic fingerprint (length + 32-bit FNV-1a) used to verify that all chunks of a
 * revision have arrived.
 */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

/**
 * Read the scratchpad revision currently stored in chrome.storage.sync. Throws if storage is unavailable.
 */
export async function readSyncScratchpad(): Promise<ScratchpadSyncSnapshot> {
  const data = await chrome.storage.sync.get(ALL_SYNC_KEYS);
  const meta = data[SCRATCHPAD_META_KEY] as ScratchpadMeta | undefined;
  if (!meta || typeof meta.updatedAt !== 'number') {
    return { ...EMPTY_SYNC_SNAPSHOT };
  }
  const text = assembleChunks(data, Math.min(meta.chunkCount || 0, MAX_CHUNKS));
  const complete = typeof meta.hash === 'string' ? hashText(text) === meta.hash : true;
  return { meta, text, complete };
}

/**
 * Write a scratchpad revision to chrome.storage.sync. New chunks and meta are written in a single
 * set() call; stale chunks are removed only after the new revision is safely stored.
 * Throws ScratchpadTooLargeError if the note cannot fit, or the chrome.storage error on failure.
 */
export async function writeSyncScratchpad(text: string, updatedAt: number): Promise<ScratchpadMeta> {
  const { chunks, chunkCount } = splitIntoChunks(text);
  if (chunkCount > MAX_CHUNKS) {
    throw new ScratchpadTooLargeError();
  }

  const meta: ScratchpadMeta = { updatedAt, chunkCount, hash: hashText(chunks.join('')) };
  const payload: Record<string, unknown> = { [SCRATCHPAD_META_KEY]: meta };
  for (let i = 0; i < chunkCount; i++) {
    payload[`${SCRATCHPAD_CHUNK_PREFIX}${i}`] = chunks[i];
  }
  await chrome.storage.sync.set(payload);

  // Remove leftover chunks from a previously longer note (reads don't count toward write quotas)
  try {
    const staleKeys = ALL_CHUNK_KEYS.slice(chunkCount);
    if (staleKeys.length > 0) {
      const existing = await chrome.storage.sync.get(staleKeys);
      const present = staleKeys.filter((k) => existing[k] !== undefined);
      if (present.length > 0) {
        await chrome.storage.sync.remove(present);
      }
    }
  } catch {
    // Harmless: readers only assemble meta.chunkCount chunks
  }

  return meta;
}

/**
 * Classify a chrome.storage.sync write failure and choose a retry delay.
 */
export function classifySyncError(
  err: unknown,
  attempt: number
): { tooLarge: boolean; retryDelayMs: number } {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof ScratchpadTooLargeError || /QUOTA_BYTES/.test(message)) {
    return { tooLarge: true, retryDelayMs: 0 };
  }
  const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  if (/MAX_WRITE_OPERATIONS_PER_HOUR/.test(message)) {
    return { tooLarge: false, retryDelayMs: RETRY_MAX_DELAY_MS };
  }
  if (/MAX_WRITE_OPERATIONS_PER_MINUTE/.test(message)) {
    return { tooLarge: false, retryDelayMs: Math.max(60 * 1000, backoff) };
  }
  return { tooLarge: false, retryDelayMs: backoff };
}

export type ScratchpadSource = 'sync' | 'local' | 'pending' | 'none';

export interface ResolvedScratchpad {
  text: string;
  updatedAt: number;
  /**
   * sync: the stored sync revision wins. local: the local draft wins and should be pushed to sync.
   * pending: sync chunks are still arriving; show the local draft and write nothing.
   * none: no note anywhere in storage (fresh install); fall back to the bookmark backup.
   */
  source: ScratchpadSource;
}

/**
 * Decide which copy of the note wins between the local draft and the sync revision
 * (last-writer-wins on updatedAt).
 */
export function resolveScratchpad(
  localDraft: ScratchpadLocalDraft | null,
  snapshot: ScratchpadSyncSnapshot
): ResolvedScratchpad {
  const localTime = localDraft?.updatedAt || 0;
  const localText = typeof localDraft?.text === 'string' ? localDraft.text : '';
  const { meta, text: syncText, complete } = snapshot;

  if (meta && !complete) {
    return { text: localText, updatedAt: localTime, source: 'pending' };
  }

  if (meta) {
    // Metas with a hash (v1.8.4+) are authoritative even when empty, so clearing the note on one
    // device propagates instead of being resurrected by another device's older local draft.
    const authoritative = typeof meta.hash === 'string' || syncText.length > 0;
    if (authoritative && meta.updatedAt >= localTime) {
      return { text: syncText, updatedAt: meta.updatedAt, source: 'sync' };
    }
  }

  if (localText) {
    // Ensure the pushed revision beats whatever (non-authoritative or older) revision is in sync
    const updatedAt = meta ? Math.max(localTime, meta.updatedAt + 1) : localTime;
    return { text: localText, updatedAt, source: 'local' };
  }

  if (meta && syncText) {
    return { text: syncText, updatedAt: meta.updatedAt, source: 'sync' };
  }

  return { text: '', updatedAt: 0, source: 'none' };
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
let cachedBackupBookmarkId: string | null = null;

async function getCachedBackupBookmarkNode(): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
  if (!cachedBackupBookmarkId || typeof chrome === 'undefined' || !chrome.bookmarks) {
    return null;
  }
  try {
    const nodes =
      typeof chrome.bookmarks.get === 'function'
        ? await chrome.bookmarks.get(cachedBackupBookmarkId)
        : typeof chrome.bookmarks.getSubTree === 'function'
          ? await chrome.bookmarks.getSubTree(cachedBackupBookmarkId)
          : null;
    const node = Array.isArray(nodes) ? nodes[0] : undefined;
    if (node && node.id && isScratchpadBackupNode(node)) {
      return node;
    }
  } catch {
    // Cached bookmark was deleted or storage reset
  }
  cachedBackupBookmarkId = null;
  return null;
}

/**
 * Mirror scratchpad content to the backup bookmark in Other Bookmarks / Arctic.
 * Serialized via bookmarkMirrorLock, caches the primary backup bookmark ID to avoid full-tree
 * scans on subsequent saves, and deduplicates any redundant backup bookmarks.
 */
export function mirrorScratchpadToBookmark(contentToSave: string): Promise<void> {
  const bounded = sanitizeScratchpadText(contentToSave, MAX_CHARS);
  bookmarkMirrorLock = bookmarkMirrorLock
    .catch(() => {})
    .then(async () => {
      if (typeof chrome === 'undefined' || !chrome.bookmarks) return;

      try {
        const newUrl = bounded
          ? `${ARCTIC_GLOBAL_SCRATCHPAD_URL}#${encodeNoteHash(bounded)}`
          : ARCTIC_GLOBAL_SCRATCHPAD_URL;

        // Fast path: reuse cached primary backup bookmark ID without 7-call tree/search scan
        const cachedNode = await getCachedBackupBookmarkNode();
        if (cachedNode) {
          if (cachedNode.url === newUrl) {
            return;
          }
          if (chrome.bookmarks.update) {
            try {
              await chrome.bookmarks.update(cachedNode.id, { url: newUrl });
              return;
            } catch {
              cachedBackupBookmarkId = null;
            }
          }
        }

        const { bookmarks, arcticFolderId, otherFolderId } = await findScratchpadBackupBookmarks();

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

          const created = await chrome.bookmarks.create({
            parentId,
            title: SCRATCHPAD_BACKUP_TITLE,
            url: newUrl
          });
          if (created?.id) {
            cachedBackupBookmarkId = created.id;
          }
        };

        if (bookmarks.length > 0) {
          // Prefer a bookmark that already has content or is inside the Arctic folder
          const primary =
            bookmarks.find((b) => b.parentId === arcticFolderId && extractNoteContentFromUrl(b.url)) ||
            bookmarks.find((b) => Boolean(extractNoteContentFromUrl(b.url))) ||
            bookmarks.find((b) => b.parentId === arcticFolderId) ||
            bookmarks[0];

          cachedBackupBookmarkId = primary.id;

          if (primary.url !== newUrl && chrome.bookmarks.update) {
            try {
              await chrome.bookmarks.update(primary.id, { url: newUrl });
            } catch {
              cachedBackupBookmarkId = null;
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
          cachedBackupBookmarkId = bm.id;
          return sanitizeScratchpadText(restored, MAX_CHARS);
        }
      }
    }
  } catch (recoveryErr) {
    console.warn('[Arctic Scratchpad] Error restoring from backup bookmark:', recoveryErr);
  }
  return '';
}

async function readLocalDraft(): Promise<ScratchpadLocalDraft | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  const localData = await chrome.storage.local.get(SCRATCHPAD_LOCAL_DRAFT_KEY);
  const draft = localData[SCRATCHPAD_LOCAL_DRAFT_KEY] as ScratchpadLocalDraft | undefined;
  return draft && typeof draft === 'object' ? draft : null;
}

async function writeLocalDraft(text: string, updatedAt: number): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({
    [SCRATCHPAD_LOCAL_DRAFT_KEY]: { text, updatedAt } as ScratchpadLocalDraft
  });
}

/**
 * Background / startup reconciliation helper:
 * - Resolves the local draft against the sync revision (last-writer-wins) and makes local storage,
 *   sync storage and the backup bookmark agree on the winner.
 * - If storage has no note at all (e.g. fresh reinstall), restores from the backup bookmark.
 *   Restored text is stamped with updatedAt 0 so any real revision arriving later from
 *   Chrome Sync always wins over the (possibly stale) bookmark copy.
 */
export async function reconcileScratchpadStorageAndBookmark(): Promise<string> {
  let localDraft: ScratchpadLocalDraft | null = null;
  try {
    localDraft = await readLocalDraft();
  } catch {
    // ignore
  }

  let snapshot: ScratchpadSyncSnapshot = EMPTY_SYNC_SNAPSHOT;
  let syncReadable = false;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      snapshot = await readSyncScratchpad();
      syncReadable = true;
    }
  } catch {
    // ignore
  }

  const resolved = resolveScratchpad(localDraft, snapshot);

  switch (resolved.source) {
    case 'sync': {
      try {
        if (!localDraft || localDraft.text !== resolved.text || localDraft.updatedAt !== resolved.updatedAt) {
          await writeLocalDraft(resolved.text, resolved.updatedAt);
        }
      } catch {
        // ignore
      }
      await mirrorScratchpadToBookmark(resolved.text);
      return resolved.text;
    }

    case 'local': {
      try {
        if (localDraft?.updatedAt !== resolved.updatedAt) {
          await writeLocalDraft(resolved.text, resolved.updatedAt);
        }
      } catch {
        // ignore
      }
      if (syncReadable) {
        try {
          await writeSyncScratchpad(resolved.text, resolved.updatedAt);
        } catch (err) {
          console.warn('[Arctic Scratchpad] Failed to push local draft to storage.sync:', err);
        }
      }
      await mirrorScratchpadToBookmark(resolved.text);
      return resolved.text;
    }

    case 'pending':
      // Another device's revision is still arriving; the sidepanel listener applies it once complete
      return resolved.text;

    case 'none':
    default: {
      const restored = await restoreScratchpadFromBookmark();
      if (!restored) return '';
      try {
        await writeLocalDraft(restored, 0);
      } catch {
        // ignore
      }
      if (syncReadable) {
        try {
          await writeSyncScratchpad(restored, 0);
        } catch {
          // ignore
        }
      }
      return restored;
    }
  }
}

export function useScratchpad() {
  const [text, setTextState] = useState<string>('');
  const [syncStatus, setSyncStatus] = useState<ScratchpadSyncStatus>('Synced');
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bookmarkMirrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBookmarkMirrorAtRef = useRef<number>(0);
  const retryAttemptRef = useRef<number>(0);
  /**
   * Highest revision timestamp this view knows about (its own edits and applied remote revisions).
   * New edits are stamped with max(Date.now(), lastSavedAt + 1), a Lamport-style clock, so an edit
   * made after seeing another device's revision always wins even if that device's clock is ahead.
   */
  const lastSavedAtRef = useRef<number>(0);
  const currentTextRef = useRef<string>('');
  const flushRef = useRef<
    ((content: string, timestamp: number, options?: { forceBookmarkMirror?: boolean }) => Promise<void>) | null
  >(null);

  currentTextRef.current = text;

  const nextTimestamp = useCallback(() => Math.max(Date.now(), lastSavedAtRef.current + 1), []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const clearBookmarkMirrorTimer = useCallback(() => {
    if (bookmarkMirrorTimerRef.current) {
      clearTimeout(bookmarkMirrorTimerRef.current);
      bookmarkMirrorTimerRef.current = null;
    }
  }, []);

  const scheduleBookmarkMirror = useCallback(
    async (contentToSave: string, forceImmediate = false) => {
      const now = Date.now();
      const elapsed =
        lastBookmarkMirrorAtRef.current === 0
          ? BOOKMARK_MIRROR_MIN_INTERVAL_MS
          : now - lastBookmarkMirrorAtRef.current;

      if (forceImmediate || elapsed >= BOOKMARK_MIRROR_MIN_INTERVAL_MS) {
        clearBookmarkMirrorTimer();
        lastBookmarkMirrorAtRef.current = now || 1;
        await mirrorScratchpadToBookmark(contentToSave);
        return;
      }

      clearBookmarkMirrorTimer();
      const remaining = Math.max(50, BOOKMARK_MIRROR_MIN_INTERVAL_MS - elapsed);
      bookmarkMirrorTimerRef.current = setTimeout(() => {
        bookmarkMirrorTimerRef.current = null;
        lastBookmarkMirrorAtRef.current = Date.now() || 1;
        void mirrorScratchpadToBookmark(currentTextRef.current);
      }, remaining);
    },
    [clearBookmarkMirrorTimer]
  );

  /**
   * Save text to chrome.storage.sync across chunks, then mirror it into the bookmark backup.
   * Retries with backoff on transient failures (e.g. write-rate quotas).
   */
  const flushToSync = useCallback(
    async (
      contentToSave: string,
      timestamp: number,
      options?: { forceBookmarkMirror?: boolean }
    ) => {
      // Skip writes superseded by a newer local edit or an applied remote revision
      if (timestamp < lastSavedAtRef.current) return;

      if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
        setSyncStatus('Offline - Saved locally');
        await scheduleBookmarkMirror(contentToSave, true);
        return;
      }

      let syncFailed = false;
      try {
        await writeSyncScratchpad(contentToSave, timestamp);
        retryAttemptRef.current = 0;
        if (timestamp >= lastSavedAtRef.current) {
          setSyncStatus('Synced');
        }
      } catch (err) {
        syncFailed = true;
        console.warn('[Arctic Scratchpad] Failed to save to storage.sync, keeping local backup:', err);
        const { tooLarge, retryDelayMs } = classifySyncError(err, retryAttemptRef.current);
        if (tooLarge) {
          setSyncStatus('Too large to sync');
        } else {
          setSyncStatus('Retrying sync...');
          retryAttemptRef.current += 1;
          clearRetryTimer();
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            void flushRef.current?.(contentToSave, timestamp);
          }, retryDelayMs);
        }
      }

      // Mirror content into bookmark hash (immediately on first save, clear, hide, or sync failure;
      // throttled to once per 30s during sustained typing bursts to avoid Bookmark Sync churn)
      await scheduleBookmarkMirror(contentToSave, Boolean(options?.forceBookmarkMirror || syncFailed));
    },
    [clearRetryTimer, scheduleBookmarkMirror]
  );

  flushRef.current = flushToSync;

  /**
   * Handle user typing / text changes
   */
  const setText = useCallback(
    (newText: string) => {
      const bounded = sanitizeScratchpadText(newText, MAX_CHARS);
      setTextState(bounded);
      currentTextRef.current = bounded;
      setSyncStatus((prev) => (prev === 'Saving...' ? prev : 'Saving...'));

      const timestamp = nextTimestamp();
      lastSavedAtRef.current = timestamp;
      clearRetryTimer();

      // Fast local draft backup (never lost if sidepanel unloads mid-typing)
      writeLocalDraft(bounded, timestamp).catch((err) => {
        console.warn('[Arctic Scratchpad] Error saving local draft:', err);
      });

      // Debounce the sync write and bookmark mirror to stay within chrome.storage.sync write quotas
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        void flushToSync(bounded, timestamp);
      }, SYNC_DEBOUNCE_MS);
    },
    [flushToSync, nextTimestamp, clearRetryTimer]
  );

  /**
   * Clear scratchpad content completely
   */
  const clearScratchpad = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    clearRetryTimer();
    clearBookmarkMirrorTimer();
    setTextState('');
    currentTextRef.current = '';
    setSyncStatus('Saving...');
    const timestamp = nextTimestamp();
    lastSavedAtRef.current = timestamp;

    writeLocalDraft('', timestamp).catch(() => {});

    void flushToSync('', timestamp, { forceBookmarkMirror: true });
  }, [flushToSync, nextTimestamp, clearRetryTimer, clearBookmarkMirrorTimer]);

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
      const preLoadTimestamp = lastSavedAtRef.current;

      // 1. Load fast local draft first
      let localDraft: ScratchpadLocalDraft | null = null;
      try {
        localDraft = await readLocalDraft();
        // Do not overwrite if the user started typing while readLocalDraft() was in-flight
        if (!isMounted || lastSavedAtRef.current !== preLoadTimestamp) return;
        if (localDraft && typeof localDraft.text === 'string') {
          const cleanLocal = sanitizeScratchpadText(localDraft.text, MAX_CHARS);
          setTextState(cleanLocal);
          currentTextRef.current = cleanLocal;
          lastSavedAtRef.current = localDraft.updatedAt || 0;
        }
      } catch (err) {
        console.warn('[Arctic Scratchpad] Error reading initial local draft:', err);
        if (!isMounted || lastSavedAtRef.current !== preLoadTimestamp) return;
      }
      const baselineTimestamp = lastSavedAtRef.current;

      // 2. Fetch sync storage chunks
      let snapshot: ScratchpadSyncSnapshot = EMPTY_SYNC_SNAPSHOT;
      try {
        if (chrome.storage?.sync) {
          snapshot = await readSyncScratchpad();
        }
      } catch (err) {
        console.warn('[Arctic Scratchpad] Error loading from storage.sync:', err);
        if (isMounted) {
          setSyncStatus('Offline - Saved locally');
        }
      }

      // The user started typing (or a remote revision was applied) while loading: keep that state
      if (!isMounted || lastSavedAtRef.current !== baselineTimestamp) return;

      const resolved = resolveScratchpad(localDraft, snapshot);

      switch (resolved.source) {
        case 'sync': {
          setTextState(resolved.text);
          lastSavedAtRef.current = resolved.updatedAt;
          setSyncStatus('Synced');
          if (!localDraft || localDraft.text !== resolved.text || localDraft.updatedAt !== resolved.updatedAt) {
            writeLocalDraft(resolved.text, resolved.updatedAt).catch(() => {});
          }
          // Ensure existing synced notes are mirrored into the backup bookmark for reinstall retention
          await mirrorScratchpadToBookmark(resolved.text);
          break;
        }

        case 'local': {
          // Local draft is newer than sync (or sync has no note yet): push it to sync & bookmark
          lastSavedAtRef.current = resolved.updatedAt;
          if (localDraft?.updatedAt !== resolved.updatedAt) {
            writeLocalDraft(resolved.text, resolved.updatedAt).catch(() => {});
          }
          await flushToSync(resolved.text, resolved.updatedAt);
          break;
        }

        case 'pending':
          // Chunks from another device are still arriving; the storage listener applies them once complete
          break;

        case 'none':
        default: {
          // 3. Nothing in local or sync storage (reinstall scenario): restore from bookmark hash if present.
          // Stamped with updatedAt 0 so a real revision arriving later from Chrome Sync always wins.
          const restored = await restoreScratchpadFromBookmark();
          if (restored && isMounted && lastSavedAtRef.current === baselineTimestamp) {
            setTextState(restored);
            lastSavedAtRef.current = 0;
            setSyncStatus('Synced');
            writeLocalDraft(restored, 0).catch(() => {});
            await flushToSync(restored, 0);
          }
          break;
        }
      }
    }

    const flushPendingBeforeHide = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        void flushRef.current?.(currentTextRef.current, lastSavedAtRef.current, {
          forceBookmarkMirror: true
        });
      } else if (bookmarkMirrorTimerRef.current) {
        clearBookmarkMirrorTimer();
        lastBookmarkMirrorAtRef.current = Date.now() || 1;
        void mirrorScratchpadToBookmark(currentTextRef.current);
      }
    };

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        flushPendingBeforeHide();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', flushPendingBeforeHide);
    }

    loadInitial();

    return () => {
      isMounted = false;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', flushPendingBeforeHide);
      }
      const hadPendingSyncWrite = Boolean(debounceTimerRef.current || retryTimerRef.current);
      const hadPendingBookmarkMirror = Boolean(bookmarkMirrorTimerRef.current);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      clearRetryTimer();
      clearBookmarkMirrorTimer();
      if (hadPendingSyncWrite) {
        void flushToSync(currentTextRef.current, lastSavedAtRef.current, {
          forceBookmarkMirror: true
        });
      } else if (hadPendingBookmarkMirror) {
        void mirrorScratchpadToBookmark(currentTextRef.current);
      }
    };
  }, [flushToSync, clearRetryTimer, clearBookmarkMirrorTimer]);

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
        // Always read the full revision: meta and chunks may arrive in separate change events
        const snapshot = await readSyncScratchpad();
        const { meta } = snapshot;

        // Wait until every chunk of this revision has arrived (verified against meta.hash)
        if (!meta || !snapshot.complete) return;

        // Ignore our own writes and revisions older than what this view already has
        if (meta.updatedAt <= lastSavedAtRef.current) return;

        // A newer revision from another device supersedes any pending local write
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        if (bookmarkMirrorTimerRef.current) {
          clearTimeout(bookmarkMirrorTimerRef.current);
          bookmarkMirrorTimerRef.current = null;
        }

        setTextState(snapshot.text);
        currentTextRef.current = snapshot.text;
        lastSavedAtRef.current = meta.updatedAt;
        setSyncStatus('Synced');

        // The originating device mirrors the bookmark backup; only the local draft is updated here
        writeLocalDraft(snapshot.text, meta.updatedAt).catch(() => {});
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
