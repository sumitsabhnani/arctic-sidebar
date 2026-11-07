/**
 * Strict URL normalization helper for comparing currentUrl vs originalUrl.
 *
 * Rules:
 * 1. Strip trailing slashes (including root slash).
 * 2. Strip tracking query parameters (utm_*, fbclid, gclid, etc.).
 * 3. Strip URL fragments unless hash routing (e.g. #/dashboard).
 * 4. Gracefully handle http vs https and www. prefixes.
 */
export function normalizeUrl(url: string): string {
  if (!url) return '';
  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed);

    // Only process standard web schemes
    const isWeb = parsed.protocol === 'http:' || parsed.protocol === 'https:';

    // Lowercase hostname and strip 'www.' prefix
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
    }

    // Protocol normalization for web: equate http and https for non-local hosts
    let protocol = parsed.protocol.toLowerCase();
    const isLocal =
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('192.168.') ||
      hostname.endsWith('.local');

    if (isWeb && !isLocal && protocol === 'http:') {
      protocol = 'https:';
    }

    // Path normalization: remove trailing slash (even if root '/')
    let pathname = parsed.pathname;
    if (pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    // Filter tracking query params
    const searchParams = new URLSearchParams(parsed.search);
    const keysToRemove: string[] = [];
    for (const key of searchParams.keys()) {
      const lower = key.toLowerCase();
      if (
        lower.startsWith('utm_') ||
        lower === 'fbclid' ||
        lower === 'gclid' ||
        lower === 'gbraid' ||
        lower === 'wbraid' ||
        lower === 'mc_eid' ||
        lower === 'igshid' ||
        lower === '_ga' ||
        lower === '_gl' ||
        lower === 'ref' ||
        lower === 'source'
      ) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      searchParams.delete(key);
    }
    searchParams.sort();
    const search = searchParams.toString() ? `?${searchParams.toString()}` : '';

    // Fragment handling: preserve hash routing (e.g., #/route or #!/route or hash containing /)
    let hash = '';
    if (parsed.hash) {
      const hashContent = parsed.hash;
      const isHashRoute =
        hashContent.startsWith('#/') ||
        hashContent.startsWith('#!/') ||
        (hashContent.length > 1 && hashContent.includes('/'));

      if (isHashRoute) {
        hash = hashContent;
        if (hash.length > 2 && hash.endsWith('/')) {
          hash = hash.slice(0, -1);
        }
      }
      // If it's a page anchor like #section-2, strip it out
    }

    const port = parsed.port ? `:${parsed.port}` : '';

    return `${protocol}//${hostname}${port}${pathname}${search}${hash}`;
  } catch {
    // Fallback for non-standard or malformed URLs
    let fallback = trimmed.toLowerCase();
    if (fallback.endsWith('/')) {
      fallback = fallback.slice(0, -1);
    }
    return fallback;
  }
}

/**
 * Checks if the user's active/current URL has drifted from the bookmarked anchor URL.
 */
export function isUrlNavigatedAway(currentUrl: string, originalUrl: string): boolean {
  if (!currentUrl || !originalUrl) return false;
  return normalizeUrl(currentUrl) !== normalizeUrl(originalUrl);
}

/**
 * Returns the Chrome internal favicon API URL.
 * Requires "favicon" permission in manifest.json.
 * Maps `.new` shortcut URLs to their canonical origins so Chrome's favicon cache resolves their website icon.
 */
export function getFaviconUrl(pageUrl: string, size: number = 32): string {
  if (!pageUrl) return '';
  let resolvedUrl = pageUrl;
  try {
    const host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'docs.new' || host === 'document.new') {
      resolvedUrl = 'https://docs.google.com/document/';
    } else if (host === 'sheets.new' || host === 'spreadsheet.new') {
      resolvedUrl = 'https://docs.google.com/spreadsheets/';
    } else if (host === 'slides.new' || host === 'presentation.new') {
      resolvedUrl = 'https://docs.google.com/presentation/';
    } else if (host === 'notion.new') {
      resolvedUrl = 'https://www.notion.so/';
    } else if (host === 'gist.new') {
      resolvedUrl = 'https://gist.github.com/';
    }
  } catch {
    // keep raw pageUrl
  }
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(resolvedUrl)}&size=${size}`;
  }
  return '';
}

/**
 * Extracts a readable domain string for display/tooltips.
 */
export function getDomainFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let host = parsed.hostname;
    if (host.startsWith('www.')) host = host.slice(4);
    return host;
  } catch {
    return url;
  }
}

export const ARCTIC_SCRATCHPAD_PREFIX = 'https://arctic.local/note/';
export const ARCTIC_GLOBAL_SCRATCHPAD_URL = 'https://arctic.local/scratchpad';

export function isScratchpadUrl(url?: string): boolean {
  if (!url) return false;
  return (
    url.startsWith(ARCTIC_SCRATCHPAD_PREFIX) ||
    url.startsWith(ARCTIC_GLOBAL_SCRATCHPAD_URL) ||
    url.startsWith('arctic://note/')
  );
}

export function getScratchpadNoteId(url?: string): string {
  if (!url) return '';
  let rest = '';
  if (url.startsWith(ARCTIC_SCRATCHPAD_PREFIX)) {
    rest = url.slice(ARCTIC_SCRATCHPAD_PREFIX.length);
  } else if (url.startsWith('arctic://note/')) {
    rest = url.slice('arctic://note/'.length);
  }
  if (!rest) return '';
  return rest.split('#')[0].split('?')[0];
}

/**
 * Encodes text into a URL-safe hash fragment.
 */
export function encodeNoteHash(text: string): string {
  if (!text) return '';
  try {
    return encodeURIComponent(text);
  } catch {
    return '';
  }
}

/**
 * Decodes text from a URL hash fragment.
 */
export function decodeNoteHash(hash: string): string {
  if (!hash) return '';
  try {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
}

/**
 * Extracts decoded note content from a note bookmark URL (either from hash or query).
 */
export function extractNoteContentFromUrl(url?: string): string {
  if (!url) return '';
  const hashIdx = url.indexOf('#');
  if (hashIdx !== -1) {
    return decodeNoteHash(url.slice(hashIdx + 1));
  }
  return '';
}

export function isGoogleDocUrl(url?: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('docs.new') ||
    lower.includes('document.new') ||
    lower.includes('docs.google.com/document')
  );
}
