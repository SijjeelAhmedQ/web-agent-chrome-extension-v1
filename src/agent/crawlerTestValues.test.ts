import { describe, expect, it } from 'vitest';
import { DEFAULT_CRAWLER } from '@/shared/constants/defaults';
import type { ElementInfo } from '@/shared/types/page';
import { dummyFor, sampleValue } from './crawler/risk';

const field = (over: Partial<ElementInfo>): ElementInfo => ({ id: 1, role: 'textbox', name: '', ...over }) as ElementInfo;

describe('test values the form asks for', () => {
  it('fills a Location field with coordinates, not “Test”', () => {
    // OctansCare's own Location field, as it is on the page.
    expect(dummyFor(field({ name: 'Location', placeholder: '-36.861476,174.765594' }), DEFAULT_CRAWLER)).toBe('-36.861476,174.765594');
    expect(dummyFor(field({ name: 'Location', placeholder: '-36.8485, 174.7633' }), DEFAULT_CRAWLER)).toBe('-36.8485, 174.7633');
    expect(dummyFor(field({ name: 'Location', hint: 'Use latitude,longitude' }), DEFAULT_CRAWLER)).toBe('-36.8485,174.7633');
    expect(dummyFor(field({ name: 'Location', placeholder: 'Latitude, longitude' }), DEFAULT_CRAWLER)).toBe('-36.8485,174.7633');
    expect(dummyFor(field({ name: 'Location', hint: 'Use latitude,longitude, e.g. -41.2865,174.7762' }), DEFAULT_CRAWLER)).toBe('-41.2865,174.7762');
  });

  it('takes a placeholder that is a sample value', () => {
    expect(sampleValue('021 555 0100')).toBe('021 555 0100');
    expect(sampleValue('ABC1235')).toBe('ABC1235');
    expect(sampleValue('Search 50 items')).toBeNull();
    expect(sampleValue('DD/MM/YYYY')).toBeNull();
    expect(dummyFor(field({ name: 'NHI Number', placeholder: 'ABC1235' }), DEFAULT_CRAWLER)).toBe('ABC1235');
  });

  it('leaves other fields as they were', () => {
    expect(dummyFor(field({ name: 'Long description' }), DEFAULT_CRAWLER)).toBe(DEFAULT_CRAWLER.text);
    expect(dummyFor(field({ name: 'Notes', placeholder: 'Anything else?' }), DEFAULT_CRAWLER)).toBe(DEFAULT_CRAWLER.text);
  });
});

describe('field formats kept for the knowledge', () => {
  it('reads what a field takes from the field itself', async () => {
    const { fieldFormat } = await import('./crawler/risk');
    expect(fieldFormat({ name: 'Location', placeholder: '-36.861476,174.765594' })).toBe('latitude,longitude, e.g. -36.861476,174.765594');
    expect(fieldFormat({ name: 'Location', hint: 'Use latitude,longitude' })).toBe('latitude,longitude');
    expect(fieldFormat({ name: 'Date of Birth', placeholder: 'DD/MM/YYYY' })).toBe('DD/MM/YYYY');
    expect(fieldFormat({ name: 'NHI Number', placeholder: 'e.g. ABC1235' })).toBe('e.g. ABC1235');
    expect(fieldFormat({ name: 'Postal Code', hint: 'Must be 4 digits' })).toBe('Must be 4 digits');
    expect(fieldFormat({ name: 'First Name', placeholder: 'First name' })).toBeNull();
  });

  it('names a pop-up’s form and the controls by their own names', async () => {
    const { controlNames, formName } = await import('./crawler/risk');
    expect(formName('Practice membersNew practice member', 'Practice members · Octans')).toBe('New practice member');
    expect(formName('', 'Practice members · Octans')).toBe('Practice members');
    expect(controlNames(['/patients|reset', '*reset', '/|invite user', '*invite user', '/patients|book appointment'])).toEqual(['Reset', 'Invite user', 'Book appointment']);
  });
});
