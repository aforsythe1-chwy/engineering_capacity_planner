/** Focused persistence for optional Standup walk-off audio. */
import { createHash, randomUUID } from 'node:crypto';
import type { StandupAudioMemberAssignment, StandupAudioTrackSummary, TeamStandupAudioSettings } from '@ecp/shared';
import type { Db } from './database.js';
import { badRequest, conflict, notFound } from '../http-error.js';

export const MAX_STANDUP_AUDIO_TRACK_BYTES = 12 * 1024 * 1024;
export const MAX_STANDUP_AUDIO_LIBRARY_BYTES = 128 * 1024 * 1024;

type TrackRow = { id: string; display_name: string; original_filename: string; mime_type: 'audio/mpeg'; byte_length: number; sha256: string; audio_blob: Buffer; created_at: string };
const timestamp = () => new Date().toISOString();

const summary = (row: Omit<TrackRow, 'audio_blob'> | TrackRow): StandupAudioTrackSummary => ({
  id: row.id, displayName: row.display_name, originalFilename: row.original_filename,
  mimeType: row.mime_type, byteLength: row.byte_length, createdAt: row.created_at,
});

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160 || /[\u0000-\u001f\u007f]/.test(trimmed)) throw badRequest(`${field} must be 1–160 printable characters`);
  return trimmed;
}
function trackExists(db: Db, trackId: string): boolean { return !!db.prepare('SELECT 1 FROM standup_audio_track WHERE id = ?').get(trackId); }
function assertTeam(db: Db, teamId: string): void { if (!db.prepare('SELECT 1 FROM team WHERE id = ?').get(teamId)) throw notFound(`Team ${teamId} not found`); }

export interface StandupAudioTrackContent extends StandupAudioTrackSummary { sha256: string; audio: Buffer; }
export interface CreateStandupAudioTrackInput { displayName: unknown; originalFilename: unknown; mimeType: unknown; audio: Buffer; }

export function listStandupAudioTracks(db: Db): StandupAudioTrackSummary[] {
  return (db.prepare('SELECT id, display_name, original_filename, mime_type, byte_length, sha256, created_at FROM standup_audio_track ORDER BY display_name COLLATE NOCASE, created_at').all() as TrackRow[]).map(summary);
}

export function findDuplicateStandupAudioTrack(db: Db, bytes: Buffer): StandupAudioTrackSummary | null {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const row = db.prepare('SELECT id, display_name, original_filename, mime_type, byte_length, sha256, created_at FROM standup_audio_track WHERE sha256 = ?').get(sha256) as TrackRow | undefined;
  return row ? summary(row) : null;
}

export function getStandupAudioTrackContent(db: Db, trackId: string): StandupAudioTrackContent {
  const row = db.prepare('SELECT * FROM standup_audio_track WHERE id = ?').get(trackId) as TrackRow | undefined;
  if (!row) throw notFound(`Standup audio track ${trackId} not found`);
  return { ...summary(row), sha256: row.sha256, audio: row.audio_blob };
}

export function createStandupAudioTrack(db: Db, input: CreateStandupAudioTrackInput): StandupAudioTrackSummary {
  const displayName = text(input.displayName, 'displayName');
  const originalFilename = text(input.originalFilename, 'originalFilename');
  if (!originalFilename.toLowerCase().endsWith('.mp3')) throw badRequest('originalFilename must end in .mp3');
  if (input.mimeType !== 'audio/mpeg') throw badRequest('mimeType must be audio/mpeg');
  if (!Buffer.isBuffer(input.audio) || input.audio.length === 0) throw badRequest('audio must be a non-empty buffer');
  if (input.audio.length > MAX_STANDUP_AUDIO_TRACK_BYTES) throw badRequest(`audio must be at most ${MAX_STANDUP_AUDIO_TRACK_BYTES} bytes`);
  const sha256 = createHash('sha256').update(input.audio).digest('hex');
  return db.transaction(() => {
    const duplicate = db.prepare('SELECT id, display_name, original_filename, mime_type, byte_length, sha256, created_at FROM standup_audio_track WHERE sha256 = ?').get(sha256) as TrackRow | undefined;
    if (duplicate) throw conflict(`Standup audio track already exists: ${duplicate.id}`);
    const total = (db.prepare('SELECT COALESCE(SUM(byte_length), 0) AS total FROM standup_audio_track').get() as { total: number }).total;
    if (total + input.audio.length > MAX_STANDUP_AUDIO_LIBRARY_BYTES) throw badRequest(`Standup audio library must be at most ${MAX_STANDUP_AUDIO_LIBRARY_BYTES} bytes`);
    const row: TrackRow = { id: `standup_audio_${randomUUID()}`, display_name: displayName, original_filename: originalFilename, mime_type: 'audio/mpeg', byte_length: input.audio.length, sha256, audio_blob: input.audio, created_at: timestamp() };
    db.prepare('INSERT INTO standup_audio_track (id, display_name, original_filename, mime_type, byte_length, sha256, audio_blob, created_at) VALUES (@id, @display_name, @original_filename, @mime_type, @byte_length, @sha256, @audio_blob, @created_at)').run(row);
    return summary(row);
  })();
}

export function getTeamStandupAudioSettings(db: Db, teamId: string): TeamStandupAudioSettings {
  assertTeam(db, teamId);
  const defaultRow = db.prepare('SELECT track_id FROM standup_audio_team_default WHERE team_id = ?').get(teamId) as { track_id: string } | undefined;
  const memberAssignments = db.prepare(`SELECT o.member_id, o.mode, o.track_id FROM standup_audio_member_override o
    JOIN team_member m ON m.id = o.member_id WHERE m.team_id = ? ORDER BY m.active DESC, m.name COLLATE NOCASE`).all(teamId) as Array<{ member_id: string; mode: 'off' | 'track'; track_id: string | null }>;
  return { teamId, defaultTrackId: defaultRow?.track_id ?? null, memberAssignments: memberAssignments.map((row) => ({ memberId: row.member_id, mode: row.mode, trackId: row.track_id })) };
}

export interface ReplaceTeamStandupAudioInput { defaultTrackId: string | null; memberAssignments: Array<{ memberId: string; mode: 'off' | 'track'; trackId: string | null }>; }

export function replaceTeamStandupAudioSettings(db: Db, teamId: string, input: ReplaceTeamStandupAudioInput): TeamStandupAudioSettings {
  if (!input || !Array.isArray(input.memberAssignments) || (input.defaultTrackId !== null && typeof input.defaultTrackId !== 'string')) throw badRequest('Invalid Standup audio settings');
  return db.transaction(() => {
    assertTeam(db, teamId);
    if (input.defaultTrackId && !trackExists(db, input.defaultTrackId)) throw notFound(`Standup audio track ${input.defaultTrackId} not found`);
    const members = new Set((db.prepare('SELECT id FROM team_member WHERE team_id = ?').all(teamId) as Array<{ id: string }>).map((row) => row.id));
    const seen = new Set<string>();
    for (const assignment of input.memberAssignments) {
      if (!assignment || typeof assignment.memberId !== 'string' || seen.has(assignment.memberId)) throw badRequest('memberAssignments must contain unique member IDs');
      seen.add(assignment.memberId);
      if (!members.has(assignment.memberId)) throw badRequest('Member assignment must belong to the team');
      if ((assignment.mode !== 'off' && assignment.mode !== 'track') || (assignment.mode === 'off' ? assignment.trackId !== null : typeof assignment.trackId !== 'string')) throw badRequest('Invalid member audio assignment');
      if (assignment.mode === 'track' && !trackExists(db, assignment.trackId!)) throw notFound(`Standup audio track ${assignment.trackId} not found`);
    }
    const now = timestamp();
    db.prepare('DELETE FROM standup_audio_member_override WHERE member_id IN (SELECT id FROM team_member WHERE team_id = ?)').run(teamId);
    db.prepare('DELETE FROM standup_audio_team_default WHERE team_id = ?').run(teamId);
    if (input.defaultTrackId) db.prepare('INSERT INTO standup_audio_team_default (team_id, track_id, updated_at) VALUES (?, ?, ?)').run(teamId, input.defaultTrackId, now);
    const insert = db.prepare('INSERT INTO standup_audio_member_override (member_id, mode, track_id, updated_at) VALUES (?, ?, ?, ?)');
    input.memberAssignments.forEach((assignment) => insert.run(assignment.memberId, assignment.mode, assignment.trackId, now));
    return getTeamStandupAudioSettings(db, teamId);
  })();
}

export function deleteStandupAudioTrack(db: Db, trackId: string): void {
  db.transaction(() => {
    if (!trackExists(db, trackId)) throw notFound(`Standup audio track ${trackId} not found`);
    const referenced = (db.prepare('SELECT 1 FROM standup_audio_team_default WHERE track_id = ? UNION ALL SELECT 1 FROM standup_audio_member_override WHERE track_id = ? LIMIT 1').get(trackId, trackId));
    if (referenced) throw conflict('Standup audio track is still assigned to a team or member');
    db.prepare('DELETE FROM standup_audio_track WHERE id = ?').run(trackId);
  })();
}

export function standupAudioTrackReferences(db: Db, trackId: string): { teamIds: string[]; memberIds: string[] } {
  return {
    teamIds: (db.prepare('SELECT team_id FROM standup_audio_team_default WHERE track_id = ? ORDER BY team_id').all(trackId) as Array<{ team_id: string }>).map((row) => row.team_id),
    memberIds: (db.prepare('SELECT member_id FROM standup_audio_member_override WHERE track_id = ? ORDER BY member_id').all(trackId) as Array<{ member_id: string }>).map((row) => row.member_id),
  };
}
