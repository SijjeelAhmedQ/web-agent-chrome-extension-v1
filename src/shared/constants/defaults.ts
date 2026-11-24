import type { AgentConfig, AppConfig, Settings, SkillConfig } from '../types/config';
import { BUILT_IN_TOOL_IDS, READ_ONLY_TOOL_IDS } from './tools';

export const AGENT_COLORS = ['#10b981', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6', '#6366f1', '#ef4444'];
export const AGENT_ICONS = ['Sparkles', 'Bot', 'Compass', 'BookOpen', 'ClipboardList', 'ShoppingBag', 'Stethoscope', 'Briefcase', 'Mail', 'Search', 'PenLine', 'Shield'];

const t0 = 1_700_000_000_000;

export const DEFAULT_SKILLS: SkillConfig[] = [
  {
    id: 'skill-forms',
    name: 'Careful form filling',
    description: 'Use when filling in or editing any form.',
    activation: 'on-demand',
    sites: [],
    instructions: [
      '- Read the whole form first so you know every field, including ones below the fold.',
      '- Fill fields in the order they appear. Match each value to the field by its label, not its position.',
      '- For dropdowns: use select_option on native selects; for custom dropdowns click to open, then click the option.',
      "- Never guess values for required fields. If the user didn't give one, ask.",
      '- Before the final submit, re-read the form and check that every value landed in the right field.',
    ].join('\n'),
    createdAt: t0,
    updatedAt: t0,
  },
  {
    id: 'skill-summaries',
    name: 'Clear summaries',
    description: 'Use when asked to summarize, explain or extract information from a page.',
    activation: 'on-demand',
    sites: [],
    instructions: [
      '- Read the page with read_page mode "content" so you have the full text.',
      '- Lead with a one-sentence answer, then up to five short bullet points.',
      '- Keep numbers, names and dates exactly as written on the page.',
      "- Say clearly when the page doesn't contain what was asked.",
    ].join('\n'),
    createdAt: t0,
    updatedAt: t0,
  },
  {
    id: 'skill-records',
    name: 'Health records safety',
    description: 'Use on practice-management or patient-record systems.',
    activation: 'on-demand',
    sites: [],
    instructions: [
      '- Confirm you are on the right patient (name and date of birth on screen) before changing anything.',
      '- Never invent clinical values — doses, dates, diagnoses or results must come from the user or the page.',
      '- Fill forms, then let the user approve Save. Report exactly what was entered.',
      '- Keep patient details out of your reply unless the user asked for them.',
    ].join('\n'),
    createdAt: t0,
    updatedAt: t0,
  },
];

export const DEFAULT_AGENTS: AgentConfig[] = [
  {
    id: 'agent-assistant',
    name: 'Assistant',
    description: 'Does tasks on any website — searching, filling forms, clicking through pages.',
    avatar: { icon: 'Sparkles', color: '#10b981' },
    instructions: '',
    providerId: null,
    model: '',
    temperature: 0.2,
    maxSteps: 25,
    confirmation: 'smart',
    toolIds: [...BUILT_IN_TOOL_IDS],
    skillIds: ['skill-forms', 'skill-summaries'],
    createdAt: t0,
    updatedAt: t0,
  },
  {
    id: 'agent-reader',
    name: 'Reader',
    description: 'Reads, researches and summarizes. Never clicks or types on a page.',
    avatar: { icon: 'BookOpen', color: '#0ea5e9' },
    instructions: 'You only read and navigate. If a task needs clicking or typing, say so and suggest switching to the Assistant.',
    providerId: null,
    model: '',
    temperature: 0.2,
    maxSteps: 15,
    confirmation: 'smart',
    toolIds: [...READ_ONLY_TOOL_IDS],
    skillIds: ['skill-summaries'],
    createdAt: t0,
    updatedAt: t0,
  },
];

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  textSize: 'default',
  reduceMotion: false,
  defaultAgentId: 'agent-assistant',
  defaultProviderId: null,
  showSuggestions: true,
  highlightActions: true,
  expandActivity: false,
  blockedSites: [],
  readOnlySites: [],
  autoBackup: true,
  backupKeys: false,
  saveHistory: true,
  historyRetentionDays: 30,
  developerMode: false,
  disabledToolIds: [],
  maxElements: 250,
  maxTextChars: 12000,
  realClicks: true,
  maxTaskCost: 0.05,
  voice: { enabled: false, serverUrl: '', key: '', engine: 'whisper', vocabulary: '', autoSend: false, mode: 'handsfree', pauseMs: 1000, livePartials: true, voiceCommands: true },
};

export function defaultConfig(): AppConfig {
  return structuredClone({
    version: 1,
    providers: [],
    agents: DEFAULT_AGENTS,
    skills: DEFAULT_SKILLS,
    customTools: [],
    sites: [],
    settings: DEFAULT_SETTINGS,
  });
}

export const SUGGESTIONS = [
  { label: 'Summarize this page', desc: 'The key points in a few lines', prompt: 'Summarize this page.', icon: 'FileText' },
  { label: 'Find something', desc: 'A button, record or piece of text', prompt: 'Find ', icon: 'Search', fill: true },
  { label: 'Fill this form', desc: 'Tell me the details, I’ll enter them', prompt: 'Fill this form with: ', icon: 'ClipboardPen', fill: true },
  { label: 'Search this site', desc: 'Using the site’s own search', prompt: 'Search this site for ', icon: 'TextSearch', fill: true },
  { label: 'Help me with a task', desc: 'Describe it — I’ll work through it', prompt: '', icon: 'Wand', fill: true },
] as const;
