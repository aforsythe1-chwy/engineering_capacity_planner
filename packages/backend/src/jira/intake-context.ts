import type { IntakeRequest, StandupIntakeContext } from '@ecp/shared';
import type { JiraClient } from './client.js';

export const INTAKE_REQUESTS_JQL = 'labels = "tech-exp-intake" AND statusCategory != Done ORDER BY updated DESC, key ASC';
const DEFAULT_TIMEOUT_MS = 10_000;

function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<T>((_, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), timeoutMs); })]).finally(() => { if (timeout) clearTimeout(timeout); });
}

function request(issue: Awaited<ReturnType<JiraClient['searchJql']>>['issues'][number], jiraBaseUrl: string | null): IntakeRequest {
  const updated = issue.fields.updated;
  return {
    key: issue.key,
    url: jiraBaseUrl ? `${jiraBaseUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(issue.key)}` : null,
    summary: issue.fields.summary ?? issue.key,
    status: issue.fields.status?.name ?? 'Unknown',
    statusCategory: issue.fields.status?.statusCategory?.key ?? 'unknown',
    assigneeAccountId: issue.fields.assignee?.accountId ?? null,
    assigneeName: issue.fields.assignee?.displayName ?? null,
    updatedAt: typeof updated === 'string' ? updated : null,
    awarenessLogged: false,
  };
}

export async function refreshStandupIntakeRequests(client: JiraClient | undefined, jiraBaseUrl: string | null = null, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<StandupIntakeContext> {
  const capturedAt = new Date().toISOString();
  if (!client) return { capturedAt, source: 'snapshot', freshness: 'unavailable', requests: [], errorMessage: 'Jira is unavailable.' };
  try {
    const requests: IntakeRequest[] = []; let nextPageToken: string | undefined;
    do {
      const page = await within(client.searchJql({ jql: INTAKE_REQUESTS_JQL, fields: ['summary', 'status', 'assignee', 'updated'], maxResults: 100, nextPageToken }), timeoutMs);
      requests.push(...page.issues.map((issue) => request(issue, jiraBaseUrl)));
      nextPageToken = page.nextPageToken;
      if (page.isLast) break;
    } while (nextPageToken);
    return { capturedAt, source: 'jira', freshness: 'fresh', requests, errorMessage: null };
  } catch (error) {
    return { capturedAt, source: 'snapshot', freshness: 'unavailable', requests: [], errorMessage: error instanceof Error && error.message === 'timeout' ? 'Jira intake refresh timed out.' : 'Unable to refresh Jira intake requests.' };
  }
}
