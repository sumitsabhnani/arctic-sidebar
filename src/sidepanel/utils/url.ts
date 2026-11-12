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
 * Extracts the effective URL of a browser tab, gracefully handling sleeping/discarded
 * or session-restoring tabs where `tab.url` may be empty or `about:blank` while
 * `tab.pendingUrl` (or a tab-suspender extension wrapper) holds the real destination.
 */
export function getEffectiveTabUrl(
  tab?: { url?: string; pendingUrl?: string } | null
): string {
  if (!tab) return '';
  const actualUrl = (tab.url || '').trim();
  const pendingUrl = (tab.pendingUrl || '').trim();

  const unwrapSuspendedUrl = (raw: string): string => {
    if (!raw.startsWith('chrome-extension://')) return raw;
    const ownId = typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined;
    if (
      (ownId && raw.startsWith(`chrome-extension://${ownId}/`)) ||
      raw.includes('/newtab.html') ||
      raw.includes('/command.html') ||
      raw.includes('/sidepanel.html')
    ) {
      return raw;
    }
    try {
      const parsed = new URL(raw);
      for (const source of [parsed.search.slice(1), parsed.hash.slice(1)]) {
        if (!source) continue;
        const params = new URLSearchParams(source);
        const candidate = params.get('uri') || params.get('url') || params.get('target');
        if (candidate && /^https?:\/\//i.test(candidate.trim())) {
          return candidate.trim();
        }
      }
    } catch {
      // keep raw
    }
    return raw;
  };

  if (actualUrl && actualUrl !== 'about:blank') {
    return unwrapSuspendedUrl(actualUrl);
  }
  if (pendingUrl && pendingUrl !== 'about:blank') {
    return unwrapSuspendedUrl(pendingUrl);
  }
  return actualUrl || pendingUrl || '';
}

/**
 * Computes a canonical identity key for deterministic web-app entry redirects and
 * automatic URL mutations (such as Gmail, Google Calendar, Drive, Google Docs `?tab=t.0`,
 * Notion page slugs, Outlook, Discord) without falsely equating distinct content pages.
 */
export function getCanonicalUrlKey(url: string): string {
  if (!url) return '';
  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed);
    const isWeb = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    if (!isWeb) {
      return normalizeUrl(trimmed);
    }

    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
    }
    if (hostname === 'gmail.com') {
      hostname = 'mail.google.com';
    }

    let protocol = parsed.protocol.toLowerCase();
    const isLocal =
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('192.168.') ||
      hostname.endsWith('.local');
    if (!isLocal && protocol === 'http:') {
      protocol = 'https:';
    }

    let pathname = parsed.pathname;
    while (pathname.length > 0 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    const searchParams = new URLSearchParams(parsed.search);
    const keysToRemove: string[] = [];
    const isGoogleHost = hostname === 'google.com' || hostname.endsWith('.google.com');

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
        lower === 'source' ||
        lower === 'pli' ||
        (isGoogleHost && lower === 'authuser' && searchParams.get(key) === '0')
      ) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      searchParams.delete(key);
    }

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
    }

    // Deterministic web-app canonicalizations
    if (hostname === 'mail.google.com') {
      const rawHashLower = (parsed.hash || '').toLowerCase();
      const isDefaultInboxHash =
        rawHashLower === '' || rawHashLower === '#' || rawHashLower === '#inbox';
      if (
        isDefaultInboxHash &&
        (pathname === '' || pathname === '/mail' || pathname === '/mail/u/0')
      ) {
        pathname = '/mail/u/0';
        hash = '';
      }
    } else if (hostname === 'calendar.google.com') {
      if (
        pathname === '' ||
        pathname === '/calendar' ||
        pathname === '/calendar/u/0' ||
        /^\/calendar(?:\/u\/0)?\/r(?:\/(?:day|week|month|year|schedule|agenda|customday|customweek|4day))?$/i.test(
          pathname
        )
      ) {
        pathname = '/calendar/u/0/r';
      }
    } else if (hostname === 'drive.google.com') {
      if (
        pathname === '' ||
        pathname === '/drive' ||
        pathname === '/drive/my-drive' ||
        pathname === '/drive/home' ||
        pathname === '/drive/u/0' ||
        pathname === '/drive/u/0/my-drive' ||
        pathname === '/drive/u/0/home'
      ) {
        pathname = '/drive/u/0/my-drive';
      }
    } else if (hostname === 'keep.google.com') {
      if (pathname === '' || pathname === '/u/0') {
        pathname = '/u/0';
      }
    } else if (hostname === 'docs.google.com') {
      const docMatch = pathname.match(
        /^(?:\/u\/(\d+))?\/(document|spreadsheets|presentation|forms)\/d\/([^/]+)(?:\/(?:edit|view|preview))?$/i
      );
      if (docMatch) {
        const accountIdx = docMatch[1];
        const docType = docMatch[2].toLowerCase();
        const docId = docMatch[3];
        const accountPrefix = accountIdx && accountIdx !== '0' ? `/u/${accountIdx}` : '';
        pathname = `${accountPrefix}/${docType}/d/${docId}`;
        searchParams.delete('usp');
        if (searchParams.get('tab') === 't.0') {
          searchParams.delete('tab');
        }
      }
    } else if (
      hostname === 'outlook.live.com' ||
      hostname === 'outlook.office.com' ||
      hostname === 'outlook.office365.com'
    ) {
      const lowerPath = pathname.toLowerCase();
      if (
        lowerPath === '' ||
        lowerPath === '/mail' ||
        lowerPath === '/mail/0' ||
        lowerPath === '/mail/inbox' ||
        lowerPath === '/mail/0/inbox'
      ) {
        pathname = '/mail/0/inbox';
      }
    } else if (hostname === 'discord.com') {
      if (pathname === '/app' || pathname === '/channels/@me') {
        pathname = '/channels/@me';
      }
    } else if (hostname === 'notion.so' || hostname.endsWith('.notion.so')) {
      searchParams.delete('pvs');
      const notionIdMatch = pathname.match(
        /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
      );
      if (notionIdMatch) {
        const cleanHex = notionIdMatch[1].replace(/-/g, '').toLowerCase();
        hostname = 'notion.so';
        pathname = `/page/${cleanHex}`;
      }
    }

    searchParams.sort();
    const search = searchParams.toString() ? `?${searchParams.toString()}` : '';
    const port = parsed.port ? `:${parsed.port}` : '';

    return `${protocol}//${hostname}${port}${pathname}${search}${hash}`;
  } catch {
    return normalizeUrl(trimmed);
  }
}

/**
 * Checks whether an open/sleeping tab's URL matches a bookmark's URL, either via
 * standard URL normalization or deterministic canonical redirect equivalence.
 */
export function doesTabUrlMatchBookmark(tabUrl: string, bookmarkUrl: string): boolean {
  if (!tabUrl || !bookmarkUrl) return false;
  if (normalizeUrl(tabUrl) === normalizeUrl(bookmarkUrl)) return true;
  return getCanonicalUrlKey(tabUrl) === getCanonicalUrlKey(bookmarkUrl);
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
