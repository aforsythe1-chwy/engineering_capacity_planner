import { randomUUID } from 'node:crypto';
import { loadConfig, loadDotenv } from '../config.js';
import { openDatabase } from '../db/database.js';
import { readDataset } from '../db/persist.js';
import { readSyncLog } from '../db/sync-log.js';
import { buildJiraClient } from '../importer/factory.js';
import { resolveMapping } from '../jira/mapping.js';
import { CAPTURE_PROFILE, STORE_VERSION, type OfflineJiraStoreV1 } from '../jira/store/schema.js';
import { arg, passwordSource, safeSummary, write } from './jira-store-common.js';

loadDotenv(); const dbPath = arg('--db')!; const out = arg('--out')!; const password = passwordSource(); const config = loadConfig(); const db = openDatabase({ path: dbPath });
try {
  const dataset = readDataset(db); const mapping = resolveMapping(dataset.settings, config.jira); const client = buildJiraClient(config.jira); const boards = await client.listBoards(mapping.projectKey); const board = boards.find((b) => b.id === mapping.boardId) ?? boards[0];
  if (!board) throw new Error(`No Agile board found for project ${mapping.projectKey}.`);
  const fields = [...new Set(['summary', 'status', 'parent', 'issuetype', 'assignee', 'issuelinks', 'updated', mapping.storyPointsField, mapping.labelsField, ...(mapping.sprintField ? [mapping.sprintField] : [])])];
  const issues = await client.listBoardIssues(board.id, fields); const currentUser = await client.getCurrentUser(); const catalog = await client.listFields(); const linkTypes = await client.listIssueLinkTypes(); const users = new Map([[currentUser.accountId, currentUser]]);
  for (const issue of issues) { const assignee = issue.fields.assignee; if (assignee?.accountId) users.set(assignee.accountId, assignee); }
  const store: OfflineJiraStoreV1 = { schemaVersion: STORE_VERSION, storeId: randomUUID(), capturedAt: new Date().toISOString(), source: { projectKey: mapping.projectKey, boardId: board.id, boardName: board.name, jiraFlavor: config.jira.flavor ?? 'cloud', hierarchy: { mode: 'jira-epic', rootIssueTypeNames: ['Epic'] } }, mapping, jira: { currentUser, fields: catalog, issueLinkTypes: linkTypes, boards, sprintsByBoard: { [String(board.id)]: await client.listSprints(board.id) }, issues, directoryUsers: [...users.values()], avatarAssetsByAccountId: {} }, ecpSeed: { dataset, syncLog: readSyncLog(db) }, provenance: { captureProfile: CAPTURE_PROFILE, capturedIssueKeys: issues.map((i) => i.key), generatedIssueKeys: [], augmentationProfile: null }, fidelity: { avatarFallbackAccountIds: [...users.keys()] } };
  await write(out, store, password); console.log(JSON.stringify({ result: 'PASS', ...safeSummary(store) }, null, 2));
} finally { db.close(); }
