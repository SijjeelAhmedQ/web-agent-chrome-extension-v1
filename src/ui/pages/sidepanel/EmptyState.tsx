import { Button, Select } from 'antd';
import { ArrowUpRight, Laptop, Plug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SUGGESTIONS } from '@/shared/constants/defaults';
import { modelLabel } from '@/shared/constants/providers';
import type { AgentConfig } from '@/shared/types/config';
import { useAppDispatch } from '@/store';
import { configActions } from '@/store/configSlice';
import { AgentAvatar, BrandMark } from '../../components/Brand';
import { NamedIcon } from '../../components/icons';
import { ollamaProvider, useOllamaProbe } from '../../hooks/useOllamaProbe';
import { openConfiguration } from '../../utils/navigation';

interface Props {
  agent: AgentConfig;
  hasModel: boolean;
  showSuggestions: boolean;
  canAct: boolean;
  onPick: (prompt: string, fill: boolean) => void;
}

/** First run: offer the Ollama found on this computer, or the full list of options. */
function SetupCard() {
  const dispatch = useAppDispatch();
  const ollama = useOllamaProbe(true);
  const [model, setModel] = useState<string | undefined>();
  useEffect(() => {
    if (ollama.models.length && !model) setModel(ollama.models[0]);
  }, [ollama.models, model]);

  if (ollama.found && ollama.models.length) {
    return (
      <div className="setup-card">
        <div className="setup-icon" aria-hidden>
          <Laptop size={18} />
        </div>
        <div className="setup-title">Ollama is running on this computer</div>
        <p className="setup-text">Use it to power the agent — nothing leaves your computer. Pick the model for actions:</p>
        <Select
          style={{ width: '100%', marginBottom: 12 }}
          value={model}
          onChange={setModel}
          options={ollama.models.map((m) => ({ value: m, label: modelLabel(m) === m ? m : `${modelLabel(m)} — ${m}` }))}
          aria-label="Ollama model"
        />
        <Button
          type="primary"
          block
          disabled={!model}
          onClick={() => {
            const provider = ollamaProvider(model!);
            dispatch(configActions.upsertProvider(provider));
            dispatch(configActions.updateSettings({ defaultProviderId: provider.id }));
          }}
        >
          Use Ollama
        </Button>
        <button type="button" className="link-btn small setup-alt" onClick={() => void openConfiguration('/models')}>
          Other options — Kaggle GPU, OpenRouter, OpenAI…
        </button>
      </div>
    );
  }

  return (
    <div className="setup-card">
      <div className="setup-icon" aria-hidden>
        <Plug size={18} />
      </div>
      <div className="setup-title">Connect an AI model to start</div>
      <p className="setup-text">
        {ollama.checking
          ? 'Looking for Ollama on this computer…'
          : ollama.found
            ? 'Ollama is running but has no models yet — run “ollama pull qwen3.5:9b”, or choose another option.'
            : 'Use Ollama on this computer, your Kaggle GPU notebook, or a service like OpenRouter, OpenAI or Anthropic. It takes about a minute.'}
      </p>
      <Button type="primary" block onClick={() => void openConfiguration('/models')}>
        Connect a model
      </Button>
    </div>
  );
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
        <SetupCard />
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
