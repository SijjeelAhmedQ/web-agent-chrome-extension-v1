import { App, Button, Checkbox, Dropdown, Input, Modal, Segmented, Select, Switch, Tabs } from 'antd';
import { ArrowLeft, BookOpen, ChevronDown, ClipboardPaste, Compass, Copy, FileText, Globe, ListOrdered, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2, Webhook, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { knowledgeAsText, mergeKnowledge, parseKnowledgeText } from '@/agent/planner/knowledgeText';
import { KNOWLEDGE_KINDS, knowledgeBudget, knowledgeSection } from '@/agent/planner/siteKnowledge';
import { contextWindowOf } from '@/agent/runtime/agentRun';
import { BUILT_IN_TOOLS, CUSTOM_PREFIX } from '@/shared/constants/tools';
import { SITE_TEMPLATES, type SiteTemplate } from '@/shared/constants/templates';
import { knowledgeBaseFor } from '@/agent/crawler/merge';
import type { AgentConfig, CustomToolConfig, KnowledgeBase, KnowledgeEntry, KnowledgeKind, SiteProfile, SkillConfig } from '@/shared/types/config';
import { uid } from '@/shared/utils';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';
import { AgentAvatar } from '../../components/Brand';
import { NamedIcon } from '../../components/icons';
import { AvatarStack, EmptyBlock, FieldLabel, PageHeader, Section } from './parts';
import { SkillEditor } from './SkillsPage';
import { CustomToolEditor } from './ToolsPage';
import { FitList, SectionGroup } from './layout';

export const KIND_ICON: Record<KnowledgeKind, typeof Compass> = { rule: ShieldCheck, navigation: Compass, page: FileText, workflow: ListOrdered };
export const KIND_HELP: Record<KnowledgeKind, string> = {
  rule: 'Always or never do something here — e.g. “Open a patient by clicking the name, never an icon.”',
  navigation: 'Where things are and how to get there — menus, sub-menus, direct addresses.',
  page: 'What a page, column, icon or button means.',
  workflow: 'How to do a task step by step, for requests like an example. The agent follows it when a request matches.',
};
const COLORS = ['#0e7490', '#10b981', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#64748b'];

const newSite = (name = '', sites: string[] = []): SiteProfile => {
  const now = Date.now();
  return { id: uid('site_'), name, description: '', color: COLORS[Math.floor(Math.random() * COLORS.length)], sites, enabled: true, providerId: null, model: '', agentIds: [], skillIds: [], disabledSkillIds: [], customToolIds: [], disabledToolIds: [], neverClick: [], askBefore: [], askPopups: [], knowledge: [], createdAt: now, updatedAt: now };
};

const newEntry = (kind: KnowledgeKind): KnowledgeEntry => {
  const now = Date.now();
  return { id: uid('kb_'), kind, title: '', content: '', ...(kind === 'workflow' ? { trigger: '' } : {}), enabled: true, createdAt: now, updatedAt: now };
};

const cleanHosts = (hosts: string[]) =>
  hosts
    .map((h) => h.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean);

function SiteMark({ site, size = 34 }: { site: Pick<SiteProfile, 'color' | 'name'>; size?: number }) {
  return (
    <span className="site-mark" style={{ width: size, height: size, background: `${site.color}1f`, color: site.color }} aria-hidden>
      <Globe size={Math.round(size * 0.5)} />
    </span>
  );
}

// ---------- List of sites ----------

/** The learned knowledge base the agent uses on this site in place of the site's own knowledge (when it has entries).*/
const learnedFor = (bases: KnowledgeBase[] | undefined, site: SiteProfile) => site.sites[0] ? knowledgeBaseFor({ knowledgeBases: bases ?? [] }, `https://${site.sites[0].replace(/^\*\./, '')}/`) : undefined;

export function SitesPage() {
  const { sites, agents, knowledgeBases } = useAppSelector((s) => s.config.config);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [creating, setCreating] = useState<{ template?: SiteTemplate } | null>(null);

  return (
    <>
      <PageHeader
        title="Sites"
        description="Site-based setup: what the agent knows about one website, and the skills, tools and model it uses there. It switches on by itself when the agent’s tab is on that site — on top of the agent’s own setup."
        actions={
          <>
            <Dropdown
              trigger={['click']}
              menu={{
                items: SITE_TEMPLATES.map((t) => ({ key: t.key, label: <span className="menu-two-line"><strong>{t.name}</strong><span>{t.description}</span></span> })),
                onClick: ({ key }) => setCreating({ template: SITE_TEMPLATES.find((t) => t.key === key) }),
              }}
            >
              <Button>
                From a template <ChevronDown size={14} />
              </Button>
            </Dropdown>
            <Button type="primary" icon={<Plus size={16} />} onClick={() => setCreating({})}>
              New site
            </Button>
          </>
        }
      />

      {sites.length === 0 ? (
        <EmptyBlock
          icon={<Globe size={22} />}
          title="No sites yet"
          text="Add a website and teach the agent how it works — its menus, pages and the steps for your common tasks."
          action={
            <Button type="primary" onClick={() => setCreating({})}>
              Add a site
            </Button>
          }
        />
      ) : (
        <FitList className="list-card" label="Sites">
          {sites.map((site) => (
            <div key={site.id} className={`list-row site-row ${site.enabled ? '' : 'is-off'}`} role="button" tabIndex={0} onClick={() => navigate(`/sites/${site.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/sites/${site.id}`)}>
              <SiteMark site={site} />
              <span className="list-main">
                <span className="list-title">{site.name}</span>
                <span className="list-desc mono">{site.sites.length ? site.sites.join(', ') : 'No address yet — add one to switch it on'}</span>
              </span>
              <span className="list-side" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                {site.agentIds.length > 0 && <AvatarStack agents={agents.filter((a) => site.agentIds.includes(a.id))} max={3} />}
                <span className="pill">
                  <BookOpen size={11} /> {learnedFor(knowledgeBases, site)?.entries.length ?? site.knowledge.length}
                </span>
                <span className="pill">
                  <Sparkles size={11} /> {site.skillIds.length}
                </span>
                <span className="pill">
                  <Webhook size={11} /> {site.customToolIds.length}
                </span>
                {!site.sites.length && <span className="pill warning">Needs an address</span>}
                <Switch size="small" checked={site.enabled} onChange={(v) => dispatch(configActions.upsertSite({ ...site, enabled: v }))} aria-label={`${site.name} ${site.enabled ? 'on' : 'off'}`} />
              </span>
            </div>
          ))}
        </FitList>
      )}

      <NewSiteModal
        value={creating}
        onClose={() => setCreating(null)}
        onCreate={(site) => {
          dispatch(configActions.upsertSite(site));
          setCreating(null);
          navigate(`/sites/${site.id}`);
        }}
      />
    </>
  );
}

function NewSiteModal({ value, onClose, onCreate }: { value: { template?: SiteTemplate } | null; onClose: () => void; onCreate: (site: SiteProfile) => void }) {
  const [name, setName] = useState('');
  const [hosts, setHosts] = useState<string[]>([]);
  useEffect(() => {
    if (!value) return;
    const t = value.template?.make();
    setName(t?.name ?? '');
    setHosts(t?.sites ?? []);
  }, [value]);
  if (!value) return null;
  const t = value.template;
  const ok = name.trim() && cleanHosts(hosts).length > 0;
  return (
    <Modal
      open
      onCancel={onClose}
      title={t ? `Add ${t.name}` : 'New site'}
      okText="Create"
      okButtonProps={{ disabled: !ok }}
      onOk={() => {
        const base = t ? t.make() : newSite();
        onCreate({ ...base, name: name.trim(), sites: cleanHosts(hosts) });
      }}
    >
      <div className="form-stack">
        {t && <p className="muted">Comes with {t.make().knowledge.length} knowledge entries you can edit.</p>}
        <div>
          <FieldLabel htmlFor="site-name">Name</FieldLabel>
          <Input id="site-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Indici" autoFocus />
        </div>
        <div>
          <FieldLabel hint="Copy it from the address bar">Address</FieldLabel>
          <Select
            mode="tags"
            style={{ width: '100%' }}
            value={hosts}
            onChange={setHosts}
            tokenSeparators={[',', ' ']}
            placeholder={t?.needsAddress ? 'Your practice’s address, e.g. clinic.indici.co.nz' : 'e.g. localhost:5173 or *.example.com'}
            open={false}
            suffixIcon={null}
            aria-label="Site addresses"
          />
          <div className="field-help">One or more. A * matches any part, e.g. *.indici.co.nz.</div>
        </div>
      </div>
    </Modal>
  );
}

// ---------- One site ----------

export function SiteDetailPage() {
  const { siteId } = useParams();
  const site = useAppSelector((s) => s.config.config.sites.find((x) => x.id === siteId));
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { modal } = App.useApp();
  const [tab, setTab] = useState('knowledge');
  const knowledgeBases = useAppSelector((s) => s.config.config.knowledgeBases);

  if (!site) {
    return (
      <EmptyBlock
        icon={<Globe size={22} />}
        title="This site isn’t here anymore"
        text="It may have been deleted."
        action={<Button onClick={() => navigate('/sites')}>Back to sites</Button>}
      />
    );
  }
  const update = (patch: Partial<SiteProfile>) => dispatch(configActions.upsertSite({ ...site, ...patch }));

  return (
    <>
      <button type="button" className="link-btn back-link" onClick={() => navigate('/sites')}>
        <ArrowLeft size={14} /> Sites
      </button>
      <header className="page-head site-head">
        <div className="site-head-main">
          <SiteMark site={site} size={44} />
          <div className="page-head-text">
            <h1>{site.name}</h1>
            <p className="mono">{site.sites.length ? site.sites.join(', ') : 'No address yet'}</p>
          </div>
        </div>
        <div className="page-head-actions">
          <label className="row-gap align-center small">
            <Switch checked={site.enabled} onChange={(v) => update({ enabled: v })} aria-label="Use this site setup" />
            {site.enabled ? 'On' : 'Off'}
          </label>
          <Button
            danger
            type="text"
            icon={<Trash2 size={15} />}
            onClick={() =>
              modal.confirm({
                title: `Delete ${site.name}?`,
                content: 'Its knowledge, and the skills and tools that only this site uses, are deleted too.',
                okText: 'Delete',
                okButtonProps: { danger: true },
                onOk: () => {
                  dispatch(configActions.deleteSite(site.id));
                  navigate('/sites');
                },
              })
            }
          >
            Delete
          </Button>
        </div>
      </header>
      {!site.sites.length && <div className="inline-note warning">Add the site’s address under Settings — until then this setup is never used.</div>}

      <Tabs
        className="site-tabs tabs-fill fill"
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'knowledge', label: `Knowledge base (${learnedFor(knowledgeBases, site)?.enabled ? learnedFor(knowledgeBases, site)!.entries.length : site.knowledge.length})`, children: <KnowledgeTab site={site} /> },
          { key: 'agents', label: `Agents (${site.agentIds.length})`, children: <AgentsTab site={site} /> },
          { key: 'skills', label: `Skills (${site.skillIds.length})`, children: <SkillsTab site={site} /> },
          { key: 'tools', label: 'Tools', children: <ToolsTab site={site} /> },
          { key: 'model', label: 'Model', children: <ModelTab site={site} update={update} /> },
          { key: 'settings', label: 'Settings', children: <SettingsTab site={site} update={update} /> },
          { key: 'preview', label: 'Preview', children: <PreviewTab site={site} /> },
        ]}
      />
    </>
  );
}

// ---------- Knowledge ----------

function KnowledgeTab({ site }: { site: SiteProfile }) {
  const dispatch = useAppDispatch();
  const { modal, message } = App.useApp();
  const [filter, setFilter] = useState<KnowledgeKind | 'all'>('all');
  const [editing, setEditing] = useState<{ entry: KnowledgeEntry; isNew: boolean } | null>(null);
  const kinds = Object.keys(KNOWLEDGE_KINDS) as KnowledgeKind[];
  const navigate = useNavigate();
  const learned = learnedFor(useAppSelector((s) => s.config.config.knowledgeBases), site);
  // What the agent uses here: the learned knowledge base when it is on (its entries listed, added to and edited
  // here as the site's own are), else the entries written for the site.
  const useLearned = !!learned?.enabled;
  const entries = useLearned ? learned!.entries : site.knowledge;
  const shown = entries.filter((k) => filter === 'all' || k.kind === filter);
  const saveEntry = (entry: KnowledgeEntry) => {
    if (!useLearned) return dispatch(configActions.upsertKnowledge({ siteId: site.id, entry }));
    const now = Date.now();
    const there = learned!.entries.some((e) => e.id === entry.id);
    const next = { ...entry, updatedAt: now, createdAt: entry.createdAt || now };
    dispatch(configActions.upsertKnowledgeBase({ ...learned!, entries: there ? learned!.entries.map((e) => (e.id === entry.id ? next : e)) : [...learned!.entries, next], updatedAt: now }));
  };
  const deleteEntry = (entry: KnowledgeEntry) => {
    if (!useLearned) return dispatch(configActions.deleteKnowledge({ siteId: site.id, entryId: entry.id }));
    dispatch(configActions.upsertKnowledgeBase({ ...learned!, entries: learned!.entries.filter((e) => e.id !== entry.id), updatedAt: Date.now() }));
  };

  return (
    <>
      {learned && (
        <div className="inline-note">
          {learned.enabled
            ? `These are the ${learned.entries.length} entries the Knowledge Gather Agent learned here (“${learned.name}”) — the agent uses them. What you add or change here is saved there.`
            : `“${learned.name}” (${learned.entries.length} learned entries) is switched off — the agent uses the entries below.`}{' '}
          <Button size="small" icon={<BookOpen size={13} />} onClick={() => navigate(`/knowledge/${learned.id}`)}>
            Open the learned knowledge
          </Button>
        </div>
      )}
      <div className="tab-toolbar">
        <Segmented<KnowledgeKind | 'all'>
          value={filter}
          onChange={setFilter}
          options={[{ value: 'all', label: 'All' }, ...kinds.map((k) => ({ value: k, label: KNOWLEDGE_KINDS[k].label }))]}
        />
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
        <EmptyBlock
          icon={<BookOpen size={22} />}
          title={filter === 'all' ? 'Nothing taught yet' : `No ${KNOWLEDGE_KINDS[filter].label.toLowerCase()} entries`}
          text="Write down how this site works — especially anything the agent got wrong. Workflows (an example request with its steps) help most."
          action={
            <Button type="primary" onClick={() => setEditing({ entry: newEntry(filter === 'all' ? 'workflow' : filter), isNew: true })}>
              Add {filter === 'all' ? 'a workflow' : KNOWLEDGE_KINDS[filter].label.toLowerCase()}
            </Button>
          }
        />
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
                  <Switch size="small" checked={k.enabled} onChange={(v) => saveEntry({ ...k, enabled: v })} aria-label={`${k.title} ${k.enabled ? 'on' : 'off'}`} />
                </span>
              </div>
            );
          })}
        </FitList>
      )}

      <KnowledgeEditor
        value={editing}
        siteName={site.name}
        onClose={() => setEditing(null)}
        onSave={(entry) => {
          saveEntry(entry);
          message.success(editing?.isNew ? 'Added to the knowledge base' : 'Changes saved');
          setEditing(null);
        }}
        onDelete={(entry) =>
          modal.confirm({
            title: `Delete “${entry.title || 'this entry'}”?`,
            okText: 'Delete',
            okButtonProps: { danger: true },
            onOk: () => {
              deleteEntry(entry);
              setEditing(null);
            },
          })
        }
      />
    </>
  );
}

export function KnowledgeEditor({
  value,
  siteName,
  onClose,
  onSave,
  onDelete,
}: {
  value: { entry: KnowledgeEntry; isNew: boolean } | null;
  siteName: string;
  onClose: () => void;
  onSave: (entry: KnowledgeEntry) => void;
  onDelete: (entry: KnowledgeEntry) => void;
}) {
  const [draft, setDraft] = useState<KnowledgeEntry | null>(null);
  useEffect(() => {
    if (value) setDraft(structuredClone(value.entry));
  }, [value]);
  if (!value || !draft) return null;
  const set = (patch: Partial<KnowledgeEntry>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const workflow = draft.kind === 'workflow';
  const ok = draft.title.trim() && draft.content.trim();

  return (
    <Modal
      open
      width={680}
      onCancel={onClose}
      title={value.isNew ? `New ${KNOWLEDGE_KINDS[draft.kind].label.toLowerCase()} · ${siteName}` : draft.title || 'Knowledge'}
      footer={
        <div className="drawer-foot">
          {!value.isNew && (
            <Button danger type="text" icon={<Trash2 size={14} />} onClick={() => onDelete(value.entry)}>
              Delete
            </Button>
          )}
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" disabled={!ok} onClick={() => onSave({ ...draft, title: draft.title.trim(), content: draft.content.trim(), ...(workflow ? { trigger: draft.trigger?.trim() ?? '' } : {}) })}>
            {value.isNew ? 'Add' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="form-stack">
        <div>
          <FieldLabel>Kind</FieldLabel>
          <Segmented<KnowledgeKind>
            value={draft.kind}
            onChange={(kind) => set({ kind })}
            options={(Object.keys(KNOWLEDGE_KINDS) as KnowledgeKind[]).map((k) => ({ value: k, label: KNOWLEDGE_KINDS[k].label }))}
          />
          <div className="field-help">{KIND_HELP[draft.kind]}</div>
        </div>
        <div>
          <FieldLabel htmlFor="kb-title">Title</FieldLabel>
          <Input
            id="kb-title"
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder={workflow ? 'e.g. Select a patient from Search & List' : 'e.g. Top menus open on hover'}
            maxLength={100}
            autoFocus={value.isNew}
          />
        </div>
        {workflow && (
          <div>
            <FieldLabel htmlFor="kb-trigger" hint="Helps the agent find this workflow">
              Example request
            </FieldLabel>
            <Input id="kb-trigger" value={draft.trigger ?? ''} onChange={(e) => set({ trigger: e.target.value })} placeholder="e.g. Goto Patients and select Search & List and select Arya Stark" />
          </div>
        )}
        <div>
          <FieldLabel htmlFor="kb-content" hint="Markdown">
            {workflow ? 'Steps' : 'What the agent should know'}
          </FieldLabel>
          <Input.TextArea
            id="kb-content"
            className="mono-area"
            value={draft.content}
            onChange={(e) => set({ content: e.target.value })}
            autoSize={{ minRows: workflow ? 8 : 5, maxRows: 22 }}
            placeholder={
              workflow
                ? '1. Hover Patients in the top bar, click "Search & List".\n2. Type the name into Patient Name, click Search.\n3. Click the patient\'s name (not an icon).\n4. The consult opens in a new tab — tell the user which patient.'
                : 'e.g. The Patients menu opens when the mouse is over it; clicking it does nothing.'
            }
          />
        </div>
        <label className="row-gap align-center">
          <Switch size="small" checked={draft.enabled} onChange={(v) => set({ enabled: v })} aria-label="Use this entry" /> Use this entry
        </label>
      </div>
    </Modal>
  );
}

// ---------- Agents ----------

/** Turning a skill or tool on/off for this site only. */
function useSiteSwitches(site: SiteProfile) {
  const dispatch = useAppDispatch();
  const update = (patch: Partial<SiteProfile>) => dispatch(configActions.upsertSite({ ...site, ...patch }));
  const toggle = (list: string[], ids: string[], on: boolean) => (on ? list.filter((id) => !ids.includes(id)) : [...new Set([...list, ...ids])]);
  return {
    update,
    skillOn: (id: string) => !site.disabledSkillIds.includes(id),
    toolOn: (key: string) => !site.disabledToolIds.includes(key),
    setSkills: (ids: string[], on: boolean) => update({ disabledSkillIds: toggle(site.disabledSkillIds, ids, on) }),
    setTools: (keys: string[], on: boolean) => update({ disabledToolIds: toggle(site.disabledToolIds, keys, on) }),
  };
}

const toolLabel = (key: string, customTools: CustomToolConfig[]) => {
  if (key.startsWith(CUSTOM_PREFIX)) {
    const t = customTools.find((c) => `${CUSTOM_PREFIX}${c.id}` === key);
    return t ? t.label || t.name : null;
  }
  return BUILT_IN_TOOLS.find((t) => t.id === key)?.label ?? null;
};

function AgentsTab({ site }: { site: SiteProfile }) {
  const { agents } = useAppSelector((s) => s.config.config);
  const { update } = useSiteSwitches(site);
  // One agent's switches are open at a time; the first chosen agent's to begin with.
  const [expanded, setExpanded] = useState<string | null>(site.agentIds[0] ?? null);
  const select = (agent: AgentConfig, on: boolean) =>
    on
      ? // Its skills and tools come on here — any that were switched off on this site come back on.
        (setExpanded(agent.id),
        update({
          agentIds: [...site.agentIds, agent.id],
          disabledSkillIds: site.disabledSkillIds.filter((id) => !agent.skillIds.includes(id)),
          disabledToolIds: site.disabledToolIds.filter((id) => !agent.toolIds.includes(id)),
        }))
      : update({ agentIds: site.agentIds.filter((id) => id !== agent.id) });

  return (
    <>
      <p className="muted tab-lede">
        Agents that work on {site.name}. The first one opens by itself in the side panel when you are on this site. Choosing an agent switches its skills and tools on here — turn any of them off just for this site.
      </p>
      <div className="tab-toolbar">
        <Button size="small" onClick={() => update({ agentIds: agents.map((a) => a.id), disabledSkillIds: [], disabledToolIds: [] })}>
          Select all
        </Button>
        <Button size="small" onClick={() => update({ agentIds: [] })} disabled={!site.agentIds.length}>
          Clear
        </Button>
      </div>
      <FitList className="list-card" label="Agents" estimate={60}>
        {agents.map((a) => {
          const on = site.agentIds.includes(a.id);
          const first = site.agentIds[0] === a.id;
          const open = on && expanded === a.id;
          return (
            <div key={a.id} className={`site-agent ${on ? 'on' : ''}`}>
              <div className="site-agent-head">
                <Checkbox checked={on} onChange={(e) => select(a, e.target.checked)} aria-label={`${a.name} works on ${site.name}`} />
                <AgentAvatar avatar={a.avatar} size={30} />
                <span className="list-main">
                  <span className="list-title">{a.name}</span>
                  <span className="list-desc">{a.description || `${a.skillIds.length} skills · ${a.toolIds.length} tools`}</span>
                </span>
                {on &&
                  (first ? (
                    <span className="pill success">Opens here by default</span>
                  ) : (
                    <Button size="small" type="text" onClick={() => update({ agentIds: [a.id, ...site.agentIds.filter((x) => x !== a.id)] })}>
                      Make default
                    </Button>
                  ))}
                {on && (
                  <button
                    type="button"
                    className="site-agent-toggle"
                    aria-expanded={open}
                    aria-controls={`site-agent-${a.id}`}
                    onClick={() => setExpanded(open ? null : a.id)}
                  >
                    Skills &amp; tools <ChevronDown size={14} className={`chev ${open ? 'open' : ''}`} aria-hidden />
                  </button>
                )}
              </div>
              {open && (
                <div id={`site-agent-${a.id}`}>
                  <AgentOnSite site={site} agent={a} />
                </div>
              )}
            </div>
          );
        })}
      </FitList>
    </>
  );
}

/** One agent's skills and tools on this site, each with an on/off switch. */
function AgentOnSite({ site, agent }: { site: SiteProfile; agent: AgentConfig }) {
  const { skills, customTools } = useAppSelector((s) => s.config.config);
  const sw = useSiteSwitches(site);
  const agentSkills = agent.skillIds.map((id) => skills.find((s) => s.id === id)).filter((s): s is SkillConfig => !!s);
  const agentTools = agent.toolIds.map((key) => ({ key, label: toolLabel(key, customTools) })).filter((t): t is { key: string; label: string } => !!t.label);
  const allKeys = agentTools.map((t) => t.key);
  const allSkills = agentSkills.map((s) => s.id);

  return (
    <div className="site-agent-body">
      <div className="site-agent-col">
        <div className="site-agent-col-head">
          <span>Skills on {site.name}</span>
          {agentSkills.length > 0 && (
            <span className="row-gap">
              <button type="button" className="link-btn small" onClick={() => sw.setSkills(allSkills, true)}>
                All on
              </button>
              <button type="button" className="link-btn small" onClick={() => sw.setSkills(allSkills, false)}>
                All off
              </button>
            </span>
          )}
        </div>
        {agentSkills.length === 0 && <div className="muted small">This agent has no skills.</div>}
        {agentSkills.map((s) => (
          <label key={s.id} className="switch-row">
            <Switch size="small" checked={sw.skillOn(s.id)} onChange={(v) => sw.setSkills([s.id], v)} aria-label={`${s.name} on ${site.name}`} />
            <span>{s.name}</span>
          </label>
        ))}
      </div>
      <div className="site-agent-col">
        <div className="site-agent-col-head">
          <span>Tools on {site.name}</span>
          <span className="row-gap">
            <button type="button" className="link-btn small" onClick={() => sw.setTools(allKeys, true)}>
              All on
            </button>
            <button type="button" className="link-btn small" onClick={() => sw.setTools(allKeys, false)}>
              All off
            </button>
          </span>
        </div>
        <div className="switch-grid">
          {agentTools.map((t) => (
            <label key={t.key} className="switch-row">
              <Switch size="small" checked={sw.toolOn(t.key)} onChange={(v) => sw.setTools([t.key], v)} aria-label={`${t.label} on ${site.name}`} />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Without Read page the agent can't see anything on the site. */
function ReadPageWarning({ site }: { site: SiteProfile }) {
  const sw = useSiteSwitches(site);
  if (sw.toolOn('read_page')) return null;
  return (
    <div className="inline-note warning row-gap align-center">
      <span>“Read page” is off on {site.name}, so agents can’t see the page here — no fields, buttons or text.</span>
      <Button size="small" onClick={() => sw.setTools(['read_page', 'find_element', 'scroll'], true)}>
        Turn reading back on
      </Button>
    </div>
  );
}

// ---------- Skills ----------

function SkillsTab({ site }: { site: SiteProfile }) {
  const { skills, agents } = useAppSelector((s) => s.config.config);
  const dispatch = useAppDispatch();
  const { modal, message } = App.useApp();
  const sw = useSiteSwitches(site);
  const [editing, setEditing] = useState<{ skill: SkillConfig; isNew: boolean } | null>(null);
  const own = site.skillIds.map((id) => skills.find((s) => s.id === id)).filter((s): s is SkillConfig => !!s);
  const others = skills.filter((s) => !site.skillIds.includes(s.id));
  const siteAgents = site.agentIds.map((id) => agents.find((a) => a.id === id)).filter((a): a is AgentConfig => !!a);
  const fromAgents = [...new Set(siteAgents.flatMap((a) => a.skillIds))]
    .filter((id) => !site.skillIds.includes(id))
    .map((id) => skills.find((s) => s.id === id))
    .filter((s): s is SkillConfig => !!s);
  const blank = (): SkillConfig => {
    const now = Date.now();
    return { id: uid('skill_'), name: '', description: '', instructions: '', activation: 'on-demand', sites: [], createdAt: now, updatedAt: now };
  };

  return (
    <>
      <SectionGroup>
      <Section
        title={`${site.name}’s own skills`}
        description={`Instructions every agent gets while it is on ${site.name}.`}
        actions={
          own.length > 0 && (
            <Button
              size="small"
              danger
              onClick={() =>
                modal.confirm({
                  title: `Remove all ${own.length} skills from ${site.name}?`,
                  content: 'They stay in Skills (Extension base); this site just stops using them.',
                  okText: 'Remove all',
                  okButtonProps: { danger: true },
                  onOk: () => sw.update({ skillIds: [] }),
                })
              }
            >
              Remove all
            </Button>
          )
        }
      >
        <div className="tab-toolbar padded">
          {others.length > 0 && (
            <Select
              placeholder="Add an existing skill…"
              style={{ minWidth: 240 }}
              value={null}
              onChange={(id: string) => sw.update({ skillIds: [...site.skillIds, id] })}
              options={others.map((s) => ({ value: s.id, label: s.name }))}
            />
          )}
          <span className="spacer" />
          <Button type="primary" icon={<Plus size={15} />} onClick={() => setEditing({ skill: blank(), isNew: true })}>
            New skill
          </Button>
        </div>
        <FitList label="Site skills">
        {own.map((s) => (
          <div key={s.id} className="list-row" role="button" tabIndex={0} onClick={() => setEditing({ skill: s, isNew: false })} onKeyDown={(e) => e.key === 'Enter' && setEditing({ skill: s, isNew: false })}>
            <span className="list-icon">
              <Sparkles size={16} />
            </span>
            <span className="list-main">
              <span className="list-title">{s.name}</span>
              <span className="list-desc">{s.description || 'No description'}</span>
            </span>
            <span className="list-side" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <span className={`pill ${s.activation === 'always' ? 'success' : ''}`}>{s.activation === 'always' ? 'Always on' : 'When relevant'}</span>
              <button type="button" className="icon-btn" aria-label={`Remove ${s.name} from ${site.name}`} onClick={() => sw.update({ skillIds: site.skillIds.filter((id) => id !== s.id) })}>
                <X size={15} />
              </button>
            </span>
          </div>
        ))}
        </FitList>
        {own.length === 0 && <div className="muted small padded-note">None yet. Most site know-how fits in the knowledge base; use a skill for longer instructions.</div>}
      </Section>

      <Section
        title="From the agents on this site"
        description={siteAgents.length ? `Skills of ${siteAgents.map((a) => a.name).join(', ')}. Switch one off to keep it out on ${site.name}.` : 'Choose agents in the Agents tab — their skills show up here.'}
        actions={
          fromAgents.length > 0 && (
            <span className="row-gap">
              <Button size="small" onClick={() => sw.setSkills(fromAgents.map((s) => s.id), true)}>
                All on
              </Button>
              <Button size="small" onClick={() => sw.setSkills(fromAgents.map((s) => s.id), false)}>
                All off
              </Button>
            </span>
          )
        }
      >
        <FitList label="Agents’ skills">
        {fromAgents.map((s) => (
          <div key={s.id} className={`tool-row ${sw.skillOn(s.id) ? '' : 'is-off'}`}>
            <span className="list-icon">
              <Sparkles size={16} />
            </span>
            <span className="list-main">
              <span className="list-title">{s.name}</span>
              <span className="list-desc">{s.description || 'No description'}</span>
            </span>
            <span className="list-side">
              <AvatarStack agents={siteAgents.filter((a) => a.skillIds.includes(s.id))} max={3} />
              <Switch size="small" checked={sw.skillOn(s.id)} onChange={(v) => sw.setSkills([s.id], v)} aria-label={`${s.name} on ${site.name}`} />
            </span>
          </div>
        ))}
        </FitList>
        {fromAgents.length === 0 && <div className="muted small padded-note">{siteAgents.length ? 'These agents have no other skills.' : 'No agents chosen for this site yet.'}</div>}
      </Section>
      </SectionGroup>

      <SkillEditor
        value={editing}
        siteName={site.name}
        onClose={() => setEditing(null)}
        onSave={(skill) => {
          dispatch(configActions.upsertSiteSkill({ siteId: site.id, skill }));
          message.success(editing?.isNew ? 'Skill added' : 'Changes saved');
          setEditing(null);
        }}
        onDelete={(skill) =>
          modal.confirm({
            title: `Delete “${skill.name}”?`,
            content: 'It is removed everywhere it is used.',
            okText: 'Delete',
            okButtonProps: { danger: true },
            onOk: () => {
              dispatch(configActions.deleteSkill(skill.id));
              setEditing(null);
            },
          })
        }
      />
    </>
  );
}

// ---------- Tools ----------

function ToolsTab({ site }: { site: SiteProfile }) {
  const { customTools, agents } = useAppSelector((s) => s.config.config);
  const dispatch = useAppDispatch();
  const { modal, message } = App.useApp();
  const sw = useSiteSwitches(site);
  const [editing, setEditing] = useState<{ tool: CustomToolConfig; isNew: boolean } | null>(null);
  const own = site.customToolIds.map((id) => customTools.find((t) => t.id === id)).filter((t): t is CustomToolConfig => !!t);
  const others = customTools.filter((t) => !site.customToolIds.includes(t.id));
  const siteAgents = site.agentIds.map((id) => agents.find((a) => a.id === id)).filter((a): a is AgentConfig => !!a);
  const agentCustom = [...new Set(siteAgents.flatMap((a) => a.toolIds.filter((k) => k.startsWith(CUSTOM_PREFIX))))]
    .map((key) => ({ key, tool: customTools.find((t) => `${CUSTOM_PREFIX}${t.id}` === key) }))
    .filter((x): x is { key: string; tool: CustomToolConfig } => !!x.tool && !site.customToolIds.includes(x.tool.id));
  const builtInIds = BUILT_IN_TOOLS.map((t) => t.id);
  const blank = (): CustomToolConfig => {
    const now = Date.now();
    return { id: uid('tool_'), name: '', label: '', description: '', method: 'POST', url: '', headers: '', params: [], needsApproval: true, createdAt: now, updatedAt: now };
  };

  return (
    <>
      <ReadPageWarning site={site} />
      <SectionGroup>
      <Section
        title="Built-in tools on this site"
        description="Switch a tool off to keep agents from using it here — e.g. no navigating away, no typing."
        actions={
          <span className="row-gap">
            <Button size="small" onClick={() => sw.setTools(builtInIds, true)}>
              All on
            </Button>
            <Button size="small" onClick={() => sw.setTools(builtInIds, false)}>
              All off
            </Button>
          </span>
        }
      >
        <FitList label="Built-in tools">
        {BUILT_IN_TOOLS.map((t) => {
          const on = sw.toolOn(t.id);
          return (
            <div key={t.id} className={`tool-row ${on ? '' : 'is-off'}`}>
              <span className="list-icon">
                <NamedIcon name={t.icon} size={16} />
              </span>
              <span className="list-main">
                <span className="list-title">{t.label}</span>
                <span className="list-desc">{t.description}</span>
              </span>
              <span className="list-side">
                {siteAgents.length > 0 && <AvatarStack agents={siteAgents.filter((a) => a.toolIds.includes(t.id))} max={3} />}
                <Switch size="small" checked={on} onChange={(v) => sw.setTools([t.id], v)} aria-label={`${t.label} on ${site.name}`} />
              </span>
            </div>
          );
        })}
        </FitList>
      </Section>

      <Section
        title="Custom tools for this site"
        description={`Your own endpoints, available to every agent on ${site.name}.`}
        actions={
          own.length > 0 && (
            <Button
              size="small"
              danger
              onClick={() =>
                modal.confirm({
                  title: `Remove all ${own.length} custom tools from ${site.name}?`,
                  content: 'They stay in Tools (Extension base); this site just stops using them.',
                  okText: 'Remove all',
                  okButtonProps: { danger: true },
                  onOk: () => sw.update({ customToolIds: [] }),
                })
              }
            >
              Remove all
            </Button>
          )
        }
      >
        <div className="tab-toolbar padded">
          {others.length > 0 && (
            <Select
              placeholder="Add an existing tool…"
              style={{ minWidth: 220 }}
              value={null}
              onChange={(id: string) => sw.update({ customToolIds: [...site.customToolIds, id] })}
              options={others.map((t) => ({ value: t.id, label: t.label || t.name }))}
            />
          )}
          <span className="spacer" />
          <Button icon={<Plus size={15} />} onClick={() => setEditing({ tool: blank(), isNew: true })}>
            New custom tool
          </Button>
        </div>
        <FitList label="Custom tools">
        {own.map((t) => (
          <div key={t.id} className="tool-row clickable" role="button" tabIndex={0} onClick={() => setEditing({ tool: t, isNew: false })} onKeyDown={(e) => e.key === 'Enter' && setEditing({ tool: t, isNew: false })}>
            <span className="list-icon">
              <Webhook size={16} />
            </span>
            <span className="list-main">
              <span className="list-title">{t.label || t.name}</span>
              <span className="list-desc">
                <span className="mono">{t.method}</span> {t.description}
              </span>
            </span>
            <span className="list-side" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <button type="button" className="icon-btn" aria-label={`Remove ${t.label || t.name} from ${site.name}`} onClick={() => sw.update({ customToolIds: site.customToolIds.filter((id) => id !== t.id) })}>
                <X size={15} />
              </button>
            </span>
          </div>
        ))}
        </FitList>
      </Section>

      {agentCustom.length > 0 && (
        <Section
          title="Custom tools of the agents on this site"
          actions={
            <span className="row-gap">
              <Button size="small" onClick={() => sw.setTools(agentCustom.map((x) => x.key), true)}>
                All on
              </Button>
              <Button size="small" onClick={() => sw.setTools(agentCustom.map((x) => x.key), false)}>
                All off
              </Button>
            </span>
          }
        >
          <FitList label="Agents’ custom tools">
          {agentCustom.map(({ key, tool }) => (
            <div key={key} className={`tool-row ${sw.toolOn(key) ? '' : 'is-off'}`}>
              <span className="list-icon">
                <Webhook size={16} />
              </span>
              <span className="list-main">
                <span className="list-title">{tool.label || tool.name}</span>
                <span className="list-desc">{tool.description}</span>
              </span>
              <span className="list-side">
                <AvatarStack agents={siteAgents.filter((a) => a.toolIds.includes(key))} max={3} />
                <Switch size="small" checked={sw.toolOn(key)} onChange={(v) => sw.setTools([key], v)} aria-label={`${tool.label || tool.name} on ${site.name}`} />
              </span>
            </div>
          ))}
          </FitList>
        </Section>
      )}
      </SectionGroup>

      <CustomToolEditor
        value={editing}
        siteName={site.name}
        existingNames={new Set([...BUILT_IN_TOOLS.map((t) => t.id), 'load_skill', 'site_knowledge', ...customTools.filter((t) => t.id !== editing?.tool.id).map((t) => t.name)])}
        onClose={() => setEditing(null)}
        onSave={(tool) => {
          dispatch(configActions.upsertSiteTool({ siteId: site.id, tool }));
          message.success(editing?.isNew ? 'Tool added' : 'Changes saved');
          setEditing(null);
        }}
        onDelete={(tool) =>
          modal.confirm({
            title: `Delete “${tool.label || tool.name}”?`,
            okText: 'Delete',
            okButtonProps: { danger: true },
            onOk: () => {
              dispatch(configActions.deleteCustomTool(tool.id));
              setEditing(null);
            },
          })
        }
      />
    </>
  );
}

// ---------- Model ----------

function ModelTab({ site, update }: { site: SiteProfile; update: (patch: Partial<SiteProfile>) => void }) {
  const providers = useAppSelector((s) => s.config.config.providers);
  const provider = providers.find((p) => p.id === site.providerId);
  return (
    <Section title="Model on this site" description={`Leave it on “The agent’s own” to use whatever model each agent is set to. Pick one to run every agent on ${site.name} with it.`}>
      <div className="form-stack padded">
        <div>
          <FieldLabel>Connection</FieldLabel>
          <Select
            style={{ width: '100%' }}
            value={site.providerId ?? ''}
            onChange={(v: string) => update({ providerId: v || null, model: v ? site.model : '' })}
            options={[{ value: '', label: 'The agent’s own' }, ...providers.map((p) => ({ value: p.id, label: p.name }))]}
            aria-label="Connection on this site"
          />
        </div>
        <div>
          <FieldLabel hint={provider ? `Empty → ${provider.defaultModel || 'its default'}` : 'Empty → the agent’s model'}>Model</FieldLabel>
          <Input value={site.model} onChange={(e) => update({ model: e.target.value })} placeholder={provider?.defaultModel || 'e.g. qwen3.5:9b'} aria-label="Model on this site" />
        </div>
      </div>
    </Section>
  );
}

// ---------- Settings ----------

function SettingsTab({ site, update }: { site: SiteProfile; update: (patch: Partial<SiteProfile>) => void }) {
  return (
    <Section>
      <div className="form-stack padded">
        <div>
          <FieldLabel htmlFor="site-set-name">Name</FieldLabel>
          <Input id="site-set-name" value={site.name} onChange={(e) => update({ name: e.target.value })} />
        </div>
        <div>
          <FieldLabel hint="Copy it from the address bar">Addresses</FieldLabel>
          <Select
            mode="tags"
            style={{ width: '100%' }}
            value={site.sites}
            onChange={(v: string[]) => update({ sites: cleanHosts(v) })}
            tokenSeparators={[',', ' ']}
            placeholder="e.g. clinic.indici.co.nz, localhost:5173, *.example.com"
            open={false}
            suffixIcon={null}
            aria-label="Site addresses"
          />
          <div className="field-help">The setup is used when the agent’s tab is on one of these. A * matches any part.</div>
        </div>
        <div>
          <FieldLabel hint="Exact button names">Never click these</FieldLabel>
          <Select
            mode="tags"
            style={{ width: '100%' }}
            value={site.neverClick ?? []}
            onChange={(v: string[]) => update({ neverClick: v.map((x) => x.trim()).filter(Boolean) })}
            tokenSeparators={[',']}
            placeholder="e.g. Pharmac, Delete patient"
            open={false}
            suffixIcon={null}
            aria-label="Buttons the agent never clicks"
          />
          <div className="field-help">
            The agent stops before these and leaves them to you — even if it forgets a rule. Names must match the button exactly. A name here blocks that button everywhere on this site, pop-ups included (e.g. “Save” would also block the Save of the patient-file reason pop-up).
          </div>
        </div>
        <div>
          <FieldLabel>Ask before clicking or typing</FieldLabel>
          <Select
            mode="tags"
            style={{ width: '100%' }}
            value={site.askBefore ?? []}
            onChange={(v: string[]) => update({ askBefore: v.map((x) => x.trim()).filter(Boolean) })}
            tokenSeparators={[',']}
            placeholder="e.g. Confidential, Opt Out, Diagnostic Comment"
            open={false}
            suffixIcon={null}
            aria-label="Controls the agent asks you about before clicking or typing"
          />
          <div className="field-help">
            Controls that change a record the moment they are used — a tick box or a comment box that saves itself, an opt-out: the agent asks you before clicking or typing into them, as it does before a save or delete. Names must match exactly.
          </div>
        </div>
        <div>
          <FieldLabel>Pop-ups you answer yourself</FieldLabel>
          <Select
            mode="tags"
            style={{ width: '100%' }}
            value={site.askPopups ?? []}
            onChange={(v: string[]) => update({ askPopups: v.map((x) => x.trim()).filter(Boolean) })}
            tokenSeparators={[',']}
            placeholder="e.g. New Zealand Formulary, already in the active medicines list"
            open={false}
            suffixIcon={null}
            aria-label="Pop-ups you answer yourself"
          />
          <div className="field-help">
            Words of a pop-up’s title or text. The agent presses none of its buttons on its own: you pick which one on an approval card — unless your message already names the button (“OK”).
          </div>
        </div>
        <div>
          <FieldLabel htmlFor="site-set-desc">Description</FieldLabel>
          <Input.TextArea id="site-set-desc" value={site.description} onChange={(e) => update({ description: e.target.value })} autoSize={{ minRows: 2, maxRows: 5 }} />
        </div>
        <div>
          <FieldLabel>Colour</FieldLabel>
          <div className="row-gap">
            {COLORS.map((c) => (
              <button key={c} type="button" className={`color-dot ${site.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={site.color === c} onClick={() => update({ color: c })} />
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

// ---------- Preview ----------

function useCopy() {
  const { message } = App.useApp();
  return (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => message.success('Copied'),
      () => message.error('Couldn’t copy — select the text and press Ctrl+C'),
    );
}

function PreviewTab({ site }: { site: SiteProfile }) {
  const { skills, customTools, providers, settings } = useAppSelector((s) => s.config.config);
  const copy = useCopy();
  const [request, setRequest] = useState(site.knowledge.find((k) => k.kind === 'workflow' && k.trigger)?.trigger ?? '');
  // The same room the agent gets: from this site's model, or the default connection.
  const provider = providers.find((p) => p.id === site.providerId) ?? providers.find((p) => p.id === settings.defaultProviderId) ?? providers[0];
  const budget = knowledgeBudget(provider ? contextWindowOf(provider) : undefined);
  const text = useMemo(() => knowledgeSection([site], request, budget).text, [site, request, budget]);
  const siteSkills = site.skillIds.map((id) => skills.find((s) => s.id === id)?.name).filter(Boolean);
  const siteTools = site.customToolIds.map((id) => customTools.find((t) => t.id === id)?.label).filter(Boolean);
  const editor = useKnowledgeTextEditor(site);
  return (
    <SectionGroup>
      <Section
        title="What the agent gets"
        description={`For a request on ${site.name}. Everything goes in while it fits; workflows that match the request come first.`}
        actions={
          <Button size="small" icon={<Copy size={13} />} onClick={() => void copy(text)} disabled={!text}>
            Copy
          </Button>
        }
      >
        <div className="form-stack padded fill preview-pane">
          <div>
            <FieldLabel htmlFor="site-preview">Try a request</FieldLabel>
            <Input id="site-preview" value={request} onChange={(e) => setRequest(e.target.value)} placeholder="e.g. Goto Patients and select Search & List and select Arya Stark" />
          </div>
          <div className="preview-meta">
            <span className="pill">
              <Sparkles size={11} /> Skills: {siteSkills.length ? siteSkills.join(', ') : 'none'}
            </span>
            <span className="pill">
              <Webhook size={11} /> Tools: {siteTools.length ? siteTools.join(', ') : 'none'}
            </span>
            {site.disabledToolIds.length > 0 && <span className="pill warning">Off here: {site.disabledToolIds.join(', ')}</span>}
            {(site.neverClick ?? []).length > 0 && <span className="pill">Never clicks: {site.neverClick!.join(', ')}</span>}
            {(site.askBefore ?? []).length > 0 && <span className="pill">Asks before: {site.askBefore!.join(', ')}</span>}
            <span className="pill">Room: ~{Math.round(budget / 1000)}k characters</span>
          </div>
          <pre className="spec-json mono site-preview">{text || 'No knowledge yet.'}</pre>
        </div>
      </Section>
      <Section
        title="Knowledge as text"
        description="The whole knowledge base in the format the agent reads. Copy it, edit it, or paste text in — then Apply turns every “### Kind: Title” block into an entry."
        actions={editor.actions}
      >
        {editor.body}
      </Section>
    </SectionGroup>
  );
}

/** The whole knowledge base as editable text: copy it, paste into it, and apply it back as entries. */
function useKnowledgeTextEditor(site: SiteProfile) {
  const dispatch = useAppDispatch();
  const { message } = App.useApp();
  const copy = useCopy();
  const current = useMemo(() => knowledgeAsText(site), [site]);
  const [draft, setDraft] = useState(current);
  const [baseline, setBaseline] = useState(current);
  const [confirming, setConfirming] = useState(false);
  const [removeMissing, setRemoveMissing] = useState(false);

  // Knowledge changed elsewhere (another tab, a saved entry): follow it unless the text has edits.
  useEffect(() => {
    setDraft((d) => (d === baseline ? current : d));
    setBaseline(current);
  }, [current]);

  const parsed = useMemo(() => parseKnowledgeText(draft), [draft]);
  const preview = useMemo(() => mergeKnowledge(site.knowledge, parsed.entries, removeMissing, () => 'new'), [site.knowledge, parsed, removeMissing]);
  const counts = (Object.keys(KNOWLEDGE_KINDS) as KnowledgeKind[])
    .map((k) => [k, parsed.entries.filter((e) => e.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${KNOWLEDGE_KINDS[k].label.toLowerCase()}`);
  const edited = draft !== current;
  const canApply = parsed.entries.length > 0 || parsed.neverClick !== null;

  const paste = () =>
    navigator.clipboard.readText().then(
      (t) => setDraft((d) => (d.trim() ? `${d.trimEnd()}\n\n${t.trim()}` : t.trim())),
      () => message.error('Couldn’t read the clipboard — click in the box and press Ctrl+V'),
    );

  const apply = () => {
    const merge = mergeKnowledge(site.knowledge, parsed.entries, removeMissing, () => uid('kb_'));
    const neverClick = parsed.neverClick ?? (removeMissing ? [] : (site.neverClick ?? []));
    dispatch(configActions.upsertSite({ ...site, knowledge: merge.knowledge, neverClick }));
    message.success([`${merge.added} added`, `${merge.updated} updated`, merge.removed ? `${merge.removed} removed` : ''].filter(Boolean).join(' · '));
    setConfirming(false);
    setRemoveMissing(false);
  };

  return {
    actions: (
        <span className="row-gap">
          <Button size="small" icon={<Copy size={13} />} onClick={() => void copy(draft)} disabled={!draft.trim()}>
            Copy
          </Button>
          <Button size="small" icon={<ClipboardPaste size={13} />} onClick={() => void paste()}>
            Paste
          </Button>
          <Button size="small" icon={<RotateCcw size={13} />} onClick={() => setDraft(current)} disabled={!edited}>
            Reset
          </Button>
          <Button size="small" type="primary" onClick={() => setConfirming(true)} disabled={!edited || !canApply}>
            Apply
          </Button>
        </span>
    ),
    body: (
      <>
      <div className="form-stack padded fill knowledge-text">
        <Input.TextArea
          className="mono-area"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoSize={{ minRows: 12, maxRows: 36 }}
          aria-label="Knowledge base as text"
          placeholder={
            '### Rule: Open a patient by clicking the name\nPatient names are plain text — click the name, never an icon.\n\n### Navigation: Top menus open on hover\nUse open_menu ["Patients", "Search & List"].\n\n### Page: Patient Search page\n- Search with the "Search" button, not "Search Vault".\n\n### Workflow: Select a patient\nFor requests like: “goto patients and select luke king”\n1. …\n2. …'
          }
        />
        <div className="field-help">
          Each entry starts with a line <span className="mono">### Rule: Title</span>, <span className="mono">### Navigation: …</span>, <span className="mono">### Page: …</span> or{' '}
          <span className="mono">### Workflow: …</span>; the lines below it are its text. A workflow’s example goes on the line after its heading:{' '}
          <span className="mono">For requests like: “…”</span>. Write <span className="mono">### Rule (off): …</span> to keep an entry switched off. Text copied from the preview above can be pasted here too.
        </div>
        <div className="preview-meta">
          <span className="pill">{counts.length ? `Found ${counts.join(' · ')}` : 'No entries found yet'}</span>
          {parsed.neverClick && <span className="pill">Never clicks: {parsed.neverClick.join(', ') || 'none'}</span>}
          {edited && canApply && (
            <span className="pill">
              {preview.added} new · {preview.updated} changed{preview.missing ? ` · ${preview.missing} not in the text` : ''}
            </span>
          )}
          {parsed.unknown.length > 0 && <span className="pill warning">Not understood: {parsed.unknown.slice(0, 2).join(' · ')}</span>}
        </div>
      </div>

      <Modal open={confirming} onCancel={() => setConfirming(false)} onOk={apply} okText="Apply" title={`Update ${site.name}’s knowledge base?`}>
        <div className="form-stack">
          <p className="muted">
            {preview.added} new {preview.added === 1 ? 'entry' : 'entries'} and {preview.updated} changed. Entries with the same kind and title are updated in place.
          </p>
          {preview.missing > 0 && (
            <label className="row-gap align-center">
              <Checkbox checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} />
              Also delete the {preview.missing} {preview.missing === 1 ? 'entry' : 'entries'} that aren’t in the text
            </label>
          )}
        </div>
      </Modal>
      </>
    ),
  };
}
