import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/database.js';
import { writeDataset } from '../src/db/persist.js';
import { generateSyntheticDataset } from '../src/importer/synthetic.js';
import { buildStoredSprintContext, refreshSprintContext } from '../src/jira/sprint-context.js';
let db: Db; beforeEach(() => { db = openDatabase({ path: ':memory:' }); writeDataset(db, generateSyntheticDataset()); });
describe('stored sprint context', () => it('builds stable current facts for a team and sprint', () => { const sprint = db.prepare('SELECT id FROM sprint WHERE team_id = ? LIMIT 1').get('team-platform') as any; const context = buildStoredSprintContext(db, 'team-platform', sprint.id); expect(context).toMatchObject({ source: 'stored', freshness: 'fresh', truncated: false, sprint: { id: sprint.id } }); expect(context.items.length).toBeGreaterThan(0); expect(context.items[0]).toHaveProperty('key'); expect(context.items[0]).toHaveProperty('assigneeMemberName'); }));

describe('Jira sprint context', () => it('maps a requested sprint through the bounded Jira source and retains local epic/member attribution', async () => {
  const item = db.prepare('SELECT key FROM work_item LIMIT 1').get() as { key: string };
  db.prepare("INSERT INTO sprint (id, team_id, name, start_date, end_date) VALUES ('123', 'team-platform', 'Jira Sprint', '2026-09-01', '2026-09-14')").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, scope, scope_id, value) VALUES ('jira_story_points_field', 'global', '', ?)").run(JSON.stringify('customfield_10016'));
  const client = { searchJql: async () => ({ issues: [{ id: '1', key: item.key, fields: { summary: 'Example', issuetype: { name: 'Task' }, status: { name: 'Done', statusCategory: { key: 'done' } }, assignee: null, customfield_10016: 5 } }], isLast: true }) } as any;
  const context = await refreshSprintContext(db, client, { teamId: 'team-platform', sprintId: '123' });
  expect(context).toMatchObject({ source: 'jira', freshness: 'fresh', truncated: false, items: [{ key: item.key, points: 5, status: 'Done' }] });
}));
