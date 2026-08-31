import type { DomainDataset, EngineerSprintOutput, Setting, TeamSprintOutput } from '@ecp/shared';
import { ENGINE_DEFAULTS, SETTING_KEYS, enumerateWorkingDays } from '@ecp/shared';
import { buildCapacityContext, sprintCapacity, type SprintWindow } from '@ecp/engine';
import type { JiraClient } from './client.js';
import { refreshStandupSprintProgress } from './standup-context.js';

const iso = (value: string | undefined): string | null => value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
const setting = (settings: Setting[], key: string): string | null => {
  const row = settings.find((item) => item.scope === 'global' && item.key === key);
  try { const value = row ? JSON.parse(row.value) : null; return typeof value === 'string' && value.trim() ? value : null; } catch { return null; }
};
const numberSetting = (settings: Setting[], key: string, fallback: number): number => {
  const row = settings.find((item) => item.scope === 'global' && item.key === key);
  try { const value = row ? JSON.parse(row.value) : null; return typeof value === 'number' && Number.isFinite(value) ? value : fallback; } catch { return fallback; }
};

function base(teamId: string, data: DomainDataset): TeamSprintOutput {
  return { teamId, jiraBoardUrl: null, sprint: null, capturedAt: new Date().toISOString(), freshness: 'unavailable', truncated: false, errorMessage: null, engineers: [], unattributed: { itemCount: 0, estimatedDoneOrReviewPoints: 0, unestimatedDoneOrReviewItems: 0 } };
}

function availability(memberId: string, sprint: SprintWindow, data: DomainDataset) {
  const overlaps = <T extends { memberId: string; startDate: string; endDate: string }>(items: T[]) => new Set(sprint.workingDays.filter((date) => items.some((item) => item.memberId === memberId && item.startDate <= date && item.endDate >= date))).size;
  return { ptoWorkingDays: overlaps(data.pto), oncallWorkingDays: overlaps(data.oncall), velocityOverrideWorkingDays: overlaps(data.velocityOverrides) };
}

export async function getTeamSprintOutput(client: JiraClient | undefined, data: DomainDataset, teamId: string, jiraBaseUrl?: string | null): Promise<TeamSprintOutput> {
  const result = base(teamId, data);
  const team = data.teams.find((item) => item.id === teamId);
  if (!team) throw Object.assign(new Error('Team not found.'), { statusCode: 404 });
  const members = data.members.filter((member) => member.teamId === teamId && member.active).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const withCapacities = (sprint: SprintWindow | null): EngineerSprintOutput[] => members.map((member) => {
    const context = sprint ? buildCapacityContext({ members: [member], pto: data.pto.filter((item) => item.memberId === member.id), oncall: data.oncall.filter((item) => item.memberId === member.id), velocityOverrides: data.velocityOverrides.filter((item) => item.memberId === member.id), oncallMultiplier: numberSetting(data.settings, SETTING_KEYS.ONCALL_MULTIPLIER, ENGINE_DEFAULTS.ONCALL_MULTIPLIER) }) : null;
    return { memberId: member.id, baseVelocity: member.baseVelocity, adjustedCapacity: sprint && context ? sprintCapacity(sprint, context) : null, donePoints: 0, inReviewPoints: 0, inProgressPoints: 0, toDoPoints: 0, unestimatedDoneOrReviewItems: 0, matchedSprintItems: 0, availability: sprint ? availability(member.id, sprint, data) : { ptoWorkingDays: 0, oncallWorkingDays: 0, velocityOverrideWorkingDays: 0 }, jiraLinked: Boolean(member.jiraAccountId) };
  });
  if (!client) { result.engineers = withCapacities(null); result.errorMessage = 'Jira is unavailable.'; return result; }
  const project = setting(data.settings, SETTING_KEYS.JIRA_PROJECT_KEY);
  const pointsField = setting(data.settings, SETTING_KEYS.JIRA_STORY_POINTS_FIELD);
  if (!project || !pointsField) { result.engineers = withCapacities(null); result.errorMessage = !project ? 'Select a Jira board first.' : 'Story-points mapping is unavailable.'; return result; }
  try {
    const configured = setting(data.settings, SETTING_KEYS.JIRA_BOARD_ID);
    const boardId = configured && /^\d+$/.test(configured) ? Number(configured) : (await client.listBoards(project))[0]?.id;
    if (boardId == null) { result.engineers = withCapacities(null); result.errorMessage = 'No Agile board is configured for this project.'; return result; }
    result.jiraBoardUrl = jiraBaseUrl ? `${jiraBaseUrl.replace(/\/+$/, '')}/jira/software/c/projects/${encodeURIComponent(project)}/boards/${boardId}` : null;
    const active = (await client.listSprints(boardId)).find((sprint) => sprint.state === 'active');
    if (!active) { result.engineers = withCapacities(null); result.errorMessage = 'This board has no active sprint.'; return result; }
    let startDate = iso(active.startDate); let endDate = iso(active.endDate); let dateSource: 'jira' | 'stored' | 'unavailable' = startDate && endDate ? 'jira' : 'unavailable';
    if (!startDate || !endDate) { const stored = data.sprints.find((sprint) => sprint.teamId === teamId && sprint.id === String(active.id)); if (stored) { startDate = stored.startDate; endDate = stored.endDate; dateSource = 'stored'; } }
    result.sprint = { id: String(active.id), name: active.name, startDate, endDate, dateSource };
    const window = startDate && endDate ? { index: 0, start: startDate, end: endDate, workingDays: enumerateWorkingDays(startDate, endDate, team.workingDays) } : null;
    result.engineers = withCapacities(window);
    const context = await refreshStandupSprintProgress(client, { sprintId: String(active.id), sprintName: active.name, startDate, endDate, storyPointsField: pointsField, jiraBaseUrl: jiraBaseUrl ?? null });
    result.capturedAt = context.capturedAt; result.truncated = context.truncated;
    if (context.freshness === 'unavailable') { result.errorMessage = context.errorMessage; return result; }
    result.freshness = 'fresh';
    const byAccount = new Map(members.filter((member) => member.jiraAccountId).map((member) => [member.jiraAccountId!, result.engineers.find((output) => output.memberId === member.id)!]));
    for (const item of context.items) {
      const recognized = item.normalizedStatus === 'Done' || item.normalizedStatus === 'In Review';
      const output = item.assigneeAccountId ? byAccount.get(item.assigneeAccountId) : undefined;
      if (!output) { if (recognized) { result.unattributed.itemCount += 1; if (item.points === null) result.unattributed.unestimatedDoneOrReviewItems += 1; else result.unattributed.estimatedDoneOrReviewPoints += item.points; } continue; }
      output.matchedSprintItems += 1;
      if (item.points === null) { if (recognized) output.unestimatedDoneOrReviewItems += 1; continue; }
      if (item.normalizedStatus === 'Done') output.donePoints += item.points;
      else if (item.normalizedStatus === 'In Review') output.inReviewPoints += item.points;
      else if (item.normalizedStatus === 'In Progress') output.inProgressPoints += item.points;
      else output.toDoPoints += item.points;
    }
    return result;
  } catch { result.engineers = withCapacities(null); result.errorMessage = 'Unable to refresh Jira sprint output.'; return result; }
}
