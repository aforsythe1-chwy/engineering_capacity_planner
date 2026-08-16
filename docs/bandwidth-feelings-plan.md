# Team Workspace, Daily Bandwidth Check-ins, and Calendar — Durable Implementation Plan

**Status:** Proposed

**Created:** 2026-08-15

**Last updated:** 2026-08-15 — separated Standup data collection from Team calendar analysis

**Scope:** a new Standup page, a Team calendar page with shared controls, daily engineer check-ins, existing
availability data, optional notes, durable local history, API contracts, accessibility, and
verification

**Constraints:** plan only; no Spec Kit/SDD; preserve the flat planner and the invariants in
`planner-product-constitution.md`

## 1. Outcome

Add a lightweight standup workflow that records one self-reported bandwidth feeling per engineer
per calendar day:

- **Red — Drowning**
- **Yellow — Things are getting overloaded, but I'm managing**
- **Green — I'd be happy if I had this amount of work all the time**
- **Purple — I don't have enough work to do**

Each check-in may include an optional note. Add a peer **Standup** page as the focused daily
collection workflow. Keep **Team** as the calendar-analysis home for people and team signals. Team
has shared team, engineer, and month controls above a primary view switch. The first two views are
**Bandwidth** and **Availability**, with an explicit extension point for future team-calendar data.

Standup lets the user capture the day's answers quickly. Team's Bandwidth calendar lets the user
review trends and filter to an engineer. Its calendar can color days by the team's average reported signal or
by the number of reports in a selected color, including Red-count hotspot analysis. Availability
reuses the existing PTO, on-call, and velocity-override data so the same Team page can answer who is
available and how workload feels without conflating the two signals.

The feature is an observational planning signal. In the first release it does **not** change base
velocity, weekly capacity, epic forecasts, health verdicts, or Gantt placement. Any future use of
feelings in forecast math requires a separate product decision, evidence that the relationship is
useful, and an explicit constitution review.

## 2. Product principles and decisions

### 2.1 Use check-ins, not performance scores

Name the persisted concept `BandwidthCheckIn` and the UI **Team bandwidth**. A check-in describes
how work feels to a person on a day. It must not be labeled productivity, performance, utilization,
or efficiency.

Add short explanatory copy near the entry and analytics surfaces:

> Self-reported planning signal. Use it to discuss load and support needs, not to rate performance.

This framing matters because individual history and free-text notes can otherwise look like an
employee-scoring system even though that is not the feature's intent.

### 2.2 One report per member per local calendar day

The durable identity of a record is `(memberId, date)`. Re-selecting a feeling on the same day edits
the existing record rather than creating duplicates. Backfilling and correcting past dates are
allowed. The frontend derives "today" from the browser's local calendar date, not UTC
`toISOString()`, so a late-afternoon check-in cannot land on tomorrow in some time zones.

No report is distinct from Green. Missing responses remain visibly unknown and are excluded from
averages and status counts. Every aggregate shows its response count so a one-person result cannot
look like a complete team signal.

### 2.3 Notes are optional and private by default

Notes are trimmed plain text, empty text is stored as `null`, and the initial maximum is 2,000
characters. Notes are visible only in the selected day's person rows and the individual detail
view. Do not put note text in aggregate tooltips, URLs, logs, sync history, error telemetry, or Jira.

The application remains local and single-user, but its SQLite file and snapshots are shareable.
The UI and database-tools documentation must state that exported databases and snapshots contain
bandwidth notes. If the application ever becomes hosted or multi-user, authorization, retention,
and audit policy are prerequisites rather than follow-up polish.

### 2.4 Team is a peer workspace and is independent of epic filtering

Add **Team** as a peer to Overview, Timeline, Dependencies, Gantt Planner, and Configuration. The
page contains team-data views rather than becoming a second navigation hierarchy. Use a segmented
control or compact view switcher labeled **Show** with initial values **Bandwidth** and
**Availability**. These are modes within Team, not new primary tabs and not URL-level child apps.

The existing epic filter remains selected when entering or leaving Team, but it does not filter
people, check-ins, PTO, on-call, or velocity overrides. Show the same kind of truth-preserving
context used by other shared-capacity pages: Team includes the selected team's whole signal
regardless of which epic is visible.

If the dataset has more than one team, expose a separate team selector and persist `team` in the
query string. Do not infer or change the selected team from the epic filter. With one team, omit the
selector. An absent or invalid team parameter resolves deterministically to the first configured
team and is canonicalized.

This satisfies the product constitution:

- there is still one navigation level;
- selecting an epic never navigates to or changes the Team page or its calendar data;
- the all-active state remains useful;
- the page reports team-wide truth rather than an epic-owned roster, availability, or bandwidth
  view;
- page, epic filter, and optional team scope remain independent URL state.

The product constitution is amended alongside this plan to list Team as a peer page and clarify
that team-owned signals are intentionally not epic-filtered. That amendment records the explicit
product-direction decision rather than treating Team as an implementation exception.

### 2.5 Keep history when roster status changes

Inactive engineers disappear from today's default entry roster but remain in historical views and
member filters when they have check-ins in the selected period. The daily detail view can reveal
inactive members under an **Inactive** group.

Deleting a member with check-in history must return a clear conflict and recommend deactivation.
Do not cascade-delete human-authored history as a side effect of roster cleanup. A future explicit
history-purge workflow may be added if retention requirements demand it.

### 2.6 Define average and count modes precisely

The analytics layer uses semantic values, never CSS colors, as its source of truth.

For **Average signal**, assign a workload-pressure score:

| Feeling | Score | Meaning |
| --- | ---: | --- |
| Purple | -1 | Not enough work |
| Green | 0 | Sustainable preferred load |
| Yellow | 1 | Overloaded but managing |
| Red | 2 | Drowning |

Average only recorded responses, then map the mean back to a display band:

- `mean < -0.5` → Purple
- `-0.5 <= mean < 0.5` → Green
- `0.5 <= mean < 1.5` → Yellow
- `mean >= 1.5` → Red
- no responses → Unknown/neutral

The asymmetric range is deliberate: a Purple response cannot completely neutralize the urgency of
a Red response. Even so, averages can conceal polarization. Mark a day **Mixed** whenever it has at
least one Purple response and at least one Yellow or Red response. The detail affordance and exact
distribution remain available from every cell.

For **Count by feeling**, let the user choose Red, Yellow, Green, or Purple. Color intensity uses the
absolute number of matching reports and every cell prints the exact `count / responses` value.
The legend is anchored to the selected team's current active-member count rather than the maximum
in the visible month, so adjacent months remain comparable. Historical inactive responders may
make the numerator exceed today's active roster; in that case expand the legend ceiling and label
the historical roster difference rather than clipping data.

The first release defaults to **Average signal**, remembers the last mode in local UI preference,
and always exposes response coverage and the four-color distribution. Do not infer a feeling for
weekends, holidays, PTO, on-call days, or missing reports.

## 3. Target user experience

### 3.1 Team page shell and shared controls

The Team page header contains:

- title and a short explanation that this is the team's operational calendar;
- explicit team selector only when multiple teams exist;
- **All team** / individual engineer filter;
- **Today** shortcut and selected-date control;
- a primary **Show: Bandwidth / Availability** segmented control;
- mode-specific controls in a stable secondary row.

The page uses the shared `AppShell`. The global epic picker may remain visible for consistency, but
copy below the header makes clear that the epic filter does not alter Team data. Team, member, month,
and selected date remain stable when switching between Bandwidth and Availability so a user can
compare the same people and period without rebuilding context.

In Bandwidth mode, the secondary controls contain **Average signal / Count by feeling**, the feeling
selector used in count mode, and current response coverage. In Availability mode, they contain
PTO, On-call, and Velocity visibility toggles plus Calendar/List presentation when the list remains
useful.

### 3.2 Standup entry screen

Standup is a dedicated peer page, not a panel on Team. It contains the compact **Today's
check-in** workflow and should be usable while a standup is in progress without opening a modal for
each person. Its selected team/date controls are local to collection; it does not render the history
calendar.

For each active team member, render:

- avatar and name;
- four same-sized Red, Yellow, Green, and Purple choice buttons;
- the selected feeling's full description;
- an optional **Add note** / **Edit note** disclosure;
- saved, saving, and row-specific error state.

Selecting a color immediately upserts that person's record. Notes save explicitly or on a clearly
defined blur action; do not reload the entire dataset after each row. Optimistically update the row
and calendar, then reconcile with the returned server record. A failure restores the last saved
value and keeps the attempted note in the field for retry.

The panel defaults to the browser-local current date but the date control permits past-day entry.
Future dates are disabled in the UI. The API still validates dates without relying on a server
timezone cutoff, avoiding false rejection around midnight. Show `7 of 9 reported` throughout the
standup rather than treating completion as all-or-nothing.

Keyboard behavior:

- Tab reaches each member row once, then arrow keys move among its four radio choices;
- Space selects the focused choice;
- the note disclosure and input have visible focus states;
- saved/error announcements use a polite live region and do not steal focus.

Use a radiogroup per member. Every choice has an accessible name containing the color and full
meaning. Color is never the only indicator; pair it with text and a shape/icon.

### 3.3 Shared Team calendar

Use one month/date navigation contract for all Team calendar modes: previous/next controls, a Today
shortcut, weekday headings, member filtering, and visually muted non-working days based on the
selected team's cadence. Non-working days remain selectable because a check-in or availability
entry may legitimately exist there. Switching modes preserves the visible month and member filter.

Bandwidth mode renders the conventional month grid described below.

Each populated cell shows:

- aggregate color/intensity for the current mode;
- exact response count;
- a compact four-color distribution or accessible equivalent;
- a **Mixed** marker when applicable;
- a note indicator count, but never note text.

Selecting a day opens an in-page detail drawer/panel rather than navigating away. It lists every
recorded member, feeling label, and note, plus active members with no response. From the drawer the
user can edit or clear a record if the backend is available. Bundled sample mode is read-only using
the existing `editable` convention.

Calendar cells need a semantic button and accessible label such as: "August 14, 7 of 9 reported:
2 red, 3 yellow, 2 green, 0 purple; mixed signal; open details."

### 3.4 Trend summaries

Above or beside the calendar, show compact period summaries computed from the exact same calendar
view model:

- responses by feeling;
- reporting coverage (`recorded check-ins / possible active-member workdays`) with the denominator
  clearly labeled as based on the current active roster;
- days with at least one Red response;
- longest consecutive working-day run with at least one Red response;
- comparison to the immediately preceding same-length period, only when both periods have data.

Avoid causal language. The UI may say "Red reports increased" but not "Epic X caused overload."
Sprint boundaries, on-call, PTO, and epic milestones may later be added as contextual overlays, but
they do not change the underlying check-in aggregate.

### 3.5 Individual analysis

Add a shared member filter with **All team** as the default. In Bandwidth, choosing one engineer
switches the calendar to that person's raw daily colors and makes their notes available only after
selecting a day. The summary becomes the person's distribution and response cadence for the period.
In Availability, the same filter shows only that person's PTO, on-call, and velocity ranges. A
member selection persists when the user switches views.

The selected member is analysis state, not an epic filter. In the first release it may be local
component state. If shareable analysis URLs are later needed, add optional `member`, `month`, and
`bandwidthMode` parameters without changing the canonical `tab + epics + team` model.

### 3.6 Empty and partial states

Handle these explicitly:

- no configured team members;
- team has members but nobody has reported today;
- selected month has no reports;
- selected month has no availability entries;
- only some members have reported;
- a historical month contains now-inactive members;
- bundled/sample dataset is read-only;
- a Bandwidth request fails while Availability remains usable, and vice versa;
- backend mutation fails while historical data remains readable.

Never render an empty month as Green. Use neutral cells and the message **No check-ins recorded**.

### 3.7 Availability mode and Configuration boundary

Availability mode shows the same selected month/team/member context using the existing local-intent
sources:

- PTO ranges;
- on-call ranges;
- velocity overrides and their multiplier;
- optional notes already stored on those entries.

Adapt `buildAvailabilityEntries` rather than creating a second availability model. The month view
shows multi-day spans or per-day markers with member identity, kind, and count. Selecting a day
opens details grouped by PTO, On-call, and Velocity. The existing list presentation may remain as a
secondary toggle for dense ranges and precise start/end dates.

Move the existing Availability operational surface from Configuration into Team once equivalent
add/delete behavior is present. During implementation it may exist temporarily in both places, but
the final state must have one editor. Configuration retains team cadence, roster membership, base
velocity, Jira linkage, and other setup concerns, plus a compact summary/link to **Open Team
availability**. Team owns availability viewing and entry; Standup owns bandwidth entry.

Do not combine feeling color and availability kind into one overloaded cell background in the first
release. The primary view switch keeps their legends and semantics separate while preserving date
context. A future multi-layer overlay can be considered only after it has an accessible, unambiguous
visual grammar.

### 3.8 Extensible Team views

Model the primary switch as a typed collection rather than scattered booleans:

```ts
type TeamView = 'bandwidth' | 'availability';
```

Adding future team views such as rotation coverage, skills/ownership, or staffing should extend
this contract and reuse shared team/member/date controls. It must not add nested primary navigation
or turn Team into a route-per-tool dashboard. "Etc." is an extension seam, not scope for unspecified
data in this delivery.

## 4. Domain model

Add the shared types near `TeamMember` in `packages/shared/src/domain.ts`:

```ts
export type BandwidthFeeling = 'red' | 'yellow' | 'green' | 'purple';

export interface BandwidthCheckIn {
  memberId: string;
  date: IsoDate;
  feeling: BandwidthFeeling;
  note?: string | null;
  /** Backend-generated ISO instant. Preserved when the record is edited. */
  createdAt: string;
  /** Backend-generated ISO instant. Changes on every successful edit. */
  updatedAt: string;
}
```

Add `bandwidthCheckIns?: BandwidthCheckIn[]` to `DomainDataset` initially for backward-compatible
fixtures and imported databases. Normalize missing arrays to `[]` at read/use boundaries. Once all
checked-in fixtures and consumers have migrated, make it required in a separate cleanup change.

Keep the enum, scoring constants, labels, and descriptions centralized. The shared layer owns the
wire values and validation set; a focused frontend module owns presentation copy and CSS tokens.
Do not represent feelings as arbitrary strings or store their display descriptions in every row.

## 5. SQLite persistence and migration

Add this table to the fresh schema:

```sql
CREATE TABLE IF NOT EXISTS bandwidth_check_in (
  member_id    TEXT NOT NULL REFERENCES team_member(id) ON DELETE RESTRICT,
  check_in_date TEXT NOT NULL,
  feeling      TEXT NOT NULL
               CHECK(feeling IN ('red', 'yellow', 'green', 'purple')),
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (member_id, check_in_date)
);

CREATE INDEX IF NOT EXISTS idx_bandwidth_check_in_date
  ON bandwidth_check_in(check_in_date);
```

`CREATE TABLE IF NOT EXISTS` is the additive migration for existing database files. Put the table
after `team_member` in `INSERT_ORDER`; reverse deletion then clears check-ins before members. Add
explicit insert/read mapping in `persist.ts` so database snapshots, imports, deterministic fixtures,
and whole-dataset writes include history.

Required persistence behavior:

- `(member_id, check_in_date)` enforces one daily report;
- valid feelings are enforced in both repository code and SQLite;
- timestamps are ISO instants generated by the backend;
- a note clear writes `NULL`;
- member deletion with history is blocked before SQLite raises a generic foreign-key error;
- Jira synchronization preserves check-ins as local intent and filters only impossible dangling
  member references;
- old databases open with an empty check-in table;
- importing an old database succeeds with no check-ins;
- importing or restoring a new database includes all check-ins and notes;
- the database import summary reports the number of bandwidth check-ins restored.

Update the reconciliation contract comments and implementation so `current.bandwidthCheckIns`
passes through to `merged.bandwidthCheckIns`. Incoming Jira data never owns or overwrites this
collection. Add a regression test specifically proving repeated Jira sync does not remove or edit a
check-in.

The current database import intentionally replaces local data after taking a snapshot. Preserve
that behavior, but update the confirmation/help copy to name bandwidth history and notes among the
data being replaced and backed up.

## 6. Repository and HTTP API

Create a focused `db/bandwidth.ts` repository module rather than expanding the already broad
configuration repository. Register a focused `routes/bandwidth.ts` route module from `server.ts`.

### 6.1 Query

```http
GET /api/bandwidth-check-ins?teamId=T1&from=2026-08-01&to=2026-08-31
```

Return records ordered by date then stable member name/id. Require a valid team and inclusive ISO
date bounds, with `from <= to`. Cap a single query to a documented range such as 366 days. The
calendar requests the visible month plus any leading/trailing displayed week days; trend comparison
may request one adjacent period.

Although the first implementation may also expose the optional collection through `/api/dataset`
for persistence compatibility, the Team page's Bandwidth mode should use this range endpoint. That
keeps page load bounded as history grows and avoids making every unrelated dataset reload carry
years of notes. Availability mode continues to consume the existing dataset and mutation APIs.

### 6.2 Idempotent upsert

```http
PUT /api/bandwidth-check-ins/:memberId/:date
Content-Type: application/json

{ "feeling": "yellow", "note": "Interrupt load is high" }
```

Create or replace that member/date report and return the complete saved record. Preserve
`createdAt` on update and advance `updatedAt`. Validate:

- member exists;
- date is a real strict `YYYY-MM-DD` calendar date;
- feeling is one of the four wire values;
- note is `null` or a string no longer than 2,000 characters after trimming.

Do not log the request body. A user may backfill an inactive member's historical record, so the API
does not reject solely on current `active` state.

### 6.3 Clear a report

```http
DELETE /api/bandwidth-check-ins/:memberId/:date
```

Return `204` whether the row existed or not, making retries safe. The UI requires confirmation only
when a non-empty note would also be removed.

### 6.4 Frontend client

Add typed `listBandwidthCheckIns`, `upsertBandwidthCheckIn`, and `deleteBandwidthCheckIn` functions
to `packages/frontend/src/data/api.ts`. Update page-local state from returned records rather than
calling the global `onReload` after each answer. A full reload and database restore must still
reconstruct the same view.

## 7. Analytics and view-model boundary

Create `packages/frontend/src/lib/bandwidth.ts` as a pure, tested module. Components provide a team,
members, check-ins, calendar range, current mode, and optional member filter. The module returns
semantic view models without JSX or CSS class names.

Suggested contracts:

```ts
type BandwidthMode =
  | { kind: 'average' }
  | { kind: 'count'; feeling: BandwidthFeeling };

interface BandwidthDaySummary {
  date: IsoDate;
  counts: Record<BandwidthFeeling, number>;
  responseCount: number;
  expectedCount: number;
  averageScore: number | null;
  averageFeeling: BandwidthFeeling | null;
  selectedFeelingCount: number | null;
  mixed: boolean;
  noteCount: number;
  isWorkingDay: boolean;
}

buildBandwidthCalendarModel(input): {
  days: BandwidthDaySummary[];
  period: BandwidthPeriodSummary;
  members: BandwidthMemberOption[];
}
```

Rules belong in this pure layer:

- calendar-date parsing uses shared UTC-safe date helpers after the browser-local date string is
  established;
- only recorded responses enter means and counts;
- duplicate member/date input is rejected in tests even though SQLite prevents it in production;
- a selected member produces their raw signal, not a one-person team average label;
- current inactive members are excluded from today's expected count but retained as responders in
  historical raw data;
- the comparison period has the same number of calendar days and is omitted when either side lacks
  data;
- working-day streaks skip configured non-working weekdays and break on a recorded working day with
  no Red response; missing days do not become positive or negative signals.

Keep this analytics module in the frontend/shared domain layer, not the capacity engine. The engine
is for forecast math, while this release deliberately keeps self-reported observations out of that
math.

## 8. Frontend composition and routing

Extend `PlannerTab` and the shared tab list with `team`, producing canonical URLs such as:

```text
?tab=team
?tab=standup
?tab=team&epics=NF-123
?tab=team&team=team-2
```

Update route parsing, serialization, legacy canonicalization, and tests so:

- Team and Standup are valid peer pages;
- switching pages preserves epic and team parameters;
- changing the epic filter while on Team leaves the page, team, Team view, member, and date context
  unchanged;
- changing the team leaves the page and epic filter unchanged;
- back, forward, and reload restore the same page;
- an invalid team is removed deterministically without changing the epic filter.

Keep `TeamView` as page-local state in the first release and remember the last selection in local UI
preference. If shareable Team analysis URLs become valuable, add a `teamView=bandwidth|availability`
parameter later without introducing nested routes. Month, member, and selected-day state follow the
same rule.

Add focused components instead of enlarging `App.tsx`:

```text
components/TeamPage.tsx
components/TeamCalendarControls.tsx
components/TeamCalendar.tsx
components/BandwidthEntryPanel.tsx
components/BandwidthCalendar.tsx
components/BandwidthDayDetails.tsx
components/BandwidthLegend.tsx
components/TeamAvailabilityView.tsx
lib/bandwidth.ts
lib/teamCalendar.ts
```

Reuse existing member avatars/colors and shared panel/control styles where they communicate identity.
Do not reuse member identity colors for feelings; feeling colors have one stable meaning everywhere.
Reuse and adapt `AvailabilityCalendar`, `AvailabilityList`, `AddAvailabilityModal`, and
`buildAvailabilityEntries`; do not fork them into a second Team-only implementation.

Define theme tokens for the four states, neutral/missing, mixed indication, and count-mode intensity.
Purple must meet the same text and non-text contrast targets as the other statuses. Verify light and
dark user-agent/high-contrast behavior where supported. Every chart and calendar value must remain
understandable with color removed.

## 9. Delivery slices

### Slice 1 — Durable data contract

- Add shared types and enum values.
- Add the SQLite table, index, read/write mapping, and old-database migration.
- Preserve check-ins through reconciliation, snapshots, and imports.
- Block destructive member deletion when history exists.
- Add persistence, migration, reconcile, and snapshot/import tests.

**Exit:** a check-in with a note round-trips through SQLite, survives Jira sync, survives a database
snapshot/import, and cannot be silently deleted through member removal.

### Slice 2 — Repository and API

- Add validated range query, idempotent upsert, and idempotent delete operations.
- Register bandwidth routes and the typed frontend client.
- Ensure logs and error messages never contain note bodies.
- Add repository and Fastify route tests.

**Exit:** API tests can enter every feeling, edit and clear a note, reject invalid input, query a
date range, and prove member/date uniqueness.

### Slice 3 — Team calendar and Standup capture

- Add Team to flat navigation and routing, including the independent team selector.
- Add shared month/member/date controls and the Bandwidth/Availability view switch.
- Build the selected-date Standup screen with active roster rows.
- Implement row-local optimistic updates, retryable errors, and accessible radiogroups.
- Add empty/read-only states and local-calendar "today" handling.

**Exit:** a facilitator can capture an entire active roster on Standup, refresh, and see exactly
the saved answers and notes; Team remains calendar-only and switching its views preserves the
selected team, member, and month.

### Slice 4 — Team calendar modes and analysis

- Implement the pure daily/period aggregation module.
- Build month navigation, Average signal, and Count by feeling modes.
- Add exact distribution, response coverage, mixed-state marker, and day details.
- Add All team / individual filtering and period summaries.
- Adapt the existing availability model/calendar/list to the shared Team controls.
- Move Availability add/delete operations to Team and replace the Configuration editor with a
  summary/link after parity is verified.
- Add unit, component, accessibility, and end-to-end tests.

**Exit:** month cells and summaries match hand-calculated fixtures for missing, mixed, complete,
weekend, inactive-member, and month-boundary cases; Availability shows the same chosen period and
member without duplicating its editor in Configuration.

### Slice 5 — Hardening and documentation

- Add responsive and visual-regression coverage at desktop and narrow widths.
- Verify keyboard-only entry, mode switching, and calendar inspection.
- Update README feature/run guidance and database snapshot/import privacy copy.
- Document the formulas and the fact that check-ins do not modify forecast capacity.
- Search for any logging or Jira payload path that could accidentally include note content.

**Exit:** the feature is understandable without tribal knowledge, preserves user history across all
existing data workflows, and passes the full repository test/build suite.

## 10. Verification matrix

### Shared and persistence tests

- all four feelings round-trip with exact wire values;
- empty/whitespace notes become `null`; Unicode and line breaks survive;
- a second upsert changes one row and preserves `createdAt`;
- invalid feeling, invalid date, overlong note, and unknown member are rejected;
- a fresh database contains the table and an old database migrates idempotently;
- a unique member/date pair is enforced;
- member deletion with history returns a domain-specific conflict;
- inactive members retain history;
- Jira reconcile preserves check-ins exactly;
- snapshot/import restores notes and reports the restored count;
- importing a pre-feature database produces an empty history without failure.

### Pure analytics tests

- no responses yields Unknown rather than Green;
- average thresholds are tested at and around `-0.5`, `0.5`, and `1.5`;
- Red plus Purple is marked Mixed and maps according to the documented score;
- count mode returns exact counts for each selectable feeling;
- missing members do not enter the average;
- selected-member mode returns raw daily feelings;
- inactive historical responders remain represented;
- working days follow team cadence;
- leap day, month leading/trailing cells, and year boundaries are correct;
- period comparison and Red streak rules match explicit fixtures.

### Component and end-to-end tests

- keyboard-only user can select a status, add a note, and observe saved state;
- reload retains the check-in;
- editing one member does not disable or overwrite another row;
- failed mutation restores the last saved feeling and preserves retry text;
- Average/Count toggles change the legend and accessible cell labels;
- choosing Red count exposes exact hotspot days;
- selecting a day shows reports, notes, and missing responders;
- individual filter changes both Team views without changing epic scope;
- switching Bandwidth/Availability preserves team, member, month, and selected date;
- changing pages preserves the epic filter and returning to Team restores team scope;
- availability can be viewed and managed from Team after its Configuration editor is removed;
- desktop and mobile screenshots cover empty, partial, mixed, and dense months;
- bundled sample mode is readable and mutation controls are disabled.

Before running Node-based verification, follow repository policy and run `nvm use` from the
repository root. Final verification should include targeted tests during each slice, followed by
`npm test`, `npm run typecheck`, `npm run build`, and the relevant Playwright specs.

## 11. Likely file map

| Concern | Files |
| --- | --- |
| Domain contract | `packages/shared/src/domain.ts`, shared/domain tests |
| Schema and migration | `packages/backend/src/db/schema.ts`, `database.ts` |
| Persistence and sync safety | `packages/backend/src/db/persist.ts`, `reconcile.ts`, `snapshot.ts` |
| Repository and routes | new `db/bandwidth.ts`, new `routes/bandwidth.ts`, `server.ts` |
| Typed client | `packages/frontend/src/data/api.ts` |
| Routing and shell | `packages/frontend/src/lib/router.ts`, `App.tsx`, new `TeamPage.tsx` |
| Analytics | new `packages/frontend/src/lib/bandwidth.ts` and focused tests |
| Shared Team calendar | new `TeamCalendarControls.tsx`, `TeamCalendar.tsx`, `lib/teamCalendar.ts` |
| Bandwidth UI | new focused Bandwidth components, `styles.css` |
| Availability migration | existing `AvailabilityCalendar.tsx`, `AddAvailabilityModal.tsx`, `Configuration.tsx`, `lib/availability.ts` |
| End-to-end/visual coverage | new frontend Team/Bandwidth Playwright specs |
| User documentation | `README.md`, database snapshot/import guidance |

## 12. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Missing responses are mistaken for Green | Unknown is a separate neutral state; all aggregates show response counts |
| An average hides simultaneous overload and underload | Use urgency-skewed documented scoring, mark Mixed days, and keep exact distributions/count mode one click away |
| Feelings are treated as performance data | Use explicit non-performance framing; no ranking, targets, compliance score, or forecast multiplier |
| Notes leak through logs, Jira, or shared files | Never log/transmit notes to Jira; warn that DB snapshots include them; review payload/log paths |
| Jira sync erases local history | Treat check-ins as local intent and add an explicit reconcile regression test |
| Member deletion erases history | `ON DELETE RESTRICT`, preflight conflict, recommend deactivation |
| UTC conversion records the wrong day | Use a tested browser-local calendar helper; persist only validated `YYYY-MM-DD` dates |
| Long history bloats unrelated page loads | Drive the page from a bounded range endpoint; keep full persistence support for snapshots/import |
| Color-only status is inaccessible | Always pair color with label/count/icon and test keyboard, screen-reader names, and contrast |
| Team becomes a nested mini-application | Keep Team as one peer page with an in-page typed data-view switch and shared controls |
| Epic filtering creates a misleading subset | Epic and team state remain independent; Team always reports the selected team's whole signal |
| Availability has competing editors | Move the existing editor only after Team reaches parity, then leave a Configuration summary/link |
| Bandwidth and availability colors become ambiguous | Use separate modes and legends; defer overlays until an accessible visual grammar exists |

## 13. Explicit non-goals for the first release

- automatic changes to velocity, capacity, health, or delivery forecasts;
- Jira fields, comments, issues, or synchronization of check-ins;
- Slack/Teams standup collection or reminders;
- individual performance scoring, targets, rankings, or leaderboards;
- sentiment extraction from note text;
- causal claims connecting a feeling to an epic, person, PTO, or on-call event;
- multi-user authentication and authorization;
- retention/purge policy beyond blocking accidental cascade deletion;
- CSV/report export beyond the existing SQLite snapshot/import unit.

## 14. Acceptance criteria

The feature is complete when:

- the user can record or revise exactly one Red/Yellow/Green/Purple feeling and optional note for
  each engineer on a selected non-future day;
- today's entry roster is fast enough to use conversationally during standup and shows partial
  completion honestly;
- all history persists across restart, Jira sync, snapshot, and database restore;
- inactive engineers remain visible in relevant history and member deletion cannot silently erase
  check-ins;
- Team and Standup are peer pages and preserve independent epic/team route state;
- Team offers Bandwidth and Availability through one in-page switch with shared team, member, and
  date context;
- the calendar can show documented Average signal and exact Count by feeling modes, including Red
  hotspots, response coverage, missing data, and mixed overload/underload days;
- the user can inspect any day and filter history to one engineer;
- the Availability mode presents existing PTO, on-call, and velocity data for the same selected
  period and engineer, and there is only one final availability editor;
- notes are absent from aggregate tooltips, URLs, logs, Jira requests, and sync logs;
- bandwidth data does not modify any capacity calculation or forecast;
- automated tests cover persistence, migrations, reconciliation, API validation, aggregation,
  accessibility, routing, and the primary standup-to-calendar flow.

## 15. Deferred decisions that should remain explicit

After real usage provides enough history, evaluate separately:

1. whether an overload-share or rolling-trend visualization is more useful than the categorical
   average;
2. whether sprint, PTO, on-call, milestone, or release overlays improve investigation without
   implying causation;
3. whether reminders or external standup collection are worth the privacy and integration cost;
4. whether notes need configurable retention, redaction, or export;
5. whether any forecast correlation should be shown as read-only evidence before considering a
   capacity adjustment.

None of these decisions blocks the first release, and none should be inferred from the presence of
the new data.
