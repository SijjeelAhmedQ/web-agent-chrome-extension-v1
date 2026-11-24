import type { ReactNode } from 'react';
import type { AgentConfig } from '@/shared/types/config';
import { AgentAvatar } from '../../components/Brand';

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}

export function Section({ title, description, children, actions }: { title?: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="section">
      {(title || actions) && (
        <div className="section-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="section-card">{children}</div>
    </section>
  );
}

export function SettingRow({ label, description, children, htmlFor, stacked }: { label: ReactNode; description?: ReactNode; children: ReactNode; htmlFor?: string; stacked?: boolean }) {
  return (
    <div className={`setting-row ${stacked ? 'stacked' : ''}`}>
      <div className="setting-text">
        {htmlFor ? (
          <label className="setting-label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <div className="setting-label">{label}</div>
        )}
        {description && <div className="setting-desc">{description}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export function AvatarStack({ agents, max = 4 }: { agents: AgentConfig[]; max?: number }) {
  if (!agents.length) return <span className="muted small">No agents</span>;
  return (
    <span className="avatar-stack" aria-label={agents.map((a) => a.name).join(', ')}>
      {agents.slice(0, max).map((a) => (
        <AgentAvatar key={a.id} avatar={a.avatar} size={22} />
      ))}
      {agents.length > max && <span className="avatar-more">+{agents.length - max}</span>}
    </span>
  );
}

export function FieldLabel({ children, hint, htmlFor }: { children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <div className="field-label">
      <label htmlFor={htmlFor}>{children}</label>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function EmptyBlock({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty-block">
      <div className="empty-block-icon">{icon}</div>
      <div className="empty-block-title">{title}</div>
      <div className="empty-block-text">{text}</div>
      {action}
    </div>
  );
}
