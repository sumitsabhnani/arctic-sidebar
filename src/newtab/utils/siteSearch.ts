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

export interface RegionalDomainPreferences {
  amazon?: string;
  google?: string;
}

export interface DomainSignalInput {
  url: string;
  weight?: number;
}

const AMAZON_REGIONAL_DOMAINS = new Set([
  'amazon.com',
  'amazon.de',
  'amazon.co.uk',
  'amazon.fr',
  'amazon.it',
  'amazon.es',
  'amazon.nl',
  'amazon.pl',
  'amazon.se',
  'amazon.com.be',
  'amazon.ca',
  'amazon.com.mx',
  'amazon.com.br',
  'amazon.com.au',
  'amazon.in',
  'amazon.co.jp',
  'amazon.sg',
  'amazon.ae',
  'amazon.sa',
  'amazon.com.tr',
  'amazon.eg'
]);

const GOOGLE_REGIONAL_DOMAINS = new Set([
  'google.com',
  'google.de',
  'google.co.uk',
  'google.fr',
  'google.it',
  'google.es',
  'google.nl',
  'google.pl',
  'google.se',
  'google.ch',
  'google.at',
  'google.be',
  'google.ca',
  'google.com.mx',
  'google.com.br',
  'google.com.au',
  'google.co.nz',
  'google.co.in',
  'google.co.jp',
  'google.co.kr',
  'google.com.sg',
  'google.ie',
  'google.pt'
]);

/**
 * Infers the user's preferred regional domains (e.g. amazon.de vs amazon.com, google.de vs google.com)
 * from open tabs, bookmarks, and history URLs while ignoring cloud/service subdomains like
 * console.aws.amazon.com, mail.google.com, or docs.google.com.
 */
export function inferRegionalSiteDomains(
  signals: Iterable<string | DomainSignalInput>
): RegionalDomainPreferences {
  const amazonScores = new Map<string, number>();
  const googleScores = new Map<string, number>();

  for (const entry of signals) {
    const rawUrl = typeof entry === 'string' ? entry : entry.url;
    const weight = typeof entry === 'string' ? 1 : (entry.weight ?? 1);
    if (!rawUrl || weight <= 0) continue;

    let host = '';
    try {
      host = new URL(rawUrl).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (!host) continue;

    const stripped = host.replace(/^(www|m|smile)\./, '');
    if (AMAZON_REGIONAL_DOMAINS.has(stripped)) {
      amazonScores.set(stripped, (amazonScores.get(stripped) || 0) + weight);
      continue;
    }

    const strippedGoogle = host.replace(/^(www|encrypted)\./, '');
    if (GOOGLE_REGIONAL_DOMAINS.has(strippedGoogle)) {
      googleScores.set(strippedGoogle, (googleScores.get(strippedGoogle) || 0) + weight);
    }
  }

  const pickTopDomain = (scores: Map<string, number>): string | undefined => {
    let bestDomain: string | undefined;
    let bestScore = 0;
    for (const [domain, score] of scores.entries()) {
      if (score > bestScore) {
        bestScore = score;
        bestDomain = domain;
      }
    }
    return bestDomain;
  };

  return {
    amazon: pickTopDomain(amazonScores),
    google: pickTopDomain(googleScores)
  };
}

function formatRegionalBrandName(baseName: string, domain: string, defaultDomain: string): string {
  if (!domain || domain === defaultDomain) return baseName;
  const suffix = domain.slice(baseName.length); // e.g. ".de" or ".co.uk"
  return `${baseName}${suffix}`;
}

function buildEffectiveDefaultEngines(
  regionalPrefs?: RegionalDomainPreferences
): SiteSearchEngine[] {
  if (!regionalPrefs?.amazon && !regionalPrefs?.google) {
    return DEFAULT_SITE_SEARCH_ENGINES;
  }

  return DEFAULT_SITE_SEARCH_ENGINES.map((engine) => {
    if (
      engine.id === 'amazon' &&
      regionalPrefs.amazon &&
      AMAZON_REGIONAL_DOMAINS.has(regionalPrefs.amazon)
    ) {
      const domain = regionalPrefs.amazon;
      return {
        ...engine,
        name: formatRegionalBrandName('Amazon', domain, 'amazon.com'),
        domain,
        searchUrlTemplate: `https://www.${domain}/s?k=%s`
      };
    }
    if (
      engine.id === 'google' &&
      regionalPrefs.google &&
      GOOGLE_REGIONAL_DOMAINS.has(regionalPrefs.google)
    ) {
      const domain = regionalPrefs.google;
      return {
        ...engine,
        name: formatRegionalBrandName('Google', domain, 'google.com'),
        domain,
        searchUrlTemplate: `https://www.${domain}/search?q=%s`
      };
    }
    return engine;
  });
}

/**
 * Finds the best matching site search engine when the user types a single token
 * in the command bar (e.g. "you" -> YouTube, "gh" -> GitHub, "amazon" -> Amazon.de).
 */
export function findMatchingSiteEngine(
  input: string,
  customEngines: SiteSearchEngine[] = [],
  regionalPrefs?: RegionalDomainPreferences
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

  const defaultEngines = buildEffectiveDefaultEngines(regionalPrefs);
  const allEngines = [...customEngines, ...defaultEngines];

  // 0. Explicit regional domain typed by user (e.g. "amazon.com" or "amazon.co.uk")
  if (AMAZON_REGIONAL_DOMAINS.has(clean) && !customEngines.some((e) => e.domain.toLowerCase() === clean)) {
    return {
      id: 'amazon',
      name: formatRegionalBrandName('Amazon', clean, 'amazon.com'),
      domain: clean,
      shortcut: 'amazon',
      aliases: ['amz'],
      searchUrlTemplate: `https://www.${clean}/s?k=%s`
    };
  }
  if (GOOGLE_REGIONAL_DOMAINS.has(clean) && !customEngines.some((e) => e.domain.toLowerCase() === clean)) {
    return {
      id: 'google',
      name: formatRegionalBrandName('Google', clean, 'google.com'),
      domain: clean,
      shortcut: 'google',
      aliases: ['g'],
      searchUrlTemplate: `https://www.${clean}/search?q=%s`
    };
  }

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
 * Excludes AWS cloud/console subdomains when matching retail Amazon search engines.
 */
export function doesUrlMatchEngineDomain(
  url: string,
  engine: SiteSearchEngine
): boolean {
  if (!url) return false;
  const host = getDomainFromUrl(url).toLowerCase();
  const targetDomain = engine.domain.toLowerCase().replace(/^www\./, '');
  if (
    engine.id === 'amazon' &&
    (host === 'aws.amazon.com' ||
      host.endsWith('.aws.amazon.com') ||
      host.startsWith('signin.'))
  ) {
    return false;
  }
  return (
    host === targetDomain ||
    host.endsWith(`.${targetDomain}`) ||
    (targetDomain === 'x.com' && (host === 'twitter.com' || host.endsWith('.twitter.com')))
  );
}
