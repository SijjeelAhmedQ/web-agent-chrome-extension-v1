import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '../types/history';
import { taskTokens, tokenReportCsv } from './tokenReport';

const call = (inputTokens: number, cachedTokens: number, knowledge: number) => ({
  at: 0,
  durationMs: 1000,
  role: 'worker' as const,
  purpose: 'Doing a step',
  model: 'anthropic/claude-haiku-5.5',
  inputTokens,
  cachedTokens,
  outputTokens: 50,
  cost: 0.001,
  parts: { system: 2000, knowledge, tools: 3000, pages: 2500, rest: 100 },
});
const task = (request: string, startedAt: number, calls: ReturnType<typeof call>[]): TaskRecord =>
  ({ id: request, request, agentId: 'a', agentName: 'A', url: '', site: 'app.x.com', title: '', status: 'done', startedAt, endedAt: startedAt + 9000, steps: [], calls }) as TaskRecord;

describe('the token report', () => {
  it('sums each task, splits what was paid in full from what the cache served, and averages the prompt parts', () => {
    const t = taskTokens(task('Open practice members', 0, [call(16000, 0, 5000), call(17000, 16000, 6000)]));
    expect(t).toMatchObject({ calls: 2, tokensIn: 33000, cached: 16000, newIn: 17000, out: 100, cost: 0.002, seconds: 9, avgKnowledge: 5500, avgTools: 3000 });
  });

  it('is a CSV, oldest first, with totals — and a request with a comma or quote stays one cell', () => {
    const csv = tokenReportCsv([task('Fill "First Name", then stop', 2000, [call(10, 0, 1)]), task('Open practice members', 1000, [call(20, 5, 1)])]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toMatch(/^started,request,site,status,model,calls,steps,tokens_in,cached,new_in,tokens_out,cost_usd,seconds/);
    expect(lines[1]).toContain('Open practice members');
    expect(lines[2]).toContain('"Fill ""First Name"", then stop"');
    expect(lines[3]).toMatch(/TOTAL \(2 tasks\),,,,2,0,30,5,25,100,0\.002,18/);
  });
});
