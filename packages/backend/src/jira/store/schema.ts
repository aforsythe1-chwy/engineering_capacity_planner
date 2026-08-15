import type { DomainDataset, SyncLogEntry } from '@ecp/shared';
import type { JiraBoard, JiraField, JiraIssue, JiraIssueLinkType, JiraSprint, JiraUser } from '../types.js';
import type { JiraMapping } from '../mapping.js';

export const STORE_FORMAT = 'ecp-jira-store' as const;
export const STORE_VERSION = 1 as const;
export const CAPTURE_PROFILE = 'planner-surface-v1' as const;

export interface EncryptedJiraStoreEnvelopeV1 {
  format: typeof STORE_FORMAT; formatVersion: typeof STORE_VERSION;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string };
  cipher: { name: 'aes-256-gcm'; iv: string; tag: string };
  compression: 'gzip'; ciphertext: string;
}

export interface OfflineJiraStoreV1 {
  schemaVersion: typeof STORE_VERSION; storeId: string; capturedAt: string;
  source: { projectKey: string; boardId: number; boardName: string; jiraFlavor: 'cloud' | 'server'; hierarchy: { mode: 'jira-epic' | 'board-root'; rootIssueTypeNames: string[] } };
  mapping: JiraMapping;
  jira: { currentUser: JiraUser; fields: JiraField[]; issueLinkTypes: JiraIssueLinkType[]; boards: JiraBoard[]; sprintsByBoard: Record<string, JiraSprint[]>; issues: JiraIssue[]; directoryUsers: JiraUser[]; avatarAssetsByAccountId: Record<string, { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; bytesBase64: string; sha256: string }> };
  ecpSeed: { dataset: DomainDataset; syncLog: SyncLogEntry[] };
  provenance: { captureProfile: typeof CAPTURE_PROFILE; capturedIssueKeys: string[]; generatedIssueKeys: string[]; augmentationProfile: string | null };
  fidelity: { avatarFallbackAccountIds: string[] };
}

export class JiraStoreError extends Error {}

function record(v: unknown, name: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new JiraStoreError(`Invalid encrypted Jira store: ${name}.`);
  return v as Record<string, unknown>;
}
function str(v: unknown, name: string): string { if (typeof v !== 'string' || !v) throw new JiraStoreError(`Invalid encrypted Jira store: ${name}.`); return v; }

export function validateEnvelope(value: unknown): EncryptedJiraStoreEnvelopeV1 {
  const e = record(value, 'envelope'); const kdf = record(e.kdf, 'kdf'); const cipher = record(e.cipher, 'cipher');
  if (e.format !== STORE_FORMAT || e.formatVersion !== STORE_VERSION || e.compression !== 'gzip' || kdf.name !== 'scrypt' || cipher.name !== 'aes-256-gcm') throw new JiraStoreError('Unsupported encrypted Jira store format.');
  for (const [v, n] of [[kdf.N, 'kdf.N'], [kdf.r, 'kdf.r'], [kdf.p, 'kdf.p']]) if (!Number.isSafeInteger(v) || (v as number) < 1) throw new JiraStoreError(`Invalid encrypted Jira store: ${n}.`);
  for (const [v, n] of [[kdf.salt, 'kdf.salt'], [cipher.iv, 'cipher.iv'], [cipher.tag, 'cipher.tag'], [e.ciphertext, 'ciphertext']] as Array<[unknown, string]>) str(v, n);
  return e as unknown as EncryptedJiraStoreEnvelopeV1;
}

/** Strict enough to fail closed before a replay client or DB is touched. */
export function validateStore(value: unknown): OfflineJiraStoreV1 {
  const s = record(value, 'payload');
  if (s.schemaVersion !== STORE_VERSION) throw new JiraStoreError('Unsupported Jira store payload version.');
  for (const key of ['storeId', 'capturedAt']) str(s[key], key);
  const source = record(s.source, 'source'); str(source.projectKey, 'source.projectKey'); if (!Number.isSafeInteger(source.boardId)) throw new JiraStoreError('Invalid encrypted Jira store: source.boardId.');
  const jira = record(s.jira, 'jira');
  for (const key of ['fields', 'issueLinkTypes', 'boards', 'issues', 'directoryUsers']) if (!Array.isArray(jira[key])) throw new JiraStoreError(`Invalid encrypted Jira store: jira.${key}.`);
  const keys = new Set<string>();
  for (const issue of jira.issues as unknown[]) { const i = record(issue, 'jira.issue'); const key = str(i.key, 'jira.issue.key'); if (keys.has(key)) throw new JiraStoreError(`Invalid encrypted Jira store: duplicate issue key ${key}.`); keys.add(key); record(i.fields, 'jira.issue.fields'); }
  record(s.mapping, 'mapping'); const seed = record(s.ecpSeed, 'ecpSeed'); record(seed.dataset, 'ecpSeed.dataset'); if (!Array.isArray(seed.syncLog)) throw new JiraStoreError('Invalid encrypted Jira store: ecpSeed.syncLog.');
  return s as unknown as OfflineJiraStoreV1;
}
