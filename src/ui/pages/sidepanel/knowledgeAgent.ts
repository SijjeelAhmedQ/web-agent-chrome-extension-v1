import type { AgentConfig } from '@/shared/types/config';

/**
 * Asking for the site to be learned: “learn this website”, “crawl this site”, “gather knowledge of this site”,
 * “is website ko learn karo”.
 */
export const LEARN_REQUEST =
  /^(please\s+)?(learn|crawl|explore and learn|gather (the )?knowledge( of| for| from)?|build (the |a )?knowledge base( of| for)?)\s+(this|the|my)?\s*(web\s?site|site|page|app)\b[.!]?$|^(is|iss) (web\s?site|site) (ko )?(learn|seekho|sikho)( karo)?[.!]?$/i;

export const isLearnRequest = (text: string) => LEARN_REQUEST.test(text.trim());

/** The Knowledge Gather Agent, as the agent list shows it — it works in its own view, not as a chat agent. */
export const KNOWLEDGE_AGENT: AgentConfig = {
  id: 'agent-knowledge-gather',
  name: 'Knowledge Gather Agent',
  description: 'Explores the website and builds its knowledge base',
  avatar: { icon: 'GraduationCap', color: '#10b981' },
  instructions: '',
  providerId: null,
  model: '',
  temperature: 0.2,
  maxSteps: 0,
  confirmation: 'smart',
  toolIds: [],
  skillIds: [],
  createdAt: 0,
  updatedAt: 0,
};
