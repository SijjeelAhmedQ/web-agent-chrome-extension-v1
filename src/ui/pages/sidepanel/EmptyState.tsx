import { Button } from 'antd';
import { ArrowUpRight, Plug } from 'lucide-react';
import { SUGGESTIONS } from '@/shared/constants/defaults';
import type { AgentConfig } from '@/shared/types/config';
import { AgentAvatar, BrandMark } from '../../components/Brand';
import { NamedIcon } from '../../components/icons';
import { openConfiguration } from '../../utils/navigation';

interface Props {
  agent: AgentConfig;
  hasModel: boolean;
  showSuggestions: boolean;
  canAct: boolean;
  onPick: (prompt: string, fill: boolean) => void;
}

export function EmptyState({ agent, hasModel, showSuggestions, canAct, onPick }: Props) {
  const isDefault = agent.id === 'agent-assistant';
  return (
    <div className="empty">
      <div className="empty-hero">
        {isDefault ? <BrandMark size={44} /> : <AgentAvatar avatar={agent.avatar} size={44} />}
        <h1 className="empty-title">What can I do for you?</h1>
        <p className="empty-sub">{isDefault ? 'I can read this page, search, fill in forms and click through websites for you.' : agent.description}</p>
      </div>

      {!hasModel ? (
        <div className="setup-card">
          <div className="setup-icon" aria-hidden>
            <Plug size={18} />
          </div>
          <div className="setup-title">Connect an AI model to start</div>
          <p className="setup-text">Use a local model like Ollama, or a service like OpenRouter, OpenAI or Anthropic. It takes about a minute.</p>
          <Button type="primary" block onClick={() => void openConfiguration('/models')}>
            Connect a model
          </Button>
        </div>
      ) : (
        showSuggestions && (
          <ul className="suggestions" aria-label="Suggestions">
            {SUGGESTIONS.filter((s) => canAct || s.label === 'Summarize this page' || s.label === 'Find something').map((s) => (
              <li key={s.label}>
                <button type="button" className="suggestion" onClick={() => onPick(s.prompt, 'fill' in s && !!s.fill)}>
                  <span className="suggestion-icon">
                    <NamedIcon name={s.icon} size={15} />
                  </span>
                  <span className="suggestion-label">{s.label}</span>
                  <ArrowUpRight size={14} className="suggestion-arrow" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
