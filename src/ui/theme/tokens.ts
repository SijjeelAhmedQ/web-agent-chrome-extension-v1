/**
 * Design tokens, Grok-style: monochrome neutrals with the text colour as the primary colour
 * (black on white, white on black). Red, amber and green only carry meaning — errors,
 * warnings, “connected”. CSS variables in styles/tokens.css mirror these values.
 */

export type Mode = 'light' | 'dark';

export const palette = {
  light: {
    bg: '#fcfcfc',
    bgSubtle: '#f7f7f7',
    bgMuted: '#efefef',
    surface: '#ffffff',
    elevated: '#ffffff',
    border: '#e3e3e3',
    borderSubtle: '#ececec',
    text: '#0d0d0d',
    textSecondary: '#3f3f3f',
    textMuted: '#6b6b6b',
    textFaint: '#a3a3a3',
    primary: '#0d0d0d',
    primaryHover: '#2e2e2e',
    primaryActive: '#000000',
    primarySoft: '#f0f0f0',
    onPrimary: '#ffffff',
    accent: '#0d0d0d',
    danger: '#dc2626',
    dangerSoft: '#fef2f2',
    warning: '#b45309',
    warningSoft: '#fff8eb',
    success: '#15803d',
    info: '#3f3f3f',
  },
  dark: {
    bg: '#141414',
    bgSubtle: '#191919',
    bgMuted: '#242424',
    surface: '#1c1c1c',
    elevated: '#1f1f1f',
    border: 'rgba(255,255,255,0.12)',
    borderSubtle: 'rgba(255,255,255,0.075)',
    text: '#fafafa',
    textSecondary: '#cfcfcf',
    textMuted: '#8e8e8e',
    textFaint: '#5f5f5f',
    primary: '#fafafa',
    primaryHover: '#e2e2e2',
    primaryActive: '#ffffff',
    primarySoft: 'rgba(255,255,255,0.08)',
    onPrimary: '#0d0d0d',
    accent: '#fafafa',
    danger: '#f87171',
    dangerSoft: 'rgba(248,113,113,0.10)',
    warning: '#fbbf24',
    warningSoft: 'rgba(251,191,36,0.10)',
    success: '#4ade80',
    info: '#cfcfcf',
  },
} as const;

export const fonts = {
  sans: "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  mono: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;
