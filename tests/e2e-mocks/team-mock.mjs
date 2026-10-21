// Scripted OpenAI-compatible model for team runs (:4620). Plans for the coordinator, then plays each
// member by its name from the system prompt. Every answer takes 1.5 s so overlap is measurable.
import http from 'node:http';

let inFlight = 0;
let maxInFlight = 0;
let n = 0;
const call = (name, args) => ({ id: `c${++n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const id = (snap, re) => {
  const m = snap.match(re);
  return m ? Number(m[1]) : null;
};

http
  .createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const send = (msg) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: msg, finish_reason: 'stop' }] }));
    };
    if (req.url === '/stats') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ maxInFlight }));
    }
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    }
    const { messages } = JSON.parse(body);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1500));
    inFlight--;
    const system = messages[0].content;
    const toolMsgs = messages.filter((m) => m.role === 'tool');
    const snap = [...toolMsgs].reverse().find((m) => m.name === 'read_page')?.content ?? '';
    const who = system.match(/^You are ([^,]+?)(,| the)/)?.[1] ?? '?';
    console.log(`[team] ${who} step ${toolMsgs.length} (in flight ${inFlight + 1})`);

    if (/coordinator of a team/.test(system)) {
      return send({
        content: null,
        tool_calls: [
          call('assign_tasks', {
            assignments: [
              { agent: 'Med agent', task: 'For Tom Baker add medications Metformin 500 mg twice daily and Panadol 500 mg twice daily.' },
              { agent: 'Dx agent', task: 'For Tom Baker add the diagnosis Hypertension.' },
              { agent: 'Task agent', task: 'For Tom Baker create the task Blood pressure monitoring.' },
            ],
          }),
        ],
      });
    }
    const step = toolMsgs.length;
    if (who === 'Med agent') {
      const plan = [
        () => call('read_page', {}),
        () => call('type', { id: id(snap, /\[(\d+)\] textbox "Medication name"/), text: 'Metformin' }),
        () => call('type', { id: id(snap, /\[(\d+)\] textbox "Dosage"/), text: '500 mg' }),
        () => call('select_option', { id: id(snap, /\[(\d+)\] select "Frequency"/), option: 'Twice daily' }),
        () => call('click', { id: id(snap, /\[(\d+)\] button "Save medication"/) }),
        () => call('read_page', {}),
        () => call('type', { id: id(snap, /\[(\d+)\] textbox "Medication name"/), text: 'Panadol' }),
        () => call('type', { id: id(snap, /\[(\d+)\] textbox "Dosage"/), text: '500 mg' }),
        () => call('select_option', { id: id(snap, /\[(\d+)\] select "Frequency"/), option: 'Twice daily' }),
        () => call('click', { id: id(snap, /\[(\d+)\] button "Save medication"/) }),
      ];
      if (step < plan.length) return send({ content: null, tool_calls: [plan[step]()] });
      return send({ content: 'Added Metformin and Panadol, 500 mg twice daily.' });
    }
    if (who === 'Dx agent') {
      if (step === 0) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (step === 1) return send({ content: null, tool_calls: [call('type', { id: id(snap, /\[(\d+)\] textbox "Diagnosis"/), text: 'Hypertension' })] });
      if (step === 2) return send({ content: null, tool_calls: [call('click', { id: id(snap, /\[(\d+)\] button "Save diagnosis"/) })] });
      return send({ content: 'Added Hypertension.' });
    }
    if (who === 'Task agent') {
      if (step === 0) return send({ content: null, tool_calls: [call('read_page', {})] });
      if (step === 1) return send({ content: null, tool_calls: [call('type', { id: id(snap, /\[(\d+)\] textbox "Task"/), text: 'Blood pressure monitoring' })] });
      if (step === 2) return send({ content: null, tool_calls: [call('click', { id: id(snap, /\[(\d+)\] button "Save task"/) })] });
      return send({ content: 'Created the task Blood pressure monitoring.' });
    }
    return send({ content: `Unknown agent ${who}` });
  })
  .listen(4620, () => console.log('team mock on 4620'));
