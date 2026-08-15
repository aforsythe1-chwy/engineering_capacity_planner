import { describe, expect, it, vi } from 'vitest';
import { FakeJiraClient } from '../src/jira/fake-client.js';
import { CachedJiraClient, JiraRequestCache } from '../src/jira/request-cache.js';

describe('JiraRequestCache', () => {
  it('reuses reads, coalesces concurrent callers, and clears explicitly', async () => {
    const raw = new FakeJiraClient();
    const listBoards = vi.spyOn(raw, 'listBoards');
    const cache = new JiraRequestCache(60_000, true);
    const client = new CachedJiraClient(raw, cache);
    await Promise.all([client.listBoards('CKT'), client.listBoards('CKT')]);
    await client.listBoards('CKT');
    expect(listBoards).toHaveBeenCalledTimes(1);
    expect(cache.snapshot().map((event) => event.outcome)).toEqual(expect.arrayContaining(['network', 'coalesced', 'cache-hit']));
    cache.clear();
    await client.listBoards('CKT');
    expect(listBoards).toHaveBeenCalledTimes(2);
  });
});
