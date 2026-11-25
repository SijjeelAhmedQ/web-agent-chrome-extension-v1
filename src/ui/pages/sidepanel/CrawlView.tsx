import { Button, Checkbox, Input, InputNumber, Progress, Select } from 'antd';
import { ArrowLeft, BookOpen, CheckCircle2, ChevronDown, ChevronRight, Globe, LogIn, Pause, Play, ShieldAlert, Square, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CrawlPrompt, CrawlState } from '@/agent/crawler/crawlRun';
import { hostOf, type ProposedEntry } from '@/agent/crawler/merge';
import { deleteSavedCrawl, loadSavedCrawl, type SavedCrawl } from '@/agent/crawler/savedCrawl';
import { KNOWLEDGE_KINDS } from '@/agent/planner/siteKnowledge';
import { crawlerSettings } from '@/shared/constants/defaults';
import type { CrawlerSettings, KnowledgeKind } from '@/shared/types/config';
import { useAppSelector } from '@/store';
import type { ActiveTab } from '../../hooks/useActiveTab';
import { baseOfHost, type LearnMode, type useCrawler } from '../../hooks/useCrawler';
import { openConfiguration } from '../../utils/navigation';

type Crawler = ReturnType<typeof useCrawler>;

/** The last “learn this website” request that started a crawl (it outlives the form). */
let startedRequest = 0;
/** Dollars as the user reads them: cents, or tenths of a cent below one cent. */
const money = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
/** Crawls whose reading was already saved to Downloads (once each). */
const downloadedCrawls = new Set<string>();

const PHASE_LABEL: Record<CrawlState['phase'], string> = {
  exploring: 'Exploring',
  paused: 'Paused',
  explored: 'Explored',
  writing: 'Writing knowledge',
  review: 'Ready to review',
  cancelled: 'Cancelled',
  failed: 'Stopped',
};

/** The Knowledge Gather Agent in the side panel: start, live progress, the user's OKs, and the review. */
export function CrawlView({ tab, crawler, chatBusy, autoStart, onBack }: { tab: ActiveTab; crawler: Crawler; chatBusy: boolean; autoStart?: number; onBack: () => void }) {
  const { state } = crawler;
  return (
    <main className="chat crawl">
      <div className="crawl-head">
        <button type="button" className="icon-btn small" aria-label="Back to chat" onClick={onBack}>
          <ArrowLeft size={15} />
        </button>
        <div className="crawl-head-text">
          <div className="crawl-title">Learn this site</div>
          <div className="crawl-sub">Knowledge Gather Agent</div>
        </div>
      </div>
      {!state ? (
        <StartForm tab={tab} crawler={crawler} disabled={chatBusy} autoStart={autoStart} />
      ) : state.phase === 'review' && crawler.saved ? (
        <Saved crawler={crawler} />
      ) : state.phase === 'review' ? (
        <Review crawler={crawler} />
      ) : state.phase === 'explored' ? (
        <Explored crawler={crawler} />
      ) : (
        <Progressing crawler={crawler} />
      )}
    </main>
  );
}

function StartForm({ tab, crawler, disabled, autoStart }: { tab: ActiveTab; crawler: Crawler; disabled: boolean; autoStart?: number }) {
  const config = useAppSelector((s) => s.config.config);
  const defaults = crawlerSettings(config.settings);
  const [url, setUrl] = useState('');
  const [limit, setLimit] = useState(defaults.pageLimit);
  const [providerId, setProviderId] = useState<string>(defaults.providerId ?? '');
  const [model, setModel] = useState(defaults.model);
  const [asking, setAsking] = useState(false);
  const existing = baseOfHost(config.knowledgeBases, url || tab.url);
  // A crawl of this site kept in storage (the panel closed or the extension reloaded while it ran): opened again first.
  const address = url.trim() || tab.url;
  const host = hostOf(/^[a-z]+:\/\//i.test(address) ? address : `https://${address}`);
  const [kept, setKept] = useState<SavedCrawl | null>(null);
  useEffect(() => {
    let live = true;
    setKept(null);
    void loadSavedCrawl(host)
      .then((k) => live && setKept(k))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [host]);
  const provider = config.providers.find((p) => p.id === providerId);
  const restricted = !url && tab.restricted;
  const ready = !disabled && !restricted && config.providers.length > 0;

  const run = (mode: LearnMode) => {
    setAsking(false);
    const overrides: Partial<CrawlerSettings> = { pageLimit: limit, providerId: providerId || null, model: providerId ? model : '' };
    void crawler.start(url.trim(), overrides, tab.id, mode);
  };
  // A site learned before: the user says whether to update its knowledge base or start it again.
  const go = () => (kept ? undefined : existing?.entries.length ? setAsking(true) : run('update'));

  // “Learn this website” said in the chat (or its suggestion): starts at once, or asks first.
  // Each request starts once — not again when this form shows anew after a crawl is closed.
  useEffect(() => {
    if (!autoStart || startedRequest === autoStart || !ready) return;
    startedRequest = autoStart;
    go();
  }, [autoStart, ready]);

  if (kept) {
    const written = kept.written?.length ?? 0;
    return (
      <div className="crawl-body">
        <Card
          icon={<BookOpen size={18} />}
          title={`A crawl of ${kept.siteName || kept.host} was kept`}
          detail={`${kept.pagesDone} pages read${written ? `, ${written} written up (${kept.proposals.length} entries)` : ''}${kept.spent ? `, ${money(kept.spent)} spent` : ''} — kept ${new Date(kept.savedAt).toLocaleString()}. Open it to carry on: nothing read or written is lost. Starting again needs it discarded first.`}
        >
          <Button
            danger
            onClick={() => {
              void deleteSavedCrawl(kept.host).then(() => setKept(null));
            }}
          >
            Discard it
          </Button>
          <Button type="primary" disabled={disabled} onClick={() => void crawler.restore(kept)}>
            Open it
          </Button>
        </Card>
      </div>
    );
  }

  if (asking && existing) {
    return (
      <div className="crawl-body">
        <Card
          icon={<BookOpen size={18} />}
          title={`${existing.name} is learned already`}
          detail={`Its knowledge base has ${existing.entries.length} entries${existing.lastCrawlAt ? `, from ${new Date(existing.lastCrawlAt).toLocaleString()}` : ''}. Learn it again?`}
        >
          <Button onClick={() => setAsking(false)}>Cancel</Button>
          <Button onClick={() => run('replace')} danger>
            Delete the old, learn fresh
          </Button>
          <Button type="primary" onClick={() => run('update')}>
            Update it
          </Button>
        </Card>
        <ul className="crawl-rules">
          <li>
            <strong>Update it:</strong> the old entries stay; the same ones get the new text and new ones are added.
          </li>
          <li>
            <strong>Delete the old:</strong> when you save, the old entries, never-click list and pages are replaced by what is learned now.
          </li>
          <li>Nothing changes until you review and save.</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="crawl-body">
      <p className="crawl-lede">
        The agent opens every page of the site in this tab, clicks its menus, tabs and buttons, and writes a knowledge base the web agent then uses here. Sign in to the site first.
      </p>
      <label className="crawl-label" htmlFor="crawl-url">
        Website
      </label>
      <Input id="crawl-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={tab.url ? `This tab: ${tab.url}` : 'https://example.com'} allowClear />
      {existing && (
        <div className="crawl-note">
          <BookOpen size={13} /> {existing.name} has a knowledge base ({existing.entries.length} entries). New entries are added, same ones updated, the rest kept.
        </div>
      )}
      <div className="crawl-row">
        <div>
          <label className="crawl-label" htmlFor="crawl-limit">
            Page limit
          </label>
          <InputNumber id="crawl-limit" min={1} max={2000} value={limit} onChange={(v) => setLimit(Number(v) || defaults.pageLimit)} style={{ width: '100%' }} />
        </div>
        <div className="crawl-grow">
          <label className="crawl-label">Model</label>
          <Select
            value={providerId}
            onChange={(v) => {
              setProviderId(v);
              setModel(config.providers.find((p) => p.id === v)?.defaultModel ?? '');
            }}
            options={[{ value: '', label: 'The agent’s model' }, ...config.providers.map((p) => ({ value: p.id, label: p.name }))]}
            style={{ width: '100%' }}
          />
        </div>
      </div>
      {provider && <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider.defaultModel || 'Model name'} aria-label="Model name" />}
      <ul className="crawl-rules">
        <li>Clicks everything — but asks you first before anything that deletes, saves, sends, pays, submits or signs out.</li>
        <li>
          Fills forms with test values (e-mail <strong>{defaults.email}</strong>) and reads every dropdown’s choices.{' '}
          {defaults.trySaving ? 'Presses a pop-up form’s save button to learn what it requires — it asks you first each time (test sites only).' : 'Never submits them.'}
        </li>
        <li>Stays on this site. After {limit} pages it asks whether to explore {defaults.extendBy} more.</li>
        {!defaults.writeWhileExploring && <li>Explores the whole site first and shows you what it read; the knowledge is written when you press Write.</li>}
        {defaults.spendLimit > 0 && <li>Writing stops and asks you when it has cost ${defaults.spendLimit.toFixed(2)}.</li>}
        <li>Saving the knowledge also makes the site and its own agent, which works only on this site.</li>
        <li>Don’t use this tab while it works — press Pause first.</li>
      </ul>
      {restricted && <div className="crawl-note warn">{tab.restricted}</div>}
      <Button type="primary" block size="large" icon={<Play size={15} />} disabled={!ready} onClick={go}>
        Start learning
      </Button>
      {!config.providers.length && <div className="crawl-note warn">Connect an AI model first (Settings → Models).</div>}
      {disabled && <div className="crawl-note">The agent is busy with a task — wait for it to finish.</div>}
      <button type="button" className="link-btn" onClick={() => void openConfiguration('/knowledge')}>
        Knowledge bases and crawler settings
      </button>
    </div>
  );
}

function Progressing({ crawler }: { crawler: Crawler }) {
  const s = crawler.state!;
  const percent = Math.min(100, Math.round((s.pagesDone / Math.max(1, s.limit)) * 100));
  const running = s.phase === 'exploring' || s.phase === 'paused';
  return (
    <div className="crawl-body">
      <div className="crawl-status">
        <span className={`crawl-phase is-${s.phase}`}>{PHASE_LABEL[s.phase]}</span>
        <span className="crawl-host">
          <Globe size={12} /> {s.host || '…'}
        </span>
      </div>
      <Progress percent={percent} size="small" format={() => `${s.pagesDone}/${s.limit}`} status={s.phase === 'failed' ? 'exception' : s.phase === 'paused' ? 'normal' : 'active'} />
      <div className="crawl-stats">
        <span>
          <strong>{s.pagesDone}</strong> pages
        </span>
        <span>
          <strong>{s.queued}</strong> waiting
        </span>
        <span>
          <strong>{s.proposals.length}</strong> entries
        </span>
        <span>
          written <strong>{s.writing.done}</strong>/{s.writing.total}
        </span>
        {s.spent > 0 && (
          <span>
            <strong>{money(s.spent)}</strong> spent
          </span>
        )}
      </div>
      <div className="crawl-doing" role="status">
        {s.doing}
        {s.current?.url && <div className="crawl-url">{s.current.url}</div>}
      </div>
      {s.prompts[0] && <PromptCard prompt={s.prompts[0]} crawler={crawler} />}
      {s.error && <div className="crawl-note warn">{s.error}</div>}
      <div className="crawl-actions">
        {s.phase === 'paused' ? (
          <Button icon={<Play size={14} />} onClick={crawler.resume}>
            Resume
          </Button>
        ) : (
          <Button icon={<Pause size={14} />} onClick={crawler.pause} disabled={s.phase !== 'exploring'}>
            Pause
          </Button>
        )}
        <Button icon={<Square size={13} />} onClick={crawler.stop} disabled={!running}>
          Stop &amp; write
        </Button>
        <Button danger type="text" icon={<X size={14} />} onClick={s.phase === 'cancelled' || s.phase === 'failed' ? crawler.reset : crawler.cancel}>
          {s.phase === 'cancelled' || s.phase === 'failed' ? 'Close' : 'Cancel'}
        </Button>
      </div>
      <ol className="crawl-log" aria-label="What the agent did">
        {[...s.log].reverse().slice(0, 25).map((l) => (
          <li key={`${l.at}-${l.text}`} className={l.tone ? `is-${l.tone}` : ''}>
            {l.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PromptCard({ prompt, crawler }: { prompt: CrawlPrompt; crawler: Crawler }) {
  const answer = crawler.answer;
  switch (prompt.kind) {
    case 'approval':
      return (
        <Card icon={<ShieldAlert size={18} />} title={`Click “${prompt.name}”?`} detail={`On ${prompt.page}. It ${prompt.why} — clicking it may change real data on the site.`}>
          <Button onClick={() => answer(prompt.id, 'skip')}>Skip</Button>
          <Button onClick={() => answer(prompt.id, 'skip-all')}>Skip all like this</Button>
          <Button type="primary" danger onClick={() => answer(prompt.id, 'allow')}>
            Click it
          </Button>
        </Card>
      );
    case 'limit':
      return (
        <Card icon={<BookOpen size={18} />} title={`Page limit reached: ${prompt.count} pages`} detail={`There is more to explore. Explore ${prompt.more} more pages, or stop and write the knowledge now?`}>
          <Button onClick={() => answer(prompt.id, 'finish')}>Finish</Button>
          <Button type="primary" onClick={() => answer(prompt.id, 'more')}>
            Explore {prompt.more} more
          </Button>
        </Card>
      );
    case 'session':
      return (
        <Card
          icon={<LogIn size={18} />}
          title={prompt.first ? 'Sign in first' : 'Signed out — the session ended'}
          detail={prompt.first ? 'This looks like a sign-in page. Sign in to the site in this tab, then press Resume.' : 'The site showed its sign-in page. Sign in again in this tab, then press Resume — the crawl carries on where it was. (This is noted in the knowledge.)'}
        >
          <Button onClick={() => answer(prompt.id, 'finish')}>Stop</Button>
          <Button type="primary" onClick={() => answer(prompt.id, 'resume')}>
            I signed in — Resume
          </Button>
        </Card>
      );
    case 'budget':
      return (
        <Card icon={<ShieldAlert size={18} />} title={`Spending limit reached: ${money(prompt.spent)}`} detail={`Writing the knowledge has cost ${money(prompt.spent)} (limit ${money(prompt.limit)}). Spend as much again to finish it, or stop here and review what was written so far?`}>
          <Button onClick={() => answer(prompt.id, 'finish')}>Stop here</Button>
          <Button type="primary" onClick={() => answer(prompt.id, 'more')}>
            Spend more
          </Button>
        </Card>
      );
    case 'model':
      return (
        <Card icon={<ShieldAlert size={18} />} title="The model is not answering" detail={`${prompt.error}. If it runs on Kaggle, check the notebook is still running.`}>
          <Button onClick={() => answer(prompt.id, 'finish')}>Skip this page</Button>
          <Button type="primary" onClick={() => answer(prompt.id, 'retry')}>
            Try again
          </Button>
        </Card>
      );
  }
}

function Card({ icon, title, detail, children }: { icon: React.ReactNode; title: string; detail: string; children: React.ReactNode }) {
  return (
    <section className="approval" role="alertdialog" aria-label={title}>
      <div className="approval-icon" aria-hidden>
        {icon}
      </div>
      <div className="approval-body">
        <div className="approval-title">{title}</div>
        <div className="approval-detail">{detail}</div>
        <div className="approval-actions crawl-wrap">{children}</div>
      </div>
    </section>
  );
}

/** After exploring: everything the agent read, page by page, for the user to read before anything is written. */
function Explored({ crawler }: { crawler: Crawler }) {
  const s = crawler.state!;
  const [open, setOpen] = useState<string | null>(null);
  const fields = s.captures.reduce((n, c) => n + c.fields.length, 0);
  const clicks = s.captures.reduce((n, c) => n + c.clicks.length, 0);
  const popups = s.captures.reduce((n, c) => n + c.dialogs.length, 0);
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ site: s.host, startUrl: s.startUrl, at: new Date().toISOString(), pages: s.captures }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${s.host}-what-was-read.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // A copy in Downloads as soon as exploring ends (once per crawl): what was read is safe outside the browser too.
  useEffect(() => {
    if (downloadedCrawls.has(s.id) || !s.captures.length) return;
    downloadedCrawls.add(s.id);
    download();
  }, [s.id]);
  return (
    <div className="crawl-body">
      <div className="crawl-status">
        <span className="crawl-phase is-review">Explored</span>
        <span className="crawl-host">
          <Globe size={12} /> {s.host}
        </span>
      </div>
      <div className="crawl-stats">
        <span>
          <strong>{s.captures.length}</strong> pages
        </span>
        <span>
          <strong>{clicks}</strong> clicks
        </span>
        <span>
          <strong>{fields}</strong> fields
        </span>
        <span>
          <strong>{popups}</strong> pop-ups
        </span>
      </div>
      {s.error && <div className="crawl-note warn">{s.error}</div>}
      <p className="crawl-lede">Nothing is written yet. Read what the agent saw on each page; when it looks right, write the knowledge base with the model ({s.model}).</p>
      <div className="crawl-actions">
        <Button type="primary" icon={<BookOpen size={14} />} onClick={crawler.write}>
          Write knowledge base
        </Button>
        <Button onClick={download}>Download what was read</Button>
        <Button danger type="text" onClick={crawler.discard}>
          Discard
        </Button>
      </div>
      <div className="crawl-group">
        <div className="crawl-group-title">
          What was read <span>{s.captures.length}</span>
        </div>
        {s.captures.map((c, i) => {
          const key = `${i}-${c.url}`;
          return (
            <div key={key} className="crawl-entry">
              <div className="crawl-entry-head">
                <button type="button" className="crawl-entry-title" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
                  {open === key ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span>
                    {i + 1}. {c.title || c.url}
                  </span>
                </button>
                <span className="pill">{c.fields.length + c.clicks.length + c.dialogs.length}</span>
              </div>
              {open === key && (
                <div className="crawl-read">
                  <div className="crawl-url">{c.url}</div>
                  {c.from && <ReadPart title="Reached from" lines={[`${c.from.title} › ${c.from.via}`]} />}
                  <ReadPart title="Headings" lines={c.headings} />
                  <ReadPart title="Fields (test values typed, never submitted)" lines={c.fields} />
                  <ReadPart title="What clicking did" lines={c.clicks} />
                  <ReadPart title="Pop-ups and drawers" lines={c.dialogs} />
                  <ReadPart title={`Controls (${c.controls.length})`} lines={c.controls} />
                  <ReadPart title="Text on the page (scrolled through)" lines={[c.text]} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReadPart({ title, lines }: { title: string; lines: string[] }) {
  if (!lines.length || !lines.some((l) => l.trim())) return null;
  return (
    <details className="crawl-part">
      <summary>{title}</summary>
      <pre>{lines.join('\n')}</pre>
    </details>
  );
}

const KIND_ORDER: KnowledgeKind[] = ['navigation', 'page', 'workflow', 'rule'];

function Review({ crawler }: { crawler: Crawler }) {
  const s = crawler.state!;
  const [open, setOpen] = useState<string | null>(null);
  const chosen = s.proposals.filter((p) => p.selected).length;
  const groups = useMemo(() => KIND_ORDER.map((k) => ({ kind: k, items: s.proposals.filter((p) => p.kind === k) })).filter((g) => g.items.length), [s.proposals]);
  const [never, setNever] = useState<Set<string>>(() => new Set(s.neverClick));
  const set = (id: string, patch: Partial<ProposedEntry>) => crawler.setProposals(s.proposals.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const all = (on: boolean) => crawler.setProposals(s.proposals.map((p) => ({ ...p, selected: on })));

  const save = () => {
    crawler.setNeverClick(s.neverClick.filter((n) => never.has(n)));
    crawler.save();
  };

  return (
    <div className="crawl-body">
      <div className="crawl-status">
        <span className="crawl-phase is-review">Review</span>
        <span className="crawl-host">
          <Globe size={12} /> {s.host} · {s.pagesDone} pages
        </span>
      </div>
      {s.error && <div className="crawl-note warn">{s.error}</div>}
      <p className="crawl-lede">Tick what goes into the knowledge base. Click an entry to read or edit it. Entries marked “update” replace the text of the same entry; everything else already there is kept.</p>
      <div className="crawl-actions">
        <Button size="small" onClick={() => all(true)}>
          Select all
        </Button>
        <Button size="small" onClick={() => all(false)}>
          Select none
        </Button>
      </div>
      {!s.proposals.length && <div className="crawl-note warn">Nothing was written. Check the model connection, then try again.</div>}
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
      {s.neverClick.length > 0 && (
        <div className="crawl-group">
          <div className="crawl-group-title">
            Never click <span>{s.neverClick.length}</span>
          </div>
          {s.neverClick.map((n) => (
            <label key={n} className="crawl-entry-head">
              <Checkbox checked={never.has(n)} onChange={(e) => setNever((cur) => (e.target.checked ? new Set([...cur, n]) : new Set([...cur].filter((x) => x !== n))))} />
              <span>“{n}”</span>
            </label>
          ))}
        </div>
      )}
      <div className="crawl-sticky">
        <Button onClick={crawler.discard}>Discard</Button>
        <Button type="primary" icon={<CheckCircle2 size={15} />} disabled={!chosen && !never.size} onClick={save}>
          Save {chosen} {chosen === 1 ? 'entry' : 'entries'}
        </Button>
      </div>
    </div>
  );
}

function Saved({ crawler }: { crawler: Crawler }) {
  const s = crawler.state!;
  const saved = crawler.saved!;
  const defaults = crawlerSettings(useAppSelector((st) => st.config.config.settings));
  return (
    <div className="crawl-body">
      <div className="crawl-done">
        <CheckCircle2 size={28} />
        <div className="crawl-title">Saved to {saved.name}</div>
        <div className="crawl-sub">
          {saved.replaced ? `${saved.replaced} old entries replaced · ` : ''}
          {saved.added} added · {saved.updated} updated. The web agent now uses this knowledge on {s.host}.
        </div>
      </div>
      {s.otherSites.length > 0 && (
        <div className="crawl-group">
          <div className="crawl-group-title">Other sites opened in a new tab</div>
          {s.otherSites.map((o) => (
            <div key={o.host} className="crawl-entry-head">
              <Globe size={13} />
              <span className="crawl-grow">{o.host}</span>
              <Button size="small" onClick={() => void crawler.learnOther(o, { pageLimit: defaults.pageLimit })}>
                Learn it
              </Button>
            </div>
          ))}
          <p className="crawl-lede">Each site gets its own knowledge base and its own page limit.</p>
        </div>
      )}
      <div className="crawl-actions">
        <Button onClick={() => void openConfiguration('/knowledge')} icon={<BookOpen size={14} />}>
          Open knowledge base
        </Button>
        <Button type="primary" onClick={crawler.reset}>
          Done
        </Button>
      </div>
    </div>
  );
}
