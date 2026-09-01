# Recurring Team Holiday Calendar Management — Durable Implementation Plan

**Status:** Proposed

**Created:** 2026-08-31

**Last updated:** 2026-08-31 — initial repository-backed plan

**Scope:** turn the current date-specific `TeamHoliday` foundation into annual holiday rules,
surface holiday occurrences on the portfolio Calendar, and add Calendar-owned create/edit/delete
and tracked-holiday list workflows

**Intended outcome:** a user can open **Calendar**, add a holiday such as **Labor Day — first
Monday in September** once, see it recur in every applicable year, review every tracked holiday in
one list, and trust that the same occurrences reduce capacity everywhere in the planner

**Constraints:** no Spec Kit/SDD; local single-user SQLite architecture; preserve flat navigation,
epic-filter independence, shared-capacity truth, existing global important-date semantics, and the
repository's additive migration expectations

## 1. Product outcome

Calendar becomes the operational home for team holidays. It must answer three related questions:

1. Which annual holidays are configured for each team?
2. On which date does each rule occur in the month/year being viewed?
3. Which calendar days remove team capacity from projections and sprint planning?

The first release supports common annual company/federal holiday patterns:

- a fixed month and day, such as **January 1** or **December 25**;
- an ordinal weekday in a month, such as **first Monday in September** for Labor Day;
- the last weekday in a month, such as **last Monday in May** for Memorial Day;
- optional nearest-weekday observance for fixed-date holidays.

The application stores one durable rule and derives occurrences for requested date ranges. It does
not create one database row per year.

## 2. Verified current behavior and evidence

These are repository facts verified on 2026-08-31.

### 2.1 A one-off holiday foundation exists in the current worktree

- [`packages/shared/src/domain.ts`](../packages/shared/src/domain.ts) defines `TeamHoliday` as
  `{ id, teamId, date, name }`, so every record names one concrete calendar date.
- [`packages/backend/src/db/schema.ts`](../packages/backend/src/db/schema.ts) defines
  `team_holiday(id, team_id, date, name)` with uniqueness on `(team_id, date, name)`.
- [`packages/backend/src/db/holiday.ts`](../packages/backend/src/db/holiday.ts) and
  [`packages/backend/src/routes/holiday.ts`](../packages/backend/src/routes/holiday.ts) implement
  validated date-specific list/create/update/delete operations.
- [`packages/frontend/src/data/api.ts`](../packages/frontend/src/data/api.ts) has typed callers for
  those endpoints, but no component currently calls them.
- The holiday foundation is part of the in-progress Sprint Overview work and is not yet a complete
  user workflow. This plan supersedes only its date-specific holiday contract and unfinished UI
  direction; it does not replace the broader Sprint Overview plan.

### 2.2 Holiday capacity behavior already has a useful seam

- [`packages/engine/src/capacity.ts`](../packages/engine/src/capacity.ts) currently builds a set of
  exact holiday dates and returns zero capacity for a matching working day.
- Portfolio projection, single-epic projection, Gantt capacity, and Team current-sprint output have
  begun passing team holidays into that shared engine context.
- A holiday on a configured non-working day has no effect because callers enumerate working days.
  PTO on the same holiday does not double-subtract because the holiday zeroes the whole day's
  capacity before per-member factors contribute.
- Recurrence must replace the exact-date lookup inside this one source of truth. Calendar must not
  implement a separate recurrence interpretation.

### 2.3 Calendar has no holiday presentation or management

- [`packages/frontend/src/components/PortfolioCalendarPage.tsx`](../packages/frontend/src/components/PortfolioCalendarPage.tsx)
  composes `PortfolioMonthCalendar`, the delivery-outlook list, and the existing add-day modal.
- [`packages/frontend/src/lib/portfolioCalendar.ts`](../packages/frontend/src/lib/portfolioCalendar.ts)
  models global important dates, epic milestones/gating dates, projected completion, sprints, and
  shared load. It has no holiday event kind.
- [`packages/frontend/src/components/PortfolioMonthCalendar.tsx`](../packages/frontend/src/components/PortfolioMonthCalendar.tsx)
  provides month navigation, a Layers menu, deterministic dense-day disclosure, exact accessible
  labels, and the existing **Add day** action.
- [`packages/frontend/src/components/ImportantDatesSection.tsx`](../packages/frontend/src/components/ImportantDatesSection.tsx)
  owns the focused Calendar add modal for Global date, Epic date, and Availability. It already
  demonstrates shared modal, `DatePicker`, `Typeahead`, validation, and focus-restoration patterns.
- Calendar is a portfolio page and has no team route state. Its model can span multiple teams.
  Team-owned holidays therefore need explicit team identity without turning Calendar into a team
  drill-down or allowing epic selection to alter capacity inputs.

### 2.4 Existing nearby concepts must remain distinct

- Global important dates are contextual portfolio markers with icon/link/notes. They do not change
  capacity and must not silently become holidays.
- Epic relevant days are delivery targets and milestones. They remain epic-filtered.
- PTO, on-call, and velocity overrides belong to individuals. A holiday applies to the whole team.
- The Team Availability view remains useful for member-specific availability. Calendar becomes the
  management home for annual team holidays because that is where their recurring dates are most
  understandable.

## 3. Product decisions and invariants

### 3.1 Holidays are annual rules

Replace the date-specific public contract with an annual recurrence rule:

```ts
type HolidayObservedPolicy = 'none' | 'nearest-weekday';

type AnnualHolidayRecurrence =
  | {
      kind: 'fixed-date';
      month: number; // 1–12
      day: number;   // valid for that month; February 29 is allowed
      observedPolicy: HolidayObservedPolicy;
    }
  | {
      kind: 'nth-weekday';
      month: number; // 1–12
      weekday: Weekday;
      ordinal: 1 | 2 | 3 | 4 | 'last';
      observedPolicy: 'none';
    };

interface TeamHoliday {
  id: string;
  teamId: string;
  name: string;
  recurrence: AnnualHolidayRecurrence;
}

interface TeamHolidayOccurrence {
  holidayId: string;
  teamId: string;
  name: string;
  date: IsoDate;
  observed: boolean;
}
```

Example Labor Day rule:

```json
{
  "teamId": "team-platform",
  "name": "Labor Day",
  "recurrence": {
    "kind": "nth-weekday",
    "month": 9,
    "weekday": 1,
    "ordinal": 1,
    "observedPolicy": "none"
  }
}
```

Do not accept a free-form cron string or iCalendar RRULE in the first release. The closed union is
easier to validate, render in plain language, test at boundaries, and evolve safely.

### 3.2 Occurrences are derived, not persisted

Add one pure, shared resolver used by engine, backend/API helpers, and frontend calendar models:

```ts
holidayOccurrences(
  holidays: readonly TeamHoliday[],
  start: IsoDate,
  end: IsoDate,
): TeamHolidayOccurrence[]
```

Rules:

- calculations use UTC calendar arithmetic and ISO date strings;
- results include only occurrences inside the inclusive requested range;
- output order is date, case-insensitive name, team ID, then holiday ID;
- occurrence identity is `${holidayId}:${date}`;
- fixed February 29 occurs only in leap years;
- `last` means the final matching weekday in the month;
- `nearest-weekday` moves Saturday to Friday and Sunday to Monday;
- an observed occurrence crossing a year boundary is included based on its observed date, so range
  expansion evaluates the immediately adjacent rule years as needed;
- if two rules resolve to the same date, both remain visible but capacity is zeroed once;
- range expansion must be bounded by explicit start/end input and must never generate an unbounded
  future series.

The engine may use a lower-level `holidayOccurrenceOnDate(rule, date)` predicate to avoid expanding
a large range repeatedly, but it must share the same tested semantics as `holidayOccurrences`.

### 3.3 Calendar and epic filters remain independent

- Holiday occurrences are team-owned context, not epic data. Changing the global epic filter does
  not hide them or change their capacity effect.
- Calendar renders occurrences for teams represented by the active portfolio. If more than one
  team is represented, each event includes the team name in its visible or immediately adjacent
  label.
- The tracked-holiday list shows rules for all configured teams, including a team with no active
  epic, so management does not depend on current portfolio participation.
- A local list filter may select **All teams** or one team for presentation. It must not alter the
  Calendar's shared-capacity calculation, projection input, or global route state.
- Do not add a second Calendar navigation level or an epic/team drill-down route.

### 3.4 Calendar is the management surface

Add a **Tracked holidays** section directly below the month calendar and before Delivery outlook.
This ordering keeps the date visualization, its governing rules, and downstream delivery effects in
one readable flow.

The section contains:

- heading and short copy explaining that holidays remove whole-team capacity;
- an **Add holiday** primary action;
- an **All teams** / team selector only when multiple teams exist;
- one compact row per stored rule, ordered by next occurrence, name, team, and ID;
- name, team, plain-language recurrence, next occurrence, observed policy, Edit, and Remove;
- an explicit empty state with the Add action;
- read-only copy and disabled/absent mutation actions when the backend is unavailable.

The list displays rules, not an infinite list of yearly occurrences. **Next occurrence** is derived
from the effective planning date and may say `No occurrence in the planning horizon` only when the
configured bounded lookup cannot find one (for example, a leap-day rule with an unusually short
horizon). Normal annual rules must always find a next occurrence.

### 3.5 Add and edit workflow

Use a focused modal launched from **Tracked holidays**. Do not add a multi-field inline form to the
Calendar toolbar.

Fields:

1. **Team** — native select when there is more than one configured team; fixed text otherwise.
2. **Holiday name** — explicit `type="text"`, 1–160 trimmed characters.
3. **Recurrence type** — native select: **Fixed date** or **Weekday in month**.
4. Conditional recurrence fields:
   - Fixed date: Month, Day, and **Observe on nearest weekday** checkbox.
   - Weekday in month: First/Second/Third/Fourth/Last, weekday, and month.
5. Plain-language preview, for example **Occurs every year on the first Monday in September**.

The stable, short Month/Day/Weekday/Ordinal choices should use compact native controls. `DatePicker`
is not appropriate here because selecting a concrete year would miscommunicate that the stored
value is annual. The modal uses established `.control`, `.btn`, `.btn.primary`, error, focus, and
overlay patterns. Save is the sole primary action.

Editing changes the one rule for all years. The modal states this explicitly. Removing requires a
confirmation that the holiday will stop affecting every projected year; cancellation must preserve
the row and return focus to Remove.

The existing Calendar **Add day** modal may later offer a Holiday tab for cross-discovery, but the
first implementation should keep one authoritative holiday form and may route that tab/button to
the same modal component rather than duplicate fields or mutation logic.

### 3.6 Holiday calendar layer

Extend the portfolio calendar event union with a `holiday` kind carrying `holidayId`, `teamId`,
`teamName`, and `observed`.

- Add **Holidays** to Layers, enabled by default.
- Holiday events use a restrained non-status treatment; green/yellow/red are not decorative.
- Visible text includes the holiday name and, in a multi-team view, the team name.
- Accessible text says `Team holiday`, the date, recurrence source, team, and `Observed` when true.
- Holiday events participate in the existing deterministic same-day ordering and `+N more`
  disclosure. Order global important dates, holidays, gating days, projected completion, then other
  milestones unless visual testing demonstrates a clearer stable order.
- When editable, a holiday event is a semantic button that opens the rule editor. When read-only,
  it is non-interactive text with the same accessible description.
- The Calendar event and the tracked list must resolve the same date from the shared helper.

### 3.7 Capacity truth

The engine remains the only capacity source of truth:

- on a configured team working day, any matching holiday occurrence makes that team's capacity
  zero before PTO, on-call, and velocity factors;
- a holiday on a non-working day does not reduce capacity;
- an observed date, not the unobserved weekend date, removes capacity when observance applies;
- multiple holiday rules and PTO on the same day do not double-subtract;
- different teams may have different holiday rules on the same date;
- existing Overview, Calendar shared-load bands, Gantt, Team sprint output, and Sprint Overview all
  consume the same recurrence semantics.

Global important dates remain contextual and never affect capacity.

## 4. Persistence and migration contract

### 4.1 Target columns

Evolve `team_holiday` to store rule fields:

```text
id                 TEXT PRIMARY KEY
team_id            TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE
name               TEXT NOT NULL
recurrence_kind    TEXT NOT NULL CHECK(recurrence_kind IN ('fixed-date','nth-weekday'))
month              INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12)
day                INTEGER
weekday            INTEGER
ordinal            TEXT
observed_policy    TEXT NOT NULL CHECK(observed_policy IN ('none','nearest-weekday'))
created_at         TEXT NOT NULL
updated_at         TEXT NOT NULL
```

Repository validation enforces the union:

- fixed-date requires `day`, forbids `weekday`/`ordinal`, and permits either observed policy;
- nth-weekday requires `weekday` and ordinal `1|2|3|4|last`, forbids `day`, and requires `none`;
- month/day combinations must be real in at least one year, allowing February 29;
- name comparison for duplicate detection is trimmed and case-insensitive.

Permit distinct holiday names on the same recurrence and distinct recurrences with the same name,
but reject an exact semantic duplicate for one team. Enforce this in the repository because nullable
union columns make a single SQLite `UNIQUE` constraint misleading. Add query-friendly indexes on
`team_id` and normalized ordering fields.

### 4.2 Current date-column migration

The live worktree already creates a date-specific `team_holiday` table. Implementation must handle
both fresh and already-opened development databases.

Preferred migration:

1. Add recurrence/timestamp columns idempotently.
2. Backfill each legacy `{ date, name }` row as a fixed-date annual rule using the stored month/day,
   `observed_policy='none'`, and deterministic timestamps supplied by the migration.
3. Keep the legacy `date` column nullable/compatibility-only for the first migration release if an
   additive migration cannot safely remove its old `NOT NULL` constraint.
4. For an older table where `date` remains `NOT NULL`, repository writes supply a documented
   compatibility anchor date derived from the rule. No capacity or UI code may interpret that
   anchor as the actual occurrence.
5. Add a migration test from the exact date-specific schema currently in the worktree.
6. Defer physical table rebuilding/removal of the compatibility column to a later schema-cleanup
   release; do not risk user data merely to make the table aesthetically clean.

Because the date-specific foundation has not yet shipped as a complete UI, interpreting an existing
row as an annual fixed-date rule is the most consistent upgrade with the requested product behavior.
Document this change in release/help copy.

### 4.3 Dataset and sync ownership

- `DomainDataset.holidays` contains rules, not occurrences.
- Dataset read/write, fixture export, database snapshot/import, and counts preserve rules.
- Jira reconciliation retains local holiday rules exactly; Jira never creates, edits, or deletes
  them.
- Synthetic fixtures include at least Labor Day and one fixed observed holiday for deterministic
  visual and capacity tests.

## 5. API contract

Keep the existing team-scoped endpoints, changing payloads from exact dates to rules:

```http
GET    /api/teams/:teamId/holidays
POST   /api/teams/:teamId/holidays
PUT    /api/teams/:teamId/holidays/:holidayId
DELETE /api/teams/:teamId/holidays/:holidayId
```

`GET` returns stored rules in stable name/recurrence/ID order. The Calendar normally reads rules
from the reloaded dataset, so the endpoint remains useful for focused management and tests without
becoming a second source.

Optionally add a read-only occurrence endpoint only if another non-dataset consumer needs it:

```http
GET /api/teams/:teamId/holiday-occurrences?start=YYYY-MM-DD&end=YYYY-MM-DD
```

If added, it must call the shared resolver and enforce a bounded maximum range (proposed: five
calendar years). Do not make the frontend depend on this endpoint merely to render one month.

Mutation validation:

- reject unknown fields and recurrence discriminants;
- validate team existence and all numeric bounds;
- return `404` for unknown team/rule;
- return `409` for an exact semantic duplicate;
- return `400` for malformed recurrence input;
- never accept client-generated occurrence dates as authority;
- return the saved rule; the frontend reloads the dataset after success.

No optimistic revision is required for this local single-user CRUD. Each mutation is atomic. If the
application later becomes multi-user, add revision/audit semantics before treating last-write-wins
as acceptable.

## 6. Frontend component plan

Proposed seams:

```text
components/PortfolioCalendarPage.tsx
  PortfolioMonthCalendar
  TrackedHolidaysSection
    HolidayRuleList
    HolidayRuleModal
  DeliveryOutlookList

lib/holidays.ts
  describeHolidayRecurrence
  nextHolidayOccurrence
  holiday form/view helpers only
```

Use the shared recurrence resolver for dates. Frontend helpers may format names such as `First
Monday in September · observed nearest weekday`, but may not implement recurrence arithmetic.

`PortfolioCalendarPage` owns modal/list state and reload handling. Avoid independent API fetch state
when `dataset.holidays` is already present; this keeps Calendar, list, and capacity projection on the
same post-reload snapshot and prevents an event/list mismatch.

Mutation flow:

```text
Open modal → validate draft → POST/PUT → reload dataset → close modal → restore focus
                                                    └→ Calendar, list, and capacity recompute
```

On failure, keep the modal open, preserve inputs, show a concise inline error, and allow retry.
Ignore or abort stale responses after modal close/unmount. Disable Save during an in-flight request
to prevent accidental duplicates.

## 7. Ordered implementation slices

Keep this section current during implementation. A slice is complete only when its focused tests
pass and the continuation section names the next exact action.

### Slice 1 — Recurrence contracts and pure resolver

**Files/subsystems:**

- `packages/shared/src/domain.ts`
- new `packages/shared/src/holidays.ts`
- shared exports and focused tests

**Work:**

1. Replace exact-date holiday domain input with the discriminated annual recurrence union.
2. Implement bounded fixed-date, nth-weekday, last-weekday, leap-year, and observed-date resolution.
3. Add stable occurrence IDs/order and plain validation helpers reusable by the backend.
4. Test year boundaries, February 29, weekend observance, same-day rules, and invalid ranges.

**Exit:** Labor Day and fixed/observed holidays resolve deterministically for any bounded year range.

### Slice 2 — Persistence migration and CRUD

**Files/subsystems:**

- `packages/backend/src/db/schema.ts`
- `packages/backend/src/db/database.ts`
- `packages/backend/src/db/persist.ts`
- `packages/backend/src/db/reconcile.ts`
- `packages/backend/src/db/holiday.ts`
- `packages/backend/src/routes/holiday.ts`
- `packages/frontend/src/data/api.ts`
- backend repository/route/migration/snapshot tests

**Work:**

1. Add recurrence columns and safely backfill date-specific rows.
2. Update dataset round-trip and sync preservation.
3. Replace date payload validation with strict recurrence-union validation.
4. Implement semantic duplicate detection and stable ordering.
5. Prove snapshot/import and older-schema migration preserve rules.

**Exit:** recurring rules are durable, CRUD-complete, and safe across existing database files.

### Slice 3 — One recurrence-aware capacity source

**Files/subsystems:**

- `packages/engine/src/capacity.ts`
- engine adapter/portfolio contexts
- frontend Gantt capacity context
- backend Team sprint-output capacity context
- Sprint Overview snapshot/capacity seam as available
- engine and cross-surface regression tests

**Work:**

1. Replace the exact-date set with shared recurrence matching.
2. Verify per-team filtering and observed-date behavior.
3. Prove weekend, PTO overlap, duplicate same-day holiday, zero-working-day, and multiple-team cases.
4. Audit every `buildCapacityContext` caller so no capacity surface silently omits holidays.

**Exit:** the same annual rule changes every relevant capacity view on the same derived occurrence.

### Slice 4 — Calendar event layer

**Files/subsystems:**

- `packages/frontend/src/lib/portfolioCalendar.ts`
- `packages/frontend/src/components/PortfolioMonthCalendar.tsx`
- calendar model/unit tests and focused E2E

**Work:**

1. Expand holiday rules for the visible calendar range and add holiday events.
2. Add the default-on Holidays layer, legend, styling, exact labels, and observed/team context.
3. Preserve holiday visibility across epic filters and same-day density disclosure.
4. Add an edit callback seam without coupling the pure calendar model to mutations.

**Exit:** every applicable holiday occurrence is visible, accessible, deterministic, and agrees
with capacity for that date.

### Slice 5 — Tracked list and add/edit/remove modal

**Files/subsystems:**

- new `components/TrackedHolidaysSection.tsx`
- new `components/HolidayRuleModal.tsx`
- `packages/frontend/src/components/PortfolioCalendarPage.tsx`
- `packages/frontend/src/styles.css`
- frontend models/tests and Playwright coverage

**Work:**

1. Add the list section, team presentation filter, stable ordering, recurrence copy, and empty/read-
   only/error states.
2. Add the focused modal with fixed-date and weekday-in-month fields plus live summary.
3. Wire create/edit/delete through the existing API and one dataset reload path.
4. Restore focus after modal/confirmation close and prevent duplicate submits.
5. Stack rows and modal fields cleanly around 390px without horizontal page scrolling.

**Exit:** users can manage annual holiday rules entirely from Calendar and immediately see both
their occurrences and capacity effect.

### Slice 6 — Integration hardening and documentation

**Files/subsystems:**

- synthetic/visual fixtures
- Calendar, Gantt, Team output, persistence, and route regression suites
- relevant help/README copy
- this plan and Sprint Overview plan continuation sections

**Work:**

1. Add deterministic Labor Day and observed fixed-date fixture coverage.
2. Audit all calendar/capacity empty, failure, read-only, and multi-team states.
3. Verify SQLite snapshot/import and Jira sync survival.
4. Update durable-plan status, completed slices, schema notes, and next actions.

**Exit:** recurring holiday management is tested end-to-end and documented as the one holiday
source shared by Calendar, capacity, and Sprint Overview.

## 8. Failure, concurrency, migration, security, accessibility, and observability

### 8.1 Failure and partial state

- Dataset/backend unavailable: render the current bundled rules read-only when present; explain
  that changes require the backend.
- Mutation failure: preserve the draft, keep the modal open, and show the server message without
  logging the form body.
- Reload failure after a successful mutation: report that the rule was saved but the view could
  not refresh; provide Retry rather than issuing the mutation again.
- Unsupported recurrence kind from a newer database: show an explicit unsupported-rule row and do
  not guess an occurrence or capacity effect.
- No teams: show setup guidance and disable Add holiday.
- No active portfolio teams: keep the tracked list useful, while Calendar correctly has no holiday
  occurrences to overlay on inactive portfolio context.
- No occurrence in visible month: retain the stored rule in the list; absence from that month is
  expected, not an error.

### 8.2 Concurrency and idempotency

- Disable Save/Remove while the mutation is in flight.
- Repository semantic-duplicate detection prevents double-click or retry duplicates.
- A repeated delete returns `404`; the UI treats a rule missing after reload as already removed.
- Request completion after component unmount must not update stale local UI state.
- Calendar/list derive from one dataset snapshot, so a slower focused GET cannot overwrite newer
  reloaded data.

### 8.3 Migration and recovery

- Migration is additive and idempotent for current date-specific tables and fresh databases.
- Backfill is deterministic and transactional.
- No stored row is deleted during recurrence migration.
- SQLite snapshot/import includes recurrence columns and retains team foreign-key validation.
- A failed migration leaves the original rows readable/recoverable and aborts startup clearly.

### 8.4 Security and privacy

- Holiday names are trimmed plain text and rendered by React, never interpreted as HTML.
- Holiday data is local and never sent to Jira.
- API errors/logs may include rule IDs and validation categories, but not whole request bodies.
- Reject unknown fields and non-finite/out-of-range numeric values.
- No external calendar feed, URL fetch, or third-party telemetry is introduced.

### 8.5 Accessibility

- Modal has an accessible name, initial focus, Escape behavior, focus trap/containment consistent
  with existing modals, and focus restoration to Add/Edit.
- Every input has a visible label and error association.
- Recurrence meaning is always expressed in text; it is not encoded only by control position.
- Calendar holiday events have exact date/team/observed accessible descriptions.
- Edit and Remove use semantic buttons with rule-specific accessible names.
- Delete confirmation announces its consequence for all years.
- At narrow widths, controls stack without shrinking labels or requiring page-level horizontal
  scrolling; only the existing labelled calendar-grid region may scroll horizontally.

### 8.6 Observability

Keep telemetry local and non-sensitive:

- mutation result category, duration, team ID, and rule ID;
- migration/backfill counts without holiday names;
- no external telemetry service;
- user-visible errors remain actionable and concise.

## 9. Verification strategy

Before every Node/npm/npx command, run `nvm use` from the repository root.

### 9.1 Automated verification

```bash
nvm use
npm run test --workspace @ecp/shared
npm run test --workspace @ecp/engine
npm run test --workspace @ecp/backend
npm run test --workspace @ecp/frontend
npm run typecheck
npm run build
npm run e2e --workspace @ecp/frontend -- --grep "holiday|Calendar"
git diff --check
```

Required focused coverage:

- Labor Day resolves to the first Monday in September across several years;
- fixed dates, leap day, last weekday, weekend observance, and observed year crossing;
- invalid recurrence union combinations and semantic duplicates;
- date-specific legacy migration and fresh-schema round-trip;
- Jira sync and database snapshot/import preservation;
- working-day holiday capacity, weekend no-op, PTO overlap, two same-day rules, and team isolation;
- all `buildCapacityContext` consumers include recurring rules;
- Calendar layer default/toggle, epic-filter independence, multi-team label, same-day `+N more`, and
  event-to-edit behavior;
- list ordering/filtering, empty/read-only/error/loading states;
- modal create/edit validation, duplicate-submit guard, delete confirmation, retry, Escape, and
  focus restoration;
- desktop and approximately 390px presentation without page overflow.

### 9.2 Manual validation

1. Open Calendar with no epic filter. Confirm **Tracked holidays** appears below the month grid and
   shows either its empty state or all stored rules.
2. Add **Labor Day** for one team as **First · Monday · September**. Confirm the summary says it
   recurs annually, the list shows its next occurrence, and the calendar shows it on the correct
   date for the viewed year.
3. Navigate Calendar backward and forward by year. Confirm Labor Day moves to the correct first
   Monday without creating additional stored list rows.
4. Add a fixed Saturday/Sunday holiday with nearest-weekday observance. Confirm the observed weekday
   is labelled **Observed** and only that working date loses capacity.
5. Apply and clear an epic filter. Confirm holiday events, tracked rules, and total capacity do not
   change; only epic-scoped calendar events/outlook respond to the filter.
6. In a multi-team dataset, confirm team labels are clear, list filtering is presentation-only, and
   one team's holiday changes only that team's capacity contribution.
7. Edit Labor Day's name and recurrence, then remove it. Confirm Calendar, list, Overview/Gantt, and
   Sprint Overview update after reload, and that removal warns about all years.
8. Repeat add/edit/remove at desktop and approximately 390px using only the keyboard. Confirm modal
   focus, errors, Escape, delete confirmation, dense-day disclosure, and calendar scrolling remain
   usable.
9. Snapshot/import the database and run a Jira sync. Confirm holiday rules and derived occurrences
   remain intact.

## 10. Acceptance criteria

- Calendar is the discoverable management home for team holidays and includes a visible tracked-
  holiday list.
- A user can create, edit, and remove a holiday rule without leaving Calendar.
- Labor Day is stored once as first Monday in September and resolves correctly every year.
- Fixed annual dates, first/second/third/fourth/last weekday rules, and optional nearest-weekday
  observance for fixed dates are supported and described in plain language.
- Stored rules, not generated yearly rows, are the durable source of truth.
- Holiday occurrences appear in a default-on Calendar layer with exact team/date/observed text and
  remain visible regardless of epic filtering.
- The tracked list shows all configured rules with team, recurrence, next occurrence, observed
  policy, and accessible actions.
- The same shared recurrence logic drives Calendar events and every capacity-aware surface.
- Holidays zero team capacity only on the applicable configured working/observed day, without
  double subtraction for PTO or duplicate same-day rules.
- Global important dates remain non-capacity context and are not reclassified as holidays.
- Legacy date-specific holiday rows migrate safely to fixed-date annual rules and survive database
  snapshot/import and Jira sync.
- Empty, read-only, invalid, duplicate, unavailable, stale-reload, no-team, and unsupported-rule
  states are explicit and recoverable.
- Modal, list, events, confirmation, and narrow layout meet the accessibility contract.
- Shared, engine, backend, frontend, typecheck, build, focused E2E, and diff checks pass.

## 11. Explicit non-goals

- Importing public holidays from Google, Outlook, an external calendar URL, or a country/region API.
- Arbitrary cron/RRULE editing or monthly/weekly recurrence.
- One-off company events; use Global important dates when they do not change capacity. If a future
  one-off team shutdown must change capacity, define a separate capacity-exception contract.
- Partial-day holidays, half-capacity days, or per-member holiday opt-outs.
- Automatically creating PTO rows from holidays.
- Writing holiday data to Jira.
- Adding a new primary navigation page or making Calendar subordinate to a team/epic.
- Reworking global important-date, epic relevant-day, PTO, or on-call semantics.
- Hosted multi-user authorization, audit history, or real-time collaboration.

## 12. Assumptions and deferred decisions

### Accepted assumptions

- All newly added holidays are annual.
- The first-release recurrence vocabulary covers standard US company holidays, including Labor Day
  and Memorial Day, without a free-form rule language.
- Nearest-weekday observance is sufficient for fixed-date company policy in the first release.
- Rules are team-scoped; different teams may intentionally configure different calendars.
- Calendar's existing effective planning date is the reference for next-occurrence display.
- The list is visible by default rather than hidden behind a second page mode.

### Revisit only with product evidence

1. Country/region holiday packs or external calendar subscriptions.
2. A global rule that automatically applies to all current and future teams. The first release
   requires explicit team ownership to keep capacity attribution truthful.
3. One-off or temporary team shutdown capacity exceptions.
4. Custom observance policies beyond nearest weekday.
5. Whether the existing **Add day** modal should permanently absorb the holiday form or simply link
   to the authoritative Holiday modal.
6. Holiday history/versioning if edits after completed historical sprint snapshots need audit
   treatment. Frozen Sprint Overview snapshots must retain their captured occurrence facts.

## 13. Continuation instructions

**Current status:** planning complete. The worktree contains an in-progress exact-date holiday
foundation (domain, schema, CRUD, API client, and partial capacity wiring), but no recurrence model,
Calendar events, Calendar management UI, tracked list, or focused holiday tests. This plan does not
claim those existing changes are complete or accepted.

**Next action:** implement Slice 1 by replacing the date-specific public contract with the annual
recurrence union and adding the pure shared occurrence resolver/tests. Do not build the modal before
that resolver establishes the authoritative Labor Day and observance semantics.

**First files to inspect:**

1. `docs/planner-product-constitution.md`
2. `docs/recurring-team-holiday-calendar-management-plan.md`
3. `docs/sprint-overview-planning-review-plan.md` section 4.9 and Slice 1
4. `packages/shared/src/domain.ts`
5. `packages/engine/src/capacity.ts`
6. `packages/backend/src/db/schema.ts`
7. `packages/backend/src/db/database.ts`
8. `packages/backend/src/db/holiday.ts`
9. `packages/frontend/src/lib/portfolioCalendar.ts`
10. `packages/frontend/src/components/PortfolioMonthCalendar.tsx`
11. `packages/frontend/src/components/PortfolioCalendarPage.tsx`
12. `packages/frontend/src/components/ImportantDatesSection.tsx`
13. `packages/frontend/src/styles.css`

**Initial discovery commands:**

```bash
rg -n "TeamHoliday|team_holiday|holiday" packages
rg -n "PortfolioCalendarEvent|FILTERS|CalendarEvent|Add day" packages/frontend
rg -n "buildCapacityContext" packages
git status --short
git diff --check
```

Update this document after every implementation slice. Record completed tests, migration changes,
semantic deviations, and the next exact action here rather than relying on conversation history.
