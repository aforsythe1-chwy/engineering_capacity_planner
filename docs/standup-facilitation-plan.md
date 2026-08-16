# Standup Facilitation and Durable Session Records — Implementation Plan

**Status:** Proposed

**Created:** 2026-08-15

**Scope:** rename Run Standup to Standup; replace the inline entry form with one modal-driven
facilitation workflow; add global sprint context, per-member context, targeted Jira refresh and
prefetching, post-standup notes, durable session history, accessibility, and verification

**Constraints:** plan only; no application code in this change; no Spec Kit/SDD; preserve the flat
planner and the invariants in `planner-product-constitution.md`

## 1. Outcome

Turn the existing **Run Standup** page into a peer page named **Standup**. The page itself is a
quiet launch surface with one primary **Start Standup** entrypoint. Starting or resuming a standup
opens a large modal that keeps team-wide context beside one member's context and advances through
the active roster.

The workflow has two stages:

1. **Team round** — review global sprint context and one member at a time, record the current day's
   bandwidth check-in, and create post-standup notes tagged to the people involved.
2. **Post-standup** — after every participant is completed or skipped, hide the sprint/member
   context and show only the editable post-standup notes for discussion and enrichment.

Finishing the second stage creates an immutable final snapshot of the information used during the
standup while retaining normalized session, participant, and note records. Writes happen
incrementally, so closing the modal or refreshing the browser does not discard a standup already
in progress.

## 2. Product decisions and assumptions

### 2.1 Rename the surface without changing its route level

- Change the navigation label and page heading from **Run Standup** to **Standup**.
- Keep the canonical route value `tab=standup`; this is a display-name change, not a URL migration.
- Update the product constitution and existing bandwidth plan so they no longer call the page
  **Run Standup**.
- Keep Standup as a peer of Overview, Timeline, Dependencies, Gantt Planner, Team, and
  Configuration. The modal is an interaction surface within the page, not another route or child
  application.
- Preserve the route's Epic filter when entering or leaving Standup, but do not use it to hide
  participants, global epics, sprint work, bandwidth history, or notes. Standup shows whole-team
  truth. Do not render the generic epic `ScopeSummary` above this page because it implies that the
  standup content is epic-filtered.

### 2.2 Keep one visible launch action

The page header contains the title, a short explanation, and one primary **Start Standup** button.
Do not leave the current date picker, member rows, feeling buttons, or note inputs on the page.

The button opens today's session for the team selected in the independent `team` route parameter:

- if no session exists for that team and local calendar date, create it;
- if a session is active or in post-standup, resume it at its persisted stage and participant;
- if today's session is complete, open its completed post-standup record read-only instead of
  creating a duplicate;
- if multiple teams exist, keep team selection in the existing route state rather than adding a
  second launch action. A compact team selector may sit in the page header, but **Start Standup**
  remains the only action.

The initial button label remains exactly **Start Standup**. Supporting copy may say that an
unfinished session will resume. After completion, it may change to **View today's standup** so the
action does not imply a duplicate will be created.

### 2.3 Preserve the existing bandwidth collection behavior

The existing page's core data-collection behavior remains part of each member step:

- show the four Red, Yellow, Green, and Purple options and their existing meanings;
- upsert one `BandwidthCheckIn` for the participant and standup date;
- allow the existing optional bandwidth note;
- do not require a feeling before **Next** or **Skip**;
- treat missing as unknown, never Green.

This is an explicit compatibility assumption because the requested redesign adds member context
but does not ask to remove the current page's daily bandwidth purpose.

### 2.4 Define “current epics” and “sprint backlog”

**Current epics** means all tracked, active epics for the selected team according to
`effectivePortfolioEpic(...)`. It ignores the global Epic filter and excludes removed or archived
epics. Show key, title, source status, planning kind, owner, and relevant-day summary. This context
comes from the locally persisted planner dataset and is snapshotted for the session.

For the first release, **sprint backlog** means issues in the active Jira sprint whose stable Jira
status-category key is `new` (the To Do category). It excludes in-progress and done issues. Show
key, summary, display status, assignee, parent/epic when available, and a Jira link. Sort by Jira
rank when the field is available, otherwise key. Do not infer backlog membership from the
planner's four display statuses.

If product usage intends “all incomplete sprint scope” rather than To Do work, only this selector
and label need to change; the persistence and API contracts below remain valid.

### 2.5 Define participant order and completion

- Snapshot the active members of the selected team when the session starts.
- Use a deterministic name order for the first release because the repository has no durable
  roster-order field. Persist the resulting position so later member edits cannot reorder an
  in-progress or historical session.
- **Next** marks the current participant `completed` and advances.
- **Skip** marks the current participant `skipped` and advances. No reason is required initially.
- Completed and skipped participants both count as resolved.
- When the final participant is resolved, transition the session to `post_standup` atomically.
- An empty active roster transitions directly to post-standup with a clear explanation.

### 2.6 Make notes shared standup artifacts

Post-standup notes are session-level, ordered, editable plain-text items. Each note supports either:

- one or more tagged members from the session's team; or
- the exclusive **All team** audience.

Choosing **All team** clears individual tags. Choosing an individual clears **All team**. Empty
drafts are UI state and are not persisted. Persisted bodies are trimmed, have an initial 4,000
character limit, and may be edited or removed until the session is finished.

The member-context helper **Add post-standup note** opens a new note composer, preselects the
current member, and moves focus into the body. It does not generate synthetic text or create an
empty database row.

### 2.7 Record incrementally, then freeze a final snapshot

Do not wait until the last button click to persist the session. Persist session creation,
participant disposition, bandwidth check-ins, Jira context snapshots, and notes as they change.
This makes modal close/reopen and browser reload safe.

**Finish Standup** performs one transaction that:

1. verifies the session is in post-standup;
2. flushes or rejects any unsaved non-empty note draft;
3. composes the final typed record from the session, participant states, final notes, current
   epic snapshot, per-member context snapshots, Jira freshness/error metadata, and bandwidth
   values visible during the session;
4. stores the serialized final record with a schema version;
5. sets `completed_at` and makes the session read-only.

The immutable final payload is the historical record. Normalized rows remain for operational
resume/edit behavior and future reporting.

### 2.8 Keep this an observational workflow

Standup notes, skips, ticket discussion, and bandwidth feelings do not modify capacity,
assignments, Jira status, Jira assignee, sprint scope, epic ownership, or forecasts. The Jira work
in this feature is read-only and targeted. Any write-back to Jira is a separate product decision.

## 3. Current-state findings

The repository already provides useful seams:

- `packages/frontend/src/components/RunStandupPage.tsx` owns the current inline daily bandwidth
  workflow and can be replaced rather than introducing another primary page.
- `App.tsx` and `lib/router.ts` already use the stable `standup` route and preserve independent
  team/epic query state.
- `BandwidthCheckIn`, `bandwidth_check_in`, and the focused bandwidth API already provide durable
  one-member/one-day reporting.
- `EpicSme` order already makes rank zero the owner and later ranks non-primary SMEs.
- `JiraClient.searchJql`, board discovery, active-sprint discovery, current-sprint assignees, Jira
  issue links, and the configured board/project settings can be reused.
- The general `JiraRequestCache` is process-local and caches a broad `searchJql` input for five
  minutes by default. It is suitable for setup discovery, but not by itself for the requirement to
  pull fresh current/next participant tickets.
- The imported `WorkItem` model stores a normalized status and a Boolean indicating whether Jira
  assigned the item to a sprint. It does not retain the authoritative Jira sprint ID or raw status
  category per item. The standup must not reconstruct current-sprint truth from that model.
- Existing modals supply the visual base, but the large standup dialog needs complete focus
  trapping, focus restoration, responsive behavior, and explicit loading/error regions.
- The current working tree already contains in-progress Team, bandwidth, and ownership changes.
  Implementation must build on them and must not overwrite or re-create those user-owned edits.

## 4. Target experience

### 4.1 Standup launch page

Render a compact `.panel` using the existing tokens and control hierarchy:

- **Standup** heading;
- one sentence explaining that the flow reviews the current sprint and captures team follow-ups;
- optional non-action status text such as “No standup recorded today,” “In progress · 4 of 8,” or
  “Completed at 10:24 AM”;
- the single primary entrypoint.

Bundled sample mode can open an inspectable demonstration using fixture context, but all mutations
and finishing are disabled. If the backend is connected but Jira is not configured or temporarily
unavailable, the modal still supports local epics, bandwidth, participant progress, and notes; Jira
sections show explicit unavailable/stale states rather than blocking the whole standup.

### 4.2 Modal shell

Use a large dialog, approximately `min(1200px, calc(100vw - 32px))` and at most `94vh`, with a
stable header and footer. At a narrow viewport it becomes a full-viewport dialog with one scrolling
column.

The header shows:

- team name;
- sprint name, or a clear **Sprint unavailable** state;
- standup date;
- team-round progress such as `3 of 8` or **Post-standup**;
- a close button.

During the team round, use a restrained two-column layout:

- a global rail, roughly one third of the width, which remains visible while the participant panel
  scrolls on desktop;
- a participant workspace, roughly two thirds of the width;
- on narrow screens, global notes first, followed by collapsible epic/backlog context and then the
  participant workspace.

Use `--panel` for the modal, `--panel-2` for editable/nested areas, quiet one-pixel borders, the
existing radius family, compact buttons, and a single accent primary action. Do not turn every
ticket, epic, or note into a heavy card.

### 4.3 Global context

Keep the following available for every participant:

1. **Post-standup notes** at the top, with a compact plus button, note count, editable bodies, and
   member/All team tag controls.
2. **Current epics**, showing all current team epics regardless of global Epic filter.
3. **Sprint backlog**, showing the active sprint's To Do/new-category issues.

Long epic and ticket lists need a compact initial window with **Show all**, not an independently
scrolling box nested inside the modal. Jira keys use the existing `JiraKeyLink`. Empty, loading,
stale, and failed states are distinct.

### 4.4 Participant workspace

For the current member, show identity and progress first, then these sections:

1. **In-progress tickets** — only fresh Jira issues assigned to this member in the active sprint
   whose stable status-category key is `indeterminate`. Include key, summary, display status,
   parent/epic, and Jira links.
2. **Open in Jira** — an exact sprint-and-assignee issue-search link plus an ordinary board link.
   Jira Cloud documents assignee filtering in the board UI, but does not document a portable
   assignee-filtered board URL. Do not hard-code an unsupported query parameter. If an exact
   prefiltered board deep link is mandatory, add a configured URL template or saved quick-filter
   ID; otherwise the issue-search link is the reliable filtered destination.
3. **Primary owner of** — current tracked epics where this member is SME rank zero.
4. **Additional SME for** — current tracked epics where this member has rank greater than zero.
5. **Recent bandwidth** — the five prior scheduled team workdays, each labeled with its date and
   recorded feeling/note when available. Missing days remain **No report**. Do not scan weekends
   merely to find five positive reports.
6. **Today's bandwidth** — the existing four-choice check-in and optional note for the standup
   date.
7. **Add post-standup note** — opens the global note composer tagged to this member.

The footer contains secondary **Skip** and primary **Next** actions. Disable both only while their
own progress mutation is pending, not while a Jira refresh is slow or failed. Announce the next
member after advancing without moving focus unpredictably.

### 4.5 Jira freshness and prefetch behavior

The experience uses persisted snapshots for immediate paint and fresh targeted requests for
accuracy:

1. Opening the modal returns the session plus saved global/current/next context immediately.
2. The frontend starts targeted Jira refreshes for the current and next linked members in parallel.
3. A successful response replaces the displayed snapshot, persists it to the session, and shows
   **Updated just now**.
4. Advancing promotes the prefetched next member without waiting. It then prefetches the newly
   exposed next member.
5. Each participant is refreshed at least once per modal-open run. If that member already has an
   in-flight refresh from prefetch, reuse it. Do not issue a duplicate request.
6. A manual compact **Refresh tickets** action is available for the current member and bypasses the
   standup cache.
7. If refresh fails, retain the last successful snapshot, label its capture time, show a
   non-blocking error, and allow Skip/Next. If no snapshot exists, show **Tickets unavailable**.

This is stale-while-revalidate behavior at the UI/session layer. Do not satisfy it by running the
full `/api/sync`, reading every board issue, or reconciling a partial Jira result into
`DomainDataset`.

### 4.6 Post-standup stage

After the last participant is resolved, replace both team-round columns with one focused notes
workspace. Show only:

- **Post-standup notes** heading and note count;
- ordered note editors;
- member/All team tags;
- add and remove actions;
- **Finish Standup** as the single primary completion action.

Participant tickets, epics, bandwidth, and roster progress are intentionally hidden during this
stage. Notes remain editable so the facilitator can clarify wording, split or combine follow-ups,
and correct tags while discussing them.

If there are no notes, show a calm empty state and allow completion. Finishing waits for pending
note writes, stores the final snapshot, changes the dialog to read-only, and reports completion
time. Do not create Jira issues, Slack messages, or other external actions.

### 4.7 Close, resume, and concurrency

- Escape and the close button close an in-progress dialog after flushing a valid focused note;
  persisted work remains resumable.
- If a non-empty note cannot save, keep the modal open and focus its error. Empty drafts may be
  discarded.
- Starting today's standup is idempotent. Repeated clicks or browser tabs return the same session.
- Every mutable session response carries `updatedAt` (or an integer revision). Mutations submit
  the last observed value and return `409` on a stale write so two tabs cannot silently overwrite
  notes or participant progress.
- A completed session is immutable through ordinary endpoints.

## 5. Shared contracts

Add focused shared types rather than putting raw Jira shapes into React state:

```ts
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
}

export interface StandupTicket {
  key: string;
  summary: string;
  status: string;
  /** Jira's stable category key, normally new, indeterminate, or done. */
  statusCategory: string;
  assigneeAccountId: string | null;
  assigneeName: string | null;
  parentKey: string | null;
  parentSummary: string | null;
}
```

Define separate typed global and member context responses. Both carry `capturedAt`, source
(`jira`, `local`, or `snapshot`), freshness, and an error code/message when part of the context is
unavailable. Keep final-record `schemaVersion` explicit so future additions can be decoded without
guessing.

Do not add standup sessions to the always-loaded `DomainDataset`. Session bodies, notes, and ticket
snapshots are potentially large and are needed only on Standup. Use focused APIs, as the existing
bandwidth routes do.

## 6. SQLite persistence

Add additive tables to `SCHEMA_SQL`. Exact names may follow repository naming conventions, but the
constraints are required.

```sql
CREATE TABLE IF NOT EXISTS standup_session (
  id                  TEXT PRIMARY KEY,
  team_id             TEXT NOT NULL REFERENCES team(id) ON DELETE RESTRICT,
  standup_date        TEXT NOT NULL,
  sprint_id           TEXT,
  sprint_name         TEXT,
  status              TEXT NOT NULL
                      CHECK(status IN ('active', 'post_standup', 'completed')),
  started_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  completed_at        TEXT,
  revision            INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  final_schema_version INTEGER,
  final_snapshot_json TEXT,
  UNIQUE(team_id, standup_date)
);

CREATE TABLE IF NOT EXISTS standup_participant (
  session_id   TEXT NOT NULL REFERENCES standup_session(id) ON DELETE CASCADE,
  member_id    TEXT NOT NULL REFERENCES team_member(id) ON DELETE RESTRICT,
  member_name  TEXT NOT NULL,
  position     INTEGER NOT NULL CHECK(position >= 0),
  disposition  TEXT NOT NULL DEFAULT 'pending'
               CHECK(disposition IN ('pending', 'completed', 'skipped')),
  resolved_at  TEXT,
  PRIMARY KEY(session_id, member_id),
  UNIQUE(session_id, position)
);

CREATE TABLE IF NOT EXISTS standup_note (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES standup_session(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  all_team    INTEGER NOT NULL DEFAULT 0 CHECK(all_team IN (0, 1)),
  position    INTEGER NOT NULL CHECK(position >= 0),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(session_id, position)
);

CREATE TABLE IF NOT EXISTS standup_note_member (
  note_id    TEXT NOT NULL REFERENCES standup_note(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES team_member(id) ON DELETE RESTRICT,
  PRIMARY KEY(note_id, member_id)
);

CREATE TABLE IF NOT EXISTS standup_context_snapshot (
  session_id    TEXT NOT NULL REFERENCES standup_session(id) ON DELETE CASCADE,
  scope_kind    TEXT NOT NULL CHECK(scope_kind IN ('global', 'member')),
  scope_key     TEXT NOT NULL,
  captured_at   TEXT NOT NULL,
  source        TEXT NOT NULL CHECK(source IN ('jira', 'local', 'snapshot')),
  fetch_status  TEXT NOT NULL CHECK(fetch_status IN ('fresh', 'stale', 'unavailable')),
  error_message TEXT,
  payload_json  TEXT NOT NULL,
  PRIMARY KEY(session_id, scope_kind, scope_key)
);
```

Repository validation additionally enforces:

- ISO calendar dates and ISO timestamps;
- one open-or-completed record per team/date;
- contiguous participant and note positions;
- participants and tagged members belong to the session team;
- **All team** and individual tag rows cannot coexist;
- non-empty trimmed note bodies and the maximum length;
- final payload is present if and only if the session is completed;
- no mutation is allowed after completion.

Do **not** add these tables to the existing `INSERT_ORDER`/`DELETE_ORDER` used by `writeDataset`.
That path writes `DomainDataset` during Jira reconciliation, and including standup tables there
would clear local history that is intentionally absent from the dataset. Give the standup
repository its own dependency-safe read/write order.

SQLite file snapshots naturally contain the new tables. The current database-import path reads an
uploaded file into `DomainDataset` and then calls `writeDataset`, so extend it with a separate
`StandupArchive` transfer (or equivalent dedicated table-copy step) inside the same replacement
transaction. Extend import summaries, fixture normalization, and round-trip tests accordingly.
Jira reconciliation never owns or touches standup tables. Deactivating a member preserves history;
deleting a member referenced by a session or note returns a conflict recommending deactivation.

## 7. Backend services and HTTP API

Create focused modules such as `db/standup.ts`, `jira/standup-context.ts`, and
`routes/standup.ts`; do not expand the already broad configuration repository.

### 7.1 Start or resume

```http
POST /api/standups/start
Content-Type: application/json

{ "teamId": "team-platform", "date": "2026-08-15" }
```

The browser supplies its local date, matching bandwidth semantics. The backend validates the date
but does not reject it using a UTC “today” comparison.

In one transaction, return the existing team/date session or create a new session and participant
snapshot. Resolve the configured board and active sprint outside the transaction, with a bounded
timeout; fall back to the matching locally stored sprint or `null` so Jira failure cannot prevent a
local standup. Store sprint ID/name once and do not silently switch an in-progress session if Jira
later changes active sprints.

If Jira reports multiple active sprints and no single stored sprint matches, return the candidates
as a setup state in the modal and require one selection before participant Jira refresh begins.
Do not silently choose the first array item.

The response includes the session, participants, notes, global context, current member context,
next member context, and capability/freshness metadata.

### 7.2 Read/resume

```http
GET /api/standups/:sessionId
```

Return the same aggregate without contacting Jira. This endpoint is the fast resume/read path and
is valid for completed sessions.

### 7.3 Targeted Jira refresh

```http
POST /api/standups/:sessionId/global-context/refresh
POST /api/standups/:sessionId/participants/:memberId/tickets/refresh
```

The global refresh uses a bounded JQL query for the recorded sprint and requests only the fields
needed for backlog display. The member refresh uses a bounded query equivalent to:

```text
sprint = <recorded sprint id>
AND assignee = "<linked Jira account id>"
AND statusCategory = "In Progress"
ORDER BY Rank ASC
```

Use the Jira account ID, not display name, and escape/construct JQL in one tested helper. Request
only `summary`, `status`, `assignee`, `parent`, and `issuetype`; JQL ordering does not require Rank
in the returned field set. Fully follow cursor pagination but enforce a defensive result ceiling
and return truncation metadata.

The global backlog query uses `statusCategory = "To Do"`. Jira status display names remain for
display only; classification uses `status.statusCategory.key`.

Do not invoke the full importer, `writeDataset`, or `reconcileDataset`. A targeted result is not a
complete source dataset and must never delete unrelated work.

### 7.4 Dedicated refresh coordinator/cache

Do not route forced participant refreshes through the general five-minute `JiraRequestCache`,
because it can return an old `searchJql` result while claiming to refresh.

Create a dedicated coordinator keyed by `(boardId, sprintId, jiraAccountId)` that:

- coalesces identical in-flight requests;
- records one last successful typed snapshot and capture time in the standup session;
- lets the read/start API return that snapshot immediately;
- makes explicit refresh call the uncached Jira client;
- optionally treats a successful prefetch from the current modal-open run as satisfying the next
  member's initial refresh;
- never stores note text or bandwidth notes;
- emits operation/outcome/duration diagnostics without JQL, account IDs, summaries, or payloads.

The frontend owns the small current/next map for a modal run. SQLite snapshots provide durable
fallback across browser or server restarts. An in-memory TTL alone is insufficient for the final
record requirement.

### 7.5 Participant and bandwidth mutations

```http
PUT /api/standups/:sessionId/participants/:memberId
Content-Type: application/json

{ "disposition": "completed", "expectedRevision": 7 }
```

Validate that the member is the current pending participant for the normal forward flow. Mark the
participant and advance/re-stage in one transaction. Return the updated session, participant
progress, and next IDs so the client never derives conflicting progress.

Continue using the existing bandwidth endpoint for immediate feeling/note upserts. At participant
resolution and final completion, read the canonical `bandwidth_check_in` row into the final session
snapshot. This avoids a second mutable bandwidth store while keeping historical completion data
immutable.

### 7.6 Note mutations

```http
POST   /api/standups/:sessionId/notes
PUT    /api/standups/:sessionId/notes/:noteId
DELETE /api/standups/:sessionId/notes/:noteId
```

Create/update bodies and the complete audience atomically. Reject unknown fields, invalid team
members, mixed All-team/member audiences, empty bodies, stale revisions, and completed sessions.
Return the canonical ordered notes and new session revision after every write.

### 7.7 Finish

```http
POST /api/standups/:sessionId/finish
Content-Type: application/json

{ "expectedRevision": 12 }
```

Require `post_standup`, build and validate the final versioned payload, write it and completion
timestamps, and return the completed read model in one transaction. The endpoint is idempotent for
the same already-completed session and rejects attempts to finish an active team round.

## 8. Jira link behavior

Build all Jira URLs from the configured base URL; remove the current Chewy-specific default from
new standup link construction.

Provide two links in member context:

- **Open sprint tickets in Jira** — an encoded issue-search URL with JQL for the recorded sprint
  and member account ID. This is the reliable prefiltered link.
- **Open Jira board** — the configured board's active-sprint view. Jira's native Assignee filter
  can then be applied and is documented to persist for the user. See Atlassian's
  [board-filter guidance](https://support.atlassian.com/jira-software-cloud/docs/show-or-hide-issues-on-your-board/).

Do not label the second link as prefiltered unless the repository gains an explicitly configured
and tested URL template or saved quick-filter ID. This avoids a false promise based on undocumented
Atlassian URL state.

## 9. Frontend composition and state

Suggested boundaries:

- `StandupPage` — minimal launch/status surface and team-route integration;
- `StandupModal` — dialog lifecycle, focus management, aggregate loading, stage switch;
- `StandupGlobalContext` — notes, current epics, sprint backlog;
- `StandupParticipantPanel` — member identity and section composition;
- `StandupTicketList` — compact Jira rows and freshness state;
- `StandupEpicList` — current/owner/SME variants using shared selectors;
- `StandupBandwidth` — recent history plus existing current-day choice behavior;
- `StandupNoteList`, `StandupNoteEditor`, and `StandupAudiencePicker`;
- `useStandupPrefetch` — current/next request coordination with abort and stale-response guards.

Keep state ownership explicit:

- route team and Epic filter remain owned by `App`;
- durable stage, participant disposition, notes, and revision come from the backend aggregate;
- current/next loading and request tokens are local modal state;
- unsaved note text is local to its editor until a valid save;
- current-day bandwidth uses the canonical bandwidth API response;
- derived owner/SME lists use `epicSmes(...)`/`epicOwnerId(...)`, never duplicate owner state.

When the modal closes, abort irrelevant frontend requests. Backend calls already received may
finish and persist a useful context snapshot. Ignore late responses in an unmounted modal.

## 10. Accessibility and responsive behavior

- Give the dialog `role="dialog"`, `aria-modal="true"`, a heading referenced by
  `aria-labelledby`, and descriptive sprint/progress text.
- Move focus to the dialog heading or current participant heading on open, trap Tab/Shift+Tab
  within the modal, make Escape close, and restore focus to the launch button.
- Use the existing radiogroup semantics for today's bandwidth, with full feeling meanings in
  accessible names and visible text so color is not the only signal.
- Make participant progress a semantic ordered list; mark the current participant with
  `aria-current="step"` and completed/skipped states with text.
- Announce ticket refresh completion/failure, note-save state, participant changes, and the
  post-standup transition through scoped polite live regions.
- Keep Skip before Next in DOM/tab order and make Next the only primary action during a member
  step.
- Ensure note tags use a labeled multi-select/combobox with removable chips, listbox semantics,
  keyboard selection, and an explicit mutually exclusive All team option.
- At narrow widths, avoid horizontal modal overflow, keep footer actions visible, allow long Jira
  summaries/names to wrap, and collapse secondary global lists without hiding notes.
- Verify empty, loading, stale, partial, failed, read-only, skipped, completed, and long-content
  states at desktop and mobile widths.

## 11. Privacy, retention, and failure behavior

Standup notes, bandwidth notes, participant dispositions, and immutable snapshots are
human-authored operational history. They must not appear in URLs, Jira request diagnostics,
application logs, sync logs, or error telemetry.

Update database export/import copy to state that snapshots contain standup and bandwidth notes.
Update `export-obfuscated` so member identities, Jira summaries, and both note types inside
standup context/final JSON are transformed or removed. Do not assume obfuscating normalized tables
also sanitizes serialized JSON.

No automatic retention/purge policy is introduced for this local single-user app. If the app
becomes hosted or shared, authentication, authorization, audit, retention, deletion, and employee
data policy are prerequisites.

Failure isolation:

- Jira unavailable: local standup proceeds with stale/unavailable ticket sections.
- One participant unlinked from Jira: show a linking explanation for that member only.
- Bandwidth write fails: retain the attempted input, show a row error, but allow deliberate
  Next/Skip because a report is optional.
- Note write fails: retain the draft and do not falsely show it as saved.
- Participant progress write fails: remain on the same member.
- Finalization fails: remain in editable post-standup with all notes intact.

## 12. Delivery slices

### Slice 1 — Shared read model and session persistence

- Add shared standup session, participant, note, ticket, context, and final-record types.
- Add the five standup tables, indexes, repository mapping, validation, and revision handling.
- Preserve standup data across normal Jira reconciliation and complete database snapshots/imports.
- Extend obfuscation for normalized and serialized standup content.

**Exit:** an old database opens safely; a session, participants, tags, and context snapshots
round-trip; Jira sync cannot erase them; completed final records are immutable.

### Slice 2 — Session lifecycle and note API

- Implement idempotent start/resume/read behavior and roster snapshotting.
- Implement participant Next/Skip transitions and automatic post-standup entry.
- Implement atomic note CRUD, audience validation, ordering, and concurrency conflicts.
- Implement final snapshot composition and idempotent finish.

**Exit:** the entire workflow can be driven through API tests without Jira, survives restart, and
cannot create duplicate team/date sessions.

### Slice 3 — Targeted Jira context service

- Resolve and record the board/active sprint with explicit multiple-sprint handling.
- Add safe JQL builders and global/member typed mappers.
- Add the dedicated uncached refresh coordinator, in-flight coalescing, persisted snapshots,
  result limits, and diagnostics.
- Add configured-base Jira search/board links and missing-account behavior.

**Exit:** current and next participant tickets refresh without a full dataset sync, stale fallback
is visible, partial results never reconcile into planner state, and recorded snapshots survive a
server restart.

### Slice 4 — Rename and launch/modal shell

- Rename navigation/title/copy while keeping `tab=standup`.
- Update the constitution and bandwidth plan terminology.
- Replace the inline page with the single-entrypoint launch/status surface.
- Build the large accessible responsive modal, stage header, focus trap, close/resume behavior,
  global rail, and participant shell using existing visual tokens.

**Exit:** the page meets the one-entrypoint requirement; modal navigation is keyboard-safe; the
global Epic filter remains preserved but does not filter standup truth.

### Slice 5 — Context, bandwidth, notes, and prefetch UI

- Render sprint name, current epics, backlog, Jira links, member tickets, owner/SME lists, and prior
  workday bandwidth.
- Move today's existing bandwidth control into each participant step.
- Add member-tagged note helper and the global note list/editor.
- Implement current/next parallel refresh, prefetched promotion, manual refresh, freshness labels,
  and stale-response guards.
- Wire Skip/Next and all empty/error/loading states.

**Exit:** advancing to the next member is immediate when prefetched; each linked current/next member
gets a fresh targeted Jira pull per modal run; Jira failure does not block local facilitation.

### Slice 6 — Post-standup, completion, and hardening

- Add notes-only post-standup stage and finish behavior.
- Render completed sessions read-only.
- Add unit, integration, end-to-end, accessibility, responsive, and privacy regression coverage.
- Update user-facing documentation and database export warnings.

**Exit:** finishing freezes a complete versioned record; refresh/reopen shows the same result; all
acceptance criteria pass.

## 13. Verification strategy

### 13.1 Shared and repository tests

- current epics ignore the route Epic filter but respect team and tracked/active state;
- rank zero is owner, later ranks are additional SMEs, and lists include only current epics;
- prior workdays use team cadence, return exactly the prior five scheduled dates, and preserve
  missing values;
- participant and note positions are stable and contiguous;
- All team is exclusive with individual tags;
- note trimming/limits and team membership validation are enforced;
- legacy databases gain empty standup tables without destructive migration;
- session data, final JSON, and note tags round-trip through snapshot/import;
- reconciliation preserves sessions while filtering no human-authored history;
- final snapshot version decoding and immutability are enforced.

### 13.2 Backend API and Jira tests

- two concurrent starts for one team/date return one session;
- resume returns current persisted stage and member;
- Next and Skip advance exactly once under revision checks;
- resolving the last member enters post-standup atomically;
- finish rejects active sessions and is idempotent after completion;
- note CRUD rolls back completely on invalid tags or stale revision;
- zero-member teams enter post-standup safely;
- one/multiple/no active sprint states are deterministic;
- member JQL uses recorded sprint ID and linked account ID, requests minimal fields, paginates, and
  enforces the ceiling;
- backlog classification uses Jira status category `new`; member tickets use `indeterminate`;
- in-flight current/next requests coalesce, explicit refresh bypasses stale general cache, and
  failures preserve the prior snapshot/capture time;
- targeted refresh never calls importer reconciliation or changes `work_item` rows;
- missing Jira link, Jira outage, and partial/truncated result metadata remain non-blocking;
- Jira URLs use the configured base URL and properly encode JQL.

### 13.3 Frontend unit tests

- launch state maps new/in-progress/post/completed sessions to the right copy and button behavior;
- current member derives from persisted participant disposition/position, not array mutation;
- prefetch starts current and next in parallel, reuses an in-flight next request, and fetches the
  newly exposed next member after advance;
- late/aborted responses cannot replace another member's context;
- saved snapshots paint before refresh and are visibly labeled stale/fresh;
- note helper preselects only the current member and does not persist an empty draft;
- All team/member tag exclusivity is preserved in request construction;
- Jira failure does not disable Next/Skip;
- post-standup renders notes only;
- current-day bandwidth uses existing canonical feeling values and optimistic rollback behavior.

### 13.4 Playwright flows

1. Open Standup, verify the route remains `tab=standup`, the launch page has one action, and the
   selected Epic filter remains in the URL without filtering modal content.
2. Start a session and verify sprint/team/date, global notes, current epics, backlog, and the first
   member context.
3. Assert current and next targeted requests start, advance, and verify the next member renders
   immediately while the following prefetch begins.
4. Record today's bandwidth, add a helper note, verify the current member tag, reload, and verify
   all state resumes.
5. Skip one member, complete the rest, and verify automatic entry into a notes-only post stage.
6. Enrich note bodies/tags, finish, reload, and verify the completed record is read-only and no
   duplicate session is created.
7. Simulate stale snapshot plus Jira failure and verify age/error copy while Next and notes remain
   usable.
8. Exercise an unlinked member and no-active-sprint state.
9. Verify Tab/Shift+Tab focus trap, Escape/close, focus restoration, radiogroups, live regions, and
   tag-picker keyboard behavior.
10. Verify desktop and narrow layouts with long summaries, many epics, many backlog tickets, no
    notes, and a large roster.

### 13.5 Implementation verification commands

Run from the repository root, with `nvm use` before every Node/npm command as required by
`AGENTS.md`:

```text
nvm use
npm run typecheck
npm run test
npm run build
npm run e2e --workspace @ecp/frontend -- standup.spec.ts
git diff --check
```

Also inspect the Standup page and modal visually at desktop and narrow viewport widths, including
new, resumed, stale Jira, post-standup, and completed states.

## 14. Acceptance criteria

- Navigation and page heading say **Standup** while canonical routing remains `tab=standup`.
- The Standup page exposes one primary **Start Standup** entrypoint and no inline member form.
- Starting opens a large accessible modal with the selected team's sprint name and persistent
  global/member context.
- The modal shows team-wide current epics and To Do/new-category sprint backlog regardless of the
  route Epic filter.
- Each participant shows freshly targeted in-progress sprint tickets when Jira is available, with
  reliable Jira destinations and clear freshness/error state.
- Opening and every advance ensure the current and next linked members have a coalesced targeted
  refresh; the UI can promote prefetched data without waiting.
- Targeted refresh never runs a full Jira sync or reconciles partial results into planner data.
- Each participant shows primary-owned epics, additional-SME epics, the prior five scheduled
  workdays with dates, and today's bandwidth controls.
- The helper note action starts a note tagged to the current participant.
- Skip and Next advance durably; closing/reloading resumes the same session and participant.
- Resolving all participants automatically enters a view containing only post-standup notes.
- Notes can be added, edited, removed, reordered if exposed, and tagged to members or exclusively
  All team before completion.
- Finishing stores a complete versioned immutable snapshot plus completion timestamp and makes the
  session read-only.
- Jira outage, missing Jira linkage, missing sprint, missing bandwidth, empty backlog, empty epic
  list, empty notes, and read-only sample mode all have intentional non-misleading states.
- Standup data survives Jira sync, database restart, snapshot/export/import, member deactivation,
  and route/filter changes.
- Serialized standup data is covered by obfuscation and is never emitted in diagnostics/logs.
- The modal is fully operable by keyboard and remains usable at narrow viewport widths.

## 15. Non-goals

- Creating Jira tickets from post-standup notes.
- Updating Jira status, assignee, sprint, estimates, or comments.
- Sending notes to Slack, email, Confluence, or another external system.
- Automatic summarization, transcription, or AI-generated notes.
- Performance scoring or using bandwidth feelings in capacity math.
- A standup history/reporting page; the data is recorded now so that UI can be designed later.
- Custom participant ordering, guests, multiple teams in one session, or concurrent breakout
  standups.
- A portable prefiltered Jira board URL without an explicitly configured supported mechanism.

## 16. Decisions to confirm before implementation

The plan is executable with the defaults below; confirm them only if product intent differs:

1. **Backlog definition:** default to Jira's To Do/new status category, not every incomplete issue
   in the active sprint.
2. **Recent bandwidth window:** default to the five immediately preceding scheduled workdays,
   including explicit missing-report rows.
3. **Current bandwidth:** retain the existing current-day feeling and optional note in each member
   step.
4. **Jira destination:** provide an exact filtered issue-search link and a separate unfiltered
   active board link unless a supported board quick-filter/template is configured.
