import type { StoredHighlightMeta } from '../../types';
import { hasPageScriptingPermission, isInjectableWebUrl } from './tabPageFocus';
import { getDomainFromUrl } from './url';

export const HIGHLIGHTS_STORAGE_KEY = 'highlightsByBookmarkId';

/**
 * Percent-encodes a single token for WICG Scroll-to-Text Fragment (`#:~:text=...`).
 * In addition to standard URI component encoding, `-`, `,`, and `&` must be
 * percent-encoded because they act as syntax delimiters in Text Fragment directives.
 */
export function encodeTextFragmentToken(text: string): string {
  return encodeURIComponent(text)
    .replace(/-/g, '%2D')
    .replace(/,/g, '%2C')
    .replace(/&/g, '%26');
}

/**
 * Builds a WICG Text Fragment directive (`text=start` or `text=start,end`) from
 * a user's raw text selection.
 * - Single-line selections up to 120 characters / 20 words use exact matching (`text=...`).
 * - Multi-paragraph selections or longer passages use range matching (`text=startWords,endWords`)
 *   so Chromium can match across block boundaries and long paragraphs reliably.
 */
export function buildTextFragmentDirective(rawSelection: string): string {
  if (!rawSelection) return '';
  const segments = rawSelection
    .split(/\r?\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (segments.length === 0) return '';

  if (segments.length === 1) {
    const single = segments[0];
    const words = single.split(' ').filter(Boolean);
    if (single.length <= 120 && words.length <= 20) {
      return `text=${encodeTextFragmentToken(single)}`;
    }
    const startSnippet = words.slice(0, 6).join(' ');
    const endSnippet = words.slice(-6).join(' ');
    if (startSnippet && endSnippet && startSnippet !== endSnippet) {
      return `text=${encodeTextFragmentToken(startSnippet)},${encodeTextFragmentToken(endSnippet)}`;
    }
    return `text=${encodeTextFragmentToken(single.slice(0, 120).trim())}`;
  }

  const firstWords = segments[0].split(' ').filter(Boolean);
  const lastWords = segments[segments.length - 1].split(' ').filter(Boolean);
  const startSnippet = firstWords.slice(0, 6).join(' ');
  const endSnippet = lastWords.slice(-6).join(' ');

  if (startSnippet && endSnippet && startSnippet !== endSnippet) {
    return `text=${encodeTextFragmentToken(startSnippet)},${encodeTextFragmentToken(endSnippet)}`;
  }

  const fallback = startSnippet || segments[0].slice(0, 100).trim();
  return fallback ? `text=${encodeTextFragmentToken(fallback)}` : '';
}

/**
 * Strips any existing `:~:text=...` fragment directive from a URL while preserving
 * standard `#anchor` or `#/route` hashes if present.
 */
export function stripTextFragmentFromUrl(url: string): string {
  if (!url || !url.includes(':~:')) return url;
  const hashIdx = url.indexOf('#');
  if (hashIdx === -1) return url;

  const beforeHash = url.slice(0, hashIdx);
  const hashPart = url.slice(hashIdx + 1);
  const directiveIdx = hashPart.indexOf(':~:');
  if (directiveIdx === -1) return url;

  const cleanAnchor = hashPart.slice(0, directiveIdx);
  return cleanAnchor ? `${beforeHash}#${cleanAnchor}` : beforeHash;
}

/**
 * Checks whether a URL contains a Scroll-to-Text Fragment (`#:~:text=...`).
 */
export function hasTextFragment(url?: string): boolean {
  if (!url) return false;
  return /#.*?:~:text=/i.test(url);
}

/**
 * Builds a complete shareable/bookmarkable URL with a `#:~:text=...` highlight fragment.
 */
export function buildHighlightUrl(pageUrl: string, selectedText: string): string {
  if (!pageUrl || !selectedText) return '';
  const trimmedUrl = pageUrl.trim();
  if (!/^https?:\/\//i.test(trimmedUrl)) return '';

  const directive = buildTextFragmentDirective(selectedText);
  if (!directive) return '';

  const baseUrl = stripTextFragmentFromUrl(trimmedUrl);
  if (baseUrl.includes('#')) {
    return `${baseUrl}:~:${directive}`;
  }
  return `${baseUrl}#:~:${directive}`;
}

export interface ExtractedHighlightFragment {
  textStart: string;
  textEnd?: string;
  displayQuote: string;
}

/**
 * Extracts and decodes the human-readable highlighted text from a `#:~:text=...` URL.
 */
export function extractHighlightFromUrl(url?: string): ExtractedHighlightFragment | null {
  if (!url || !hasTextFragment(url)) return null;

  const match = url.match(/#.*?:~:text=([^&#]+)/i);
  if (!match || !match[1]) return null;

  const rawParam = match[1];
  const rawTokens = rawParam.split(',');
  const tokens = [...rawTokens];

  // Strip optional prefix- (first token ending with unencoded '-') and -suffix (last token starting with unencoded '-')
  if (tokens.length > 1 && tokens[0].endsWith('-')) {
    tokens.shift();
  }
  if (tokens.length > 1 && tokens[tokens.length - 1].startsWith('-')) {
    tokens.pop();
  }

  if (tokens.length === 0) return null;

  const safeDecode = (val: string): string => {
    try {
      return decodeURIComponent(val).replace(/\s+/g, ' ').trim();
    } catch {
      return val.replace(/%20/g, ' ').replace(/\s+/g, ' ').trim();
    }
  };

  const textStart = safeDecode(tokens[0] || '');
  if (!textStart) return null;

  const textEnd = tokens.length > 1 ? safeDecode(tokens[1] || '') : undefined;
  const displayQuote =
    textEnd && textEnd !== textStart ? `${textStart} … ${textEnd}` : textStart;

  return {
    textStart,
    ...(textEnd ? { textEnd } : {}),
    displayQuote
  };
}

/**
 * Formats a descriptive bookmark title combining the highlighted quote snippet and the page title.
 */
export function formatHighlightBookmarkTitle(
  quote: string,
  pageTitle?: string,
  pageUrl?: string
): string {
  const cleanQuote = (quote || '').replace(/\s+/g, ' ').trim();
  const baseTitle =
    (pageTitle || '').replace(/\s+/g, ' ').trim() ||
    getDomainFromUrl(pageUrl || '') ||
    'Saved Highlight';

  if (!cleanQuote) return baseTitle;

  const snippet =
    cleanQuote.length > 64 ? `${cleanQuote.slice(0, 61).trimEnd()}…` : cleanQuote;
  return `“${snippet}” — ${baseTitle}`;
}

/**
 * Parses a bookmark's title, URL, and optional stored quote metadata into a clean
 * display title and quote preview so `BookmarkRow` can render the page title on line 1
 * and a styled highlight quote snippet on line 2 without duplicating the quote.
 */
export function parseHighlightBookmarkDisplay(
  bookmarkTitle: string,
  bookmarkUrl?: string,
  storedQuote?: string
): {
  displayTitle: string;
  quoteText: string | null;
  isHighlight: boolean;
} {
  const extracted = extractHighlightFromUrl(bookmarkUrl);
  const cleanStoredQuote = (storedQuote || '').replace(/\s+/g, ' ').trim();
  const rawTitle = (bookmarkTitle || '').trim();

  // Check if title matches our auto-generated `“Quote” — Page Title` pattern
  const titlePatternMatch = rawTitle.match(/^“(.+?)”\s*—\s*(.+)$/);

  const isHighlight = Boolean(cleanStoredQuote || extracted || titlePatternMatch);
  if (!isHighlight) {
    return {
      displayTitle: rawTitle || bookmarkUrl || 'Untitled Tab',
      quoteText: null,
      isHighlight: false
    };
  }

  const quoteText =
    cleanStoredQuote ||
    extracted?.displayQuote ||
    (titlePatternMatch ? titlePatternMatch[1].trim() : null);

  const displayTitle = titlePatternMatch
    ? titlePatternMatch[2].trim()
    : rawTitle || getDomainFromUrl(bookmarkUrl || '') || 'Saved Highlight';

  return {
    displayTitle,
    quoteText,
    isHighlight: true
  };
}

let highlightsStorageLock: Promise<void> = Promise.resolve();

function withHighlightsStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = highlightsStorageLock.then(fn, fn);
  highlightsStorageLock = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/**
 * Collects a bookmark or folder's ID together with all nested descendant bookmark IDs
 * so deleting a folder cleans up every highlight stored inside it.
 */
export function collectBookmarkSubtreeIds(
  node?: chrome.bookmarks.BookmarkTreeNode,
  fallbackId?: string
): string[] {
  const ids = new Set<string>();
  if (fallbackId) ids.add(fallbackId);
  const walk = (current?: chrome.bookmarks.BookmarkTreeNode) => {
    if (!current) return;
    if (current.id) ids.add(current.id);
    if (Array.isArray(current.children)) {
      for (const child of current.children) {
        walk(child);
      }
    }
  };
  walk(node);
  return Array.from(ids);
}

/**
 * Reads stored highlight metadata map from `chrome.storage.local`.
 */
export async function getStoredHighlights(): Promise<Record<string, StoredHighlightMeta>> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) return {};
  try {
    const data = await chrome.storage.local.get([HIGHLIGHTS_STORAGE_KEY]);
    return (data[HIGHLIGHTS_STORAGE_KEY] as Record<string, StoredHighlightMeta>) || {};
  } catch {
    return {};
  }
}

/**
 * Saves or updates a highlight metadata entry in `chrome.storage.local`.
 * Serialized via `withHighlightsStorageLock` so concurrent saves never clobber one another.
 */
export async function upsertStoredHighlight(meta: StoredHighlightMeta): Promise<void> {
  if (!meta.bookmarkId || typeof chrome === 'undefined' || !chrome.storage?.local?.set) {
    return;
  }
  await withHighlightsStorageLock(async () => {
    try {
      const existing = await getStoredHighlights();
      await chrome.storage.local.set({
        [HIGHLIGHTS_STORAGE_KEY]: {
          ...existing,
          [meta.bookmarkId]: meta
        }
      });
    } catch {
      // ignore storage errors
    }
  });
}

/**
 * Removes stored highlight metadata for one or more deleted bookmarks.
 * Serialized via `withHighlightsStorageLock` so concurrent updates never clobber one another.
 */
export async function removeStoredHighlights(bookmarkIds: string[]): Promise<void> {
  if (
    bookmarkIds.length === 0 ||
    typeof chrome === 'undefined' ||
    !chrome.storage?.local?.set
  ) {
    return;
  }
  await withHighlightsStorageLock(async () => {
    try {
      const existing = await getStoredHighlights();
      let changed = false;
      const next = { ...existing };
      for (const id of bookmarkIds) {
        if (id && next[id]) {
          delete next[id];
          changed = true;
        }
      }
      if (changed) {
        await chrome.storage.local.set({ [HIGHLIGHTS_STORAGE_KEY]: next });
      }
    } catch {
      // ignore
    }
  });
}

/**
 * Self-contained function executed inside the active tab via `chrome.scripting.executeScript`
 * to read the current non-editable text selection.
 * IMPORTANT: Must not reference any outer module closures.
 */
export function getSelectionInDocument(): {
  text: string;
  url: string;
  title: string;
} | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;

  const active = document.activeElement as HTMLElement | null;
  if (active) {
    const tag = active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return null;
    if (active.isContentEditable) return null;
    const ce = active.getAttribute?.('contenteditable');
    if (ce === '' || ce === 'true') return null;
  }

  const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
  if (!sel || sel.isCollapsed) return null;

  const text = sel.toString().trim();
  if (text.length < 2) return null;

  return {
    text,
    url: window.location?.href || '',
    title: document.title || ''
  };
}

/**
 * Queries the active tab's current text selection and returns the generated `#:~:text=...`
 * highlight URL and quote details if text is selected on the page.
 */
export async function getActiveTabHighlightSelection(
  tabId: number,
  tabUrl?: string
): Promise<{
  text: string;
  highlightUrl: string;
  pageUrl: string;
  pageTitle: string;
} | null> {
  if (
    typeof tabId !== 'number' ||
    typeof chrome === 'undefined' ||
    !chrome.scripting?.executeScript
  ) {
    return null;
  }

  let resolvedUrl = tabUrl;
  if (!resolvedUrl && chrome.tabs?.get) {
    try {
      const tab = await chrome.tabs.get(tabId);
      resolvedUrl = tab?.url || tab?.pendingUrl;
    } catch {
      return null;
    }
  }

  if (!isInjectableWebUrl(resolvedUrl)) return null;

  const hasPerm = await hasPageScriptingPermission();
  if (!hasPerm) return null;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: getSelectionInDocument
    });
    const res = results?.[0]?.result;
    if (!res || !res.text) return null;

    const pageUrl = res.url || resolvedUrl || '';
    const highlightUrl = buildHighlightUrl(pageUrl, res.text);
    if (!highlightUrl) return null;

    return {
      text: res.text,
      highlightUrl,
      pageUrl: stripTextFragmentFromUrl(pageUrl),
      pageTitle: res.title || ''
    };
  } catch {
    return null;
  }
}

/**
 * Self-contained function executed inside a tab via `chrome.scripting.executeScript`
 * to scroll smoothly to a bookmarked highlight passage and visibly highlight the exact text.
 * IMPORTANT: Must not reference any outer module closures.
 */
export function scrollToHighlightInDocument(payload: {
  textStart: string;
  textEnd?: string;
}): boolean {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    !document.body ||
    !payload?.textStart
  ) {
    return false;
  }

  const needleStart = payload.textStart.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!needleStart) return false;
  const needleEnd = payload.textEnd
    ? payload.textEnd.replace(/\s+/g, ' ').trim().toLowerCase()
    : '';

  // Ensure highlight stylesheet is present
  const STYLE_ID = 'arctic-text-highlight-style';
  if (!document.getElementById(STYLE_ID)) {
    try {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        ::highlight(arctic-text-highlight) {
          background-color: rgba(250, 204, 21, 0.45);
          color: inherit;
        }
        mark[data-arctic-highlight="true"] {
          background-color: rgba(250, 204, 21, 0.42) !important;
          color: inherit !important;
          border-radius: 3px;
          padding: 1px 0;
          box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.22);
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    } catch {
      // ignore
    }
  }

  const isSpaceCode = (code: number): boolean => {
    if (code <= 0x20) {
      return (
        code === 0x20 ||
        code === 0x09 ||
        code === 0x0a ||
        code === 0x0d ||
        code === 0x0c ||
        code === 0x0b
      );
    }
    if (code === 0x00a0) return true;
    return code >= 0x1680 && /\s/.test(String.fromCharCode(code));
  };

  const runFindAndHighlight = (): boolean => {
    // Unwrap any previous <mark data-arctic-highlight="true"> (only present in non-CSS.highlights fallback)
    try {
      if (document.querySelector('mark[data-arctic-highlight="true"]')) {
        const oldMarks = document.querySelectorAll('mark[data-arctic-highlight="true"]');
        oldMarks.forEach((mark) => {
          const parent = mark.parentNode;
          if (parent) {
            while (mark.firstChild) {
              parent.insertBefore(mark.firstChild, mark);
            }
            parent.removeChild(mark);
            parent.normalize();
          }
        });
      }
    } catch {
      // ignore
    }

    const MAX_CHARS = 400000;
    const textNodes: Text[] = [];
    let capacity = 4096;
    let nodeIndices = new Int32Array(capacity);
    let charOffsets = new Int32Array(capacity);
    let normLen = 0;
    let lastWasSpace = true;
    const normParts: string[] = [];

    const pushChar = (ch: string, nodeIdx: number, offset: number) => {
      if (normLen >= MAX_CHARS) return;
      if (normLen >= capacity) {
        const nextCap = Math.min(MAX_CHARS, capacity * 2);
        const nextNodes = new Int32Array(nextCap);
        const nextOffsets = new Int32Array(nextCap);
        nextNodes.set(nodeIndices);
        nextOffsets.set(charOffsets);
        nodeIndices = nextNodes;
        charOffsets = nextOffsets;
        capacity = nextCap;
      }
      nodeIndices[normLen] = nodeIdx;
      charOffsets[normLen] = offset;
      normLen += 1;
      lastWasSpace = ch === ' ';
      normParts.push(ch);
    };

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node: Node): number {
          if (node.nodeType === 1) {
            const el = node as Element;
            const id = el.id;
            if (
              id === 'arctic-edge-trigger-host' ||
              id === 'arctic-highlight-pill-host' ||
              el.hasAttribute('hidden')
            ) {
              return NodeFilter.FILTER_REJECT;
            }
            const tag = el.tagName;
            if (
              tag === 'SCRIPT' ||
              tag === 'STYLE' ||
              tag === 'NOSCRIPT' ||
              tag === 'TEMPLATE'
            ) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_SKIP;
          }
          const val = node.nodeValue;
          return val && val.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
      }
    );

    let currentNode: Node | null = walker.nextNode();
    let lastParent: Element | null = null;
    let lastBlockParent: Element | null = null;
    let cachedBlockForLastParent: Element | null = null;

    while (currentNode && normLen < MAX_CHARS) {
      const textNode = currentNode as Text;
      const parent = textNode.parentElement;
      if (parent) {
        const raw = textNode.nodeValue || '';
        if (raw.length > 0) {
          const nodeIdx = textNodes.length;
          textNodes.push(textNode);

          let blockParent: Element;
          if (parent === lastParent && cachedBlockForLastParent) {
            blockParent = cachedBlockForLastParent;
          } else {
            blockParent =
              parent.closest(
                'p, li, blockquote, h1, h2, h3, h4, h5, h6, div, section, article, td, th, pre'
              ) || parent;
            lastParent = parent;
            cachedBlockForLastParent = blockParent;
          }

          if (lastBlockParent && blockParent !== lastBlockParent && normLen > 0 && !lastWasSpace) {
            pushChar(' ', nodeIdx, 0);
          }
          lastBlockParent = blockParent;

          let nodeChunk = '';
          for (let i = 0; i < raw.length && normLen < MAX_CHARS; i++) {
            const code = raw.charCodeAt(i);
            if (isSpaceCode(code)) {
              if (!lastWasSpace) {
                if (normLen >= capacity) {
                  const nextCap = Math.min(MAX_CHARS, capacity * 2);
                  const nextNodes = new Int32Array(nextCap);
                  const nextOffsets = new Int32Array(nextCap);
                  nextNodes.set(nodeIndices);
                  nextOffsets.set(charOffsets);
                  nodeIndices = nextNodes;
                  charOffsets = nextOffsets;
                  capacity = nextCap;
                }
                nodeIndices[normLen] = nodeIdx;
                charOffsets[normLen] = i;
                normLen += 1;
                lastWasSpace = true;
                nodeChunk += ' ';
              }
            } else {
              const lower =
                code >= 0x41 && code <= 0x5a
                  ? String.fromCharCode(code + 32)
                  : code < 0x80
                    ? raw[i]
                    : raw[i].toLowerCase();
              for (let j = 0; j < lower.length && normLen < MAX_CHARS; j++) {
                if (normLen >= capacity) {
                  const nextCap = Math.min(MAX_CHARS, capacity * 2);
                  const nextNodes = new Int32Array(nextCap);
                  const nextOffsets = new Int32Array(nextCap);
                  nextNodes.set(nodeIndices);
                  nextOffsets.set(charOffsets);
                  nodeIndices = nextNodes;
                  charOffsets = nextOffsets;
                  capacity = nextCap;
                }
                nodeIndices[normLen] = nodeIdx;
                charOffsets[normLen] = i;
                normLen += 1;
                lastWasSpace = false;
                nodeChunk += lower[j];
              }
            }
          }
          if (nodeChunk) {
            normParts.push(nodeChunk);
          }
        }
      }
      currentNode = walker.nextNode();
    }

    const fullNormText = normParts.join('');
    const startIdx = fullNormText.indexOf(needleStart);

    let matchedRange: Range | null = null;
    let matchedElement: HTMLElement | null = null;

    if (startIdx !== -1 && normLen > 0) {
      let endIdx = startIdx + needleStart.length - 1;
      if (needleEnd) {
        const searchFrom = startIdx + needleStart.length;
        const foundEnd = fullNormText.indexOf(needleEnd, searchFrom);
        if (foundEnd !== -1 && foundEnd - startIdx <= 6000) {
          endIdx = foundEnd + needleEnd.length - 1;
        }
      }
      endIdx = Math.min(endIdx, normLen - 1);

      const startNode = textNodes[nodeIndices[startIdx]];
      const endNode = textNodes[nodeIndices[endIdx]];
      if (startNode && endNode) {
        matchedElement = startNode.parentElement;
        try {
          const range = document.createRange();
          range.setStart(startNode, charOffsets[startIdx]);
          range.setEnd(endNode, charOffsets[endIdx] + 1);
          matchedRange = range;
        } catch {
          // fallback to matchedElement
        }
      }
    }

    if (!matchedElement) return false;

    let scrollTarget: HTMLElement = matchedElement;

    // Apply persistent highlight via CSS Custom Highlight API (Chrome 105+) without mutating host DOM
    if (matchedRange) {
      let usedCustomHighlight = false;
      try {
        const winAny = window as unknown as {
          CSS?: { highlights?: { set: (name: string, hl: unknown) => void } };
          Highlight?: new (...ranges: Range[]) => unknown;
        };
        if (winAny.CSS?.highlights && typeof winAny.Highlight === 'function') {
          winAny.CSS.highlights.set(
            'arctic-text-highlight',
            new winAny.Highlight(matchedRange)
          );
          usedCustomHighlight = true;
        }
      } catch {
        // ignore
      }

      // Only fall back to <mark> DOM mutation when CSS Custom Highlight API is unavailable (e.g. JSDOM)
      if (!usedCustomHighlight && matchedRange.startContainer === matchedRange.endContainer) {
        try {
          const mark = document.createElement('mark');
          mark.setAttribute('data-arctic-highlight', 'true');
          matchedRange.surroundContents(mark);
          scrollTarget = mark;
        } catch {
          // ignore if surroundContents fails
        }
      }
    }

    try {
      scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      try {
        scrollTarget.scrollIntoView();
      } catch {
        // ignore
      }
    }

    try {
      const prevBg = matchedElement.style.backgroundColor;
      const prevTransition = matchedElement.style.transition;
      const prevRadius = matchedElement.style.borderRadius;

      matchedElement.style.transition = 'background-color 0.35s ease';
      matchedElement.style.backgroundColor = 'rgba(251, 191, 36, 0.32)';
      if (!prevRadius) {
        matchedElement.style.borderRadius = '4px';
      }

      setTimeout(() => {
        try {
          if (prevBg) matchedElement!.style.backgroundColor = prevBg;
          else matchedElement!.style.removeProperty('background-color');
          setTimeout(() => {
            try {
              if (prevTransition) matchedElement!.style.transition = prevTransition;
              else matchedElement!.style.removeProperty('transition');
              if (!prevRadius) matchedElement!.style.removeProperty('border-radius');
            } catch {
              // ignore
            }
          }, 400);
        } catch {
          // ignore
        }
      }, 2200);
    } catch {
      // ignore style errors
    }

    return true;
  };

  if (runFindAndHighlight()) {
    return true;
  }

  // Retry for client-rendered SPAs that finish hydrating shortly after initial load
  setTimeout(() => {
    if (!runFindAndHighlight()) {
      setTimeout(() => {
        runFindAndHighlight();
      }, 500);
    }
  }, 250);

  return false;
}

/**
 * Scrolls an already-open tab to the bookmarked highlight passage (`#:~:text=...`).
 */
export async function scrollToHighlightInTab(
  tabId: number,
  bookmarkUrl?: string
): Promise<boolean> {
  if (
    typeof tabId !== 'number' ||
    !bookmarkUrl ||
    typeof chrome === 'undefined' ||
    !chrome.scripting?.executeScript
  ) {
    return false;
  }

  const extracted = extractHighlightFromUrl(bookmarkUrl);
  if (!extracted) return false;

  if (!isInjectableWebUrl(bookmarkUrl)) return false;
  const hasPerm = await hasPageScriptingPermission();
  if (!hasPerm) return false;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: scrollToHighlightInDocument,
      args: [{ textStart: extracted.textStart, textEnd: extracted.textEnd }]
    });
    return Boolean(results?.[0]?.result);
  } catch {
    return false;
  }
}
