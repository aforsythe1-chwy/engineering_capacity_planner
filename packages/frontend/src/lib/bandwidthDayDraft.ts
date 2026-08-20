import type { BandwidthCheckIn, BandwidthDayPatch, BandwidthFeeling } from '@ecp/shared';

export interface BandwidthDraftEntry {
  feeling: BandwidthFeeling | null;
  note: string;
}

export type BandwidthDraft = Record<string, BandwidthDraftEntry>;

const MAX_NOTE_LENGTH = 2_000;

export function bandwidthDraftFrom(checkIns: BandwidthCheckIn[]): BandwidthDraft {
  return Object.fromEntries(checkIns.map((entry) => [entry.memberId, { feeling: entry.feeling, note: entry.note ?? '' }]));
}

export function bandwidthDraftEntry(draft: BandwidthDraft, memberId: string): BandwidthDraftEntry {
  return draft[memberId] ?? { feeling: null, note: '' };
}

export function bandwidthDayPatchFrom(baseline: BandwidthCheckIn[], draft: BandwidthDraft): { patch: BandwidthDayPatch; error: string | null } {
  const baselineByMember = new Map(baseline.map((entry) => [entry.memberId, entry]));
  const memberIds = new Set([...baselineByMember.keys(), ...Object.keys(draft)]);
  const patch: BandwidthDayPatch = { upserts: [], deleteMemberIds: [] };
  for (const memberId of memberIds) {
    const before = baselineByMember.get(memberId);
    const current = bandwidthDraftEntry(draft, memberId);
    const note = current.note.trim();
    if (note.length > MAX_NOTE_LENGTH) return { patch, error: 'Notes must be 2,000 characters or fewer.' };
    if (!current.feeling) {
      if (note) return { patch, error: 'Choose a bandwidth feeling before saving a note.' };
      if (before) patch.deleteMemberIds.push(memberId);
      continue;
    }
    const normalizedNote = note || null;
    if (!before || before.feeling !== current.feeling || (before.note ?? null) !== normalizedNote) {
      patch.upserts.push({ memberId, feeling: current.feeling, note: normalizedNote });
    }
  }
  return { patch, error: null };
}

export function bandwidthDayDraftIsDirty(baseline: BandwidthCheckIn[], draft: BandwidthDraft): boolean {
  const { patch, error } = bandwidthDayPatchFrom(baseline, draft);
  return Boolean(error || patch.upserts.length || patch.deleteMemberIds.length);
}
