import { OVERLAY_HOST_ID } from './elements';

/**
 * Visual feedback on the page itself: a soft ring around the element the agent is about
 * to act on, and a thin glow around the viewport while the agent is working in this tab.
 * Lives in a closed shadow root so page styles can't touch it and it can't touch them.
 */

let shadow: ShadowRoot | null = null;

function host(): ShadowRoot {
  if (shadow && document.getElementById(OVERLAY_HOST_ID)) return shadow;
  const el = document.createElement('div');
  el.id = OVERLAY_HOST_ID;
  el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  shadow = el.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    .ring{position:fixed;border-radius:10px;box-shadow:0 0 0 2px #10b981,0 0 0 6px rgba(16,185,129,.22),0 8px 24px rgba(2,6,23,.18);
      transition:opacity .25s ease;opacity:1}
    .ring.out{opacity:0}
    .tag{position:fixed;font:600 11px/1 Inter,system-ui,sans-serif;letter-spacing:.01em;color:#04130d;background:#10b981;
      padding:5px 8px;border-radius:999px;white-space:nowrap;box-shadow:0 4px 12px rgba(2,6,23,.2);transition:opacity .25s ease}
    .tag.out{opacity:0}
    .glow{position:fixed;inset:0;border-radius:0;box-shadow:inset 0 0 0 2px rgba(16,185,129,.55),inset 0 0 28px rgba(16,185,129,.18);
      opacity:0;transition:opacity .3s ease}
    .glow.on{opacity:1}
    @media (prefers-reduced-motion: reduce){.ring,.tag,.glow{transition:none}}
  </style><div class="glow"></div>`;
  document.documentElement.appendChild(el);
  return shadow;
}

export function highlight(el: Element, label: string): void {
  const root = host();
  const r = el.getBoundingClientRect();
  const ring = document.createElement('div');
  ring.className = 'ring';
  ring.style.cssText = `left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px`;
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.textContent = label;
  const above = r.top > 30;
  tag.style.cssText = `left:${Math.max(6, Math.min(r.left, innerWidth - 160))}px;top:${above ? r.top - 28 : r.bottom + 8}px`;
  root.append(ring, tag);
  setTimeout(() => {
    ring.classList.add('out');
    tag.classList.add('out');
  }, 900);
  setTimeout(() => {
    ring.remove();
    tag.remove();
  }, 1250);
}

export function setPresence(active: boolean): void {
  if (!active && !shadow) return;
  host().querySelector('.glow')?.classList.toggle('on', active);
}
