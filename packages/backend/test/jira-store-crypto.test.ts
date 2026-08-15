import { describe, expect, it } from 'vitest';
import { decryptStore, encryptStore } from '../src/jira/store/crypto.js';
import { validateEnvelope } from '../src/jira/store/schema.js';

describe('encrypted Jira store crypto', () => {
  it('round-trips authenticated data and uses fresh ciphertext each time', async () => {
    const bytes = Buffer.from('{"schemaVersion":1}');
    const [first, second] = await Promise.all([
      encryptStore(bytes, 'test-only-password'),
      encryptStore(bytes, 'test-only-password'),
    ]);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    await expect(decryptStore(validateEnvelope(first), 'test-only-password')).resolves.toEqual(bytes);
    await expect(decryptStore(validateEnvelope(first), 'wrong-password')).rejects.toThrow(/authenticate/i);
  });
});
