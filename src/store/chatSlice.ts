import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ApprovalPrompt } from '@/agent/runtime/events';
import type { ChatMessage } from '@/agent/llm/types';
import type { StepRecord, TaskRecord } from '@/shared/types/history';

/** A conversation turn: the user's words, then the task that answered them. */
export interface Turn {
  id: string;
  request: string;
  agentId: string;
  task: TaskRecord | null;
  thinking: boolean;
  approval: ApprovalPrompt | null;
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
      state.turns = action.payload.turns.map((t) => ({ ...t, thinking: false, approval: null }));
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
    endTurn(state, action: PayloadAction<{ turnId: string; remember?: ChatMessage[] }>) {
      const turn = state.turns.find((t) => t.id === action.payload.turnId);
      if (turn) {
        turn.thinking = false;
        turn.approval = null;
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
