import { randomBytes, scrypt as scryptCallback, createCipheriv, createDecipheriv } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { STORE_FORMAT, STORE_VERSION, JiraStoreError, type EncryptedJiraStoreEnvelopeV1 } from './schema.js';

const MAX_CIPHERTEXT = 64 * 1024 * 1024;
const MAX_PLAINTEXT = 128 * 1024 * 1024;
const KDF = { N: 131072, r: 8, p: 1 } as const;
// The tag authenticates the ciphertext/AAD and therefore cannot itself be AAD.
const header = (e: Omit<EncryptedJiraStoreEnvelopeV1, 'ciphertext'>) => JSON.stringify({ format: e.format, formatVersion: e.formatVersion, kdf: e.kdf, cipher: { name: e.cipher.name, iv: e.cipher.iv }, compression: e.compression });
type KdfParams = { N: number; r: number; p: number };
async function scryptKey(password: string, salt: Buffer, params: KdfParams): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password, salt, 32, { N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 }, (error, derived) => error ? reject(error) : resolve(Buffer.from(derived))));
}
async function key(password: string, salt: Buffer, kdf: KdfParams = KDF): Promise<Buffer> {
  if (kdf.N > KDF.N || kdf.r > KDF.r || kdf.p > KDF.p || (kdf.N & (kdf.N - 1)) !== 0) throw new JiraStoreError('Encrypted Jira store uses unsupported KDF parameters.');
  return scryptKey(password.normalize('NFKC'), salt, kdf);
}
export async function encryptStore(plaintext: Buffer, password: string): Promise<EncryptedJiraStoreEnvelopeV1> {
  if (!password) throw new JiraStoreError('A Jira store password is required.'); if (plaintext.length > MAX_PLAINTEXT) throw new JiraStoreError('Jira store payload exceeds the size limit.');
  const salt = randomBytes(16), iv = randomBytes(12), k = await key(password, salt); const compressed = gzipSync(plaintext);
  const base = { format: STORE_FORMAT, formatVersion: STORE_VERSION, kdf: { name: 'scrypt' as const, ...KDF, salt: salt.toString('base64') }, cipher: { name: 'aes-256-gcm' as const, iv: iv.toString('base64'), tag: '' }, compression: 'gzip' as const };
  const cipher = createCipheriv('aes-256-gcm', k, iv); cipher.setAAD(Buffer.from(header(base))); const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]); base.cipher.tag = cipher.getAuthTag().toString('base64'); k.fill(0);
  return { ...base, ciphertext: ciphertext.toString('base64') };
}
export async function decryptStore(envelope: EncryptedJiraStoreEnvelopeV1, password: string): Promise<Buffer> {
  try {
    const salt = Buffer.from(envelope.kdf.salt, 'base64'), iv = Buffer.from(envelope.cipher.iv, 'base64'), tag = Buffer.from(envelope.cipher.tag, 'base64'), ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_CIPHERTEXT) throw new JiraStoreError('Invalid encrypted Jira store envelope.');
    const k = await key(password, salt, envelope.kdf); const decipher = createDecipheriv('aes-256-gcm', k, iv); decipher.setAAD(Buffer.from(header(envelope))); decipher.setAuthTag(tag); const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]); k.fill(0);
    const plain = gunzipSync(compressed, { maxOutputLength: MAX_PLAINTEXT }); if (plain.length > MAX_PLAINTEXT) throw new JiraStoreError('Jira store payload exceeds the size limit.'); return plain;
  } catch (error) { if (error instanceof JiraStoreError) throw error; throw new JiraStoreError('Unable to authenticate or decrypt encrypted Jira store.'); }
}
