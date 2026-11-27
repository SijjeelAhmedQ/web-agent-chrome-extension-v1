import { DEFAULT_DECISION_MODEL, DEFAULT_PICKABLE_MODELS, knownModel } from '@/shared/constants/providers';
import type { PickableModel } from '@/shared/types/config';
import type { TaskKind } from '@/shared/types/history';

/**
 * Which model does a task, when the agent's decision model is on. Plain clicks go to the cheapest model on the
 * user's list with no decision model at all: deciding that costs nothing. Data analysis: the cheapest model does the
 * clicks and the reading, and the decision model picks who writes it. Anything else (changing a record, or a request
 * the words don't settle): the decision model picks the model that does it. The models it picks from are the user's
 * list (Settings → Models): the decision model can't know what the user's key can call, today's prices, or models
 * newer than itself — so it is told, and its answer must be one of them.
 */

export { DEFAULT_DECISION_MODEL, DEFAULT_PICKABLE_MODELS };

// Changing a record outweighs everything: “summarise and add a task” needs care, not just a good summary.
const CHANGES = /\b(add|create|save|dismiss|delete|remove|file|unfile|update|edit|change|send|complete|book|schedule|submit|approve|assign|fill|banao|likho|bhejo|hatao|mitao)\b/i;
const ANALYSIS = /\b(summar\w*|trends?|analy[sz]\w*|issues?|abnormal\w*|why|compare\w*|explain\w*|review\w*|interpret\w*|findings?|what|how many|kitne|kitni|kyun|kya)\b/i;
const CLICKS = /\b(go ?to|open|click|press|select|choose|search|find|navigate|scroll|back|close|show|switch|hover|tick|untick|type|list|kholo|jao|dabao|dhoondo|dikhao|chuno)\b/i;

/** What a request is, from its words alone, and the word that says so. A request none of them fits goes to the decision model. */
export function kindOfTask(request: string): { kind: TaskKind; word?: string } {
  const change = request.match(CHANGES);
  if (change) return { kind: 'judged', word: change[0] };
  const analysis = request.match(ANALYSIS);
  if (analysis) return { kind: 'analysis', word: analysis[0] };
  const click = request.match(CLICKS);
  return click ? { kind: 'clicks', word: click[0] } : { kind: 'judged' };
}

/** “Claude Haiku 5.5” for models we know, the id as it is otherwise. */
export const pickLabel = (id: string): string => knownModel(id)?.label ?? id;

/** The models on the list that can click and type: a model known to lack tools can't do a step. */
export const withTools = (list: PickableModel[]): PickableModel[] => list.filter((m) => m.id.trim() && m.tools !== false);

/** The cheapest model on the list that can do steps (by its input price; without prices, the first on the list). */
export function cheapestOf(list: PickableModel[]): PickableModel | undefined {
  const usable = withTools(list);
  return usable.reduce<PickableModel | undefined>((best, m) => (!best || (m.price?.input ?? Infinity) < (best.price?.input ?? Infinity) ? m : best), undefined);
}

/** “$0.83 in / $4.13 out per million tokens”. */
export function describePrice(price: PickableModel['price']): string {
  if (!price) return 'price not known';
  const $ = (n: number) => `$${+n.toFixed(3)}`;
  return `${$(price.input)} in / ${$(price.output)} out per million tokens`;
}

const JOB: Record<'analysis' | 'judged' | 'stuck', string> = {
  analysis:
    'The page data is already read by another model; the one you pick only writes the answer from it — it takes no steps. A count, a total or a value the data already shows (e.g. “how many”, “what is”) needs little: pick the cheapest. Summaries, trends, comparing records or explaining results need a strong one.',
  judged: 'The model you pick does the whole task in a web app with tools (read the page, click, type, fill forms, save). Pick the cheapest one that will do it right: going to pages and simple reading need little; filling forms and saving records need care.',
  stuck: 'The model that started this task got stuck. The one you pick carries on from where it is: pick one stronger than it.',
};

/** The decision model's whole prompt: the request and the models. Its answer costs a few tokens, not a page and the site's knowledge. */
export function choosePrompt(request: string, models: PickableModel[], job: keyof typeof JOB): string {
  return [
    'Pick the model for this browser-agent task. Reply with the model id only, exactly as written below.',
    JOB[job],
    'The models:',
    ...models.map((m) => `- ${m.id} (${pickLabel(m.id)}; ${describePrice(m.price)})${m.note?.trim() ? `: ${m.note.trim()}` : ''}`),
    `Task: ${request.slice(0, 500)}`,
  ].join('\n');
}

/** The model the reply names, if it is on the list: its id, else its name (“Claude Haiku 5.5”); the longest that fits. */
export function parsePick(reply: string, models: PickableModel[]): PickableModel | null {
  const text = reply.toLowerCase();
  // “~deepseek/…” is OpenRouter's “latest of” alias: the reply may leave the ~ out.
  const named = models
    .flatMap((m) => [m.id.replace(/^~/, ''), pickLabel(m.id)].map((name) => ({ m, name: name.trim().toLowerCase() })))
    .filter(({ name }) => name && text.includes(name))
    .sort((a, b) => b.name.length - a.name.length);
  return named[0]?.m ?? null;
}
