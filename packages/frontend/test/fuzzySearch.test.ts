import { describe, expect, it } from 'vitest';
import { fuzzyScore, normalizeFuzzyText } from '../src/lib/fuzzySearch';
import { IMPORTANT_DATE_ICON_CATALOG } from '../src/components/ImportantDateIcon';
import { IMPORTANT_DATE_ICON_KEYS } from '@ecp/shared';

describe('fuzzySearch', () => {
  it('folds punctuation and whitespace before matching', () => {
    expect(normalizeFuzzyText('Check-Circle!')).toBe('check circle');
    expect(fuzzyScore('Check Circle', 'check-circle')).toBe(0);
  });

  it('ranks prefix, substring, then ordered-character matches', () => {
    expect(fuzzyScore('Release planning', 'rel')).toBeLessThan(fuzzyScore('Annual release', 'rel')!);
    expect(fuzzyScore('Annual release', 'rel')).toBeLessThan(fuzzyScore('Roadmap release', 'rle')!);
    expect(fuzzyScore('Calendar', 'xyz')).toBeNull();
  });
});

describe('important-date icon catalog', () => {
  it('is an exact, unique visual registry for the persisted allowlist', () => {
    expect(IMPORTANT_DATE_ICON_CATALOG.map((icon) => icon.key)).toEqual(IMPORTANT_DATE_ICON_KEYS);
    expect(new Set(IMPORTANT_DATE_ICON_CATALOG.map((icon) => icon.label)).size).toBe(IMPORTANT_DATE_ICON_CATALOG.length);
    expect(IMPORTANT_DATE_ICON_CATALOG).toHaveLength(35);
  });
});
