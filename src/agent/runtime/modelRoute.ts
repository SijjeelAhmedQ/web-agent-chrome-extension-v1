import type { AutoModels } from '@/shared/types/config';
import type { ModelTier, TaskKind } from '@/shared/types/history';

/**
 * Which model does a task. Plain clicks go to the small model with no chooser at all: deciding that costs nothing.
 * Data analysis: the small model does the clicks and the reading, a bigger one writes the analysis. Anything else
 * (changing a record, or a request the words don't settle): Jev Router picks the model and decides each step.
 */

export const DEFAULT_AUTO_MODELS: AutoModels = {
  small: '~deepseek/deepseek-flash-latest',
  medium: 'anthropic/claude-haiku-5.5',
  big: 'google/gemini-3.8-flash',
  chooser: 'typesafe/jev-router',
};

// Changing a record outweighs everything: “summarise and add a task” needs care, not just a good summary.
const CHANGES = /\b(add|create|save|dismiss|delete|remove|file|unfile|update|edit|change|send|complete|book|schedule|submit|approve|assign|fill|banao|likho|bhejo|hatao|mitao)\b/i;
const ANALYSIS = /\b(summar\w*|trends?|analy[sz]\w*|issues?|abnormal\w*|why|compare\w*|explain\w*|review\w*|interpret\w*|findings?|what|how many|kitne|kitni|kyun|kya)\b/i;
const CLICKS = /\b(go ?to|open|click|press|select|choose|search|find|navigate|scroll|back|close|show|switch|hover|tick|untick|type|list|kholo|jao|dabao|dhoondo|dikhao|chuno)\b/i;

/** Asks to see a list (“show all abnormal records”): that word only names a filter, and nothing is analysed. */
const ONLY_SHOWS = /\b(show|list|filter|dikhao)\b.*\b(abnormal|normal|filed|unfiled)\s+(records?|results?)\b|\b(abnormal|normal|filed|unfiled)\s+(records?|results?)\b.*\b(dikhao|show karo)\b/i;
/** Asks how many records there are: the page's own counts say, with nothing read. */
const ONLY_COUNTS = /\b(how many|kitne|kitni)\b.*\b(records?|results?|reports?)\b/i;

/** What a request is, from its words alone, and the word that says so. A request none of them fits goes to the chooser. */
export function kindOfTask(request: string): { kind: TaskKind; word?: string } {
  const change = request.match(CHANGES);
  if (change) return { kind: 'judged', word: change[0] };
  const counts = request.match(ONLY_COUNTS);
  // What is left when the words of a filter or a count are taken out: “summarize” there is still analysis.
  const rest = counts || ONLY_SHOWS.test(request) ? request.replace(/\babnormal\b/gi, ' ').replace(/\b(how many|kitne|kitni)\b/gi, ' ') : request;
  const analysis = rest.match(ANALYSIS);
  if (analysis) return { kind: 'analysis', word: analysis[0] };
  if (counts) return { kind: 'clicks', word: counts[1] };
  const click = request.match(CLICKS);
  return click ? { kind: 'clicks', word: click[0] } : { kind: 'judged' };
}

/** The tiers the chooser may pick from: analysis is never the small model's. */
export const tiersFor = (kind: TaskKind): ModelTier[] => (kind === 'analysis' ? ['medium', 'big'] : ['small', 'medium', 'big']);

/** Used when the chooser can't be reached or answers something else. */
export const fallbackTier = (kind: TaskKind): ModelTier => (kind === 'analysis' ? 'big' : 'medium');

const WHEN: Record<ModelTier, string> = {
  small: 'SMALL: only clicks, going to pages, simple reading.',
  medium: 'MEDIUM: filling a form, adding or saving something, a short look at a result.',
  big: 'BIG: data analysis, summaries, trends, several records compared, hard judgement.',
};

/** The chooser's whole prompt: the request and the tiers. Its answer costs a few tokens, not a page and the site's knowledge. */
export function choosePrompt(request: string, tiers: ModelTier[]): string {
  return [
    `Pick the model for this browser-agent task. Reply with one word only: ${tiers.map((t) => t.toUpperCase()).join(', ')}.`,
    ...tiers.map((t) => WHEN[t]),
    `Task: ${request.slice(0, 500)}`,
  ].join('\n');
}

/** The tier in the chooser's reply, if it is one it may pick. */
export function parseTier(reply: string, tiers: ModelTier[]): ModelTier | null {
  const word = reply.toLowerCase().match(/\b(small|medium|big)\b/)?.[1] as ModelTier | undefined;
  return word && tiers.includes(word) ? word : null;
}

/** Each model's part in the task's log; a model named twice in the settings counts as the bigger part. */
export function tierOfModel(auto: AutoModels, model: string): ModelTier | 'chooser' | undefined {
  if (model === auto.chooser) return 'chooser';
  return (['big', 'medium', 'small'] as const).find((t) => auto[t] === model);
}
