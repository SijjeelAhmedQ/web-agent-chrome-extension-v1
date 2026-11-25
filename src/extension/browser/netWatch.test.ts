// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { apiReport } from '@/agent/tools/browserTools';
import { describeCall, NET_WATCH, type NetCall } from './netWatch';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const read = (since = 0) => NET_WATCH('read', since) as { calls: NetCall[]; inflight: number };
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('the watch on calls that change data', () => {
  it('keeps what the server refused, only the shape of what it accepted, and never a GET or analytics', async () => {
    const answers: Record<string, Response> = {};
    window.fetch = (async (input: RequestInfo | URL) => answers[String(input)] ?? json(200, {})) as typeof fetch;
    NET_WATCH('install', 0);

    answers['/api/patients'] = json(409, { message: 'NHI already exists', code: 'DUPLICATE_NHI' });
    await fetch('/api/patients', { method: 'POST', body: JSON.stringify({ firstName: 'James', lastName: 'Wilson', nhi: 'ABC1234' }) });
    await tick();
    answers['/api/stations?site=1'] = json(201, { id: 77, name: 'Tall Table 3', wing: { id: 2, name: 'Steiner Wing' } });
    await fetch('/api/stations?site=1', { method: 'POST', body: JSON.stringify({ name: 'Tall Table 3' }) });
    await fetch('/api/patients?search=james');
    await fetch('https://o1.ingest.sentry.io/api/1/envelope', { method: 'POST', body: '{}' });
    await tick();

    const { calls, inflight } = read();
    expect(inflight).toBe(0);
    expect(calls).toHaveLength(2);
    const [refused, saved] = calls;
    expect(refused.ok).toBe(false);
    expect(refused.answer).toContain('NHI already exists');
    // What was sent: field names, not the patient's details.
    expect(refused.sent).toBe('{firstName, lastName, nhi}');
    expect(JSON.stringify(refused)).not.toContain('James');
    expect(saved.ok).toBe(true);
    expect(saved.url).toBe('/api/stations?site');
    expect(saved.answer).toBe('{id, name, wing: {id, name}}');
    expect(JSON.stringify(saved)).not.toContain('Tall Table 3');

    expect(describeCall(refused)).toBe('POST /api/patients → 409 refused: message: NHI already exists (sent: {firstName, lastName, nhi})');
    // Read since a later moment: only what came after.
    expect(read(Date.now() + 1000).calls).toHaveLength(0);
  });

  it('a body that says it failed is a refusal, whatever its status', async () => {
    window.fetch = (async () => json(200, { success: false, errors: [{ field: 'email', message: 'Email is invalid' }] })) as typeof fetch;
    (window as Window & { __waNet?: unknown }).__waNet = undefined;
    NET_WATCH('install', 0);
    await fetch('/graphql', { method: 'POST', body: '{"query":"mutation"}' });
    await tick();
    const [c] = read().calls;
    expect(c.ok).toBe(false);
    expect(c.answer).toContain('Email is invalid');
  });

  it('tells the agent plainly when the server refused a save', () => {
    expect(apiReport(['POST /api/patients → 409 refused: message: NHI already exists'])).toMatch(/REFUSED.*NHI already exists/);
    expect(apiReport(['POST /api/stations → 201 ok, answered {id, name}'])).toMatch(/accepted/);
    expect(apiReport([])).toBe('');
  });
});

describe('a save the server refused', async () => {
  const { rememberedAnswer, REFUSED_NOTE } = await import('@/agent/runtime/followUp');
  it('is not on the list of steps a reply must not do again', () => {
    const step = (label: string, note?: string) => ({ id: label, label, tool: 'click', status: 'done' as const, startedAt: 0, ...(note ? { note } : {}) });
    const kept = rememberedAnswer('The server refused the NHI. Which NHI should I use?', [step('Typing “Test” into “First Name *”'), step('Clicking “Save”', REFUSED_NOTE)] as never);
    expect(kept).toContain('Typing “Test” into “First Name *”');
    expect(kept).not.toContain('Clicking “Save”');
  });
});
