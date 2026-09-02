import type { Db } from '../db/database.js';
import type { JiraClient } from './client.js';
import { refreshStandupSprintProgress } from './standup-context.js';
import { SETTING_KEYS } from '@ecp/shared';

export interface StoredSprintContext {
  source: 'jira' | 'stored'; freshness: 'fresh' | 'stale' | 'unavailable'; truncated: boolean; errorMessage?: string | null;
  sprint: { id: string; name: string; startDate: string; endDate: string };
  items: Array<{ key: string; points: number | null; status: string; epicKey: string | null; assigneeMemberId: string | null; assigneeMemberName: string | null }>;
}

/**
 * Builds a deterministic, local fallback context for any stored sprint. Jira
 * refresh can replace this source later without changing snapshot semantics.
 */
export function buildStoredSprintContext(db: Db, teamId: string, sprintId: string, selectedKeys: readonly string[] | null = null): StoredSprintContext {
  const sprint = db.prepare('SELECT id, name, start_date, end_date FROM sprint WHERE id = ? AND team_id = ?').get(sprintId, teamId) as any;
  if (!sprint) throw new Error(`Sprint ${sprintId} not found for team ${teamId}`);
  const keyClause = selectedKeys ? `AND w.key IN (${selectedKeys.map(() => '?').join(',')})` : '';
  const rows = db.prepare(`SELECT w.key, w.points, w.is_estimated, w.status, s.epic_key, w.assignee_id, m.name AS assignee_member_name FROM work_item w JOIN user_story s ON s.key = w.story_key JOIN epic e ON e.key = s.epic_key LEFT JOIN team_member m ON m.id = w.assignee_id WHERE e.team_id = ? ${keyClause} ORDER BY w.key`).all(teamId, ...(selectedKeys ?? [])) as any[];
  return { source: 'stored', freshness: 'fresh', truncated: false, errorMessage: null, sprint: { id: sprint.id, name: sprint.name, startDate: sprint.start_date, endDate: sprint.end_date }, items: rows.map((item) => ({ key: item.key, points: item.is_estimated === 0 ? null : item.points, status: item.status, epicKey: item.epic_key ?? null, assigneeMemberId: item.assignee_id ?? null, assigneeMemberName: item.assignee_member_name ?? null })) };
}

function configuredStoryPointsField(db: Db): string | null { const row = db.prepare("SELECT value FROM settings WHERE key = ? AND scope = 'global' AND scope_id = ''").get(SETTING_KEYS.JIRA_STORY_POINTS_FIELD) as { value?: string } | undefined; try { const value = row?.value ? JSON.parse(row.value) : null; return typeof value === 'string' && value.trim() ? value.trim() : null; } catch { return null; } }

/**
 * Fetches any stored sprint by ID through the same bounded, normalized Jira
 * pagination used by Standup. Stored facts remain a deterministic fallback.
 */
export async function refreshSprintContext(db: Db, client: JiraClient | undefined, input: { teamId: string; sprintId: string; selectedKeys?: readonly string[] | null; jiraBaseUrl?: string | null }): Promise<StoredSprintContext> {
  const fallback = buildStoredSprintContext(db, input.teamId, input.sprintId, input.selectedKeys ?? null);
  const progress = await refreshStandupSprintProgress(client, { sprintId: input.sprintId, sprintName: fallback.sprint.name, startDate: fallback.sprint.startDate, endDate: fallback.sprint.endDate, storyPointsField: configuredStoryPointsField(db), jiraBaseUrl: input.jiraBaseUrl ?? null });
  if (progress.freshness !== 'fresh') return { ...fallback, freshness: 'stale', errorMessage: progress.errorMessage };
  const local = new Map((db.prepare(`SELECT w.key, s.epic_key, w.assignee_id FROM work_item w JOIN user_story s ON s.key = w.story_key JOIN epic e ON e.key = s.epic_key WHERE e.team_id = ?`).all(input.teamId) as any[]).map((row) => [row.key, row]));
  const members = new Map((db.prepare('SELECT id, name, jira_account_id FROM team_member WHERE team_id = ?').all(input.teamId) as any[]).filter((row) => row.jira_account_id).map((row) => [row.jira_account_id, { id: row.id, name: row.name }]));
  const allowed = input.selectedKeys ? new Set(input.selectedKeys) : null;
  return { source: 'jira', freshness: 'fresh', truncated: progress.truncated, errorMessage: null, sprint: fallback.sprint, items: progress.items.filter((item) => !allowed || allowed.has(item.key)).map((item) => { const saved = local.get(item.key); const member = item.assigneeAccountId ? members.get(item.assigneeAccountId) : null; return { key: item.key, points: item.points, status: item.normalizedStatus, epicKey: saved?.epic_key ?? null, assigneeMemberId: member?.id ?? null, assigneeMemberName: member?.name ?? null }; }) };
}
