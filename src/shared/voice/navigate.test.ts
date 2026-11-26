import { describe, expect, it } from 'vitest';
import type { KnowledgeEntry } from '../types/config';
import { matchNavigation, navTargets } from './navigate';

const nav = (title: string, content: string): KnowledgeEntry => ({ id: title, kind: 'navigation', title, content, enabled: true, createdAt: 0, updatedAt: 0 });

const kb = {
  pages: [
    { url: 'https://a.com/patients', title: 'Practice members · Octans', template: '/patients', at: 0 },
    { url: 'https://a.com/mentor-dashboard', title: 'Mentor home · Octans › Dobson Wing', template: '/mentor-dashboard#screen:“Dobson Wing”', at: 0 },
    { url: 'https://a.com/mentor-dashboard/layout', title: 'Stations · Octans', template: '/mentor-dashboard/layout', at: 0 },
    { url: 'https://a.com/patients/12', title: 'Brian Dooley · Octans', template: '/patients/:id', at: 0 },
  ],
  entries: [
    nav('How to reach Messages', '# Reaching Messages\n\n- Menu path: click the link "Messages" in the sidebar.\n- Address path: /messages'),
    nav('How to reach the Tags page', 'Open the menu item "Tags 23" under the "Care" section of the sidebar, or go to the path /tags.'),
    nav('How to reach the Dashboard', '- Path: click the "Dashboard" link.\n- Address: /'),
    nav('Site map and main menu', '- **Practice members** (`/patients`)'),
  ],
};

describe('voice navigation', () => {
  const targets = navTargets(kb);

  it('knows the site map’s pages, not record pages or screens inside a page', () => {
    expect(targets.map((t) => [t.name, t.path])).toEqual([
      ['practice members', '/patients'],
      ['stations', '/mentor-dashboard/layout'],
      ['messages', '/messages'],
      ['tags', '/tags'],
      ['dashboard', '/'],
    ]);
  });

  it('matches a request only to go there', () => {
    expect(matchNavigation('Open stations.', targets)?.path).toBe('/mentor-dashboard/layout');
    expect(matchNavigation('go to the messages page', targets)?.path).toBe('/messages');
    expect(matchNavigation('Take me to Practice Members please', targets)?.path).toBe('/patients');
    expect(matchNavigation('open the tag page', targets)?.path).toBe('/tags');
    expect(matchNavigation('stations kholo', targets)?.path).toBe('/mentor-dashboard/layout');
    expect(matchNavigation('Open dashboard', targets)?.path).toBe('/');
  });

  it('leaves anything more to the agent', () => {
    expect(matchNavigation('open Brian Dooley', targets)).toBeNull();
    expect(matchNavigation('open stations and add one', targets)).toBeNull();
    expect(matchNavigation('how many stations are there', targets)).toBeNull();
    expect(matchNavigation('stations', targets)).toBeNull();
  });
});

describe('yes and no in Urdu and Hindi', () => {
  it('answers an approval', async () => {
    const { parseVoiceCommand } = await import('./commands');
    const { approvalQuestion } = await import('./say');
    const waiting = { approvalPending: true, running: true };
    for (const yes of ['Haan', 'haan kar do', 'Ji haan.', 'ہاں', 'ٹھیک ہے۔', 'हाँ', 'theek hai']) expect(parseVoiceCommand(yes, waiting)).toEqual({ kind: 'approve' });
    for (const no of ['Nahi', 'nahin', 'نہیں', 'नहीं।', 'rehne do']) expect(parseVoiceCommand(no, waiting)).toEqual({ kind: 'decline' });
    // Not while nothing is being asked: then it's a request.
    expect(parseVoiceCommand('haan', { approvalPending: false, running: false }).kind).toBe('request');
    expect(approvalQuestion({ title: 'Click “Save”?', confirmLabel: 'Confirm' })).toBe('Save? Say yes or no.');
    expect(approvalQuestion({ title: 'Click “Deactivate (never deleted — Tag §1)” — row 5 “Test User · Yellow Flag · Pinned”?', confirmLabel: 'Confirm' })).toBe('Deactivate Test User? Say yes or no.');
    expect(approvalQuestion({ title: 'Which should I press: “Complete”, “Save”?', confirmLabel: 'Confirm', choices: [{ id: 3, label: 'Complete' }, { id: 4, label: 'Save' }], target: 4 })).toBe('Press Save? Say yes or no.');
  });
});

describe('spoken replies and an open microphone', () => {
  it('tells the microphone to pause while the extension speaks', async () => {
    const { onSpeaking, say } = await import('./say');
    const spoken: string[] = [];
    class Utterance {
      lang = '';
      rate = 1;
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    const g = globalThis as unknown as Record<string, unknown>;
    g.SpeechSynthesisUtterance = Utterance;
    g.speechSynthesis = { cancel() {}, getVoices: () => [], speak: (u: Utterance) => (spoken.push(u.text), setTimeout(() => u.onend?.(), 10)) };
    const states: boolean[] = [];
    const off = onSpeaking((on) => states.push(on));
    await say('Deactivate Test User? Say yes or no.');
    off();
    expect(spoken).toEqual(['Deactivate Test User? Say yes or no.']);
    expect(states).toEqual([true, false]);
    delete g.SpeechSynthesisUtterance;
    delete g.speechSynthesis;
  });
});
