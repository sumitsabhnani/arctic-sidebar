import type { SiteSearchEngine } from '../../types';
import { getDomainFromUrl } from '../../sidepanel/utils/url';

export const DEFAULT_SITE_SEARCH_ENGINES: SiteSearchEngine[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    domain: 'youtube.com',
    shortcut: 'youtube',
    aliases: ['you', 'yt'],
    searchUrlTemplate: 'https://www.youtube.com/results?search_query=%s'
  },
  {
    id: 'github',
    name: 'GitHub',
    domain: 'github.com',
    shortcut: 'github',
    aliases: ['gh', 'git'],
    searchUrlTemplate: 'https://github.com/search?q=%s'
  },
  {
    id: 'reddit',
    name: 'Reddit',
    domain: 'reddit.com',
    shortcut: 'reddit',
    aliases: ['red', 'r'],
    searchUrlTemplate: 'https://www.reddit.com/search/?q=%s'
  },
  {
    id: 'google',
    name: 'Google',
    domain: 'google.com',
    shortcut: 'google',
    aliases: ['g'],
    searchUrlTemplate: 'https://www.google.com/search?q=%s'
  },
  {
    id: 'google-maps',
    name: 'Google Maps',
    domain: 'maps.google.com',
    shortcut: 'maps',
    aliases: ['gmaps', 'map'],
    searchUrlTemplate: 'https://www.google.com/maps/search/%s'
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    domain: 'drive.google.com',
    shortcut: 'drive',
    aliases: ['gdrive'],
    searchUrlTemplate: 'https://drive.google.com/drive/search?q=%s'
  },
  {
    id: 'gmail',
    name: 'Gmail',
    domain: 'mail.google.com',
    shortcut: 'gmail',
    aliases: ['mail'],
    searchUrlTemplate: 'https://mail.google.com/mail/u/0/#search/%s'
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    domain: 'wikipedia.org',
    shortcut: 'wikipedia',
    aliases: ['wiki', 'w'],
    searchUrlTemplate: 'https://en.wikipedia.org/w/index.php?search=%s'
  },
  {
    id: 'amazon',
    name: 'Amazon',
    domain: 'amazon.com',
    shortcut: 'amazon',
    aliases: ['amz'],
    searchUrlTemplate: 'https://www.amazon.com/s?k=%s'
  },
  {
    id: 'twitter',
    name: 'X',
    domain: 'x.com',
    shortcut: 'twitter',
    aliases: ['x', 'tw'],
    searchUrlTemplate: 'https://x.com/search?q=%s'
  },
  {
    id: 'stackoverflow',
    name: 'Stack Overflow',
    domain: 'stackoverflow.com',
    shortcut: 'stackoverflow',
    aliases: ['so', 'stack'],
    searchUrlTemplate: 'https://stackoverflow.com/search?q=%s'
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    domain: 'chatgpt.com',
    shortcut: 'chatgpt',
    aliases: ['gpt', 'chat'],
    searchUrlTemplate: 'https://chatgpt.com/?q=%s'
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    domain: 'perplexity.ai',
    shortcut: 'perplexity',
    aliases: ['pplx', 'perp'],
    searchUrlTemplate: 'https://www.perplexity.ai/search?q=%s'
  },
  {
    id: 'claude',
    name: 'Claude',
    domain: 'claude.ai',
    shortcut: 'claude',
    aliases: ['cl'],
    searchUrlTemplate: 'https://claude.ai/new?q=%s'
  },
  {
    id: 'mdn',
    name: 'MDN Docs',
    domain: 'developer.mozilla.org',
    shortcut: 'mdn',
    aliases: ['moz'],
    searchUrlTemplate: 'https://developer.mozilla.org/en-US/search?q=%s'
  },
  {
    id: 'npm',
    name: 'NPM',
    domain: 'npmjs.com',
    shortcut: 'npm',
    aliases: ['npmjs'],
    searchUrlTemplate: 'https://www.npmjs.com/search?q=%s'
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    domain: 'duckduckgo.com',
    shortcut: 'duckduckgo',
    aliases: ['ddg', 'duck'],
    searchUrlTemplate: 'https://duckduckgo.com/?q=%s'
  },
  {
    id: 'hackernews',
    name: 'Hacker News',
    domain: 'news.ycombinator.com',
    shortcut: 'hackernews',
    aliases: ['hn', 'yc'],
    searchUrlTemplate: 'https://hn.algolia.com/?q=%s'
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    domain: 'linkedin.com',
    shortcut: 'linkedin',
    aliases: ['li'],
    searchUrlTemplate: 'https://www.linkedin.com/search/results/all/?keywords=%s'
  },
  {
    id: 'twitch',
    name: 'Twitch',
    domain: 'twitch.tv',
    shortcut: 'twitch',
    aliases: ['twtv'],
    searchUrlTemplate: 'https://www.twitch.tv/search?term=%s'
  },
  {
    id: 'spotify',
    name: 'Spotify',
    domain: 'open.spotify.com',
    shortcut: 'spotify',
    aliases: ['spot'],
    searchUrlTemplate: 'https://open.spotify.com/search/%s'
  }
];

/**
 * Finds the best matching site search engine when the user types a single token
 * in the command bar (e.g. "you" -> YouTube, "gh" -> GitHub).
 */
export function findMatchingSiteEngine(
  input: string,
  customEngines: SiteSearchEngine[] = []
): SiteSearchEngine | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.startsWith('>') || /\s/.test(trimmed)) {
    return null;
  }

  // Strip protocol if user typed e.g. https://youtube, but ignore paths
  const clean = trimmed.toLowerCase().replace(/^https?:\/\/(www\.)?/, '');
  if (!clean || clean.includes('/')) {
    return null;
  }

  const allEngines = [...customEngines, ...DEFAULT_SITE_SEARCH_ENGINES];

  // 1. Exact shortcut, alias, or domain match
  for (const engine of allEngines) {
    if (
      engine.shortcut.toLowerCase() === clean ||
      engine.name.toLowerCase() === clean ||
      engine.domain.toLowerCase() === clean ||
      engine.aliases?.some((a) => a.toLowerCase() === clean)
    ) {
      return engine;
    }
  }

  // Require at least 2 characters for prefix matching so single letters
  // only trigger if they are explicit aliases (like "g", "r", "w", "x").
  if (clean.length < 2) {
    return null;
  }

  // 2. Prefix match on shortcut or name
  for (const engine of allEngines) {
    if (
      engine.shortcut.toLowerCase().startsWith(clean) ||
      engine.name.toLowerCase().startsWith(clean)
    ) {
      return engine;
    }
  }

  // 3. Prefix match on domain
  for (const engine of allEngines) {
    if (engine.domain.toLowerCase().startsWith(clean)) {
      return engine;
    }
  }

  return null;
}

/**
 * Computes inline ghost autocomplete text for the current input and matched engine.
 * Example: input="you", engine=YouTube -> returns "tube"
 */
export function getGhostAutocomplete(
  input: string,
  engine: SiteSearchEngine | null
): string {
  if (!engine || !input || /\s/.test(input)) {
    return '';
  }

  const lowerInput = input.toLowerCase();
  const lowerName = engine.name.toLowerCase();
  const lowerShortcut = engine.shortcut.toLowerCase();
  const lowerDomain = engine.domain.toLowerCase();

  if (lowerName.startsWith(lowerInput) && lowerName.length > lowerInput.length) {
    const suffix = engine.name.slice(input.length);
    return input[0] === input[0].toLowerCase() ? suffix.toLowerCase() : suffix;
  }

  if (
    lowerShortcut.startsWith(lowerInput) &&
    lowerShortcut.length > lowerInput.length
  ) {
    return lowerShortcut.slice(input.length);
  }

  if (lowerDomain.startsWith(lowerInput) && lowerDomain.length > lowerInput.length) {
    return lowerDomain.slice(input.length);
  }

  return '';
}

/**
 * Formats a destination search URL for a given site search engine and query.
 */
export function buildSiteSearchUrl(
  engine: SiteSearchEngine,
  searchTerm: string
): string {
  const trimmed = searchTerm.trim();
  if (!trimmed) {
    return `https://${engine.domain}`;
  }
  const encoded = encodeURIComponent(trimmed);
  if (engine.searchUrlTemplate.includes('%s')) {
    return engine.searchUrlTemplate.replace(/%s/g, encoded);
  }
  return `${engine.searchUrlTemplate}${encoded}`;
}

/**
 * Checks whether a bookmark or history URL belongs to the active site search domain.
 */
export function doesUrlMatchEngineDomain(
  url: string,
  engine: SiteSearchEngine
): boolean {
  if (!url) return false;
  const host = getDomainFromUrl(url).toLowerCase();
  const targetDomain = engine.domain.toLowerCase().replace(/^www\./, '');
  return (
    host === targetDomain ||
    host.endsWith(`.${targetDomain}`) ||
    (targetDomain === 'x.com' && (host === 'twitter.com' || host.endsWith('.twitter.com')))
  );
}
