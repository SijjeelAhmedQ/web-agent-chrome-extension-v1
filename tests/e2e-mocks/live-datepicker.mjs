// Types a date into the Add Task form's Due on the live page (the new content script) and checks the calendar closes.
import { contentScript } from './live-cs.mjs';
const cs = await contentScript();
try {
  const open = () => cs.page.evaluate(() => [...document.querySelectorAll('.datepicker-dropdown')].some((p) => p.offsetWidth > 0));
  const snap = await cs.send({ kind: 'snapshot', mode: 'overview', maxElements: 250, maxTextChars: 500 });
  const due = snap.elements.find((e) => e.name === 'Due' && /^dialog/.test(e.context ?? ''));
  // Open the calendar the way a person does: a real click in the Due box.
  const box = await cs.page.$('#LargePopupModel_Tasks #EndDate');
  await box.click();
  await new Promise((r) => setTimeout(r, 800));
  console.log('Due field', due?.id, due?.value, '· calendar open before:', await open());
  const res = await cs.send({ kind: 'type', id: due.id, text: '28/10/2026', clear: true, highlight: false });
  console.log('typed', res.value, '· calendar open after:', await open());
  const modal = await cs.page.evaluate(() => !!document.querySelector('#LargePopupModel_Tasks.show'));
  console.log('Add Task still open:', modal);
} finally { await cs.close(); }
