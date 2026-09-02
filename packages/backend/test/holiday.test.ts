import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/database.js';
import { readDataset, writeDataset } from '../src/db/persist.js';
import { generateSyntheticDataset } from '../src/importer/synthetic.js';
import { HttpError } from '../src/http-error.js';
import * as holidays from '../src/db/holiday.js';

let db: Db;
beforeEach(() => { db = openDatabase({ path: ':memory:' }); writeDataset(db, generateSyntheticDataset()); });
const expectHttp = (fn: () => unknown, status: number) => {
  try { fn(); } catch (error) { expect(error).toBeInstanceOf(HttpError); expect((error as HttpError).statusCode).toBe(status); return; }
  throw new Error('Expected HttpError');
};

describe('recurring team holidays', () => {
  it('creates, updates, lists, and persists an annual Labor Day rule', () => {
    const created = holidays.createHoliday(db, 'team-platform', { name: ' Labor Day ', recurrence: { kind: 'nth-weekday', month: 9, weekday: 1, ordinal: 1, observedPolicy: 'none' } });
    expect(created).toMatchObject({ name: 'Labor Day', recurrence: { kind: 'nth-weekday', month: 9, weekday: 1, ordinal: 1 } });
    const updated = holidays.updateHoliday(db, 'team-platform', created.id, { name: 'US Labor Day' });
    expect(updated.name).toBe('US Labor Day');
    expect(holidays.listHolidays(db, 'team-platform')).toEqual([updated]);
    expect(readDataset(db).holidays).toEqual([updated]);
  });

  it('rejects invalid rules, unknown fields, and semantic duplicates', () => {
    const input = { name: 'Labor Day', recurrence: { kind: 'nth-weekday', month: 9, weekday: 1, ordinal: 1, observedPolicy: 'none' } };
    holidays.createHoliday(db, 'team-platform', input);
    expectHttp(() => holidays.createHoliday(db, 'team-platform', input), 409);
    expectHttp(() => holidays.createHoliday(db, 'team-platform', { name: 'Bad', recurrence: { kind: 'fixed-date', month: 2, day: 30, observedPolicy: 'none' } }), 400);
    expectHttp(() => holidays.createHoliday(db, 'team-platform', { ...input, date: '2026-09-07' }), 400);
  });

  it('migrates date-specific rows to annual fixed-date rules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ecp-holiday-migration-'));
    const path = join(dir, 'legacy.db');
    const legacy = openDatabase({ path });
    legacy.exec("DROP TABLE team_holiday; CREATE TABLE team_holiday (id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE, date TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(team_id, date, name)); INSERT INTO team VALUES ('team-platform', 'Platform', 14, 1, '2026-01-01', '[1,2,3,4,5]'); INSERT INTO team_holiday VALUES ('legacy', 'team-platform', '2026-12-25', 'Christmas');");
    legacy.close();
    const migrated = openDatabase({ path });
    expect(readDataset(migrated).holidays).toMatchObject([{ id: 'legacy', name: 'Christmas', recurrence: { kind: 'fixed-date', month: 12, day: 25, observedPolicy: 'none' } }]);
    migrated.close(); rmSync(dir, { recursive: true, force: true });
  });
});
