/**
 * Design tokens. One emerald accent (from codeiyo.com) on calm slate neutrals; the
 * emerald→sky gradient appears only where the AI itself is represented (brand mark,
 * “working” state) — the same rule CareFlow uses for its AI gradient.
 * CSS variables in styles/tokens.css mirror these values.
 */

export type Mode = 'light' | 'dark';

export const palette = {
  light: {
    bg: '#f7f9fb',
    bgSubtle: '#f1f5f9',
    bgMuted: '#eef2f6',
    surface: '#ffffff',
    elevated: '#ffffff',
    border: '#e2e8f0',
    borderSubtle: '#eef2f6',
    text: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#64748b',
    textFaint: '#94a3b8',
    primary: '#047857',
    primaryHover: '#065f46',
    primaryActive: '#064e3b',
    primarySoft: '#ecfdf5',
    onPrimary: '#ffffff',
    accent: '#10b981',
    danger: '#dc2626',
    dangerSoft: '#fef2f2',
    warning: '#b45309',
    warningSoft: '#fffbeb',
    success: '#047857',
    info: '#0369a1',
  },
  dark: {
    bg: '#020617',
    bgSubtle: '#0a1022',
    bgMuted: '#111a2e',
    surface: '#0b1324',
    elevated: '#0f172a',
    border: 'rgba(255,255,255,0.08)',
    borderSubtle: 'rgba(255,255,255,0.055)',
    text: '#e2e8f0',
    textSecondary: '#a3b0c2',
    textMuted: '#7c8aa0',
    textFaint: '#56627a',
    primary: '#10b981',
    primaryHover: '#34d399',
    primaryActive: '#059669',
    primarySoft: 'rgba(16,185,129,0.12)',
    onPrimary: '#03140d',
    accent: '#10b981',
    danger: '#f87171',
    dangerSoft: 'rgba(248,113,113,0.10)',
    warning: '#fbbf24',
    warningSoft: 'rgba(251,191,36,0.10)',
    success: '#34d399',
    info: '#38bdf8',
  },
} as const;

export const fonts = {
  sans: "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  mono: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

export const radius = { sm: 8, md: 10, lg: 14, xl: 18, pill: 999 } as const;
