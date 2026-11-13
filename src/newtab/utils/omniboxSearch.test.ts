import { describe, it, expect } from 'vitest';
import {
  parseUrlAnatomy,
  getHistoryCollapseKey,
  rankOmniboxCandidates,
  scoreActionCommand,
  computeInlineGhostSuffix,
  type OmniboxCandidate
} from './omniboxSearch';
import { DEFAULT_SITE_SEARCH_ENGINES } from './siteSearch';

describe('omniboxSearch utilities', () => {
  describe('parseUrlAnatomy', () => {
    it('parses apex/www hosts, multi-part ccTLDs, and deep cloud subdomains accurately', () => {
      const amzDe = parseUrlAnatomy(
        'https://www.amazon.de/b/ref=dp_bc_1?ie=UTF8&node=3167641'
      );
      expect(amzDe.cleanHost).toBe('amazon.de');
      expect(amzDe.registrableDomain).toBe('amazon.de');
      expect(amzDe.registrableLabel).toBe('amazon');
      expect(amzDe.subdomainDepth).toBe(0);
      expect(amzDe.isRootUrl).toBe(false);
      expect(amzDe.isAuthRedirectUrl).toBe(false);
      expect(amzDe.preferredOriginUrl).toBe('https://www.amazon.de');

      const amzUk = parseUrlAnatomy('https://www.amazon.co.uk/');
      expect(amzUk.cleanHost).toBe('amazon.co.uk');
      expect(amzUk.registrableDomain).toBe('amazon.co.uk');
      expect(amzUk.registrableLabel).toBe('amazon');
      expect(amzUk.subdomainDepth).toBe(0);
      expect(amzUk.isRootUrl).toBe(true);

      const awsConsole = parseUrlAnatomy(
        'https://us-east-1.console.aws.amazon.com/costmanagement/home?region=us-east-1'
      );
      expect(awsConsole.cleanHost).toBe('us-east-1.console.aws.amazon.com');
      expect(awsConsole.registrableDomain).toBe('amazon.com');
      expect(awsConsole.registrableLabel).toBe('amazon');
      expect(awsConsole.subdomains).toEqual(['us-east-1', 'console', 'aws']);
      expect(awsConsole.subdomainDepth).toBe(3);
    });

    it('identifies OAuth/sign-in redirect URLs and strips redirect_uri values from searchable text', () => {
      const awsSignin = parseUrlAnatomy(
        'https://signin.aws.amazon.com/signin?redirect_uri=https%3A%2F%2Fwww.amazon.de%2Forders'
      );
      expect(awsSignin.isAuthRedirectUrl).toBe(true);
      expect(awsSignin.safeSearchText).not.toContain('amazon.de');
    });
  });

  describe('getHistoryCollapseKey', () => {
    it('collapses multiple AWS Sign-In redirect URLs sharing the same title into one key', () => {
      const k1 = getHistoryCollapseKey(
        'https://ap-south-1.signin.aws.amazon.com/oauth?client_id=arn%3Aaws%3Asignin',
        'Amazon Web Services Sign-In'
      );
      const k2 = getHistoryCollapseKey(
        'https://signin.aws.amazon.com/signin?redirect_uri=https%3A%2F%2Fus-east-1.console.aws.amazon.com',
        'Amazon Web Services Sign-In'
      );
      const k3 = getHistoryCollapseKey(
        'https://signin.aws.amazon.com/signin?redirect_uri=https%3A%2F%2Fap-south-1.console.aws.amazon.com',
        'Amazon Web Services Sign-In'
      );
      expect(k1).toBe(k2);
      expect(k2).toBe(k3);
    });
  });

  describe('rankOmniboxCandidates', () => {
    const now = 1_760_000_000_000;

    const screenshotCandidates: OmniboxCandidate[] = [
      {
        id: 'chrome-bm-aws-billing',
        source: 'chrome-bookmark',
        title: 'Billing Management',
        url: 'https://us-east-1.console.aws.amazon.com/costmanagement/home?region=us-east-1'
      },
      {
        id: 'chrome-bm-aws-rds',
        source: 'chrome-bookmark',
        title: 'bhavkosh-db Database',
        url: 'https://ap-south-1.console.aws.amazon.com/rds/home?region=ap-south-1#database:id=bhavkosh-db'
      },
      {
        id: 'tab-amazon-de',
        source: 'tab',
        title: 'Amazon.de: Home & Kitchen',
        url: 'https://www.amazon.de/b/ref=dp_bc_1?ie=UTF8&node=3167641',
        isOpenTab: true,
        tabId: 42,
        windowId: 10,
        isInActiveSpace: true,
        isInCurrentWindow: true,
        lastAccessed: now - 30_000
      },
      {
        id: 'hist-aws-signin',
        source: 'history',
        title: 'Amazon Web Services Sign-In',
        url: 'https://signin.aws.amazon.com/signin?redirect_uri=https%3A%2F%2Fus-east-1.console.aws.amazon.com',
        visitCount: 20,
        lastVisitTime: now - 3600_000
      }
    ];

    it('ranks open Amazon.de Today Tab #1, clean amazon.de homepage #2, and filters AWS Console noise for "amazon"', () => {
      const ranked = rankOmniboxCandidates(screenshotCandidates, 'amazon', { now });

      expect(ranked[0].id).toBe('tab-amazon-de');
      expect(ranked[1].id).toBe('synth-root-amazon.de');
      expect(ranked[1].url).toBe('https://www.amazon.de');

      // AWS Console bookmarks without "amazon" in title or leading subdomain are pruned as noise
      expect(ranked.some((r) => r.id === 'chrome-bm-aws-billing')).toBe(false);
      expect(ranked.some((r) => r.id === 'chrome-bm-aws-rds')).toBe(false);

      // AWS Sign-In history is heavily demoted behind both Amazon.de results
      const signinIdx = ranked.findIndex((r) => r.id === 'hist-aws-signin');
      if (signinIdx !== -1) {
        expect(signinIdx).toBeGreaterThan(1);
      }
    });

    it('surfaces AWS Console bookmarks at #1 when user searches "aws", "console", "billing", or "rds"', () => {
      expect(rankOmniboxCandidates(screenshotCandidates, 'billing', { now })[0].id).toBe(
        'chrome-bm-aws-billing'
      );
      expect(rankOmniboxCandidates(screenshotCandidates, 'rds', { now })[0].id).toBe(
        'chrome-bm-aws-rds'
      );
      expect(rankOmniboxCandidates(screenshotCandidates, 'bhavkosh', { now })[0].id).toBe(
        'chrome-bm-aws-rds'
      );

      const awsResults = rankOmniboxCandidates(screenshotCandidates, 'aws', { now });
      expect(['chrome-bm-aws-billing', 'chrome-bm-aws-rds']).toContain(awsResults[0].id);
    });

    it('does not match SSO URLs solely because another domain appears inside redirect_uri', () => {
      const ssoCandidate: OmniboxCandidate[] = [
        {
          id: 'hist-okta',
          source: 'history',
          title: 'Corporate SSO Sign In',
          url: 'https://id.corp.example.org/oauth2/authorize?redirect_uri=https%3A%2F%2Fwww.amazon.de%2F'
        }
      ];
      expect(rankOmniboxCandidates(ssoCandidate, 'amazon', { now })).toHaveLength(0);
    });

    it('puts clean homepage #1 when user explicitly types trailing slash "amazon.de/"', () => {
      const ranked = rankOmniboxCandidates(screenshotCandidates, 'amazon.de/', { now });
      expect(ranked[0].id).toBe('synth-root-amazon.de');
      expect(ranked[1].id).toBe('tab-amazon-de');
    });

    it('boosts history items with high typedCount and recent visits over stale one-off visits', () => {
      const historyCandidates: OmniboxCandidate[] = [
        {
          id: 'stale',
          source: 'history',
          title: 'GitHub Explore Old',
          url: 'https://github.com/explore/old-topic/deep/page?tab=1&sort=asc&page=3',
          visitCount: 1,
          typedCount: 0,
          lastVisitTime: now - 90 * 24 * 3600_000
        },
        {
          id: 'frequent',
          source: 'history',
          title: 'GitHub Pull Requests',
          url: 'https://github.com/pulls',
          visitCount: 45,
          typedCount: 6,
          lastVisitTime: now - 600_000
        }
      ];
      const ranked = rankOmniboxCandidates(historyCandidates, 'github', {
        now,
        synthesizeRootDomain: false
      });
      expect(ranked[0].id).toBe('frequent');
    });
  });

  describe('scoreActionCommand', () => {
    it('matches strong command title words (len >= 4) while ignoring weak short/description words', () => {
      expect(scoreActionCommand('Open Arctic Settings', 'Settings')).toBeGreaterThan(700);
      expect(scoreActionCommand('Theme: System (Auto Light/Dark)', 'system')).toBeGreaterThan(
        700
      );
      expect(scoreActionCommand('Sleep Inactive Background Tabs', 'tab')).toBe(0);
      expect(scoreActionCommand('Close Duplicate Tabs', 'find')).toBe(0);
    });
  });

  describe('computeInlineGhostSuffix', () => {
    it('uses top local suggestion host first (amazon -> .de) and falls back to site search engine', () => {
      const usAmzEngine = DEFAULT_SITE_SEARCH_ENGINES.find((e) => e.id === 'amazon')!;
      const ytEngine = DEFAULT_SITE_SEARCH_ENGINES.find((e) => e.id === 'youtube')!;

      // Even if engine were amazon.com, top local result on www.amazon.de yields ".de"!
      expect(
        computeInlineGhostSuffix(
          'amazon',
          'https://www.amazon.de/b/ref=dp_bc_1',
          'tab',
          usAmzEngine
        )
      ).toBe('.de');

      expect(
        computeInlineGhostSuffix(
          'ama',
          'https://www.amazon.de/b/ref=dp_bc_1',
          'tab',
          usAmzEngine
        )
      ).toBe('zon.de');

      // Non-engine domain like linear.app also gets inline host completion
      expect(
        computeInlineGhostSuffix('lin', 'https://linear.app/team/issues', 'bookmark', null)
      ).toBe('ear.app');

      // When top result is a search item (no local match), falls back to site search engine
      expect(
        computeInlineGhostSuffix(
          'you',
          'https://www.google.com/search?q=you',
          'search',
          ytEngine
        )
      ).toBe('tube');

      // When top result's host does not start with query (e.g. searching "billing"), returns empty
      expect(
        computeInlineGhostSuffix(
          'billing',
          'https://us-east-1.console.aws.amazon.com/costmanagement',
          'bookmark',
          null
        )
      ).toBe('');
    });
  });
});
