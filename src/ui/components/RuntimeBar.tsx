import { Popover } from 'antd';
import { BookOpen, Cloud, Cpu, Laptop, Mic, RefreshCw, Server, Wallet } from 'lucide-react';
import { knowledgeBaseFor } from '@/agent/crawler/merge';
import { sitesFor } from '@/agent/tools/registry';
import { useEffect, useState, type ReactNode } from 'react';
import type { Location } from '@/shared/constants/providers';
import type { AgentConfig, AppConfig } from '@/shared/types/config';
import { formatRelative } from '@/shared/utils';
import { dollars } from '@/agent/llm/credit';
import { useRuntimeStatus, type Health, type RuntimePart } from '../hooks/useRuntimeStatus';
import { openConfiguration } from '../utils/navigation';

const PLACE_ICON: Record<Location, typeof Cloud> = { kaggle: Server, local: Laptop, cloud: Cloud, server: Server };
const SHORT_PLACE: Record<Location, string> = { kaggle: 'Kaggle', local: 'This computer', cloud: 'Cloud', server: 'Server' };

function Dot({ health }: { health: Health }) {
  return <span className={`rt-dot ${health.state}`} role="img" aria-label={health.state === 'ok' ? 'Connected' : health.state === 'checking' ? 'Checking' : health.state === 'warning' ? 'Needs attention' : 'Not reachable'} />;
}

function Chip({ icon, part, label }: { icon: ReactNode; part: RuntimePart; label: string }) {
  return (
    <span className={`rt-chip ${part.health.state}`} aria-label={`${label}: ${part.name}, ${part.location.label}. ${part.health.message}`}>
      {icon}
      <span className="rt-name">{part.name}</span>
      <span className="rt-sep" aria-hidden>
        ·
      </span>
      <span className="rt-place">{SHORT_PLACE[part.location.kind]}</span>
      {part.credit?.left != null && (
        <>
          <span className="rt-sep" aria-hidden>
            ·
          </span>
          <span className="rt-credit">{dollars(part.credit.left)} left</span>
        </>
      )}
      <Dot health={part.health} />
    </span>
  );
}

function Detail({ title, icon, part, action }: { title: string; icon: ReactNode; part: RuntimePart; action: () => void }) {
  const Place = PLACE_ICON[part.location.kind];
  return (
    <div className="rt-section">
      <div className="rt-section-head">
        <span className="rt-section-title">
          {icon} {title}
        </span>
        <button type="button" className="link-btn small" onClick={action}>
          Change
        </button>
      </div>
      <div className="rt-model">{part.name}</div>
      {part.id !== part.name && <div className="rt-id mono">{part.id}</div>}
      <div className="rt-place-line">
        <Place size={13} aria-hidden /> {part.location.label}
      </div>
      {part.location.host && <div className="rt-host mono">{part.location.host}</div>}
      {part.credit && (
        <div className="rt-place-line">
          <Wallet size={13} aria-hidden /> {part.credit.left == null ? 'No spending limit' : `${dollars(part.credit.left)} credit left`}
          {part.credit.keyLimit != null && ` · key limit ${dollars(part.credit.keyLimit)}, ${dollars(part.credit.keyUsed)} used`}
          {part.credit.account && ` · account ${dollars(part.credit.account.total - part.credit.account.used)} of ${dollars(part.credit.account.total)}`}
        </div>
      )}
      <div className={`rt-health ${part.health.state}`}>
        <Dot health={part.health} /> {part.health.message}
      </div>
    </div>
  );
}

/** “Running on” — which model does the work, which one hears you, and where each runs. */
export function RuntimeBar({ agent, config, url = '', running = false }: { agent: AgentConfig; config: AppConfig; url?: string; running?: boolean }) {
  const { actions, voice, checkedAt, refresh } = useRuntimeStatus(agent, config, url, running);
  const sites = sitesFor(config, url);
  const gathered = !!knowledgeBaseFor(config, url)?.entries.some((e) => e.enabled);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!actions) return null;

  const content = (
    <div className="rt-pop">
      <div className="rt-pop-title">Running on</div>
      <Detail title={agent.team?.memberIds.length ? 'Actions (team coordinator)' : 'Actions'} icon={<Cpu size={13} />} part={actions} action={() => void openConfiguration('/models')} />
      {voice ? (
        <Detail title="Voice input" icon={<Mic size={13} />} part={voice} action={() => void openConfiguration('/voice')} />
      ) : (
        <div className="rt-section">
          <div className="rt-section-head">
            <span className="rt-section-title">
              <Mic size={13} /> Voice input
            </span>
            <button type="button" className="link-btn small" onClick={() => void openConfiguration('/voice')}>
              Set up
            </button>
          </div>
          <div className="rt-health checking">Off — set up Whisper or Omi on your Kaggle notebook.</div>
        </div>
      )}
      {sites.map((site) => {
        const entries = site.knowledge.filter((k) => k.enabled).length;
        const custom = site.model.trim() || site.providerId;
        return (
          <div key={site.id} className="rt-section">
            <div className="rt-section-head">
              <span className="rt-section-title">
                <BookOpen size={13} /> Site setup
              </span>
              <button type="button" className="link-btn small" onClick={() => void openConfiguration(site.id.startsWith('gathered:') ? `/knowledge/${site.id.slice(9)}` : `/sites/${site.id}`)}>
                Edit
              </button>
            </div>
            <div className="rt-model">{site.name}</div>
            <div className="rt-place-line">
              {entries} knowledge {entries === 1 ? 'entry' : 'entries'}{gathered ? ' (learned by crawling)' : ''} · {site.skillIds.length} skills · {site.customToolIds.length} tools
              {custom ? ' · its own model' : ''}
            </div>
          </div>
        );
      })}
      <div className="rt-pop-foot">
        <span>{checkedAt ? `Checked ${formatRelative(checkedAt).toLowerCase()}` : 'Checking…'}</span>
        <button type="button" className="link-btn small" onClick={() => void refresh()}>
          <RefreshCw size={12} /> Check now
        </button>
      </div>
    </div>
  );

  return (
    <Popover content={content} trigger="click" placement="bottomLeft" arrow={false} overlayClassName="rt-popover">
      <button type="button" className="runtime-bar" aria-label="What the agent runs on — show details">
        <Chip icon={<Cpu size={12} aria-hidden />} part={actions} label="Actions" />
        {voice && <Chip icon={<Mic size={12} aria-hidden />} part={voice} label="Voice" />}
        {sites.map((site) => (
          <span key={site.id} className="rt-chip ok rt-site" aria-label={`Using what you taught about ${site.name}`}>
            <BookOpen size={12} aria-hidden />
            <span className="rt-name">{site.name}</span>
          </span>
        ))}
      </button>
    </Popover>
  );
}
