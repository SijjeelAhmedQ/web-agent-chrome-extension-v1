import { useCallback, useEffect, useRef } from 'react';
import { AgentRun } from '@/agent/runtime/agentRun';
import { getItem, setItem } from '@/shared/storage/kv';
import type { TaskRecord } from '@/shared/types/history';
import { siteOf, uid } from '@/shared/utils';
import { toAgentError } from '@/shared/utils/errors';
import { useAppDispatch, useAppSelector, type AppStore } from '@/store';
import { chatActions, type Turn } from '@/store/chatSlice';
import { useStore } from 'react-redux';
import type { ActiveTab } from './useActiveTab';

const CHAT_KEY = 'wa.chat';

/**
 * Bridges the agent runtime and the UI: starts runs, routes their events into the store,
 * relays approvals and Stop, and keeps the conversation across panel reloads (session storage).
 */
export function useAgentRunner(tab: ActiveTab) {
  const dispatch = useAppDispatch();
  const store = useStore() as AppStore;
  const runRef = useRef<AgentRun | null>(null);
  const running = useAppSelector((s) => s.chat.running);

  // Restore this session's conversation, then keep saving it.
  useEffect(() => {
    let ready = false;
    void getItem<{ turns: Turn[]; memory: never[] }>(CHAT_KEY, 'session').then((saved) => {
      if (saved?.turns?.length && !store.getState().chat.turns.length) {
        const turns = saved.turns.map((t) =>
          t.task?.status === 'running' ? { ...t, task: { ...t.task, status: 'cancelled' as const, error: 'Interrupted — the panel was closed.' } } : t,
        );
        dispatch(chatActions.restore({ turns, memory: saved.memory ?? [] }));
      }
      ready = true;
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = store.getState().chat;
    const unsubscribe = store.subscribe(() => {
      const chat = store.getState().chat;
      if (!ready || chat === last) return;
      last = chat;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void setItem(CHAT_KEY, { turns: chat.turns.slice(-30), memory: chat.memory }, 'session').catch(() => undefined), 400);
    });
    return () => {
      unsubscribe();
      runRef.current?.cancel();
    };
  }, [dispatch, store]);

  const send = useCallback(
    async (request: string) => {
      const text = request.trim();
      const state = store.getState();
      if (!text || state.chat.running) return;
      const config = state.config.config;
      const agent = config.agents.find((a) => a.id === (state.chat.activeAgentId ?? config.settings.defaultAgentId)) ?? config.agents[0];
      const turnId = uid('turn_');
      dispatch(chatActions.startTurn({ id: turnId, request: text, agentId: agent.id }));

      if (tab.windowId === null) {
        dispatch(chatActions.failTurn({ turnId, task: failedTask(text, agent.id, agent.name, tab, 'no_tab', 'I can’t see a browser window to work in.') }));
        return;
      }

      const run = new AgentRun({
        request: text,
        agent,
        config,
        windowId: tab.windowId,
        tabId: tab.id,
        history: state.chat.memory,
        onEvent: (event) => {
          switch (event.type) {
            case 'task':
              dispatch(chatActions.taskUpdated({ turnId, task: event.task }));
              break;
            case 'step':
              dispatch(chatActions.stepUpdated({ taskId: event.taskId, step: event.step }));
              break;
            case 'thinking':
              dispatch(chatActions.thinking({ taskId: event.taskId, active: event.active }));
              break;
            case 'approval':
              dispatch(chatActions.approval({ taskId: event.taskId, prompt: event.prompt }));
              break;
          }
        },
      });
      runRef.current = run;
      try {
        const task = await run.start();
        dispatch(
          chatActions.endTurn({
            turnId,
            remember: task.status === 'done' && task.result ? [{ role: 'user', content: text }, { role: 'assistant', content: task.result }] : undefined,
          }),
        );
      } catch (err) {
        const e = toAgentError(err);
        dispatch(chatActions.failTurn({ turnId, task: failedTask(text, agent.id, agent.name, tab, e.code, e.userMessage, e.detail) }));
      } finally {
        if (runRef.current === run) runRef.current = null;
      }
    },
    [dispatch, store, tab],
  );

  const stop = useCallback(() => runRef.current?.cancel(), []);
  const respond = useCallback((approvalId: string, approved: boolean) => runRef.current?.respond(approvalId, approved), []);

  return { send, stop, respond, running };
}

function failedTask(request: string, agentId: string, agentName: string, tab: ActiveTab, code: string, message: string, detail?: string): TaskRecord {
  return {
    id: uid('task_'),
    request,
    agentId,
    agentName,
    url: tab.url,
    site: siteOf(tab.url) || 'Browser',
    title: tab.title,
    status: 'failed',
    startedAt: Date.now(),
    endedAt: Date.now(),
    error: message,
    errorCode: code,
    errorDetail: detail,
    steps: [],
  };
}
