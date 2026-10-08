import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ApprovalPrompt, RunEvent } from '@/agent/runtime/events';
import type { ChatMessage } from '@/agent/llm/types';
import type { StepRecord, TaskRecord } from '@/shared/types/history';

/** One member of a team turn: its assignment and its own live run. */
export interface MemberState {
  key: string;
  agentId: string;
  assignment: string;
  task: TaskRecord | null;
  thinking: boolean;
  approval: ApprovalPrompt | null;
}

/** A conversation turn: the user's words, then the task that answered them. */
export interface Turn {
  id: string;
  request: string;
  agentId: string;
  task: TaskRecord | null;
  thinking: boolean;
  approval: ApprovalPrompt | null;
  /** Team turns: the members working on it. */
  members?: MemberState[];
}

function applyEvent(target: { task: TaskRecord | null; thinking: boolean; approval: ApprovalPrompt | null }, event: RunEvent) {
  switch (event.type) {
    case 'task':
      target.task = event.task;
      break;
    case 'step': {
      if (!target.task) return;
      const steps = target.task.steps;
      const i = steps.findIndex((s) => s.id === event.step.id);
      if (i >= 0) steps[i] = event.step;
      else steps.push(event.step);
      break;
    }
    case 'thinking':
      target.thinking = event.active;
      break;
    case 'approval':
      target.approval = event.prompt;
      break;
  }
}

interface ChatState {
  turns: Turn[];
  /** Compact memory sent to the model on follow-ups: requests and final answers only. */
  memory: ChatMessage[];
  activeAgentId: string | null;
  running: boolean;
}

const initialState: ChatState = { turns: [], memory: [], activeAgentId: null, running: false };

const turnFor = (state: ChatState, taskId: string) => state.turns.find((t) => t.task?.id === taskId || t.id === taskId);

export const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    restore(state, action: PayloadAction<Pick<ChatState, 'turns' | 'memory'>>) {
      state.turns = action.payload.turns.map((t) => ({
        ...t,
        thinking: false,
        approval: null,
        members: t.members?.map((m) => ({ ...m, thinking: false, approval: null, task: m.task?.status === 'running' ? { ...m.task, status: 'cancelled' as const, error: 'Interrupted — the panel was closed.' } : m.task })),
      }));
      state.memory = action.payload.memory;
    },
    setActiveAgent(state, action: PayloadAction<string>) {
      state.activeAgentId = action.payload;
    },
    startTurn(state, action: PayloadAction<{ id: string; request: string; agentId: string }>) {
      state.turns.push({ ...action.payload, task: null, thinking: true, approval: null });
      state.running = true;
    },
    taskUpdated(state, action: PayloadAction<{ turnId: string; task: TaskRecord }>) {
      const turn = state.turns.find((t) => t.id === action.payload.turnId);
      if (turn) turn.task = action.payload.task;
    },
    stepUpdated(state, action: PayloadAction<{ taskId: string; step: StepRecord }>) {
      const turn = turnFor(state, action.payload.taskId);
      if (!turn?.task) return;
      const steps = turn.task.steps;
      const i = steps.findIndex((s) => s.id === action.payload.step.id);
      if (i >= 0) steps[i] = action.payload.step;
      else steps.push(action.payload.step);
    },
    thinking(state, action: PayloadAction<{ taskId: string; active: boolean }>) {
      const turn = turnFor(state, action.payload.taskId);
      if (turn) turn.thinking = action.payload.active;
    },
    approval(state, action: PayloadAction<{ taskId: string; prompt: ApprovalPrompt | null }>) {
      const turn = turnFor(state, action.payload.taskId);
      if (turn) turn.approval = action.payload.prompt;
    },
    setMembers(state, action: PayloadAction<{ turnId: string; members: { key: string; agentId: string; task: string }[] }>) {
      const turn = state.turns.find((t) => t.id === action.payload.turnId);
      if (turn) turn.members = action.payload.members.map((m) => ({ key: m.key, agentId: m.agentId, assignment: m.task, task: null, thinking: true, approval: null }));
    },
    memberEvent(state, action: PayloadAction<{ turnId: string; key: string; event: RunEvent }>) {
      const member = state.turns.find((t) => t.id === action.payload.turnId)?.members?.find((m) => m.key === action.payload.key);
      if (member) applyEvent(member, action.payload.event);
    },
    endTurn(state, action: PayloadAction<{ turnId: string; remember?: ChatMessage[] }>) {
      const turn = state.turns.find((t) => t.id === action.payload.turnId);
      if (turn) {
        turn.thinking = false;
        turn.approval = null;
        for (const m of turn.members ?? []) {
          m.thinking = false;
          m.approval = null;
        }
      }
      if (action.payload.remember) state.memory = [...state.memory, ...action.payload.remember].slice(-12);
      state.running = false;
    },
    /** A failure before the task even started (no model, no tab…). */
    failTurn(state, action: PayloadAction<{ turnId: string; task: TaskRecord }>) {
      const turn = state.turns.find((t) => t.id === action.payload.turnId);
      if (turn) {
        turn.task = action.payload.task;
        turn.thinking = false;
        turn.approval = null;
      }
      state.running = false;
    },
    clear(state) {
      state.turns = [];
      state.memory = [];
    },
  },
});

export const chatActions = chatSlice.actions;
