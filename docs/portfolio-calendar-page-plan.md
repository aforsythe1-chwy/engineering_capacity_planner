# Portfolio Calendar Page Plan

**Status:** Implemented — automated validation complete; manual acceptance pending  
**Date:** 2026-08-16  
**Scope:** Rename the visible Timeline tab to Calendar, add a portfolio-aware month calendar above
the existing delivery-outlook list, and preserve the planner's flat navigation and shared-capacity
semantics.  
**Intended outcome:** The page opens with an at-a-glance calendar of dated portfolio delivery
signals. The current per-epic target/projection/health rows remain immediately below it as the
detailed list view.

## 1. Request and product intent

The current **Timeline** tab is primarily a compact row list. Change its user-facing name to
**Calendar** and make a calendar the page's primary view without removing the existing list.

The page must answer two related questions in one scroll:

1. **When are the important portfolio dates and capacity pressure?** — answered by the month grid.
2. **What is the delivery outlook for each epic?** — answered by the existing list below it.

This is a presentation change within the existing peer page. It does not create a drill-down mode,
a second navigation level, or a separate calendar data source.

## 2. Verified current state

The following are verified against the repository as of the plan date:

- [`packages/frontend/src/App.tsx`](../packages/frontend/src/App.tsx) defines the visible tab label
  as `Timeline`, keeps `timeline` as the `PlannerTab` value, and renders `PortfolioTimeline` for that
  route.
- `PortfolioTimeline` is currently local to `App.tsx`. It filters the portfolio projection rows by
  `selectedKeys` and renders one compact `.timeline-lane` per visible epic. It has no calendar.
- The list uses the shared result from `projectPortfolioFromDataset(dataset, today)`. It therefore
  does not recalculate a selected epic as though it owned all available team capacity.
- [`packages/engine/src/portfolio.ts`](../packages/engine/src/portfolio.ts) exposes the portfolio
  facts needed for this work:
  - per-epic health, projected dev-complete date, buffer, and estimate state;
  - portfolio week start/end, total capacity, total load, slack, and per-epic contributions.
- [`packages/frontend/src/lib/projection.ts`](../packages/frontend/src/lib/projection.ts) already
  distinguishes visible collections from full active-portfolio collections. An empty epic filter
  means all active epics.
- [`packages/frontend/src/components/ProjectionCalendar.tsx`](../packages/frontend/src/components/ProjectionCalendar.tsx)
  contains a polished single-month grid, paging controls, filters, week-spanning bars, exact-day
  event pills, a legend, and date/layout helpers. It is not currently rendered anywhere.
- `ProjectionCalendar` cannot be mounted on the portfolio page unchanged. Its contract requires one
  `EpicScope` and one single-epic `ProjectionResult`, and its sprint-load calculation is based on
  that epic's work. Using it directly would make all-active display impossible and risks violating
  shared-capacity truth in a filtered view.
- [`packages/frontend/src/components/Timeline.tsx`](../packages/frontend/src/components/Timeline.tsx)
  is also currently unused by `App.tsx`; it is the older single-epic horizontal axis, not the list
  shown on the present Timeline page.
- [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css) already has the calendar
  visual vocabulary under `.proj-calendar` / `.cal-*`, as well as the compact `.timeline-lane`
  list styles and the repository's dark design tokens.
- [`packages/frontend/e2e/timeline.spec.ts`](../packages/frontend/e2e/timeline.spec.ts) describes an
  older single-epic page composition and assumes it is the default page. It is stale relative to
  the flattened portfolio navigation and must be rewritten rather than treated as the current
  behavior contract.
- [`packages/frontend/e2e/portfolio.visual.spec.ts`](../packages/frontend/e2e/portfolio.visual.spec.ts)
  still asserts legacy `view=epic` URL behavior and is another test seam to reconcile while adding
  Calendar visual coverage.
- The worktree already contains unrelated user changes across frontend, engine, shared, and backend
  files. Implementation must preserve those changes and inspect the live diff before editing any
  overlapping file.

## 3. Product and implementation decisions

### 3.1 Page and routing

- Change the visible primary-tab label from **Timeline** to **Calendar**.
- Keep the internal route value and canonical query parameter as `tab=timeline` in this slice.
  The request is for the tab name and page content; changing the route key would add avoidable URL,
  legacy-link, and back/forward migration work without changing user value.
- Keep `data-testid="tab-timeline"` for compatibility unless the test suite is intentionally
  migrated in the same change. Accessible queries must expect the visible name `Calendar`.
- Keep Calendar as a peer of Overview, Dependencies, Gantt Planner, Team, Standup, and
  Configuration.
- Preserve the selected epic filter while entering or leaving the page. Selecting or clearing an
  epic while on Calendar must leave Calendar active.

### 3.2 What appears on the calendar

The first release displays only dated facts supported by current domain or projection data:

- every relevant day for each visible **Timeline** epic;
- a distinct treatment for each gating relevant day;
- projected dev-complete for each visible Timeline epic when the shared portfolio projection can
  produce one;
- a week-spanning shared-load band using `PortfolioProjection.weeks`, with total load, capacity,
  and slack;
- a today marker.

Event labels use the epic key as their first identity cue, for example `NF-123 · Production
Launch` and `NF-123 · Dev-complete`. Gating dates remain visually distinct from ordinary relevant
days. Dev-complete uses the epic's current delivery-health tone only when it is green, yellow, or
red; planning-input states use a neutral/warning treatment and are explained by the list.

Ongoing epics do not receive invented completion dates. Their dated capacity reservations remain
included in the shared-load band and their existing list rows remain below the calendar. Dormant
Timeline milestones retained on an Ongoing epic are not shown until that epic is classified as
Timeline again.

### 3.3 Explicit first-release non-goals

- Do not place individual work items on calendar dates. Unplaced work has no trustworthy date, and
  Gantt Planner remains the work-placement surface.
- Do not add drag/drop or editing to the calendar. Relevant days remain editable through
  Configuration; work placement remains in Gantt Planner.
- Do not duplicate Team's availability or bandwidth calendars on this page. PTO and on-call already
  affect projected capacity and are therefore reflected indirectly in the shared-load result.
- Do not restore the older horizontal `Timeline` component above the calendar.
- Do not change engine allocation, portfolio health rules, backend APIs, persistence, or schemas.
- Do not rename the domain classification values `planningKind: 'timeline' | 'ongoing'`; the tab
  label and the epic planning kind are separate concepts.
- Do not implement multi-epic selection UI. Continue accepting `selectedKeys: string[]` contracts so
  the page remains future-multi-epic-ready.

### 3.4 Filter and capacity semantics

- With no selected epic, calendar events include all active Timeline epics and the list includes all
  active epics.
- With an epic filter, exact-day events and list rows are limited to the selected visible epic set.
- The weekly band always represents total active-portfolio load and capacity. It must never be
  rebuilt from filtered work.
- When a filter is active, expose the selected epic contribution alongside the total in the band
  label or accessible description, matching the established Overview pattern: for example,
  `42 / 50 pts total · 12 pts selected`.
- Cross-epic pressure therefore remains visible even when only one epic's dates and list row are
  shown.

### 3.5 Calendar interaction and density

- Open on the month containing the effective planning date.
- Provide **Previous**, **Today**, and **Next** controls. Calendar month and layer visibility are
  explicit local calendar state, independent from the epic filter.
- Show layer controls for **Relevant days**, **Projected completion**, and **Shared load**. All are on
  by default. Reuse the current compact filter-menu interaction and close it on Escape or outside
  pointer interaction.
- Derive the useful date extent from today, visible dates, projected completions, and portfolio
  weeks for empty-state messaging and testing. Month navigation itself should not strand the user
  behind disabled controls at a calculated boundary; users may inspect adjacent months and return
  with Today.
- Preserve the seven-day week. On narrow screens, put the grid in a labelled horizontal scroll
  region with a practical minimum width rather than collapsing the week to four columns.
- Prevent a dense day from growing without bound. Show a small deterministic number of event pills
  and a keyboard-operable `+N more` disclosure or popover for the rest. Do not discard hidden events
  from the accessible experience.
- Keep the existing delivery list directly below the calendar. Rename its heading from `Portfolio
  timeline` to **Delivery outlook** and retain its target, projection, modeled work, estimate-review,
  health, reason, and buffer content.

## 4. Target component and data contracts

### 4.1 Pure portfolio calendar model

Add a pure model builder, proposed at
[`packages/frontend/src/lib/portfolioCalendar.ts`](../packages/frontend/src/lib/portfolioCalendar.ts):

```ts
type PortfolioCalendarEvent = {
  id: string;
  date: IsoDate;
  epicKey: string;
  label: string;
  kind: 'gating' | 'milestone' | 'dev-complete';
  health?: PortfolioHealth;
};

type PortfolioCalendarWeek = {
  start: IsoDate;
  end: IsoDate;
  capacity: number;
  totalLoad: number;
  selectedLoad: number | null;
  slack: number;
  contributingEpicKeys: string[];
};

type PortfolioCalendarModel = {
  today: IsoDate;
  events: PortfolioCalendarEvent[];
  weeks: PortfolioCalendarWeek[];
  hasVisibleDatedEvents: boolean;
};
```

The exact names may change during implementation, but the separation is required:

- `dataset` supplies epic identity, planning kind, and relevant days;
- the already-computed `PortfolioProjection` supplies dev-complete and weekly shared-load truth;
- `selectedKeys` affects visible events and `selectedLoad`, never `totalLoad`, `capacity`, or `slack`;
- deterministic sorting is date, event-kind priority, epic key, then stable ID.

Unit-test this model without React. Calendar grid helpers that are genuinely generic may be moved
out of `ProjectionCalendar.tsx` into a small shared calendar utility. Do not force the portfolio
model into the single-epic `EpicScope` contract.

### 4.2 Page components

Extract the page from `App.tsx` so it does not continue growing. Proposed seams:

- `components/PortfolioCalendarPage.tsx` — page composition and section order;
- `components/PortfolioMonthCalendar.tsx` — toolbar, month grid, event density disclosure, weekly
  load band, legend, and accessibility;
- `components/DeliveryOutlookList.tsx` — the current `PortfolioTimeline` rows with only naming and
  semantic markup changes.

`PlannerPage` should pass the full `dataset`, full portfolio `projection`, `selectedKeys`, and one
effective `today` value to `PortfolioCalendarPage`. The page must not invoke the engine again.

### 4.3 Effective planning date

Centralize browser-local `YYYY-MM-DD` generation instead of using
`new Date().toISOString().slice(0, 10)`, which can name the wrong local day around midnight. Honor
the repository's global `planning_today` setting when present so synthetic and deterministic
visual/test data can open on its intended month. Feed the same date to the portfolio projection,
Calendar page, Overview, and other portfolio consumers touched by this refactor; do not allow the
calendar's today marker to disagree with the projection's start date.

If centralizing all existing callers would materially broaden the slice, first add one shared
frontend helper and migrate the projection and Calendar callers together, then record the remaining
callers in this plan's continuation notes rather than creating another inline date implementation.

## 5. Styling and visual behavior

- Extend the existing dark system in `styles.css`: `--panel` for the calendar surface, `--panel-2`
  for nested controls/events, quiet `--border`, and the established accent/status colors.
- Reuse the compact 8–10px radius family, 13px body controls, existing focus-visible outline, and
  `.panel`, `.btn`, and filter patterns where their semantics fit.
- Keep the calendar and list as two clearly separated primary sections with page background visible
  between them; do not wrap the entire page in stacked nested cards.
- Make shared load the spanning weekly context, not a collection of visually competing per-epic
  bars. Exact dates remain compact pills inside their day.
- Keep epic key text visible in event pills when space permits; truncation must retain the complete
  label through an accessible name and desktop tooltip.
- Retain readable list rows on narrow screens by replacing the fixed multi-column lane layout with
  responsive wrapping or named metric pairs. Do not rely only on horizontal scrolling for the list.
- Verify the join below the primary tabs and above the first calendar panel has the same restrained
  spacing as other planner pages.

## 6. Accessibility contract

- The Calendar tab is a normal primary navigation button with visible text `Calendar`.
- Calendar navigation buttons have explicit accessible names and predictable disabled behavior only
  when an action truly cannot occur.
- The month has a programmatic heading. The grid exposes complete dates, not day numbers alone.
- Today, gating, milestone, dev-complete, and health/load state are never communicated by color
  alone; text or accessible labels include the state.
- Layer controls are native checkboxes or correctly implemented tabs/menu checkboxes with accurate
  `aria-checked` / `aria-expanded` state.
- Dense-day disclosure is reachable and operable by keyboard, closes with Escape, returns focus to
  its trigger, and exposes every hidden event.
- Shared-load descriptions state total load and capacity first, then selected contribution when a
  filter is active.
- Keep source order Calendar then Delivery outlook so keyboard and screen-reader order matches the
  visual page.

## 7. Failure, migration, security, and observability

### Failure and empty states

- No active epics: preserve the planner's existing setup/empty behavior before this page renders.
- Active epics but no dated events: render the current month and an inline message explaining that
  Timeline epics need relevant days or a forecast; still show shared load if available and retain
  the list below.
- An epic with no gating target or estimate: omit its unavailable dev-complete event and explain the
  planning state in its existing list row; do not fabricate a date.
- A projection with no weeks: render no weekly load bars and show a restrained `No scheduled load`
  legend/empty cue.
- Dates outside the currently displayed month remain reachable through month navigation.

### Concurrency and migration

- The page is read-only and derives from the loaded dataset, so it introduces no mutation races.
- Dataset reload replaces the projection and model atomically through the existing app state.
- No database, API, or stored-data migration is required.
- Existing `?tab=timeline` links continue to work unchanged. The visible label change is the only
  navigation migration in this slice.

### Security and observability

- No new external content, HTML injection, permissions, credentials, or network calls are needed.
- No production telemetry is required for this local planner presentation change.
- Development observability comes from stable test IDs for the page, month, days, event kinds, load
  bands, and delivery list, plus engine/model unit tests that make capacity-source regressions
  visible.

## 8. Ordered implementation slices

### Slice 1 — Calendar model and shared date contract

1. Inspect the current diff in `App.tsx`, `portfolio.ts`, `styles.css`, and related test files before
   editing; preserve the user's in-progress changes.
2. Add the pure portfolio-calendar model and unit tests.
3. Add or centralize the browser-local/effective planning-date helper and make Calendar projection
   inputs share it.
4. If extracting month-grid helpers from `ProjectionCalendar.tsx`, keep its behavior intact and add
   characterization tests before moving logic.

**Exit:** tests prove that empty selection shows all Timeline epic dates, selected events filter,
total weekly load never filters, selected contribution does filter, Ongoing epics get no invented
completion, and local/effective today is deterministic.

### Slice 2 — Portfolio month calendar UI

1. Implement `PortfolioMonthCalendar` from the pure model.
2. Reuse/refine the established month toolbar, grid, event, filter, and legend visual patterns.
3. Implement total shared-load bars and selected-contribution disclosure.
4. Implement empty states and dense-day disclosure.
5. Add component/E2E coverage for navigation, layers, event labels, load truth, keyboard behavior,
   and narrow-screen containment.

**Exit:** a populated and empty calendar can be inspected at desktop and narrow widths without
overflowing the page, hiding events from assistive technology, or misstating capacity.

### Slice 3 — Page composition, rename, and retained list

1. Extract the current list into `DeliveryOutlookList` without changing its projection source.
2. Compose Calendar first and Delivery outlook second in `PortfolioCalendarPage`.
3. Change the primary-tab label to Calendar while preserving the internal `timeline` route.
4. Update styles for section rhythm and responsive list rows.
5. Verify all-active and one-epic filtered states and page/filter preservation through browser
   history.

**Exit:** clicking Calendar displays the month grid above the complete retained list; switching
pages or changing epic scope preserves the constitution's route/filter invariants.

### Slice 4 — Test reconciliation and visual QA

1. Rewrite stale single-epic assumptions in `e2e/timeline.spec.ts` around the current flattened
   planner and new Calendar page.
2. Update `portfolio.visual.spec.ts` to canonical current routing before adding Calendar screenshots.
3. Capture populated, filtered, empty/planning-incomplete, dense-day, and narrow viewport states.
4. Run frontend unit/type/lint/build checks and focused Playwright tests after `nvm use` from the
   repository root.
5. Run `git diff --check` and review the final diff specifically for accidental changes to the
   user's existing work.

**Exit:** automated checks pass, screenshots show a calm and readable hierarchy, and manual
validation covers desktop, narrow, mouse, keyboard, all-active, and filtered behavior.

## 9. Automated verification

Add focused tests for:

- portfolio calendar model event construction, stable ordering, and duplicate-date handling;
- gating versus ordinary milestone classification;
- dev-complete inclusion/omission across green, yellow, red, needs-target, needs-estimates,
  needs-plan, and ongoing states;
- all-active and selected event filtering;
- full portfolio week totals remaining identical before and after event filtering;
- selected weekly contribution calculation;
- effective local/planning date and month-grid boundaries, including leap year and year rollover;
- empty event and empty week models;
- previous/next/today month behavior and layer toggles;
- dense-day disclosure keyboard behavior;
- visible `Calendar` tab text with the existing `tab=timeline` URL;
- DOM order: portfolio month calendar before Delivery outlook;
- responsive page containment at a narrow viewport;
- route/filter preservation through tab changes, filter changes, reload, back, and forward.

Likely commands, always from the repository root and only after `nvm use`:

```sh
nvm use
npm --workspace @ecp/frontend test
npm --workspace @ecp/frontend run typecheck
npm --workspace @ecp/frontend run build
npm --workspace @ecp/frontend run e2e -- timeline.spec.ts --workers=1 --reporter=list
git diff --check
```

Confirm the exact script names in the root and frontend `package.json` before running them.

## 10. Manual verification walkthrough

1. Open the planner with all active epics and select **Calendar**. Confirm the URL uses
   `?tab=timeline`, the visible tab says Calendar, and the month grid is above Delivery outlook.
2. Confirm the current/effective day is highlighted and Today returns to that month after paging.
3. Inspect a month containing several epic dates. Confirm every pill begins with an epic key,
   gating dates are distinguishable, and projected completion carries text plus health tone.
4. Inspect a week band and compare it with Overview shared capacity. Confirm total load/capacity
   agrees.
5. Filter to one epic. Confirm exact-day events and list rows narrow to it while week-band totals do
   not change; confirm the selected contribution is disclosed separately.
6. Clear the filter and confirm all-active content returns without leaving Calendar.
7. Toggle each calendar layer, close the menu with Escape and an outside click, and operate month
   navigation using only the keyboard.
8. Inspect an Ongoing epic, a Timeline epic without a target, and one needing estimates. Confirm no
   completion date is fabricated and the list explains the missing planning state.
9. Inspect a deliberately dense day and open `+N more` using keyboard and pointer. Confirm all
   events are readable and focus returns correctly on close.
10. Repeat at approximately 390px width. Confirm the seven-day grid scrolls within its labelled
    region, the whole page does not overflow, and Delivery outlook metrics wrap readably.
11. Navigate Calendar → Dependencies → Calendar and use browser back/forward. Confirm page and epic
    filter remain independent and shareable.

## 11. Acceptance criteria

- The primary tab visibly reads **Calendar**.
- Existing `?tab=timeline` URLs still open the renamed page and remain canonical for this slice.
- A portfolio month calendar is the first substantive view on the page.
- Delivery outlook retains all information currently shown by the Timeline list and appears below
  the calendar.
- All-active mode is useful without selecting an epic.
- Epic filtering changes visible calendar events and list rows but never recalculates or hides total
  shared-capacity load.
- Gating relevant days, ordinary relevant days, projected completion, today, and weekly shared load
  are textually and visually distinguishable.
- Ongoing or planning-incomplete epics never receive fabricated dates.
- Calendar controls, dense-day disclosure, and events are keyboard/screen-reader usable and do not
  rely on color alone.
- Desktop and narrow layouts preserve a seven-day calendar and avoid page-level horizontal
  overflow.
- No backend/API/schema changes are introduced.
- Focused unit, integration/E2E, build/type, and manual visual checks pass.
- The implementation preserves unrelated pre-existing worktree changes.

## 12. Continuation record

**Current status:** All four slices implemented on 2026-08-16. The visible tab is Calendar while
the canonical route remains `tab=timeline`; the portfolio calendar model, month UI, dense-day
disclosure, shared-load context, effective planning date, retained Delivery outlook, responsive
styles, and reconciled tests are present. Automated unit, typecheck, build, focused Playwright,
and deterministic visual checks pass. Manual acceptance remains pending.  
**Next action:** Run the manual verification walkthrough in section 10 against the user's preferred
live dataset and report any mismatch.  
**First files to inspect:**

1. `packages/frontend/src/App.tsx`
2. `packages/frontend/src/lib/portfolioOverview.ts`
3. `packages/engine/src/portfolio.ts`
4. `packages/frontend/src/components/ProjectionCalendar.tsx`
5. `packages/frontend/src/styles.css`
6. `packages/frontend/e2e/timeline.spec.ts`
7. `packages/frontend/e2e/portfolio.visual.spec.ts`

**Completed validation commands:**

```sh
npm --workspace @ecp/frontend test
npm --workspace @ecp/frontend run typecheck
npm --workspace @ecp/frontend run build
npm --workspace @ecp/frontend run e2e -- timeline.spec.ts --workers=1 --reporter=list
npm --workspace @ecp/frontend run e2e -- portfolio.visual.spec.ts --workers=1 --reporter=list
git diff --check
```

Update this continuation record and slice status after every completed implementation slice. Record
material deviations here so a future agent does not need the original conversation to resume.
