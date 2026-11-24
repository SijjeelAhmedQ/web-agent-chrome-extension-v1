import setup from '../../../knowledge/web-agent-restore-indici.json';
import type { AgentConfig, SiteProfile, SkillConfig } from '../types/config';

/**
 * The setup that comes with the extension: the sites it knows by themselves (the Indici PMS, the Smart AI Inbox), their
 * agents, knowledge and shortcuts — no file to import. The agent for a site is picked from the page's address.
 */
const file = setup as unknown as { sites: SiteProfile[]; agents: AgentConfig[]; skills?: SkillConfig[] };

export const BUILT_IN_SITES = file.sites;
export const BUILT_IN_AGENTS = file.agents;
export const BUILT_IN_SKILLS = file.skills ?? [];

/** Changes when the setup does, so a new version of the extension brings it in once. */
export const BUILT_IN_STAMP = (() => {
  const text = JSON.stringify(setup);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
})();
