import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/database.js';
import { writeDataset } from '../src/db/persist.js';
import { generateSyntheticDataset } from '../src/importer/synthetic.js';
import { HttpError } from '../src/http-error.js';
import * as ceremonies from '../src/db/sprint-ceremony.js';

let db: Db;
beforeEach(() => { db = openDatabase({ path: ':memory:' }); writeDataset(db, generateSyntheticDataset()); });
function expectHttp(fn: () => unknown, status: number) { try { fn(); } catch (error) { expect(error).toBeInstanceOf(HttpError); expect((error as HttpError).statusCode).toBe(status); return; } throw new Error('Expected HTTP error'); }

describe('sprint ceremonies', () => {
  it('opens idempotently, tracks revisions, and freezes an immutable planning snapshot', async () => {
    const sprint = db.prepare('SELECT * FROM sprint WHERE team_id = ? LIMIT 1').get('team-platform') as any;
    const first = ceremonies.openCeremony(db, { teamId: 'team-platform', sprintId: sprint.id, kind: 'planning' });
    expect(ceremonies.openCeremony(db, { teamId: 'team-platform', sprintId: sprint.id, kind: 'planning' }).ceremony.id).toBe(first.ceremony.id);
    const item = db.prepare('SELECT key FROM work_item LIMIT 1').get() as any;
    const planned = ceremonies.setPlanItem(db, first.ceremony.id, item.key, { expectedRevision: 0 });
    expect(planned.planItems).toEqual([item.key]);
    const secondItem = (db.prepare('SELECT key FROM work_item WHERE key != ? LIMIT 1').get(item.key) as any).key;
    const withSecond = ceremonies.setPlanItem(db, first.ceremony.id, secondItem, { expectedRevision: planned.ceremony.revision });
    expect(ceremonies.reorderPlanItems(db, first.ceremony.id, { expectedRevision: withSecond.ceremony.revision, workItemKeys: [secondItem, item.key] }).planItems).toEqual([secondItem, item.key]);
    expect((await ceremonies.refreshCeremonyContext(db, first.ceremony.id)).context.items.map((entry) => entry.key).sort()).toEqual([item.key, secondItem].sort());
    expectHttp(() => ceremonies.addNote(db, first.ceremony.id, { expectedRevision: 0, body: 'Stale', targetKind: 'global' }), 409);
    const finalized = ceremonies.finalizeCeremony(db, first.ceremony.id, { expectedRevision: 3, payload: { capacity: { adjustedCapacity: 9999 }, selected: [item.key] } });
    expect(finalized.ceremony.status).toBe('finalized');
    expect(finalized.snapshots[0]).toMatchObject({ purpose: 'planning-baseline', payload: { schemaVersion: 1, source: 'stored' } });
    expect((finalized.snapshots[0]!.payload as { items: Array<{ key: string }> }).items.map((entry) => entry.key).sort()).toEqual([item.key, secondItem].sort());
    expect((finalized.snapshots[0]!.payload as { capacity: { adjustedCapacity: number } }).capacity.adjustedCapacity).not.toBe(9999);
    expectHttp(() => ceremonies.setPlanItem(db, first.ceremony.id, item.key, { expectedRevision: finalized.ceremony.revision }), 409);
    const reopened = ceremonies.reopenPlanningCeremony(db, first.ceremony.id, { expectedRevision: finalized.ceremony.revision });
    expect(reopened.ceremony.status).toBe('draft');
    expect(reopened.snapshots).toHaveLength(1);
  });

  it('keeps note ordering durable and rejects unavailable plan items', () => {
    const sprint = db.prepare('SELECT * FROM sprint WHERE team_id = ? LIMIT 1').get('team-platform') as any;
    const opened = ceremonies.openCeremony(db, { teamId: 'team-platform', sprintId: sprint.id, kind: 'planning' });
    expectHttp(() => ceremonies.setPlanItem(db, opened.ceremony.id, 'UNKNOWN-1', { expectedRevision: 0 }), 404);
    const first = ceremonies.addNote(db, opened.ceremony.id, { expectedRevision: 0, body: 'First', targetKind: 'global' });
    const second = ceremonies.addNote(db, opened.ceremony.id, { expectedRevision: first.ceremony.revision, body: 'Second', targetKind: 'metric', targetLabel: 'Capacity' });
    const reordered = ceremonies.reorderNotes(db, opened.ceremony.id, { expectedRevision: second.ceremony.revision, noteIds: second.notes.map((entry) => entry.id).reverse() });
    expect(reordered.notes.map((entry) => entry.body)).toEqual(['Second', 'First']);
  });

  it('survives a dataset replacement used by sync', () => {
    const sprint = db.prepare('SELECT * FROM sprint WHERE team_id = ? LIMIT 1').get('team-platform') as any;
    const opened = ceremonies.openCeremony(db, { teamId: 'team-platform', sprintId: sprint.id, kind: 'review' });
    writeDataset(db, generateSyntheticDataset());
    expect(ceremonies.getCeremony(db, opened.ceremony.id).ceremony.sprintName).toBe(sprint.name);
  });

  it('carries linked planning notes into a review as read-only comparison context', () => {
    const sprint = db.prepare('SELECT * FROM sprint WHERE team_id = ? LIMIT 1').get('team-platform') as any;
    const planning = ceremonies.openCeremony(db, { teamId: 'team-platform', sprintId: sprint.id, kind: 'planning' });
    const noted = ceremonies.addNote(db, planning.ceremony.id, { expectedRevision: planning.ceremony.revision, body: 'Protect the migration window.', targetKind: 'metric', targetLabel: 'Capacity' });
    ceremonies.finalizeCeremony(db, planning.ceremony.id, { expectedRevision: noted.ceremony.revision });
    const review = ceremonies.openCeremony(db, { teamId: 'team-platform', sprintId: sprint.id, kind: 'review' });
    expect(review.comparisonNotes).toMatchObject([{ body: 'Protect the migration window.', targetLabel: 'Capacity' }]);
  });

  it('returns the last successful draft context as stale when a later Jira refresh fails', async () => {
    const sprint = db.prepare('SELECT * FROM sprint WHERE team_id = ? LIMIT 1').get('team-platform') as any;
    db.prepare("INSERT OR REPLACE INTO settings (key, scope, scope_id, value) VALUES ('jira_story_points_field', 'global', '', ?)").run(JSON.stringify('customfield_10016'));
    db.prepare("INSERT INTO sprint (id, team_id, name, start_date, end_date) VALUES ('123', ?, ?, ?, ?)").run(sprint.team_id, sprint.name, sprint.start_date, sprint.end_date);
    const opened = ceremonies.openCeremony(db, { teamId: 'team-platform', sprintId: '123', kind: 'review' });
    const jira = { searchJql: async () => ({ issues: [], isLast: true }) } as any;
    expect((await ceremonies.refreshCeremonyContext(db, opened.ceremony.id, jira)).context).toMatchObject({ source: 'jira', freshness: 'fresh' });
    const stale = await ceremonies.refreshCeremonyContext(db, opened.ceremony.id, undefined);
    expect(stale.context).toMatchObject({ source: 'jira', freshness: 'stale', errorMessage: 'Jira is unavailable.' });
  });
});
