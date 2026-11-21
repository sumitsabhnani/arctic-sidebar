export type ColorThemeId =
  | 'crystal-aqua'
  | 'aqua-lagoon'
  | 'arctic-aurora'
  | 'coral-breeze'
  | 'glacier-blue'
  | 'midnight-amethyst'
  | 'forest-sage'
  | 'warm-terracotta'
  | 'pure-monochrome'
  | 'slate-grey';

export type ThemeMode = 'dark' | 'light' | 'system';

export const THEME_BOOTSTRAP_STORAGE_KEY = 'arctic_theme_bootstrap';
export const DEFAULT_THEME_MODE: ThemeMode = 'light';
export const DEFAULT_COLOR_THEME: ColorThemeId = 'pure-monochrome';

export interface ThemeBootstrapSnapshot {
  theme: ThemeMode;
  colorTheme: ColorThemeId;
}

export interface ThemeOption {
  id: ColorThemeId;
  name: string;
  tag: string;
  description: string;
  swatchGradient: string;
  accentColor: string;
  indicatorColor: string;
}

export const COLOR_THEMES: ThemeOption[] = [
  {
    id: 'crystal-aqua',
    name: 'Crystal Aqua',
    tag: 'Crisp White & Aqua',
    description: 'Clean white base with a soft crystal aqua mist and refreshing teal-aqua accents.',
    swatchGradient: 'linear-gradient(135deg, #ffffff 0%, #5eead4 55%, #0d9488 100%)',
    accentColor: '#0d9488',
    indicatorColor: '#14b8a6'
  },
  {
    id: 'aqua-lagoon',
    name: 'Aqua Lagoon',
    tag: 'Fresh Turquoise',
    description: 'Luminous tropical aqua, turquoise & sky-cyan multi-tone gradient.',
    swatchGradient: 'linear-gradient(135deg, #042f2e 0%, #06b6d4 50%, #5eead4 100%)',
    accentColor: '#0891b2',
    indicatorColor: '#2dd4bf'
  },
  {
    id: 'arctic-aurora',
    name: 'Arctic Aurora',
    tag: 'Mint, Sky & Lavender',
    description: 'Multi-hue pastel aurora blending fresh aqua-mint, sky blue, and soft periwinkle.',
    swatchGradient: 'linear-gradient(135deg, #2dd4bf 0%, #38bdf8 50%, #818cf8 100%)',
    accentColor: '#0284c7',
    indicatorColor: '#14b8a6'
  },
  {
    id: 'coral-breeze',
    name: 'Coral Breeze',
    tag: 'Rose & Warm Peach',
    description: 'Uplifting warm white, soft rose blossom, and sunlit apricot-peach gradient.',
    swatchGradient: 'linear-gradient(135deg, #fb7185 0%, #f43f5e 50%, #fdba74 100%)',
    accentColor: '#e11d48',
    indicatorColor: '#f97316'
  },
  {
    id: 'glacier-blue',
    name: 'Glacier Blue',
    tag: 'Arctic Default',
    description: 'Deep ice-blue & navy translucent gradient with cool cyan highlights.',
    swatchGradient: 'linear-gradient(135deg, #0e1726 0%, #0891b2 50%, #06b6d4 100%)',
    accentColor: '#06b6d4',
    indicatorColor: '#38bdf8'
  },
  {
    id: 'midnight-amethyst',
    name: 'Midnight Amethyst',
    tag: 'Moody & Creative',
    description: 'Deep dark indigo & violet gradient with purple-magenta active indicators.',
    swatchGradient: 'linear-gradient(135deg, #160c24 0%, #9333ea 50%, #c084fc 100%)',
    accentColor: '#c084fc',
    indicatorColor: '#e879f9'
  },
  {
    id: 'forest-sage',
    name: 'Forest Sage',
    tag: 'Earthy & Grounding',
    description: 'Earthy dark green & olive palette with warm sage & golden-amber dots.',
    swatchGradient: 'linear-gradient(135deg, #0d1a14 0%, #059669 50%, #f59e0b 100%)',
    accentColor: '#34d399',
    indicatorColor: '#f59e0b'
  },
  {
    id: 'warm-terracotta',
    name: 'Warm Terracotta',
    tag: 'Autumnal Warmth',
    description: 'Rust, cinnamon & clay gradient paired with warm cream elements.',
    swatchGradient: 'linear-gradient(135deg, #20110a 0%, #ea580c 50%, #fed7aa 100%)',
    accentColor: '#fb923c',
    indicatorColor: '#fed7aa'
  },
  {
    id: 'pure-monochrome',
    name: 'Pure Monochrome',
    tag: 'Normal White',
    description: 'Normal clean white in light mode, deep dark charcoal in dark mode. No colors.',
    swatchGradient: 'linear-gradient(135deg, #18181b 0%, #71717a 50%, #f4f4f5 100%)',
    accentColor: '#71717a',
    indicatorColor: '#e4e4e7'
  },
  {
    id: 'slate-grey',
    name: 'Slate Grey',
    tag: 'Neutral Grey',
    description: 'Balanced neutral grey and steel tones for a calm, non-colored aesthetic.',
    swatchGradient: 'linear-gradient(135deg, #27272a 0%, #52525b 50%, #a1a1aa 100%)',
    accentColor: '#a1a1aa',
    indicatorColor: '#d4d4d8'
  }
];

const COLOR_THEME_ID_SET: ReadonlySet<string> = new Set(COLOR_THEMES.map((t) => t.id));

export function isValidColorTheme(val: unknown): val is ColorThemeId {
  return typeof val === 'string' && COLOR_THEME_ID_SET.has(val);
}

export function isValidThemeMode(val: unknown): val is ThemeMode {
  return val === 'light' || val === 'dark' || val === 'system';
}

export function resolveEffectiveTheme(theme: ThemeMode): 'dark' | 'light' {
  if (theme === 'system') {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch {
        return 'light';
      }
    }
    return 'light';
  }
  return theme === 'dark' ? 'dark' : 'light';
}

/**
 * Reads the last-known theme snapshot synchronously from `localStorage` so
 * `sidepanel.html` and `command.html` initialize React state without flashing light mode.
 */
export function readThemeBootstrap(): ThemeBootstrapSnapshot {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(THEME_BOOTSTRAP_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { theme?: unknown; colorTheme?: unknown };
        return {
          theme: isValidThemeMode(parsed?.theme) ? parsed.theme : DEFAULT_THEME_MODE,
          colorTheme: isValidColorTheme(parsed?.colorTheme)
            ? parsed.colorTheme
            : DEFAULT_COLOR_THEME
        };
      }
    } catch {
      // ignore localStorage access or JSON parse errors
    }
  }
  return {
    theme: DEFAULT_THEME_MODE,
    colorTheme: DEFAULT_COLOR_THEME
  };
}

/**
 * Persists a lightweight synchronous snapshot to `localStorage` so external pre-paint
 * bootstrap (`themeInit.js`) and initial `useState` avoid any flash of wrong theme.
 */
export function persistThemeBootstrap(patch: {
  theme?: ThemeMode;
  colorTheme?: ColorThemeId;
}): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const current = readThemeBootstrap();
    const next: ThemeBootstrapSnapshot = {
      theme: patch.theme && isValidThemeMode(patch.theme) ? patch.theme : current.theme,
      colorTheme:
        patch.colorTheme && isValidColorTheme(patch.colorTheme)
          ? patch.colorTheme
          : current.colorTheme
    };
    window.localStorage.setItem(THEME_BOOTSTRAP_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota or restricted storage errors
  }
}

export function applyThemeToDocument(
  theme: ThemeMode,
  colorTheme: ColorThemeId,
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined
): 'dark' | 'light' {
  const effective = resolveEffectiveTheme(theme);
  const root = doc?.documentElement;
  if (root) {
    if (effective === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }
    root.setAttribute('data-color-theme', colorTheme);
  }
  return effective;
}

export function resetThemeBootstrapForTests(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(THEME_BOOTSTRAP_STORAGE_KEY);
  } catch {
    // ignore
  }
}
