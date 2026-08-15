import { copyFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { arg, load, passwordSource } from './jira-store-common.js';
import { openDatabase } from '../db/database.js';
import { writeDataset } from '../db/persist.js';
import { SETTING_KEYS } from '@ecp/shared';
const store = await load(arg('--store')!, passwordSource()); const dbPath = resolve(arg('--db')!); const backup = resolve(dirname(dbPath), `${basename(dbPath, '.db')}.snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
if (existsSync(dbPath)) renameSync(dbPath, backup); for (const suffix of ['-wal', '-shm']) { const sidecar = `${dbPath}${suffix}`; if (existsSync(sidecar)) unlinkSync(sidecar); }
const db = openDatabase({ path: dbPath }); try { writeDataset(db, store.ecpSeed.dataset); for (const [key, value] of [[SETTING_KEYS.JIRA_STORE_ID, store.storeId], [SETTING_KEYS.JIRA_STORE_SCHEMA_VERSION, store.schemaVersion]]) db.prepare("INSERT INTO settings (key, scope, scope_id, value) VALUES (?, 'global', '', ?) ON CONFLICT(key, scope, scope_id) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value)); } finally { db.close(); }
console.log(`Reset complete. Previous database: ${existsSync(backup) ? backup : 'none'}`);
