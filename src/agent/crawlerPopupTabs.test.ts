import { describe, expect, it } from 'vitest';
import { describePage, type PageCapture } from './crawler/prompts';

describe('a page with many pop-ups and their tabs', () => {
  it('gets every pop-up line to the knowledge writer — the last tabs are not cut off', () => {
    const long = (title: string) => `“${title}”: ${'Personal Details First Name Last Name Date of Birth Gender Ethnicity Mobile Email '.repeat(6)}`;
    const dialogs = [
      ...Array.from({ length: 12 }, (_, i) => long(`Edit practice member ${i}`)),
      '“Practice membersNew practice member” › “Tags” tab: Save the practice member first to apply tags.',
      '“Practice membersNew practice member” › “Insurance” tab: Insurance Information\n  fields: - Insurance Name * — text: empty; - Policy Number * — text: empty',
    ];
    const p: PageCapture = { url: 'https://a.com/patients', title: 'Practice members', template: '/patients', headings: [], text: '', controls: [], fields: [], clicks: [], dialogs };
    const text = describePage(p, 24_000);
    expect(text).toContain('Save the practice member first to apply tags.');
    expect(text).toContain('Insurance Name *');
    // Still within the pop-ups' share of the room.
    const popups = text.slice(text.indexOf('Pop-ups:'));
    expect(popups.length).toBeLessThan(24_000 * 0.12 + 200);
  });
});
