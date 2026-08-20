import type { StandupNote, StandupParticipant, TeamMember } from '@ecp/shared';

export interface StandupRequiredPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  noteCount: number;
}

export interface StandupRequiredAudience {
  allTeamNoteCount: number;
  people: StandupRequiredPerson[];
}

/**
 * Resolves the people still needed for the editable post-standup discussion.
 *
 * Notes store resolved member ids when created, so this intentionally does not
 * re-expand saved pseudogroup mentions from mutable team settings. `@All Team`
 * remains one distinct audience card rather than expanding into every person.
 */
export function deriveStandupRequiredPeople(
  notes: readonly StandupNote[],
  participants: readonly StandupParticipant[],
  members: readonly TeamMember[],
): StandupRequiredAudience {
  const participantById = new Map(participants.map((participant) => [participant.memberId, participant]));
  const memberById = new Map(members.map((member) => [member.id, member]));
  const counts = new Map<string, number>(); let allTeamNoteCount = 0;

  for (const note of notes) {
    if (note.state !== 'open') continue;
    if (note.allTeam) { allTeamNoteCount += 1; continue; }
    const audience = note.memberIds;
    for (const memberId of new Set(audience)) counts.set(memberId, (counts.get(memberId) ?? 0) + 1);
  }

  const people = [...counts.entries()].map(([id, noteCount]) => {
    const participant = participantById.get(id);
    const member = memberById.get(id);
    const directMention = notes.flatMap((note) => note.mentions).find((mention) => mention.kind === 'member' && mention.id === id);
    return {
      id,
      name: participant?.memberName ?? member?.name ?? directMention?.label ?? 'Unavailable teammate',
      avatarUrl: member?.avatarUrl ?? null,
      noteCount,
      position: participant?.position ?? Number.MAX_SAFE_INTEGER,
    };
  }).sort((left, right) => left.position - right.position || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)).map(({ position: _position, ...person }) => person);
  return { allTeamNoteCount, people };
}
