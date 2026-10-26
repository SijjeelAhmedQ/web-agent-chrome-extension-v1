// Closes the pop-ups left open on a live tab with their Close / Cancel / × (nothing saved).
//   TAB=inbox-app node live-close-dialogs.mjs
import { contentScript } from './live-cs.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cs = await contentScript();
try {
  for (let i = 0; i < 6; i++) {
    const { dialogs } = await cs.send({ kind: 'dialogs', waitMs: 500 });
    if (!dialogs.length) break;
    const front = dialogs[0];
    const close = front.close ?? (await cs.send({ kind: 'popupControl', name: 'Close' }).catch(() => null)) ?? (await cs.send({ kind: 'popupControl', name: 'Cancel' }).catch(() => null));
    console.log('closing', front.title || '(untitled)', '→', close?.name ?? close?.id ?? 'Escape');
    if (close?.id) await cs.send({ kind: 'click', id: close.id, highlight: false });
    else await cs.send({ kind: 'key', key: 'Escape' });
    await sleep(800);
  }
} finally { await cs.close(); }
