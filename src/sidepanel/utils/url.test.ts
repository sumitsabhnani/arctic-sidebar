import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  isUrlNavigatedAway,
  getDomainFromUrl,
  getFaviconUrl,
  isScratchpadUrl,
  getScratchpadNoteId,
  isGoogleDocUrl,
  encodeNoteHash,
  decodeNoteHash,
  extractNoteContentFromUrl,
  getEffectiveTabUrl,
  doesTabUrlMatchBookmark,
  ARCTIC_SCRATCHPAD_PREFIX,
  ARCTIC_GLOBAL_SCRATCHPAD_URL
} from './url';

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

  describe('isScratchpadUrl and getScratchpadNoteId', () => {
    it('detects https://arctic.local/note/ as scratchpad URL and extracts ID', () => {
      const noteUrl = `${ARCTIC_SCRATCHPAD_PREFIX}note_12345`;
      expect(isScratchpadUrl(noteUrl)).toBe(true);
      expect(getScratchpadNoteId(noteUrl)).toBe('note_12345');
    });

    it('handles note URLs with hash fragments and extracts clean ID', () => {
      const noteUrl = `${ARCTIC_SCRATCHPAD_PREFIX}note_9999#My%20Note%20Content`;
      expect(isScratchpadUrl(noteUrl)).toBe(true);
      expect(getScratchpadNoteId(noteUrl)).toBe('note_9999');
      expect(extractNoteContentFromUrl(noteUrl)).toBe('My Note Content');
    });

    it('detects global scratchpad URL', () => {
      expect(isScratchpadUrl(ARCTIC_GLOBAL_SCRATCHPAD_URL)).toBe(true);
      expect(isScratchpadUrl(`${ARCTIC_GLOBAL_SCRATCHPAD_URL}#Test%20Global`)).toBe(true);
      expect(extractNoteContentFromUrl(`${ARCTIC_GLOBAL_SCRATCHPAD_URL}#Test%20Global`)).toBe('Test Global');
    });

    it('encodes and decodes note hash content including special characters and newlines', () => {
      const original = 'Hello world!\nLine 2 with emojis 🚀 & special chars: ?&=#';
      const encoded = encodeNoteHash(original);
      expect(encoded).not.toBe('');
      expect(decodeNoteHash(encoded)).toBe(original);
    });

    it('handles empty hash or invalid inputs gracefully', () => {
      expect(encodeNoteHash('')).toBe('');
      expect(decodeNoteHash('')).toBe('');
      expect(extractNoteContentFromUrl('')).toBe('');
      expect(extractNoteContentFromUrl('https://example.com')).toBe('');
    });

    it('detects arctic://note/ as scratchpad URL and extracts ID', () => {
      const legacyNoteUrl = 'arctic://note/note_abcde';
      expect(isScratchpadUrl(legacyNoteUrl)).toBe(true);
      expect(getScratchpadNoteId(legacyNoteUrl)).toBe('note_abcde');
    });

    it('returns false and empty string for non-scratchpad URLs or empty strings', () => {
      expect(isScratchpadUrl('https://google.com')).toBe(false);
      expect(getScratchpadNoteId('https://google.com')).toBe('');
      expect(isScratchpadUrl('')).toBe(false);
      expect(getScratchpadNoteId('')).toBe('');
      expect(isScratchpadUrl(undefined)).toBe(false);
      expect(getScratchpadNoteId(undefined)).toBe('');
    });
  });

  describe('isGoogleDocUrl', () => {
    it('detects docs.new shortcut URL', () => {
      expect(isGoogleDocUrl('https://docs.new')).toBe(true);
      expect(isGoogleDocUrl('http://docs.new/')).toBe(true);
    });

    it('detects document.new shortcut URL', () => {
      expect(isGoogleDocUrl('https://document.new')).toBe(true);
    });

    it('detects Google Docs document editor URLs', () => {
      expect(isGoogleDocUrl('https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit')).toBe(true);
    });

    it('returns false for other services or non-doc URLs', () => {
      expect(isGoogleDocUrl('https://docs.google.com/spreadsheets/d/123')).toBe(false);
      expect(isGoogleDocUrl('https://docs.google.com/presentation/d/123')).toBe(false);
      expect(isGoogleDocUrl('https://google.com')).toBe(false);
      expect(isGoogleDocUrl('')).toBe(false);
      expect(isGoogleDocUrl(undefined)).toBe(false);
    });
  });

  describe('getEffectiveTabUrl', () => {
    it('falls back to pendingUrl when a sleeping/restoring tab has empty or about:blank url', () => {
      expect(
        getEffectiveTabUrl({
          url: '',
          pendingUrl: 'https://linear.app/team/inbox'
        })
      ).toBe('https://linear.app/team/inbox');

      expect(
        getEffectiveTabUrl({
          url: 'about:blank',
          pendingUrl: 'https://mail.google.com/mail/u/0/#inbox'
        })
      ).toBe('https://mail.google.com/mail/u/0/#inbox');
    });

    it('unwraps third-party tab-suspender extension URLs to the underlying target URL', () => {
      const suspendedUrl =
        'chrome-extension://klbibkeccnjlkjkiokjodocebajanakg/suspended.html#ttl=GitHub&uri=https%3A%2F%2Fgithub.com%2F notifications';
      expect(getEffectiveTabUrl({ url: suspendedUrl.replace(' ', '') })).toBe(
        'https://github.com/notifications'
      );
    });
  });

  describe('doesTabUrlMatchBookmark', () => {
    it('matches canonical web-app redirects (Gmail, Calendar, Drive, Google Docs ?tab=t.0, Discord, Notion)', () => {
      expect(
        doesTabUrlMatchBookmark(
          'https://mail.google.com/mail/u/0/#inbox',
          'https://gmail.com'
        )
      ).toBe(true);
      expect(
        doesTabUrlMatchBookmark(
          'https://calendar.google.com/calendar/u/0/r/week',
          'https://calendar.google.com'
        )
      ).toBe(true);
      expect(
        doesTabUrlMatchBookmark(
          'https://drive.google.com/drive/u/0/my-drive',
          'https://drive.google.com'
        )
      ).toBe(true);
      expect(
        doesTabUrlMatchBookmark(
          'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?tab=t.0#heading=h.123',
          'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=sharing'
        )
      ).toBe(true);
      expect(
        doesTabUrlMatchBookmark(
          'https://discord.com/channels/@me',
          'https://discord.com/app'
        )
      ).toBe(true);
      expect(
        doesTabUrlMatchBookmark(
          'https://www.notion.so/myworkspace/Roadmap-Spec-0123456789abcdef0123456789abcdef?pvs=4',
          'https://www.notion.so/0123456789abcdef0123456789abcdef'
        )
      ).toBe(true);
      expect(
        doesTabUrlMatchBookmark(
          'https://keep.google.com/u/0/',
          'https://keep.google.com'
        )
      ).toBe(true);
      expect(
        doesTabUrlMatchBookmark(
          'https://outlook.live.com/mail/0/inbox',
          'https://outlook.live.com/mail'
        )
      ).toBe(true);
      expect(
        doesTabUrlMatchBookmark(
          'https://docs.google.com/u/0/spreadsheets/d/sheetId123/edit?pli=1',
          'https://docs.google.com/spreadsheets/d/sheetId123'
        )
      ).toBe(true);
    });

    it('keeps secondary Google accounts (/u/1) distinct from primary (/u/0)', () => {
      expect(
        doesTabUrlMatchBookmark(
          'https://mail.google.com/mail/u/1/#inbox',
          'https://gmail.com'
        )
      ).toBe(false);
      expect(
        doesTabUrlMatchBookmark(
          'https://docs.google.com/u/1/document/d/docId123/edit',
          'https://docs.google.com/document/d/docId123/edit'
        )
      ).toBe(false);
    });

    it('does NOT falsely match distinct content or search pages on the same domain', () => {
      expect(
        doesTabUrlMatchBookmark(
          'https://www.youtube.com/results?search_query=music',
          'https://www.youtube.com'
        )
      ).toBe(false);
      expect(
        doesTabUrlMatchBookmark(
          'https://www.google.com/search?q=vitest',
          'https://www.google.com'
        )
      ).toBe(false);
      expect(
        doesTabUrlMatchBookmark(
          'https://github.com/facebook/react',
          'https://github.com'
        )
      ).toBe(false);
    });
  });
});
