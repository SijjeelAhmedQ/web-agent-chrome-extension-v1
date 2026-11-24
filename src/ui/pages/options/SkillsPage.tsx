import { App, Button, Checkbox, Drawer, Input, Select } from 'antd';
import { Globe, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SkillConfig } from '@/shared/types/config';
import { uid } from '@/shared/utils';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';
import { AgentAvatar } from '../../components/Brand';
import { AvatarStack, EmptyBlock, FieldLabel, PageHeader } from './parts';
import { FitList, useFitMode } from './layout';

const blank = (): SkillConfig => {
  const now = Date.now();
  return { id: uid('skill_'), name: '', description: '', instructions: '', activation: 'on-demand', sites: [], createdAt: now, updatedAt: now };
};

export function SkillsPage() {
  const { skills, agents, sites } = useAppSelector((s) => s.config.config);
  const dispatch = useAppDispatch();
  const { modal, message } = App.useApp();
  const [editing, setEditing] = useState<{ skill: SkillConfig; isNew: boolean } | null>(null);

  return (
    <>
      <PageHeader
        title="Skills"
        description="Reusable know-how you can give to agents — how to fill your forms, how to work with a particular app, how you like answers."
        actions={
          <Button type="primary" icon={<Plus size={16} />} onClick={() => setEditing({ skill: blank(), isNew: true })}>
            New skill
          </Button>
        }
      />

      {skills.length === 0 ? (
        <EmptyBlock
          icon={<Sparkles size={22} />}
          title="No skills yet"
          text="Write instructions once and reuse them across agents."
          action={
            <Button type="primary" onClick={() => setEditing({ skill: blank(), isNew: true })}>
              Create a skill
            </Button>
          }
        />
      ) : (
        <FitList className="list-card" label="Skills">
          {skills.map((s) => {
            const users = agents.filter((a) => a.skillIds.includes(s.id));
            return (
              <button key={s.id} type="button" className="list-row" onClick={() => setEditing({ skill: s, isNew: false })}>
                <span className="list-icon">
                  <Sparkles size={16} />
                </span>
                <span className="list-main">
                  <span className="list-title">{s.name}</span>
                  <span className="list-desc">{s.description || 'No description'}</span>
                </span>
                <span className="list-side">
                  {sites
                    .filter((site) => site.skillIds.includes(s.id))
                    .map((site) => (
                      <span key={site.id} className="pill" title={`Part of the ${site.name} site setup`}>
                        <Globe size={11} /> {site.name}
                      </span>
                    ))}
                  {s.sites.length > 0 && (
                    <span className="pill" title={s.sites.join(', ')}>
                      <Globe size={11} /> {s.sites.length === 1 ? s.sites[0] : `${s.sites.length} sites`}
                    </span>
                  )}
                  <span className={`pill ${s.activation === 'always' ? 'success' : ''}`}>{s.activation === 'always' ? 'Always on' : 'When relevant'}</span>
                  <AvatarStack agents={users} />
                </span>
              </button>
            );
          })}
        </FitList>
      )}

      <SkillEditor
        value={editing}
        onClose={() => setEditing(null)}
        onSave={(skill, agentIds) => {
          dispatch(configActions.upsertSkill({ skill, agentIds }));
          message.success(editing?.isNew ? 'Skill created' : 'Changes saved');
          setEditing(null);
        }}
        onDelete={(skill) =>
          modal.confirm({
            title: `Delete “${skill.name}”?`,
            content: 'Agents using it will no longer have these instructions.',
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

interface EditorProps {
  value: { skill: SkillConfig; isNew: boolean } | null;
  onClose: () => void;
  onSave: (skill: SkillConfig, agentIds: string[]) => void;
  onDelete: (skill: SkillConfig) => void;
  /** Editing a site's skill: it applies to every agent on that site, so no agents or sites to pick. */
  siteName?: string;
}

export function SkillEditor({ value, onClose, onSave, onDelete, siteName }: EditorProps) {
  const agents = useAppSelector((s) => s.config.config.agents);
  const [draft, setDraft] = useState<SkillConfig | null>(null);
  const [assigned, setAssigned] = useState<string[]>([]);
  const fit = useFitMode();

  useEffect(() => {
    if (!value) return;
    setDraft(structuredClone(value.skill));
    setAssigned(value.isNew ? agents.filter((a) => a.id === 'agent-assistant').map((a) => a.id) : agents.filter((a) => a.skillIds.includes(value.skill.id)).map((a) => a.id));
  }, [value]);

  if (!draft || !value) return <Drawer open={false} />;
  const set = (patch: Partial<SkillConfig>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const valid = draft.name.trim() && draft.instructions.trim();

  return (
    <Drawer
      open
      onClose={onClose}
width={fit ? 'min(980px, 94vw)' : 620}
      rootClassName="fit-drawer"
      title={value.isNew ? 'New skill' : draft.name || 'Skill'}
      footer={
        <div className="drawer-foot">
          {!value.isNew && (
            <Button danger type="text" icon={<Trash2 size={14} />} onClick={() => onDelete(value.skill)}>
              Delete
            </Button>
          )}
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" disabled={!valid} onClick={() => onSave({ ...draft, name: draft.name.trim(), sites: draft.sites.map((s) => s.trim()).filter(Boolean) }, assigned)}>
            {value.isNew ? 'Create skill' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="drawer-cols-wrap">
      <div className="form-stack skill-form">
        <div className="area-name">
          <FieldLabel htmlFor="skill-name">Name</FieldLabel>
          <Input id="skill-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Patient chart workflow" maxLength={60} autoFocus={value.isNew} />
        </div>
        <div className="area-when">
          <FieldLabel htmlFor="skill-desc" hint="The agent reads this to decide when to use the skill">
            When to use it
          </FieldLabel>
          <Input id="skill-desc" value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Use when adding medications or diagnoses in the PMS" maxLength={160} />
        </div>
        <div className="area-instr fill-textarea">
          <FieldLabel htmlFor="skill-body" hint="Markdown supported">
            Instructions
          </FieldLabel>
          <Input.TextArea
            id="skill-body"
            className="mono-area"
            value={draft.instructions}
            onChange={(e) => set({ instructions: e.target.value })}
            autoSize={{ minRows: 10, maxRows: 24 }}
            placeholder={'- Open the patient from Patients before anything else\n- Medications live under Summary → Medication\n- Always confirm dose and frequency with the user'}
          />
        </div>
        <div className="area-how">
          <FieldLabel>How the agent gets it</FieldLabel>
          <div className="radio-cards two">
            {(
              [
                ['on-demand', 'When relevant', 'The agent sees the name and loads the instructions when the task needs them. Keeps prompts small.'],
                ['always', 'Always on', 'The instructions are part of every task. Best for short, essential rules.'],
              ] as const
            ).map(([v, title, text]) => (
              <button key={v} type="button" role="radio" aria-checked={draft.activation === v} className={`radio-card ${draft.activation === v ? 'on' : ''}`} onClick={() => set({ activation: v })}>
                <span className="radio-dot" aria-hidden />
                <span>
                  <span className="radio-title">{title}</span>
                  <span className="radio-text">{text}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        {siteName ? (
          <div className="inline-note area-note">Used by every agent while you are on {siteName}.</div>
        ) : (
          <>
        <div className="area-sites">
          <FieldLabel hint="Leave empty for every site">Only on these sites</FieldLabel>
          <Select
            mode="tags"
            style={{ width: '100%' }}
            value={draft.sites}
            onChange={(v) => set({ sites: v })}
            tokenSeparators={[',', ' ']}
            placeholder="e.g. localhost:5173, careflow.example.com, *.myclinic.com"
            open={false}
            suffixIcon={null}
          />
        </div>
        <div className="area-agents">
          <FieldLabel>Agents with this skill</FieldLabel>
          <FitList layout="grid" minItemWidth={170} className="check-list check-grid" label="Agents" estimate={40}>
            {agents.map((a) => (
              <label key={a.id} className="check-row compact">
                <Checkbox checked={assigned.includes(a.id)} onChange={(e) => setAssigned((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id)))} />
                <AgentAvatar avatar={a.avatar} size={22} />
                <span className="check-title">{a.name}</span>
              </label>
            ))}
          </FitList>
        </div>
          </>
        )}
      </div>
      </div>
    </Drawer>
  );
}
