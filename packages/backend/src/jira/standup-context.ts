import type { StandupMemberTicketContext, StandupSprintProgressContext, StandupSprintProgressItem, StandupTicket } from '@ecp/shared';
import type { JiraClient } from './client.js';
import { mapJiraStatus } from './mapper.js';

const MAX_TICKETS = 100;
const DEFAULT_TIMEOUT_MS = 10_000;
const jiraQuote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function ticket(issue: Awaited<ReturnType<JiraClient['searchJql']>>['issues'][number], jiraBaseUrl: string | null): StandupTicket {
  return {
    key: issue.key,
    url: jiraBaseUrl ? `${jiraBaseUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(issue.key)}` : null,
    summary: issue.fields.summary ?? issue.key,
    status: issue.fields.status?.name ?? 'Unknown',
    statusId: issue.fields.status?.id ?? null,
    statusCategory: issue.fields.status?.statusCategory?.key ?? 'unknown',
    assigneeAccountId: issue.fields.assignee?.accountId ?? null,
    assigneeName: issue.fields.assignee?.displayName ?? null,
    parentKey: issue.fields.parent?.key ?? null,
    parentSummary: null,
  };
}

export async function refreshStandupSprintProgress(client: JiraClient | undefined, input: { sprintId: string | null; sprintName: string | null; startDate: string | null; endDate: string | null; storyPointsField: string | null; jiraBaseUrl?: string | null }, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<StandupSprintProgressContext> {
  const capturedAt = new Date().toISOString();
  const unavailable = (errorMessage: string): StandupSprintProgressContext => ({ sprintId: input.sprintId ?? '', sprintName: input.sprintName ?? 'Sprint', startDate: input.startDate, endDate: input.endDate, capturedAt, source: 'snapshot', freshness: 'unavailable', items: [], errorMessage, truncated: false });
  if (!client) return unavailable('Jira is unavailable.');
  if (!input.sprintId || !/^\d+$/.test(input.sprintId)) return unavailable('No sprint is associated with this standup.');
  if (!input.storyPointsField) return unavailable('Story-points mapping is unavailable.');
  try {
    const items: StandupSprintProgressItem[] = []; let nextPageToken: string | undefined; let truncated = false;
    do {
      const page = await within(client.searchJql({ jql: `sprint = ${input.sprintId} ORDER BY Rank ASC`, fields: ['summary', 'status', 'assignee', 'issuetype', input.storyPointsField], maxResults: Math.min(50, MAX_TICKETS - items.length), nextPageToken }), timeoutMs);
      for (const issue of page.issues) {
        if (/^epic$/i.test(issue.fields.issuetype?.name ?? '')) continue;
        const raw = issue.fields[input.storyPointsField]; const numeric = typeof raw === 'number' ? raw : Number(raw);
        items.push({ key: issue.key, summary: issue.fields.summary ?? issue.key, issueType: issue.fields.issuetype?.name ?? 'Issue', status: issue.fields.status?.name ?? 'Unknown', normalizedStatus: mapJiraStatus(issue.fields), points: Number.isFinite(numeric) && numeric >= 0 ? numeric : null, assigneeName: issue.fields.assignee?.displayName ?? null, url: input.jiraBaseUrl ? `${input.jiraBaseUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(issue.key)}` : null });
      }
      nextPageToken = page.nextPageToken;
      if (items.length >= MAX_TICKETS && nextPageToken) { truncated = true; break; }
      if (page.isLast) break;
    } while (nextPageToken);
    return { sprintId: input.sprintId, sprintName: input.sprintName ?? 'Sprint', startDate: input.startDate, endDate: input.endDate, capturedAt, source: 'jira', freshness: 'fresh', items, errorMessage: null, truncated };
  } catch (error) { return unavailable(error instanceof Error && error.message === 'timeout' ? 'Jira sprint refresh timed out.' : 'Unable to refresh Jira sprint progress.'); }
}

function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<T>((_, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), timeoutMs); })]).finally(() => { if (timeout) clearTimeout(timeout); });
}

export async function refreshStandupMemberTickets(client: JiraClient | undefined, input: { memberId: string; sprintId: string | null; jiraAccountId: string | null; jiraBaseUrl?: string | null }, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<StandupMemberTicketContext> {
  const capturedAt = new Date().toISOString();
  if (!client) return { memberId: input.memberId, capturedAt, source: 'snapshot', freshness: 'unavailable', tickets: [], errorMessage: 'Jira is unavailable.', truncated: false };
  if (!input.sprintId) return { memberId: input.memberId, capturedAt, source: 'snapshot', freshness: 'unavailable', tickets: [], errorMessage: 'Sprint unavailable for this standup.', truncated: false };
  if (!input.jiraAccountId) return { memberId: input.memberId, capturedAt, source: 'snapshot', freshness: 'unavailable', tickets: [], errorMessage: 'This team member is not linked to a Jira account.', truncated: false };
  try {
    const jql = `sprint = ${input.sprintId} AND assignee = ${jiraQuote(input.jiraAccountId)} ORDER BY Rank ASC`;
    const tickets: StandupTicket[] = []; let nextPageToken: string | undefined; let truncated = false;
    do {
      const page = await within(client.searchJql({ jql, fields: ['summary', 'status', 'assignee', 'parent', 'issuetype'], maxResults: Math.min(50, MAX_TICKETS - tickets.length), nextPageToken }), timeoutMs);
      tickets.push(...page.issues.map((issue) => ticket(issue, input.jiraBaseUrl ?? null))); nextPageToken = page.nextPageToken;
      if (tickets.length >= MAX_TICKETS && nextPageToken) { truncated = true; break; }
      if (page.isLast) break;
    } while (nextPageToken);
    return { memberId: input.memberId, capturedAt, source: 'jira', freshness: 'fresh', tickets, errorMessage: null, truncated };
  } catch (error) {
    const timedOut = error instanceof Error && error.message === 'timeout';
    return { memberId: input.memberId, capturedAt, source: 'snapshot', freshness: 'unavailable', tickets: [], errorMessage: timedOut ? 'Jira ticket refresh timed out.' : 'Unable to refresh Jira tickets.', truncated: false };
  }
}
