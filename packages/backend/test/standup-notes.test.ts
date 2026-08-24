import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function startStandup() {
  app = await buildServer({ dbPath: ':memory:' });
  const dataset = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
  const team = dataset.teams[0];
  const started = await app.inject({ method: 'POST', url: '/api/standups/start', payload: { teamId: team.id, date: '2026-08-24' } });
  expect(started.statusCode).toBe(200);
  return started.json();
}

describe('Standup note participant context', () => {
  it('captures the active participant, retains it on update, and carries it forward', async () => {
    const started = await startStandup();
    const [current, another] = started.participants;
    expect(current).toBeDefined();
    expect(another).toBeDefined();

    const created = await app!.inject({
      method: 'POST',
      url: `/api/standups/${started.session.id}/notes`,
      payload: { body: 'Review current work', audience: { allTeam: true }, expectedRevision: started.session.revision },
    });
    expect(created.statusCode).toBe(200);
    const note = created.json().notes[0];
    expect(note).toMatchObject({ allTeam: true, contextMemberId: current.memberId, contextMemberName: current.memberName });
    expect(note.memberIds).toEqual([current.memberId]);

    const updated = await app!.inject({
      method: 'PUT',
      url: `/api/standups/${started.session.id}/notes/${note.id}`,
      payload: { body: 'Review current work with another teammate', audience: { allTeam: false, mentions: [{ kind: 'member', id: another.memberId }] }, expectedRevision: created.json().session.revision },
    });
    expect(updated.statusCode).toBe(200);
    const updatedNote = updated.json().notes[0];
    expect(updatedNote).toMatchObject({ contextMemberId: current.memberId, contextMemberName: current.memberName });
    expect(updatedNote.memberIds).toEqual(expect.arrayContaining([current.memberId, another.memberId]));

    const deferred = await app!.inject({
      method: 'PATCH',
      url: `/api/standups/${started.session.id}/notes/${note.id}/state`,
      payload: { state: 'deferred', expectedRevision: updated.json().session.revision },
    });
    expect(deferred.statusCode).toBe(200);

    const resumed = await app!.inject({ method: 'POST', url: '/api/standups/start', payload: { teamId: started.session.teamId, date: '2026-08-25' } });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().notes[0]).toMatchObject({
      body: 'Review current work with another teammate',
      contextMemberId: current.memberId,
      contextMemberName: current.memberName,
    });
  });

  it('does not assign participant context after the team round and rejects stale create revisions', async () => {
    const started = await startStandup();
    const current = started.participants[0];
    const resolved = await app!.inject({
      method: 'PUT',
      url: `/api/standups/${started.session.id}/participants/${current.memberId}`,
      payload: { disposition: 'completed', expectedRevision: started.session.revision },
    });
    expect(resolved.statusCode).toBe(200);

    const stale = await app!.inject({
      method: 'POST',
      url: `/api/standups/${started.session.id}/notes`,
      payload: { body: 'This must not save', audience: { allTeam: true }, expectedRevision: started.session.revision },
    });
    expect(stale.statusCode).toBe(409);
    expect((await app!.inject({ method: 'GET', url: `/api/standups/${started.session.id}` })).json().notes).toEqual([]);

    let aggregate = resolved.json();
    for (const participant of aggregate.participants.filter((entry: { disposition: string }) => entry.disposition === 'pending')) {
      const next = await app!.inject({
        method: 'PUT',
        url: `/api/standups/${started.session.id}/participants/${participant.memberId}`,
        payload: { disposition: 'completed', expectedRevision: aggregate.session.revision },
      });
      expect(next.statusCode).toBe(200);
      aggregate = next.json();
    }
    expect(aggregate.session.status).toBe('post_standup');

    const postStandup = await app!.inject({
      method: 'POST',
      url: `/api/standups/${started.session.id}/notes`,
      payload: { body: 'Wrap up after standup', audience: { allTeam: true }, expectedRevision: aggregate.session.revision },
    });
    expect(postStandup.statusCode).toBe(200);
    expect(postStandup.json().notes[0]).toMatchObject({ contextMemberId: null, contextMemberName: null, memberIds: [] });
  });
});
