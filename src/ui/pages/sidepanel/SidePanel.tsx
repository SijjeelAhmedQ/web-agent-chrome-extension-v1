import { History, Settings2, SquarePen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { matchesSite } from '@/shared/utils';
import { useAppDispatch, useAppSelector } from '@/store';
import { chatActions } from '@/store/chatSlice';
import { IconButton } from '../../components/IconButton';
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
        <Composer ref={composer} tab={tab} running={running} disabled={false} siteMode={siteMode} voice={settings.voice} onSend={onSend} onStop={stop} />
      </footer>
    </div>
  );
}
