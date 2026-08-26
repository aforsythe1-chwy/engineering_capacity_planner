import type {
  EpicSme,
  EpicEstimate,
  EpicMilestone,
  GlobalImportantDate,
  BandwidthCheckIn,
  BandwidthDay,
  BandwidthDayPatch,
  StandupNote,
  StandupParticipant,
  StandupMemberTicketContext,
  StandupSprintProgressContext,
  StandupIntakeContext,
  IntakeAwarenessRecord,
  IntakeAwarenessConfidence,
  StandupSession,
  Oncall,
  PlannedPlacement,
  Pto,
  SyncChange,
  SyncLogEntry,
  Team,
  TeamMember,
  VelocityOverride,
  StandupNoteMention,
  StandupAudioTrackSummary,
  TeamStandupAudioSettings,
} from '@ecp/shared';

export interface StandupAggregate { session: StandupSession; participants: StandupParticipant[]; notes: StandupNote[]; checkIns: BandwidthCheckIn[]; }
export const listStandups = (teamId: string): Promise<{ sessions: StandupSession[] }> => request('GET', `/api/standups${qs({ teamId })}`);
export const getStandup = (sessionId: string): Promise<StandupAggregate> => request('GET', `/api/standups/${encodeURIComponent(sessionId)}`);
export const startStandup = (teamId: string, date: string): Promise<StandupAggregate> => request('POST', '/api/standups/start', { teamId, date });
export const resolveStandupParticipant = (sessionId: string, memberId: string, disposition: 'completed' | 'skipped', expectedRevision: number): Promise<StandupAggregate> => request('PUT', `/api/standups/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(memberId)}`, { disposition, expectedRevision });
export const finishStandup = (sessionId: string, expectedRevision: number): Promise<StandupAggregate> => request('POST', `/api/standups/${encodeURIComponent(sessionId)}/finish`, { expectedRevision });
export const deleteStandup = (sessionId: string): Promise<void> => request('DELETE', `/api/standups/${encodeURIComponent(sessionId)}`);
export const upsertStandupCheckIn = (sessionId: string, memberId: string, input: { feeling: BandwidthCheckIn['feeling']; note?: string | null }): Promise<BandwidthCheckIn> => request('PUT', `/api/standups/${encodeURIComponent(sessionId)}/check-ins/${encodeURIComponent(memberId)}`, input);
export const deleteStandupCheckIn = (sessionId: string, memberId: string): Promise<void> => request('DELETE', `/api/standups/${encodeURIComponent(sessionId)}/check-ins/${encodeURIComponent(memberId)}`);
export type StandupNoteAudience = { allTeam: true } | { allTeam: false; mentions: Array<Pick<StandupNoteMention, 'kind' | 'id'>> };
export const createStandupNote = (sessionId: string, body: string, audience: StandupNoteAudience, expectedRevision: number): Promise<StandupAggregate> => request('POST', `/api/standups/${encodeURIComponent(sessionId)}/notes`, { body, audience, expectedRevision });
export const updateStandupNote = (sessionId: string, noteId: string, body: string, audience: StandupNoteAudience, expectedRevision: number): Promise<StandupAggregate> => request('PUT', `/api/standups/${encodeURIComponent(sessionId)}/notes/${encodeURIComponent(noteId)}`, { body, audience, expectedRevision });
export const deleteStandupNote = (sessionId: string, noteId: string, expectedRevision: number): Promise<StandupAggregate> => request('DELETE', `/api/standups/${encodeURIComponent(sessionId)}/notes/${encodeURIComponent(noteId)}`, { expectedRevision });
export const setStandupNoteState = (sessionId: string, noteId: string, state: 'open' | 'completed' | 'deferred', expectedRevision: number): Promise<StandupAggregate> => request('PATCH', `/api/standups/${encodeURIComponent(sessionId)}/notes/${encodeURIComponent(noteId)}/state`, { state, expectedRevision });
export const reorderStandupNotes = (sessionId: string, noteIds: string[], expectedRevision: number): Promise<StandupAggregate> => request('PUT', `/api/standups/${encodeURIComponent(sessionId)}/notes/order`, { noteIds, expectedRevision });
export const getStandupMemberTickets = (sessionId: string, memberId: string): Promise<StandupMemberTicketContext | null> => request('GET', `/api/standups/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(memberId)}/tickets`);
export const refreshStandupMemberTickets = (sessionId: string, memberId: string): Promise<StandupMemberTicketContext> => request('POST', `/api/standups/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(memberId)}/tickets/refresh`);
export const getStandupSprintProgress = (sessionId: string): Promise<StandupSprintProgressContext | null> => request('GET', `/api/standups/${encodeURIComponent(sessionId)}/sprint-progress`);
export const refreshStandupSprintProgress = (sessionId: string): Promise<StandupSprintProgressContext> => request('POST', `/api/standups/${encodeURIComponent(sessionId)}/sprint-progress/refresh`);
export const getStandupIntakeRequests = (sessionId: string): Promise<StandupIntakeContext | null> => request('GET', `/api/standups/${encodeURIComponent(sessionId)}/intake-requests`);
export const refreshStandupIntakeRequests = (sessionId: string): Promise<StandupIntakeContext> => request('POST', `/api/standups/${encodeURIComponent(sessionId)}/intake-requests/refresh`);
export const createIntakeAwareness = (sessionId: string, jiraKey: string, input: { awareDate: string; dateConfidence: IntakeAwarenessConfidence; notes?: string }): Promise<IntakeAwarenessRecord> => request('POST', `/api/standups/${encodeURIComponent(sessionId)}/intake-requests/${encodeURIComponent(jiraKey)}/awareness`, input);

/**
 * Typed client for the backend Configuration write API (project plan §6). Each
 * call mirrors a repository operation; the caller reloads the dataset afterward
 * so the projection and graph recompute from the persisted source of truth.
 *
 * On a non-2xx response the server sends `{ error }`; this surfaces it as a
 * thrown {@link Error} so the UI can show the validation message.
 */

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new Error(data?.error ?? `${method} ${path} failed (${res.status})`);
  }
  return data as T;
}

export const listStandupAudioTracks = (): Promise<StandupAudioTrackSummary[]> => request('GET', '/api/standup/audio-tracks');
export const getTeamStandupAudio = (teamId: string): Promise<TeamStandupAudioSettings> => request('GET', `/api/teams/${encodeURIComponent(teamId)}/standup-audio`);
export const saveTeamStandupAudio = (teamId: string, value: Omit<TeamStandupAudioSettings, 'teamId'>): Promise<TeamStandupAudioSettings> => request('PUT', `/api/teams/${encodeURIComponent(teamId)}/standup-audio`, value);
export const deleteStandupAudioTrack = (trackId: string): Promise<void> => request('DELETE', `/api/standup/audio-tracks/${encodeURIComponent(trackId)}`);
export async function uploadStandupAudioTrack(file: File, displayName: string): Promise<StandupAudioTrackSummary> {
  const res = await fetch(`${API_BASE}/api/standup/audio-tracks`, { method: 'POST', headers: { 'Content-Type': 'audio/mpeg', 'X-ECP-Track-Name': encodeURIComponent(displayName), 'X-ECP-Track-Filename': encodeURIComponent(file.name) }, body: file });
  const text = await res.text(); const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(data?.error ?? `Upload failed (${res.status})`);
  return data as StandupAudioTrackSummary;
}
export const standupAudioContentUrl = (trackId: string): string => `${API_BASE}/api/standup/audio-tracks/${encodeURIComponent(trackId)}/content`;

// --- Settings knobs (+ Jira mapping) ---------------------------------------
export const patchSettings = (patch: Record<string, unknown>): Promise<unknown> =>
  request('PATCH', '/api/settings', patch);

export const patchEpicSettings = (epicKey: string, patch: Record<string, unknown>): Promise<unknown> =>
  request('PATCH', `/api/epics/${encodeURIComponent(epicKey)}/settings`, patch);
export const patchTeamSettings = (teamId: string, patch: Record<string, unknown>): Promise<unknown> => request('PATCH', `/api/teams/${encodeURIComponent(teamId)}/settings`, patch);

/** Replace the complete owner-first SME order for an epic. */
export const replaceEpicSmes = (epicKey: string, memberIds: string[]): Promise<EpicSme[]> =>
  request('PUT', `/api/portfolio/epics/${encodeURIComponent(epicKey)}/smes`, { memberIds });

// --- Local DB snapshot + import --------------------------------------------
export interface SnapshotResponse {
  /** Filename of the snapshot written next to the live database. */
  file: string;
}

export interface ImportResponse {
  summary: {
    teams: number;
    members: number;
    epics: number;
    stories: number;
    workItems: number;
    dependencies: number;
    sprints: number;
    placements: number;
  };
  /** Auto-snapshot of the pre-import data, or null for an in-memory DB. */
  backup: string | null;
}

/** Copy the live database to a timestamped `*-snapshot-*.db` on the server. */
export const snapshotDb = (): Promise<SnapshotResponse> => request('POST', '/api/db/snapshot');

/** Upload a `.db` file to replace the live database's contents. */
export async function importDb(file: File): Promise<ImportResponse> {
  const res = await fetch(`${API_BASE}/api/db/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new Error(data?.error ?? `import failed (${res.status})`);
  }
  return data as ImportResponse;
}

// --- Jira sync + live field mapping (project plan §7) ----------------------
export interface JiraSampleResponse {
  projectKey: string;
  sampleKey: string | null;
  fields: Record<string, unknown> | null;
  catalog: Array<{ id: string; name: string; custom: boolean; type: string | null }>;
  linkTypes: Array<{ id: string; name: string; inward: string; outward: string }>;
}

export interface SyncResponse {
  runId: string;
  source: string;
  summary: Record<string, number>;
  changes: SyncChange[];
  syncedAt: string;
  coalesced: boolean;
  estimateReviews: Array<{ epicKey: string; workload: EpicWorkload }>;
  warnings: string[];
}

export interface EstimateReviewChange { key: string; kind: 'new-item' | 'newly-estimated' | 'points-increased'; previousPoints: number | null; currentPoints: number | null; }
export interface EpicWorkload {
  epicKey: string;
  jiraEstimatedRemainingPoints: number;
  unrefinedRemainingPoints: number;
  modeledRemainingPoints: number;
  unestimatedJiraItems: number;
  hasUnrefinedEstimate: boolean;
  estimateReviewRequired: boolean;
  estimateReviewChanges: EstimateReviewChange[];
  factSignature: string;
  reviewedAt: string | null;
}

export const saveEpicEstimate = (epicKey: string, input: { unrefinedPoints: number; expectedFactSignature: string }): Promise<{ estimate: EpicEstimate; workload: EpicWorkload }> =>
  request('PUT', `/api/epics/${encodeURIComponent(epicKey)}/estimate`, input);
export const deleteEpicEstimate = (epicKey: string): Promise<void> => request('DELETE', `/api/epics/${encodeURIComponent(epicKey)}/estimate`);

/** Analysis of one specific ticket, for the ticket-driven field mapper. */
export interface JiraFieldRef {
  id: string;
  name: string;
  custom: boolean;
  type: string | null;
}
export interface JiraTicketResponse {
  key: string;
  summary: string | null;
  status: string | null;
  issueType: string | null;
  fields: Record<string, unknown>;
  catalog: JiraFieldRef[];
  numericFields: Array<JiraFieldRef & { value: number }>;
  linkTypes: Array<{ id: string; name: string; inward: string; outward: string }>;
  blocks: {
    linkType: string | null;
    isNativeLink: boolean;
    blockedBy: string[];
    blocking: string[];
    customFieldCandidate: JiraFieldRef | null;
  };
}

/** Fetch the field catalog + a sample issue so the user can map fields live. */
export const getJiraSample = (params: { project?: string; epic?: string } = {}): Promise<JiraSampleResponse> => {
  const q = new URLSearchParams();
  if (params.project) q.set('project', params.project);
  if (params.epic) q.set('epic', params.epic);
  const qs = q.toString();
  return request('GET', `/api/jira/sample${qs ? `?${qs}` : ''}`);
};

/** Look up one specific ticket (by key or browse URL) for the field mapper. */
export const getJiraTicket = (ref: string): Promise<JiraTicketResponse> =>
  request('GET', `/api/jira/ticket${qs({ ref })}`);

/** Re-import from Jira and reconcile onto local state. */
export const syncNow = (): Promise<SyncResponse> => request('POST', '/api/sync');

/** The persisted sync-log history, newest first. */
export const getSyncLog = (): Promise<{ entries: SyncLogEntry[] }> => request('GET', '/api/sync/log');

// --- Jira setup wizard (project plan §7) -----------------------------------
export interface JiraConnection {
  connected: boolean;
  baseUrl: string | null;
  displayName?: string;
  email?: string | null;
  accountId?: string;
  error?: string;
}
export interface JiraBoardOption {
  id: number;
  name: string;
  type: string;
  projectKey: string | null;
}
export interface JiraEpicOption {
  key: string;
  summary: string;
}
export interface JiraRecentTicket {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  updated: string | null;
}
export interface JiraEpicScopePreview {
  projectKey: string;
  epics: Array<{
    key: string;
    summary: string;
    status: string;
    remainingItems: number;
    remainingPoints: number;
    unestimatedItems: number;
    scopeOverride: 'auto' | 'include' | 'exclude';
    planningKind: 'timeline' | 'ongoing';
  }>;
  candidates: Array<{
    key: string;
    summary: string;
    status: string;
    statusCategory: string | null;
    remainingItems: number;
    remainingPoints: number;
    unestimatedItems: number;
    scopeOverride: 'auto' | 'include' | 'exclude';
    planningKind: 'timeline' | 'ongoing';
    exclusion: string | null;
    tracked: boolean;
  }>;
  archived: Array<{ key: string; summary: string }>;
  diagnostics: {
    boardId: number;
    boardIssueCount: number;
    rootSelection: 'jira-epic' | 'referenced-jira-epic' | 'parentless-board-root';
    referencedJiraEpicCount: number;
    jiraEpicCount: number;
    rootCandidateCount: number;
    issueTypes: Record<string, number>;
    rootIssueTypes: Record<string, number>;
    exclusionCounts: Record<string, number>;
  };
}
export interface JiraUserOption {
  accountId: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
}
export interface JiraCurrentSprintAssignees {
  currentSprint: { id: number; name: string } | null;
  users: Array<{ accountId: string; displayName: string; avatarUrl: string | null; ticketCount: number }>;
  reason: string | null;
}

const qs = (params: Record<string, string | undefined>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && v.trim() !== '') q.set(k, v.trim());
  }
  const s = q.toString();
  return s ? `?${s}` : '';
};

/** Connection status for the wizard's Connect step (never returns the token). */
export const getJiraConnection = (): Promise<JiraConnection> => request('GET', '/api/jira/connection');

export const searchJiraBoards = (q?: string): Promise<{ boards: JiraBoardOption[] }> =>
  request('GET', `/api/jira/boards${qs({ q })}`);

export const searchJiraEpics = (params: { project?: string; q?: string } = {}): Promise<{
  projectKey: string;
  epics: JiraEpicOption[];
}> => request('GET', `/api/jira/epics${qs({ project: params.project, q: params.q })}`);

export const getRecentJiraTickets = (project?: string): Promise<{ projectKey: string; tickets: JiraRecentTicket[] }> =>
  request('GET', `/api/jira/recent-tickets${qs({ project })}`);

export const previewJiraEpicScope = (project?: string): Promise<JiraEpicScopePreview> =>
  request('GET', `/api/jira/epic-scope/preview${qs({ project })}`);

export const updatePortfolioEpic = (epicKey: string, patch: {
  scopeOverride?: 'auto' | 'include' | 'exclude';
  planningKind?: 'timeline' | 'ongoing';
  priority?: number;
}): Promise<{ epicKey: string; scopeOverride: 'auto' | 'include' | 'exclude'; planningKind: 'timeline' | 'ongoing'; priority: number }> =>
  request('PUT', `/api/portfolio/epics/${encodeURIComponent(epicKey)}`, patch);

export interface JiraCacheEvent { at: string; operation: string; outcome: 'network' | 'cache-hit' | 'coalesced' | 'error'; durationMs?: number }
export const getJiraCacheEvents = (): Promise<{ enabled: boolean; events: JiraCacheEvent[] }> => request('GET', '/api/jira/cache/events');
export const refreshJiraCache = (): Promise<{ cleared: boolean }> => request('POST', '/api/jira/cache/refresh');

export const searchJiraUsers = (q?: string): Promise<{ users: JiraUserOption[] }> =>
  request('GET', `/api/jira/users${qs({ q })}`);

export const getCurrentSprintAssignees = (): Promise<JiraCurrentSprintAssignees> =>
  request('GET', '/api/jira/current-sprint-assignees');

export interface JiraBoardStatusDiscovery {
  boardId: string; boardName: string; source: 'board-configuration' | 'board-issues';
  statuses: Array<{ id: string; name: string; category: string; columnName: string | null; boardOrder: number; observedIssueCount: number | null }>;
  warning: string | null;
}
export const getJiraBoardStatuses = (): Promise<JiraBoardStatusDiscovery> => request('GET', '/api/jira/board-statuses');

// --- Team cadence ----------------------------------------------------------
export const updateTeam = (id: string, patch: Partial<Omit<Team, 'id'>>): Promise<Team> =>
  request('PUT', `/api/teams/${encodeURIComponent(id)}`, patch);

// --- Members ---------------------------------------------------------------
export const createMember = (input: {
  teamId: string;
  name: string;
  baseVelocity: number;
  active?: boolean;
  /** Jira accountId to link this member to (from the people picker). */
  jiraAccountId?: string | null;
  /** Jira avatar image URL to show in the avatar chip. */
  avatarUrl?: string | null;
}): Promise<TeamMember> => request('POST', '/api/members', input);

export const updateMember = (
  id: string,
  patch: Partial<Pick<TeamMember, 'name' | 'baseVelocity' | 'active' | 'jiraAccountId' | 'avatarUrl'>>,
): Promise<TeamMember> => request('PUT', `/api/members/${encodeURIComponent(id)}`, patch);

export const deleteMember = (id: string): Promise<void> =>
  request('DELETE', `/api/members/${encodeURIComponent(id)}`);

// --- Date-range modifiers --------------------------------------------------
export const createPto = (input: {
  memberId: string;
  startDate: string;
  endDate: string;
  note?: string | null;
}): Promise<Pto> => request('POST', '/api/pto', input);
export const deletePto = (id: string): Promise<void> =>
  request('DELETE', `/api/pto/${encodeURIComponent(id)}`);

export const createOncall = (input: {
  memberId: string;
  startDate: string;
  endDate: string;
  note?: string | null;
}): Promise<Oncall> => request('POST', '/api/oncall', input);
export const deleteOncall = (id: string): Promise<void> =>
  request('DELETE', `/api/oncall/${encodeURIComponent(id)}`);

export const createVelocityOverride = (input: {
  memberId: string;
  startDate: string;
  endDate: string;
  multiplier: number;
  note?: string | null;
}): Promise<VelocityOverride> => request('POST', '/api/velocity-overrides', input);
export const deleteVelocityOverride = (id: string): Promise<void> =>
  request('DELETE', `/api/velocity-overrides/${encodeURIComponent(id)}`);

// --- Daily bandwidth check-ins --------------------------------------------
export const listBandwidthCheckIns = (teamId: string, from: string, to: string): Promise<{ checkIns: BandwidthCheckIn[] }> =>
  request('GET', `/api/bandwidth-check-ins${qs({ teamId, from, to })}`);

export const getBandwidthDay = (teamId: string, date: string): Promise<BandwidthDay> =>
  request('GET', `/api/teams/${encodeURIComponent(teamId)}/bandwidth-check-ins/${encodeURIComponent(date)}`);

export const patchBandwidthDay = (teamId: string, date: string, patch: BandwidthDayPatch): Promise<BandwidthDay> =>
  request('PATCH', `/api/teams/${encodeURIComponent(teamId)}/bandwidth-check-ins/${encodeURIComponent(date)}`, patch);

export const upsertBandwidthCheckIn = (
  memberId: string,
  date: string,
  input: { feeling: BandwidthCheckIn['feeling']; note?: string | null },
): Promise<BandwidthCheckIn> =>
  request('PUT', `/api/bandwidth-check-ins/${encodeURIComponent(memberId)}/${encodeURIComponent(date)}`, input);

export const deleteBandwidthCheckIn = (memberId: string, date: string): Promise<void> =>
  request('DELETE', `/api/bandwidth-check-ins/${encodeURIComponent(memberId)}/${encodeURIComponent(date)}`);

// --- Epic milestones ("relevant days") -------------------------------------
export const createMilestone = (
  epicKey: string,
  input: { name: string; date: string; isGating?: boolean },
): Promise<EpicMilestone> =>
  request('POST', `/api/epics/${encodeURIComponent(epicKey)}/milestones`, input);

export const updateMilestone = (
  id: string,
  patch: Partial<Pick<EpicMilestone, 'name' | 'date' | 'isGating'>>,
): Promise<EpicMilestone> => request('PUT', `/api/milestones/${encodeURIComponent(id)}`, patch);

export const deleteMilestone = (id: string): Promise<void> =>
  request('DELETE', `/api/milestones/${encodeURIComponent(id)}`);

export const createImportantDate = (input: Omit<GlobalImportantDate, 'id'>): Promise<GlobalImportantDate> => request('POST', '/api/important-dates', input);
export const updateImportantDate = (id: string, patch: Partial<Omit<GlobalImportantDate, 'id'>>): Promise<GlobalImportantDate> => request('PUT', `/api/important-dates/${encodeURIComponent(id)}`, patch);
export const deleteImportantDate = (id: string): Promise<void> => request('DELETE', `/api/important-dates/${encodeURIComponent(id)}`);

// --- Gantt Planner placements (project plan §6a) ---------------------------
export const placeWorkItem = (input: {
  workItemKey: string;
  sprintId: string;
  weekIndex: number;
}): Promise<PlannedPlacement> => request('PUT', '/api/placements', input);

export const unplaceWorkItem = (workItemKey: string): Promise<void> =>
  request('DELETE', `/api/placements/${encodeURIComponent(workItemKey)}`);
