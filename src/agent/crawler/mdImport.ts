import { recordCall } from '@/shared/storage/costLedger';
import type { AgentConfig, AppConfig, KnowledgeBase } from '@/shared/types/config';
import { uid } from '@/shared/utils';
import { createClient } from '../llm';
import { knowledgeAsText, parseKnowledgeText, type ParsedEntry } from '../planner/knowledgeText';
import { contextWindowOf, resolveProvider } from '../runtime/agentRun';
import { meteredClient } from '../runtime/costLog';
import { entryKey, hostOf, type ProposedEntry } from './merge';
import { KNOWLEDGE_FORMAT, KNOWLEDGE_ROLE, parseWritten } from './prompts';

/**
 * A knowledge base the user writes (or edits) as a Markdown file — the template the export writes, so a file
 * exported, edited and uploaded again comes back as it was:
 *
 *   # OctansCare
 *   Sites: octanschiro-dev-app.vitonta.com
 *
 *   ### Rule: Buttons you never click here
 *   The user clicks these themselves: “Remove station”.
 *
 *   ### Workflow: Add a practice member
 *   For requests like: “add a new practice member”
 *   1. …
 *
 * A file not in the template (free notes, a spec) can be turned into entries by the model.
 * What a file says wins over what a crawl learns: a later crawl never overwrites it.
 */
export interface KnowledgeFile {
  /** The `# Name` heading, when there is one. */
  name: string;
  /** The `Sites:` line: hosts. */
  sites: string[];
  entries: ParsedEntry[];
  neverClick: string[];
  /** `###` headings of no known kind. */
  unknown: string[];
  /** It has the template's `### Kind: Title` blocks. */
  templated: boolean;
}

/**
 * A knowledge base as its Markdown file — the template uploading reads back. Exported, edited and uploaded again,
 * it comes back as it was (entries, switched-off ones, workflow examples, the never-click list, the site).
 */
export function knowledgeFileText(kb: Pick<KnowledgeBase, 'name' | 'sites' | 'entries' | 'neverClick'>): string {
  return `# ${kb.name}\n\nSites: ${kb.sites.join(', ')}\n\n${knowledgeAsText({ knowledge: kb.entries, neverClick: kb.neverClick })}\n`;
}

/** The file's name: `octanschiro-dev-app.vitonta.com-knowledge.md`. */
export const knowledgeFileName = (kb: Pick<KnowledgeBase, 'name'>, ext: 'md' | 'json' = 'md') => `${kb.name.replace(/[^\w.-]+/g, '-')}-knowledge.${ext}`;

/** A host out of what a person writes there: `https://app.x.com/path`, `app.x.com`, `*.x.com`. */
export function hostIn(s: string): string {
  const t = s.trim().replace(/^[<(“"']+|[>)”"'.,;]+$/g, '');
  if (!t) return '';
  if (t.startsWith('*.')) return t.toLowerCase();
  return hostOf(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`);
}

export function readKnowledgeFile(text: string): KnowledgeFile {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const name = lines.map((l) => /^\s*#\s+(.+?)\s*$/.exec(l)?.[1]).find(Boolean) ?? '';
  const sitesLine = lines.map((l) => /^\s*(?:sites?|website|url|host)\s*:\s*(.+)$/i.exec(l)?.[1]).find(Boolean) ?? '';
  const sites = [...new Set(sitesLine.split(/[,\s]+/).map(hostIn).filter(Boolean))];
  const parsed = parseKnowledgeText(text);
  return {
    name: name.replace(/\s*[—-]\s*knowledge( base)?$/i, '').trim(),
    sites,
    entries: parsed.entries,
    neverClick: parsed.neverClick ?? [],
    unknown: parsed.unknown,
    templated: parsed.entries.length > 0 || (parsed.neverClick?.length ?? 0) > 0,
  };
}

/** The file's entries as proposals to review: all ticked; marked “update” when the knowledge base has one like it. */
export function fileProposals(entries: ParsedEntry[], existing: KnowledgeBase | undefined, source = 'file'): ProposedEntry[] {
  // “update” only where the file says something else — an entry it repeats unchanged isn't an update.
  const have = new Map((existing?.entries ?? []).map((e) => [entryKey(e.kind, e.title), `${e.content.trim()}|${(e.trigger ?? '').trim()}`]));
  const differs = (e: ParsedEntry) => {
    const was = have.get(entryKey(e.kind, e.title));
    return was !== undefined && was !== `${e.content.trim()}|${(e.trigger ?? '').trim()}`;
  };
  return entries
    .filter((e) => e.title.trim() && e.content.trim())
    .map((e) => ({
      id: uid('prop_'),
      kind: e.kind,
      title: e.title.trim(),
      content: e.content.trim(),
      ...(e.trigger ? { trigger: e.trigger } : {}),
      source,
      selected: e.enabled !== false,
      ...(differs(e) ? { update: true } : {}),
    }));
}

/** Most of a file the model is given at once. */
const MAX_FILE_CHARS = 60_000;

/**
 * A file not in the template, turned into knowledge entries by the agent's model (thinking off, to keep it cheap).
 * Only what the file says — the model is told never to add to it.
 */
export async function convertWithModel(o: { text: string; host: string; config: AppConfig; agent: AgentConfig; signal?: AbortSignal }): Promise<{ entries: ParsedEntry[]; neverClick: string[]; cost: number }> {
  const url = `https://${o.host.replace(/^\*\./, '')}/`;
  const { provider, model } = resolveProvider(o.agent, o.config, url);
  if (!model) throw new Error(`Choose which model to use with ${provider.name}.`);
  let cost = 0;
  const client = meteredClient(createClient({ ...provider, thinking: 'off' }), 'worker', () => '', (call) => {
    cost += call.cost ?? 0;
    void recordCall(call, o.host || 'knowledge file', uid('md_')).catch(() => undefined);
  });
  // About half the model's room (in characters, ~4 a token), and never more than a whole file needs.
  const room = Math.min(MAX_FILE_CHARS, Math.max(8_000, (contextWindowOf(provider) ?? 32_000) * 2));
  const text = o.text.length > room ? `${o.text.slice(0, room)}\n[…the rest of the file was cut]` : o.text;
  const res = await client.chat({
    model,
    temperature: 0.1,
    tools: [],
    signal: o.signal,
    purpose: 'Turning a knowledge file into entries',
    messages: [
      { role: 'system', content: `${KNOWLEDGE_ROLE}\n\n${KNOWLEDGE_FORMAT}` },
      {
        role: 'user',
        content: [
          `Below is a document the user wrote about the website ${o.host || '(the site)'}. Turn it into knowledge entries: pages and their controls, how to reach them (navigation), rules, and workflows (numbered steps, with an example request as trigger).`,
          'Use only what the document says — never add controls, pages or steps it does not have. Keep its own wording for names of buttons, fields and menus. Buttons it says must never be clicked go into neverClick.',
          '',
          '--- The document ---',
          text,
        ].join('\n'),
      },
    ],
  });
  const written = parseWritten(res.content);
  return {
    entries: written.entries.map((e) => ({ kind: e.kind, title: e.title, content: e.content, ...(e.trigger ? { trigger: e.trigger } : {}), enabled: true })),
    neverClick: written.neverClick,
    cost,
  };
}
