export type ColorThemeId = 'glacier-blue' | 'midnight-amethyst' | 'forest-sage' | 'warm-terracotta';
export type ThemeMode = 'dark' | 'light';

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
  }
];
