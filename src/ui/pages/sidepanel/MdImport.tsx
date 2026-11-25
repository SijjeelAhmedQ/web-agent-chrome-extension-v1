import { Button, Checkbox, Input } from 'antd';
import { CheckCircle2, ChevronDown, ChevronRight, FileText, Globe, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { convertWithModel, fileProposals, hostIn, readKnowledgeFile } from '@/agent/crawler/mdImport';
import { hostOf, mergeIntoBase, newKnowledgeBase, type ProposedEntry } from '@/agent/crawler/merge';
import { KNOWLEDGE_KINDS } from '@/agent/planner/siteKnowledge';
import type { KnowledgeKind } from '@/shared/types/config';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';
import type { ActiveTab } from '../../hooks/useActiveTab';
import { baseOfHost } from '../../hooks/useCrawler';
import { openConfiguration } from '../../utils/navigation';

const KIND_ORDER: KnowledgeKind[] = ['navigation', 'page', 'workflow', 'rule'];
const money = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;

export interface UploadedFile {
  name: string;
  text: string;
}

/**
 * A knowledge file the user uploaded (Markdown, the template the export writes — or free notes the model turns into
 * entries): previewed like a crawl's review, then saved into the site's knowledge base. What the file says replaces
 * the same entries there, and a later crawl never overwrites it.
 */
export function MdImport({ file, tab, onClose }: { file: UploadedFile; tab: ActiveTab; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const config = useAppSelector((s) => s.config.config);
  const activeAgentId = useAppSelector((s) => s.chat.activeAgentId);
  const parsed = useMemo(() => readKnowledgeFile(file.text), [file.text]);
  const [host, setHost] = useState(() => parsed.sites[0] || hostOf(tab.url || ''));
  const target = baseOfHost(config.knowledgeBases, host);
  const [proposals, setProposals] = useState<ProposedEntry[]>(() => (parsed.templated ? fileProposals(parsed.entries, target) : []));
  const [never, setNever] = useState<string[]>(parsed.neverClick);
  const [neverOn, setNeverOn] = useState<Set<string>>(() => new Set(parsed.neverClick));
  const [open, setOpen] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState('');
  const [cost, setCost] = useState(0);
  const [saved, setSaved] = useState<{ added: number; updated: number; name: string } | null>(null);

  const groups = useMemo(() => KIND_ORDER.map((k) => ({ kind: k, items: proposals.filter((p) => p.kind === k) })).filter((g) => g.items.length), [proposals]);
  const chosen = proposals.filter((p) => p.selected).length;
  const set = (id: string, patch: Partial<ProposedEntry>) => setProposals((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const validHost = !!hostIn(host);

  const convert = async () => {
    setConverting(true);
    setError('');
    try {
      const agent = config.agents.find((a) => a.id === (activeAgentId ?? config.settings.defaultAgentId)) ?? config.agents[0];
      const res = await convertWithModel({ text: file.text, host: hostIn(host), config, agent });
      setCost(res.cost);
      if (!res.entries.length) setError('The model found nothing to turn into knowledge in this file.');
      setProposals(fileProposals(res.entries, target, 'file (converted)'));
      setNever(res.neverClick);
      setNeverOn(new Set(res.neverClick));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConverting(false);
    }
  };

  const save = () => {
    const h = hostIn(host);
    const base = target ?? newKnowledgeBase(`https://${h.replace(/^\*\./, '')}`, parsed.name || h);
    const { kb, added, updated } = mergeIntoBase(base, proposals.filter((p) => p.selected), never.filter((n) => neverOn.has(n)), [], Date.now(), 'md');
    dispatch(configActions.upsertKnowledgeBase(kb));
    dispatch(configActions.adoptKnowledgeBase(kb.id));
    setSaved({ added, updated, name: kb.name });
  };

  if (saved) {
    return (
      <div className="crawl-body">
        <div className="crawl-done">
          <CheckCircle2 size={28} />
          <div className="crawl-title">Saved to {saved.name}</div>
          <div className="crawl-sub">
            {saved.added || saved.updated
              ? `${saved.added} added · ${saved.updated} updated from ${file.name}. The web agent now uses it on ${hostIn(host)}, and a crawl won’t overwrite what the file changed.`
              : `Nothing changed — the knowledge base already says what ${file.name} says.`}
          </div>
        </div>
        <div className="crawl-actions">
          <Button onClick={() => void openConfiguration('/knowledge')}>Open knowledge base</Button>
          <Button type="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="crawl-body">
      <div className="crawl-status">
        <span className="crawl-phase is-review">From a file</span>
        <span className="crawl-host">
          <FileText size={12} /> {file.name}
        </span>
      </div>
      <label className="crawl-label" htmlFor="md-site">
        Website
      </label>
      <Input id="md-site" prefix={<Globe size={13} />} value={host} onChange={(e) => setHost(e.target.value)} placeholder="app.example.com" status={validHost ? undefined : 'error'} />
      <div className="crawl-note">
        {target
          ? `Goes into ${target.name}’s knowledge base (${target.entries.length} entries now). What the file says replaces the same entries there; the rest stay.`
          : validHost
            ? `${hostIn(host)} has no knowledge base yet — saving makes it, with the site and its own agent.`
            : 'Type the website this file is about.'}
      </div>

      {!parsed.templated && !proposals.length && (
        <div className="approval" role="region" aria-label="Not in the template">
          <div className="approval-icon" aria-hidden>
            <Sparkles size={18} />
          </div>
          <div className="approval-body">
            <div className="approval-title">This file isn’t in the knowledge template</div>
            <div className="approval-detail">
              The template uses blocks like “### Workflow: Add a practice member”. The model can read the file and turn it into entries — only what the file says — for you to check before saving.
            </div>
            <div className="approval-actions crawl-wrap">
              <Button onClick={onClose}>Cancel</Button>
              <Button type="primary" icon={<Sparkles size={14} />} loading={converting} disabled={!validHost} onClick={() => void convert()}>
                Convert with AI
              </Button>
            </div>
          </div>
        </div>
      )}
      {error && <div className="crawl-note warn">{error}</div>}
      {cost > 0 && <div className="crawl-note">Converted by the model for {money(cost)}.</div>}
      {parsed.unknown.length > 0 && <div className="crawl-note warn">Skipped {parsed.unknown.length} heading{parsed.unknown.length === 1 ? '' : 's'} of no known kind (Rule, Navigation, Page, Workflow): {parsed.unknown.slice(0, 3).join(' · ')}</div>}

      {proposals.length > 0 && (
        <>
          <p className="crawl-lede">Tick what goes into the knowledge base. Click an entry to read or edit it. “update” replaces the entry of the same name.</p>
          <div className="crawl-actions">
            <Button size="small" onClick={() => setProposals((cur) => cur.map((p) => ({ ...p, selected: true })))}>
              Select all
            </Button>
            <Button size="small" onClick={() => setProposals((cur) => cur.map((p) => ({ ...p, selected: false })))}>
              Select none
            </Button>
          </div>
        </>
      )}
      {groups.map((g) => (
        <div key={g.kind} className="crawl-group">
          <div className="crawl-group-title">
            {KNOWLEDGE_KINDS[g.kind].label} <span>{g.items.length}</span>
          </div>
          {g.items.map((p) => (
            <div key={p.id} className={`crawl-entry ${p.selected ? '' : 'is-off'}`}>
              <div className="crawl-entry-head">
                <Checkbox checked={p.selected} onChange={(e) => set(p.id, { selected: e.target.checked })} aria-label={`Keep ${p.title}`} />
                <button type="button" className="crawl-entry-title" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                  {open === p.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span>{p.title}</span>
                </button>
                {p.update && <span className="pill">update</span>}
              </div>
              {open === p.id && (
                <div className="crawl-entry-edit">
                  <Input value={p.title} onChange={(e) => set(p.id, { title: e.target.value })} aria-label="Title" />
                  {p.kind === 'workflow' && <Input value={p.trigger ?? ''} onChange={(e) => set(p.id, { trigger: e.target.value })} placeholder="Example request" aria-label="Example request" />}
                  <Input.TextArea className="mono-area" value={p.content} onChange={(e) => set(p.id, { content: e.target.value })} autoSize={{ minRows: 4, maxRows: 16 }} aria-label="Content" />
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
      {never.length > 0 && (
        <div className="crawl-group">
          <div className="crawl-group-title">
            Never click <span>{never.length}</span>
          </div>
          {never.map((n) => (
            <label key={n} className="crawl-entry-head">
              <Checkbox checked={neverOn.has(n)} onChange={(e) => setNeverOn((cur) => (e.target.checked ? new Set([...cur, n]) : new Set([...cur].filter((x) => x !== n))))} />
              <span>“{n}”</span>
            </label>
          ))}
        </div>
      )}
      {(proposals.length > 0 || never.length > 0) && (
        <div className="crawl-sticky">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" icon={<CheckCircle2 size={15} />} disabled={!validHost || (!chosen && !neverOn.size)} onClick={save}>
            Save {chosen} {chosen === 1 ? 'entry' : 'entries'}
          </Button>
        </div>
      )}
    </div>
  );
}
