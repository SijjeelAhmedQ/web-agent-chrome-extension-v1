import type { ThinkingLevel } from '@/shared/types/config';

export const uid = (prefix = ''): string =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** `www.example.com` → `example.com`; non-web URLs return ''. */
export function siteOf(url: string | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (!/^https?:|^file:/.test(u.protocol)) return '';
    if (u.protocol === 'file:') return 'Local file';
    return u.host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Matches a URL against user-written site patterns:
 *   example.com        → example.com and any subdomain
 *   *.example.com      → subdomains only
 *   localhost:5173     → that host and port
 *   example.com/admin  → paths under /admin
 */
export function matchesSite(url: string, patterns: string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.host.toLowerCase().replace(/^www\./, '');
  const hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  return patterns.some((raw) => {
    let p = raw.trim().toLowerCase();
    if (!p) return false;
    p = p.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
    const slash = p.indexOf('/');
    const hostPart = slash >= 0 ? p.slice(0, slash) : p;
    const pathPart = slash >= 0 ? p.slice(slash) : '';
    const target = hostPart.includes(':') ? host : hostname;
    let hostOk: boolean;
    if (hostPart.startsWith('*.')) {
      const base = hostPart.slice(2);
      hostOk = target.endsWith(`.${base}`);
    } else {
      hostOk = target === hostPart || target.endsWith(`.${hostPart}`);
    }
    if (!hostOk) return false;
    return !pathPart || u.pathname.toLowerCase().startsWith(pathPart.replace(/\*$/, ''));
  });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0.1, Math.round(ms / 100) / 10)}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function formatRelative(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = new Date(ts);
  const yesterday = new Date(now - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const isExtensionContext = (): boolean => typeof chrome !== 'undefined' && !!chrome.runtime?.id;

/** The thinking a connection asks for — an older setup's “Skip thinking” is off; unset is the model's own. */
export const thinkingOf = (p: { thinking?: ThinkingLevel; skipThinking?: boolean }): ThinkingLevel | undefined =>
  p.thinking ?? (p.skipThinking ? 'off' : undefined);
