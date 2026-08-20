import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

const mp3 = Buffer.from('ID3\x04\x00\x00test bytes');
const encoded = encodeURIComponent('Walk off.mp3');

describe('Standup audio routes', () => {
  it('uploads, lists, ranges, assigns, and protects a track', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const upload = await app.inject({ method: 'POST', url: '/api/standup/audio-tracks', headers: { 'content-type': 'audio/mpeg', 'x-ecp-track-name': encoded, 'x-ecp-track-filename': encoded }, payload: mp3 });
    expect(upload.statusCode).toBe(201); const track = upload.json();
    const duplicate = await app.inject({ method: 'POST', url: '/api/standup/audio-tracks', headers: { 'content-type': 'audio/mpeg', 'x-ecp-track-name': encoded, 'x-ecp-track-filename': encoded }, payload: mp3 });
    expect(duplicate.statusCode).toBe(409); expect(duplicate.json()).toEqual(track);
    expect((await app.inject({ method: 'GET', url: '/api/standup/audio-tracks' })).json()).toEqual([track]);
    const content = await app.inject({ method: 'GET', url: `/api/standup/audio-tracks/${track.id}/content`, headers: { range: 'bytes=1-3' } });
    expect(content.statusCode).toBe(206); expect(content.headers['content-range']).toBe(`bytes 1-3/${mp3.length}`); expect(content.rawPayload).toEqual(mp3.subarray(1, 4));
    expect((await app.inject({ method: 'GET', url: `/api/standup/audio-tracks/${track.id}/content`, headers: { range: 'bytes=999-' } })).statusCode).toBe(416);
    const teamId = (await app.inject({ method: 'GET', url: '/api/dataset' })).json().teams[0].id;
    expect((await app.inject({ method: 'PUT', url: `/api/teams/${teamId}/standup-audio`, payload: { defaultTrackId: track.id, memberAssignments: [] } })).statusCode).toBe(200);
    const blocked = await app.inject({ method: 'DELETE', url: `/api/standup/audio-tracks/${track.id}` });
    expect(blocked.statusCode).toBe(409); expect(blocked.json().references.teamIds).toEqual([teamId]);
    expect((await app.inject({ method: 'PUT', url: `/api/teams/${teamId}/standup-audio`, payload: { defaultTrackId: null, memberAssignments: [] } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/standup/audio-tracks/${track.id}` })).statusCode).toBe(204);
  });

  it('rejects non-MP3 bytes and exposes only the two upload CORS headers', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const bad = await app.inject({ method: 'POST', url: '/api/standup/audio-tracks', headers: { 'content-type': 'audio/mpeg', 'x-ecp-track-name': encoded, 'x-ecp-track-filename': encoded }, payload: Buffer.from('not-mp3') });
    expect(bad.statusCode).toBe(400);
    const cors = await app.inject({ method: 'OPTIONS', url: '/api/standup/audio-tracks' });
    expect(cors.headers['access-control-allow-headers']).toBe('Content-Type, X-ECP-Track-Name, X-ECP-Track-Filename');
  });
});
