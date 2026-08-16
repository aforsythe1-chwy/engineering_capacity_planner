import type { JiraClient } from './client.js';
import type { JiraBoard, JiraBoardConfiguration, JiraCreatedIssue, JiraCreateIssueInput, JiraCreateLinkInput, JiraField, JiraIssue, JiraIssueLinkType, JiraSearchResult, JiraSprint, JiraStatus, JiraUser } from './types.js';

export type JiraRequestCacheOutcome = 'network' | 'cache-hit' | 'coalesced' | 'error';
export interface JiraRequestCacheEvent { at: string; operation: string; outcome: JiraRequestCacheOutcome; durationMs?: number }
type Entry = { expiresAt: number; value: unknown };

/** Bounded process-local cache for Jira reads. It never stores credentials or logs Jira data. */
export class JiraRequestCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly events: JiraRequestCacheEvent[] = [];
  constructor(private readonly ttlMs: number, private readonly debug = false) {}
  async read<T>(operation: string, input: unknown, fetcher: () => Promise<T>): Promise<T> {
    const key = `${operation}:${JSON.stringify(input)}`; const now = Date.now(); const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now) { this.record({ at: new Date().toISOString(), operation, outcome: 'cache-hit' }); return structuredClone(hit.value) as T; }
    const inFlight = this.pending.get(key);
    if (inFlight) { this.record({ at: new Date().toISOString(), operation, outcome: 'coalesced' }); return structuredClone(await inFlight) as T; }
    const started = Date.now(); const promise = fetcher(); this.pending.set(key, promise);
    try { const value = await promise; if (this.ttlMs > 0) this.entries.set(key, { value: structuredClone(value), expiresAt: Date.now() + this.ttlMs }); this.record({ at: new Date().toISOString(), operation, outcome: 'network', durationMs: Date.now() - started }); return structuredClone(value); }
    catch (error) { this.record({ at: new Date().toISOString(), operation, outcome: 'error', durationMs: Date.now() - started }); throw error; }
    finally { this.pending.delete(key); }
  }
  clear(): void { this.entries.clear(); this.pending.clear(); }
  snapshot(): JiraRequestCacheEvent[] { return this.debug ? [...this.events] : []; }
  get enabled(): boolean { return this.debug; }
  private record(event: JiraRequestCacheEvent): void { if (!this.debug) return; this.events.push(event); if (this.events.length > 50) this.events.splice(0, this.events.length - 50); }
}

/** Decorates a Jira client so all read operations share the same cache. */
export class CachedJiraClient implements JiraClient {
  constructor(private readonly client: JiraClient, private readonly cache: JiraRequestCache) {}
  getCurrentUser(): Promise<JiraUser> { return this.cache.read('getCurrentUser', null, () => this.client.getCurrentUser()); }
  searchUsers(query: string): Promise<JiraUser[]> { return this.cache.read('searchUsers', query, () => this.client.searchUsers(query)); }
  listFields(): Promise<JiraField[]> { return this.cache.read('listFields', null, () => this.client.listFields()); }
  listIssueLinkTypes(): Promise<JiraIssueLinkType[]> { return this.cache.read('listIssueLinkTypes', null, () => this.client.listIssueLinkTypes()); }
  searchJql(input: { jql: string; fields: string[]; maxResults?: number; nextPageToken?: string }): Promise<JiraSearchResult> { return this.cache.read('searchJql', input, () => this.client.searchJql(input)); }
  getIssue(idOrKey: string, fields?: string[]): Promise<JiraIssue> { return this.cache.read('getIssue', { idOrKey, fields }, () => this.client.getIssue(idOrKey, fields)); }
  listBoards(projectKeyOrId?: string, name?: string): Promise<JiraBoard[]> { return this.cache.read('listBoards', { projectKeyOrId, name }, () => this.client.listBoards(projectKeyOrId, name)); }
  listBoardIssues(boardId: number, fields: string[]): Promise<JiraIssue[]> { return this.cache.read('listBoardIssues', { boardId, fields: [...fields].sort() }, () => this.client.listBoardIssues(boardId, fields)); }
  getBoardConfiguration(boardId: number): Promise<JiraBoardConfiguration> { return this.cache.read('getBoardConfiguration', boardId, () => this.client.getBoardConfiguration(boardId)); }
  listStatuses(): Promise<JiraStatus[]> { return this.cache.read('listStatuses', null, () => this.client.listStatuses()); }
  listSprints(boardId: number): Promise<JiraSprint[]> { return this.cache.read('listSprints', boardId, () => this.client.listSprints(boardId)); }
  async createIssue(input: JiraCreateIssueInput): Promise<JiraCreatedIssue> { const result = await this.client.createIssue(input); this.cache.clear(); return result; }
  async createIssueLink(input: JiraCreateLinkInput): Promise<void> { await this.client.createIssueLink(input); this.cache.clear(); }
  async setStatus(key: string, status: string): Promise<void> { await this.client.setStatus(key, status); this.cache.clear(); }
}
