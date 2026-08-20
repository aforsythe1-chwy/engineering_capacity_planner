import { type StandupPseudogroup, type TeamMember } from '@ecp/shared';
import { fuzzyScore } from './fuzzySearch';

export type StandupMentionOption = {
  id: string;
  kind: 'all-team' | 'group' | 'member';
  label: string;
  hint: string;
};

export type MentionTrigger = { start: number; end: number; query: string };

const allTeam: StandupMentionOption = { id: 'all-team', kind: 'all-team', label: '@All Team', hint: 'Everyone on this team' };

export function findMentionTrigger(body: string, selectionStart: number, selectionEnd = selectionStart): MentionTrigger | null {
  if (selectionStart !== selectionEnd) return null;
  const beforeCaret = body.slice(0, selectionStart);
  const triggerStart = beforeCaret.lastIndexOf('@');
  if (triggerStart < 0) return null;
  const beforeTrigger = beforeCaret[triggerStart - 1];
  if (beforeTrigger && !/[\s([{.,;:!?]/.test(beforeTrigger)) return null;
  const query = beforeCaret.slice(triggerStart + 1);
  if (/\s|[\r\n@]/.test(query)) return null;
  return { start: triggerStart, end: selectionStart, query };
}

export function replaceMentionTrigger(body: string, trigger: MentionTrigger): { body: string; caret: number } {
  return { body: `${body.slice(0, trigger.start)}${body.slice(trigger.end)}`, caret: trigger.start };
}

export function buildStandupMentionOptions(query: string, groups: StandupPseudogroup[], members: TeamMember[]): StandupMentionOption[] {
  const score = (value: string) => fuzzyScore(value, query);
  const groupOptions = groups.map((group) => ({ group, score: score(group.name) })).filter((entry) => entry.score !== null)
    .sort((a, b) => a.score! - b.score! || a.group.name.localeCompare(b.group.name))
    .map(({ group }) => ({ id: `group:${group.id}`, kind: 'group' as const, label: group.name, hint: `Group · ${group.memberIds.length} people` }));
  const memberOptions = members.filter((member) => member.active).map((member) => ({ member, score: score(member.name) })).filter((entry) => entry.score !== null)
    .sort((a, b) => a.score! - b.score! || a.member.name.localeCompare(b.member.name))
    .map(({ member }) => ({ id: `member:${member.id}`, kind: 'member' as const, label: member.name, hint: 'Person' }));
  return (query ? [] : [allTeam]).concat(groupOptions, memberOptions);
}

export function selectStandupAudience(current: StandupMentionOption[], option: StandupMentionOption): StandupMentionOption[] {
  if (option.kind === 'all-team') return [allTeam];
  const withoutAllTeam = current.filter((item) => item.kind !== 'all-team' && item.id !== option.id);
  return [...withoutAllTeam, option];
}

export function removeStandupAudience(current: StandupMentionOption[], id: string): StandupMentionOption[] {
  return current.filter((item) => item.id !== id);
}

export function standupAudiencePayload(selected: StandupMentionOption[]): { allTeam: true } | { allTeam: false; mentions: Array<{ kind: 'member' | 'group'; id: string }> } | null {
  if (selected.some((item) => item.kind === 'all-team')) return { allTeam: true };
  if (!selected.length) return null;
  return { allTeam: false, mentions: selected.map((item) => ({ kind: item.kind as 'member' | 'group', id: item.id.slice(item.kind.length + 1) })) };
}
