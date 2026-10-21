// Static test site on :4599 and a scripted OpenAI-compatible mock model on :4600.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, 'site');
http
  .createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      const body = readFileSync(join(root, path === '/' ? 'index.html' : path));
      res.writeHead(200, { 'content-type': path.endsWith('.pdf') ? 'application/pdf' : 'text/html' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('nf');
    }
  })
  .listen(4599);

// Like a real model, which still has its earlier reads: an id not in the latest read (it lists only the
// page's changes) is looked up in the reads before it, latest first.
let earlierSnaps = [];
const id = (snap, re) => {
  for (const s of [snap, ...earlierSnaps]) {
    const m = s.match(re);
    if (m) return Number(m[1]);
  }
  return null;
};
let n = 0;
const call = (name, args) => ({ id: `c${++n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });

http
  .createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const send = (msg, finish = 'stop') => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: msg, finish_reason: finish }] }));
    };
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'mock-1' }] }));
    }
    const { messages } = JSON.parse(body);
    // The runtime's double-check prompt is not a new request.
    const isRuntimePrompt = (c) => /^(Before you finish|Your last reply was cut off|You have not finished the task yet|Not finished yet:)/.test(c);
    const verifyIdx = messages.findLastIndex((m) => m.role === 'user' && m.content.startsWith('Before you finish'));
    const lastUser = messages.findLastIndex((m) => m.role === 'user' && !isRuntimePrompt(m.content));
    const nudged = messages.some((m, i) => i > lastUser && m.role === 'user' && /^Your last reply was cut off/.test(m.content));
    const verifyText = verifyIdx > lastUser ? messages[verifyIdx].content : '';
    const user = messages[lastUser].content;
    const toolMsgs = messages.slice(lastUser).filter((m) => m.role === 'tool');
    const lastSnap = [...toolMsgs].reverse().find((m) => m.name === 'read_page')?.content ?? '';
    earlierSnaps = messages.filter((m) => m.role === 'tool' && m.name === 'read_page').map((m) => m.content).reverse();
    const last = toolMsgs.at(-1)?.content ?? '';
    console.log(`[mock] "${user.slice(0, 20)}" step ${toolMsgs.length} origin=${req.headers.origin ?? 'none'} last=${last.slice(0, 110).replace(/\n/g, ' ')}`);
    if (/ping tool/.test(messages[0].content)) return send({ content: null, tool_calls: [call('ping', {})] });

    if (/^fill/i.test(user)) {
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1)
        return send({
          content: 'Filling the form.',
          tool_calls: [
            call('type', { id: id(lastSnap, /\[(\d+)\] textbox "Patient name"/), text: 'Ali Khan' }),
            call('type', { id: String(id(lastSnap, /\[(\d+)\] textbox "Medication"/)), text: 'Amoxicillin' }),
            call('select_option', { id: id(lastSnap, /\[(\d+)\] select "Frequency"/), option: 'twice daily' }),
            call('click', { id: id(lastSnap, /\[(\d+)\] combobox "Route"/) }),
          ],
        });
      if (toolMsgs.length === 5) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 6) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] option "Oral"/) })] });
      if (toolMsgs.length === 7) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] button "Save"/) })] });
      return send({ content: `Saved the medication. Last result: ${last.slice(0, 60)}` });
    }

    if (/^search/i.test(user)) {
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('type', { id: id(lastSnap, /\[(\d+)\] searchbox "Search patients"/), text: 'Bilal', submit: true })] });
      if (toolMsgs.length === 2) return send({ content: null, tool_calls: [call('read_page', { mode: 'content' })] });
      if (toolMsgs.length === 3) return send({ content: null, tool_calls: [call('go_back', {})] });
      if (toolMsgs.length === 4) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 5) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] button "Open" in row 2/) })] });
      if (toolMsgs.length === 6) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] link "Help center"/) })] });
      if (toolMsgs.length === 7) return send({ content: null, tool_calls: [call('list_tabs', {})] });
      const results = toolMsgs.find((m) => /Result one/.test(m.content))?.content.match(/Result one: [^\n]+/)?.[0] ?? 'nothing';
      return send({ content: `Found **${results}**.\n\n| Name | DOB |\n|---|---|\n| Bilal Raza | 1990-02-11 |` });
    }

    // Nested menus: CSS hover (open_menu), JS hover (hover tool), click-to-open (open_menu).
    const lastOut = toolMsgs.at(-1)?.content ?? '';
    if (/^menu css/i.test(user)) {
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('open_menu', { path: ['Products', 'Laptops'] })] });
      if (toolMsgs.length === 2) return send({ content: null, tool_calls: [call('click', { id: id(lastOut, /\[(\d+)\] link "Gaming laptops"/) })] });
      return send({ content: `Opened Gaming laptops. ${lastOut.slice(0, 40)}` });
    }
    if (/^menu js/i.test(user)) {
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('hover', { id: id(lastSnap, /\[(\d+)\] link "Services"/) })] });
      if (toolMsgs.length === 2) return send({ content: null, tool_calls: [call('hover', { id: id(lastOut, /\[(\d+)\] link "Cloud"/) })] });
      if (toolMsgs.length === 3) return send({ content: null, tool_calls: [call('click', { id: id(lastOut, /\[(\d+)\] link "Storage"/) })] });
      return send({ content: 'Opened Storage.' });
    }
    if (/^med form/i.test(user)) {
      // Fill the medication form by its labels, then try the never-click button.
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('type', { id: id(lastSnap, /\[(\d+)\] textbox "Take"/), text: '2' })] });
      if (toolMsgs.length === 2) return send({ content: null, tool_calls: [call('select_option', { id: id(lastSnap, /\[(\d+)\] select "Frequency"/), option: 'Once Daily' })] });
      if (toolMsgs.length === 3) return send({ content: null, tool_calls: [call('type', { id: id(lastSnap, /\[(\d+)\] textbox "Duration"/), text: '30' })] });
      if (toolMsgs.length === 4) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] button "Pharmac"/), name: 'Pharmac' })] });
      const names = (lastSnap.match(/\] (textbox|select) "[^"]+"/g) ?? []).join(' | ');
      return send({ content: `Form filled.
NAMES ${names}
LAST ${last.slice(0, 120)}
KB ${/Buttons you never click here/.test(messages[0].content) ? 'yes' : 'no'}` });
    }
    if (/^med loop/i.test(user)) {
      // What DeepSeek did: type the medicine, search, again and again. Re-read each time (new ids).
      const actions = toolMsgs.filter((m) => m.name !== 'read_page').length;
      const stopped = toolMsgs.some((m) => /^Not done: this would start the same steps a third time/.test(m.content));
      if (stopped || actions >= 8) return send({ content: `Stopped.\nLOOP ${stopped ? 'yes' : 'no'} after ${actions} actions` });
      const prev = toolMsgs.at(-1);
      if (!prev || prev.name !== 'read_page') return send({ content: null, tool_calls: [call('read_page', {})] });
      const typed = toolMsgs.filter((m) => m.name === 'type').length;
      const searched = toolMsgs.filter((m) => m.name === 'click').length;
      if (typed <= searched) return send({ content: null, tool_calls: [call('type', { id: id(lastSnap, /\[(\d+)\] textbox "Find Medicine"/), text: 'Metformin' })] });
      return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] button "search"/), name: 'search' })] });
    }
    if (/^pick early/i.test(user)) {
      // A weak model: picks from the list before searching; then searches and picks.
      const k = toolMsgs.length;
      const steps = [
        () => call('read_page', {}),
        () => call('click_text', { text: 'Arya STARK', near: '03-12-2015' }),
        () => call('type', { id: id(lastSnap, /\[(\d+)\] textbox "Patient Name:?"/), text: 'Arya Stark' }),
        () => call('click', { id: id(lastSnap, /\[(\d+)\] button "Search"/), name: 'Search' }),
        () => call('read_page', {}),
        () => call('click_text', { text: 'Arya STARK', near: '03-12-2015' }),
      ];
      if (k < steps.length) return send({ content: null, tool_calls: [steps[k]()] });
      return send({ content: `Arya STARK's consult opened. Done\nFIRST ${toolMsgs[1].content.slice(0, 160)}\nSECOND ${toolMsgs[5].content.slice(0, 120)}` });
    }
    if (/^med warn/i.test(user)) {
      // A pop-up from the agent's own action (picking a medicine): it asks the user, nothing more.
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] button "Gabapentin 100 mg capsule"/), name: 'Gabapentin 100 mg capsule' })] });
      const nudged = messages.some((m) => m.role === 'user' && /^Not finished yet: Before you ask/.test(m.content));
      return send({ content: `It's already in the active medicines list — should I add it again? NUDGED ${nudged}` });
    }
    if (/^select arya stark wrong icon/i.test(user)) {
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] image "Book appointment[^"]*"/), name: 'Book appointment' })] });
      return send({ content: `Done.\nOUT ${toolMsgs[1].content.slice(0, 200)}` });
    }
    if (/^show reports undo (tab|popup)/i.test(user)) {
      const popup = /popup/i.test(user);
      const k = toolMsgs.length;
      if (k === 0) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (k === 1) return send({ content: null, tool_calls: [call('click', popup ? { id: id(lastSnap, /\[(\d+)\] image "Details[^"]*"/), name: 'Details' } : { id: id(lastSnap, /\[(\d+)\] link "Reports"/), name: 'Reports' })] });
      if (k === 2) return send({ content: null, tool_calls: [call('undo_click', { why: 'opened the wrong thing' })] });
      return send({ content: `Back on the patient list.\nUNDO ${toolMsgs[2].content.slice(0, 200)}` });
    }
    if (/^quote check/i.test(user)) {
      // Answers with page text it never saw (from the rules), then with text it did.
      const quoted = messages.some((m, i) => i > lastUser && m.role === "user" && /your answer quotes/.test(m.content));
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (/real/.test(user)) return send({ content: 'The page shows "Consult control 12". Do you want me to open it?' });
      if (!quoted) return send({ content: 'The list shows "No new messages." and the button "Click here to load the data from archive." Do you want me to load the archived records?' });
      return send({ content: 'NUDGED ' + messages.findLast((m) => m.role === 'user' && /your answer quotes/.test(m.content)).content.slice(0, 200) + '.' });
    }
    if (/^diff check/i.test(user)) {
      const k = toolMsgs.length;
      if (k === 0) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (k === 1) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /"Alerts"(?: \(in front\))? — can be closed: \[(\d+)\]/), name: '×' })] });
      if (k === 2) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (k === 3) return send({ content: null, tool_calls: [call('read_page', { full: true })] });
      const reads = toolMsgs.filter((m) => m.name === 'read_page').map((m) => m.content);
      return send({ content: `LEN ${reads.map((r) => r.length).join(',')}\nSECOND ${reads[1].replace(/\n/g, ' | ').slice(0, 700)}\nTHIRD ${reads[2].slice(0, 60).replace(/\n/g, ' | ')}` });
    }
    if (/^size read/i.test(user)) {
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      const c = toolMsgs[0].content;
      return send({ content: `SIZE chars=${c.length} digits=${(c.match(/\d/g) ?? []).length}` });
    }
    if (/^nzf read/i.test(user)) {
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      return send({ content: `READ ${toolMsgs[0].content.replace(/\n/g, ' | ').slice(0, 1600)}` });
    }
    if (/^look loop/i.test(user)) {
      // Searches for something that isn't there, again and again.
      if (toolMsgs.length < 10) return send({ content: null, tool_calls: [call('find_element', { query: `interaction severity ${toolMsgs.length}` })] });
      return send({ content: `LOOKS ${toolMsgs.map((m) => m.content.slice(0, 40)).join(' || ')}` });
    }
    if (/^manual next/i.test(user)) {
      // Like DeepSeek: opens a record and pages through the viewer by hand.
      const k = toolMsgs.length;
      if (k === 0) return send({ content: null, tool_calls: [call('click_text', { text: 'Testing' })] });
      if (k === 1) return send({ content: null, tool_calls: [call('click_text', { text: 'Next' })] });
      return send({ content: `NEXT ${toolMsgs[1].content.replace(/\n/g, ' ').slice(0, 300)}.` });
    }
    if (/^form enter/i.test(user)) {
      const k = toolMsgs.length;
      if (k === 0) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (k === 1) return send({ content: null, tool_calls: [call('type', { id: id(lastSnap, /\[(\d+)\] textbox "Due-in:?"/), text: '2 weeks', submit: true })] });
      return send({ content: `AFTER ${toolMsgs[1].content.slice(0, 200).replace(/\n/g, ' ')}.` });
    }
    if (/^form save/i.test(user)) {
      const k = toolMsgs.length;
      if (k === 0) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (k === 1) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] button "Save" in dialog/), name: 'Save' })] });
      return send({ content: `AFTER ${toolMsgs[1].content.slice(0, 200).replace(/\n/g, ' ')}.` });
    }
    if (/^date type/i.test(user)) {
      const k = toolMsgs.length;
      if (k === 0) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (k === 1) return send({ content: null, tool_calls: [call('type', { id: id(lastSnap, /\[(\d+)\] textbox "Due"/), text: '28/10/2026' })] });
      return send({ content: `TYPED ${toolMsgs[1].content.slice(0, 120).replace(/\n/g, ' ')}.` });
    }
    if (/^task form/i.test(user)) {
      const k = toolMsgs.length;
      if (k === 0) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (k === 1) return send({ content: null, tool_calls: [call('click_text', { text: 'Save' })] });
      const form = (toolMsgs[0].content.match(/The form in the pop-up[\s\S]*?(?=\nAll the text of the pop-up|\n\nInteractive)/) ?? [''])[0];
      const due = (toolMsgs[0].content.match(/\[\d+\] textbox "Due"[^\n]*/) ?? [''])[0];
      return send({ content: `FORM ${form.replace(/\n/g, ' | ')}\nDUE ${due}\nSAVE ${toolMsgs[1].content.slice(0, 160).replace(/\n/g, ' ')}.` });
    }
    if (/^list colours/i.test(user)) {
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_table', { near: 'Imported Date' })] });
      return send({ content: `LIST ${toolMsgs[0].content}` });
    }
    if (/^records status/i.test(user)) {
      const k = toolMsgs.length;
      if (k === 0) return send({ content: null, tool_calls: [call('read_records', { first: 'Testing', status_label: 'Status', empty_is_normal: true })] });
      return send({ content: `OUT ${toolMsgs[0].content.replace(/\n/g, ' | ').slice(0, 4000)}` });
    }
    if (/^records review/i.test(user)) {
      const k = toolMsgs.length;
      if (k === 0) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (k === 1) return send({ content: null, tool_calls: [call('select_option', { id: id(lastSnap, /\[(\d+)\] \w+ "File Status/), option: 'All' })] });
      if (k === 2) return send({ content: null, tool_calls: [call('click_text', { text: 'Search' })] });
      if (k === 3) return send({ content: null, tool_calls: [call('read_records', { first: 'LFT' })] });
      return send({ content: `OUT ${toolMsgs[3].content.replace(/\n/g, ' | ').slice(0, 1500)}` });
    }
    if (/^select arya stark field/i.test(user)) {
      // Like DeepSeek on the real page: looks for the name field, then picks Arya from the list unsearched.
      const k = toolMsgs.length;
      if (k === 0) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (k === 1) return send({ content: null, tool_calls: [call('find_element', { query: 'Patient Name field' })] });
      if (k === 2) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] \w+ "Arya STARK"/), name: 'Arya STARK' })] });
      return send({ content: `READ ${(lastSnap.split('\n').find((l) => /Surname First Name/.test(l)) ?? '').slice(0, 160)}\nFIND ${toolMsgs[1].content.replace(/\n/g, ' | ').slice(0, 200)}\nCLICK ${toolMsgs[2].content.slice(0, 120)}` });
    }
    if (/^inbox comment/i.test(user)) {
      // Open the abnormal record, add the comment on a new line after the one there, OK.
      const k = toolMsgs.length;
      if (k === 0) return send({ content: null, tool_calls: [call('click_text', { text: 'LAB TEST RESULT' })] });
      if (k === 1) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (k === 2) return send({ content: null, tool_calls: [call('type', { id: id(lastSnap, /\[(\d+)\] textbox "Enter comments"/), text: '\nReviewed - repeat LFT in 2 weeks', clear: false })] });
      if (k === 3) return send({ content: null, tool_calls: [call('click_text', { text: 'OK' })] });
      return send({ content: 'Added the comment to LAB TEST RESULT (Arya STARKK).' });
    }
    if (/^alerts (nested|late)/i.test(user)) {
      // Opens the consult, (late: waits a little), then — careless — asks for the reason at once.
      const late = /late/i.test(user);
      const nudge = messages.find((m) => m.role === 'user' && /^Not finished yet: Before you ask the user/.test(m.content));
      const k = toolMsgs.length;
      if (k === 0) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (k === 1) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, late ? /\[(\d+)\] link "Arya STARK late"/ : /\[(\d+)\] link "Arya STARK nested"/), name: 'Arya STARK' })] });
      if (late && k === 2) return send({ content: null, tool_calls: [call('wait', { seconds: 7 })] });
      if (!nudge) return send({ content: 'What reason should I add to view the patient file?' });
      if (!toolMsgs.some((m) => m.name === 'click' && /^Clicked “×”/.test(m.content))) return send({ content: null, tool_calls: [call('click', { id: id(nudge.content, /"Patient Alerts"(?: \(in front\))? — can be closed: \[(\d+)\]/), name: '×' })] });
      return send({ content: `I closed Patient Alerts. What reason should I add to view the patient file? REPORT ${toolMsgs[1].content.replace(/\n/g, ' | ').slice(0, 600)}` });
    }
    if (/^quiet stack/i.test(user)) {
      // Like Qwen on Kaggle: closes the alerts, then finishes without asking for the reason.
      const nudge = messages.find((m) => m.role === 'user' && /^Not finished yet: the pop-up/.test(m.content));
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] link "Arya STARK"/), name: 'Arya STARK' })] });
      if (toolMsgs.length === 2) return send({ content: null, tool_calls: [call('click', { id: id(toolMsgs[1].content, /"Patient Alerts"(?: \(in front\))? — can be closed: \[(\d+)\]/), name: '×' })] });
      if (!nudge) return send({ content: "Arya STARK's consult is open. Is there anything you'd like me to do with this patient's record?" });
      return send({ content: `Arya STARK's consult is open and I closed Patient Alerts. What reason should I add to view the patient file?\nNUDGE ${nudge.content.slice(0, 200)}`.replace('?\nNUDGE', '? NUDGE') });
    }
    if (/^stack/i.test(user)) {
      // Open the consult, then (careless) ask at once; the runtime points out the alerts in front.
      const nudge = messages.find((m) => m.role === 'user' && /^Not finished yet: Before you ask the user/.test(m.content));
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] link "Arya STARK"/), name: 'Arya STARK' })] });
      if (!nudge) return send({ content: 'What reason should I add to view the patient file?' });
      if (!toolMsgs.some((m) => m.name === 'click' && /×/.test(m.content) && m !== toolMsgs[1])) return send({ content: null, tool_calls: [call('click', { id: id(nudge.content, /"Patient Alerts" \(in front\) — can be closed: \[(\d+)\]/) ?? id(nudge.content, /can be closed: \[(\d+)\]/), name: '×' })] });
      return send({ content: `I closed Patient Alerts. What reason should I add to view the patient file?\nCLICK ${toolMsgs[1].content.replace(/\n/g, ' | ').slice(0, 500)}\nNUDGE ${nudge.content.replace(/\n/g, ' | ').slice(0, 300)}`.replace(/\?\n/, '? ') });
    }
    if (/^multi add/i.test(user)) {
      // Two diagnoses: list them, add the first, tick it, try the first again (careless), add the
      // second, answer before ticking it (careless), then tick it and report.
      const k = toolMsgs.length;
      const nudged = messages.some((m) => m.role === 'user' && /^Not finished yet:/.test(m.content));
      const field = () => id(lastSnap, /\[(\d+)\] textbox "Find/);
      const steps = [
        () => call('task_list', { items: ['Diagnosis: Hypertension — onset 01-05-2026', 'Diagnosis: Asthma — onset 05-05-2026'] }),
        () => call('read_page', {}),
        () => call('type', { id: field(), text: 'Hypertension' }),
        () => call('click', { id: id(lastSnap, /\[(\d+)\] button "Add"/), name: 'Add' }),
        () => call('task_list', { done: 1, note: 'added' }),
        () => call('type', { id: field(), text: 'Hypertension' }),
        () => call('read_page', {}),
        () => call('type', { id: field(), text: 'Asthma' }),
        () => call('click', { id: id(lastSnap, /\[(\d+)\] button "Add"/), name: 'Add' }),
      ];
      if (k < steps.length) return send({ content: null, tool_calls: [steps[k]()] });
      if (!nudged) return send({ content: 'Added Hypertension and Asthma.' });
      if (!toolMsgs.some((m) => m.name === 'task_list' && /☑ 2\./.test(m.content))) return send({ content: null, tool_calls: [call('task_list', { done: 2, note: 'added' })] });
      const sys = messages[0].content;
      return send({ content: `Both added.\nGUARD ${toolMsgs[5].content.slice(0, 140)}\nSYS ${(sys.match(/## Your checklist for this task[\s\S]*$/) ?? [''])[0].replace(/\n/g, ' | ').slice(0, 300)}\nNUDGE ${nudged}` });
    }
    if (/^reason reuse/i.test(user)) {
      // A careless model: fills the reason pop-up with the answer from earlier in the chat.
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('type', { id: id(lastSnap, /\[(\d+)\] textbox "Add reason to view patient file"/), text: 'routine follow-up' })] });
      return send({ content: `What reason should I add?\nGUARD ${toolMsgs[1].content.slice(0, 200)}\nSNAP ${(lastSnap.split('\n').find((l) => /textbox "Add reason/.test(l)) ?? '').slice(0, 200)}` });
    }
    if (/^reason ask/i.test(user)) {
      // Close “Recalls due” by its text, then stop and ask for the reason.
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('click_text', { text: 'Close' })] });
      return send({ content: 'I closed “Recalls due”. What reason should I add to view the patient file?' });
    }
    if (/^My reply to your question/.test(user)) {
      // A careless model: first redoes a step from before the question, then does the rest.
      const reply = (user.match(/“(.*?)”/) ?? [])[1] ?? '';
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('click_text', { text: 'Close' })] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 2) return send({ content: null, tool_calls: [call('type', { id: id(lastSnap, /\[(\d+)\] textbox "Add reason to view patient file"/), text: reply })] });
      if (toolMsgs.length === 3) return send({ content: null, tool_calls: [call('click_text', { text: 'Save' })] });
      const hist = messages.filter((m) => m.role !== 'system' && m.role !== 'tool').map((m) => m.content).join(' || ');
      return send({ content: `Saved the reason.\nGUARD ${toolMsgs[0].content.slice(0, 160)}\nHIST ${hist.replace(/\n/g, ' ').slice(0, 900)}`.replace(/\?/g, '(q)') });
    }
    if (/^popups/i.test(user)) {
      // Close every pop-up that has a close control (using the id read_page gives), then report.
      const closeId = (snap) => {
        const m = snap.match(/can be closed: \[(\d+)\]/);
        return m ? Number(m[1]) : null;
      };
      const prev = toolMsgs.at(-1);
      if (!prev || prev.name !== 'read_page') return send({ content: null, tool_calls: [call('read_page', {})] });
      const id1 = closeId(lastSnap);
      if (id1 && toolMsgs.length < 8) return send({ content: null, tool_calls: [call('click', { id: id1 })] });
      const first = toolMsgs[0].content;
      return send({ content: `Done.\nFIRST ${first.split('\n').filter((l) => /^(Pop-ups|- )/.test(l)).join(' || ')}\nLAST ${lastSnap.split('\n').filter((l) => /^(Pop-ups|- )/.test(l)).join(' || ')}` });
    }
    if (/^late dialog/i.test(user)) {
      const tab = /new tab/i.test(user);
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, tab ? /\[(\d+)\] link "Arya STARK \(new tab\)"/ : /\[(\d+)\] link "Arya STARK"/), name: 'Arya STARK' })] });
      return send({ content: `Done.
OUT ${last.slice(0, 400)}` });
    }
    if (/^consult modal/i.test(user)) {
      // Clear an empty field (changes nothing), fill the reason, Save by its button text,
      // then look for a word that isn't there three times.
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] button "Clear"/), name: 'Clear' })] });
      if (toolMsgs.length === 2) return send({ content: null, tool_calls: [call('type', { id: id(lastSnap, /\[(\d+)\] textbox "Add reason to view patient file"/), text: 'i am testing' })] });
      if (toolMsgs.length === 3) return send({ content: null, tool_calls: [call('click_text', { text: 'Save' })] });
      if (toolMsgs.length <= 6) return send({ content: null, tool_calls: [call('click_text', { text: 'Nowhere', near: 'try ' + toolMsgs.length })] });
      const outs = toolMsgs.map((m) => `${m.name}: ${m.content.slice(0, 90)}`);
      return send({ content: `Done.\n${outs.join('\n')}` });
    }
    if (/^kb check/i.test(user)) {
      // Reports what the agent was given on this site: knowledge in the prompt, the site_knowledge tool.
      const { tools = [] } = JSON.parse(body);
      const sys = messages[0].content;
      const names = tools.map((t) => t.function?.name ?? t.name);
      return send({ content: `KB ${/What the user has taught you about Indici/.test(sys) ? 'yes' : 'no'} WF ${/### Workflow: Select a patient from Search & List/.test(sys) ? 'yes' : 'no'} MINE ${/My own rule from the test/.test(sys) ? 'yes' : 'no'} TOOL ${names.includes('site_knowledge') ? 'yes' : 'no'} NAV ${names.includes('navigate') ? 'yes' : 'no'} READ ${names.includes('read_page') ? 'yes' : 'no'} SK ${/SKILL-MARKER/.test(sys) ? 'yes' : 'no'} AG ${(sys.match(/You are ([^,]+),/) ?? [])[1] ?? '?'}` });
    }
    if (/^legacy real/i.test(user)) {
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('click_text', { text: 'Arya STARK', near: '03-12-2015' })] });
      return send({ content: `Done.\nOUT ${last.slice(0, 300)}` });
    }
    if (/^legacy double/i.test(user)) {
      // What the user's run did: click the name again and again though nothing opened.
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      const clicks = toolMsgs.filter((m) => m.name === 'click_text').length;
      if (clicks < 3) return send({ content: null, tool_calls: [call('click_text', { text: 'Arya STARK', near: '03-12-2015' })] });
      if (clicks === 3) return send({ content: null, tool_calls: [call('click_text', { text: 'Arya STARK', near: '03-12-2015', double: true })] });
      const outs = toolMsgs.filter((m) => m.name === 'click_text').map((m) => m.content.slice(0, 60));
      return send({ content: `Opened Arya STARK.
DIALOG ${/A dialog is open/.test(lastSnap) ? 'yes' : 'no'}
OUTS ${outs.join(' || ')}` });
    }
    if (/^legacy plain/i.test(user)) {
      // The name is plain text: the model has to click the text, and pick the row by DOB.
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('click_text', { text: 'Arya STARK' })] });
      if (toolMsgs.length === 2) return send({ content: null, tool_calls: [call('click_text', { text: 'Arya STARK', near: '03-12-2015' })] });
      return send({ content: `Opened Arya STARK.
AMBIG ${/appears 2 times/.test(toolMsgs[1].content) ? 'yes' : 'no'}
LISTED ${/"Arya STARK"/.test(lastSnap) ? 'yes' : 'no'}` });
    }
    if (/^legacy select/i.test(user)) {
      // What the user's run did: after searching, click an icon in the row instead of the name.
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('type', { id: id(lastSnap, /\[(\d+)\] textbox "Patient Name"/), text: 'Arya STARK' })] });
      if (toolMsgs.length === 2) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] button "Search"/), name: 'Search' })] });
      if (toolMsgs.length === 3) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 4) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] link "book appointment \(icon\)"/), name: 'Arya STARK' })] });
      if (toolMsgs.length === 5) return send({ content: null, tool_calls: [call('click', { id: id(last, /Elements with that name: \[(\d+)\]/), name: 'Arya STARK' })] });
      // Row 1's lines: the first names the row, the rest of its elements say "(same row)".
      const all = lastSnap.split('\n');
      const lines = [];
      for (let i = 0; i < all.length; i++) {
        if (/in row 1 /.test(all[i])) {
          lines.push(all[i]);
          while (/\(same row\)/.test(all[i + 1] ?? '')) lines.push(all[++i]);
        }
      }
      return send({ content: `Opened Arya STARK.\nGUARD ${/^Not clicked/.test(toolMsgs[4].content) ? 'yes' : 'no'}\n${lines.join('\n')}` });
    }
    if (/^goto patients/i.test(user)) {
      // What the user's run did: click the hover-menu trigger instead of hovering.
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] link "Patients"/) })] });
      if (toolMsgs.length === 2) return send({ content: null, tool_calls: [call('click', { id: id(lastOut, /\[(\d+)\] link "Search & List"/) })] });
      return send({ content: `Selected Search & List. Marker: ${/opens a menu on hover/.test(lastSnap) ? 'yes' : 'no'}` });
    }
    if (/^menu leaf/i.test(user)) {
      // The model puts the final (dangerous) item in the path: open_menu must not click it.
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('open_menu', { path: ['Account', 'Delete account'] })] });
      if (toolMsgs.length === 2) return send({ content: null, tool_calls: [call('click', { id: id(lastOut, /\[(\d+)\] link "Delete account"/) })] });
      return send({ content: 'Did not delete the account.' });
    }
    if (/^menu click/i.test(user)) {
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('open_menu', { path: 'Account' })] });
      if (toolMsgs.length === 2) return send({ content: null, tool_calls: [call('click', { id: id(lastOut, /\[(\d+)\] link "Orders"/) })] });
      return send({ content: 'Opened Orders.' });
    }

    if (/^stubborn/i.test(user)) {
      // Ignores “don't try again”: keeps clicking Save after the user declines.
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      return send({ content: null, tool_calls: [call('click', { id: id(lastSnap, /\[(\d+)\] button "Save"/) })] });
    }

    if (/^hiccup/i.test(user)) {
      // The user's log: mid-task, the reply is cut off by the context limit.
      if (!toolMsgs.length) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (toolMsgs.length === 1 && !nudged) return send({ content: 'Good, the medication form is open. I can see the Patient name field (element [5]). Let' }, 'length');
      if (toolMsgs.length === 1) return send({ content: null, tool_calls: [call('type', { id: id(lastSnap, /\[(\d+)\] textbox "Patient name"/), text: 'Ali Khan' })] });
      return send({ content: 'Typed Ali Khan into Patient name.' });
    }

    if (/^select luke/i.test(user)) {
      // Turn 1: the hallucination from the user's screenshot — claims success without acting.
      if (!toolMsgs.length && !verifyText) return send({ content: 'I selected Luke King (MRN-100076, (485) 555-8565). The system confirms he is now the selected patient.' });
      // After the double-check shows the truth, a corrected model searches and selects.
      const snapNow = lastSnap || verifyText;
      const afterVerify = messages.slice(verifyIdx);
      const did = (name) => afterVerify.some((m) => m.role === 'tool' && m.name === name);
      if (verifyText && !did('type')) return send({ content: null, tool_calls: [call('type', { id: id(verifyText, /\[(\d+)\] searchbox "Search patients"/), text: 'Luke King' })] });
      if (verifyText && !did('read_page')) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (verifyText && !did('click')) return send({ content: null, tool_calls: [call('click', { id: id(snapNow, /\[(\d+)\] button "Select" in row 1 “Luke King/) })] });
      return send({ content: 'Luke King (MRN-104512) is now the selected patient — the header shows "Selected patient: Luke King".' });
    }

    if (/^slow/i.test(user)) {
      await new Promise((r) => setTimeout(r, 4000));
      return send({ content: null, tool_calls: [call('scroll', { direction: 'down' })] });
    }
    return send({ content: 'Hello! I am the mock model.' });
  })
  .listen(4600);
console.log('servers up');
