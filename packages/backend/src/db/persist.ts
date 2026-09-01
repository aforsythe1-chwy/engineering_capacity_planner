import type { DomainDataset, Setting } from '@ecp/shared';
import type { Db } from './database.js';
import { DELETE_ORDER } from './schema.js';

const bool = (v: boolean): number => (v ? 1 : 0);
/** Global settings use `null` scopeId in the domain but `''` in the DB PK. */
const scopeIdToDb = (scopeId: string | null): string => scopeId ?? '';
const scopeIdFromDb = (scopeId: string): string | null => (scopeId === '' ? null : scopeId);

function assertUniqueValues(values: string[], label: string): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  if (duplicates.size > 0) {
    throw new Error(`Duplicate ${label} in dataset: ${[...duplicates].sort().join(', ')}`);
  }
}

function assertUniqueDatasetKeys(dataset: DomainDataset): void {
  assertUniqueValues(dataset.stories.map((story) => story.key), 'story keys');
  assertUniqueValues(dataset.workItems.map((item) => item.key), 'work item keys');
}

/**
 * Replace the entire contents of the database with `dataset`, in a single
 * transaction. Existing rows are cleared first (child tables before parents) so
 * re-seeding is idempotent. Foreign keys are enforced, so a dataset with a
 * dangling reference will throw and roll back.
 */
/**
 * Replace dataset-owned rows without creating a transaction.  Sync uses this
 * inside its own transaction so facts, freshness, and history succeed/fail as
 * one unit; normal seed/import callers should use {@link writeDataset}.
 */
export function replaceDatasetRows(db: Db, dataset: DomainDataset): void {
  assertUniqueDatasetKeys(dataset);

  // Dataset replacement temporarily removes teams and members that durable
  // standup history references. Defer FK checks until the surrounding
  // transaction commits, after those same parent rows have been restored.
  // SQLite still rejects the commit if the replacement leaves a true dangling
  // reference, and automatically resets this pragma after commit or rollback.
  db.pragma('defer_foreign_keys = ON');

  const insertTeam = db.prepare(
    `INSERT INTO team (id, name, sprint_length_days, sprint_start_weekday, sprint_anchor_date, working_days)
     VALUES (@id, @name, @sprintLengthDays, @sprintStartWeekday, @sprintAnchorDate, @workingDays)`,
  );
  const insertMember = db.prepare(
    `INSERT INTO team_member (id, team_id, name, base_velocity, active, jira_account_id, avatar_url)
     VALUES (@id, @teamId, @name, @baseVelocity, @active, @jiraAccountId, @avatarUrl)`,
  );
  const insertVelocity = db.prepare(
    `INSERT INTO velocity_override (id, member_id, start_date, end_date, multiplier, note)
     VALUES (@id, @memberId, @startDate, @endDate, @multiplier, @note)`,
  );
  const insertPto = db.prepare(
    `INSERT INTO pto (id, member_id, start_date, end_date, note)
     VALUES (@id, @memberId, @startDate, @endDate, @note)`,
  );
  const insertOncall = db.prepare(
    `INSERT INTO oncall (id, member_id, start_date, end_date, note)
     VALUES (@id, @memberId, @startDate, @endDate, @note)`,
  );
  const insertHoliday = db.prepare(
    'INSERT INTO team_holiday (id, team_id, date, name) VALUES (@id, @teamId, @date, @name)',
  );
  const insertBandwidthCheckIn = db.prepare(
    `INSERT INTO bandwidth_check_in (member_id, check_in_date, session_id, feeling, note, created_at, updated_at)
     VALUES (@memberId, @date, @sessionId, @feeling, @note, @createdAt, @updatedAt)`,
  );
  const insertEpic = db.prepare(
    `INSERT INTO epic (key, title, team_id, active, source_status, status_category, archived_at, last_seen_at)
     VALUES (@key, @title, @teamId, @active, @sourceStatus, @statusCategory, @archivedAt, @lastSeenAt)`,
  );
  const insertPortfolioEpic = db.prepare(
    `INSERT INTO portfolio_epic (epic_key, scope_override, planning_kind, priority) VALUES (@epicKey, @scopeOverride, @planningKind, @priority)`,
  );
  const insertEpicEstimate = db.prepare(
    `INSERT INTO epic_estimate (epic_key, unrefined_points, reviewed_fact_basis_json, reviewed_at, updated_at)
     VALUES (@epicKey, @unrefinedPoints, @reviewedFactBasisJson, @reviewedAt, @updatedAt)`,
  );
  const insertEpicSme = db.prepare(
    'INSERT INTO epic_sme (epic_key, member_id, rank) VALUES (@epicKey, @memberId, @rank)',
  );
  const insertMilestone = db.prepare(
    `INSERT INTO epic_milestone (id, epic_key, name, date, is_gating)
     VALUES (@id, @epicKey, @name, @date, @isGating)`,
  );
  const insertImportantDate = db.prepare(
    `INSERT INTO global_important_date (id, name, date, icon_key, notes, link_url)
     VALUES (@id, @name, @date, @iconKey, @notes, @linkUrl)`,
  );
  const insertStory = db.prepare(
    `INSERT INTO user_story (key, epic_key, title, labels)
     VALUES (@key, @epicKey, @title, @labels)`,
  );
  const insertSprint = db.prepare(
    `INSERT INTO sprint (id, team_id, name, start_date, end_date, state, goal, origin_board_id)
     VALUES (@id, @teamId, @name, @startDate, @endDate, @state, @goal, @originBoardId)`,
  );
  const insertWorkItem = db.prepare(
    `INSERT INTO work_item (key, story_key, title, points, is_estimated, jira_sprint_assigned, status, assignee_id, labels)
     VALUES (@key, @storyKey, @title, @points, @isEstimated, @jiraSprintAssigned, @status, @assigneeId, @labels)`,
  );
  const insertDependency = db.prepare(
    `INSERT INTO dependency (id, blocker_item_key, blocked_item_key)
     VALUES (@id, @blockerItemKey, @blockedItemKey)`,
  );
  const insertPlacement = db.prepare(
    `INSERT INTO planned_placement (id, work_item_key, sprint_id, week_index)
     VALUES (@id, @workItemKey, @sprintId, @weekIndex)`,
  );
  const insertSetting = db.prepare(
    `INSERT INTO settings (key, scope, scope_id, value)
     VALUES (@key, @scope, @scopeId, @value)`,
  );

  for (const table of DELETE_ORDER) db.prepare(`DELETE FROM ${table}`).run();

    for (const t of dataset.teams) {
      insertTeam.run({ ...t, workingDays: JSON.stringify(t.workingDays) });
    }
    for (const m of dataset.members) {
      insertMember.run({
        ...m,
        active: bool(m.active),
        jiraAccountId: m.jiraAccountId ?? null,
        avatarUrl: m.avatarUrl ?? null,
      });
    }
    for (const v of dataset.velocityOverrides) insertVelocity.run({ ...v, note: v.note ?? null });
    for (const p of dataset.pto) insertPto.run({ ...p, note: p.note ?? null });
    for (const o of dataset.oncall) insertOncall.run({ ...o, note: o.note ?? null });
    for (const holiday of dataset.holidays ?? []) insertHoliday.run(holiday);
    for (const checkIn of dataset.bandwidthCheckIns ?? []) {
      insertBandwidthCheckIn.run({ ...checkIn, sessionId: checkIn.sessionId ?? null, note: checkIn.note ?? null });
    }
    for (const sp of dataset.sprints) insertSprint.run({ ...sp, state: sp.state ?? null, goal: sp.goal ?? null, originBoardId: sp.originBoardId ?? null });
    for (const e of dataset.epics) insertEpic.run({
      ...e, active: bool(e.active ?? true), sourceStatus: e.sourceStatus ?? null,
      statusCategory: e.statusCategory ?? null, archivedAt: e.archivedAt ?? null, lastSeenAt: e.lastSeenAt ?? null,
    });
    for (const p of dataset.portfolioEpics ?? []) insertPortfolioEpic.run({ ...p, planningKind: p.planningKind ?? 'timeline' });
    for (const estimate of dataset.epicEstimates ?? []) {
      insertEpicEstimate.run({ ...estimate, reviewedFactBasisJson: JSON.stringify(sortBasis(estimate.reviewedFactBasis)) });
    }
    for (const sme of dataset.epicSmes ?? []) insertEpicSme.run(sme);
    for (const ms of dataset.milestones) insertMilestone.run({ ...ms, isGating: bool(ms.isGating) });
    for (const date of dataset.importantDates ?? []) insertImportantDate.run({ ...date, notes: date.notes ?? null, linkUrl: date.linkUrl ?? null });
    for (const s of dataset.stories) insertStory.run({ ...s, labels: JSON.stringify(s.labels ?? []) });
    for (const w of dataset.workItems) {
      insertWorkItem.run({
        ...w,
        isEstimated: bool(w.isEstimated ?? true),
        jiraSprintAssigned:
          w.jiraSprintAssigned === undefined ? null : bool(w.jiraSprintAssigned),
        labels: JSON.stringify(w.labels ?? []),
      });
    }
    for (const d of dataset.dependencies) insertDependency.run(d);
    for (const p of dataset.placements) insertPlacement.run(p);
    for (const s of dataset.settings) {
      insertSetting.run({ ...s, scopeId: scopeIdToDb(s.scopeId) });
    }
}

export function writeDataset(db: Db, dataset: DomainDataset): void {
  db.transaction((data: DomainDataset) => replaceDatasetRows(db, data))(dataset);
}

function sortBasis(basis: Record<string, number | null>): Record<string, number | null> {
  return Object.fromEntries(Object.entries(basis).sort(([a], [b]) => a.localeCompare(b)));
}

function parseEstimateBasis(raw: unknown): Record<string, number | null> {
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) =>
      value === null || (typeof value === 'number' && Number.isFinite(value)) ? [[key, value]] : [],
    ));
  } catch {
    return {};
  }
}

/** Read the full dataset back out of the database (used for verification). */
export function readDataset(db: Db): DomainDataset {
  return {
    teams: db
      .prepare('SELECT * FROM team')
      .all()
      .map((r: any) => ({
        id: r.id,
        name: r.name,
        sprintLengthDays: r.sprint_length_days,
        sprintStartWeekday: r.sprint_start_weekday,
        sprintAnchorDate: r.sprint_anchor_date,
        workingDays: JSON.parse(r.working_days),
      })),
    members: db
      .prepare('SELECT * FROM team_member')
      .all()
      .map((r: any) => ({
        id: r.id,
        teamId: r.team_id,
        name: r.name,
        baseVelocity: r.base_velocity,
        active: r.active === 1,
        jiraAccountId: r.jira_account_id ?? null,
        avatarUrl: r.avatar_url ?? null,
      })),
    velocityOverrides: db
      .prepare('SELECT * FROM velocity_override')
      .all()
      .map((r: any) => ({
        id: r.id,
        memberId: r.member_id,
        startDate: r.start_date,
        endDate: r.end_date,
        multiplier: r.multiplier,
        note: r.note ?? null,
      })),
    pto: db
      .prepare('SELECT * FROM pto')
      .all()
      .map((r: any) => ({
        id: r.id,
        memberId: r.member_id,
        startDate: r.start_date,
        endDate: r.end_date,
        note: r.note ?? null,
      })),
    oncall: db
      .prepare('SELECT * FROM oncall')
      .all()
      .map((r: any) => ({
        id: r.id,
        memberId: r.member_id,
        startDate: r.start_date,
        endDate: r.end_date,
        note: r.note ?? null,
      })),
    holidays: db.prepare('SELECT * FROM team_holiday ORDER BY team_id, date, name COLLATE NOCASE, id').all().map((r: any) => ({ id: r.id, teamId: r.team_id, date: r.date, name: r.name })),
    bandwidthCheckIns: db
      .prepare('SELECT * FROM bandwidth_check_in ORDER BY check_in_date ASC, member_id ASC')
      .all()
      .map((r: any) => ({
        memberId: r.member_id,
        date: r.check_in_date,
        sessionId: r.session_id ?? null,
        feeling: r.feeling,
        note: r.note ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    epics: db
      .prepare('SELECT * FROM epic')
      .all()
      .map((r: any) => ({ key: r.key, title: r.title, teamId: r.team_id,
        ...(r.active === 1 ? {} : { active: false }),
        ...(r.source_status == null ? {} : { sourceStatus: r.source_status }),
        ...(r.status_category == null ? {} : { statusCategory: r.status_category }),
        ...(r.archived_at == null ? {} : { archivedAt: r.archived_at }),
        ...(r.last_seen_at == null ? {} : { lastSeenAt: r.last_seen_at }), })),
    portfolioEpics: db.prepare('SELECT * FROM portfolio_epic').all().map((r: any) => ({
      epicKey: r.epic_key, scopeOverride: r.scope_override, planningKind: r.planning_kind ?? 'timeline', priority: r.priority,
    })),
    epicEstimates: db.prepare('SELECT * FROM epic_estimate ORDER BY epic_key ASC').all().map((r: any) => ({
      epicKey: r.epic_key,
      unrefinedPoints: r.unrefined_points,
      reviewedFactBasis: parseEstimateBasis(r.reviewed_fact_basis_json),
      reviewedAt: r.reviewed_at,
      updatedAt: r.updated_at,
    })),
    epicSmes: db.prepare('SELECT * FROM epic_sme ORDER BY epic_key ASC, rank ASC').all().map((r: any) => ({
      epicKey: r.epic_key, memberId: r.member_id, rank: r.rank,
    })),
    milestones: db
      .prepare('SELECT * FROM epic_milestone')
      .all()
      .map((r: any) => ({
        id: r.id,
        epicKey: r.epic_key,
        name: r.name,
        date: r.date,
        isGating: r.is_gating === 1,
      })),
    importantDates: db.prepare('SELECT * FROM global_important_date ORDER BY date ASC, name COLLATE NOCASE ASC, id ASC').all().map((r: any) => ({
      id: r.id, name: r.name, date: r.date, iconKey: r.icon_key, notes: r.notes ?? null, linkUrl: r.link_url ?? null,
    })),
    stories: db
      .prepare('SELECT * FROM user_story')
      .all()
      .map((r: any) => ({
        key: r.key,
        epicKey: r.epic_key,
        title: r.title,
        labels: r.labels ? JSON.parse(r.labels) : [],
      })),
    workItems: db
      .prepare('SELECT * FROM work_item')
      .all()
      .map((r: any) => ({
        key: r.key,
        storyKey: r.story_key,
        title: r.title,
        points: r.points,
        ...(r.is_estimated === 0 ? { isEstimated: false } : {}),
        ...(r.jira_sprint_assigned === null || r.jira_sprint_assigned === undefined
          ? {}
          : { jiraSprintAssigned: r.jira_sprint_assigned === 1 }),
        status: r.status,
        assigneeId: r.assignee_id,
        labels: r.labels ? JSON.parse(r.labels) : [],
      })),
    dependencies: db
      .prepare('SELECT * FROM dependency')
      .all()
      .map((r: any) => ({
        id: r.id,
        blockerItemKey: r.blocker_item_key,
        blockedItemKey: r.blocked_item_key,
      })),
    sprints: db
      .prepare('SELECT * FROM sprint')
      .all()
      .map((r: any) => ({
        id: r.id,
        teamId: r.team_id,
        name: r.name,
        startDate: r.start_date,
        endDate: r.end_date,
        ...(r.state == null ? {} : { state: r.state }),
        ...(r.goal == null ? {} : { goal: r.goal }),
        ...(r.origin_board_id == null ? {} : { originBoardId: r.origin_board_id }),
      })),
    placements: db
      .prepare('SELECT * FROM planned_placement')
      .all()
      .map((r: any) => ({
        id: r.id,
        workItemKey: r.work_item_key,
        sprintId: r.sprint_id,
        weekIndex: r.week_index,
      })),
    settings: db
      .prepare('SELECT * FROM settings')
      .all()
      .map(
        (r: any): Setting => ({
          key: r.key,
          scope: r.scope,
          scopeId: scopeIdFromDb(r.scope_id),
          value: r.value,
        }),
      ),
  };
}
