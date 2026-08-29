/**
 * Domain model — the app's single source of truth (project plan §4).
 *
 * Nothing in the engine or UI knows where this data came from; an
 * {@link Importer} (synthetic now, Jira later) is responsible for producing a
 * {@link DomainDataset} shaped exactly like these types.
 *
 * Conventions:
 * - All dates are ISO-8601 calendar strings, `YYYY-MM-DD` (no time / timezone).
 *   Capacity math operates on whole working days, so a date is the right grain.
 * - Weekdays use the JavaScript `Date.getUTCDay()` convention:
 *   0 = Sunday, 1 = Monday, ... 6 = Saturday.
 */

/** ISO-8601 calendar date, e.g. `"2026-07-11"`. */
export type IsoDate = string;

/** Weekday index, `0` = Sunday … `6` = Saturday (matches `Date.getUTCDay()`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ---------------------------------------------------------------------------
// Teams & cadence
// ---------------------------------------------------------------------------

/**
 * A team and its sprint cadence. Every cadence field is configurable so
 * different teams can run different rhythms.
 */
export interface Team {
  id: string;
  name: string;
  /** Sprint length in calendar days. Default 14 (two-week sprints). */
  sprintLengthDays: number;
  /** Weekday a sprint begins on. Default 2 (Tuesday). */
  sprintStartWeekday: Weekday;
  /**
   * A known real sprint-start date. All past/future sprint boundaries are
   * derived from this anchor plus {@link sprintLengthDays}.
   */
  sprintAnchorDate: IsoDate;
  /** Weekdays that count as working days. Default Mon–Fri (`[1,2,3,4,5]`). */
  workingDays: Weekday[];
}

/** A person on a team, with a baseline throughput. */
export interface TeamMember {
  id: string;
  teamId: string;
  name: string;
  /** Baseline velocity in story points per person per sprint. */
  baseVelocity: number;
  active: boolean;
  /**
   * The Jira `accountId` this member is linked to, or `null` for a purely local
   * member. The link is how a synced assignee maps back onto a person the user
   * set up by hand (name, velocity, PTO), so imports update the existing member
   * instead of creating a duplicate. Members imported straight from Jira carry
   * their own `accountId` here.
   */
  jiraAccountId?: string | null;
  /**
   * URL of the member's Jira avatar image, or `null` when unlinked / unknown.
   * The UI renders it in the avatar chip, falling back to initials-on-color.
   */
  avatarUrl?: string | null;
}

/** A person's self-reported workload signal for one local calendar day. */
export type BandwidthFeeling = 'red' | 'yellow' | 'green' | 'purple';

/** One mutable daily check-in per member. Missing is intentionally not Green. */
export interface BandwidthCheckIn {
  memberId: string;
  date: IsoDate;
  /** Present only when this value was captured as part of a standup session. */
  sessionId?: string | null;
  feeling: BandwidthFeeling;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The Standup session that owns all check-ins for a team calendar day. */
export interface BandwidthDayStandupSource {
  sessionId: string;
  status: StandupStatus;
}

/** Complete bandwidth state for one team calendar day. */
export interface BandwidthDay {
  teamId: string;
  date: IsoDate;
  checkIns: BandwidthCheckIn[];
  standup: BandwidthDayStandupSource | null;
}

/** Minimal, atomic edits to the manual check-ins for one team calendar day. */
export interface BandwidthDayPatch {
  upserts: Array<{
    memberId: string;
    feeling: BandwidthFeeling;
    note?: string | null;
  }>;
  deleteMemberIds: string[];
}

/**
 * A time-boxed adjustment to a member's velocity (ramping hire, reduced week).
 * Expressed as a multiplier against {@link TeamMember.baseVelocity}.
 */
export interface VelocityOverride {
  id: string;
  memberId: string;
  startDate: IsoDate;
  endDate: IsoDate;
  /** Multiplier applied to base velocity over the range (e.g. `0.5`). */
  multiplier: number;
  /** Optional free-text note explaining the override (e.g. "ramping hire"). */
  note?: string | null;
}

/** A member's paid-time-off range (inclusive). */
export interface Pto {
  id: string;
  memberId: string;
  startDate: IsoDate;
  endDate: IsoDate;
  /** Optional free-text note (e.g. "wedding", "parental leave"). */
  note?: string | null;
}

/**
 * A member's on-call range (inclusive). The productivity impact is not encoded
 * here — it is driven by the configurable `oncall_multiplier` setting so it can
 * be tuned globally / per team without editing data.
 */
export interface Oncall {
  id: string;
  memberId: string;
  startDate: IsoDate;
  endDate: IsoDate;
  /** Optional free-text note (e.g. "primary rotation"). */
  note?: string | null;
}

// ---------------------------------------------------------------------------
// Work hierarchy
// ---------------------------------------------------------------------------

export interface Epic {
  key: string;
  title: string;
  teamId: string;
  /** Whether this epic currently consumes the team's portfolio capacity. */
  active?: boolean;
  /** Jira display status and normalized status category, retained for orientation. */
  sourceStatus?: string | null;
  statusCategory?: string | null;
  archivedAt?: string | null;
  lastSeenAt?: string | null;
}

export type PortfolioScopeOverride = 'auto' | 'include' | 'exclude';
export type EpicPlanningKind = 'timeline' | 'ongoing';

/** Local portfolio intent; Jira never overwrites this row. */
export interface PortfolioEpic {
  epicKey: string;
  scopeOverride: PortfolioScopeOverride;
  planningKind: EpicPlanningKind;
  priority: number;
}

/**
 * A locally-owned estimate for the portion of an epic that Jira does not yet
 * represent as pointed remaining work.  Its review basis intentionally stores
 * only Jira keys and estimates, never ticket text or other Jira content.
 */
export interface EpicEstimate {
  epicKey: string;
  unrefinedPoints: number;
  reviewedFactBasis: Record<string, number | null>;
  reviewedAt: string;
  updatedAt: string;
}

/** Locally-authored expertise order for an epic. Rank zero is its owner. */
export interface EpicSme {
  epicKey: string;
  memberId: string;
  rank: number;
}

/** Return an epic's expertise list in its canonical (owner-first) order. */
export function epicSmes(dataset: Pick<DomainDataset, 'epicSmes'>, epicKey: string): EpicSme[] {
  return (dataset.epicSmes ?? [])
    .filter((entry) => entry.epicKey === epicKey)
    .slice()
    .sort((a, b) => a.rank - b.rank || a.memberId.localeCompare(b.memberId));
}

/** The owner is derived, never stored separately, from the first SME rank. */
export function epicOwnerId(dataset: Pick<DomainDataset, 'epicSmes'>, epicKey: string): string | null {
  return epicSmes(dataset, epicKey)[0]?.memberId ?? null;
}

/** Null deliberately represents a member starting from scratch on this epic. */
export function epicSmeRank(dataset: Pick<DomainDataset, 'epicSmes'>, epicKey: string, memberId: string): number | null {
  return epicSmes(dataset, epicKey).find((entry) => entry.memberId === memberId)?.rank ?? null;
}

/**
 * Resolve Jira-owned lifecycle facts and locally-owned portfolio intent in one
 * place. Missing intent rows deliberately retain the historic timeline/auto
 * behaviour, so fixtures and older databases need no eager backfill.
 */
export function effectivePortfolioEpic(dataset: Pick<DomainDataset, 'epics' | 'portfolioEpics'>, epicKey: string): {
  scopeOverride: PortfolioScopeOverride;
  planningKind: EpicPlanningKind;
  priority: number;
  tracked: boolean;
} {
  const intent = dataset.portfolioEpics?.find((entry) => entry.epicKey === epicKey);
  const scopeOverride = intent?.scopeOverride ?? 'auto';
  const planningKind = intent?.planningKind ?? 'timeline';
  const priority = intent?.priority ?? 0;
  const epic = dataset.epics.find((entry) => entry.key === epicKey);
  return { scopeOverride, planningKind, priority, tracked: Boolean(epic && epic.active !== false && scopeOverride !== 'exclude') };
}

/**
 * An epic "relevant day" — a date that matters for this epic (e.g. "First QA in
 * stage pass", "Launch"). Exactly one milestone per epic is flagged
 * {@link isGating}; that one drives the red/yellow/green verdict (project plan
 * §5).
 */
export interface EpicMilestone {
  id: string;
  epicKey: string;
  name: string;
  date: IsoDate;
  isGating: boolean;
}

/** Built-in, safe visual markers for portfolio-global important dates. */
export const IMPORTANT_DATE_ICON_KEYS = [
  'calendar', 'star', 'flag', 'rocket', 'megaphone', 'shield', 'users',
  'alert-triangle', 'bell', 'bookmark', 'briefcase', 'bug', 'cake', 'check-circle',
  'circle-dollar-sign', 'clock', 'cloud', 'code', 'database', 'file-text', 'gift', 'globe',
  'heart', 'key', 'lightbulb', 'link', 'lock', 'map-pin', 'package', 'plane', 'presentation',
  'target', 'trophy', 'wrench', 'zap',
] as const;
export type ImportantDateIconKey = typeof IMPORTANT_DATE_ICON_KEYS[number];

/** A locally-managed date that provides context for the entire portfolio. */
export interface GlobalImportantDate {
  id: string;
  name: string;
  date: IsoDate;
  iconKey: ImportantDateIconKey;
  /** Optional supporting context, kept as plain text. */
  notes?: string | null;
  /** Optional http(s) resource associated with this date. */
  linkUrl?: string | null;
}

/** The grouping layer between an epic and its work items. */
export interface UserStory {
  key: string;
  epicKey: string;
  title: string;
  /** Freeform labels/tags carried by the parent story. */
  labels?: string[];
}

/** Lifecycle status of a work item. */
export type WorkItemStatus = 'To Do' | 'In Progress' | 'In Review' | 'Done';

export const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = [
  'To Do',
  'In Progress',
  'In Review',
  'Done',
] as const;

/** A single unit of work with an estimate. */
export interface WorkItem {
  key: string;
  storyKey: string;
  title: string;
  /** Story-point estimate (zero is retained for backwards compatibility). */
  points: number;
  /** False when Jira supplied no estimate; distinguishes absent from a real zero. */
  isEstimated?: boolean;
  /**
   * Whether Jira assigned this item to a sprint when it was last imported.
   * Absent for locally-created and synthetic work, where Jira is not the
   * source of truth for sprint assignment.
   */
  jiraSprintAssigned?: boolean;
  status: WorkItemStatus;
  /** {@link TeamMember.id} of the assignee, or `null` if unassigned. */
  assigneeId: string | null;
  /**
   * Freeform labels/tags carried by the item. They drive the Gantt Planner's
   * horizontal lanes (a lane's total is the sum of points of items sharing a
   * label). Optional — an item may carry none. (Project plan §6a.)
   */
  labels?: string[];
}

/** A "blocked by" edge: {@link blockerItemKey} must finish before {@link blockedItemKey}. */
export interface Dependency {
  id: string;
  blockerItemKey: string;
  blockedItemKey: string;
}

// ---------------------------------------------------------------------------
// Sprints & planning (drive the Gantt Planner, project plan §6a)
// ---------------------------------------------------------------------------

/**
 * A sprint as a first-class, stored entity. Its `startDate`/`endDate` are
 * authoritative for the Gantt Planner's week columns (7-day slices from the
 * start). Jira sprints map onto this shape in Phase 7; on synthetic data the
 * importer derives them from the team's cadence.
 */
export interface Sprint {
  id: string;
  teamId: string;
  name: string;
  startDate: IsoDate;
  endDate: IsoDate;
}

/**
 * The human-authored output of the planning exercise: which week of which
 * sprint a work item is slotted into. `weekIndex` is 0-based within the sprint
 * ({@link Sprint} split into 7-day weeks). At most one placement per work item;
 * items with no placement live in the backlog "bag". Stored separately from
 * source (Jira) fields so it survives syncs.
 */
export interface PlannedPlacement {
  id: string;
  workItemKey: string;
  sprintId: string;
  weekIndex: number;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Scope a setting applies to. */
export type SettingScope = 'global' | 'team' | 'epic';

/**
 * Key/value settings entry. `value` is stored as JSON text so any shape is
 * representable; {@link scopeId} identifies the team/epic for scoped settings
 * and is `null` for global settings.
 */
export interface Setting {
  key: string;
  scope: SettingScope;
  scopeId: string | null;
  /** JSON-encoded value. */
  value: string;
}

// ---------------------------------------------------------------------------
// Standup sessions (kept outside DomainDataset; loaded through focused APIs)
// ---------------------------------------------------------------------------

export type StandupStatus = 'active' | 'post_standup' | 'completed';
export type StandupParticipantDisposition = 'pending' | 'completed' | 'skipped';

export interface StandupSession {
  id: string;
  teamId: string;
  date: IsoDate;
  sprintId: string | null;
  sprintName: string | null;
  status: StandupStatus;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  revision: number;
}

export interface StandupParticipant {
  sessionId: string;
  memberId: string;
  memberName: string;
  position: number;
  disposition: StandupParticipantDisposition;
  resolvedAt: string | null;
}

export interface StandupNote {
  id: string;
  sessionId: string;
  body: string;
  allTeam: boolean;
  memberIds: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
  state: StandupNoteState;
  completedAt: string | null;
  deferredAt: string | null;
  sourceNoteId: string | null;
  sourceSessionDate: IsoDate | null;
  /** Participant who was active when this note was originally created. */
  contextMemberId: string | null;
  /** Snapshot name for the participant context, retained across renames/deactivation. */
  contextMemberName: string | null;
  mentions: StandupNoteMention[];
}
export type StandupNoteState = 'open' | 'completed' | 'deferred';
export type StandupNoteMention = { kind: 'member'; id: string; label: string } | { kind: 'group'; id: string; label: string };

export interface StandupTicket {
  key: string;
  /** Direct Jira issue URL when this standup is connected to Jira. */
  url: string | null;
  summary: string;
  status: string;
  /** Jira's durable status identity; absent in historical ticket snapshots. */
  statusId?: string | null;
  statusCategory: string;
  assigneeAccountId: string | null;
  assigneeName: string | null;
  parentKey: string | null;
  parentSummary: string | null;
}

export interface StandupMemberTicketContext {
  memberId: string;
  capturedAt: string;
  source: 'jira' | 'snapshot';
  freshness: 'fresh' | 'stale' | 'unavailable';
  tickets: StandupTicket[];
  errorMessage: string | null;
  truncated: boolean;
}

/** Jira lifecycle buckets used by the sprint opener's point calculation. */
export type SprintProgressStatus = WorkItemStatus;
export interface StandupSprintProgressItem {
  key: string;
  summary: string;
  issueType: string;
  status: string;
  normalizedStatus: SprintProgressStatus;
  points: number | null;
  /** Stable Jira identity used for roster attribution; display names are not keys. */
  assigneeAccountId: string | null;
  assigneeName: string | null;
  url: string | null;
}

/** Current-sprint recognized output for one active engineer. */
export interface EngineerSprintOutput {
  memberId: string;
  baseVelocity: number;
  adjustedCapacity: number | null;
  donePoints: number;
  inReviewPoints: number;
  inProgressPoints: number;
  toDoPoints: number;
  unestimatedDoneOrReviewItems: number;
  matchedSprintItems: number;
  availability: { ptoWorkingDays: number; oncallWorkingDays: number; velocityOverrideWorkingDays: number };
  jiraLinked: boolean;
}

/** Read-only, live Jira aggregation used by Team's Sprint output view. */
export interface TeamSprintOutput {
  teamId: string;
  /** Configured Jira board URL; the UI adds an engineer's stable account ID. */
  jiraBoardUrl: string | null;
  sprint: { id: string; name: string; startDate: IsoDate | null; endDate: IsoDate | null; dateSource: 'jira' | 'stored' | 'unavailable' } | null;
  capturedAt: string;
  freshness: 'fresh' | 'unavailable';
  truncated: boolean;
  errorMessage: string | null;
  engineers: EngineerSprintOutput[];
  unattributed: { itemCount: number; estimatedDoneOrReviewPoints: number; unestimatedDoneOrReviewItems: number };
}
/** Complete, session-scoped Jira sprint snapshot. Aggregates are derived in the UI. */
export interface StandupSprintProgressContext {
  sprintId: string;
  sprintName: string;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  capturedAt: string;
  source: 'jira' | 'snapshot';
  freshness: 'fresh' | 'stale' | 'unavailable';
  items: StandupSprintProgressItem[];
  errorMessage: string | null;
  truncated: boolean;
}

/** A current Jira request shown during the editable post-standup stage. */
export interface IntakeRequest {
  key: string;
  url: string | null;
  summary: string;
  status: string;
  statusCategory: string;
  assigneeAccountId: string | null;
  assigneeName: string | null;
  updatedAt: string | null;
  awarenessLogged: boolean;
}

export interface StandupIntakeContext {
  capturedAt: string;
  source: 'jira' | 'snapshot';
  freshness: 'fresh' | 'stale' | 'unavailable';
  requests: IntakeRequest[];
  errorMessage: string | null;
}

export type IntakeAwarenessConfidence = 'high' | 'medium' | 'low';
export interface IntakeAwarenessRecord {
  id: string;
  jiraKey: string;
  standupSessionId: string;
  awareDate: IsoDate;
  dateConfidence: IntakeAwarenessConfidence;
  notes: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

/**
 * A complete, self-consistent snapshot of the domain, as produced by an
 * {@link Importer} and persisted to SQLite. Referential integrity is the
 * importer's responsibility (every foreign key resolves within the dataset).
 */
export interface DomainDataset {
  teams: Team[];
  members: TeamMember[];
  /** Local, human-authored history; never sourced from Jira. */
  bandwidthCheckIns?: BandwidthCheckIn[];
  velocityOverrides: VelocityOverride[];
  pto: Pto[];
  oncall: Oncall[];
  epics: Epic[];
  portfolioEpics?: PortfolioEpic[];
  /** Optional while older fixtures and database snapshots are migrated. */
  epicEstimates?: EpicEstimate[];
  /** Optional for backwards-compatible fixture and JSON imports. */
  epicSmes?: EpicSme[];
  milestones: EpicMilestone[];
  /** Optional while older fixtures and database snapshots are migrated. */
  importantDates?: GlobalImportantDate[];
  stories: UserStory[];
  workItems: WorkItem[];
  dependencies: Dependency[];
  /** Stored sprints, driving the Gantt Planner's sprint selector (§6a). */
  sprints: Sprint[];
  /** Human-authored week placements for the Gantt Planner (§6a). */
  placements: PlannedPlacement[];
  settings: Setting[];
}
