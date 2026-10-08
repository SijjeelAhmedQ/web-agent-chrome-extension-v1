import type { ElementInfo, ElementRisk, PageSnapshot, ReadMode } from '@/shared/types/page';
import type { FindResult } from '../messaging/protocol';
import {
  accessibleName,
  collectInteractive,
  contextOf,
  idFor,
  inViewport,
  isDisabled,
  roleOf,
} from './elements';

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function describeElement(el: Element): ElementInfo {
  const role = roleOf(el);
  const info: ElementInfo = {
    id: idFor(el),
    role,
    name: accessibleName(el),
    tag: el.tagName.toLowerCase(),
    inViewport: inViewport(el),
  };
  if (el instanceof HTMLInputElement) {
    info.type = el.type;
    if (el.type === 'checkbox' || el.type === 'radio') info.checked = el.checked;
    else if (el.type === 'password') info.value = el.value ? '••••' : '';
    else if (!['button', 'submit', 'reset', 'image'].includes(el.type)) info.value = clip(el.value, 120);
    if (el.placeholder && el.placeholder !== info.name) info.placeholder = clip(el.placeholder, 60);
    if (el.required) info.required = true;
  } else if (el instanceof HTMLTextAreaElement) {
    info.value = clip(el.value, 200);
    if (el.placeholder && el.placeholder !== info.name) info.placeholder = clip(el.placeholder, 60);
    if (el.required) info.required = true;
  } else if (el instanceof HTMLSelectElement) {
    info.value = el.selectedOptions[0]?.text.trim() ?? '';
    const options = Array.from(el.options).map((o) => o.text.trim()).filter(Boolean);
    info.options = options.length > 25 ? [...options.slice(0, 25), `…${options.length - 25} more`] : options;
    if (el.required) info.required = true;
  } else if (el instanceof HTMLButtonElement) {
    info.type = el.type;
  } else if (el instanceof HTMLAnchorElement && el.href) {
    info.href = shortHref(el.href);
  } else if (el instanceof HTMLElement && el.isContentEditable) {
    info.value = clip((el.innerText ?? '').trim(), 200);
  }

  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked) info.checked = ariaChecked === 'true';
  const ariaSelected = el.getAttribute('aria-selected');
  if (ariaSelected === 'true') info.selected = true;
  const ariaExpanded = el.getAttribute('aria-expanded');
  if (ariaExpanded) info.expanded = ariaExpanded === 'true';
  if (isDisabled(el)) info.disabled = true;
  if (role === 'combobox' && !info.value) {
    const input = el.matches('input') ? (el as HTMLInputElement) : el.querySelector('input');
    const shown = (el as HTMLElement).innerText?.trim();
    if (input?.value) info.value = clip(input.value, 80);
    else if (shown && shown !== info.name) info.value = clip(shown, 80);
  }
  const context = contextOf(el);
  if (context) info.context = context;
  return info;
}

function shortHref(href: string): string {
  try {
    const u = new URL(href);
    if (u.protocol === 'javascript:') return '';
    const sameHost = u.host === location.host;
    const path = `${u.pathname}${u.search}`.replace(/\/$/, '') || '/';
    return clip(sameHost ? path : `${u.host}${path === '/' ? '' : path}`, 80);
  } catch {
    return '';
  }
}

function scrollState() {
  const se = document.scrollingElement ?? document.documentElement;
  const max = Math.max(0, se.scrollHeight - innerHeight);
  const percent = max > 0 ? Math.round((se.scrollTop / max) * 100) : 0;
  return {
    percent,
    screens: Math.max(1, Math.round((se.scrollHeight / Math.max(1, innerHeight)) * 10) / 10),
    atTop: se.scrollTop <= 2,
    atBottom: se.scrollTop >= max - 2,
  };
}

function headings(): string[] {
  return Array.from(document.querySelectorAll('h1,h2,h3,[role=heading]'))
    .filter((h) => (h as HTMLElement).offsetParent !== null || h.getClientRects().length > 0)
    .map((h) => {
      const level = Number(h.tagName[1]) || Number(h.getAttribute('aria-level')) || 2;
      const text = (h as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() ?? '';
      return text ? `${'#'.repeat(Math.min(level, 3))} ${clip(text, 100)}` : '';
    })
    .filter(Boolean)
    .slice(0, 30);
}

/** Rendered text of the page's main region (falls back to the body). */
function pageText(maxChars: number): { text: string; truncated: boolean } {
  const dialog = Array.from(document.querySelectorAll<HTMLElement>('dialog[open],[role=dialog],[aria-modal=true]')).find((d) => d.getClientRects().length > 0);
  const main = document.querySelector<HTMLElement>('main,[role=main]');
  const root = dialog ?? (main && (main.innerText?.length ?? 0) > 200 ? main : document.body);
  const raw = (root?.innerText ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
  return raw.length > maxChars ? { text: raw.slice(0, maxChars), truncated: true } : { text: raw, truncated: false };
}

export function snapshot(mode: ReadMode, maxElements: number, maxTextChars: number): PageSnapshot {
  const { elements, frames } = collectInteractive();
  const described = elements.map(describeElement);
  // Prefer what is on screen, then the rest in document order.
  const visible = described.filter((e) => e.inViewport);
  const rest = described.filter((e) => !e.inViewport);
  const chosen = [...visible, ...rest].slice(0, maxElements);
  const order = new Map(described.map((e, i) => [e.id, i]));
  chosen.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const textBudget = mode === 'content' ? maxTextChars : Math.min(2500, maxTextChars);
  const { text, truncated } = pageText(textBudget);
  return {
    url: location.href,
    title: document.title,
    scroll: scrollState(),
    elements: chosen,
    omitted: described.length - chosen.length,
    headings: headings(),
    text,
    textTruncated: truncated,
    frames,
    dialogOpen: !!document.querySelector('dialog[open],[role=dialog]:not([aria-hidden=true]),[aria-modal=true]'),
  };
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Ranks elements against a free-text description (“search box”, “Add medication”). */
export function find(query: string, limit: number): FindResult {
  const q = norm(query);
  const words = q.split(' ').filter((w) => w.length > 1);
  const { elements } = collectInteractive();
  const scored = elements
    .map((el) => {
      const info = describeElement(el);
      const hay = norm([info.name, info.role, info.placeholder, info.type, info.context, info.value, el.getAttribute('name'), el.id].filter(Boolean).join(' '));
      const name = norm(info.name);
      let score = 0;
      if (name === q) score += 10;
      else if (name.includes(q)) score += 6;
      for (const w of words) if (hay.includes(w)) score += 2;
      // Synonyms that come up constantly.
      if (/\bsearch\b/.test(q) && (info.role === 'searchbox' || info.type === 'search' || /search/.test(hay))) score += 4;
      if (info.inViewport) score += 0.5;
      if (info.disabled) score -= 1;
      return { info, score };
    })
    .filter((s) => s.score > 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.info);

  const textMatches: string[] = [];
  if (q.length > 2) {
    const body = document.body?.innerText ?? '';
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (norm(line).includes(q)) {
        textMatches.push(clip(line, 160));
        if (textMatches.length >= 5) break;
      }
    }
  }
  return { matches: scored, textMatches };
}

const PAYMENT_HINT = /card|cc-|cvc|cvv|iban|expir|billing/i;

/** Facts about an element that decide whether acting on it needs the user's approval. */
export function describeRisk(el: Element): ElementRisk {
  const info = describeElement(el);
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  const fields = form ? Array.from(form.querySelectorAll('input,select,textarea')) : [];
  const submitLabels = form
    ? Array.from(form.querySelectorAll('button,input[type=submit],[role=button]'))
        .map((b) => accessibleName(b))
        .filter(Boolean)
        .slice(0, 6)
    : [];
  return {
    name: info.name,
    role: info.role,
    tag: info.tag,
    type: info.type,
    href: el instanceof HTMLAnchorElement ? el.href : undefined,
    target: el instanceof HTMLAnchorElement ? el.target : undefined,
    formHasPassword: fields.some((f) => (f as HTMLInputElement).type === 'password'),
    formHasPayment: fields.some((f) => PAYMENT_HINT.test(`${f.getAttribute('autocomplete') ?? ''} ${f.getAttribute('name') ?? ''} ${f.id}`)),
    formIsSearch:
      !!form &&
      (form.getAttribute('role') === 'search' ||
        !!form.closest('[role=search]') ||
        /search/i.test(form.getAttribute('action') ?? '') ||
        fields.some((f) => (f as HTMLInputElement).type === 'search' || /^(q|query|search|s|k|keywords?|term)$/i.test(f.getAttribute('name') ?? ''))),
    formSubmitLabels: submitLabels,
  };
}
