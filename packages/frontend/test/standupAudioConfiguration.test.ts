import { describe, expect, it } from 'vitest';
import type { StandupAudioTrackSummary, TeamStandupAudioSettings } from '@ecp/shared';
import { memberSongSummary } from '../src/components/StandupAudioConfiguration';

const tracks: StandupAudioTrackSummary[] = [
  { id: 'track-default', displayName: 'Default Anthem', originalFilename: 'default.mp3', mimeType: 'audio/mpeg', byteLength: 1, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'track-custom', displayName: 'Custom Entrance', originalFilename: 'custom.mp3', mimeType: 'audio/mpeg', byteLength: 1, createdAt: '2026-01-01T00:00:00.000Z' },
];

const settings = (memberAssignments: TeamStandupAudioSettings['memberAssignments'], defaultTrackId: string | null = 'track-default'): TeamStandupAudioSettings => ({ teamId: 'team-1', defaultTrackId, memberAssignments });

describe('memberSongSummary', () => {
  it('describes inherited, silent, custom, and missing assignments without changing their semantics', () => {
    expect(memberSongSummary(settings([]), tracks, 'member-1')).toBe('Uses team default: Default Anthem');
    expect(memberSongSummary(settings([], null), tracks, 'member-1')).toBe('No team default');
    expect(memberSongSummary(settings([{ memberId: 'member-1', mode: 'off', trackId: null }]), tracks, 'member-1')).toBe('No song');
    expect(memberSongSummary(settings([{ memberId: 'member-1', mode: 'track', trackId: 'track-custom' }]), tracks, 'member-1')).toBe('Custom Entrance');
    expect(memberSongSummary(settings([{ memberId: 'member-1', mode: 'track', trackId: 'deleted-track' }]), tracks, 'member-1')).toBe('Missing song');
  });

  it('makes unavailable audio explicit in read-only or failed-load states', () => {
    expect(memberSongSummary(null, tracks, 'member-1')).toBe('Audio unavailable');
  });
});
