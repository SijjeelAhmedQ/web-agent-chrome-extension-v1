import { History, ListOrdered, Settings2, SquarePen, X } from 'lucide-react';
import { parseVoiceCommand } from '@/shared/voice/commands';
import { voiceReady } from '@/shared/voice/speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { matchesSite } from '@/shared/utils';
import { useAppDispatch, useAppSelector } from '@/store';
import { chatActions } from '@/store/chatSlice';
import { IconButton } from '../../components/IconButton';
import { RuntimeBar } from '../../components/RuntimeBar';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useAgentRunner } from '../../hooks/useAgentRunner';
import { openConfiguration } from '../../utils/navigation';
import { AgentSwitcher } from './AgentSwitcher';
import { Composer, type ComposerHandle } from './Composer';
import { EmptyState } from './EmptyState';
import { HistoryView } from './HistoryView';
import { TurnView } from './Turn';

export function SidePanel() {
  const dispatch = useAppDispatch();
  const config = useAppSelector((s) => s.config.config);
  const hydrated = useAppSelector((s) => s.config.hydrated);
  const turns = useAppSelector((s) => s.chat.turns);
  const activeAgentId = useAppSelector((s) => s.chat.activeAgentId);
  const tab = useActiveTab();
  const { send, stop, respond, running } = useAgentRunner(tab);
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const { settings, agents, providers } = config;
  const agent = agents.find((a) => a.id === (activeAgentId ?? settings.defaultAgentId)) ?? agents[0];
  const siteMode = matchesSite(tab.url, settings.blockedSites) ? 'blocked' : matchesSite(tab.url, settings.readOnlySites) ? 'read-only' : 'normal';
  const canAct = agent.toolIds.some((t) => ['click', 'type'].includes(t));
  const multiAgent = new Set(turns.map((t) => t.agentId)).size > 1;

  // Keep the newest activity in view while the agent works.
  const last = turns[turns.length - 1];
  const lastSignature = `${turns.length}:${last?.task?.steps.length ?? 0}:${last?.task?.status}:${last?.approval?.id ?? ''}:${last?.thinking}`;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom || running) el.scrollTo({ top: el.scrollHeight, behavior: settings.reduceMotion ? 'auto' : 'smooth' });
  }, [lastSignature, running, settings.reduceMotion]);

  // Global shortcuts: Esc stops, “/” focuses the composer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && running) {
        e.preventDefault();
        stop();
      } else if (e.key === '/' && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        composer.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, stop]);

  const onSend = useCallback(
    (text: string) => {
      setView('chat');
      void send(text);
    },
    [send],
  );

  // ---- Hands-free voice: replies steer the agent, anything else is a new request.
  const [queued, setQueued] = useState<string[]>([]);
  const pendingApprovals = (() => {
    const t = turns[turns.length - 1];
    if (!t) return [];
    return [t.approval, ...(t.members ?? []).map((m) => m.approval)].filter((a): a is NonNullable<typeof a> => !!a);
  })();

  const onVoiceCommand = (text: string) => {
    const intent = settings.voice.voiceCommands ? parseVoiceCommand(text, { approvalPending: pendingApprovals.length > 0, running }) : { kind: 'request' as const, text };
    switch (intent.kind) {
      case 'approve':
        respond(pendingApprovals[0].id, true);
        return;
      case 'approve-all':
        pendingApprovals.forEach((a) => respond(a.id, true));
        return;
      case 'decline':
        respond(pendingApprovals[0].id, false);
        return;
      case 'stop':
        setQueued([]);
        stop();
        return;
      default:
        if (running) setQueued((q) => [...q, intent.text]);
        else onSend(intent.text);
    }
  };

  // Commands spoken while the agent was busy run, in order, as soon as it's free.
  useEffect(() => {
    if (running || !queued.length) return;
    const [next, ...rest] = queued;
    setQueued(rest);
    onSend(next);
  }, [running, queued, onSend]);

  const newChat = () => {
    if (running) return;
    dispatch(chatActions.clear());
    composer.current?.focus();
  };

  if (!hydrated) return <div className="panel" aria-busy="true" />;

  return (
    <div className="panel">
      <header className="panel-head">
        <AgentSwitcher agents={agents} active={agent} disabled={running} onChange={(id) => dispatch(chatActions.setActiveAgent(id))} />
        <span className="spacer" />
        <IconButton label="New chat" onClick={newChat} disabled={running || !turns.length}>
          <SquarePen size={16} />
        </IconButton>
        <IconButton label="Activity" onClick={() => setView((v) => (v === 'history' ? 'chat' : 'history'))} aria-pressed={view === 'history'}>
          <History size={16} />
        </IconButton>
        <IconButton label="Settings" onClick={() => void openConfiguration('/agents')}>
          <Settings2 size={16} />
        </IconButton>
      </header>
      {providers.length > 0 && <RuntimeBar agent={agent} config={config} url={tab.url} />}

      {view === 'history' ? (
        <HistoryView onBack={() => setView('chat')} onRunAgain={onSend} />
      ) : (
        <main className="chat" ref={scroller}>
          {turns.length === 0 ? (
            <EmptyState
              agent={agent}
              hasModel={providers.length > 0}
              showSuggestions={settings.showSuggestions}
              canAct={canAct}
              voiceHint={
                voiceReady(settings.voice)
                  ? settings.voice.mode === 'handsfree'
                    ? 'Or just talk: click the mic once, then pause after each request.'
                    : 'Or click the mic and say what you need.'
                  : undefined
              }
              onPick={(prompt, fill) => (fill || !prompt ? composer.current?.fill(prompt) : onSend(prompt))}
            />
          ) : (
            <div className="turns">
              {turns.map((t, i) => (
                <TurnView
                  key={t.id}
                  turn={t}
                  agent={agents.find((a) => a.id === t.agentId)}
                  agents={agents}
                  showAgent={multiAgent}
                  developer={settings.developerMode}
                  expandActivity={settings.expandActivity}
                  isLast={i === turns.length - 1}
                  onRespond={respond}
                  onRetry={onSend}
                />
              ))}
            </div>
          )}
        </main>
      )}

      <footer className="panel-foot">
        {queued.length > 0 && (
          <div className="queued-note" role="status">
            <ListOrdered size={13} aria-hidden />
            <span>
              Next: “{queued[0]}”{queued.length > 1 ? ` and ${queued.length - 1} more` : ''}
            </span>
            <button type="button" className="icon-btn small" aria-label="Clear queued commands" onClick={() => setQueued([])}>
              <X size={13} />
            </button>
          </div>
        )}
        <Composer ref={composer} tab={tab} running={running} disabled={false} siteMode={siteMode} voice={settings.voice} onSend={onSend} onStop={stop} onVoiceCommand={onVoiceCommand} approvalPending={pendingApprovals.length > 0} />
      </footer>
    </div>
  );
}
