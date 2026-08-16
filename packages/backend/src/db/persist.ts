import type { DomainDataset, Setting } from '@ecp/shared';
import type { Db } from './database.js';
import { DELETE_ORDER } from './schema.js';

const bool = (v: boolean): number => (v ? 1 : 0);
/** Global settings use `null` scopeId in the domain but `''` in the DB PK. */
const scopeIdToDb = (scopeId: string | null): string => scopeId ?? '';
const scopeIdFromDb = (scopeId: string): string | null => (scopeId === '' ? null : scopeId);

/**
 * Replace the entire contents of the database with `dataset`, in a single
 * transaction. Existing rows are cleared first (child tables before parents) so
 * re-seeding is idempotent. Foreign keys are enforced, so a dataset with a
 * dangling reference will throw and roll back.
 */
export function writeDataset(db: Db, dataset: DomainDataset): void {
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
  const insertBandwidthCheckIn = db.prepare(
    `INSERT INTO bandwidth_check_in (member_id, check_in_date, feeling, note, created_at, updated_at)
     VALUES (@memberId, @date, @feeling, @note, @createdAt, @updatedAt)`,
  );
  const insertEpic = db.prepare(
    `INSERT INTO epic (key, title, team_id, active, source_status, status_category, archived_at, last_seen_at)
     VALUES (@key, @title, @teamId, @active, @sourceStatus, @statusCategory, @archivedAt, @lastSeenAt)`,
  );
  const insertPortfolioEpic = db.prepare(
    `INSERT INTO portfolio_epic (epic_key, scope_override, planning_kind, priority) VALUES (@epicKey, @scopeOverride, @planningKind, @priority)`,
  );
  const insertEpicSme = db.prepare(
    'INSERT INTO epic_sme (epic_key, member_id, rank) VALUES (@epicKey, @memberId, @rank)',
  );
  const insertMilestone = db.prepare(
    `INSERT INTO epic_milestone (id, epic_key, name, date, is_gating)
     VALUES (@id, @epicKey, @name, @date, @isGating)`,
  );
  const insertStory = db.prepare(
    `INSERT INTO user_story (key, epic_key, title, labels)
     VALUES (@key, @epicKey, @title, @labels)`,
  );
  const insertSprint = db.prepare(
    `INSERT INTO sprint (id, team_id, name, start_date, end_date)
     VALUES (@id, @teamId, @name, @startDate, @endDate)`,
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

  const run = db.transaction((data: DomainDataset) => {
    for (const table of DELETE_ORDER) db.prepare(`DELETE FROM ${table}`).run();

    for (const t of data.teams) {
      insertTeam.run({ ...t, workingDays: JSON.stringify(t.workingDays) });
    }
    for (const m of data.members) {
      insertMember.run({
        ...m,
        active: bool(m.active),
        jiraAccountId: m.jiraAccountId ?? null,
        avatarUrl: m.avatarUrl ?? null,
      });
    }
    for (const v of data.velocityOverrides) insertVelocity.run({ ...v, note: v.note ?? null });
    for (const p of data.pto) insertPto.run({ ...p, note: p.note ?? null });
    for (const o of data.oncall) insertOncall.run({ ...o, note: o.note ?? null });
    for (const checkIn of data.bandwidthCheckIns ?? []) {
      insertBandwidthCheckIn.run({ ...checkIn, note: checkIn.note ?? null });
    }
    for (const sp of data.sprints) insertSprint.run(sp);
    for (const e of data.epics) insertEpic.run({
      ...e, active: bool(e.active ?? true), sourceStatus: e.sourceStatus ?? null,
      statusCategory: e.statusCategory ?? null, archivedAt: e.archivedAt ?? null, lastSeenAt: e.lastSeenAt ?? null,
    });
    for (const p of data.portfolioEpics ?? []) insertPortfolioEpic.run({ ...p, planningKind: p.planningKind ?? 'timeline' });
    for (const sme of data.epicSmes ?? []) insertEpicSme.run(sme);
    for (const ms of data.milestones) insertMilestone.run({ ...ms, isGating: bool(ms.isGating) });
    for (const s of data.stories) insertStory.run({ ...s, labels: JSON.stringify(s.labels ?? []) });
    for (const w of data.workItems) {
      insertWorkItem.run({
        ...w,
        isEstimated: bool(w.isEstimated ?? true),
        jiraSprintAssigned:
          w.jiraSprintAssigned === undefined ? null : bool(w.jiraSprintAssigned),
        labels: JSON.stringify(w.labels ?? []),
      });
    }
    for (const d of data.dependencies) insertDependency.run(d);
    for (const p of data.placements) insertPlacement.run(p);
    for (const s of data.settings) {
      insertSetting.run({ ...s, scopeId: scopeIdToDb(s.scopeId) });
    }
  });

  run(dataset);
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
    bandwidthCheckIns: db
      .prepare('SELECT * FROM bandwidth_check_in ORDER BY check_in_date ASC, member_id ASC')
      .all()
      .map((r: any) => ({
        memberId: r.member_id,
        date: r.check_in_date,
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
