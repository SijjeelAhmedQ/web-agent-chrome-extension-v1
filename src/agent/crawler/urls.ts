/**
 * Addresses, as the crawler sees them: one form of each address (no tracking parameters, no plain #anchors), and
 * the kind of page it is — record ids made general, so the 5,000 patient pages are one kind of page, read once.
 */

const TRACKING = /^(utm_\w+|fbclid|gclid|mc_\w+|ref|_ga|_gl)$/i;
const FILES = /\.(pdf|zip|rar|7z|gz|tar|png|jpe?g|gif|webp|svg|ico|mp4|mp3|wav|avi|mov|docx?|xlsx?|pptx?|csv|exe|dmg|apk)$/i;

/** A hash that is the page's route (`#/patients`, `#!/x`) and not a jump to a heading. */
const routeHash = (hash: string) => /^#!?\//.test(hash);

/** The address in one form, or null when it is not a page to visit (mail, phone, script, file). */
export function normalizeUrl(href: string, base?: string): string | null {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (FILES.test(u.pathname)) return null;
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  if (!routeHash(u.hash)) u.hash = '';
  let path = u.pathname.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/$/, '');
  u.pathname = path;
  return u.toString();
}

/** Same site: the same host (with or without `www.`). Other sites' links are not followed. */
export function sameSite(url: string, host: string): boolean {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, '') === host.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
}

/** A path segment that is a record's id rather than a page's name. */
function isId(seg: string): boolean {
  if (/^\d+$/.test(seg)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true;
  if (/^[0-9a-f]{16,}$/i.test(seg)) return true;
  // Mixed letters and digits, long (a slug's hash, a token): “a8F3kq92Lm”.
  if (seg.length >= 12 && /\d/.test(seg) && /[a-z]/i.test(seg) && !/[-_]/.test(seg)) return true;
  return false;
}

const generalPath = (path: string) =>
  path
    .split('/')
    .map((s) => (s && isId(decodeURIComponent(s)) ? ':id' : s.toLowerCase()))
    .join('/');

/**
 * The kind of page an address is: its path (and route hash) with ids made general, and the names of its query
 * parameters without their values — `/patients/123?tab=notes` and `/patients/456?tab=notes` are one kind.
 * A `tab`/`view`/`section`-like parameter keeps its value: it shows another screen.
 */
export function templateOf(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const params = [...u.searchParams.entries()]
    .map(([k, v]) => (/^(tab|view|section|page_?type|mode|type|screen|step)$/i.test(k) ? `${k}=${v.toLowerCase()}` : k))
    .sort();
  const hash = routeHash(u.hash) ? `#${generalPath(u.hash.replace(/^#!?/, '').split('?')[0])}` : '';
  return `${generalPath(u.pathname)}${params.length ? `?${params.join('&')}` : ''}${hash}`;
}

/**
 * The page a tab or view belongs to: its kind with the tab-like parameters left out — `/patients/:id?tab=insight`
 * and `/patients/:id?tab=overview` are two screens of one page (one header, one row of tabs).
 */
export function pageOfScreen(url: string): string {
  return templateOf(url)
    .replace(/([?&])(tab|view|section|page_?type|mode|type|screen|step)=[^&#]*/gi, '$1')
    .replace(/[?&]+(?=&|#|$)/g, '')
    .replace(/\?&+/, '?');
}

/** An address that signs in or out: a page the session is gone on, or one that ends it. */
export const isLoginUrl = (url: string) => /\/(log-?in|sign-?in|auth(?:enticate)?|sso|account\/login|session\/new)(\/|\?|#|$)/i.test(safePath(url));
export const isLogoutUrl = (url: string) => /(log-?out|sign-?out|log-?off|end-?session)/i.test(safePath(url));

function safePath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return url;
  }
}
