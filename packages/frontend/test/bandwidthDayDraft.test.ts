import { describe, expect, it } from 'vitest';
import type { BandwidthCheckIn } from '@ecp/shared';
import { bandwidthDayPatchFrom, bandwidthDraftFrom } from '../src/lib/bandwidthDayDraft';

const record = (memberId: string, feeling: BandwidthCheckIn['feeling'], note: string | null = null): BandwidthCheckIn => ({
  memberId, date: '2026-08-13', feeling, note, sessionId: null, createdAt: '2026-08-13T12:00:00.000Z', updatedAt: '2026-08-13T12:00:00.000Z',
});

describe('bandwidth day draft', () => {
  it('emits only changed rows and never treats a missing response as Green', () => {
    const baseline = [record('one', 'yellow', 'Interrupts')];
    const draft = { ...bandwidthDraftFrom(baseline), two: { feeling: null, note: '' } };
    expect(bandwidthDayPatchFrom(baseline, draft)).toEqual({ patch: { upserts: [], deleteMemberIds: [] }, error: null });
  });

  it('creates, changes, clears, and normalizes manual records', () => {
    const baseline = [record('one', 'yellow', 'Interrupts'), record('two', 'purple')];
    const draft = {
      one: { feeling: 'red' as const, note: '  Escalations  ' },
      two: { feeling: null, note: '' },
      three: { feeling: 'green' as const, note: '  ' },
    };
    expect(bandwidthDayPatchFrom(baseline, draft)).toEqual({
      patch: {
        upserts: [
          { memberId: 'one', feeling: 'red', note: 'Escalations' },
          { memberId: 'three', feeling: 'green', note: null },
        ],
        deleteMemberIds: ['two'],
      },
      error: null,
    });
  });

  it('rejects a note without a feeling without emitting a mutation', () => {
    expect(bandwidthDayPatchFrom([], { one: { feeling: null, note: 'Context only' } })).toMatchObject({
      patch: { upserts: [], deleteMemberIds: [] }, error: 'Choose a bandwidth feeling before saving a note.',
    });
  });
});
