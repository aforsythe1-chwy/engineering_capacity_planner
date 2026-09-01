# Sprint Overview — Planning and Review Durable Implementation Plan

**Status:** In progress — Slice 1 foundation and Sprint Overview shell implemented

**Created:** 2026-08-31

**Last updated:** 2026-08-31 — added holiday-aware capacity/persistence, sprint metadata, and initial Sprint Overview routing/shell

**Working branch:** `plan/sprint-planning-review`

**Scope:** add a peer **Sprint Overview** page with Sprint Review and Sprint Planning workflows,
durable ceremony notes and metric annotations, historical planning/review snapshots, team and epic
analytics, holiday-aware capacity, and a truthful planning-to-outcome comparison

**Intended outcome:** at the boundary between sprints, the team can preserve what it planned,
understand what happened, discuss epic and contributor-level gaps with context, and load the next
sprint without losing shared-capacity or historical truth

**Constraints:** plan only; no Spec Kit/SDD; local single-user SQLite architecture; read-only Jira
integration in the first release; preserve the product constitution's flat navigation, filter-only
epic scope, shared-capacity truth, and future-multi-epic contracts

## 1. Product outcome

Add **Sprint Overview** as one new top-level peer page. Inside it, two compact in-page modes share
the selected team and sprint context:

- **Review** looks back at a sprint using a durable end-state snapshot, compares it with the frozen
  commitment baseline when one exists, breaks outcomes down by epic and current assignee, and
  collects discussion context.
- **Planning** calculates the next sprint's realistic capacity, shows the active portfolio's
  required contribution by epic, lets the user assemble a local sprint commitment from the
  backlog, and freezes that commitment so the later review can compare intent with outcome.

The page should answer these questions without requiring a Jira report, spreadsheet, or a
reconstruction from memory:

1. What did we think this sprint would contain, and how much capacity did we expect to have?
2. What was Done, In Review, In Progress, or To Do at review time?
3. Which epics received the commitment they needed, and where did delivery fall short?
4. How much scope was added or removed after planning?
5. How did each engineer's currently assigned scope compare with that engineer's modeled capacity?
6. What PTO, on-call work, holidays, and temporary velocity changes explain the capacity?
7. What observations or decisions should be visible during the retro?
8. Given the active portfolio and the next sprint's capacity, what should be committed next?

This page is an analytical and local planning surface. It does not score people, write sprint or
assignee changes to Jira, or replace the Gantt Planner's week-level scheduling workflow.

## 2. Relationship to existing plans and features

This is a focused new plan, not a rewrite of
[`sprint-planning-tool-project-plan.md`](./sprint-planning-tool-project-plan.md). That older document
describes the application's original architecture and the already-delivered Gantt/Jira phases; it
does not define a planning ceremony, review history, immutable baselines, or review notes.

This plan builds on the implemented behavior originally specified by
[`engineer-sprint-output-capacity-plan.md`](./engineer-sprint-output-capacity-plan.md): live Jira
status buckets joined to members by account ID and compared with PTO/on-call-adjusted capacity.
That Team view remains useful for an in-progress sprint. Sprint Overview turns the same underlying
facts into a durable, sprint-bound planning/review record and adds epic, commitment, scope-change,
historical, and annotation semantics.

This plan also preserves the navigation and capacity rules in
[`planner-product-constitution.md`](./planner-product-constitution.md). If implementation discovers
that the requested workflow requires an epic drill-down, a second navigation level, or independent
per-epic capacity pools, stop and obtain an explicit product-direction decision before changing the
constitution.

## 3. Verified current behavior and evidence

This section records repository facts, not desired behavior.

### 3.1 Navigation and page scope

- `packages/frontend/src/App.tsx` defines eight peer tabs in one static `tabs` array and renders the
  selected page through `PlannerPage`.
- `packages/frontend/src/lib/router.ts` currently supports `tab`, `epics`, and `team` query state.
  Page changes preserve the epic and team values, and `epics: []` means all active epics.
- `docs/planner-product-constitution.md` requires every primary planning page to work across all
  active epics. An epic selection may narrow or emphasize presentation, but it may not recalculate
  a private capacity pool or hide outside load.
- Team and Standup already use `route.team`; Sprint Overview can use the same stable team context
  without introducing a team hierarchy.

### 3.2 Sprint facts and Jira access

- `Sprint` in `packages/shared/src/domain.ts` contains a stable ID, team ID, name, start date, and end
  date. SQLite persists those fields in `sprint`.
- Jira sync obtains all board sprints through `JiraClient.listSprints(boardId)`. The Jira wire type
  distinguishes `future`, `active`, and `closed`, but the local `Sprint` type and table do not retain
  state, goal, or the board ID that supplied the sprint.
- Reconciliation replaces `DomainDataset.sprints` with the latest imported sprint collection.
- `WorkItem.jiraSprintAssigned` is only a boolean. The local domain does not retain every item's
  authoritative Jira sprint ID or sprint-membership history.
- `planned_placement` stores local week-level planning intent and survives normal sync conflict
  resolution, but completed work is pulled from future placements. It cannot reconstruct completed
  sprint scope later.
- `packages/backend/src/jira/team-sprint-output.ts` selects the active Jira sprint, fetches its
  current issue state, and aggregates it by current Jira assignee. It is live and read-only; it does
  not persist the aggregate.
- `refreshStandupSprintProgress` already provides the pagination, normalized status, points,
  assignee account ID, freshness, truncation, and safe fallback patterns needed by a generalized
  sprint snapshot service.

### 3.3 Capacity and availability

- `TeamMember.baseVelocity` is points per fully available sprint.
- `packages/engine/src/capacity.ts` is the source of truth for per-day and per-sprint capacity.
  PTO sets a person's factor to zero, on-call applies the configured multiplier, and overlapping
  velocity overrides compose multiplicatively on configured working days.
- `EngineerSprintOutput` and the Gantt model already calculate a member's adjusted capacity by
  giving the engine a one-member context.
- No holiday or team-wide capacity-exception domain exists. Global important dates are contextual
  calendar markers and their durable plan explicitly says they do not change capacity. They must
  not silently become holidays.
- Existing portfolio projection code in `packages/engine/src/portfolio.ts` owns shared allocation
  across active epics. Any per-epic sprint target must extend that shared model rather than grant
  each epic the full sprint capacity independently.

### 3.4 Notes, history, and concurrency patterns

- Standup has durable sessions, notes, versioned final JSON snapshots, and optimistic concurrency
  through `revision`/`expectedRevision`.
- Standup notes support global/team and mentioned-member context, but their lifecycle and schema are
  tied to Standup sessions. Reusing the table for sprint ceremonies would couple unrelated
  workflows and target semantics.
- Human-authored availability and bandwidth notes are plain text, length-limited, absent from Jira
  payloads, and included in the shareable local database.
- The backend uses additive, idempotent schema migration in
  `packages/backend/src/db/database.ts`; new tables are naturally safe for existing files.

### 3.5 Frontend design and test seams

- The application uses a compact dark visual system from `packages/frontend/src/styles.css`, with
  `.panel`, `.btn`, `.control`, `.badge`, `.subtabs`, and established status colors.
- `Typeahead` is the shared searchable combobox. It supports local immediate search, a committed
  value, full-list discovery on focus, keyboard navigation, and portal placement.
- `SprintProgressGauge` and `EngineerSprintOutput` already establish Done/In Review/In Progress/To
  Do colors and accessible exact-value summaries.
- The repository uses Vitest across shared/engine/backend/frontend and Playwright for end-to-end and
  visual behavior. Node commands must be preceded by `nvm use` from the repository root.

## 4. Product decisions and invariants

### 4.1 Name and information architecture

Use **Sprint Overview** for the top-level tab. It is broad enough to hold both directions of the
sprint boundary without making one ceremony look subordinate to the other.

Inside the page, use one compact tablist:

```text
Sprint Overview
  [Review] [Planning]
```

These are in-page modes, not primary navigation children. The page header owns the team selector,
while each mode owns its sprint selector and ceremony actions. Do not add separate top-level
Sprint Review and Sprint Planning tabs.

Extend the canonical URL compatibly:

```text
?tab=sprints&team=<team-id>&sprintMode=review|planning&sprint=<sprint-id>&epics=<keys>
```

Rules:

- `tab=sprints` is the primary page.
- `sprintMode` defaults to `review` when absent.
- `sprint` is mode-local context, not an epic scope. Invalid or no-longer-synced IDs are reported
  explicitly and removed from the canonical URL only after the page selects a documented fallback.
- Changing mode, sprint, team, or epic filter keeps the other valid route state.
- Browser reload/back/forward restore the same mode and sprint.
- The routing types remain future-multi-epic-ready; no page contract accepts only one permanent
  epic even though the current picker UI is single-select.

### 4.2 Team and epic scope

Every planning and review record belongs to exactly one team and one sprint. A multi-team sprint
ceremony is not inferred.

The global epic filter affects presentation only:

- all headline totals, capacity, commitment, scope-change, and contributor aggregates continue to
  use the selected team's entire tracked active portfolio and the full sprint issue set;
- when an epic filter is active, its epic row and related notes are emphasized or other rows are
  collapsed, but totals do not change;
- archived epics that participated in a historical snapshot remain visible in that review even if
  they are no longer active or selectable globally;
- cross-epic load and unattributed work remain visible.

### 4.3 Sprint defaults and correction

**Start Review** resolves its default in this order:

1. the active sprint returned by the configured Jira board;
2. a stored sprint containing the effective planning date;
3. the most recently ended stored sprint;
4. no selection, with a clear setup/refresh explanation.

This follows the requested active-sprint default while still making the boundary workflow usable
just after Jira closes a sprint. Before creation, the committed sprint appears as the actual value
of a searchable `Typeahead`. Focusing shows the complete relevant sprint list; typing clears the
prior pending selection until the user chooses an exact result. The user can therefore correct
"Sprint 70" to "Sprint 79" without creating and deleting a mistaken record.

**Start Planning** resolves its default in this order:

1. the earliest future Jira sprint after the active sprint;
2. the active sprint if no future sprint exists;
3. the next stored sprint after the effective planning date;
4. no selection with a clear explanation.

Starting either mode is idempotent for `(team, sprint, kind)`: if a record already exists, open it
instead of creating a duplicate. Changing the sprint after a ceremony contains notes, selected
work, or snapshots is not an edit; the user must return to the launch state and open/start the
correct sprint record.

### 4.4 Facts, intent, and immutable history

Jira owns external facts:

- sprint identity, name, dates, state, and goal;
- issue identity, hierarchy, sprint membership, status, estimate, current assignee, and labels.

The planner owns local intent and history:

- planning record, selected backlog items, ordering, notes, and annotations;
- expected capacity and the availability inputs used to calculate it;
- finalized commitment snapshots and review outcome snapshots;
- the association between a review and the planning baseline it compares with;
- ceremony status and revision.

Do not overwrite a frozen snapshot during Jira sync. Sync may update the current draft source and
available sprint picker options, but historical comparisons always use the exact snapshot versions
named by the record.

### 4.5 Do not fabricate a historical commitment

The current repository cannot reconstruct "what we committed at sprint start" from a closed
sprint because item sprint membership is not historical and local placements drop Done work.

Therefore:

- a finalized Planning snapshot is the authoritative commitment baseline;
- if a review has no finalized baseline, show current/end outcome metrics and the message
  **No planning baseline was captured for this sprint**;
- do not label the current closed-sprint item set "committed";
- committed-versus-delivered, added/removed scope, and planning-versus-actual capacity comparisons
  are unavailable until a baseline exists;
- a user may attach explanatory notes, but cannot manually declare an inferred snapshot
  authoritative in the first release.

This limitation makes historical backfill honest while enabling complete comparisons for sprints
planned in the new workflow.

### 4.6 Ceremony lifecycle and versioning

Use one session concept with a `kind` of `planning` or `review`.

```text
Planning: draft -> finalized
Review:   draft -> completed
```

- A draft may be edited and refreshed.
- Finalizing Planning writes a new immutable planning snapshot version and makes that version the
  record's active baseline.
- A finalized plan can be explicitly reopened. Reopening does not mutate or delete the prior
  snapshot; the next finalize creates a higher version. A Review already linked to a prior version
  keeps that explicit association unless the user deliberately selects a newer baseline while the
  review remains draft.
- Completing Review writes/fixes the final outcome snapshot and makes the review read-only.
- A completed Review is not reopened in the first release. Corrections require a future append-only
  correction workflow rather than silent history mutation.
- Every mutable request supplies `expectedRevision`; stale writes return `409` with reload guidance.
- Finalize/complete operations are transactional and idempotent for the same revision.

### 4.7 Metric definitions

All point metrics use finite, non-negative Jira estimates. Keep unestimated item counts separate;
never turn an absent estimate into zero.

For a review with planning baseline `B` and outcome snapshot `O`:

```text
committed points        = estimated points for items selected in B
committed Done          = committed-item points whose status in O is Done
committed In Review     = committed-item points whose status in O is In Review
committed unfinished    = committed-item points whose status in O is To Do or In Progress
commitment delivery %   = committed Done / committed points
added scope             = outcome sprint items not in B
removed scope           = baseline items no longer in the outcome sprint
observed sprint output  = Done points in O, split into committed and added scope
```

The primary UI calls the last value **observed sprint output**, not exact velocity. Exact velocity
normally means points completed during the sprint; the current Jira contract has no transition
history and current Done status alone cannot prove when an item completed. The page may use the
supporting phrase **velocity signal** but must not claim exact transition-based velocity.

A later slice may add Jira changelog ingestion and a cumulative completed-points chart. Until then,
the review graphs are:

1. an outcome composition bar for Done / In Review / In Progress / To Do;
2. committed versus Done/In Review by epic;
3. planned versus actual capacity/assigned scope by contributor;
4. scope added/removed summary when a baseline exists.

For each epic:

```text
epic committed points = baseline points belonging to that epic
epic delivered points = those committed points that are Done in O
epic review gap        = committed - delivered
```

Also show In Review separately so "20 committed, 10 Done, 5 In Review, 5 unfinished" never becomes
an ambiguous "10 short." When a Jira issue cannot be mapped to a tracked/local epic, include it in
an **Unattributed / outside tracked epics** row rather than dropping it.

### 4.8 Contributor interpretation

Contributor metrics are planning signals, not performance ratings.

- Join Jira work to a member only by stable `jiraAccountId`.
- Attribute outcome items to the current Jira assignee at snapshot time. Copy must say **currently
  assigned sprint work**, not "work completed by."
- Preserve each member's name, Jira account ID, base velocity, adjusted capacity, availability
  explanation, and assigned item facts in the snapshot so later roster edits do not rewrite history.
- Show committed, Done, In Review, In Progress, To Do, and adjusted capacity without a red/green
  performance verdict or leaderboard.
- A member with no Jira link still receives a capacity row with a linkage warning.
- Unassigned, inactive, unknown, and outside-team assignees remain in explicit unattributed totals.
- Capacity above or below observed output is discussion context; it is not evidence of individual
  effectiveness because collaboration, reassignment, carryover, review wait time, and unestimated
  work are not captured as personal contribution.

### 4.9 Holiday semantics

The recurring rule, Calendar management, list-view, migration, and observance details are governed
by [`recurring-team-holiday-calendar-management-plan.md`](./recurring-team-holiday-calendar-management-plan.md).
That focused plan supersedes the exact-date `TeamHoliday` shape below while preserving this plan's
team-wide zero-capacity and no-double-subtraction invariants.

Add a first-class `TeamHoliday`; do not reinterpret global important dates.

```ts
interface TeamHoliday {
  id: string;
  teamId: string;
  date: IsoDate;
  name: string;
}
```

For a configured working day, a holiday sets the whole team's capacity to zero before member PTO,
on-call, and velocity factors are applied. It has no effect on a configured non-working day. If a
member has PTO on a holiday, the capacity calculation loses that day's capacity once; explanation
may show both facts but must not double-subtract them.

Holiday CRUD belongs with team availability data and is reused by Sprint Planning. Planning may
offer a compact **Manage availability** link or modal using shared controls, but it must not create a
second divergent holiday store.

### 4.10 "Required to stay green" planning target

For each timeline epic with a gating date, compute the smallest contribution that must be completed
within the selected sprint for the epic to retain its configured Green buffer after the sprint,
while honoring the whole portfolio's priorities and capacity reservations.

The implementation contract is a pure engine selector, conceptually:

```ts
buildSprintPlanningOutlook(dataset, sprintId, selectedItemKeys): {
  capacity: TeamAndMemberCapacity;
  portfolio: {
    availablePoints: number;
    selectedPoints: number;
    requiredPoints: number;
    feasible: boolean;
  };
  epics: Array<{
    epicKey: string;
    requiredPointsThisSprint: number | null;
    selectedPoints: number;
    gapPoints: number | null;
    projectedHealthAfterPlan: PortfolioHealth;
    reason: string;
  }>;
}
```

Required points must be derived from one shared allocation pass or a deterministic optimization
over the shared scheduler. Do not independently ask how much each epic could consume from the full
team. The sum may exceed available sprint capacity; that is a legitimate **portfolio infeasible**
result and must remain visible rather than scaling targets down until they look achievable.

Specific rules:

- Green means the existing configured `greenMinBufferDays`, not merely finishing on the gating date.
- Ongoing placed/reserved work consumes shared capacity before timeline targets, consistent with
  the portfolio model.
- Unestimated remaining work, missing target dates, dependency cycles, or an insufficient planning
  horizon produce `null` targets with actionable reasons, never zero/Green.
- Selected sprint-plan items form the scenario used for projected health.
- The selected global epic filter may emphasize rows but does not change the outlook input.
- Pure engine tests must prove monotonicity where applicable: adding Done-equivalent planned points
  cannot worsen the same epic solely because of the target calculation, while contention may still
  change other epics through the shared portfolio.

The exact search/optimization algorithm should be chosen during the engine slice after profiling
current portfolio inputs. A bounded binary search over continuous point contribution is acceptable
only if it preserves the existing allocator's priority and dependency semantics; otherwise extend
the allocator to expose its per-sprint allocation requirement directly.

## 5. Target user experience

### 5.1 Page shell and launch state

The Sprint Overview page starts with:

- page title and short description;
- team selector when more than one team exists;
- Review / Planning in-page tabs;
- concise context that totals cover the whole team's tracked portfolio even when an epic is
  filtered;
- a launch/open panel when the selected team and sprint have no record.

The launch panel uses the shared `Typeahead` configured for local immediate sprint search:

- committed selection shown as the field value;
- search icon or explicit **Search sprints** placeholder;
- sprint name as label and date range/state as hint;
- full relevant list on focus;
- active/future/closed badges in results without color-only meaning;
- one primary action, **Start Review** or **Start Planning**.

Loading, no-board, no-sprint, Jira-unavailable, stored-fallback, and read-only bundled-data states
are explicit. Starting a record never depends on the global epic selection.

### 5.2 Sprint Planning mode

Once opened, Planning contains these sections in order.

#### Planning header

- sprint name, dates, Jira state/freshness, and record status;
- latest finalized snapshot version/time when present;
- Refresh source, Reopen, Finalize Planning, and Open in Gantt actions as applicable;
- clear copy that changes are local and do not update Jira.

#### Capacity summary

Show:

- baseline team velocity;
- holiday-adjusted capacity;
- final capacity after PTO, on-call, and velocity overrides;
- selected commitment points and remaining headroom/overage;
- one compact member breakdown with exact baseline, adjusted value, and factor badges;
- holiday rows that explain every zeroed working day.

Use status color only for genuine portfolio capacity states. Exact points and explanation text must
remain visible without color.

#### Epic outlook

One row per tracked active epic, plus unattributed ongoing work where needed:

- required points this sprint to stay Green;
- currently selected points;
- gap or surplus;
- projected post-plan health and concise reason;
- gating date and relevant Green buffer;
- unestimated/missing-target warnings.

When an epic filter is active, expand/emphasize that row while retaining the full portfolio summary
and compact context for other epics.

#### Backlog and sprint commitment

Use a focused two-pane/list workflow rather than duplicating the Gantt canvas:

- **Portfolio backlog** contains eligible non-Done work not selected for this plan, grouped by epic
  and ordered by portfolio priority, dependencies, Jira rank when available, then stable key.
- **Sprint commitment** contains the local selected set, grouped by epic, with points, assignee,
  status, estimate warning, and optional Gantt placement state.
- Search/filter controls may narrow visible candidates but cannot change capacity totals invisibly.
- Add/remove actions are keyboard-operable and immediately recompute capacity and epic outlook.
- Multi-item bulk selection may follow after the single-item loop is correct.
- Existing `planned_placement` data is displayed as weekly scheduling context. Selecting an item for
  the sprint does not invent a week placement; weekly refinement remains in Gantt.
- Finalize snapshots the exact selected items and capacity basis. Later Gantt or Jira changes do
  not rewrite that baseline.

#### Planning notes

Show global Planning notes and annotations attached to capacity, an epic target/gap, or a member
capacity row. Notes are visually secondary to the numbers but immediately reachable from the
annotated datum.

### 5.3 Sprint Review mode

#### Review header

- sprint identity, dates, Jira state/freshness, record status, outcome snapshot time, and baseline
  version/time when one exists;
- Refresh outcome while draft and Complete Review actions;
- a warning when Jira results are unavailable, stale, or truncated;
- a clear no-baseline state that disables only comparison metrics, not the entire review.

#### Review summary

Show exact KPI values for:

- observed Done points;
- In Review points;
- unfinished points and item count;
- unestimated items;
- commitment delivery percentage when a baseline exists;
- added/removed scope when a baseline exists.

The outcome composition graph reuses established status colors and provides an accessible text
summary. Truncated data suppresses percentages and comparison verdicts.

#### Epic delivery

Render a compact grouped horizontal bar or equivalent comparison for each epic:

- committed points as the reference;
- Done and In Review as separately visible portions;
- unfinished and removed portions called out in text;
- added scope disclosed rather than counted as original commitment;
- a clear gap statement such as **20 committed · 10 Done · 5 In Review · 5 unfinished**.

Rows must remain usable for archived snapshot epics and unknown/outside-tracked work.

#### Contributor view

Show active-at-snapshot members in a sortable but non-ranked table/list:

- committed assigned points when a baseline exists;
- Done, In Review, In Progress, and To Do for currently assigned outcome work;
- baseline and adjusted capacity;
- PTO, holiday, on-call, and override explanation;
- Jira linkage and unattributed warnings.

Default order is stable roster/name order. Sorting is an analytical control, not a leaderboard, and
no "best/worst" language or performance color is used.

#### Retro context

The bottom section gathers:

- Review global notes;
- Review metric/epic/member annotations;
- Planning notes and annotations from the linked baseline, with **From planning** source labels;
- each annotation's durable target label and captured metric value/context.

This is the first-release retro display. It does not create a third ceremony or action-item tracker.

### 5.4 Visual and accessibility contract

- Extend existing tokens, compact geometry, panels, controls, badges, and status colors; do not add
  a visually unrelated dashboard theme or many nested boxed cards.
- Use SVG or CSS-based bars with semantic summaries rather than adding a chart library solely for
  these simple comparisons.
- Every chart has exact text values and a useful accessible name/description.
- Status is never color-only. Preserve visible keyboard focus and native button semantics.
- Review and Planning in-page tabs use `tablist`/`tab`/`tabpanel`; sprint search uses the shared
  combobox; note targets are announced in their controls.
- On narrow screens, summary metrics wrap, comparison bars retain labels, and backlog/commitment
  panes stack without horizontal page scrolling.
- Test empty, populated, loading, unavailable, stale, truncated, zero-capacity, over-capacity,
  missing-baseline, read-only, and completed states at desktop and about 390px width.

## 6. Domain and persistence design

Use focused tables outside `DomainDataset` for ceremony history, as Standup does. Jira dataset
replacement must never clear these records.

### 6.1 Sprint metadata additions

Extend `Sprint` and `sprint` additively:

```ts
interface Sprint {
  id: string;
  teamId: string;
  name: string;
  startDate: IsoDate;
  endDate: IsoDate;
  state?: 'future' | 'active' | 'closed' | null;
  goal?: string | null;
  originBoardId?: string | null;
}
```

Existing rows migrate with null metadata. Mapper, persistence, reconciliation, fixture export, and
snapshot/import tests must preserve it. State is orientation/defaulting metadata; if Jira is
unavailable, date-based fallback remains explicit and is not persisted as an invented Jira state.

### 6.2 Holidays

Add `team_holiday` with:

```text
id        TEXT PRIMARY KEY
team_id   TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE
date      TEXT NOT NULL
name      TEXT NOT NULL
UNIQUE(team_id, date, name)
```

Add `TeamHoliday[]` to `DomainDataset` because holidays are active capacity inputs used by all
projection surfaces. Update write/read persistence, reconciliation's local-intent preservation,
fixtures, database snapshot/import counts, and configuration APIs.

### 6.3 Ceremony record

Add `sprint_ceremony`:

```text
id                       TEXT PRIMARY KEY
team_id                  TEXT NOT NULL REFERENCES team(id) ON DELETE RESTRICT
sprint_id                TEXT NOT NULL
sprint_name              TEXT NOT NULL
sprint_start_date        TEXT NOT NULL
sprint_end_date          TEXT NOT NULL
kind                     TEXT NOT NULL CHECK(kind IN ('planning', 'review'))
status                   TEXT NOT NULL CHECK(status IN ('draft', 'finalized', 'completed'))
revision                 INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
active_snapshot_id       TEXT
comparison_snapshot_id   TEXT
created_at               TEXT NOT NULL
updated_at               TEXT NOT NULL
finalized_at             TEXT
UNIQUE(team_id, sprint_id, kind)
```

Store sprint name and dates as identity snapshots even if the synced sprint later disappears.
Validate status/kind combinations in the repository: Planning may be draft/finalized; Review may be
draft/completed. Avoid a hard foreign key from historical `sprint_id` to the mutable sync-owned
`sprint` table so reconciliation cannot strand or delete a ceremony. `active_snapshot_id` and
`comparison_snapshot_id` are repository-validated relationships to the snapshot table; fresh
schema may use deferred foreign keys if creation order remains straightforward.

### 6.4 Draft planning selection

Add `sprint_plan_item`:

```text
ceremony_id   TEXT NOT NULL REFERENCES sprint_ceremony(id) ON DELETE CASCADE
work_item_key TEXT NOT NULL
position      INTEGER NOT NULL CHECK(position >= 0)
added_at      TEXT NOT NULL
PRIMARY KEY(ceremony_id, work_item_key)
UNIQUE(ceremony_id, position)
```

Repository validation requires a draft Planning ceremony and a current work item belonging to the
ceremony's team. Deliberately avoid a database foreign key to `work_item`: sync may archive/remove a
current fact before Planning is finalized. The API reports missing items and requires explicit
removal or a refreshed source before finalization; it never silently drops them.

This table is sprint-level intent and is separate from `planned_placement`, which remains week-level
Gantt intent. A later integration can help populate one from the other, but neither is silently
treated as the other.

### 6.5 Immutable snapshots

Add `sprint_ceremony_snapshot`:

```text
id             TEXT PRIMARY KEY
ceremony_id    TEXT NOT NULL REFERENCES sprint_ceremony(id) ON DELETE RESTRICT
version        INTEGER NOT NULL CHECK(version > 0)
purpose        TEXT NOT NULL CHECK(purpose IN ('planning-baseline', 'review-outcome'))
schema_version INTEGER NOT NULL
captured_at    TEXT NOT NULL
source         TEXT NOT NULL CHECK(source IN ('jira', 'stored', 'mixed'))
freshness      TEXT NOT NULL CHECK(freshness IN ('fresh', 'stale', 'unavailable'))
truncated      INTEGER NOT NULL CHECK(truncated IN (0, 1))
payload_json   TEXT NOT NULL
UNIQUE(ceremony_id, version)
```

Payload schema version 1 contains enough raw facts to recompute presentation aggregates:

```ts
interface SprintCeremonySnapshotV1 {
  schemaVersion: 1;
  sprint: { id: string; name: string; startDate: IsoDate; endDate: IsoDate };
  capturedAt: string;
  source: 'jira' | 'stored' | 'mixed';
  freshness: 'fresh' | 'stale' | 'unavailable';
  truncated: boolean;
  capacity: {
    teamBaseVelocity: number;
    adjustedCapacity: number;
    workingDays: IsoDate[];
    holidays: Array<{ date: IsoDate; name: string }>;
    members: SnapshotMemberCapacity[];
    oncallMultiplier: number;
  };
  epics: Array<{ key: string; title: string; activeAtCapture: boolean }>;
  items: Array<{
    key: string;
    title: string;
    epicKey: string | null;
    points: number | null;
    status: WorkItemStatus;
    assigneeAccountId: string | null;
    assigneeMemberId: string | null;
    inSprint: boolean;
    selectedInPlan: boolean;
  }>;
}
```

The implementation may omit item titles if the UI does not display them; minimizing copied Jira
text is preferable. Stable keys, epic/member labels, points, status, and attribution facts are
required. Store raw snapshot inputs rather than only derived totals so metric fixes can be applied
without rewriting history. Snapshot parsing must reject/mark unsupported versions safely.

### 6.6 Notes and data-point annotations

Add `sprint_ceremony_note`:

```text
id                TEXT PRIMARY KEY
ceremony_id       TEXT NOT NULL REFERENCES sprint_ceremony(id) ON DELETE CASCADE
body              TEXT NOT NULL
target_kind       TEXT NOT NULL CHECK(target_kind IN ('global', 'metric', 'epic', 'member'))
target_key        TEXT
target_label      TEXT NOT NULL
target_value_json TEXT
position          INTEGER NOT NULL CHECK(position >= 0)
created_at        TEXT NOT NULL
updated_at        TEXT NOT NULL
```

Use stable enumerated metric keys such as `review.unfinished`, `review.output`,
`planning.capacity`, and composed entity keys such as `epic:<key>:delivery-gap` or
`member:<id>:capacity-gap`. The server validates allowed target formats for the ceremony kind.

`target_label` and optional small `target_value_json` snapshot the visible context at note creation,
so a later refresh can say what the note originally described. Do not store an arbitrary frontend
DOM path or execute/interpret note content. Note bodies are trimmed plain text, 1–4,000 characters,
rendered as text, and never sent to Jira or written to request/debug logs.

## 7. Service and API contracts

### 7.1 Generalized sprint source service

Refactor the narrow active-sprint code into a backend service, for example:

```text
packages/backend/src/jira/sprint-context.ts
```

Responsibilities:

- resolve configured board/project/points fields through existing safe settings helpers;
- list and classify board sprints;
- fetch all non-Epic items for a specified sprint ID with deterministic pagination and a documented
  safety cap;
- retain issue key, normalized status, estimate, current assignee account ID, and enough parent data
  to map the issue to a local epic;
- report source/freshness/truncation/errors without throwing away locally calculable capacity;
- coalesce concurrent requests by `(teamId, sprintId)`;
- support active, future, and closed sprints rather than hard-coding `state === 'active'`;
- remain read-only.

`team-sprint-output.ts` and Standup sprint progress should call or share its lower-level pagination
and mapping helpers so status semantics do not diverge across three features.

Do not log Jira response bodies, issue titles, assignee details, or note bodies. Keep request-cache
behavior consistent with the existing Jira client. A manual Refresh may use normal cache semantics
unless the application introduces one documented cache-bypass policy for all Jira views.

### 7.2 Ceremony endpoints

Suggested REST surface:

```http
GET  /api/teams/:teamId/sprints?mode=review|planning&query=
GET  /api/teams/:teamId/sprint-ceremonies?kind=planning|review
POST /api/sprint-ceremonies/open
GET  /api/sprint-ceremonies/:ceremonyId
POST /api/sprint-ceremonies/:ceremonyId/refresh
POST /api/sprint-ceremonies/:ceremonyId/finalize
POST /api/sprint-ceremonies/:ceremonyId/reopen

PUT    /api/sprint-ceremonies/:ceremonyId/plan-items/:workItemKey
DELETE /api/sprint-ceremonies/:ceremonyId/plan-items/:workItemKey
PUT    /api/sprint-ceremonies/:ceremonyId/plan-items/order

POST   /api/sprint-ceremonies/:ceremonyId/notes
PUT    /api/sprint-ceremonies/:ceremonyId/notes/:noteId
DELETE /api/sprint-ceremonies/:ceremonyId/notes/:noteId
PUT    /api/sprint-ceremonies/:ceremonyId/notes/order
```

`POST /open` accepts `{ teamId, sprintId, kind }`, resolves the sprint before mutation, snapshots
its identity fields, and returns the existing record on unique conflict. It must not accept sprint
name/dates as client authority.

The aggregate GET returns:

- ceremony identity/status/revision;
- sprint source metadata and source availability;
- draft plan selection for Planning;
- active and comparison snapshot summaries;
- capacity and planning/review view models derived on the server or pure shared functions;
- notes with source ceremony context;
- actionable warnings and feature availability flags.

All mutations validate `expectedRevision`. Add/remove/reorder is transactional and returns the full
fresh aggregate, following the useful Standup pattern.

### 7.3 Refresh/finalize behavior

For Planning:

- Refresh obtains current sprint/backlog facts and recalculates capacity/outlook but does not create
  an immutable snapshot.
- Finalize requires fresh, complete Jira results; valid sprint dates; a calculable capacity basis;
  no unresolved missing plan items; and explicit acknowledgment of unestimated selected work.
- Finalize writes the planning snapshot and status change atomically.

For Review:

- Opening links the latest finalized Planning snapshot for the same `(team, sprint)` when present.
- Refresh obtains a new draft outcome context. If Jira fails and a prior draft snapshot exists,
  return it as stale with the new error; do not present it as fresh.
- Complete requires a non-truncated, non-unavailable outcome. It writes/activates the final review
  snapshot and freezes the record atomically.
- A review may be completed while Jira still calls the sprint active, but the UI requires explicit
  confirmation that the snapshot is early. The record stores that source state for later context.

### 7.4 Holiday endpoints

Add standard validated CRUD under the team:

```http
GET    /api/teams/:teamId/holidays?start=&end=
POST   /api/teams/:teamId/holidays
PUT    /api/teams/:teamId/holidays/:holidayId
DELETE /api/teams/:teamId/holidays/:holidayId
```

Validate real ISO dates, team existence, a trimmed 1–160 character name, known fields only, and
deterministic ordering by date/name/ID. Reuse the same data from Team Availability, Sprint Planning,
Gantt, Overview, and all projection/capacity calls.

## 8. Capacity and analytics implementation

### 8.1 Extend one capacity source of truth

Add holidays to `CapacityInputs`/`CapacityContext` in `packages/engine/src/capacity.ts` and implement
the zero-team-capacity rule there. Then update every context builder. Do not adjust only Sprint
Planning, because doing so would make Overview/Gantt disagree with the planning baseline.

Add pure helpers for:

- team and per-member sprint capacity breakdown with baseline and reduction explanations;
- deduplicated holiday/PTO overlap handling;
- stable rounding for display only (retain full precision for calculations);
- zero working-day and zero-capacity states.

### 8.2 Pure review aggregation

Create a pure module in shared or engine according to dependency needs, for example:

```text
packages/shared/src/sprint-review.ts
```

It accepts an optional planning snapshot and one review snapshot and returns:

- status bucket totals and unestimated counts;
- committed/added/removed item sets;
- committed delivery metrics;
- epic comparison rows, including archived and unattributed groups;
- member rows and unattributed totals;
- warnings/availability flags when a baseline, estimate, attribution, or complete result is absent.

Keep display ordering and formatting in the frontend. Keep metric definitions and set comparison in
the pure function so backend/frontend cannot disagree.

### 8.3 Pure planning outlook

Add the shared-capacity planning outlook to `packages/engine`, reusing portfolio projection inputs,
health definitions, ongoing reservations, and deterministic ordering. Tests must cover:

- one and several competing epics;
- total required load above available capacity;
- Green/Yellow/Red thresholds at exact boundaries;
- ongoing reservations;
- holidays and all member availability combinations;
- unestimated work and missing targets;
- dependencies and stable ordering;
- an active epic filter not being part of the calculation input.

## 9. Ordered implementation slices

Keep this section current during implementation. A slice is complete only when its focused tests
pass and the continuation section names the next exact action.

### Slice 1 — Shared contracts, sprint metadata, and holidays

**Files/subsystems:**

- `packages/shared/src/domain.ts`, exports, dates/settings as needed;
- `packages/backend/src/db/schema.ts`, `database.ts`, `persist.ts`, `reconcile.ts`;
- Jira types/mapper/importer and fixtures;
- capacity engine and focused tests;
- backend holiday repository/routes and frontend API;
- Team Availability/configuration surface for shared holiday CRUD.

**Work:**

1. Add optional sprint state/goal/board metadata and round-trip it through sync and persistence.
2. Add `TeamHoliday`, local-intent reconciliation, CRUD, and fixture/snapshot support.
3. Extend capacity math once so all existing views include holiday effects.
4. Add regression tests proving no double subtraction and unchanged results when no holidays exist.

**Exit:** a holiday changes every relevant capacity surface through the same engine, and sprint
pickers have trustworthy active/future/closed metadata.

### Slice 2 — Ceremony persistence and optimistic-concurrency API

**Files/subsystems:**

- new ceremony tables/migrations;
- new `packages/backend/src/db/sprint-ceremony.ts`;
- new `packages/backend/src/routes/sprint-ceremony.ts` registered in `server.ts`;
- shared ceremony/snapshot/note contracts;
- repository and API tests.

**Work:**

1. Implement idempotent open/list/get for Planning and Review.
2. Implement draft plan selections, ordering, notes/annotations, revision checks, and lifecycle
   validation.
3. Implement immutable versioned snapshot storage and parsing without Jira integration yet.
4. Prove sync/dataset replacement and database snapshot/import do not erase ceremony history.

**Exit:** local tests can open one record per team/sprint/kind, survive stale writes safely, preserve
notes and plan items, and retain immutable versions.

### Slice 3 — Generalized sprint context and snapshot builder

**Files/subsystems:**

- refactor/new `packages/backend/src/jira/sprint-context.ts`;
- `team-sprint-output.ts`, Standup context helpers, Jira client/fake client/tests;
- snapshot capacity/epic/member mapping builder.

**Work:**

1. Fetch any specified sprint with complete pagination and normalized status/points/assignee fields.
2. Map issues to epic and member with explicit unattributed buckets.
3. Build schema-versioned Planning/Review snapshot payloads with capacity basis.
4. Add freshness, stale fallback, truncation, missing-field, and no-Jira behavior.

**Exit:** a future, active, or closed sprint can produce a truthful snapshot candidate, while the
existing Team and Standup views retain compatible status semantics.

### Slice 4 — Sprint Overview shell and durable routing

**Files/subsystems:**

- `packages/frontend/src/App.tsx`, `lib/router.ts`, router tests;
- new `components/SprintOverviewPage.tsx` and focused child components;
- `data/api.ts`, `styles.css`, Playwright navigation coverage.

**Work:**

1. Register the peer **Sprint Overview** tab and route state.
2. Add Review/Planning tabs, team selector, source messages, and launch/open state.
3. Build the local searchable sprint picker with correct committed-value and keyboard behavior.
4. Preserve epic/team/sprint/mode state through navigation, reload, back, and forward.

**Exit:** users can discover the page and idempotently start/open the correct sprint record without
any metric UI or violation of flat navigation.

### Slice 5 — Planning outlook and commitment workflow

**Files/subsystems:**

- `packages/engine/src/portfolio.ts` or focused new sprint-planning module/tests;
- ceremony refresh/finalize backend orchestration;
- Planning capacity, epic outlook, backlog, commitment, and notes components;
- focused frontend models/tests and E2E.

**Work:**

1. Implement holiday-aware team/member capacity breakdown.
2. Implement the shared-portfolio required-to-stay-Green calculation.
3. Assemble/remove/reorder draft plan items and recompute outlook immediately.
4. Show Gantt placement context and link to Gantt without inventing week placements.
5. Finalize an immutable planning baseline with unestimated/missing-item guards.

**Exit:** a user can assemble and freeze a capacity-aware next-sprint plan, including global and
data-point notes, and the snapshot is suitable for later comparison.

### Slice 6 — Review aggregation, epic graphs, and contributor metrics

**Files/subsystems:**

- pure sprint-review aggregator/tests;
- Review refresh/complete orchestration;
- summary graph, epic comparison, contributor view, and accessibility tests;
- backend integration and Playwright coverage.

**Work:**

1. Link the correct finalized planning snapshot or expose the no-baseline state.
2. Calculate status, commitment, scope-change, epic, and contributor results.
3. Render exact metrics and accessible simple graphs.
4. Refresh draft outcomes and freeze a complete review snapshot.

**Exit:** a review can truthfully explain the sprint and freeze its outcome without calling
current-state data a historical commitment or personal contribution.

### Slice 7 — Retro context, lifecycle polish, and hardening

**Files/subsystems:**

- combined Planning/Review note presentation;
- route/backend failure and concurrency tests;
- database import/export, synthetic fixture, visual, and full regression coverage;
- README/help copy if needed.

**Work:**

1. Gather linked Planning notes and Review annotations with durable source/target labels.
2. Finish finalized/read-only/reopen, stale-data, truncated, and early-active-sprint messaging.
3. Audit logging/privacy, schema upgrade, sync survival, and all constitution checks.
4. Complete desktop/narrow, keyboard, empty/error, and visual QA.

**Exit:** the complete planning-to-review-to-retro loop is durable, accessible, recoverable, and
truthful under failure and historical changes.

### Deferred Slice 8 — Exact velocity timeline from Jira history

Only pursue this after the snapshot-based workflow is established and the value justifies the API
cost.

- Add a bounded/cached Jira changelog seam for status and sprint-field transitions.
- Define exact completion/reopen semantics and timezone boundaries.
- Build cumulative completed-points and scope-change-over-time graphs.
- Backfill only when Jira history is complete; otherwise retain partial-history warnings.

Do not block the requested review summary, epic gaps, planning comparison, or contributor context
on this deferred enhancement.

## 10. Failure, concurrency, migration, security, and observability

### 10.1 Failure and partial data

- Jira unavailable: retain local ceremony/notes/capacity and the last snapshot; mark it stale or
  unavailable and disable finalization/completion when the source is incomplete.
- Truncated Jira result: show partial raw counts if useful, but suppress percentages, gaps, and
  completion actions that imply completeness.
- Missing points field: show item counts and explicit unavailable point metrics; do not substitute
  zero.
- Missing sprint dates: allow record discovery but block capacity/final snapshot until dates are
  supplied by matching stored metadata or Jira.
- Missing baseline: preserve outcome-only review and disable only baseline comparisons.
- Sync removes a draft selected item: show a missing-item row and require resolution; never silently
  mutate the plan.
- Unsupported snapshot schema: show a safe read error with snapshot ID/version; never reinterpret
  unknown JSON.
- Zero capacity: show exact zero and its factors; do not divide or render infinity/NaN.

### 10.2 Concurrency and idempotency

- Unique `(team_id, sprint_id, kind)` plus transactional open prevents duplicates.
- Revision checks protect plan selection, note mutations, reopen/finalize, and review completion.
- In-flight refreshes coalesce by ceremony/sprint; a slower prior response must not replace a newer
  revision in frontend state.
- Snapshot version numbers are allocated inside the finalization transaction.
- Repeated finalization with the already-consumed revision returns the resulting aggregate or a
  clear conflict, never a second semantic version accidentally.

### 10.3 Migration and recovery

- New tables use `CREATE TABLE IF NOT EXISTS`; optional sprint columns use `ensureColumn`.
- Existing data requires no fabricated ceremony backfill.
- Existing stored sprints receive null metadata and remain selectable by dates.
- Add migration tests using an older-schema database fixture, not only fresh in-memory databases.
- Ceremony tables and holidays must survive SQLite snapshot/import. Document that the shareable DB
  contains sprint notes and historical issue/account identifiers.
- No destructive migration or automatic deletion of historical ceremonies is part of this work.

### 10.4 Security and privacy

- Jira credentials stay in environment configuration and never enter snapshots or notes.
- Note bodies and raw Jira payloads are not logged, placed in URLs, sent to Jira, or emitted in sync
  change details.
- Render all user/Jira text as plain React text; links use validated existing Jira URL helpers and
  safe `rel="noreferrer"` behavior.
- Snapshots should store only fields required for analytics. Prefer stable identifiers and snapshot
  labels over unnecessary Jira descriptions/comments.
- The app is currently local/single-user. If hosted/multi-user behavior is introduced, ceremonies
  and contributor history require authorization, retention, deletion, and audit design before
  deployment.
- The UI explicitly frames contributor data as planning context, not evaluation.

### 10.5 Observability

Keep operational telemetry local and non-sensitive:

- refresh duration and result state (`fresh/stale/unavailable`);
- issue count, truncation flag, snapshot ID/version, and ceremony state transition;
- API status/error category without issue titles, assignee names, account IDs, or note bodies;
- a concise user-visible captured-at/source indicator on every snapshot-based view.

Do not add an external telemetry service in this scope.

## 11. Verification strategy

### 11.1 Automated verification

Before every Node/npm/npx command:

```bash
nvm use
```

Focused tests by slice:

```bash
npm run test --workspace @ecp/shared
npm run test --workspace @ecp/engine
npm run test --workspace @ecp/backend
npm run test --workspace @ecp/frontend
npm run typecheck
npm run build
npm run e2e --workspace @ecp/frontend -- --grep "Sprint Overview|Sprint Review|Sprint Planning"
```

Required coverage includes:

- route parse/serialize/default/legacy behavior for `tab=sprints`, mode, sprint, team, and epics;
- active/future/closed sprint default resolution and searchable override;
- idempotent open, unique records, invalid sprint/team, revision conflicts, lifecycle guards;
- snapshot immutability/versioning and explicit comparison-version linkage;
- schema migration, database snapshot/import, and Jira sync survival;
- holiday/no-holiday capacity, weekend holiday, PTO overlap, on-call, overrides, zero capacity;
- shared-portfolio target math and filter independence;
- plan-item add/remove/reorder/missing-after-sync and finalization guards;
- no-baseline, added/removed scope, unestimated, archived epic, unknown epic, and unattributed member;
- current-assignee account-ID joining and no display-name fallback;
- stale/unavailable/truncated Jira behavior and concurrent refresh coalescing;
- note length/target validation, plain-text preservation, ordering, and no note leakage in logs;
- accessible chart summaries, tabs, picker, focus return, narrow layout, and read-only completed state;
- existing Team Sprint output, Standup progress, Gantt, Overview, and portfolio projections remain
  correct after shared Jira/capacity refactors.

### 11.2 Manual validation

1. Open Sprint Overview with no epic filter. Confirm Review is selected, the active sprint appears
   as the committed searchable value, and choosing a different sprint works with keyboard only.
2. Start Planning for the next sprint. Add a holiday, one member's PTO, another member's on-call
   range, and a velocity override. Confirm baseline and adjusted capacity explanations match hand
   calculation and the holiday is reflected in Overview/Gantt too.
3. Add backlog work from at least two epics. Confirm total selection, epic gaps, portfolio
   feasibility, and projected health recompute while all active portfolio load remains included.
4. Apply the global epic filter. Confirm the chosen row is emphasized but capacity, total selected
   points, contributor totals, and other-work context do not change.
5. Add a global Planning note plus annotations on capacity, one epic gap, and one member. Finalize
   the plan and record its snapshot version/time.
6. Change Jira/local current facts and Gantt placements. Reopen the finalized plan or inspect it and
   confirm the prior snapshot remains unchanged; finalize a new version and verify history linkage.
7. Start Review for the same sprint. Confirm it links the intended planning version, then verify
   Done/In Review/unfinished, added/removed scope, epic gaps, and contributor current-assignee rows
   against controlled Jira fixture data.
8. Start a Review for an older sprint with no Planning record. Confirm outcome metrics work while
   commitment comparison is clearly unavailable and never inferred.
9. Add Review notes/annotations and inspect Retro context. Confirm Planning notes carry source labels
   and each annotation retains the target label/value captured when written.
10. Force Jira failure, truncated data, missing points mapping, a removed selected item, zero
    capacity, unestimated work, an inactive/unknown assignee, and a stale revision conflict. Confirm
    none becomes a false zero, Green state, or silent data loss.
11. Complete the Review. Confirm it is read-only after reload and remains intact after a Jira sync,
    database snapshot, and restore.
12. At desktop and 390px widths, inspect launch, populated, empty, loading, stale, error,
    over-capacity, no-baseline, finalized, and completed states. Complete all main paths using only
    the keyboard and verify visible focus and accessible summaries.

## 12. Acceptance criteria

- **Sprint Overview** is a peer top-level page with Review and Planning as in-page modes, not a
  nested application or epic drill-down.
- Canonical URLs preserve page, mode, sprint, team, and epic filter independently across reload,
  back, forward, and page changes.
- Start Review defaults to the active Jira sprint with documented fallbacks and allows a searchable
  correction before creation; Start Planning defaults to the next future sprint when available.
- A team/sprint has at most one Planning and one Review record; open is idempotent and mutable writes
  are revision-protected.
- Planning calculates baseline and adjusted capacity from the existing velocity, working-day, PTO,
  on-call, and velocity-override rules plus first-class holidays, through one shared engine.
- All existing capacity-aware views adopt the same holiday semantics; global important dates remain
  contextual and do not change capacity.
- Planning shows the full active portfolio's required contribution by epic and never grants each
  epic an independent full capacity pool; infeasible total demand remains visible.
- Users can assemble a local sprint commitment from multi-epic backlog work, see Gantt placement
  context, annotate it, and finalize an immutable versioned baseline without writing Jira.
- Review freezes a complete Jira outcome snapshot and shows exact Done, In Review, In Progress/To
  Do, unestimated, added/removed scope, and commitment-delivery metrics where supported.
- Epic rows truthfully distinguish committed, Done, In Review, unfinished, removed, and added scope,
  including archived and unattributed work.
- Contributor rows join by stable Jira account ID, compare currently assigned scope/output status
  with snapshot capacity, disclose missing/unattributed data, and avoid performance scores,
  rankings, or claims about who personally completed work.
- A review without a Planning baseline remains useful but never fabricates committed points, scope
  churn, or planning-versus-outcome comparison.
- Global notes and metric/epic/member annotations round-trip as plain text, retain durable target
  context, remain absent from Jira/logs/URLs, and are gathered with linked Planning notes for retro.
- Frozen snapshots and completed reviews survive Jira sync, roster/epic changes, application reload,
  SQLite snapshot/import, and supported schema upgrades.
- Missing, stale, unavailable, truncated, zero-capacity, unestimated, unsupported-version, and
  concurrency states are explicit and cannot masquerade as complete or Green results.
- Shared, engine, backend, frontend, typecheck, build, focused E2E, desktop/narrow visual, keyboard,
  and product-constitution regression checks pass.

## 13. Explicit non-goals for the first release

- Writing Jira sprint membership, rank, status, estimate, or assignee changes.
- Replacing the Gantt Planner's week-level drag/scheduling canvas.
- Exact transition-history velocity, burndown/burnup, or scope-change timeline without Jira
  changelog support.
- Claiming historical authorship of completed work or building an employee performance score,
  leaderboard, alert, or recommendation.
- Automatically recalibrating base velocity from contributor output.
- A separate Retro ceremony, voting, facilitation timer, action-item tracker, or Jira issue creation
  from notes.
- Multi-team ceremonies or cross-board sprint normalization.
- Hosted real-time collaboration, external notifications, export to slides/docs, or external
  telemetry.
- Manual backfill that labels an inferred closed-sprint item set as the original commitment.
- Probabilistic/Monte Carlo capacity or delivery forecasts.

## 14. Assumptions and unresolved decisions

### Accepted implementation assumptions

- **Sprint Overview** is the preferred tab name; Review and Planning remain equally prominent
  in-page modes.
- "Things" and "stories" mean the existing non-Epic Jira sprint-item scope, not only Jira issue type
  `Story`. Restricting to Story-only would require a separate hierarchy/double-counting decision.
- Green uses the existing configured buffer threshold.
- Planning snapshots, not historical inference, define commitment.
- Current Jira assignee is the only available first-release contributor attribution.
- A team holiday removes the full team's capacity on one configured working day.
- Notes are local, plain text, and included in the shareable database.
- Completion makes Review read-only; append-only corrections are deferred.

### Decisions to revisit only with new product direction or evidence

1. Whether Planning should optionally write the finalized selection to Jira after an explicit
   preview/approval workflow. This would require a separate mutation safety plan.
2. Whether exact velocity and time-series charts justify Jira changelog cost, caching, timezone,
   and partial-history complexity.
3. Whether finalized Review corrections need versioning similar to Planning rather than a separate
   append-only correction note.
4. Whether notes need categories such as observation/decision/action and independent action-state
   tracking. The first release intentionally keeps the requested global/data-point note model.
5. Whether holidays need partial-day or region/calendar feeds. The first release supports explicit
   full-day team holidays only.
6. Whether the required-to-stay-Green target should later support user-set epic allocation floors or
   priority overrides beyond the current shared portfolio ordering.

## 15. Continuation instructions

**Current status:** Slice 1 foundation is in progress: `TeamHoliday` is persisted locally and flows
through the shared capacity engine, portfolio projection, Gantt, and Team sprint output. Jira sprint
state/goal/origin-board metadata now round-trips. The peer Sprint Overview tab, canonical mode/sprint
route state, local searchable sprint launch control, and capacity summary are in place. Durable
ceremonies, snapshots, commitment selection, review aggregation, and the Team holiday editor remain.

**Next action:** complete Slice 1 with Team holiday editing and focused holiday migration/capacity
tests, then implement Slice 2 ceremony persistence and optimistic-concurrency endpoints before
making the Sprint Overview launch action durable.

**First files to inspect:**

1. `docs/planner-product-constitution.md`
2. `packages/shared/src/domain.ts`
3. `packages/backend/src/jira/types.ts`
4. `packages/backend/src/jira/mapper.ts`
5. `packages/backend/src/db/schema.ts`
6. `packages/backend/src/db/database.ts`
7. `packages/backend/src/db/persist.ts`
8. `packages/backend/src/db/reconcile.ts`
9. `packages/engine/src/capacity.ts`
10. `packages/frontend/src/components/TeamPage.tsx`
11. `packages/frontend/src/App.tsx`
12. `packages/frontend/src/lib/router.ts`

**Initial discovery commands:**

```bash
rg -n "interface Sprint|JiraSprint|listSprints|sprints:" packages
rg -n "buildCapacityContext|CapacityInputs|sprintCapacity|dayCapacity" packages
rg -n "DomainDataset|writeDataset|readDataset|reconcile" packages/backend packages/shared
rg -n "PlannerTab|tabs:|routeSearch|parsePlannerRoute" packages/frontend
```

Before Node-based validation:

```bash
nvm use
```

Keep this document current as implementation progresses: update Status/Last updated, mark each
slice complete, record metric or schema changes, link the active snapshot schema version, and leave
the next exact action here before ending a work session. Do not rely on chat history to preserve a
decision captured during implementation.
