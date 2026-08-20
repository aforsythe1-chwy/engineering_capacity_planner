import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveStandupAudioTrack } from '../../shared/src/standup-audio.js';
import { openDatabase, type Db } from '../src/db/database.js';
import {
  MAX_STANDUP_AUDIO_LIBRARY_BYTES,
  createStandupAudioTrack,
  deleteStandupAudioTrack,
  getStandupAudioTrackContent,
  getTeamStandupAudioSettings,
  listStandupAudioTracks,
  replaceTeamStandupAudioSettings,
} from '../src/db/standup-audio.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function seed(db: Db): void {
  db.prepare("INSERT INTO team VALUES ('team-a', 'A', 14, 1, '2026-01-05', '[1,2,3,4,5]')").run();
  db.prepare("INSERT INTO team VALUES ('team-b', 'B', 14, 1, '2026-01-05', '[1,2,3,4,5]')").run();
  db.prepare("INSERT INTO team_member (id, team_id, name, base_velocity) VALUES ('member-active', 'team-a', 'Active', 8)").run();
  db.prepare("INSERT INTO team_member (id, team_id, name, base_velocity, active) VALUES ('member-inactive', 'team-a', 'Inactive', 8, 0)").run();
  db.prepare("INSERT INTO team_member (id, team_id, name, base_velocity) VALUES ('member-other', 'team-b', 'Other', 8)").run();
}
function track(db: Db, byte = 1): ReturnType<typeof createStandupAudioTrack> {
  return createStandupAudioTrack(db, { displayName: `Song ${byte}`, originalFilename: `song-${byte}.mp3`, mimeType: 'audio/mpeg', audio: Buffer.alloc(byte, byte) });
}

describe('Standup walk-off audio repository', () => {
  it('stores metadata separately from BLOB content and detects duplicate bytes', () => {
    const db = openDatabase(); seed(db);
    const created = track(db, 3);
    expect(listStandupAudioTracks(db)).toEqual([created]);
    expect(getStandupAudioTrackContent(db, created.id)).toMatchObject({ ...created, audio: Buffer.from([3, 3, 3]) });
    expect(() => createStandupAudioTrack(db, { displayName: 'Copy', originalFilename: 'copy.mp3', mimeType: 'audio/mpeg', audio: Buffer.from([3, 3, 3]) })).toThrow(/already exists/);
  });

  it('validates track metadata and library limits without partial storage', () => {
    const db = openDatabase(); seed(db);
    expect(() => createStandupAudioTrack(db, { displayName: 'Song', originalFilename: 'song.wav', mimeType: 'audio/mpeg', audio: Buffer.of(1) })).toThrow(/\.mp3/);
    expect(() => createStandupAudioTrack(db, { displayName: 'Song', originalFilename: 'song.mp3', mimeType: 'audio/mpeg', audio: Buffer.alloc(12 * 1024 * 1024 + 1) })).toThrow(/at most/);
    db.prepare('INSERT INTO standup_audio_track (id, display_name, original_filename, mime_type, byte_length, sha256, audio_blob, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('large', 'Large', 'large.mp3', 'audio/mpeg', MAX_STANDUP_AUDIO_LIBRARY_BYTES, 'large-hash', Buffer.of(1), '2026-01-01T00:00:00.000Z');
    expect(() => track(db, 2)).toThrow(/library/);
    expect(listStandupAudioTracks(db)).toHaveLength(1);
  });

  it('resolves inherit, off, custom, and inactive member assignments', () => {
    const db = openDatabase(); seed(db); const defaultTrack = track(db, 1); const customTrack = track(db, 2);
    const settings = replaceTeamStandupAudioSettings(db, 'team-a', { defaultTrackId: defaultTrack.id, memberAssignments: [
      { memberId: 'member-active', mode: 'off', trackId: null },
      { memberId: 'member-inactive', mode: 'track', trackId: customTrack.id },
    ] });
    expect(resolveStandupAudioTrack(settings, 'member-active')).toBeNull();
    expect(resolveStandupAudioTrack(settings, 'member-inactive')).toBe(customTrack.id);
    expect(resolveStandupAudioTrack(settings, 'not-overridden')).toBe(defaultTrack.id);
    expect(getTeamStandupAudioSettings(db, 'team-a')).toEqual(settings);
  });

  it('rejects cross-team or malformed assignments atomically and protects referenced tracks', () => {
    const db = openDatabase(); seed(db); const song = track(db, 4);
    replaceTeamStandupAudioSettings(db, 'team-a', { defaultTrackId: song.id, memberAssignments: [] });
    expect(() => replaceTeamStandupAudioSettings(db, 'team-a', { defaultTrackId: null, memberAssignments: [{ memberId: 'member-other', mode: 'off', trackId: null }] })).toThrow(/belong to the team/);
    expect(getTeamStandupAudioSettings(db, 'team-a').defaultTrackId).toBe(song.id);
    expect(() => deleteStandupAudioTrack(db, song.id)).toThrow(/still assigned/);
    replaceTeamStandupAudioSettings(db, 'team-a', { defaultTrackId: null, memberAssignments: [] });
    deleteStandupAudioTrack(db, song.id);
    expect(listStandupAudioTracks(db)).toEqual([]);
  });

  it('adds the audio tables when opening a pre-audio database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ecp-audio-migration-')); directories.push(directory);
    const path = join(directory, 'old.db'); const old = new Database(path);
    old.exec("CREATE TABLE team (id TEXT PRIMARY KEY, name TEXT NOT NULL, sprint_length_days INTEGER NOT NULL, sprint_start_weekday INTEGER NOT NULL, sprint_anchor_date TEXT NOT NULL, working_days TEXT NOT NULL); CREATE TABLE team_member (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, name TEXT NOT NULL, base_velocity REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1);");
    old.prepare("INSERT INTO team VALUES ('team-a', 'A', 14, 1, '2026-01-05', '[1,2,3,4,5]')").run(); old.close();
    const db = openDatabase({ path });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'standup_audio_track'").get()).toBeTruthy();
    expect(getTeamStandupAudioSettings(db, 'team-a')).toEqual({ teamId: 'team-a', defaultTrackId: null, memberAssignments: [] });
  });
});
