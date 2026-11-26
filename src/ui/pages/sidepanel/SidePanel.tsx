import { GraduationCap, History, ListOrdered, Settings2, SquarePen, X } from 'lucide-react';
import { parseVoiceCommand } from '@/shared/voice/commands';
import { matchNavigation, navTargets } from '@/shared/voice/navigate';
import { approvalQuestion, say } from '@/shared/voice/say';
import { voiceReady } from '@/shared/voice/speech';
import { knowledgeBaseFor } from '@/agent/crawler/merge';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sitesFor } from '@/agent/tools/registry';
import { matchesSite, siteOf } from '@/shared/utils';
import { useAppDispatch, useAppSelector } from '@/store';
import { chatActions } from '@/store/chatSlice';
import { IconButton } from '../../components/IconButton';
import { RuntimeBar } from '../../components/RuntimeBar';
import { TodayCost } from '../../components/TodayCost';
import { useActiveTab } from '../../hooks/useActiveTab';
import { usePatientHere } from '../../hooks/usePatientHere';
import { useAgentRunner } from '../../hooks/useAgentRunner';
import { useCrawler } from '../../hooks/useCrawler';
import { openConfiguration } from '../../utils/navigation';
import { AgentSwitcher } from './AgentSwitcher';
import { CrawlView } from './CrawlView';
import { isLearnRequest, KNOWLEDGE_AGENT } from './knowledgeAgent';
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
  const { send, resume, stop, respond, running } = useAgentRunner(tab);
  const [view, setView] = useState<'chat' | 'history' | 'learn'>('chat');
  const crawler = useCrawler(tab);
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const { settings, agents, providers } = config;
  const agent = agents.find((a) => a.id === (activeAgentId ?? settings.defaultAgentId)) ?? agents[0];
  const siteMode = matchesSite(tab.url, settings.blockedSites) ? 'blocked' : matchesSite(tab.url, settings.readOnlySites) ? 'read-only' : 'normal';
  const canAct = agent.toolIds.some((t) => ['click', 'type'].includes(t));
  const multiAgent = new Set(turns.map((t) => t.agentId)).size > 1;

  // On a site with its own agents, the site's first agent takes over when you arrive there.
  const sitesHere = sitesFor(config, tab.url);
  const siteHere = sitesHere[0];
  const patient = usePatientHere(tab, sitesHere, running);
  const siteAgents = siteHere?.agentIds.filter((id) => agents.some((a) => a.id === id)) ?? [];
  // …and only the site's agents are offered there (elsewhere, every agent).
  const offered = siteAgents.length ? siteAgents.map((id) => agents.find((a) => a.id === id)!) : agents;
  useEffect(() => {
    if (!siteAgents.length || running || siteAgents.includes(agent.id)) return;
    dispatch(chatActions.setActiveAgent(siteAgents[0]));
  }, [siteHere?.id, siteAgents.join(','), agent.id, running]);

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

  // “Learn this website” (typed, said or picked): the Knowledge Gather Agent takes over and starts.
  const [learnToken, setLearnToken] = useState(0);
  const learn = useCallback(() => {
    setView('learn');
    setLearnToken((n) => n + 1);
  }, []);

  const onSend = useCallback(
    (text: string) => {
      if (isLearnRequest(text)) {
        learn();
        return;
      }
      setView('chat');
      void send(text);
    },
    [send, learn],
  );

  // ---- Hands-free voice: replies steer the agent, anything else is a new request.
  const [queued, setQueued] = useState<string[]>([]);
  const pendingApprovals = (() => {
    const t = turns[turns.length - 1];
    if (!t) return [];
    return [t.approval, ...(t.members ?? []).map((m) => m.approval)].filter((a): a is NonNullable<typeof a> => !!a);
  })();

  const voice = settings.voice;
  const speak = (text: string) => {
    if (voice.speak) void say(text, voice.lang);
  };
  /** The last request came by voice: its approval questions are asked aloud too. */
  const byVoice = useRef(false);

  /** “Open stations”: straight to the page the site's map knows, with no model — shown in the chat like any request. */
  const goByVoice = (text: string): boolean => {
    const kb = knowledgeBaseFor(config, tab.url);
    if (!kb || tab.id == null || tab.restricted || siteMode === 'blocked') return false;
    const target = matchNavigation(text, navTargets(kb));
    if (!target) return false;
    let url: string;
    try {
      url = new URL(target.path, tab.url).href;
    } catch {
      return false;
    }
    const now = Date.now();
    const id = `nav-${now}`;
    const result = `Opened **${target.label}**.`;
    void chrome.tabs.update(tab.id, { url });
    dispatch(
      chatActions.localTurn({
        id,
        request: text,
        agentId: agent.id,
        task: { id, request: text, agentId: agent.id, agentName: agent.name, url, site: siteOf(url), title: target.label, status: 'done', startedAt: now, endedAt: now, result, steps: [] },
      }),
    );
    setView('chat');
    speak(`Opening ${target.label}.`);
    return true;
  };

  const onVoiceCommand = (text: string) => {
    const intent = voice.voiceCommands ? parseVoiceCommand(text, { approvalPending: pendingApprovals.length > 0, running }) : { kind: 'request' as const, text };
    switch (intent.kind) {
      case 'approve':
        respond(pendingApprovals[0].id, true);
        speak('Okay.');
        return;
      case 'approve-all':
        pendingApprovals.forEach((a) => respond(a.id, true));
        speak('Okay.');
        return;
      case 'decline':
        respond(pendingApprovals[0].id, false);
        speak('Cancelled.');
        return;
      case 'stop':
        setQueued([]);
        stop();
        speak('Stopped.');
        return;
      default:
        byVoice.current = true;
        if (running) setQueued((q) => [...q, intent.text]);
        else if (!goByVoice(intent.text)) onSend(intent.text);
    }
  };

  // A request made by voice that needs an OK: the question is said aloud, and the dialog listens for yes or no.
  const asking = pendingApprovals[0];
  useEffect(() => {
    if (!asking || !byVoice.current || !voiceReady(voice)) return;
    const question = approvalQuestion(asking);
    const handsFree = voice.mode === 'handsfree' && voice.engine !== 'browser';
    let gone = false;
    void (voice.speak ? say(question, voice.lang) : Promise.resolve()).then(() => {
      // Hands-free is listening already; tap to talk opens the dialog for the answer.
      if (!gone && !handsFree && voice.voiceCommands) composer.current?.listen(question);
    });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking?.id]);

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
        <AgentSwitcher
          agents={[...offered, KNOWLEDGE_AGENT]}
          title={siteAgents.length ? `Agents for ${siteHere!.name}` : 'Agents'}
          active={view === 'learn' || crawler.active ? KNOWLEDGE_AGENT : agent}
          disabled={running || crawler.active}
          onChange={(id) => {
            if (id === KNOWLEDGE_AGENT.id) return setView('learn');
            dispatch(chatActions.setActiveAgent(id));
            if (view === 'learn') setView('chat');
          }}
        />
        <span className="spacer" />
        <IconButton label="New chat" onClick={newChat} disabled={running || !turns.length}>
          <SquarePen size={16} />
        </IconButton>
        <IconButton label={crawler.active ? 'Learning this site…' : 'Learn this site'} onClick={() => setView((v) => (v === 'learn' ? 'chat' : 'learn'))} aria-pressed={view === 'learn'} className={crawler.active ? 'is-live' : undefined}>
          <GraduationCap size={16} />
        </IconButton>
        <IconButton label="Activity" onClick={() => setView((v) => (v === 'history' ? 'chat' : 'history'))} aria-pressed={view === 'history'}>
          <History size={16} />
        </IconButton>
        <IconButton label="Settings" onClick={() => void openConfiguration('/agents')}>
          <Settings2 size={16} />
        </IconButton>
      </header>
      {providers.length > 0 && <RuntimeBar agent={agent} config={config} url={tab.url} running={running} />}
      {providers.length > 0 && <TodayCost />}
      {patient && (
        <div className="patient-here" role="status">
          Patient: <strong>{patient.name}</strong>
          {patient.nhi ? ` · NHI ${patient.nhi}` : ''}
        </div>
      )}

      {view === 'learn' ? (
        <CrawlView tab={tab} crawler={crawler} chatBusy={running} autoStart={learnToken} onBack={() => setView('chat')} />
      ) : view === 'history' ? (
        <HistoryView onBack={() => setView('chat')} onRunAgain={onSend} onResume={(task) => { setView('chat'); void resume(task); }} busy={running} />
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
                  ? settings.voice.mode === 'handsfree' && settings.voice.engine !== 'browser'
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
                  busy={running}
                  onRespond={respond}
                  onRetry={onSend}
                  onResume={(task) => void resume(task)}
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
        <Composer ref={composer} tab={tab} running={running} disabled={crawler.active} siteMode={siteMode} voice={settings.voice} onSend={(t) => { byVoice.current = false; onSend(t); }} onStop={stop} onVoiceCommand={onVoiceCommand} approvalPending={pendingApprovals.length > 0} />
      </footer>
    </div>
  );
}
