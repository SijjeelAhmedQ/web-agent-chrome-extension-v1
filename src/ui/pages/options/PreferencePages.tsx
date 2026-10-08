import { App, Button, Checkbox, Input, Select, Slider, Switch } from 'antd';
import { Ban, Download, Lock, Monitor, Moon, Sun, Upload, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { defaultConfig } from '@/shared/constants/defaults';
import { normalizeConfig } from '@/shared/storage/configStore';
import { clearHistory } from '@/shared/storage/historyStore';
import type { AppConfig, ConfirmationPolicy, ThemeMode } from '@/shared/types/config';
import { isExtensionContext } from '@/shared/utils';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';
import { AgentAvatar } from '../../components/Brand';
import { PageHeader, Section, SettingRow } from './parts';

function useSettings() {
  const settings = useAppSelector((s) => s.config.config.settings);
  const dispatch = useAppDispatch();
  return [settings, (patch: Partial<typeof settings>) => dispatch(configActions.updateSettings(patch))] as const;
}

/* ---------------- General ---------------- */

export function GeneralPage() {
  const [settings, update] = useSettings();
  const agents = useAppSelector((s) => s.config.config.agents);
  return (
    <>
      <PageHeader title="General" description="The basics of how Web Agent starts and behaves." />
      <Section>
        <SettingRow label="Default agent" description="The agent the side panel opens with.">
          <Select
            style={{ width: 220 }}
            value={settings.defaultAgentId}
            onChange={(v) => update({ defaultAgentId: v })}
            options={agents.map((a) => ({
              value: a.id,
              label: (
                <span className="select-agent">
                  <AgentAvatar avatar={a.avatar} size={18} /> {a.name}
                </span>
              ),
            }))}
          />
        </SettingRow>
        <SettingRow label="Show suggestions" description="Quick starting points in an empty conversation.">
          <Switch checked={settings.showSuggestions} onChange={(v) => update({ showSuggestions: v })} aria-label="Show suggestions" />
        </SettingRow>
        <SettingRow
          label="Keyboard shortcut"
          description={
            <>
              Open the side panel with <span className="kbd">Alt</span> <span className="kbd">Shift</span> <span className="kbd">A</span>. In the panel, <span className="kbd">/</span> focuses the message box and <span className="kbd">Esc</span> stops the agent.
            </>
          }
        >
          <Button onClick={() => (isExtensionContext() ? void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) : undefined)}>Change shortcut</Button>
        </SettingRow>
      </Section>
    </>
  );
}

/* ---------------- Appearance ---------------- */

function ThemeCard({ value, current, icon, label, onPick }: { value: ThemeMode; current: ThemeMode; icon: ReactNode; label: string; onPick: (v: ThemeMode) => void }) {
  return (
    <button type="button" role="radio" aria-checked={current === value} className={`theme-card ${current === value ? 'on' : ''}`} onClick={() => onPick(value)}>
      <span className={`theme-preview ${value}`} aria-hidden>
        <span className="tp-bar" />
        <span className="tp-line w70" />
        <span className="tp-line w50" />
        <span className="tp-pill" />
      </span>
      <span className="theme-label">
        {icon} {label}
      </span>
    </button>
  );
}

export function AppearancePage() {
  const [settings, update] = useSettings();
  return (
    <>
      <PageHeader title="Appearance" description="Make it comfortable for long sessions." />
      <Section title="Theme">
        <div className="theme-cards" role="radiogroup" aria-label="Theme">
          <ThemeCard value="system" current={settings.theme} icon={<Monitor size={14} />} label="System" onPick={(theme) => update({ theme })} />
          <ThemeCard value="light" current={settings.theme} icon={<Sun size={14} />} label="Light" onPick={(theme) => update({ theme })} />
          <ThemeCard value="dark" current={settings.theme} icon={<Moon size={14} />} label="Dark" onPick={(theme) => update({ theme })} />
        </div>
      </Section>
      <Section>
        <SettingRow label="Larger text" description="Slightly bigger text in the side panel and here.">
          <Switch checked={settings.textSize === 'large'} onChange={(v) => update({ textSize: v ? 'large' : 'default' })} aria-label="Larger text" />
        </SettingRow>
        <SettingRow label="Reduce motion" description="Turns off animations. Your system setting is respected either way.">
          <Switch checked={settings.reduceMotion} onChange={(v) => update({ reduceMotion: v })} aria-label="Reduce motion" />
        </SettingRow>
      </Section>
    </>
  );
}

/* ---------------- Behavior ---------------- */

const POLICY_OPTIONS: { value: ConfirmationPolicy; label: string }[] = [
  { value: 'smart', label: 'Ask before important actions' },
  { value: 'always', label: 'Ask before every action' },
  { value: 'never', label: 'Don’t ask' },
];

export function BehaviorPage() {
  const [settings, update] = useSettings();
  const agents = useAppSelector((s) => s.config.config.agents);
  const dispatch = useAppDispatch();
  return (
    <>
      <PageHeader title="Agent behavior" description="How agents show their work and when they check with you." />
      <Section title="While working">
        <SettingRow label="Highlight what the agent touches" description="A soft outline shows on the page around each button or field before the agent uses it, and the page edge glows while it works.">
          <Switch checked={settings.highlightActions} onChange={(v) => update({ highlightActions: v })} aria-label="Highlight actions" />
        </SettingRow>
        <SettingRow label="Keep activity open" description="Show every step after a task finishes, instead of folding them away.">
          <Switch checked={settings.expandActivity} onChange={(v) => update({ expandActivity: v })} aria-label="Keep activity open" />
        </SettingRow>
      </Section>
      <Section title="Approvals" description="Choose per agent when it should ask before acting. Purchases, messages, deletions and form submissions are detected automatically.">
        {agents.map((a) => (
          <SettingRow
            key={a.id}
            label={
              <span className="select-agent">
                <AgentAvatar avatar={a.avatar} size={20} /> {a.name}
              </span>
            }
          >
            <Select
              style={{ width: 250 }}
              value={a.confirmation}
              onChange={(v) => dispatch(configActions.upsertAgent({ ...a, confirmation: v }))}
              options={POLICY_OPTIONS}
              status={a.confirmation === 'never' ? 'warning' : undefined}
            />
          </SettingRow>
        ))}
      </Section>
    </>
  );
}

/* ---------------- Permissions ---------------- */

function SiteListEditor({ value, onChange, placeholder, icon }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; icon: ReactNode }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const entries = draft
      .split(/[\s,]+/)
      .map((s) => s.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''))
      .filter(Boolean);
    if (!entries.length) return;
    onChange([...new Set([...value, ...entries])]);
    setDraft('');
  };
  return (
    <div className="site-list">
      <div className="row-gap">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onPressEnter={add} placeholder={placeholder} aria-label={placeholder} />
        <Button onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
      {value.length > 0 && (
        <ul className="site-chips">
          {value.map((site) => (
            <li key={site} className="site-chip">
              {icon}
              <span>{site}</span>
              <button type="button" aria-label={`Remove ${site}`} onClick={() => onChange(value.filter((s) => s !== site))}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PermissionsPage() {
  const [settings, update] = useSettings();
  return (
    <>
      <PageHeader title="Permissions" description="Decide where agents may work. These rules apply to every agent and can't be overridden by a task." />
      <Section title="Blocked sites" description="Agents won't read or act on these sites at all — good for banking, email or anything private.">
        <div className="pad-block">
          <SiteListEditor value={settings.blockedSites} onChange={(v) => update({ blockedSites: v })} placeholder="e.g. mybank.com" icon={<Ban size={12} />} />
        </div>
      </Section>
      <Section title="Read-only sites" description="Agents can read and summarize these sites, but never click, type or change anything.">
        <div className="pad-block">
          <SiteListEditor value={settings.readOnlySites} onChange={(v) => update({ readOnlySites: v })} placeholder="e.g. careflow.example.com" icon={<Lock size={12} />} />
        </div>
      </Section>
      <p className="footnote">
        Patterns: <span className="mono">example.com</span> covers the site and its subdomains, <span className="mono">*.example.com</span> only subdomains, <span className="mono">localhost:5173</span> a local app,{' '}
        <span className="mono">example.com/admin</span> a section. Chrome never lets extensions work on its own pages (chrome://, the Web Store).
      </p>
    </>
  );
}

/* ---------------- Privacy ---------------- */

export function PrivacyPage() {
  const [settings, update] = useSettings();
  const taskCount = useAppSelector((s) => s.history.tasks.length);
  const { modal, message } = App.useApp();
  return (
    <>
      <PageHeader title="Privacy" description="What Web Agent keeps, and what leaves your browser." />
      <Section title="Where your data goes">
        <ul className="flow-list">
          <li>
            <strong>Pages are read only during a task.</strong> Web Agent looks at a page when you ask it to do something there — never in the background.
          </li>
          <li>
            <strong>Page content goes only to the model you chose</strong> for that agent, as part of the task. Local models keep everything on this computer.
          </li>
          <li>
            <strong>Settings, keys and history stay in this browser.</strong> Nothing is sent to us or synced anywhere.
          </li>
        </ul>
      </Section>
      <Section title="Activity history">
        <SettingRow label="Save activity" description="Keeps your requests, the steps taken and short results so you can review them later.">
          <Switch checked={settings.saveHistory} onChange={(v) => update({ saveHistory: v })} aria-label="Save activity" />
        </SettingRow>
        <SettingRow label="Keep activity for" description="Older tasks are removed automatically.">
          <Select
            style={{ width: 160 }}
            value={settings.historyRetentionDays}
            onChange={(v) => update({ historyRetentionDays: v })}
            disabled={!settings.saveHistory}
            options={[
              { value: 1, label: '1 day' },
              { value: 7, label: '7 days' },
              { value: 30, label: '30 days' },
              { value: 90, label: '90 days' },
              { value: 365, label: '1 year' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Clear activity" description={`${taskCount} task${taskCount === 1 ? '' : 's'} saved.`}>
          <Button
            danger
            disabled={!taskCount}
            onClick={() =>
              modal.confirm({
                title: 'Clear all activity?',
                content: 'This removes every saved task. It can’t be undone.',
                okText: 'Clear',
                okButtonProps: { danger: true },
                onOk: async () => {
                  await clearHistory();
                  message.success('Activity cleared');
                },
              })
            }
          >
            Clear
          </Button>
        </SettingRow>
      </Section>
    </>
  );
}

/* ---------------- Advanced ---------------- */

function stripKeys(config: AppConfig): AppConfig {
  const copy = structuredClone(config);
  copy.providers = copy.providers.map((p) => ({ ...p, apiKey: '' }));
  copy.customTools = copy.customTools.map((t) => ({ ...t, headers: '' }));
  return copy;
}

export function AdvancedPage() {
  const [settings, update] = useSettings();
  const config = useAppSelector((s) => s.config.config);
  const dispatch = useAppDispatch();
  const { modal, message } = App.useApp();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const exportConfig = () => {
    const data = includeSecrets ? config : stripKeys(config);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `web-agent-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importConfig = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<AppConfig>;
      if (!parsed || typeof parsed !== 'object' || (!parsed.agents && !parsed.settings)) throw new Error('not a config');
      const next = normalizeConfig(parsed);
      // Keep existing secrets for connections/tools the file has without them.
      next.providers = next.providers.map((p) => ({ ...p, apiKey: p.apiKey || config.providers.find((x) => x.id === p.id)?.apiKey || '' }));
      next.customTools = next.customTools.map((t) => ({ ...t, headers: t.headers || config.customTools.find((x) => x.id === t.id)?.headers || '' }));
      modal.confirm({
        title: 'Replace your configuration?',
        content: `This file has ${next.agents.length} agents, ${next.skills.length} skills, ${next.customTools.length} custom tools and ${next.providers.length} connections. Your current setup will be replaced.`,
        okText: 'Import',
        onOk: () => {
          dispatch(configActions.replaceConfig(next));
          message.success('Configuration imported');
        },
      });
    } catch {
      message.error("That file isn't a Web Agent configuration.");
    }
  };

  return (
    <>
      <PageHeader title="Advanced" description="For power users and developers. The defaults work well for most people." />
      <Section title="Developer view">
        <SettingRow label="Show technical details" description="Adds tool names, arguments, raw results, timings and error details to the activity view.">
          <Switch checked={settings.developerMode} onChange={(v) => update({ developerMode: v })} aria-label="Show technical details" />
        </SettingRow>
      </Section>
      <Section title="Page reading" description="How much of a page the agent reads at once. Higher values help on big pages but use more of the model's context.">
        <SettingRow label="Controls per read" description={`${settings.maxElements} buttons, links and fields`} stacked>
          <Slider min={50} max={600} step={25} value={settings.maxElements} onChange={(v) => update({ maxElements: v })} aria-label="Controls per read" />
        </SettingRow>
        <SettingRow label="Text per read" description={`About ${Math.round(settings.maxTextChars / 1000)}k characters`} stacked>
          <Slider min={4000} max={40000} step={1000} value={settings.maxTextChars} onChange={(v) => update({ maxTextChars: v })} aria-label="Text per read" />
        </SettingRow>
      </Section>
      <Section title="Configuration">
        <SettingRow label="Export" description="Download agents, skills, tools and settings as a file — to back up or share with your team.">
          <div className="row-gap align-center">
            <Checkbox checked={includeSecrets} onChange={(e) => setIncludeSecrets(e.target.checked)}>
              Include API keys
            </Checkbox>
            <Button icon={<Download size={14} />} onClick={exportConfig}>
              Export
            </Button>
          </div>
        </SettingRow>
        <SettingRow label="Import" description="Replace the current setup with one from a file.">
          <>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importConfig(f);
                e.target.value = '';
              }}
            />
            <Button icon={<Upload size={14} />} onClick={() => fileInput.current?.click()}>
              Import
            </Button>
          </>
        </SettingRow>
        <SettingRow label="Reset everything" description="Restore the default agents, skills and settings. Model connections are removed too.">
          <Button
            danger
            onClick={() =>
              modal.confirm({
                title: 'Reset all settings?',
                content: 'Agents, skills, custom tools, connections and preferences go back to the defaults. Activity history is kept.',
                okText: 'Reset',
                okButtonProps: { danger: true },
                onOk: () => {
                  dispatch(configActions.replaceConfig(defaultConfig()));
                  message.success('Settings reset');
                },
              })
            }
          >
            Reset
          </Button>
        </SettingRow>
      </Section>
    </>
  );
}
