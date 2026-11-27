import { App, AutoComplete, Button, Input, Tooltip } from 'antd';
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fetchOpenRouterModels, withListedDetails, type OpenRouterModel } from '@/agent/llm/openRouterModels';
import { describePrice } from '@/agent/runtime/modelRoute';
import { DEFAULT_PICKABLE_MODELS, knownModel } from '@/shared/constants/providers';
import type { PickableModel } from '@/shared/types/config';
import { toAgentError } from '@/shared/utils/errors';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';
import { Section } from './parts';

const same = (a: PickableModel[], b: PickableModel[]) => JSON.stringify(a) === JSON.stringify(b);
/** The same models and notes — prices filled in from OpenRouter don't make it the user's own list. */
const sameChoice = (a: PickableModel[], b: PickableModel[]) => same(a.map(({ id, note }) => ({ id, note })), b.map(({ id, note }) => ({ id, note })));

/**
 * Settings → Models: the models an agent's decision model picks from, per task. Any OpenRouter model can be added;
 * its price and tool support come from OpenRouter's list, so the decision model can weigh them.
 */
export function PickableModels() {
  const { providers, settings, agents } = useAppSelector((s) => s.config.config);
  const dispatch = useAppDispatch();
  const { message } = App.useApp();
  const list = settings.pickableModels ?? DEFAULT_PICKABLE_MODELS;
  const [listed, setListed] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openRouter = providers.find((p) => /openrouter\.ai/.test(p.baseUrl));
  const using = agents.filter((a) => a.decisionModel).length;
  const latest = useRef(list);
  latest.current = list;

  const save = (next: PickableModel[]) => dispatch(configActions.updateSettings({ pickableModels: next }));

  /** OpenRouter's list, and every model on ours brought up to date with its price and tools. */
  const refresh = async (quiet: boolean) => {
    if (!openRouter) return;
    setLoading(true);
    setError(null);
    try {
      const models = await fetchOpenRouterModels(openRouter);
      setListed(models);
      const next = withListedDetails(latest.current, models);
      if (!same(next, latest.current)) save(next);
      if (!quiet) message.success('Prices brought up to date from OpenRouter');
    } catch (err) {
      setError(toAgentError(err).userMessage);
    } finally {
      setLoading(false);
    }
  };

  // Once, on opening: prices change, and a model added before had none.
  useEffect(() => {
    void refresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRouter?.baseUrl]);

  const change = (i: number, patch: Partial<PickableModel>) => save(list.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  /** A model id typed or chosen: its price and tools from OpenRouter's list, when it is there. */
  const setId = (i: number, id: string) => {
    const found = listed.find((m) => m.id === id);
    const { price: _p, tools: _t, ...rest } = list[i];
    save(list.map((m, j) => (j === i ? { ...rest, id, ...(found ? { ...(found.price ? { price: found.price } : {}), tools: found.tools } : {}) } : m)));
  };
  const move = (i: number, by: number) => {
    const next = [...list];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    save(next);
  };

  const options = listed.map((m) => ({ value: m.id, label: `${m.name} — ${m.id}` }));

  return (
    <Section
      title="Models the decision model picks from"
      description={
        <>
          An agent with its Decision model on picks one of these for each task — the cheapest that will do it right. Add any OpenRouter model; the price and
          tool support come from OpenRouter, and your note tells the decision model what it is good for. Clicks go to the cheapest without asking it.
          {using ? ` Used by ${using} agent${using === 1 ? '' : 's'}.` : ' No agent has its Decision model on yet (Agents → an agent → Model).'}
        </>
      }
      actions={
        <Tooltip title={openRouter ? 'Get the latest prices from OpenRouter' : 'Add an OpenRouter connection first'}>
          <Button icon={<RefreshCw size={14} className={loading ? 'spin' : ''} />} onClick={() => void refresh(false)} disabled={!openRouter}>
            Refresh prices
          </Button>
        </Tooltip>
      }
    >
      <div className="pick-list">
        {list.map((m, i) => {
          const noTools = m.tools === false;
          return (
            <div key={i} className="pick-row">
              <div className="pick-main">
                <AutoComplete
                  value={m.id}
                  onChange={(v) => setId(i, v)}
                  options={options}
                  filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                  placeholder="Model id, e.g. openai/gpt-5-mini"
                  aria-label={`Model ${i + 1}`}
                  style={{ width: '100%' }}
                />
                <Input value={m.note ?? ''} onChange={(e) => change(i, { note: e.target.value })} placeholder="What it is good for (optional), e.g. forms and saving records" aria-label={`Note for model ${i + 1}`} />
                <div className="pick-facts">
                  {knownModel(m.id)?.label && <span>{knownModel(m.id)!.label}</span>}
                  <span>{describePrice(m.price)}</span>
                  {noTools && <span className="pill warning">No tools — never picked</span>}
                </div>
              </div>
              <div className="pick-side">
                <Tooltip title="Up">
                  <Button size="small" type="text" icon={<ArrowUp size={14} />} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move model ${i + 1} up`} />
                </Tooltip>
                <Tooltip title="Down">
                  <Button size="small" type="text" icon={<ArrowDown size={14} />} disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={`Move model ${i + 1} down`} />
                </Tooltip>
                <Tooltip title={list.length === 1 ? 'The decision model needs at least one' : 'Remove'}>
                  <Button size="small" type="text" danger icon={<Trash2 size={14} />} disabled={list.length === 1} onClick={() => save(list.filter((_, j) => j !== i))} aria-label={`Remove model ${i + 1}`} />
                </Tooltip>
              </div>
            </div>
          );
        })}
        <div className="pick-foot">
          <Button icon={<Plus size={14} />} onClick={() => save([...list, { id: '' }])}>
            Add a model
          </Button>
          {settings.pickableModels && !sameChoice(settings.pickableModels, DEFAULT_PICKABLE_MODELS) && (
            <Button type="text" onClick={() => save(withListedDetails(DEFAULT_PICKABLE_MODELS, listed))}>
              Back to the built-in list
            </Button>
          )}
        </div>
        {error && <div className="field-error">Couldn’t get OpenRouter’s list: {error}</div>}
        {!openRouter && <div className="field-help">Add an OpenRouter connection above to get each model’s price — the decision model works only there.</div>}
      </div>
    </Section>
  );
}
