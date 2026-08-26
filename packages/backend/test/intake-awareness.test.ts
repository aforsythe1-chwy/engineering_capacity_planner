import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { FakeJiraClient } from '../src/jira/fake-client.js';

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

describe('Post-standup intake awareness', () => {
  it('saves one awareness record for a request in the session snapshot', async () => {
    const jira = new FakeJiraClient();
    jira.seedIssue({ id: '9982', key: 'NF-2982', fields: { summary: 'Incoming request', labels: ['tech-exp-intake'], status: { name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } }, updated: '2026-08-12T12:00:00.000Z' } });
    app = await buildServer({ dbPath: ':memory:', jiraBaseUrl: 'https://jira.example.test' }, { jiraClient: jira });
    const dataset = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
    const started = (await app.inject({ method: 'POST', url: '/api/standups/start', payload: { teamId: dataset.teams[0].id, date: '2026-08-12' } })).json();
    const refresh = await app.inject({ method: 'POST', url: `/api/standups/${started.session.id}/intake-requests/refresh` });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().requests).toHaveLength(1);
    const saved = await app.inject({ method: 'POST', url: `/api/standups/${started.session.id}/intake-requests/NF-2982/awareness`, payload: { awareDate: '2026-08-12', dateConfidence: 'medium', notes: '' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ jiraKey: 'NF-2982', dateConfidence: 'medium', notes: null });
  });
});
