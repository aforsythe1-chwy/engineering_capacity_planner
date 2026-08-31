# Standup Records Weekly Cards — Durable Implementation Plan

**Status:** Implemented; manual visual validation pending

**Created:** 2026-08-30

**Last updated:** 2026-08-30 — hide weekends outside the disposable backend test mode

**Working branch at plan creation:** `feat/engineer-sprint-output-capacity`

**Scope:** Redesign the **Standup records** section on the Standup page from a vertical list of
date rows into a compact, Monday-first weekly card view. Make each saved standup easy to identify
by weekday and date, make the whole record card open the existing standup modal, and replace the
visible `Completed` text with space-efficient status icons that remain fully accessible.

**Intended outcome:** A facilitator can scan recent standup history as calendar weeks, quickly
recognize “this was Monday” or “this was Tuesday,” distinguish completed from unfinished records
without spending a line of text on status, and open any saved record with pointer or keyboard.

**Related durable context:**

- [Standup Facilitation](./standup-facilitation-plan.md)
- [Standup Timer and Note Workflow](./standup-timer-and-note-workflow-plan.md)
- [Historical Standup Bandwidth Entry](./historical-standup-bandwidth-entry-plan.md)
- [Planner Product Constitution](./planner-product-constitution.md)

**Constraints:** Plan and frontend presentation work only; do not initialize Spec Kit or create SDD
artifacts. Preserve the Standup page as a peer page, preserve team ownership and team selection,
and do not couple standup history to the global epic filter.

## 1. Requested direction

The requested improvements are:

1. replace the current row-oriented records list with a card treatment;
2. organize records into weeks so weekdays have stable spatial positions and a user can recognize
   Monday, Tuesday, and the rest at a glance; and
3. replace the words `Completed` / `Incomplete` with icons to reduce visual width.

This plan interprets “looks more like a calendar” as a **weekly history grid**, not as a second
full month navigator. Each row is one Monday-through-Friday workweek in ordinary use (Monday through
Sunday while using the disposable test database), weeks appear newest first, and a
saved standup occupies its calendar-day column. This keeps recent records prominent while avoiding
month navigation, adjacent-month duplication, and a large field of empty day cells.

### 1.1 Target composition

```text
Standup records                                 ✓ complete   ◌ incomplete

             MON       TUE       WED       THU       FRI       SAT       SUN
Aug 24–30  [24  ✓]   [25  ✓]   [26  ◌]      ·         ·         ·         ·
Aug 17–23  [17  ✓]   [18  ✓]   [19  ✓]   [20  ✓]   [21  ✓]      ·         ·
```

The diagram communicates hierarchy and placement, not exact glyphs or pixels. The implementation
should use Lucide icons already available in the frontend rather than Unicode status glyphs. Empty
days are quiet layout placeholders, not bordered cards or disabled buttons.

## 2. Verified current behavior and evidence

These facts were verified in the repository on 2026-08-30.

### 2.1 Rendering and interaction

- [`RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx) owns the entire
  Standup page and renders **Standup records** inside `.panel.standup-session-list`.
- Each session is currently one unclassed `<p>` containing a compact `.link-btn` whose visible
  label is the raw ISO date, such as `2026-08-26`.
- Completed sessions append a muted visible ` Completed` string. `active` and `post_standup`
  sessions receive no visible status label, so absence of text implicitly means unfinished.
- Clicking the date calls `openRecord(session.id)`, fetches the existing standup aggregate, and
  opens `StandupModal` with the opener skipped. No routing or new detail surface is needed.
- The launch button owns focus restoration when the modal closes, even when the modal was opened
  from a historical record. This is existing behavior and is outside the visual redesign unless
  accessibility validation proves it is materially confusing.
- The records section already has an empty state: **No saved standups.**
- Sessions are fetched only when a team exists and the frontend is API-backed/editable. Bundled
  sample mode therefore shows the existing empty state rather than fabricated history.

### 2.2 Data and ordering

- [`StandupSession`](../packages/shared/src/domain.ts) already exposes `id`, `teamId`, `date`,
  `sprintId`, `sprintName`, `status`, timestamps, and revision.
- `StandupStatus` is exactly `active | post_standup | completed`.
- `GET /api/standups?teamId=...` already returns the selected team's sessions. The backend query in
  [`standup.ts`](../packages/backend/src/db/standup.ts) orders them by `standup_date DESC,
  started_at DESC`.
- The database enforces one Standup session per team/date, so the weekly view never needs to stack
  multiple record cards in one day cell.
- Selecting a different team reloads that team's records; the global epic filter is not involved.

### 2.3 Existing design system and calendar utilities

- [`styles.css`](../packages/frontend/src/styles.css) defines the existing dark tokens and compact
  geometry: primary `.panel` surfaces, nested `--panel-2` surfaces, quiet 1px borders, 8–12px
  radii, `--accent` focus/selection, and `--green` for meaningful completion state.
- The records list has no dedicated layout/card CSS beyond `.standup-session-list` in its class
  name, so the current row treatment is mostly browser-default paragraph flow.
- The frontend already depends on `lucide-react`; no icon dependency is needed.
- Shared date helpers include `addDays`, `getWeekday`, `parseIso`, and `formatIso`. Existing
  calendars demonstrate date-only arithmetic that avoids local/UTC rollover errors.
- The Team bandwidth calendar already establishes the narrow-screen precedent of preserving seven
  meaningful day columns in a horizontally scrollable region rather than crushing them.

### 2.4 Root cause

The problem is presentational. The current DOM has no week model, weekday headers, date formatting,
or independent card surface. Status is expressed through optional prose after a date link, which
uses space and makes unfinished records implicit. No backend, database, persistence, or modal
contract is missing.

### 2.5 Existing coverage gap

- Current Standup Playwright tests cover the active workflow and ticket/note behaviors, but there
  is no focused browser test for the records list, team-specific history, status presentation, or
  opening a historical card.
- There is no pure frontend helper or unit test for grouping Standup sessions into calendar weeks.

## 3. Product and interaction decisions

### 3.1 Week structure

- Use Monday as the first day of the week and Sunday as the last. This matches the requested
  Monday/Tuesday mental model and the team's ordinary working-week context.
- Show Monday through Friday columns in ordinary use. Hide Saturday and Sunday cards entirely, since
  production standups are not held on weekends.
- Preserve all seven columns only while the backend health endpoint reports `databaseMode:
  'test-copy'` (the disposable `ECP_TEST_DB` mode). This keeps weekend dates available for test
  fixtures and exploratory testing without exposing them in normal use.
- Show one weekday header row for the entire history grid. Use short labels (`Mon` through `Fri`, or
  `Mon` through `Sun` in test mode)
  visually and full weekday names where assistive naming benefits.
- Group only the weeks that contain at least one saved session. Do not insert empty weeks between
  widely separated historical records.
- Order week rows newest first. Within a row, preserve chronological Monday-to-Sunday placement.
- Give each row a compact visible range label such as `Aug 24–30` or `Aug 31–Sep 6`. Include the
  year when the range crosses years or when needed to disambiguate history. The individual card's
  accessible name always includes the full formatted date and year.
- Render empty day positions as unbordered, noninteractive placeholders with `aria-hidden="true"`.
  Do not create seven loud cards per week when only one or two days contain records.

### 3.2 Record card

- Render each saved record as one native `<button type="button">`; the entire visible card is the
  open action. Do not nest a link/button inside a card.
- Make the date number the primary label. The stable weekday column provides the day name; a small
  month abbreviation may appear on the card when a row crosses a month boundary.
- A restrained selected/hover surface may use an accent mix, but the default card remains
  `--panel-2` with the existing border and radius family. Cards must feel like compact actionable
  records, not large dashboard tiles.
- Preserve the existing `openRecord(session.id)` behavior and modal content. Card conversion must
  not start, resume, finish, or mutate a session merely by opening it.
- Every record supports a custom right-click menu with **Delete standup**. It reuses the existing
  confirmation and delete endpoint, then removes the card from the week grid on success. This
  intentionally broadens the former completed-only modal deletion affordance to include active and
  post-standup sessions; the backend remains authoritative for protected intake-awareness history.
- Render the custom menu in a viewport-level overlay, dismiss it on outside pointer interaction or
  Escape, and restore focus to the originating card after Escape. Keep the existing modal Delete
  action as the keyboard/touch-accessible deletion route.
- While a historical aggregate is loading, disable only the activated card or mark the grid busy;
  prevent duplicate requests without making unrelated cards appear unavailable. If implementation
  keeps the current immediate request behavior, at minimum retain the card and surface the existing
  page error on failure.

### 3.3 Status icon contract

- Use `CircleCheck` (or the closest already-approved Lucide completion icon) for `completed` and a
  visually distinct open/dashed circle icon for both unfinished states.
- Color completed status with `--green`. Use a restrained `--yellow` or muted/accent treatment for
  unfinished status; do not use red because an unfinished Standup is not necessarily an error.
- The icon is decorative inside a button whose accessible name includes status. Hide the SVG from
  assistive technology and add status through visible tooltip/title and/or `.sr-only` text.
- Accessible labels must preserve the real state distinction even if the visual icon is binary:
  `Completed`, `In progress` for `active`, and `Needs finishing` for `post_standup`.
- Provide a compact legend beside or below the section heading: icon + `Complete`, icon +
  `Incomplete`. The legend is explanatory, not interactive. It may collapse into accessible-only
  copy if the icon meaning is otherwise unambiguous in a very narrow viewport.
- Never rely on color alone. Shape and accessible text must both communicate status.

### 3.4 Responsive behavior

- At ordinary desktop width, keep the five workday columns aligned across all visible week rows;
  test mode keeps all seven day columns aligned.
- At narrow widths, preserve minimum readable card/day widths and put the weekday header plus all
  week rows inside one horizontally scrollable region. Do not give each row its own horizontal
  scroll position.
- The week-range label remains a fixed first column inside that region so week identity scrolls
  consistently with its days; CSS sticky behavior is optional and should be used only if it does
  not obscure focus outlines.
- The scroll region needs an accessible label and keyboard reachability (`tabIndex={0}`) consistent
  with other planner calendar regions. It must not introduce page-level horizontal overflow.
- Cards need at least a 44px narrow-screen hit target, visible hover/active/focus-visible states,
  and unclipped focus outlines.

## 4. Exact view model and contracts

Add a small pure presentation helper, preferably
[`packages/frontend/src/lib/standupRecords.ts`](../packages/frontend/src/lib/standupRecords.ts), so
date arithmetic and ordering do not remain embedded in the large `RunStandupPage.tsx` component.

Suggested contract:

```ts
export interface StandupRecordDay {
  date: IsoDate;
  session: StandupSession | null;
}

export interface StandupRecordWeek {
  start: IsoDate; // Monday
  end: IsoDate;   // Sunday
  days: readonly [
    StandupRecordDay,
    StandupRecordDay,
    StandupRecordDay,
    StandupRecordDay,
    StandupRecordDay,
    StandupRecordDay,
    StandupRecordDay,
  ];
}

export function groupStandupRecordsByWeek(
  sessions: readonly StandupSession[],
): StandupRecordWeek[];
```

Required helper behavior:

- derive the Monday week start with shared ISO-date helpers, not `new Date('YYYY-MM-DD')` local
  parsing;
- generate exactly seven ascending date entries per returned week; the presentation layer may trim
  this stable model to five weekday entries outside test mode;
- return only occupied weeks in descending week-start order;
- place each session in the matching date entry;
- remain deterministic if input arrives unsorted;
- avoid mutating the API array; and
- define an explicit duplicate-date fallback (prefer the later `startedAt`) even though the current
  database uniqueness contract should make it unreachable.

Keep display formatting near this helper or in the existing
[`format.ts`](../packages/frontend/src/lib/format.ts) only if the functions are broadly reusable.
Do not add a general calendar abstraction solely for this screen.

No API response, shared domain, backend route, database, or migration change is planned.

## 5. Ordered implementation slices

### Slice 1 — Pure weekly record model

**Status:** Implemented

**Primary seams:**

- `packages/frontend/src/lib/standupRecords.ts` (new)
- `packages/frontend/test/standupRecords.test.ts` (new)

**Work:**

1. Define Monday-first weekday constants and the `StandupRecordWeek` model.
2. Implement date-safe grouping, seven-day filling, newest-week ordering, and duplicate fallback.
3. Add unit fixtures covering one week, multiple weeks, a month boundary, a year boundary, weekend
   dates, unsorted input, each status value, and no sessions.
4. Keep state-label mapping (`completed`, `active`, `post_standup`) centralized and exhaustive so a
   future status addition fails typechecking rather than silently using an incorrect icon label.

**Exit:** An arbitrary session array produces a deterministic, Monday-first weekly model without
React, API, or timezone dependencies.

### Slice 2 — Accessible weekly card markup

**Status:** Implemented

**Primary seam:**

- [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx)

**Work:**

1. Extract the records markup into a focused local `StandupRecords` component or a separate
   component file if that materially reduces `RunStandupPage.tsx` complexity.
2. Preserve the existing section heading and empty state.
3. Add the status legend, weekday column headers, week-range labels, and one native button card per
   saved session.
4. Use Lucide icons, hide decorative SVGs, and include full date plus exact status in each button's
   accessible name.
5. Call the existing `openRecord(session.id)` callback; do not duplicate fetch or modal logic in
   the card component.
6. Add stable test IDs only where semantic role/name selectors are insufficient.
7. If loading-state protection is added, keep it local to history opening and preserve the existing
   error message path.
8. For every record card, add a custom context-menu trigger and one destructive menu action. Reuse
   the parent-owned confirmation/deletion flow rather than putting API mutation logic in the card.

**Exit:** The DOM expresses one calendar-like week grid, every saved record is a correctly named
button, and opening a record still uses the existing modal flow.

### Slice 3 — Compact card and calendar styling

**Status:** Implemented

**Primary seam:**

- [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css)

**Work:**

1. Add scoped `.standup-records-*` rules using existing tokens, border weights, radii, typography,
   and compact spacing.
2. Reset default heading/list/paragraph margins inside the section so the new grid has deliberate
   vertical rhythm.
3. Give occupied record buttons a clear nested `--panel-2` card surface; leave empty day cells
   visually quiet.
4. Add completed/unfinished icon tones and a compact legend without making every status visually
   loud.
5. Add hover, active, disabled/loading, and `:focus-visible` treatments. Confirm card and scroll
   wrappers do not clip focus rings.
6. Implement one shared horizontally scrollable grid at narrow widths with a sensible minimum day
   width, following the bandwidth-calendar precedent.
7. Re-read the current `styles.css` diff before editing: at plan creation this file contains
   unrelated user-owned changes on `feat/engineer-sprint-output-capacity`, and they must be
   preserved.
8. Style the context menu as a small viewport-level `--panel-2` menu with a quiet border, compact
   destructive action, outside/escape dismissal, and a visible focus state.

**Exit:** Desktop and narrow views retain day alignment, cards are compact but obviously
actionable, and the treatment matches the planner rather than appearing as a pasted-on block.

### Slice 4 — Browser regression coverage and visual QA

**Status:** Implemented

**Primary seam:**

- `packages/frontend/e2e/standup-records.spec.ts` (new) or a focused addition to the closest
  Standup page spec if shared setup makes that materially clearer

**Work:**

1. Route-mock a deterministic mix of completed, active, and post-standup sessions across two
   weeks, including a month boundary.
2. Assert descending week order and Monday-to-Sunday placement without overfitting exact CSS
   implementation details.
3. Assert icon/status accessible names, binary legend copy, and no visible `Completed` suffix row
   prose.
4. Click a full record card and verify the historical modal opens for the correct date without
   invoking the start endpoint.
5. Keyboard-focus and activate a record card; assert a visible focus treatment.
6. Verify the empty state and failed history-open error path.
7. At desktop and narrow viewports, assert no page-level horizontal overflow; at narrow width,
   assert the records region itself can scroll horizontally.
8. Capture screenshots for implementation review if the existing Playwright harness makes this
   straightforward; do not add permanent baseline snapshots unless the repository's visual-test
   practice supports maintaining them.
9. Right-click completed, active, and post-standup cards and assert the delete menu is available.
   Accept confirmation for one unfinished record and assert its DELETE request removes the card.
   Cover a `409` protected-delete response and verify its card remains visible with the server
   error.

**Exit:** The calendar semantics, open interaction, statuses, empty/error states, and responsive
containment are protected by focused browser coverage and have been visually inspected.

## 6. Failure, concurrency, migration, security, accessibility, and observability

### Failure and concurrency

- The list request and `openRecord` request remain the only network operations. Preserve the current
  page-level error surface when a record cannot be opened.
- Multiple rapid card activations must not allow an older response to replace a newer selection.
  Either disable history cards while an open request is pending or guard responses with a request
  token/session ID. This is a small reliability hardening at the existing interaction seam, not a
  new API contract.
- Refreshes after modal changes continue to replace `sessions` from the server, so a finished or
  deleted record updates its status/position using server truth.

### Migration and compatibility

- No persistence or data migration is needed.
- No URL, routing, epic-scope, team-scope, or API compatibility change is allowed.
- Existing historical records automatically appear in the new weekly layout.

### Security and privacy

- The surface exposes only the date, sprint name if deliberately added later, and saved status
  already returned by the current endpoint. Do not add participant notes, Jira summaries, or
  bandwidth context to the history cards.
- Do not place session identifiers in visible copy. Normal React escaping remains sufficient.

### Accessibility

- Use native buttons for records, semantic headings for the section, and either grid semantics used
  correctly or simpler grouped list semantics. Do not add ARIA grid roles unless keyboard behavior
  and row/column relationships fully match them.
- Every card name includes formatted date and exact status; status is never color-only.
- Weekday abbreviations need full accessible names where the abbreviation is not self-explanatory.
- The horizontal region is keyboard reachable, has an explicit label, and keeps focused cards
  visible.
- Use existing global focus-visible treatment or a stronger scoped equivalent. Respect reduced
  motion; the design does not require animation.

### Observability

- No production telemetry is required for a local, read-only presentation change.
- Browser tests should make failures diagnosable through semantic names and deterministic mocked
  dates rather than pixel coordinates.

## 7. Verification

Before every Node/npm command, run `nvm use` from the repository root as required by
`AGENTS.md`.

### 7.1 Automated verification

Run, at minimum:

```bash
nvm use
npm run test --workspace @ecp/frontend -- loadDataset.test.ts standupRecords.test.ts
npm run typecheck --workspace @ecp/frontend
npm run e2e --workspace @ecp/frontend -- e2e/standup-records.spec.ts
npm run build --workspace @ecp/frontend
git diff --check
```

Adjust the Vitest path argument to the workspace-relative form required by the installed runner.
If focused commands pass, run the full frontend unit suite when practical because this work touches
the large Standup page component and shared stylesheet.

### 7.1.1 Verification results

Completed on 2026-08-30 after running `nvm use` (Node 22.22.3):

- `npm run test --workspace @ecp/frontend` — passed: 22 files, 117 tests.
- `npm run typecheck --workspace @ecp/frontend` — passed.
- `npm run e2e --workspace @ecp/frontend -- e2e/standup-records.spec.ts` — passed: 3 Chromium
  tests, covering weekly placement, status labels/icons, keyboard opening, narrow overflow,
  aggregate-load failure, successful unfinished-record deletion, and protected-delete errors.
- `npm run build --workspace @ecp/frontend` — passed. Vite retained its pre-existing advisory that
  an application chunk exceeds 500 kB after minification.
- `git diff --check` — passed.

Completed for the weekday-only refinement on 2026-08-30 after running `nvm use` (Node 22.22.3):

- `npm run test --workspace @ecp/frontend -- loadDataset.test.ts standupRecords.test.ts` — passed:
  2 files, 12 tests, including the backend `databaseMode: 'test-copy'` mode contract.
- `npm run typecheck --workspace @ecp/frontend` — passed.
- `npm run e2e --workspace @ecp/frontend -- e2e/standup-records.spec.ts` — passed: 4 Chromium
  tests, including weekday-only production mode and seven-day `test-copy` mode.
- `npm run build --workspace @ecp/frontend` — passed. Vite retained its pre-existing advisory that
  an application chunk exceeds 500 kB after minification.
- `git diff --check` — passed.

The in-app browser was unavailable in this session, so visual layout inspection at desktop and
narrow widths remains a manual validation step rather than a completed claim.

### 7.2 Manual verification

At a populated desktop viewport:

1. Open Standup for a team with records spanning at least two weeks.
2. Confirm weeks read newest-first and each record sits under the correct weekday.
3. Confirm completed and unfinished cards are distinguishable without visible status suffix text.
4. Hover and keyboard-focus cards; verify restrained card feedback and an unclipped focus ring.
5. Open completed, active, and post-standup records and confirm the correct existing modal/status
   appears.
6. Finish or delete a record, close the modal, and confirm history refreshes from server truth.
7. Change teams and confirm only the selected team's weeks appear.

At a narrow viewport (approximately 390px wide):

1. Confirm the page itself does not scroll horizontally.
2. In ordinary mode, confirm the single records region includes only Monday through Friday. In the
   disposable test database mode, confirm it scrolls to all seven weekday columns.
3. Confirm weekday headers stay aligned with every week row while scrolling.
4. Confirm card targets remain at least 44px and keyboard focus remains visible.
5. Confirm the empty state, list-load/open error, and read-only sample notice remain legible.

## 8. Acceptance criteria

- **Standup records** renders as occupied Monday-through-Friday workweek rows rather than
  standalone paragraphs; the disposable test database mode renders Monday-through-Sunday rows.
- Weeks are newest-first; days within each week are chronological and records occupy the correct
  weekday column across month and year boundaries.
- Empty weeks are omitted and empty day positions do not look like disabled record cards.
- Each record is a compact full-card button that opens the same historical Standup modal and does
  not mutate the session merely by opening it.
- Completion uses a compact icon. Completed, active, and post-standup states retain distinct
  accessible names, and the binary complete/incomplete visual meaning is explained without relying
  on color.
- Raw ISO date strings and appended `Completed` prose are no longer the primary visible treatment.
- The view uses existing planner tokens, compact radius/spacing conventions, and quiet nested
  surfaces.
- Desktop alignment is stable; narrow screens use one contained horizontal scroller with no
  page-level overflow and usable hit targets.
- Team changes, empty state, read-only sample behavior, list refresh, open errors, modal behavior,
  and the flat product/navigation model remain intact.
- Pure week grouping, test-mode detection, weekday/weekend visibility, status mapping, record
  opening, keyboard accessibility, and responsive containment have focused automated coverage.
- No backend, database, route, API, epic-filter, or product-constitution change is introduced.

## 9. Explicit non-goals and unresolved choices

### Non-goals

- A full month calendar, month navigation, date picker, search, pagination, or server-side history
  filtering.
- Creating standups from empty calendar days.
- Editing, finishing, or deleting directly from a history card.
- Showing participant counts, notes, tickets, bandwidth feelings, sprint progress, or epic details
  on the card.
- Changing Standup session status semantics or collapsing `active` and `post_standup` in the modal.
- Changing focus restoration for the existing modal unless implementation validation identifies a
  clear accessibility regression caused by the new cards.

### Implementation-time choices that do not change product direction

- Exact Lucide unfinished icon (`CircleDashed`, `Circle`, or closest available compatible icon).
- Whether the week label scrolls normally or becomes sticky at narrow widths.
- Whether a cross-month card shows a tiny month abbreviation when the row range already explains
  the boundary.
- Whether the focused records markup remains a local component or moves into
  `StandupRecords.tsx`. Prefer extraction if it keeps the already-large `RunStandupPage.tsx`
  readable without creating a one-use abstraction maze.

Document the chosen details here when implementation begins.

## 10. Continuation instructions

**Current status:** Slices 1–4 are implemented and automated checks pass. The implementation adds
`StandupRecords.tsx`, `standupRecords.ts`, focused unit/e2e coverage, scoped record-grid styling,
request-order protection while opening a historical record, and an every-record right-click delete
menu that reuses the established confirmation/API flow. The repository remains on
`feat/engineer-sprint-output-capacity` with unrelated user-owned modifications, including
`packages/frontend/src/styles.css`; preserve them.

**Next action:** Perform the manual desktop/narrow Standup validation in section 7.2. If the visual
result matches, update this plan to mark manual validation complete; otherwise record the observed
layout/accessibility issue before changing the implementation.

**First files to inspect after context reset:**

1. [`docs/standup-records-weekly-card-plan.md`](./standup-records-weekly-card-plan.md)
2. [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx),
   especially `RunStandupPage`, `refreshSessions`, `openRecord`, and `.standup-session-list`
3. [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css), including its current
   uncommitted diff and the `.panel`, Team workspace, Standup, and bandwidth calendar rules
4. [`packages/shared/src/domain.ts`](../packages/shared/src/domain.ts), especially `StandupStatus`
   and `StandupSession`
5. [`packages/backend/src/db/standup.ts`](../packages/backend/src/db/standup.ts), only to reconfirm
   ordering/uniqueness assumptions; backend edits are not planned
6. Existing Standup Playwright setup under `packages/frontend/e2e/`

**Initial commands:**

```bash
git status --short
git diff -- packages/frontend/src/styles.css packages/frontend/src/components/RunStandupPage.tsx
rg -n "standup-session-list|listStandups|openRecord|StandupStatus|StandupSession" \
  packages/frontend packages/shared packages/backend
nvm use
```

Keep this artifact current as implementation proceeds: mark completed slices, record verification
commands and results, capture any deviation from the weekly/card/status decisions, and update
**Next action** before ending each implementation slice.
