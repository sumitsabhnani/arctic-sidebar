import { describe, it, expect } from 'vitest';
import { normalizeUrl, isUrlNavigatedAway, getDomainFromUrl, getFaviconUrl } from './url';

describe('url utilities', () => {
  describe('normalizeUrl', () => {
    it('normalizes standard https URLs and removes trailing slashes', () => {
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
      expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    });

    it('strips www. prefixes', () => {
      expect(normalizeUrl('https://www.google.com')).toBe('https://google.com');
      expect(normalizeUrl('http://www.github.com/profile/')).toBe('https://github.com/profile');
    });

    it('upgrades http to https for non-local web URLs', () => {
      expect(normalizeUrl('http://example.com')).toBe('https://example.com');
    });

    it('preserves http for localhost and local IP addresses', () => {
      expect(normalizeUrl('http://localhost:3000/')).toBe('http://localhost:3000');
      expect(normalizeUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080');
      expect(normalizeUrl('http://192.168.1.5:5000/app/')).toBe('http://192.168.1.5:5000/app');
    });

    it('strips tracking query parameters (utm_*, gclid, fbclid, etc.) and sorts remaining params', () => {
      const url = 'https://example.com/item?utm_source=twitter&b=2&fbclid=xyz&a=1&gclid=123';
      expect(normalizeUrl(url)).toBe('https://example.com/item?a=1&b=2');
    });

    it('preserves hash routing (#/route) but strips page anchor fragments (#heading)', () => {
      expect(normalizeUrl('https://app.com/#/dashboard/metrics')).toBe('https://app.com#/dashboard/metrics');
      expect(normalizeUrl('https://example.com/article#section-2')).toBe('https://example.com/article');
    });

    // Negative / Edge cases
    it('handles empty, null, or malformed URL inputs gracefully without throwing', () => {
      expect(normalizeUrl('')).toBe('');
      expect(normalizeUrl('   ')).toBe('');
      expect(normalizeUrl('not-a-valid-url')).toBe('not-a-valid-url');
      expect(normalizeUrl('invalid-url/')).toBe('invalid-url');
    });
  });

  describe('isUrlNavigatedAway', () => {
    it('returns true when currentUrl has navigated to a different page or path', () => {
      expect(isUrlNavigatedAway('https://github.com/settings', 'https://github.com')).toBe(true);
      expect(isUrlNavigatedAway('https://linear.app/issue/123', 'https://linear.app/team')).toBe(true);
    });

    it('returns false when currentUrl only differs by tracking params, www, or trailing slash', () => {
      expect(isUrlNavigatedAway('https://www.github.com/', 'https://github.com')).toBe(false);
      expect(isUrlNavigatedAway('https://github.com?utm_source=test', 'https://github.com')).toBe(false);
      expect(isUrlNavigatedAway('https://github.com#section-anchor', 'https://github.com')).toBe(false);
    });

    // Negative / Edge cases
    it('returns false if either currentUrl or originalUrl is empty', () => {
      expect(isUrlNavigatedAway('', 'https://github.com')).toBe(false);
      expect(isUrlNavigatedAway('https://github.com', '')).toBe(false);
      expect(isUrlNavigatedAway('', '')).toBe(false);
    });
  });

  describe('getDomainFromUrl', () => {
    it('extracts clean hostnames without www.', () => {
      expect(getDomainFromUrl('https://www.nytimes.com/world')).toBe('nytimes.com');
      expect(getDomainFromUrl('https://sub.domain.co.uk/path')).toBe('sub.domain.co.uk');
    });

    // Negative / Edge cases
    it('returns the raw input if URL parsing fails or input is empty', () => {
      expect(getDomainFromUrl('invalid-url-string')).toBe('invalid-url-string');
      expect(getDomainFromUrl('')).toBe('');
    });
  });

  describe('getFaviconUrl', () => {
    it('constructs Chrome internal favicon URL using runtime ID', () => {
      const result = getFaviconUrl('https://github.com', 32);
      expect(result).toContain('chrome-extension://mock-extension-id/_favicon/');
      expect(result).toContain('pageUrl=' + encodeURIComponent('https://github.com'));
      expect(result).toContain('size=32');
    });

    // Negative / Edge cases
    it('returns empty string if pageUrl is empty', () => {
      expect(getFaviconUrl('')).toBe('');
    });
  });
});
