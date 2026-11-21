import { describe, it, expect, vi } from 'vitest';
import {
  COLOR_THEMES,
  THEME_BOOTSTRAP_STORAGE_KEY,
  applyThemeToDocument,
  isValidColorTheme,
  isValidThemeMode,
  persistThemeBootstrap,
  readThemeBootstrap,
  resolveEffectiveTheme
} from './theme';

describe('theme utilities', () => {
  describe('isValidColorTheme', () => {
    it('returns true for all registered ColorThemeIds', () => {
      for (const theme of COLOR_THEMES) {
        expect(isValidColorTheme(theme.id)).toBe(true);
      }
    });

    it('returns false for invalid or non-string values', () => {
      expect(isValidColorTheme('invalid-theme')).toBe(false);
      expect(isValidColorTheme('')).toBe(false);
      expect(isValidColorTheme(null)).toBe(false);
      expect(isValidColorTheme(undefined)).toBe(false);
      expect(isValidColorTheme(123)).toBe(false);
    });
  });

  describe('isValidThemeMode', () => {
    it('validates light, dark, and system theme modes', () => {
      expect(isValidThemeMode('light')).toBe(true);
      expect(isValidThemeMode('dark')).toBe(true);
      expect(isValidThemeMode('system')).toBe(true);
      expect(isValidThemeMode('auto')).toBe(false);
      expect(isValidThemeMode(null)).toBe(false);
    });
  });

  describe('resolveEffectiveTheme', () => {
    it('returns explicit light or dark mode directly', () => {
      expect(resolveEffectiveTheme('light')).toBe('light');
      expect(resolveEffectiveTheme('dark')).toBe('dark');
    });

    it('resolves system mode using window.matchMedia prefers-color-scheme', () => {
      const originalMatchMedia = window.matchMedia;
      try {
        window.matchMedia = vi.fn().mockReturnValue({ matches: true });
        expect(resolveEffectiveTheme('system')).toBe('dark');

        window.matchMedia = vi.fn().mockReturnValue({ matches: false });
        expect(resolveEffectiveTheme('system')).toBe('light');
      } finally {
        window.matchMedia = originalMatchMedia;
      }
    });

    it('falls back to light if matchMedia throws an error', () => {
      const originalMatchMedia = window.matchMedia;
      try {
        window.matchMedia = vi.fn(() => {
          throw new Error('matchMedia unavailable');
        });
        expect(resolveEffectiveTheme('system')).toBe('light');
      } finally {
        window.matchMedia = originalMatchMedia;
      }
    });
  });

  describe('theme bootstrap cache & pre-paint initialization', () => {
    it('returns safe defaults when bootstrap cache is empty or malformed', () => {
      expect(readThemeBootstrap()).toEqual({
        theme: 'light',
        colorTheme: 'pure-monochrome'
      });

      window.localStorage.setItem(THEME_BOOTSTRAP_STORAGE_KEY, '{invalid-json');
      expect(readThemeBootstrap()).toEqual({
        theme: 'light',
        colorTheme: 'pure-monochrome'
      });

      window.localStorage.setItem(
        THEME_BOOTSTRAP_STORAGE_KEY,
        JSON.stringify({ theme: 'bogus', colorTheme: 'not-a-palette' })
      );
      expect(readThemeBootstrap()).toEqual({
        theme: 'light',
        colorTheme: 'pure-monochrome'
      });
    });

    it('merges partial theme and palette updates into localStorage and applies classes to documentElement', () => {
      persistThemeBootstrap({ theme: 'dark' });
      expect(readThemeBootstrap()).toEqual({
        theme: 'dark',
        colorTheme: 'pure-monochrome'
      });

      persistThemeBootstrap({ colorTheme: 'midnight-amethyst' });
      expect(readThemeBootstrap()).toEqual({
        theme: 'dark',
        colorTheme: 'midnight-amethyst'
      });

      applyThemeToDocument('dark', 'midnight-amethyst');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('light')).toBe(false);
      expect(document.documentElement.getAttribute('data-color-theme')).toBe('midnight-amethyst');
    });

    it('resolves system mode correctly when applying theme to documentElement before paint', () => {
      const originalMatchMedia = window.matchMedia;
      try {
        window.matchMedia = vi.fn().mockReturnValue({ matches: true });
        document.documentElement.className = 'light';
        document.documentElement.setAttribute('data-color-theme', 'pure-monochrome');

        persistThemeBootstrap({ theme: 'system', colorTheme: 'glacier-blue' });
        const boot = readThemeBootstrap();
        applyThemeToDocument(boot.theme, boot.colorTheme);

        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(document.documentElement.classList.contains('light')).toBe(false);
        expect(document.documentElement.getAttribute('data-color-theme')).toBe('glacier-blue');
      } finally {
        window.matchMedia = originalMatchMedia;
      }
    });
  });
});
