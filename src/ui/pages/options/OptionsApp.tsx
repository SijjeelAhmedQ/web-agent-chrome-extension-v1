import { Drawer, Segmented, Tooltip } from 'antd';
import { Globe,
  Activity,
  Blocks,
  Bot,
  Cpu,
  Lock,
  Menu,
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
import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ThemeMode } from '@/shared/types/config';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';
import { BrandMark } from '../../components/Brand';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { ActivityPage } from './ActivityPage';
import { AgentsPage } from './AgentsPage';
import { ModelsPage } from './ModelsPage';
import { AdvancedPage, AppearancePage, BehaviorPage, GeneralPage, PermissionsPage, PrivacyPage } from './PreferencePages';
import { SiteDetailPage, SitesPage } from './SitesPage';
import { SkillsPage } from './SkillsPage';
import { ToolsPage } from './ToolsPage';
import { VoicePage } from './VoicePage';

const NAV = [
  {
    group: 'Extension base',
    items: [
      { to: '/agents', label: 'Agents', icon: Bot },
      { to: '/skills', label: 'Skills', icon: Sparkles },
      { to: '/tools', label: 'Tools', icon: Wrench },
      { to: '/models', label: 'Models', icon: Cpu },
      { to: '/voice', label: 'Voice', icon: Mic },
    ],
  },
  { group: 'Site base', items: [{ to: '/sites', label: 'Sites', icon: Globe }] },
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

function NavList({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
  const hydrated = useAppSelector((s) => s.config.hydrated);
  const providers = useAppSelector((s) => s.config.config.providers.length);
  return (
    <nav className="sidebar-nav">
      {NAV.map((g) => (
        <div className="nav-group" key={g.group}>
          <div className="nav-group-label">{g.group}</div>
          {g.items.map(({ to, label, icon: Icon }) => {
            const link = (
              <NavLink key={to} to={to} onClick={onNavigate} aria-label={label} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Icon size={17} aria-hidden />
                <span className="nav-label">{label}</span>
                {to === '/models' && hydrated && providers === 0 && <span className="nav-dot" aria-label="Needs setup" />}
              </NavLink>
            );
            return compact ? (
              <Tooltip key={to} title={label} placement="right" mouseEnterDelay={0.2}>
                {link}
              </Tooltip>
            ) : (
              link
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Phone: a top bar with the section name and a menu button that opens the navigation. */
function MobileBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="mobile-bar">
      <button type="button" className="icon-btn" aria-label="Open menu" onClick={onMenu}>
        <Menu size={20} />
      </button>
      <BrandMark size={26} />
      <span className="mobile-title">Web Agent</span>
      <span className="mobile-sub">Configuration</span>
    </header>
  );
}

function Shell() {
  const hydrated = useAppSelector((s) => s.config.hydrated);
  const providers = useAppSelector((s) => s.config.config.providers.length);
  const version = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : 'dev';
  const phone = useMediaQuery('(max-width: 767px)');
  const rail = useMediaQuery('(min-width: 768px) and (max-width: 1099px)');
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMenuOpen(false), [pathname]);

  const brand = (
    <div className="sidebar-brand">
      <BrandMark size={30} />
      <div className="sidebar-brand-text">
        <div className="sidebar-title">Web Agent</div>
        <div className="sidebar-sub">Configuration</div>
      </div>
    </div>
  );

  return (
    <div className={`options ${phone ? 'is-phone' : rail ? 'is-rail' : 'is-wide'}`}>
      {phone ? (
        <>
          <MobileBar onMenu={() => setMenuOpen(true)} />
          <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} placement="left" width={290} title={null} closable={false} rootClassName="nav-drawer">
            <div className="sidebar in-drawer">
              {brand}
              <NavList compact={false} onNavigate={() => setMenuOpen(false)} />
              <div className="sidebar-foot">
                <ThemeSwitch />
                <span className="sidebar-version">v{version}</span>
              </div>
            </div>
          </Drawer>
        </>
      ) : (
        <aside className="sidebar" aria-label="Configuration sections">
          {brand}
          <NavList compact={rail} />
          <div className="sidebar-foot">
            <ThemeSwitch />
            <span className="sidebar-version">v{version}</span>
          </div>
        </aside>
      )}
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
              <Route path="/sites" element={<SitesPage />} />
              <Route path="/sites/:siteId" element={<SiteDetailPage />} />
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
  );
}

export function OptionsApp() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
