import type { SiteSearchEngine } from '../../types';
import { getCanonicalUrlKey } from '../../sidepanel/utils/url';
import { getGhostAutocomplete } from './siteSearch';

const MULTI_PART_PUBLIC_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'co.nz',
  'co.in',
  'net.in',
  'org.in',
  'ac.in',
  'gov.in',
  'com.br',
  'com.mx',
  'com.ar',
  'com.co',
  'com.sg',
  'com.hk',
  'com.tw',
  'com.tr',
  'co.za',
  'co.kr',
  'co.il',
  'co.id',
  'com.my',
  'com.ph',
  'com.vn',
  'com.ua',
  'com.pl',
  'com.es',
  'com.be'
]);

const AUTH_SUBDOMAIN_LABELS = new Set([
  'signin',
  'login',
  'sso',
  'auth',
  'oauth',
  'idp'
]);

const AUTH_HOSTS = new Set([
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com'
]);

const AUTH_PATH_SEGMENTS = new Set([
  'signin',
  'sign-in',
  'login',
  'log-in',
  'oauth',
  'oauth2',
  'authorize',
  'saml',
  'saml2',
  'logout',
  'servicelogin'
]);

const IGNORED_SEARCH_PARAM_KEYS = new Set([
  'redirect_uri',
  'redirect_url',
  'redirect',
  'return_to',
  'returnto',
  'returnurl',
  'return_url',
  'continue',
  'next',
  'dest',
  'destination',
  'url',
  'uri',
  'target',
  'callback',
  'state',
  'nonce',
  'code',
  'token',
  'id_token',
  'access_token',
  'samlrequest',
  'samlresponse',
  'relaystate',
  'client_id',
  'response_type',
  'code_challenge',
  'code_challenge_method',
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'mc_eid',
  'igshid',
  '_ga',
  '_gl',
  'ref',
  'source',
  'ie',
  'pli',
  'usp'
]);

export interface UrlAnatomy {
  isWeb: boolean;
  hostname: string;
  cleanHost: string;
  registrableDomain: string;
  registrableLabel: string;
  publicSuffix: string;
  subdomains: string[];
  subdomainDepth: number;
  pathname: string;
  pathSegments: string[];
  safeSearchText: string;
  queryParamCount: number;
  isRootUrl: boolean;
  isAuthRedirectUrl: boolean;
  preferredOriginUrl: string;
}

export function parseUrlAnatomy(rawUrl: string): UrlAnatomy {
  const empty: UrlAnatomy = {
    isWeb: false,
    hostname: '',
    cleanHost: '',
    registrableDomain: '',
    registrableLabel: '',
    publicSuffix: '',
    subdomains: [],
    subdomainDepth: 0,
    pathname: '',
    pathSegments: [],
    safeSearchText: '',
    queryParamCount: 0,
    isRootUrl: false,
    isAuthRedirectUrl: false,
    preferredOriginUrl: ''
  };

  if (!rawUrl) return empty;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return empty;
  }

  const isWeb = parsed.protocol === 'http:' || parsed.protocol === 'https:';
  if (!isWeb) {
    return {
      ...empty,
      hostname: parsed.hostname.toLowerCase(),
      cleanHost: parsed.hostname.toLowerCase(),
      pathname: parsed.pathname.toLowerCase()
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  let cleanHost = hostname;
  if (cleanHost.startsWith('www.') && cleanHost.indexOf('.', 4) !== -1) {
    cleanHost = cleanHost.slice(4);
  }

  const isIpOrLocal =
    cleanHost === 'localhost' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(cleanHost) ||
    cleanHost.endsWith('.local');

  let registrableDomain = cleanHost;
  let registrableLabel = cleanHost;
  let publicSuffix = '';
  let subdomains: string[] = [];

  if (!isIpOrLocal) {
    const parts = cleanHost.split('.').filter(Boolean);
    if (parts.length >= 2) {
      const lastTwo = parts.slice(-2).join('.');
      const tldPartsCount =
        parts.length >= 3 && MULTI_PART_PUBLIC_SUFFIXES.has(lastTwo) ? 2 : 1;
      publicSuffix = parts.slice(-tldPartsCount).join('.');
      const regIdx = parts.length - tldPartsCount - 1;
      if (regIdx >= 0) {
        registrableLabel = parts[regIdx];
        registrableDomain = parts.slice(regIdx).join('.');
        subdomains = regIdx > 0 ? parts.slice(0, regIdx) : [];
      }
    }
  }

  let pathname = parsed.pathname;
  while (pathname.length > 0 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  const lowerPathname = pathname.toLowerCase();

  const pathSegments = lowerPathname
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      try {
        return decodeURIComponent(seg).toLowerCase();
      } catch {
        return seg.toLowerCase();
      }
    });

  const safeValues: string[] = [];
  let queryParamCount = 0;
  let hasAuthQueryParam = false;
  let hasClientId = false;
  let hasOAuthCompanion = false;

  for (const [rawKey, rawVal] of parsed.searchParams.entries()) {
    queryParamCount += 1;
    const key = rawKey.toLowerCase();
    if (
      key === 'redirect_uri' ||
      key === 'samlrequest' ||
      key === 'samlresponse' ||
      key === 'relaystate' ||
      key === 'openid.mode'
    ) {
      hasAuthQueryParam = true;
    }
    if (key === 'client_id') hasClientId = true;
    if (key === 'response_type' || key === 'scope' || key === 'code_challenge') {
      hasOAuthCompanion = true;
    }

    if (key.startsWith('utm_') || IGNORED_SEARCH_PARAM_KEYS.has(key)) {
      continue;
    }
    if (rawVal) {
      safeValues.push(rawVal.toLowerCase());
    }
  }

  if (hasClientId && hasOAuthCompanion) {
    hasAuthQueryParam = true;
  }

  const isAuthHost =
    AUTH_HOSTS.has(cleanHost) ||
    subdomains.some((label) => AUTH_SUBDOMAIN_LABELS.has(label));
  const isAuthPath = pathSegments.some((seg) => AUTH_PATH_SEGMENTS.has(seg));
  const isAuthRedirectUrl = isAuthHost || isAuthPath || hasAuthQueryParam;

  const hasNonTrivialHash = Boolean(parsed.hash && parsed.hash !== '#');
  const isRootUrl =
    (lowerPathname === '' || lowerPathname === '/index.html') &&
    queryParamCount === 0 &&
    !hasNonTrivialHash;

  const port = parsed.port ? `:${parsed.port}` : '';
  const proto =
    parsed.protocol === 'http:' && isIpOrLocal ? 'http:' : 'https:';
  const preferredOriginUrl = `${proto}//${hostname}${port}`;

  return {
    isWeb: true,
    hostname,
    cleanHost,
    registrableDomain,
    registrableLabel,
    publicSuffix,
    subdomains,
    subdomainDepth: subdomains.length,
    pathname: lowerPathname,
    pathSegments,
    safeSearchText: safeValues.join(' '),
    queryParamCount,
    isRootUrl,
    isAuthRedirectUrl,
    preferredOriginUrl
  };
}

/**
 * Computes a deduplication key for history entries, collapsing repeated OAuth/sign-in
 * redirect URLs on the same domain into a single representative entry.
 */
export function getHistoryCollapseKey(rawUrl: string, title?: string): string {
  const anatomy = parseUrlAnatomy(rawUrl);
  if (anatomy.isAuthRedirectUrl && anatomy.registrableDomain) {
    const cleanTitle = (title || '').trim().toLowerCase();
    if (cleanTitle && !/^https?:\/\//.test(cleanTitle)) {
      return `auth-title::${anatomy.registrableDomain}::${cleanTitle}`;
    }
    return `auth-path::${anatomy.cleanHost}::${anatomy.pathSegments.slice(0, 2).join('/')}`;
  }
  return getCanonicalUrlKey(rawUrl).toLowerCase();
}

export interface OmniboxCandidate {
  id: string;
  source: 'tab' | 'arctic-bookmark' | 'chrome-bookmark' | 'history' | 'url';
  title: string;
  secondaryTitle?: string;
  url: string;
  secondaryUrl?: string;
  domain?: string;
  bookmarkId?: string;
  spaceId?: string | null;
  spaceName?: string;
  isQuickAccess?: boolean;
  isArctic?: boolean;
  isOpenTab?: boolean;
  tabId?: number;
  windowId?: number;
  isInActiveSpace?: boolean;
  isInCurrentWindow?: boolean;
  lastAccessed?: number;
  visitCount?: number;
  typedCount?: number;
  lastVisitTime?: number;
}

export interface RankedOmniboxResult extends OmniboxCandidate {
  score: number;
  relevanceScore: number;
}

export interface RankOmniboxOptions {
  now?: number;
  maxResults?: number;
  synthesizeRootDomain?: boolean;
}

function splitWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isAuthIntentQuery(lowerQuery: string): boolean {
  return /\b(login|log-in|signin|sign-in|auth|oauth|sso|saml|account|accounts)\b/.test(
    lowerQuery
  );
}

interface VariantMatchEval {
  matched: boolean;
  relevanceScore: number;
  titleScore: number;
  hostScore: number;
  isDeepParentDomainOnlyMatch: boolean;
  anatomy: UrlAnatomy;
}

function evaluateVariantMatch(
  title: string,
  url: string,
  spaceName: string | undefined,
  lowerQuery: string,
  tokens: string[],
  cleanUrlQuery: string
): VariantMatchEval {
  const anatomy = parseUrlAnatomy(url);
  const titleLower = (title || '').toLowerCase();
  const titleWords = splitWords(titleLower);
  const spaceLower = (spaceName || '').toLowerCase();

  const searchableHostAndPath = anatomy.isWeb
    ? `${anatomy.cleanHost}${anatomy.pathname}`
    : url.toLowerCase();

  // Every query token must match somewhere in title, host/path, safe query params, or space name
  for (const tok of tokens) {
    const tokenInTitle = titleLower.includes(tok);
    const tokenInHostOrPath = searchableHostAndPath.includes(tok);
    const tokenInSafeParams = anatomy.safeSearchText.includes(tok);
    const tokenInSpace = spaceLower.includes(tok);
    if (!tokenInTitle && !tokenInHostOrPath && !tokenInSafeParams && !tokenInSpace) {
      // Allow full URL input like "https://amazon.de" where tok has scheme
      if (!(cleanUrlQuery && searchableHostAndPath.includes(cleanUrlQuery))) {
        return {
          matched: false,
          relevanceScore: 0,
          titleScore: 0,
          hostScore: 0,
          isDeepParentDomainOnlyMatch: false,
          anatomy
        };
      }
    }
  }

  // 1. Title Match Score
  let titleScore = 0;
  if (titleLower === lowerQuery) {
    titleScore = 560;
  } else if (titleLower.startsWith(lowerQuery)) {
    titleScore = 420;
  } else if (
    tokens.length === 1 &&
    titleWords.some((w) => w === tokens[0] || w.startsWith(tokens[0]))
  ) {
    const wordIdx = titleWords.findIndex((w) => w.startsWith(tokens[0]));
    titleScore = Math.max(220, 340 - wordIdx * 20);
  } else if (
    tokens.length > 1 &&
    tokens.every((tok) => titleWords.some((w) => w.startsWith(tok)))
  ) {
    titleScore = titleLower.includes(lowerQuery) ? 380 : 310;
  } else if (titleLower.includes(lowerQuery)) {
    titleScore = 160;
  } else if (tokens.length > 1) {
    const matchedTitleTokens = tokens.filter((tok) => titleLower.includes(tok)).length;
    if (matchedTitleTokens > 0) {
      titleScore = Math.round((matchedTitleTokens / tokens.length) * 180);
    }
  }

  // 2. Host & Path Match Score
  let hostScore = 0;
  let isDeepParentDomainOnlyMatch = false;

  if (tokens.length === 1) {
    const q = cleanUrlQuery || tokens[0];
    const cleanHostAndPath = `${anatomy.cleanHost}${anatomy.pathname}`;

    if (
      anatomy.cleanHost === q ||
      anatomy.registrableDomain === q ||
      cleanHostAndPath === q
    ) {
      hostScore = 1120 + (anatomy.isRootUrl ? 140 : 0);
    } else if (anatomy.cleanHost.startsWith(q) && anatomy.subdomainDepth === 0) {
      const labelLen = Math.max(1, anatomy.registrableLabel.length);
      const coverage = Math.min(1, q.length / labelLen);
      hostScore = 960 + Math.round(coverage * 140);
    } else if (anatomy.cleanHost.startsWith(q) && anatomy.subdomainDepth > 0) {
      hostScore = 820;
    } else {
      const matchingSubIdx = anatomy.subdomains.findIndex((sub) =>
        sub.startsWith(q)
      );
      const matchingSegment = anatomy.pathSegments.some((seg) =>
        seg.startsWith(q)
      );

      if (matchingSubIdx !== -1) {
        hostScore = Math.max(540, 680 - matchingSubIdx * 35);
      } else if (matchingSegment) {
        hostScore = 440;
      } else if (
        anatomy.registrableLabel.startsWith(q) &&
        anatomy.subdomainDepth === 1 &&
        !anatomy.isAuthRedirectUrl
      ) {
        hostScore = 320;
      } else if (
        anatomy.registrableLabel.includes(q) &&
        (anatomy.subdomainDepth >= 2 || anatomy.isAuthRedirectUrl)
      ) {
        hostScore = 45;
        isDeepParentDomainOnlyMatch = true;
      } else if (searchableHostAndPath.includes(q)) {
        hostScore = 95;
      } else if (anatomy.safeSearchText.includes(q)) {
        hostScore = 70;
      }
    }
  } else {
    // Multi-word query URL contribution
    let urlTokenPoints = 0;
    for (const tok of tokens) {
      if (anatomy.cleanHost.startsWith(tok)) {
        urlTokenPoints += 260;
      } else if (anatomy.subdomains.some((s) => s.startsWith(tok))) {
        urlTokenPoints += 200;
      } else if (anatomy.pathSegments.some((seg) => seg.startsWith(tok))) {
        urlTokenPoints += 170;
      } else if (searchableHostAndPath.includes(tok)) {
        urlTokenPoints += 70;
      } else if (anatomy.safeSearchText.includes(tok)) {
        urlTokenPoints += 50;
      }
    }
    hostScore = Math.round(urlTokenPoints / tokens.length);
  }

  const relevanceScore = hostScore + titleScore;

  return {
    matched: relevanceScore > 0 || spaceLower.includes(lowerQuery),
    relevanceScore: Math.max(relevanceScore, spaceLower.includes(lowerQuery) ? 120 : 0),
    titleScore,
    hostScore,
    isDeepParentDomainOnlyMatch,
    anatomy
  };
}

function computeSourceAndFrecencyBoost(
  cand: OmniboxCandidate,
  anatomy: UrlAnatomy,
  authIntent: boolean,
  explicitTrailingSlash: boolean,
  now: number
): number {
  let boost = 0;

  // 1. Source & Live Open Tab Priority (Arc-style Open-Tab-First)
  if (cand.isOpenTab) {
    if (cand.isInActiveSpace !== false && cand.isInCurrentWindow !== false) {
      boost += 520;
    } else if (cand.isInCurrentWindow !== false) {
      boost += 380;
    } else {
      boost += 320;
    }

    if (typeof cand.lastAccessed === 'number' && cand.lastAccessed > 0) {
      const ageMs = Math.max(0, now - cand.lastAccessed);
      if (ageMs < 5 * 60_000) boost += 60;
      else if (ageMs < 60 * 60_000) boost += 40;
      else if (ageMs < 24 * 3600_000) boost += 20;
    }
  } else if (cand.source === 'arctic-bookmark') {
    if (cand.isQuickAccess) {
      boost += cand.isInActiveSpace !== false ? 230 : 195;
    } else {
      boost += cand.isInActiveSpace !== false ? 190 : 155;
    }
  } else if (cand.source === 'chrome-bookmark') {
    boost += 70;
  } else if (cand.source === 'url') {
    boost += 90;
  }

  // 2. Browser History Frecency (typedCount + visitCount + recency)
  if (
    typeof cand.typedCount === 'number' ||
    typeof cand.visitCount === 'number' ||
    typeof cand.lastVisitTime === 'number'
  ) {
    const typedBoost = Math.min(160, Math.max(0, cand.typedCount || 0) * 35);
    const visitBoost = Math.min(
      100,
      Math.round(Math.log2(Math.max(1, cand.visitCount || 1) + 1) * 22)
    );
    let recencyBoost = 0;
    if (typeof cand.lastVisitTime === 'number' && cand.lastVisitTime > 0) {
      const ageMs = Math.max(0, now - cand.lastVisitTime);
      if (ageMs < 60 * 60_000) recencyBoost = 70;
      else if (ageMs < 24 * 3600_000) recencyBoost = 50;
      else if (ageMs < 7 * 24 * 3600_000) recencyBoost = 30;
      else if (ageMs < 30 * 24 * 3600_000) recencyBoost = 15;
    }
    boost += typedBoost + visitBoost + recencyBoost;
  }

  // 3. URL Cleanliness & Root Boost vs Auth/Deep-Link Penalties
  if (anatomy.isRootUrl) {
    boost += explicitTrailingSlash ? 620 : 140;
  } else if (anatomy.pathSegments.length === 1 && anatomy.queryParamCount === 0) {
    boost += 35;
  } else if (
    !cand.isOpenTab &&
    (cand.url.length > 110 || anatomy.queryParamCount >= 3)
  ) {
    boost -= 35;
  }

  if (anatomy.isAuthRedirectUrl && !authIntent) {
    boost -= 420;
  }

  return boost;
}

/**
 * Scores, filters noise, synthesizes clean root domains when appropriate, and sorts
 * omnibox candidates in browser-like relevance + frecency order.
 */
export function rankOmniboxCandidates(
  candidates: OmniboxCandidate[],
  rawQuery: string,
  options: RankOmniboxOptions = {}
): RankedOmniboxResult[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];

  const now = options.now ?? Date.now();
  const maxResults = options.maxResults ?? 9;
  const synthesizeRoot = options.synthesizeRootDomain !== false;

  const lowerQuery = trimmed.toLowerCase();
  const tokens = lowerQuery.split(/\s+/).filter(Boolean);
  const explicitTrailingSlash =
    tokens.length === 1 && /\/$/.test(trimmed) && !/^https?:\/\/$/i.test(trimmed);
  const cleanUrlQuery =
    tokens.length === 1
      ? lowerQuery.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')
      : '';
  const authIntent = isAuthIntentQuery(lowerQuery);

  interface InternalScored {
    candidate: OmniboxCandidate;
    score: number;
    relevanceScore: number;
    titleScore: number;
    isDeepParentDomainOnlyMatch: boolean;
    anatomy: UrlAnatomy;
  }

  const scored: InternalScored[] = [];

  for (const cand of candidates) {
    const primaryEval = evaluateVariantMatch(
      cand.title,
      cand.url,
      cand.spaceName,
      lowerQuery,
      tokens,
      cleanUrlQuery
    );

    let bestEval = primaryEval;
    if (cand.secondaryUrl || cand.secondaryTitle) {
      const secondaryEval = evaluateVariantMatch(
        cand.secondaryTitle || cand.title,
        cand.secondaryUrl || cand.url,
        cand.spaceName,
        lowerQuery,
        tokens,
        cleanUrlQuery
      );
      if (
        secondaryEval.matched &&
        (!primaryEval.matched ||
          secondaryEval.relevanceScore > primaryEval.relevanceScore)
      ) {
        bestEval = secondaryEval;
      }
    }

    if (!bestEval.matched) continue;

    const boost = computeSourceAndFrecencyBoost(
      cand,
      bestEval.anatomy,
      authIntent,
      explicitTrailingSlash,
      now
    );

    scored.push({
      candidate: cand,
      score: Math.max(1, bestEval.relevanceScore + boost),
      relevanceScore: bestEval.relevanceScore,
      titleScore: bestEval.titleScore,
      isDeepParentDomainOnlyMatch: bestEval.isDeepParentDomainOnlyMatch,
      anatomy: bestEval.anatomy
    });
  }

  if (scored.length === 0) return [];

  // Filter pure deep-subdomain parent-only noise (e.g. us-east-1.console.aws.amazon.com
  // with title "Billing Management" when searching "amazon") whenever at least one
  // strong primary match exists.
  const hasStrongPrimaryMatch = scored.some(
    (item) => item.relevanceScore >= 600 && !item.isDeepParentDomainOnlyMatch
  );

  const filtered = hasStrongPrimaryMatch
    ? scored.filter(
        (item) => !(item.isDeepParentDomainOnlyMatch && item.titleScore === 0)
      )
    : scored;

  filtered.sort((a, b) => b.score - a.score);

  // Synthesize a clean root homepage candidate (e.g. https://www.amazon.de) when the user
  // types a single-token domain prefix (e.g. "amazon") and all matching items on that top
  // primary domain are deep links (e.g. open tab "Amazon.de: Home & Kitchen" at /b/ref=...).
  if (
    synthesizeRoot &&
    tokens.length === 1 &&
    cleanUrlQuery.length >= 2 &&
    !cleanUrlQuery.includes('/') &&
    filtered.length > 0
  ) {
    const top = filtered[0];
    const topAnatomy = top.anatomy;
    if (
      topAnatomy.isWeb &&
      topAnatomy.subdomainDepth === 0 &&
      !topAnatomy.isAuthRedirectUrl &&
      topAnatomy.cleanHost.startsWith(cleanUrlQuery) &&
      topAnatomy.preferredOriginUrl
    ) {
      const hasExistingRootForDomain = filtered.some(
        (item) =>
          item.anatomy.registrableDomain === topAnatomy.registrableDomain &&
          item.anatomy.subdomainDepth === 0 &&
          item.anatomy.isRootUrl
      );

      if (!hasExistingRootForDomain) {
        let synthScore: number;
        if (explicitTrailingSlash) {
          synthScore = top.score + 80;
        } else if (top.candidate.isOpenTab || top.candidate.source === 'arctic-bookmark' || top.candidate.source === 'chrome-bookmark') {
          // Arc-style Open-Tab-First: keep open tab (or saved bookmark) #1, clean root homepage #2
          synthScore = Math.max(1, top.score - 60);
        } else {
          // Only deep history links exist: put clean homepage #1 ahead of random old deep pages
          synthScore = top.score + 40;
        }

        const synthCandidate: OmniboxCandidate = {
          id: `synth-root-${topAnatomy.cleanHost}`,
          source: 'url',
          title: topAnatomy.cleanHost,
          url: topAnatomy.preferredOriginUrl,
          domain: topAnatomy.cleanHost
        };

        filtered.push({
          candidate: synthCandidate,
          score: synthScore,
          relevanceScore: top.relevanceScore,
          titleScore: 420,
          isDeepParentDomainOnlyMatch: false,
          anatomy: parseUrlAnatomy(topAnatomy.preferredOriginUrl)
        });

        filtered.sort((a, b) => b.score - a.score);
      }
    }
  }

  return filtered.slice(0, maxResults).map((item) => ({
    ...item.candidate,
    score: item.score,
    relevanceScore: item.relevanceScore
  }));
}

/**
 * Scores Action Commands when the user has NOT typed a leading '>' command prefix.
 * Requires strong word/prefix matches on the command title (minimum 4 chars, or exact title)
 * so everyday website queries like "tab", "open", or "free" are never hijacked by commands.
 */
export function scoreActionCommand(
  title: string,
  rawQuery: string
): number {
  const trimmed = rawQuery.trim().toLowerCase();
  if (!trimmed) return 0;

  const titleLower = title.toLowerCase();
  if (titleLower === trimmed) return 1350;

  if (trimmed.length < 4) return 0;

  if (titleLower.startsWith(trimmed)) {
    return 900;
  }

  const queryTokens = trimmed.split(/\s+/).filter(Boolean);
  const titleWords = splitWords(titleLower);

  if (
    queryTokens.every((tok) => titleWords.some((w) => w.startsWith(tok)))
  ) {
    return 760;
  }

  return 0;
}

/**
 * Computes unified inline ghost autocomplete suffix from the top-ranked local destination's
 * host (e.g. "amazon" -> ".de" when www.amazon.de is #1), falling back to matched SiteSearchEngine.
 */
export function computeInlineGhostSuffix(
  input: string,
  topSuggestionUrl?: string,
  topSuggestionType?: string,
  matchedEngine?: SiteSearchEngine | null
): string {
  if (!input || /\s/.test(input) || input.startsWith('>') || input.includes('/')) {
    return '';
  }

  const trimmed = input.trim();
  if (
    trimmed.length >= 2 &&
    topSuggestionUrl &&
    topSuggestionType &&
    topSuggestionType !== 'search' &&
    topSuggestionType !== 'command' &&
    !/^https?:\/\//i.test(input)
  ) {
    const anatomy = parseUrlAnatomy(topSuggestionUrl);
    if (anatomy.isWeb && !anatomy.isAuthRedirectUrl && anatomy.cleanHost) {
      const lowerInput = input.toLowerCase();
      if (
        anatomy.cleanHost.startsWith(lowerInput) &&
        anatomy.cleanHost.length > lowerInput.length
      ) {
        return anatomy.cleanHost.slice(input.length);
      }
    }
  }

  return getGhostAutocomplete(input, matchedEngine ?? null);
}
