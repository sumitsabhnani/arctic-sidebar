import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SITE_SEARCH_ENGINES,
  findMatchingSiteEngine,
  getGhostAutocomplete,
  buildSiteSearchUrl,
  doesUrlMatchEngineDomain
} from './siteSearch';
import type { SiteSearchEngine } from '../../types';

describe('siteSearch utilities', () => {
  describe('findMatchingSiteEngine', () => {
    it('matches exact shortcut, alias, name, and domain', () => {
      expect(findMatchingSiteEngine('youtube')?.id).toBe('youtube');
      expect(findMatchingSiteEngine('yt')?.id).toBe('youtube');
      expect(findMatchingSiteEngine('youtube.com')?.id).toBe('youtube');
      expect(findMatchingSiteEngine('https://www.github.com')?.id).toBe('github');
      expect(findMatchingSiteEngine('g')?.id).toBe('google');
    });

    it('prioritizes custom search engines over default engines', () => {
      const customEngines: SiteSearchEngine[] = [
        {
          id: 'custom-gh',
          name: 'GitHub Enterprise',
          domain: 'ghe.example.com',
          shortcut: 'gh',
          searchUrlTemplate: 'https://ghe.example.com/search?q=%s'
        }
      ];
      expect(findMatchingSiteEngine('gh', customEngines)?.id).toBe('custom-gh');
    });

    it('ignores empty queries, command queries, multi-word queries, and URL paths', () => {
      expect(findMatchingSiteEngine('')).toBeNull();
      expect(findMatchingSiteEngine('>youtube')).toBeNull();
      expect(findMatchingSiteEngine('youtube music')).toBeNull();
      expect(findMatchingSiteEngine('https://github.com/user/repo')).toBeNull();
      expect(findMatchingSiteEngine('z')).toBeNull();
    });
  });

  describe('getGhostAutocomplete', () => {
    it('computes case-aware suffix for name, shortcut, or domain prefix', () => {
      const yt = DEFAULT_SITE_SEARCH_ENGINES.find((e) => e.id === 'youtube')!;
      expect(getGhostAutocomplete('you', yt)).toBe('tube');
      expect(getGhostAutocomplete('You', yt)).toBe('Tube');

      const mdn = DEFAULT_SITE_SEARCH_ENGINES.find((e) => e.id === 'mdn')!;
      expect(getGhostAutocomplete('dev', mdn)).toBe('eloper.mozilla.org');
      expect(getGhostAutocomplete('yt', yt)).toBe('');
      expect(getGhostAutocomplete('you ', yt)).toBe('');
    });
  });

  describe('buildSiteSearchUrl', () => {
    it('replaces %s placeholder or appends encoded query, and falls back to domain homepage when empty', () => {
      const yt = DEFAULT_SITE_SEARCH_ENGINES.find((e) => e.id === 'youtube')!;
      expect(buildSiteSearchUrl(yt, 'react 19')).toBe(
        'https://www.youtube.com/results?search_query=react%2019'
      );
      expect(buildSiteSearchUrl(yt, '   ')).toBe('https://youtube.com');

      const suffixEngine: SiteSearchEngine = {
        id: 'custom',
        name: 'Custom',
        domain: 'example.com',
        shortcut: 'ex',
        searchUrlTemplate: 'https://example.com/q='
      };
      expect(buildSiteSearchUrl(suffixEngine, 'hello world')).toBe(
        'https://example.com/q=hello%20world'
      );
    });
  });

  describe('doesUrlMatchEngineDomain', () => {
    it('matches exact domains, subdomains, and x.com/twitter.com aliases', () => {
      const gh = DEFAULT_SITE_SEARCH_ENGINES.find((e) => e.id === 'github')!;
      expect(doesUrlMatchEngineDomain('https://github.com/facebook/react', gh)).toBe(true);
      expect(doesUrlMatchEngineDomain('https://gist.github.com/123', gh)).toBe(true);
      expect(doesUrlMatchEngineDomain('https://notgithub.com', gh)).toBe(false);

      const xEngine = DEFAULT_SITE_SEARCH_ENGINES.find((e) => e.id === 'twitter')!;
      expect(doesUrlMatchEngineDomain('https://x.com/home', xEngine)).toBe(true);
      expect(doesUrlMatchEngineDomain('https://twitter.com/home', xEngine)).toBe(true);
    });
  });
});
