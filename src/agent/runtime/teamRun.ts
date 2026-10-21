import { BrowserController, scriptableReason } from '@/extension/browser/controller';
import { ForegroundLock } from '@/extension/browser/foreground';
import { upsertTask } from '@/shared/storage/historyStore';
import type { AgentConfig } from '@/shared/types/config';
import type { StepRecord, TaskRecord } from '@/shared/types/history';
import { clip, siteOf, uid } from '@/shared/utils';
import { AgentError, isAbort, toAgentError } from '@/shared/utils/errors';
import { createClient } from '../llm';
import { upcomingDays } from '../planner/systemPrompt';
import { AgentRun, resolveProvider, type RunOptions } from './agentRun';
import type { ApprovalAnswer, RunEvent } from './events';

export interface MemberAssignment {
  key: string;
  agentId: string;
  task: string;
}

/** Events of a team run: its own task, the plan, and each member run's events. */
export type TeamEvent = RunEvent | { type: 'members'; taskId: string; members: MemberAssignment[] } | { type: 'member'; key: string; event: RunEvent };

export interface TeamRunOptions extends Omit<RunOptions, 'onEvent'> {
  onEvent: (event: TeamEvent) => void;
}

const PLAN_TOOL = 'assign_tasks';

/**
 * A coordinator and its members. The coordinator's model splits the request into one
 * self-contained task per member; members then run as ordinary agents — each in its own
 * tab, at the same time when the team is parallel. Browser actions take turns in front
 * (ForegroundLock); model calls overlap, which is where the time goes.
 */
export class TeamRun {
  readonly id = uid('task_');
  private readonly abort = new AbortController();
  private task!: TaskRecord;
  private readonly runs = new Map<string, AgentRun>();

  constructor(private readonly options: TeamRunOptions) {}

  cancel(): void {
    if (this.abort.signal.aborted) return;
    this.abort.abort(new AgentError('cancelled', 'Stopped.'));
    for (const run of this.runs.values()) run.cancel();
  }

  respond(approvalId: string, approved: ApprovalAnswer): void {
    for (const run of this.runs.values()) run.respond(approvalId, approved);
  }

  private emit(event: TeamEvent) {
    this.options.onEvent(event);
  }

  private save(patch: Partial<TaskRecord> = {}) {
    this.task = { ...this.task, ...patch };
    this.emit({ type: 'task', task: this.task });
    if (this.options.config.settings.saveHistory) void upsertTask(structuredClone(this.task)).catch(() => undefined);
  }

  private step(step: StepRecord): StepRecord {
    const steps = [...this.task.steps];
    const i = steps.findIndex((s) => s.id === step.id);
    if (i >= 0) steps[i] = step;
    else steps.push(step);
    this.task = { ...this.task, steps };
    this.emit({ type: 'step', taskId: this.id, step });
    return step;
  }

  async start(): Promise<TaskRecord> {
    const { agent, request, windowId } = this.options;
    const browser = new BrowserController(windowId, this.options.tabId);
    const tab = await browser.currentTab().catch(() => null);
    this.task = {
      id: this.id,
      request,
      agentId: agent.id,
      agentName: agent.name,
      url: tab?.url ?? '',
      site: siteOf(tab?.url) || 'Browser',
      title: tab?.title ?? '',
      status: 'running',
      startedAt: Date.now(),
      steps: [],
    };
    this.save();
    const memberTabs: number[] = [];
    try {
      const members = this.memberAgents();
      if (!members.length) throw new AgentError('unknown', `${agent.name} has no team members yet. Add some under Agents → ${agent.name} → Team.`);
      const plan = await this.plan(members, tab);
      this.throwIfCancelled();
      this.emit({ type: 'members', taskId: this.id, members: plan.map(({ key, agent: a, task }) => ({ key, agentId: a.id, task })) });

      const parallel = !!agent.team?.parallel && plan.length > 1;
      const startUrl = tab?.url && !scriptableReason(tab.url) ? tab.url : undefined;
      const tabFor = new Map<string, number | null>();
      if (parallel) {
        for (const p of plan) {
          const created = await chrome.tabs.create({ windowId, url: startUrl ?? 'about:blank', active: false, index: (tab?.index ?? 0) + 1 + memberTabs.length });
          memberTabs.push(created.id!);
          tabFor.set(p.key, created.id!);
        }
        await this.groupTabs(memberTabs);
      } else {
        for (const p of plan) tabFor.set(p.key, tab?.id ?? null);
      }

      const working = this.step({
        id: uid('step_'),
        label: parallel ? `Working with ${plan.length} agents at the same time` : `Working with ${plan.length} agent${plan.length === 1 ? '' : 's'}, one after another`,
        status: 'running',
        tool: 'team',
        startedAt: Date.now(),
      });

      const lock = parallel ? new ForegroundLock() : undefined;
      const limit = parallel ? Math.max(1, agent.team?.maxParallel ?? 3) : 1;
      const results = await pool(plan, limit, async (p) => {
        if (this.abort.signal.aborted) return null;
        const run = new AgentRun({
          request: p.task,
          agent: p.agent,
          config: this.options.config,
          windowId,
          tabId: tabFor.get(p.key) ?? null,
          history: [],
          foreground: lock,
          parentId: this.id,
          onEvent: (event) => this.emit({ type: 'member', key: p.key, event }),
        });
        this.runs.set(p.key, run);
        const record = await run.start();
        return { ...p, record };
      });
      this.throwIfCancelled();

      const finished = results.filter((r): r is NonNullable<typeof r> => !!r);
      const done = finished.filter((r) => r.record.status === 'done');
      this.step({ ...working, status: done.length === finished.length ? 'done' : 'failed', note: `${done.length} of ${plan.length} finished`, durationMs: Date.now() - working.startedAt });

      if (parallel && agent.team?.tidyUp) {
        await this.tidyUp(
          finished.filter((r) => r.record.status === 'done').map((r) => tabFor.get(r.key)!),
          tab,
        );
      }

      const lines = finished.map((r) => {
        const icon = r.record.status === 'done' ? '✓' : r.record.status === 'cancelled' ? '■' : '✗';
        const text = r.record.status === 'done' ? r.record.result ?? 'Done.' : r.record.error ?? 'Did not finish.';
        return `- ${icon} **${r.agent.name}** — ${clip(text.replace(/\s+/g, ' ').trim(), 400)}`;
      });
      const head =
        done.length === finished.length
          ? `Done — ${finished.length} agent${finished.length === 1 ? '' : 's'} worked on this${parallel ? ' at the same time' : ''}.`
          : `${done.length} of ${finished.length} agents finished. Check the ones marked ✗ below.`;
      const answer = [head, '', ...lines].join('\n');
      this.save({ status: done.length ? 'done' : 'failed', endedAt: Date.now(), result: answer, ...(done.length ? {} : { error: 'None of the agents could finish their part.' }) });
    } catch (err) {
      const e = toAgentError(isAbort(err) || this.abort.signal.aborted ? new AgentError('cancelled', 'Stopped.') : err);
      for (const s of this.task.steps) if (s.status === 'running') this.step({ ...s, status: e.code === 'cancelled' ? 'skipped' : 'failed', durationMs: Date.now() - s.startedAt });
      if (e.code === 'cancelled') this.save({ status: 'cancelled', endedAt: Date.now(), error: 'You stopped this task.' });
      else this.save({ status: 'failed', endedAt: Date.now(), error: e.userMessage, errorCode: e.code, errorDetail: e.detail });
    } finally {
      this.emit({ type: 'thinking', taskId: this.id, active: false });
    }
    return this.task;
  }

  private throwIfCancelled() {
    if (this.abort.signal.aborted) throw new AgentError('cancelled', 'Stopped.');
  }

  private memberAgents(): AgentConfig[] {
    const { agent, config } = this.options;
    return (agent.team?.memberIds ?? [])
      .map((id) => config.agents.find((a) => a.id === id))
      .filter((a): a is AgentConfig => !!a && a.id !== agent.id && !a.team?.memberIds.length);
  }

  /** Asks the coordinator's model to split the request. Falls back to the coordinator doing it alone. */
  private async plan(members: AgentConfig[], tab: chrome.tabs.Tab | null): Promise<{ key: string; agent: AgentConfig; task: string }[]> {
    const { agent, config, request } = this.options;
    let step = this.step({ id: uid('step_'), label: `Splitting the request between ${members.length} agents`, status: 'running', tool: 'plan', startedAt: Date.now() });
    const { provider, model } = resolveProvider(agent, config, tab?.url ?? '');
    const names = members.map((m) => m.name);
    const now = new Date();
    const system = [
      `You are ${agent.name}, the coordinator of a team of browser agents. Split the user's request into tasks for your team members and call ${PLAN_TOOL} once.`,
      agent.instructions.trim() ? `Instructions for you:\n${agent.instructions.trim()}` : '',
      'Team members:',
      ...members.map((m) => `- "${m.name}": ${m.description || 'general browser agent'}`),
      '',
      'Rules:',
      '- A member sees only its own task, never the original request. Make each task complete on its own: repeat who or what it is about (for example the patient’s full name) and every detail it needs.',
      '- Give each member everything in its area in one task (for example all medications together, each with its dose, frequency and duration).',
      '- Write exact dates with the weekday, e.g. "Tuesday, Oct 13, 2026 at 3:00 PM", never "next Tuesday" or "in two weeks".',
      '- Write only what the user asked for, with the values the user gave. Do not list form fields or ask for details the user did not give (no “including status, severity…”).',
      '- Never invent details the user did not give. Only assign work that matches a member’s description.',
      '- If part of the request fits no member, describe it in not_covered.',
      '',
      `Today is ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. ${upcomingDays(now)}`,
      tab?.url ? `The user is on “${tab.title ?? ''}” — ${tab.url}` : '',
    ]
      .filter((l) => l !== '')
      .join('\n');

    this.emit({ type: 'thinking', taskId: this.id, active: true });
    let assignments: { agent: string; task: string }[] = [];
    let notCovered = '';
    try {
      const res = await createClient(provider).chat({
        model,
        temperature: 0.1,
        signal: this.abort.signal,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: request },
        ],
        tools: [
          {
            name: PLAN_TOOL,
            description: 'Give each team member its task.',
            parameters: {
              type: 'object',
              properties: {
                assignments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { agent: { type: 'string', enum: names, description: 'Team member name' }, task: { type: 'string', description: 'The complete, self-contained task' } },
                    required: ['agent', 'task'],
                  },
                },
                not_covered: { type: 'string', description: 'Anything no member can do' },
              },
              required: ['assignments'],
            },
          },
        ],
      });
      const call = res.toolCalls.find((c) => c.name === PLAN_TOOL);
      const raw = call?.arguments.assignments;
      if (Array.isArray(raw)) assignments = raw.filter((a): a is { agent: string; task: string } => !!a && typeof a.agent === 'string' && typeof a.task === 'string' && !!a.task.trim());
      if (typeof call?.arguments.not_covered === 'string') notCovered = call.arguments.not_covered.trim();
    } finally {
      this.emit({ type: 'thinking', taskId: this.id, active: false });
    }
    this.throwIfCancelled();

    // Match names loosely and merge several tasks for the same member.
    const byAgent = new Map<string, { agent: AgentConfig; tasks: string[] }>();
    for (const a of assignments) {
      const n = a.agent.trim().toLowerCase();
      const member = members.find((m) => m.name.toLowerCase() === n) ?? members.find((m) => m.name.toLowerCase().includes(n) || n.includes(m.name.toLowerCase()));
      if (!member) continue;
      const entry = byAgent.get(member.id) ?? { agent: member, tasks: [] };
      entry.tasks.push(a.task.trim());
      byAgent.set(member.id, entry);
    }
    let plan = [...byAgent.values()].map((e) => ({ key: uid('m_'), agent: e.agent, task: e.tasks.join('\n') }));

    if (!plan.length) {
      // The model didn't produce a usable plan: the coordinator handles the request itself.
      plan = [{ key: uid('m_'), agent: { ...agent, team: undefined }, task: request }];
      step = this.step({ ...step, status: 'done', note: 'Couldn’t split it — handling it directly', durationMs: Date.now() - step.startedAt });
      return plan;
    }
    this.step({
      ...step,
      status: 'done',
      note: `${plan.map((p) => p.agent.name).join(', ')}${notCovered ? ` · not covered: ${clip(notCovered, 80)}` : ''}`,
      durationMs: Date.now() - step.startedAt,
    });
    return plan;
  }

  private async groupTabs(tabIds: number[]) {
    if (!tabIds.length || !chrome.tabs.group) return;
    try {
      const groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]], createProperties: { windowId: this.options.windowId } });
      await chrome.tabGroups.update(groupId, { title: this.options.agent.name, color: 'green' });
    } catch {
      /* grouping is cosmetic */
    }
  }

  /** Close the finished members' tabs and reload the user's page so it shows their changes. */
  private async tidyUp(tabIds: number[], origin: chrome.tabs.Tab | null) {
    try {
      if (tabIds.length) await chrome.tabs.remove(tabIds);
      if (origin?.id) {
        await chrome.tabs.update(origin.id, { active: true });
        if (origin.url && !scriptableReason(origin.url)) await chrome.tabs.reload(origin.id);
      }
    } catch {
      /* the user may have closed them already */
    }
  }
}

/** Runs `fn` over `items`, at most `limit` at a time, keeping order in the results. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
