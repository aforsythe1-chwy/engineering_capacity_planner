import { describe, expect, it } from 'vitest';
import { epicOwnerId, epicSmeRank, epicSmes } from '../src/domain.js';

describe('epic SME selectors', () => {
  const data = { epicSmes: [{ epicKey: 'A', memberId: 'two', rank: 1 }, { epicKey: 'A', memberId: 'one', rank: 0 }] };
  it('keeps owner-first ordering and describes unknown members as unranked', () => {
    expect(epicSmes(data, 'A').map((row) => row.memberId)).toEqual(['one', 'two']);
    expect(epicOwnerId(data, 'A')).toBe('one');
    expect(epicSmeRank(data, 'A', 'missing')).toBeNull();
    expect(epicOwnerId(data, 'none')).toBeNull();
  });
});
