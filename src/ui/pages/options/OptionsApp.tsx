import { Segmented, Tooltip } from 'antd';
import {
  Activity,
  Blocks,
  Bot,
  Cpu,
  Lock,
  Mic,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Terminal,
  Wrench,
} from 'lucide-react';
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { ThemeMode } from '@/shared/types/config';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';
import { BrandMark } from '../../components/Brand';
import { ActivityPage } from './ActivityPage';
import { AgentsPage } from './AgentsPage';
import { ModelsPage } from './ModelsPage';
import { AdvancedPage, AppearancePage, BehaviorPage, GeneralPage, PermissionsPage, PrivacyPage } from './PreferencePages';
import { SkillsPage } from './SkillsPage';
import { ToolsPage } from './ToolsPage';
import { VoicePage } from './VoicePage';

const NAV = [
  {
    group: 'Workspace',
    items: [
      { to: '/agents', label: 'Agents', icon: Bot },
      { to: '/skills', label: 'Skills', icon: Sparkles },
      { to: '/tools', label: 'Tools', icon: Wrench },
      { to: '/models', label: 'Models', icon: Cpu },
      { to: '/voice', label: 'Voice', icon: Mic },
    ],
  },
  {
    group: 'Preferences',
    items: [
      { to: '/general', label: 'General', icon: SlidersHorizontal },
      { to: '/appearance', label: 'Appearance', icon: Palette },
      { to: '/behavior', label: 'Agent behavior', icon: Blocks },
      { to: '/permissions', label: 'Permissions', icon: ShieldCheck },
      { to: '/privacy', label: 'Privacy', icon: Lock },
      { to: '/advanced', label: 'Advanced', icon: Terminal },
    ],
  },
  { group: 'History', items: [{ to: '/activity', label: 'Activity', icon: Activity }] },
];

function ThemeSwitch() {
  const theme = useAppSelector((s) => s.config.config.settings.theme);
  const dispatch = useAppDispatch();
  return (
    <Segmented<ThemeMode>
      size="small"
      value={theme}
      onChange={(v) => dispatch(configActions.updateSettings({ theme: v }))}
      options={[
        { value: 'system', label: <Tooltip title="Match system"><Monitor size={14} aria-label="System theme" /></Tooltip> },
        { value: 'light', label: <Tooltip title="Light"><Sun size={14} aria-label="Light theme" /></Tooltip> },
        { value: 'dark', label: <Tooltip title="Dark"><Moon size={14} aria-label="Dark theme" /></Tooltip> },
      ]}
    />
  );
}

export function OptionsApp() {
  const hydrated = useAppSelector((s) => s.config.hydrated);
  const providers = useAppSelector((s) => s.config.config.providers.length);
  const version = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : 'dev';

  return (
    <HashRouter>
      <div className="options">
        <aside className="sidebar" aria-label="Configuration sections">
          <div className="sidebar-brand">
            <BrandMark size={30} />
            <div>
              <div className="sidebar-title">Web Agent</div>
              <div className="sidebar-sub">Configuration</div>
            </div>
          </div>
          <nav className="sidebar-nav">
            {NAV.map((g) => (
              <div className="nav-group" key={g.group}>
                <div className="nav-group-label">{g.group}</div>
                {g.items.map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <Icon size={16} aria-hidden />
                    <span>{label}</span>
                    {to === '/models' && hydrated && providers === 0 && <span className="nav-dot" aria-label="Needs setup" />}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-foot">
            <ThemeSwitch />
            <span className="sidebar-version">v{version}</span>
          </div>
        </aside>
        <main className="content">
          {hydrated && (
            <div className="content-inner">
              <Routes>
                <Route path="/" element={<Navigate to={providers ? '/agents' : '/models'} replace />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/skills" element={<SkillsPage />} />
                <Route path="/tools" element={<ToolsPage />} />
                <Route path="/models" element={<ModelsPage />} />
                <Route path="/voice" element={<VoicePage />} />
                <Route path="/general" element={<GeneralPage />} />
                <Route path="/appearance" element={<AppearancePage />} />
                <Route path="/behavior" element={<BehaviorPage />} />
                <Route path="/permissions" element={<PermissionsPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/advanced" element={<AdvancedPage />} />
                <Route path="/activity" element={<ActivityPage />} />
                <Route path="*" element={<Navigate to="/agents" replace />} />
              </Routes>
            </div>
          )}
        </main>
      </div>
    </HashRouter>
  );
}
