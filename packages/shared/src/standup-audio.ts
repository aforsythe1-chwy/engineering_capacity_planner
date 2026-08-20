/** Metadata and resolution rules for optional Standup walk-off audio. */

export interface StandupAudioTrackSummary {
  id: string;
  displayName: string;
  originalFilename: string;
  mimeType: 'audio/mpeg';
  byteLength: number;
  createdAt: string;
}

export type StandupAudioMemberMode = 'inherit' | 'off' | 'track';

export interface StandupAudioMemberAssignment {
  memberId: string;
  mode: StandupAudioMemberMode;
  trackId: string | null;
}

export interface TeamStandupAudioSettings {
  teamId: string;
  defaultTrackId: string | null;
  memberAssignments: StandupAudioMemberAssignment[];
}

/** Return the track selected for a member; `null` deliberately means silence. */
export function resolveStandupAudioTrack(
  settings: TeamStandupAudioSettings,
  memberId: string,
): string | null {
  const assignment = settings.memberAssignments.find((entry) => entry.memberId === memberId);
  if (!assignment || assignment.mode === 'inherit') return settings.defaultTrackId;
  return assignment.mode === 'track' ? assignment.trackId : null;
}
