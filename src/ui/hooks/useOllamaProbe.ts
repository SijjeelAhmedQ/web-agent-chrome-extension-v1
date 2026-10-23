import { useEffect, useState } from 'react';
import { createClient } from '@/agent/llm';
import { DEFAULT_CONTEXT_WINDOW } from '@/agent/llm/ollama';
import { presetById } from '@/shared/constants/providers';
import type { ProviderConfig } from '@/shared/types/config';
import { uid } from '@/shared/utils';

const PREFERRED = ['qwen3.5:9b', 'qwen3.5:4b', 'qwen3:8b', 'qwen3:4b', 'llama3.1:8b'];

/** A ready-to-save connection for the Ollama on this computer. */
export function ollamaProvider(model: string): ProviderConfig {
  const preset = presetById('ollama');
  return {
    id: uid('prov_'),
    name: 'Ollama',
    kind: preset.kind,
    preset: preset.id,
    baseUrl: preset.baseUrl,
    apiKey: '',
    defaultModel: model,
    thinking: 'off',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    createdAt: Date.now(),
  };
}

/**
 * Looks for Ollama on this computer (only while no model is connected), so the first-run
 * card can offer it in one click. Returns its models, best choice first.
 */
export function useOllamaProbe(enabled: boolean): { found: boolean; models: string[]; checking: boolean } {
  const [state, setState] = useState({ found: false, models: [] as string[], checking: enabled });
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, checking: true }));
    createClient(ollamaProvider(''))
      .listModels(ctrl.signal)
      .then((models) => {
        const ranked = [...models].sort((a, b) => rank(a) - rank(b));
        setState({ found: true, models: ranked, checking: false });
      })
      .catch(() => setState({ found: false, models: [], checking: false }));
    return () => ctrl.abort();
  }, [enabled]);
  return state;
}

function rank(model: string): number {
  const i = PREFERRED.indexOf(model);
  if (i >= 0) return i;
  // Embedding and vision-only models can't drive an agent.
  return /embed|vision|whisper|guard/i.test(model) ? 1000 : 100;
}
