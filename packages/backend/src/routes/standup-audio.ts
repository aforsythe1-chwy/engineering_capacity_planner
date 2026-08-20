/** HTTP delivery for the optional local Standup walk-off audio library. */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/database.js';
import * as audio from '../db/standup-audio.js';
import { HttpError } from '../http-error.js';

const UPLOAD_HEADERS = ['X-ECP-Track-Name', 'X-ECP-Track-Filename'];

function decodedHeader(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string' || value.length > 1_024) throw new HttpError(400, `${name} header is required and must be at most 1024 characters.`);
  try { return decodeURIComponent(value); } catch { throw new HttpError(400, `${name} header must be URI encoded.`); }
}
function isMpeg(buffer: Buffer): boolean {
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') return true;
  for (let index = 0; index < buffer.length - 1; index += 1) {
    if (buffer[index] === 0xff && (buffer[index + 1]! & 0xe0) === 0xe0) return true;
  }
  return false;
}
function range(value: string | undefined, length: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : undefined;
  const end = match[2] ? Number(match[2]) : undefined;
  if ((start !== undefined && !Number.isSafeInteger(start)) || (end !== undefined && !Number.isSafeInteger(end))) return null;
  if (start === undefined) { const suffix = end!; return suffix > 0 ? { start: Math.max(0, length - suffix), end: length - 1 } : null; }
  if (start >= length || (end !== undefined && end < start)) return null;
  return { start, end: Math.min(end ?? length - 1, length - 1) };
}

export function registerStandupAudioRoutes(app: FastifyInstance, db: Db): void {
  app.addContentTypeParser('audio/mpeg', { parseAs: 'buffer', bodyLimit: audio.MAX_STANDUP_AUDIO_TRACK_BYTES }, (_req, body, done) => done(null, body));

  app.get('/api/standup/audio-tracks', async () => audio.listStandupAudioTracks(db));
  app.post('/api/standup/audio-tracks', { bodyLimit: audio.MAX_STANDUP_AUDIO_TRACK_BYTES }, async (req, reply) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || !isMpeg(body)) throw new HttpError(400, 'Upload must be a non-empty MP3 with an ID3 header or MPEG frame sync.');
    const duplicate = audio.findDuplicateStandupAudioTrack(db, body);
    if (duplicate) { reply.code(409); return duplicate; }
    const track = audio.createStandupAudioTrack(db, { displayName: decodedHeader(req.headers['x-ecp-track-name'], 'X-ECP-Track-Name'), originalFilename: decodedHeader(req.headers['x-ecp-track-filename'], 'X-ECP-Track-Filename'), mimeType: req.headers['content-type']?.split(';')[0], audio: body });
    reply.code(201); return track;
  });
  app.get<{ Params: { trackId: string } }>('/api/standup/audio-tracks/:trackId/content', async (req, reply) => {
    const track = audio.getStandupAudioTrackContent(db, req.params.trackId);
    const selected = range(req.headers.range, track.byteLength);
    reply.header('Accept-Ranges', 'bytes').header('ETag', `"${track.sha256}"`).header('Cache-Control', 'private, max-age=3600').header('Content-Disposition', 'inline').type('audio/mpeg');
    if (req.headers.range && !selected) { reply.code(416).header('Content-Range', `bytes */${track.byteLength}`); return reply.send(); }
    if (!selected) { reply.header('Content-Length', track.byteLength); return reply.send(track.audio); }
    const chunk = track.audio.subarray(selected.start, selected.end + 1);
    reply.code(206).header('Content-Length', chunk.length).header('Content-Range', `bytes ${selected.start}-${selected.end}/${track.byteLength}`);
    return reply.send(chunk);
  });
  app.delete<{ Params: { trackId: string } }>('/api/standup/audio-tracks/:trackId', async (req, reply) => {
    const references = audio.standupAudioTrackReferences(db, req.params.trackId);
    if (references.teamIds.length || references.memberIds.length) { reply.code(409); return { error: 'Standup audio track is still assigned to a team or member', references }; }
    audio.deleteStandupAudioTrack(db, req.params.trackId); reply.code(204);
  });
  app.get<{ Params: { teamId: string } }>('/api/teams/:teamId/standup-audio', async (req) => audio.getTeamStandupAudioSettings(db, req.params.teamId));
  app.put<{ Params: { teamId: string } }>('/api/teams/:teamId/standup-audio', async (req) => audio.replaceTeamStandupAudioSettings(db, req.params.teamId, (req.body ?? {}) as audio.ReplaceTeamStandupAudioInput));
}

export { UPLOAD_HEADERS };
