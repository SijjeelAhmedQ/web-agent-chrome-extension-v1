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
