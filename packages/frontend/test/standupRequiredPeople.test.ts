import { describe, expect, test } from 'vitest';
import type { StandupNote, StandupParticipant, TeamMember } from '@ecp/shared';
import { deriveStandupRequiredPeople } from '../src/lib/standupRequiredPeople';

const participants: StandupParticipant[] = [
  { sessionId: 'session-1', memberId: 'ada', memberName: 'Ada Lovelace', position: 1, disposition: 'completed', resolvedAt: null },
  { sessionId: 'session-1', memberId: 'grace', memberName: 'Grace Hopper', position: 0, disposition: 'completed', resolvedAt: null },
];
const members: TeamMember[] = [
  { id: 'ada', teamId: 'team-1', name: 'Ada Lovelace', active: true, baseVelocity: 1, avatarUrl: 'https://example.test/ada.png' },
  { id: 'grace', teamId: 'team-1', name: 'Grace Hopper', active: true, baseVelocity: 1 },
  { id: 'outside', teamId: 'team-1', name: 'Outside Roster', active: false, baseVelocity: 1 },
];
const note = (overrides: Partial<StandupNote> = {}): StandupNote => ({
  id: 'note-1', sessionId: 'session-1', body: 'Follow up', allTeam: false, memberIds: [], position: 0,
  createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z', state: 'open',
  completedAt: null, deferredAt: null, sourceNoteId: null, sourceSessionDate: null, contextMemberId: null, contextMemberName: null, mentions: [], ...overrides,
});

describe('deriveStandupRequiredPeople', () => {
  test('uses resolved member ids, deduplicates each note, and keeps participant roster order', () => {
    const people = deriveStandupRequiredPeople([
      note({ id: 'first', memberIds: ['ada', 'grace', 'ada'] }),
      note({ id: 'second', memberIds: ['ada'] }),
    ], participants, members);

    expect(people).toEqual({ allTeamNoteCount: 0, people: [
      { id: 'grace', name: 'Grace Hopper', avatarUrl: null, noteCount: 1 },
      { id: 'ada', name: 'Ada Lovelace', avatarUrl: 'https://example.test/ada.png', noteCount: 2 },
    ] });
  });

  test('expands All Team from the persisted session roster', () => {
    expect(deriveStandupRequiredPeople([note({ allTeam: true, memberIds: [] })], participants, members)).toEqual({ allTeamNoteCount: 1, people: [] });
  });

  test('excludes completed and deferred notes, then includes reopened notes', () => {
    const closed = [note({ id: 'completed', memberIds: ['ada'], state: 'completed' }), note({ id: 'deferred', memberIds: ['grace'], state: 'deferred' })];
    expect(deriveStandupRequiredPeople(closed, participants, members)).toEqual({ allTeamNoteCount: 0, people: [] });
    expect(deriveStandupRequiredPeople([...closed, note({ id: 'reopened', memberIds: ['grace'] })], participants, members)).toEqual({ allTeamNoteCount: 0, people: [
      { id: 'grace', name: 'Grace Hopper', avatarUrl: null, noteCount: 1 },
    ] });
  });

  test('keeps unavailable persisted people visible with a snapshot-label fallback', () => {
    expect(deriveStandupRequiredPeople([
      note({ memberIds: ['removed'], mentions: [{ kind: 'member', id: 'removed', label: 'Former Teammate' }] }),
      note({ id: 'unknown', memberIds: ['unknown'] }),
    ], participants, members)).toEqual({ allTeamNoteCount: 0, people: [
      { id: 'removed', name: 'Former Teammate', avatarUrl: null, noteCount: 1 },
      { id: 'unknown', name: 'Unavailable teammate', avatarUrl: null, noteCount: 1 },
    ] });
  });
});
