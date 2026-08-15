import { readFileSync } from 'node:fs';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { decryptStore } from './crypto.js';
import { validateEnvelope, validateStore, type OfflineJiraStoreV1 } from './schema.js';

export function readStorePassword(path: string): string {
  const password = readFileSync(path, 'utf8').replace(/[\r\n]+$/, '');
  if (!password) throw new Error('Jira store password file is empty.'); return password;
}
const execFile = promisify(execFileCallback);
export interface JiraStorePasswordSource { passwordFile?: string | null; opRef?: string | null }
/** Resolve the secret without invoking a shell or exposing it in process arguments. */
export async function resolveStorePassword(source: JiraStorePasswordSource): Promise<string> {
  if (source.passwordFile && source.opRef) throw new Error('Configure either ECP_JIRA_STORE_PASSWORD_FILE or ECP_JIRA_STORE_PASSWORD_OP_REF, not both.');
  if (source.passwordFile) return readStorePassword(source.passwordFile);
  if (!source.opRef) throw new Error('A Jira store password source is required.');
  try {
    const { stdout } = await execFile('op', ['read', source.opRef], { maxBuffer: 16 * 1024 });
    const password = stdout.replace(/[\r\n]+$/, '');
    if (!password) throw new Error('empty response');
    return password;
  } catch {
    throw new Error('Unable to read the Jira store password from 1Password. Install and sign in to the 1Password CLI, then verify ECP_JIRA_STORE_PASSWORD_OP_REF.');
  }
}
export async function loadJiraStore(path: string, source: JiraStorePasswordSource): Promise<OfflineJiraStoreV1> {
  const raw = readFileSync(path, 'utf8'); const envelope = validateEnvelope(JSON.parse(raw)); const plaintext = await decryptStore(envelope, await resolveStorePassword(source));
  try { return validateStore(JSON.parse(plaintext.toString('utf8'))); } finally { plaintext.fill(0); }
}
