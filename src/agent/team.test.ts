import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@/shared/constants/defaults';
import { careflowTeam } from '@/shared/constants/templates';
import { configActions, configSlice } from '@/store/configSlice';
import { upcomingDays } from './planner/systemPrompt';

describe('CareFlow team template', () => {
  it('creates five specialists and a parallel coordinator sharing the CareFlow skill', () => {
    const { skill, agents, coordinator } = careflowTeam('kaggle-1');
    expect(agents.map((a) => a.name)).toEqual(['Medication agent', 'Diagnosis agent', 'Task agent', 'Recall agent', 'Appointment agent']);
    expect(coordinator.team).toEqual({ memberIds: agents.map((a) => a.id), parallel: true, maxParallel: 5, tidyUp: true });
    expect(skill.activation).toBe('always');
    expect(skill.sites).toContain('localhost:5173');
    for (const a of [...agents, coordinator]) {
      expect(a.providerId).toBe('kaggle-1');
      expect(a.skillIds).toEqual([skill.id]);
    }
    expect(agents.every((a) => a.toolIds.includes('click') && a.toolIds.includes('type'))).toBe(true);
    expect(coordinator.toolIds).not.toContain('click');
  });
});

describe('team config', () => {
  it('removes a deleted agent from every team', () => {
    const { agents, coordinator } = careflowTeam(null);
    let state = configSlice.reducer(undefined, configActions.hydrate(defaultConfig()));
    for (const a of [...agents, coordinator]) state = configSlice.reducer(state, configActions.upsertAgent(a));
    state = configSlice.reducer(state, configActions.deleteAgent(agents[0].id));
    const team = state.config.agents.find((a) => a.id === coordinator.id)!.team!;
    expect(team.memberIds).toHaveLength(4);
    expect(team.memberIds).not.toContain(agents[0].id);
  });
});

describe('dates for planning', () => {
  it('lists the coming days so “next Tuesday” needs no arithmetic', () => {
    const text = upcomingDays(new Date(2026, 9, 8)); // Thursday, Oct 8 2026
    expect(text).toContain('Tue, Oct 13, 2026');
    expect(text).toContain('Thu, Oct 22, 2026'); // two weeks
    expect(text.startsWith('Coming days: Fri, Oct 9, 2026')).toBe(true);
  });
});
