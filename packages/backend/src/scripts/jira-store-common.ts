import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { decryptStore, encryptStore } from '../jira/store/crypto.js';
import { resolveStorePassword, type JiraStorePasswordSource } from '../jira/store/load.js';
import { validateEnvelope, validateStore, type OfflineJiraStoreV1 } from '../jira/store/schema.js';
import { DEFAULT_JIRA_STORE_PASSWORD_OP_REF } from '../config.js';

export function arg(name: string, required = true): string | null { const i = process.argv.indexOf(name); const value = i < 0 ? null : process.argv[i + 1] ?? null; if (required && !value) throw new Error(`Missing ${name}.`); return value; }
export function passwordSource(): JiraStorePasswordSource { const passwordFile = arg('--password-file', false); const opRef = arg('--password-op-ref', false); return passwordFile ? { passwordFile } : { opRef: opRef ?? DEFAULT_JIRA_STORE_PASSWORD_OP_REF }; }
export async function load(path: string, source: JiraStorePasswordSource): Promise<OfflineJiraStoreV1> { const envelope = validateEnvelope(JSON.parse(readFileSync(path, 'utf8'))); return validateStore(JSON.parse((await decryptStore(envelope, await resolveStorePassword(source))).toString('utf8'))); }
export async function write(path: string, store: OfflineJiraStoreV1, source: JiraStorePasswordSource): Promise<void> { const envelope = await encryptStore(Buffer.from(JSON.stringify(store)), await resolveStorePassword(source)); const target = resolve(path); const temporary = resolve(dirname(target), `.${randomUUID()}.jira-store.enc.tmp`); writeFileSync(temporary, JSON.stringify(envelope)); renameSync(temporary, target); }
export function safeSummary(store: OfflineJiraStoreV1): Record<string, unknown> { return { format: 'ecp-jira-store/v1', capturedAt: store.capturedAt, issues: store.jira.issues.length, boards: store.jira.boards.length, sprints: Object.values(store.jira.sprintsByBoard).flat().length, fields: store.jira.fields.length, seed: { teams: store.ecpSeed.dataset.teams.length, members: store.ecpSeed.dataset.members.length, epics: store.ecpSeed.dataset.epics.length, workItems: store.ecpSeed.dataset.workItems.length }, avatarFallbacks: store.fidelity.avatarFallbackAccountIds.length }; }
