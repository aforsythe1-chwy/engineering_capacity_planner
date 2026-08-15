import type { JiraClient } from '../client.js';
import type { JiraBoard, JiraCreatedIssue, JiraCreateIssueInput, JiraCreateLinkInput, JiraField, JiraIssue, JiraIssueFields, JiraIssueLinkType, JiraSearchResult, JiraSprint, JiraUser } from '../types.js';
import type { OfflineJiraStoreV1 } from './schema.js';

function project(fields: JiraIssueFields, requested?: string[]): JiraIssueFields {
  if (!requested || !requested.length || requested.includes('*all')) return structuredClone(fields);
  return Object.fromEntries(requested.filter((key) => key in fields).map((key) => [key, structuredClone(fields[key])])) as JiraIssueFields;
}
/** Read-only, in-memory implementation of the Jira surface used by ECP. */
export class ReplayJiraClient implements JiraClient {
  private readonly issues: JiraIssue[];
  constructor(private readonly store: OfflineJiraStoreV1) { this.issues = store.jira.issues; }
  async getCurrentUser(): Promise<JiraUser> { return structuredClone(this.store.jira.currentUser); }
  async searchUsers(query: string): Promise<JiraUser[]> { const q = query.trim().toLowerCase(); return this.store.jira.directoryUsers.filter((u) => !q || u.displayName.toLowerCase().includes(q)).map((u) => structuredClone(u)); }
  async listFields(): Promise<JiraField[]> { return structuredClone(this.store.jira.fields); }
  async listIssueLinkTypes(): Promise<JiraIssueLinkType[]> { return structuredClone(this.store.jira.issueLinkTypes); }
  async getIssue(idOrKey: string, fields?: string[]): Promise<JiraIssue> { const issue = this.issues.find((i) => i.key === idOrKey || i.id === idOrKey); if (!issue) throw new Error('Offline Jira replay: issue not found.'); return { id: issue.id, key: issue.key, fields: project(issue.fields, fields) }; }
  async searchJql(input: { jql: string; fields: string[]; maxResults?: number; nextPageToken?: string }): Promise<JiraSearchResult> {
    let issues = this.issues.filter((i) => this.match(i, input.jql)); const start = input.nextPageToken ? Number(input.nextPageToken) : 0; const limit = input.maxResults ?? 100; issues = issues.slice(start, start + limit); const end = start + issues.length; const isLast = end >= this.issues.filter((i) => this.match(i, input.jql)).length;
    return { issues: issues.map((i) => ({ id: i.id, key: i.key, fields: project(i.fields, input.fields) })), isLast, ...(isLast ? {} : { nextPageToken: String(end) }) };
  }
  private match(issue: JiraIssue, jql: string): boolean {
    const clauses = jql.replace(/\s+ORDER BY\s+.*$/i, '').split(/\s+AND\s+/i); const unquote = (v: string) => v.trim().replace(/^["']|["']$/g, '');
    return clauses.every((clause) => { let m: RegExpExecArray | null; if ((m = /^\s*project\s*=\s*(.+)$/i.exec(clause))) return issue.key.split('-')[0] === unquote(m[1]!); if ((m = /^\s*issuetype\s*=\s*(.+)$/i.exec(clause))) return issue.fields.issuetype?.name === unquote(m[1]!); if ((m = /^\s*parent\s*=\s*(.+)$/i.exec(clause))) return issue.fields.parent?.key === unquote(m[1]!); if ((m = /^\s*parent\s+in\s*\((.+)\)\s*$/i.exec(clause))) return new Set(m[1]!.split(',').map(unquote)).has(issue.fields.parent?.key ?? ''); return false; });
  }
  async listBoards(project?: string, name?: string): Promise<JiraBoard[]> { return this.store.jira.boards.filter((b) => (!project || b.location?.projectKey === project) && (!name || b.name.toLowerCase().includes(name.toLowerCase()))).map((b) => structuredClone(b)); }
  async listBoardIssues(boardId: number, fields: string[]): Promise<JiraIssue[]> { if (!this.store.jira.boards.some((b) => b.id === boardId)) throw new Error('Offline Jira replay: board not found.'); return this.issues.map((i) => ({ id: i.id, key: i.key, fields: project(i.fields, fields) })); }
  async listSprints(boardId: number): Promise<JiraSprint[]> { return structuredClone(this.store.jira.sprintsByBoard[String(boardId)] ?? []); }
  private readonly writeError = () => { throw new Error('Offline Jira replay is read-only; Jira writes are unavailable offline.'); };
  createIssue(_input: JiraCreateIssueInput): Promise<JiraCreatedIssue> { return this.writeError(); }
  createIssueLink(_input: JiraCreateLinkInput): Promise<void> { return this.writeError(); }
  setStatus(_key: string, _status: string): Promise<void> { return this.writeError(); }
}
