import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { buildServer } from '../src/server.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('API server', () => {
  it('auto-seeds an empty database and serves the dataset', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const res = await app.inject({ method: 'GET', url: '/api/dataset' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.epics[0].key).toBe('CKT');
    expect(data.workItems).toHaveLength(50);
  });

  it('reports a summary consistent with the dataset', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const res = await app.inject({ method: 'GET', url: '/api/summary' });
    expect(res.statusCode).toBe(200);
    const summary = res.json();
    expect(summary.epics).toEqual(['CKT']);
    expect(summary.workItems).toBe(50);
    expect(summary.dependencies).toBeGreaterThan(0);
  });

  it('sends a permissive CORS header for cross-origin dev fetches', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const res = await app.inject({ method: 'GET', url: '/api/summary' });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('leaves the database empty when seeding is disabled', async () => {
    app = await buildServer({ dbPath: ':memory:', seedIfEmpty: false });
    const res = await app.inject({ method: 'GET', url: '/api/summary' });
    expect(res.json().epics).toEqual([]);
  });

  it('answers the health check', async () => {
    app = await buildServer({ dbPath: ':memory:', seedIfEmpty: false });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json().status).toBe('ok');
    expect(res.json().databaseMode).toBe('persistent');
  });

  it('runs test mode against a disposable copy and resets it after close', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ecp-test-server-'));
    const sourcePath = join(dir, 'source.db');
    const source = await buildServer({ dbPath: sourcePath });
    await source.close();
    const workspacesBefore = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('ecp-test-db-')));

    app = await buildServer({ dbPath: sourcePath, testDb: true });
    expect((await app.inject({ method: 'GET', url: '/health' })).json().databaseMode).toBe('test-copy');
    expect((await app.inject({
      method: 'PATCH', url: '/api/settings', payload: { oncall_multiplier: 0.3 },
    })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/db/snapshot' })).statusCode).toBe(200);

    const original = new Database(sourcePath, { readonly: true, fileMustExist: true });
    expect(original.prepare("SELECT value FROM settings WHERE key = 'oncall_multiplier'").get()).toEqual({ value: '0.5' });
    original.close();
    expect(readdirSync(dir)).not.toContainEqual(expect.stringMatching(/snapshot/));

    await app.close();
    app = undefined;
    const workspacesAfter = readdirSync(tmpdir()).filter((name) => name.startsWith('ecp-test-db-'));
    expect(workspacesAfter.every((name) => workspacesBefore.has(name))).toBe(true);

    app = await buildServer({ dbPath: sourcePath, testDb: true });
    const settings = (await app.inject({ method: 'GET', url: '/api/dataset' })).json().settings;
    expect(settings.find((setting: { key: string }) => setting.key === 'oncall_multiplier')).toMatchObject({ value: '0.5' });
    await app.close();
    app = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('advertises the mutating verbs in CORS', async () => {
    app = await buildServer({ dbPath: ':memory:', seedIfEmpty: false });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    expect(res.headers['access-control-allow-methods']).toContain('DELETE');
  });
});

describe('Configuration write API', () => {
  it('patches a settings knob and reflects it in the dataset', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { oncall_multiplier: 0.3 },
    });
    expect(res.statusCode).toBe(200);
    const dataset = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
    const knob = dataset.settings.find((s: any) => s.key === 'oncall_multiplier');
    expect(JSON.parse(knob.value)).toBe(0.3);
  });

  it('creates then deletes a member through the API', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/members',
      payload: { teamId: 'team-platform', name: 'Zoe', baseVelocity: 9 },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const del = await app.inject({ method: 'DELETE', url: `/api/members/${id}` });
    expect(del.statusCode).toBe(204);
  });

  it('updates team cadence', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/teams/team-platform',
      payload: { sprintLengthDays: 7 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sprintLengthDays).toBe(7);
  });

  it('maps validation failures to 400 and missing resources to 404', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const bad = await app.inject({ method: 'PATCH', url: '/api/settings', payload: { bogus: 1 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBeDefined();

    const missing = await app.inject({ method: 'DELETE', url: '/api/pto/nope' });
    expect(missing.statusCode).toBe(404);
  });

  it('enforces the gating invariant with a 409', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const dataset = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
    const gate = dataset.milestones.find((m: any) => m.isGating);
    const res = await app.inject({ method: 'DELETE', url: `/api/milestones/${gate.id}` });
    expect(res.statusCode).toBe(409);
  });

  it('maintains global important dates through the Configuration API', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const created = await app.inject({ method: 'POST', url: '/api/important-dates', payload: { name: 'Planning', date: '2026-09-10', iconKey: 'users' } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await app.inject({ method: 'PUT', url: `/api/important-dates/${id}`, payload: { iconKey: 'rocket' } })).json()).toMatchObject({ iconKey: 'rocket' });
    expect((await app.inject({ method: 'GET', url: '/api/dataset' })).json().importantDates).toMatchObject([{ id, name: 'Planning', iconKey: 'rocket' }]);
    expect((await app.inject({ method: 'DELETE', url: `/api/important-dates/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/api/important-dates', payload: { name: 'Bad', date: '2026-02-30', iconKey: 'svg' } })).statusCode).toBe(400);
  });
});

describe('Bandwidth check-in API', () => {
  it('upserts, lists, and clears one member/day check-in', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const dataset = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
    const memberId = dataset.members[0].id;
    const teamId = dataset.members[0].teamId;
    const date = '2026-08-14';

    const created = await app.inject({
      method: 'PUT', url: `/api/bandwidth-check-ins/${memberId}/${date}`,
      payload: { feeling: 'yellow', note: 'Interrupt load is high' },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ memberId, date, feeling: 'yellow', note: 'Interrupt load is high' });
    const createdAt = created.json().createdAt;

    const edited = await app.inject({
      method: 'PUT', url: `/api/bandwidth-check-ins/${memberId}/${date}`,
      payload: { feeling: 'red', note: '  ' },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ feeling: 'red', note: null, createdAt });

    const listed = await app.inject({ method: 'GET', url: `/api/bandwidth-check-ins?teamId=${teamId}&from=2026-08-01&to=2026-08-31` });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().checkIns).toHaveLength(1);

    const cleared = await app.inject({ method: 'DELETE', url: `/api/bandwidth-check-ins/${memberId}/${date}` });
    expect(cleared.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/bandwidth-check-ins?teamId=${teamId}&from=2026-08-01&to=2026-08-31` })).json().checkIns).toEqual([]);
  });

  it('includes standup check-ins in the team bandwidth calendar', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const dataset = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
    const member = dataset.members.find((entry: any) => entry.active);
    expect(member).toBeDefined();
    const date = '2026-08-18';

    const started = await app.inject({
      method: 'POST', url: '/api/standups/start', payload: { teamId: member.teamId, date },
    });
    expect(started.statusCode).toBe(200);
    const sessionId = started.json().session.id;
    expect((await app.inject({
      method: 'PUT', url: `/api/standups/${sessionId}/check-ins/${member.id}`,
      payload: { feeling: 'green' },
    })).statusCode).toBe(200);

    const listed = await app.inject({
      method: 'GET', url: `/api/bandwidth-check-ins?teamId=${member.teamId}&from=2026-08-01&to=2026-08-31`,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().checkIns).toMatchObject([{ memberId: member.id, date, sessionId, feeling: 'green' }]);
  });

  it('validates check-ins and prevents deleting members with history', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const memberId = (await app.inject({ method: 'GET', url: '/api/dataset' })).json().members[0].id;
    const bad = await app.inject({ method: 'PUT', url: `/api/bandwidth-check-ins/${memberId}/2026-02-30`, payload: { feeling: 'blue' } });
    expect(bad.statusCode).toBe(400);
    await app.inject({ method: 'PUT', url: `/api/bandwidth-check-ins/${memberId}/2026-08-14`, payload: { feeling: 'green' } });
    const removeMember = await app.inject({ method: 'DELETE', url: `/api/members/${memberId}` });
    expect(removeMember.statusCode).toBe(409);
  });

  it('reads and atomically patches a manual bandwidth day without replacing omitted members', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const dataset = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
    const members = dataset.members.filter((member: any) => member.teamId === 'team-platform');
    const [first, second] = members;
    const date = '2026-08-13';

    const saved = await app.inject({
      method: 'PATCH', url: `/api/teams/team-platform/bandwidth-check-ins/${date}`,
      payload: { upserts: [
        { memberId: first.id, feeling: 'yellow', note: 'Interrupt load' },
        { memberId: second.id, feeling: 'purple' },
      ], deleteMemberIds: [] },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ teamId: 'team-platform', date, standup: null });
    expect(saved.json().checkIns).toMatchObject([
      { memberId: first.id, feeling: 'yellow', note: 'Interrupt load', sessionId: null },
      { memberId: second.id, feeling: 'purple', sessionId: null },
    ]);

    const changed = await app.inject({
      method: 'PATCH', url: `/api/teams/team-platform/bandwidth-check-ins/${date}`,
      payload: { upserts: [{ memberId: first.id, feeling: 'red' }], deleteMemberIds: [] },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().checkIns).toMatchObject([
      { memberId: first.id, feeling: 'red', note: null },
      { memberId: second.id, feeling: 'purple' },
    ]);

    const rejected = await app.inject({
      method: 'PATCH', url: `/api/teams/team-platform/bandwidth-check-ins/2026-08-14`,
      payload: { upserts: [{ memberId: first.id, feeling: 'green' }], deleteMemberIds: ['missing-member'] },
    });
    expect(rejected.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/teams/team-platform/bandwidth-check-ins/2026-08-14' })).json().checkIns).toEqual([]);

    const cleared = await app.inject({
      method: 'PATCH', url: `/api/teams/team-platform/bandwidth-check-ins/${date}`,
      payload: { upserts: [], deleteMemberIds: [first.id] },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().checkIns).toMatchObject([{ memberId: second.id, feeling: 'purple' }]);
  });

  it('keeps Standup-owned bandwidth history read-only from generic and day APIs', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const dataset = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
    const member = dataset.members.find((entry: any) => entry.active);
    const date = '2026-08-19';
    const started = await app.inject({ method: 'POST', url: '/api/standups/start', payload: { teamId: member.teamId, date } });
    const sessionId = started.json().session.id;
    expect((await app.inject({ method: 'PUT', url: `/api/standups/${sessionId}/check-ins/${member.id}`, payload: { feeling: 'green' } })).statusCode).toBe(200);

    const day = await app.inject({ method: 'GET', url: `/api/teams/${member.teamId}/bandwidth-check-ins/${date}` });
    expect(day.statusCode).toBe(200);
    expect(day.json()).toMatchObject({ standup: { sessionId, status: 'active' }, checkIns: [{ memberId: member.id, sessionId }] });

    const genericEdit = await app.inject({ method: 'PUT', url: `/api/bandwidth-check-ins/${member.id}/${date}`, payload: { feeling: 'red' } });
    expect(genericEdit.statusCode).toBe(200);
    expect(genericEdit.json()).toMatchObject({ feeling: 'red', sessionId });
    expect((await app.inject({ method: 'DELETE', url: `/api/bandwidth-check-ins/${member.id}/${date}` })).statusCode).toBe(409);
    expect((await app.inject({
      method: 'PATCH', url: `/api/teams/${member.teamId}/bandwidth-check-ins/${date}`,
      payload: { upserts: [{ memberId: member.id, feeling: 'yellow' }], deleteMemberIds: [] },
    })).statusCode).toBe(409);
  });
});

describe('Database snapshot + import API', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('snapshots the live DB file to a timestamped copy', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ecp-srv-'));
    app = await buildServer({ dbPath: join(dir, 'ecp.db') });

    const res = await app.inject({ method: 'POST', url: '/api/db/snapshot' });
    expect(res.statusCode).toBe(200);
    expect(res.json().file).toMatch(/ecp-snapshot-.*\.db$/);
    expect(readdirSync(dir).some((f) => f.includes('snapshot'))).toBe(true);
  });

  it('rejects snapshotting an in-memory database with a 400', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const res = await app.inject({ method: 'POST', url: '/api/db/snapshot' });
    expect(res.statusCode).toBe(400);
  });

  it('imports an uploaded database and replaces the dataset', async () => {
    // Produce a real ECP database on disk via a throwaway server, then upload it.
    dir = mkdtempSync(join(tmpdir(), 'ecp-srv-'));
    const srcPath = join(dir, 'source.db');
    const src = await buildServer({ dbPath: srcPath, syntheticSeed: 42 });
    await src.inject({ method: 'GET', url: '/api/dataset' }); // force seed
    await src.close();
    const bytes = readFileSync(srcPath);

    app = await buildServer({ dbPath: ':memory:', seedIfEmpty: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/db/import',
      headers: { 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.workItems).toBe(50);

    const dataset = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
    expect(dataset.workItems).toHaveLength(50);
  });

  it('rejects a non-SQLite upload with a 400', async () => {
    app = await buildServer({ dbPath: ':memory:', seedIfEmpty: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/db/import',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('definitely not sqlite'),
    });
    expect(res.statusCode).toBe(400);
  });
});
