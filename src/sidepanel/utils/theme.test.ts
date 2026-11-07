import { describe, it, expect, vi } from 'vitest';
import {
  COLOR_THEMES,
  isValidColorTheme,
  isValidThemeMode,
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
});
