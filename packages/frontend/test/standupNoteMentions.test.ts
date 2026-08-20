import { describe, expect, test } from 'vitest';
import type { StandupPseudogroup, TeamMember } from '@ecp/shared';
import { buildStandupMentionOptions, findMentionTrigger, removeStandupAudience, replaceMentionTrigger, selectStandupAudience, standupAudiencePayload } from '../src/lib/standupNoteMentions';

const members: TeamMember[] = [
  { id: 'm-1', teamId: 'team-1', name: 'Ada Lovelace', active: true, baseVelocity: 1 },
  { id: 'm-2', teamId: 'team-1', name: 'Grace Hopper', active: true, baseVelocity: 1 },
  { id: 'm-3', teamId: 'team-1', name: 'Retired Member', active: false, baseVelocity: 1 },
];
const groups: StandupPseudogroup[] = [{ id: 'eng', name: 'Engineers', memberIds: ['m-1', 'm-2'] }];

describe('standup note mentions', () => {
  test('finds valid token-boundary queries and rejects email/whitespace/selection cases', () => {
    expect(findMentionTrigger('@ad', 3)).toEqual({ start: 0, end: 3, query: 'ad' });
    expect(findMentionTrigger('Follow up: @gr', 14)).toEqual({ start: 11, end: 14, query: 'gr' });
    expect(findMentionTrigger('mail@domain', 11)).toBeNull();
    expect(findMentionTrigger('@two words', 10)).toBeNull();
    expect(findMentionTrigger('@ad', 3, 1)).toBeNull();
  });

  test('removes only the active trigger span and preserves the surrounding body', () => {
    const trigger = findMentionTrigger('Ask @ad tomorrow', 7);
    expect(trigger).toEqual({ start: 4, end: 7, query: 'ad' });
    expect(replaceMentionTrigger('Ask @ad tomorrow', trigger!)).toEqual({ body: 'Ask  tomorrow', caret: 4 });
  });

  test('orders All Team, groups, then active people and fuzzy filters locally', () => {
    expect(buildStandupMentionOptions('', groups, members).map((option) => option.label)).toEqual(['@All Team', 'Engineers', 'Ada Lovelace', 'Grace Hopper']);
    expect(buildStandupMentionOptions('gr', groups, members).map((option) => option.label)).toEqual(['Engineers', 'Grace Hopper']);
  });

  test('enforces All Team exclusivity, deduplicates options, and builds the API payload', () => {
    const [allTeam, group, ada] = buildStandupMentionOptions('', groups, members);
    const people = selectStandupAudience([allTeam!], ada!);
    expect(people.map((option) => option.id)).toEqual(['member:m-1']);
    const withGroup = selectStandupAudience(people, group!);
    expect(selectStandupAudience(withGroup, ada!).map((option) => option.id)).toEqual(['group:eng', 'member:m-1']);
    expect(standupAudiencePayload(withGroup)).toEqual({ allTeam: false, mentions: [{ kind: 'member', id: 'm-1' }, { kind: 'group', id: 'eng' }] });
    expect(selectStandupAudience(withGroup, allTeam!)).toEqual([allTeam]);
    expect(removeStandupAudience([allTeam!], allTeam!.id)).toEqual([]);
  });
});
