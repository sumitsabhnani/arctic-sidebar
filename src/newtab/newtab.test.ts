import { describe, it, expect } from 'vitest';
import { isLikelyUrl, formatNavigationUrl } from './App';

describe('newtab url detection and formatting', () => {
  describe('isLikelyUrl', () => {
    it('identifies standard web protocols as URLs (positive)', () => {
      expect(isLikelyUrl('https://google.com')).toBe(true);
      expect(isLikelyUrl('http://example.com/path')).toBe(true);
      expect(isLikelyUrl('HTTPS://GITHUB.COM')).toBe(true);
    });

    it('identifies localhost and local IP addresses with ports (positive)', () => {
      expect(isLikelyUrl('localhost')).toBe(true);
      expect(isLikelyUrl('localhost:3000')).toBe(true);
      expect(isLikelyUrl('localhost:8080/dashboard')).toBe(true);
      expect(isLikelyUrl('127.0.0.1:5173')).toBe(true);
      expect(isLikelyUrl('192.168.1.1')).toBe(true);
    });

    it('identifies domain-like strings without protocols (positive)', () => {
      expect(isLikelyUrl('github.com')).toBe(true);
      expect(isLikelyUrl('sub.domain.co.uk')).toBe(true);
      expect(isLikelyUrl('news.ycombinator.com/item?id=123')).toBe(true);
    });

    it('rejects general search queries and multi-word phrases (negative)', () => {
      expect(isLikelyUrl('react hooks tutorial')).toBe(false);
      expect(isLikelyUrl('how to center a div')).toBe(false);
      expect(isLikelyUrl('hello world')).toBe(false);
    });

    it('rejects single words without domain extension or protocol (negative)', () => {
      expect(isLikelyUrl('hello')).toBe(false);
      expect(isLikelyUrl('search')).toBe(false);
      expect(isLikelyUrl('')).toBe(false);
      expect(isLikelyUrl('   ')).toBe(false);
    });
  });

  describe('formatNavigationUrl', () => {
    it('preserves existing http / https scheme for valid URLs (positive)', () => {
      expect(formatNavigationUrl('https://google.com')).toBe('https://google.com');
      expect(formatNavigationUrl('http://example.org')).toBe('http://example.org');
    });

    it('prepends https:// to domain-like strings (positive)', () => {
      expect(formatNavigationUrl('github.com')).toBe('https://github.com');
      expect(formatNavigationUrl('localhost:3000')).toBe('https://localhost:3000');
    });

    it('converts non-URL search queries into Google search URLs (negative/search fallback)', () => {
      expect(formatNavigationUrl('vitest mock setup')).toBe('https://www.google.com/search?q=vitest%20mock%20setup');
      expect(formatNavigationUrl('hello world')).toBe('https://www.google.com/search?q=hello%20world');
    });

    it('handles leading and trailing whitespace cleanly', () => {
      expect(formatNavigationUrl('   nytimes.com   ')).toBe('https://nytimes.com');
      expect(formatNavigationUrl('   typescript tips   ')).toBe('https://www.google.com/search?q=typescript%20tips');
    });
  });
});
