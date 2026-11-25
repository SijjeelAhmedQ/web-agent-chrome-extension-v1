import { App, Button, Dropdown, Input, InputNumber, Modal, Segmented, Select, Switch, Tabs } from 'antd';
import { ArrowLeft, BookOpen, ChevronDown, Download, FileJson, GraduationCap, Plus, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { hostOf, newKnowledgeBase } from '@/agent/crawler/merge';
import { knowledgeAsText } from '@/agent/planner/knowledgeText';
import { KNOWLEDGE_KINDS } from '@/agent/planner/siteKnowledge';
import { DEFAULT_ASK_WORDS, DEFAULT_SAME_SCREEN_WORDS } from '@/shared/constants/crawlerWords';
import { crawlerSettings } from '@/shared/constants/defaults';
import { normalizeKnowledgeBase } from '@/shared/storage/configStore';
import type { CrawlerSettings, KnowledgeBase, KnowledgeEntry, KnowledgeKind } from '@/shared/types/config';
import { uid } from '@/shared/utils';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';
import { FitList } from './layout';
import { EmptyBlock, FieldLabel, PageHeader, Section, SettingRow } from './parts';
import { KIND_HELP, KIND_ICON, KnowledgeEditor } from './SitesPage';

/**
 * Knowledge bases the Knowledge Gather Agent wrote by crawling websites (“Learn this site” in the side panel) —
 * one per site, apart from the Site base. While a site has one that is on, the agent reads only that one there.
 * Entries can be read, edited, switched off, added by hand and exported.
 */

const newEntry = (kind: KnowledgeKind): KnowledgeEntry => {
  const now = Date.now();
  return { id: uid('kb_'), kind, title: '', content: '', ...(kind === 'workflow' ? { trigger: '' } : {}), enabled: true, createdAt: now, updatedAt: now };
};

const when = (t?: number) => (t ? new Date(t).toLocaleString() : 'never');

export function KnowledgeBasesPage() {
  const bases = useAppSelector((s) => s.config.config.knowledgeBases ?? []);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const { message } = App.useApp();

  /** A knowledge base file — one exported here, or a file of several ({ knowledgeBases: [...] }) — added; the same id is replaced. */
  const importFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { knowledgeBases?: Partial<KnowledgeBase>[] } & Partial<KnowledgeBase>;
      const list = Array.isArray(parsed.knowledgeBases) ? parsed.knowledgeBases : Array.isArray(parsed.entries) && Array.isArray(parsed.sites) ? [parsed] : [];
      if (!list.length) throw new Error('none');
      for (const raw of list) {
        const kb = normalizeKnowledgeBase(raw);
        dispatch(configActions.upsertKnowledgeBase(kb));
        dispatch(configActions.adoptKnowledgeBase(kb.id));
      }
      message.success(`Added ${list.map((k) => `${k.name ?? 'knowledge base'} (${k.entries?.length ?? 0} entries)`).join(', ')}`);
    } catch {
      message.error("That file isn't a knowledge base.");
    }
  };

  const create = () => {
    const url = /^[a-z]+:\/\//i.test(address.trim()) ? address.trim() : `https://${address.trim()}`;
    if (!hostOf(url)) return;
    const kb = newKnowledgeBase(url);
    dispatch(configActions.upsertKnowledgeBase(kb));
    setAdding(false);
    setAddress('');
    navigate(`/knowledge/${kb.id}`);
  };

  return (
    <>
      <PageHeader
        title="Knowledge bases"
        description={
          <>
            What the Knowledge Gather Agent learned by exploring websites. Start it with <GraduationCap size={13} style={{ verticalAlign: '-2px' }} /> <strong>Learn this site</strong> in the side panel. On a site with a knowledge base here, the agent uses only this one — not the Site base’s knowledge.
          </>
        }
        actions={
          <>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = '';
              }}
            />
            <Button icon={<Upload size={16} />} onClick={() => fileInput.current?.click()}>
              Import
            </Button>
            <Button type="primary" icon={<Plus size={16} />} onClick={() => setAdding(true)}>
              New knowledge base
            </Button>
          </>
        }
      />

      {bases.length === 0 ? (
        <EmptyBlock icon={<BookOpen size={22} />} title="Nothing learned yet" text="Open a website, sign in, and press “Learn this site” in the side panel. The agent explores it and writes its knowledge base; you review it before it is saved." />
      ) : (
        <FitList className="list-card" label="Knowledge bases">
          {bases.map((kb) => (
            <div key={kb.id} className={`list-row ${kb.enabled ? '' : 'is-off'}`} role="button" tabIndex={0} onClick={() => navigate(`/knowledge/${kb.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/knowledge/${kb.id}`)}>
              <span className="list-icon">
                <BookOpen size={16} />
              </span>
              <span className="list-main">
                <span className="list-title">{kb.name}</span>
                <span className="list-desc mono">
                  {kb.sites.join(', ') || 'No address'} · last crawl {when(kb.lastCrawlAt)}
                </span>
              </span>
              <span className="list-side" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                <span className="pill">{kb.entries.length} entries</span>
                <span className="pill">{kb.pages.length} pages</span>
                <Switch size="small" checked={kb.enabled} onChange={(v) => dispatch(configActions.upsertKnowledgeBase({ ...kb, enabled: v }))} aria-label={`${kb.name} ${kb.enabled ? 'on' : 'off'}`} />
              </span>
            </div>
          ))}
        </FitList>
      )}

      <CrawlerSettingsSection />

      <Modal open={adding} title="New knowledge base" okText="Create" onOk={create} okButtonProps={{ disabled: !hostOf(/^[a-z]+:\/\//i.test(address) ? address : `https://${address}`) }} onCancel={() => setAdding(false)}>
        <FieldLabel htmlFor="kb-address">Website address</FieldLabel>
        <Input id="kb-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="app.example.com" onPressEnter={create} autoFocus />
        <p className="muted small">An empty knowledge base to fill by hand. “Learn this site” in the side panel adds to it later.</p>
      </Modal>
    </>
  );
}

function CrawlerSettingsSection() {
  const settings = useAppSelector((s) => s.config.config.settings);
  const providers = useAppSelector((s) => s.config.config.providers);
  const dispatch = useAppDispatch();
  const c = crawlerSettings(settings);
  const set = (patch: Partial<CrawlerSettings>) => dispatch(configActions.updateSettings({ crawler: { ...c, ...patch } }));
  const text = (key: keyof CrawlerSettings, label: string, description?: string) => (
    <SettingRow label={label} description={description} htmlFor={`crawl-${key}`}>
      <Input id={`crawl-${key}`} value={String(c[key] ?? '')} onChange={(e) => set({ [key]: e.target.value })} style={{ width: 240 }} />
    </SettingRow>
  );
  return (
    <Section title="Crawler settings" description="How the Knowledge Gather Agent explores. Forms are filled with these test values and never submitted; anything that deletes, saves, sends, pays or signs out always waits for your OK.">
      {text('email', 'E-mail for e-mail fields')}
      {text('name', 'Name fields')}
      {text('phone', 'Phone fields')}
      {text('password', 'Password fields')}
      {text('number', 'Number fields')}
      {text('text', 'Other text fields and search boxes')}
      <SettingRow label="Page limit" description="Pages (a new address or a new screen) before it stops and asks you.">
        <InputNumber min={1} max={2000} value={c.pageLimit} onChange={(v) => set({ pageLimit: Number(v) || 50 })} />
      </SettingRow>
      <SettingRow label="Then explore" description="Pages more each time you say carry on.">
        <InputNumber min={1} max={500} value={c.extendBy} onChange={(v) => set({ extendBy: Number(v) || 25 })} />
      </SettingRow>
      <SettingRow label="Write while exploring" description="Off: the whole site is explored first and what was read is shown to you; the model writes when you press Write. On: it writes page by page while exploring (done sooner).">
        <Switch checked={c.writeWhileExploring} onChange={(v) => set({ writeWhileExploring: v })} aria-label="Write while exploring" />
      </SettingRow>
      <SettingRow label="Spending limit for writing" description="Dollars the model may spend writing one site's knowledge before it stops and asks you (0: no limit). Writing has thinking switched off, to keep it cheap.">
        <InputNumber min={0} max={100} step={0.5} prefix="$" value={c.spendLimit} onChange={(v) => set({ spendLimit: Math.max(0, Number(v) || 0) })} />
      </SettingRow>
      <SettingRow label="Try saving forms (test sites only)" description="Presses a pop-up form's save button with the test values, to learn which fields it requires and the errors it shows. It can add test records, so use it only on a test site. Each press still asks you first.">
        <Switch checked={c.trySaving} onChange={(v) => set({ trySaving: v })} aria-label="Try saving forms" />
      </SettingRow>
      <SettingRow label="Clicks per page" description="Most buttons, tabs and menus tried on one page.">
        <InputNumber min={0} max={200} value={c.clicksPerPage} onChange={(v) => set({ clicksPerPage: Number(v) ?? 60 })} />
      </SettingRow>
      <SettingRow
        stacked
        label="Ask before clicking"
        description="Controls whose name has one of these words wait for your OK (delete, save, send, pay, sign out…). Add the words your sites use, in any language. Submit buttons and sign-out links always ask."
      >
        <WordList value={c.askWords} fallback={DEFAULT_ASK_WORDS} onChange={(askWords) => set({ askWords })} />
      </SettingRow>
      <SettingRow
        stacked
        label="Not a new screen"
        description="Controls named with one of these words only move through the same list or calendar, or fold a panel (next, week, toggle sidebar…). Clicking them is not counted as a new page."
      >
        <WordList value={c.sameScreenWords} fallback={DEFAULT_SAME_SCREEN_WORDS} onChange={(sameScreenWords) => set({ sameScreenWords })} />
      </SettingRow>
      <SettingRow label="Model that writes the knowledge" description="By default the agent’s own model. A stronger model writes better rules and workflows.">
        <div className="row-gap">
          <Select
            value={c.providerId ?? ''}
            onChange={(v) => set({ providerId: v || null, model: providers.find((p) => p.id === v)?.defaultModel ?? '' })}
            options={[{ value: '', label: 'The agent’s model' }, ...providers.map((p) => ({ value: p.id, label: p.name }))]}
            style={{ width: 200 }}
          />
          {c.providerId && <Input value={c.model} onChange={(e) => set({ model: e.target.value })} placeholder="Model" style={{ width: 200 }} aria-label="Model" />}
        </div>
      </SettingRow>
    </Section>
  );
}

function WordList({ value, fallback, onChange }: { value: string[]; fallback: string[]; onChange: (v: string[]) => void }) {
  const same = value.length === fallback.length && value.every((w, i) => w === fallback[i]);
  return (
    <div className="form-stack" style={{ width: '100%' }}>
      <Select mode="tags" value={value} onChange={(v: string[]) => onChange([...new Set(v.map((x) => x.trim()).filter(Boolean))])} tokenSeparators={[',']} style={{ width: '100%' }} open={false} placeholder="Type a word, then Enter" />
      {!same && (
        <Button size="small" onClick={() => onChange(fallback)} style={{ alignSelf: 'flex-start' }}>
          Back to the default words
        </Button>
      )}
    </div>
  );
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function KnowledgeBaseDetailPage() {
  const { baseId } = useParams();
  const kb = useAppSelector((s) => (s.config.config.knowledgeBases ?? []).find((k) => k.id === baseId));
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { modal } = App.useApp();
  const [tab, setTab] = useState('entries');

  if (!kb) {
    return <EmptyBlock icon={<BookOpen size={22} />} title="This knowledge base isn’t here anymore" text="It may have been deleted." action={<Button onClick={() => navigate('/knowledge')}>Back</Button>} />;
  }
  const update = (patch: Partial<KnowledgeBase>) => dispatch(configActions.upsertKnowledgeBase({ ...kb, ...patch }));
  const file = kb.name.replace(/[^\w.-]+/g, '-');

  return (
    <>
      <button type="button" className="link-btn back-link" onClick={() => navigate('/knowledge')}>
        <ArrowLeft size={14} /> Knowledge bases
      </button>
      <header className="page-head site-head">
        <div className="site-head-main">
          <div className="page-head-text">
            <h1>{kb.name}</h1>
            <p className="mono">
              {kb.sites.join(', ') || 'No address'} · {kb.entries.length} entries · last crawl {when(kb.lastCrawlAt)}
            </p>
          </div>
        </div>
        <div className="page-head-actions">
          <label className="row-gap align-center small">
            <Switch checked={kb.enabled} onChange={(v) => update({ enabled: v })} aria-label="Use this knowledge base" />
            {kb.enabled ? 'On' : 'Off'}
          </label>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'md', icon: <Download size={14} />, label: 'Markdown (.md)' },
                { key: 'json', icon: <FileJson size={14} />, label: 'JSON (.json)' },
              ],
              onClick: ({ key }) =>
                key === 'md'
                  ? download(`${file}-knowledge.md`, `# ${kb.name}\n\nSites: ${kb.sites.join(', ')}\n\n${knowledgeAsText({ knowledge: kb.entries, neverClick: kb.neverClick })}`, 'text/markdown')
                  : download(`${file}-knowledge.json`, JSON.stringify(kb, null, 2), 'application/json'),
            }}
          >
            <Button icon={<Download size={15} />}>
              Export <ChevronDown size={14} />
            </Button>
          </Dropdown>
          <Button
            danger
            type="text"
            icon={<Trash2 size={15} />}
            onClick={() =>
              modal.confirm({
                title: `Delete the knowledge base of ${kb.name}?`,
                content: 'Its entries are deleted. On this site the agent goes back to the Site base’s knowledge.',
                okText: 'Delete',
                okButtonProps: { danger: true },
                onOk: () => {
                  dispatch(configActions.deleteKnowledgeBase(kb.id));
                  navigate('/knowledge');
                },
              })
            }
          >
            Delete
          </Button>
        </div>
      </header>

      <Tabs
        className="site-tabs tabs-fill fill"
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'entries', label: `Knowledge (${kb.entries.length})`, children: <EntriesTab kb={kb} /> },
          { key: 'never', label: `Never click (${kb.neverClick.length})`, children: <NeverTab kb={kb} update={update} /> },
          { key: 'pages', label: `Pages (${kb.pages.length})`, children: <PagesTab kb={kb} /> },
          { key: 'settings', label: 'Settings', children: <SettingsTab kb={kb} update={update} /> },
        ]}
      />
    </>
  );
}

function EntriesTab({ kb }: { kb: KnowledgeBase }) {
  const dispatch = useAppDispatch();
  const { modal, message } = App.useApp();
  const [filter, setFilter] = useState<KnowledgeKind | 'all'>('all');
  const [editing, setEditing] = useState<{ entry: KnowledgeEntry; isNew: boolean } | null>(null);
  const kinds = Object.keys(KNOWLEDGE_KINDS) as KnowledgeKind[];
  const shown = kb.entries.filter((k) => filter === 'all' || k.kind === filter);

  return (
    <>
      <div className="tab-toolbar">
        <Segmented<KnowledgeKind | 'all'> value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, ...kinds.map((k) => ({ value: k, label: KNOWLEDGE_KINDS[k].label }))]} />
        <span className="spacer" />
        <Dropdown
          trigger={['click']}
          menu={{
            items: kinds.map((k) => {
              const Icon = KIND_ICON[k];
              return { key: k, icon: <Icon size={14} />, label: <span className="menu-two-line"><strong>{KNOWLEDGE_KINDS[k].label}</strong><span>{KIND_HELP[k]}</span></span> };
            }),
            onClick: ({ key }) => setEditing({ entry: newEntry(key as KnowledgeKind), isNew: true }),
          }}
        >
          <Button type="primary" icon={<Plus size={15} />}>
            Add knowledge <ChevronDown size={14} />
          </Button>
        </Dropdown>
      </div>
      {shown.length === 0 ? (
        <EmptyBlock icon={<BookOpen size={22} />} title="No entries" text="Crawl the site with “Learn this site”, or add what you know by hand." action={<Button type="primary" onClick={() => setEditing({ entry: newEntry(filter === 'all' ? 'rule' : filter), isNew: true })}>Add an entry</Button>} />
      ) : (
        <FitList className="list-card" label="Knowledge">
          {shown.map((k) => {
            const Icon = KIND_ICON[k.kind];
            return (
              <div key={k.id} className={`list-row ${k.enabled ? '' : 'is-off'}`} role="button" tabIndex={0} onClick={() => setEditing({ entry: k, isNew: false })} onKeyDown={(e) => e.key === 'Enter' && setEditing({ entry: k, isNew: false })}>
                <span className="list-icon">
                  <Icon size={16} />
                </span>
                <span className="list-main">
                  <span className="list-title">{k.title || 'Untitled'}</span>
                  <span className="list-desc">{k.kind === 'workflow' && k.trigger ? `For: “${k.trigger}”` : k.content.split('\n')[0]}</span>
                </span>
                <span className="list-side" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <span className="pill">{KNOWLEDGE_KINDS[k.kind].label}</span>
                  <Switch size="small" checked={k.enabled} onChange={(v) => dispatch(configActions.upsertBaseEntry({ baseId: kb.id, entry: { ...k, enabled: v } }))} aria-label={`${k.title} ${k.enabled ? 'on' : 'off'}`} />
                </span>
              </div>
            );
          })}
        </FitList>
      )}
      <KnowledgeEditor
        value={editing}
        siteName={kb.name}
        onClose={() => setEditing(null)}
        onSave={(entry) => {
          dispatch(configActions.upsertBaseEntry({ baseId: kb.id, entry }));
          message.success(editing?.isNew ? 'Added to the knowledge base' : 'Changes saved');
          setEditing(null);
        }}
        onDelete={(entry) =>
          modal.confirm({
            title: `Delete “${entry.title || 'this entry'}”?`,
            okText: 'Delete',
            okButtonProps: { danger: true },
            onOk: () => {
              dispatch(configActions.deleteBaseEntry({ baseId: kb.id, entryId: entry.id }));
              setEditing(null);
            },
          })
        }
      />
    </>
  );
}

function NeverTab({ kb, update }: { kb: KnowledgeBase; update: (p: Partial<KnowledgeBase>) => void }) {
  return (
    <div className="form-stack">
      <p className="muted tab-lede">Exact names of buttons the agent never clicks on this site — it leaves them to you. Learned while crawling; add or remove names here.</p>
      <Select mode="tags" value={kb.neverClick} onChange={(v: string[]) => update({ neverClick: v.map((x) => x.trim()).filter(Boolean) })} placeholder="e.g. Delete patient" tokenSeparators={[',']} style={{ width: '100%' }} open={false} />
    </div>
  );
}

function PagesTab({ kb }: { kb: KnowledgeBase }) {
  if (!kb.pages.length) return <EmptyBlock icon={<BookOpen size={22} />} title="No pages yet" text="The pages a crawl visits are listed here." />;
  return (
    <FitList className="list-card" label="Pages" estimate={52}>
      {kb.pages.map((p) => (
        <div key={p.url} className="list-row">
          <span className="list-main">
            <span className="list-title">{p.title || p.template}</span>
            <span className="list-desc mono">{p.url}</span>
          </span>
        </div>
      ))}
    </FitList>
  );
}

function SettingsTab({ kb, update }: { kb: KnowledgeBase; update: (p: Partial<KnowledgeBase>) => void }) {
  return (
    <div className="form-stack">
      <div>
        <FieldLabel htmlFor="kb-name">Name</FieldLabel>
        <Input id="kb-name" value={kb.name} onChange={(e) => update({ name: e.target.value })} />
      </div>
      <div>
        <FieldLabel hint="The agent uses this knowledge on these addresses">Addresses</FieldLabel>
        <Select mode="tags" value={kb.sites} onChange={(v: string[]) => update({ sites: v.map((h) => h.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean) })} tokenSeparators={[',', ' ']} style={{ width: '100%' }} open={false} />
      </div>
      <div>
        <FieldLabel>Crawl started at</FieldLabel>
        <div className="mono small">{kb.startUrl || '—'}</div>
      </div>
    </div>
  );
}
