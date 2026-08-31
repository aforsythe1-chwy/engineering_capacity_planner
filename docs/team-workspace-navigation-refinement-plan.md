# Team Workspace Navigation Refinement — Durable Implementation Plan

**Status:** Implemented; manual validation ready

**Created:** 2026-08-29

**Last updated:** 2026-08-29 — implemented Slice 3 focused Team navigation regression coverage

**Scope:** refine the Team page's in-page navigation, engineer scope control, control hierarchy,
responsive layout, and accessibility without changing its data models, primary application
navigation, or analysis behavior

**Intended outcome:** make it immediately clear that **Team** is the page, **Bandwidth / Availability
/ Sprint output** are three peer analysis views, **Engineer** is a shared filter, and month or sprint
controls belong only to the active analysis

**Related guardrails and plans:**

- [Planner product constitution](./planner-product-constitution.md)
- [Team workspace, daily bandwidth check-ins, and calendar](./bandwidth-feelings-plan.md)
- [Engineer sprint output vs capacity](./engineer-sprint-output-capacity-plan.md)

This focused refinement plan is the source of truth for the Team navigation/layout change. The
related plans remain authoritative for their data, calculation, and persistence contracts.

## 1. Recommendation

Keep a compact tab treatment for the three views, but stop presenting the page title, shared
filter, and analysis switch as one large panel of equivalent controls.

Use this hierarchy:

```text
Team                                            [Team selector, only if needed]
Calendar analysis for team-owned signals…

[ Bandwidth ] [ Availability ] [ Sprint output ]        <- in-page analysis tabs

Engineer  [ All engineers / searchable person ]         <- shared scope toolbar

┌ Active analysis panel ───────────────────────────────────────────────────┐
│ Bandwidth — August 2026                         [Previous] [Today] [Next] │
│ explanatory copy                              [average/count view mode] │
│ …active analysis…                                                   │
└──────────────────────────────────────────────────────────────────────────┘
```

Availability keeps its calendar/list presentation and Add action inside the Availability panel.
Sprint output keeps sprint freshness and Retry inside the Sprint output panel. Month navigation is
shown only for Bandwidth and Availability; it is never displayed as though it affects Sprint output.

The analysis tabs should use the repository's quiet `.subtabs` visual language or a purpose-built
Team variant with the same tokens and compact geometry. They should not look like another row of
primary application tabs, and they should not return to the current large, heavily bordered
segmented block.

This is a hierarchy and interaction refinement, not a request for a sidebar, view cards, icons, or
a new route level. Three stable, glanceable choices are still a good fit for tabs. A sidebar would
consume disproportionate space, while a select would hide useful comparison and make switching
slower.

## 2. Verified current behavior and evidence

### 2.1 Page composition

Verified in `packages/frontend/src/components/TeamPage.tsx`:

- `TeamPage` owns a local `TeamView` state with `bandwidth`, `availability`, and `sprint-output`;
  Bandwidth is the default.
- A single `.panel.team-header` contains the **Team** heading, explanatory copy, optional Team
  selector, custom Engineer picker, and three-option segmented control.
- The Engineer selection is shared by all three analyses.
- Month state is shared by Bandwidth and Availability and survives switching between those views.
- Month controls are repeated inside the Bandwidth and Availability panels. Sprint output has no
  month semantics and loads the current Jira sprint when its component mounts.
- The analysis view is intentionally local state. The application route tracks the primary page,
  epic filter, and optional team; it does not model Team analyses as child routes.
- Changing teams currently does not explicitly clear an Engineer selection that does not belong to
  the new team. That can leave the next team filtered by a stale member ID and produce an apparently
  empty view.

Verified in `packages/frontend/src/styles.css`:

- `.team-header` and `.team-controls` are wrapping flex rows inside a standard 18px-padded panel.
- `.member-picker` has its own label and a minimum width of 180px.
- `.team-view-toggle` uses the generic `.segmented` container with a Team-specific active treatment.
- The combination makes page identity, a filter, and navigation appear at the same visual level.
- Team-specific responsive rules cover Sprint output and calendar overflow, but do not define a
  deliberate narrow layout for the Team heading, analysis tabs, and shared filter.

Verified in the current end-to-end suite:

- `packages/frontend/e2e/historical-bandwidth.spec.ts` exercises historical Bandwidth editing at
  desktop and narrow sizes.
- There is no focused end-to-end contract for switching Team analyses, preserving shared scope,
  clearing stale member scope after a team change, complete tab semantics, or narrow navigation
  layout.

### 2.2 Root cause

The problem is not the number or naming of the three analysis views. It is flattened hierarchy:

1. **Team** is primary-page identity.
2. **Bandwidth / Availability / Sprint output** choose the question being answered.
3. **Engineer** narrows the answer.
4. Month, calendar/list, average/count, Add, and Retry affect only one or two analyses.

The current header places levels 1–3 in one large bordered region and leaves level 4 in separate
content panels. At a glance, it is unclear whether Engineer is part of navigation, whether all
controls affect all views, and why the header consumes so much space before showing information.

The tab markup is also only partially tab-like: buttons have `role="tab"` and `aria-selected`, but
there is no associated `tabpanel`, `aria-controls`, roving tab stop, or Left/Right/Home/End keyboard
contract.

## 3. Decisions and invariants

### 3.1 Product and routing invariants

- Team remains one peer page in the planner's single primary navigation level.
- Bandwidth, Availability, and Sprint output remain in-page analyses, not routes, child apps, or a
  second primary navigation level.
- Do not add `/team/...`, a `portfolio`/`epic` view mode, or a required analysis query parameter.
- The global epic filter remains selected when entering or leaving Team but does not filter the
  Team roster, bandwidth, availability, or sprint-output aggregates.
- All-team data remains the useful default.
- The optional team query parameter remains independent from page and epic state.
- Switching analyses preserves selected team and valid Engineer scope. Bandwidth and Availability
  additionally preserve their shared month.

### 3.2 Visual hierarchy

- Remove the standard `.panel` treatment from the Team introduction/navigation shell.
- Use a compact page heading consistent with existing planner page headings: title, one short hint,
  and the conditional Team selector aligned as a page-scope control.
- Render the three analyses as one natural-width, quiet tab group directly after the heading.
- Put Engineer in a separately labeled, compact scope toolbar. Do not stretch it to fill the page.
- Keep the active analysis in the existing primary `.panel` surface.
- Keep view-specific actions next to the heading they affect.
- Use existing tokens, 8px control radii, quiet 1px borders, and the existing 13px body-control scale.
- Do not add icons: the three text labels are short and more explicit.
- Do not turn each analysis choice into a card.

### 3.3 Engineer filter

- Relabel the default option from **All team** to **All engineers** so the field label and value read
  as one sentence: **Engineer — All engineers**.
- Replace the bespoke `TeamMemberPicker` with the shared `Typeahead` configured as a local picker:
  `debounceMs={0}`, `showLoading={false}`, `searchOnEmpty`, `searchAllOnFocus`, and
  `selectValueOnFocus`.
- The committed selection must be the input value. Editing it clears the selected member ID until
  the user chooses a result.
- Include **All engineers** as the first local result and rank active team members by name using the
  repository's local fuzzy-search helper.
- Reuse member avatars in results if doing so only requires existing `Typeahead` hooks and shared
  avatar primitives. Avatar work is optional; correct selection semantics are not.
- When the selected team changes, retain the member only if that member belongs to the new active
  roster. Otherwise reset atomically to **All engineers** before rendering filtered results.
- When dataset refresh removes or deactivates the selected member, resolve the selection by the same
  rule rather than leaving a stale filter.

### 3.4 Tab interaction contract

- Use a `tablist` labeled **Team analysis**.
- Give every tab a stable ID and `aria-controls` reference.
- Render exactly one active `tabpanel` with `aria-labelledby` pointing to its tab.
- Only the selected tab is in the tab sequence (`tabIndex=0`); the others use `tabIndex=-1`.
- Left/Right Arrow moves and activates the adjacent tab, wrapping at the ends.
- Home activates Bandwidth; End activates Sprint output.
- Clicking a tab activates it without moving focus into the panel.
- Preserve readable labels; do not depend on color to communicate selection.
- Keep the visible focus ring already established by the repository.

Whether focus movement automatically activates a tab is resolved here in favor of automatic
activation because all three panels are local, activation is fast, and Sprint output already loads
only when mounted. If Sprint output later becomes slow enough to make keyboard traversal disruptive,
revisit that fetch behavior rather than silently changing tab semantics.

### 3.5 Analysis-specific controls

- Bandwidth: keep month navigation and average/count controls inside the Bandwidth panel header.
- Availability: keep month navigation, Add, and Calendar/List controls inside the Availability
  panel. Preserve the shared month when switching to or from Bandwidth.
- Sprint output: show Retry, sprint identity, freshness, and errors inside the Sprint output panel.
  Do not render month navigation or a disabled month control.
- Engineer continues to filter all three analyses.
- Error messages remain scoped to the operation that failed. A Bandwidth request error must not
  replace Availability or Sprint output navigation.

## 4. Explicit non-goals

- No backend, API, database, or shared-domain changes.
- No change to bandwidth scoring, availability calculations, sprint-output calculations, Jira
  freshness, or capacity truth.
- No multi-engineer selection.
- No new primary page, nested router, breadcrumbs, sidebar, or mobile bottom navigation.
- No persistence of the active analysis across a full reload in this slice.
- No redesign of the application-wide top navigation or global epic picker.
- No general redesign of Bandwidth calendar cells, Availability entries, or Sprint output rows.
- No SDD or Spec Kit artifacts.

## 5. Target component and state design

### 5.1 `TeamPage` remains the orchestrator

Refactor `packages/frontend/src/components/TeamPage.tsx` around these seams:

```tsx
<main className="team-page">
  <TeamWorkspaceHeading ... />
  <TeamAnalysisTabs value={view} onChange={setView} />
  <TeamScopeToolbar ... />
  <TeamAnalysisPanel view={view} ... />
</main>
```

These names describe responsibilities; they need not all become separate files. Keep
`TeamWorkspaceHeading`, `TeamAnalysisTabs`, and `TeamScopeToolbar` as local components initially.
Extract a shared primitive only if another page needs the same behavior.

Do not create a generic application tab abstraction as part of this refinement. The primary page
tabs and Team analysis tabs have different hierarchy and routing semantics.

### 5.2 State transitions

| Event | Active analysis | Engineer scope | Month | Network behavior |
| --- | --- | --- | --- | --- |
| Open Team | Bandwidth | All engineers | Current local month | Load Bandwidth month |
| Choose engineer | Unchanged | Chosen valid member | Unchanged | Re-filter current data; no route change |
| Bandwidth → Availability | Availability | Preserved | Preserved | Use dataset availability data |
| Availability → Sprint output | Sprint output | Preserved | Retained but hidden | Mount and load current sprint output |
| Sprint output → Bandwidth | Bandwidth | Preserved | Restored | Load month only if existing behavior requires it |
| Change team, member exists there | Unchanged | Preserved only by valid member ID | Preserved | Reload team-scoped active analysis |
| Change team, member invalid | Unchanged | Reset to All engineers | Preserved | Never render a stale empty filter |
| Dataset refresh invalidates member | Unchanged | Reset to All engineers | Preserved | Reconcile before filtering |

The code should derive a `validMemberId` or reconcile member selection in an effect keyed by team and
active roster. Avoid a render where `visibleMembers` and `visibleCheckIns` use an invalid member ID.

### 5.3 Availability seam

The Availability branch is currently a long inline JSX expression in `TeamPage`. Extract it to a
local `TeamAvailabilityPanel` component or a focused file while moving controls. Its props should be
domain data and callbacks, not the entire application state. This makes the new tabpanel boundary
readable and reduces the chance that ARIA wiring diverges between views.

### 5.4 Shared Typeahead configuration

Build the option list with stable member IDs and one stable sentinel ID for **All engineers**. Do not
use the empty string as a DOM ID suffix if it can produce ambiguous active-descendant IDs. Translate
the sentinel back to the existing empty-string member filter at the `TeamPage` state boundary if
changing internal state shape would create unnecessary churn.

The local search function must be memoized or module-stable so `Typeahead` does not restart its
effect on every render. Opening the field should show the full roster immediately. Selection should
restore the committed label and selected ID.

## 6. Styling and responsive behavior

Update the Team workspace section in `packages/frontend/src/styles.css` rather than adding a new
stylesheet.

### Desktop and medium widths

- Use a compact heading with no surrounding panel background.
- Keep tabs natural-width and left-aligned.
- Give the heading-to-tabs and tabs-to-toolbar joins a restrained 10–14px rhythm.
- Keep the scope toolbar transparent or visually quiet; it is a control row, not another card.
- Constrain the Engineer picker to an appropriate width, approximately 220–280px, while allowing it
  to shrink to the available width.
- Keep the content panel visually dominant.
- Remove obsolete `.team-header`, `.team-controls`, `.member-picker*`, and `.team-view-toggle` rules
  only after confirming Standup does not depend on the shared selectors. `RunStandupPage.tsx`
  currently uses `.team-header` and `.team-controls`, so either preserve their generic behavior or
  introduce Team-workspace-specific names before cleanup.

### Narrow widths

At approximately 700px and below:

- Stack the Team heading copy and optional Team selector.
- Let the tab group occupy the available width without clipping labels. Prefer three equal tracks at
  phone widths; if localization or text scaling makes that impossible, allow horizontal scrolling
  with a visible selected state rather than wrapping into an ambiguous two-row tablist.
- Make the Engineer picker width 100%.
- Let each active panel's title and actions stack in reading order.
- Preserve at least 44px pointer targets for tabs and picker input at narrow widths.
- Do not introduce page-level horizontal overflow. Existing Bandwidth calendar overflow remains
  contained within the calendar region.

Verify at 1320px, 960px, 700px, and 390px widths, and at 200% browser zoom.

## 7. Implementation slices

### Slice 1 — Semantic navigation shell and state safety

**Files:**

- `packages/frontend/src/components/TeamPage.tsx`
- `packages/frontend/src/styles.css`

**Work:**

1. Replace the panel-based Team header with the compact heading, Team analysis tablist, and scope
   toolbar structure.
2. Add complete tab/tabpanel IDs, keyboard behavior, and roving tab stops.
3. Add valid-member reconciliation on team or dataset changes.
4. Keep existing analysis data and actions in place while changing only their shell.

**Slice exit:** mouse and keyboard users can switch all three analyses, stale member scope cannot
produce an empty next-team view, and no calculation or mutation behavior changes.

### Slice 2 — Shared Engineer picker and analysis control placement

**Files:**

- `packages/frontend/src/components/TeamPage.tsx`
- `packages/frontend/src/components/Typeahead.tsx` only if a broadly useful missing behavior is
  discovered; prefer configuration over modification
- `packages/frontend/src/styles.css`

**Work:**

1. Replace `TeamMemberPicker` with a local-search `Typeahead` wrapper.
2. Implement committed-value, edit-clears-selection, full-roster-on-focus, All engineers, and
   keyboard selection contracts.
3. Extract the Availability panel seam.
4. Place month, Calendar/List, Add, Retry, and average/count controls only with the analyses they
   affect.
5. Remove obsolete Team-only picker styles after verifying no other component consumes them.

**Slice exit:** navigation, shared scope, and view-specific actions are visually and semantically
distinct at desktop and narrow widths.

### Slice 3 — Automated and visual regression coverage

**Files:**

- `packages/frontend/e2e/team-navigation.spec.ts` (new)
- `packages/frontend/e2e/historical-bandwidth.spec.ts` if selectors need semantic updates
- focused unit test file only if state reconciliation or tab movement is extracted as a pure helper

**Work:**

1. Add Team analysis switching and keyboard-tab coverage.
2. Assert Engineer scope survives analysis changes and clears when switching to a team that lacks
   the selected member.
3. Assert Bandwidth/Availability month continuity and the absence of month controls in Sprint output.
4. Assert Sprint output is fetched only when selected and errors remain within its panel.
5. Add narrow-viewport and no-horizontal-overflow checks.
6. Re-run historical Bandwidth coverage to protect modal focus restoration and calendar behavior.

**Slice exit:** the new hierarchy and state contract are guarded independently of visual class names
where practical.

## 8. Failure, concurrency, migration, security, and observability

### Failure and concurrency

- Preserve existing per-analysis error handling. Tabs and Engineer scope must remain usable when the
  active analysis fails.
- Keep the existing lazy Sprint output mount. Ensure late Sprint output responses cannot paint over
  a different team if that component's current request lifecycle is touched during refactoring.
- Reconcile Engineer selection synchronously from the active roster or before applying filters so a
  team change does not briefly announce or render zero results under a stale person.
- Disabling an analysis tab because its data source is unavailable is not allowed. Show its existing
  explanatory empty/error panel instead so the feature remains discoverable.

### Migration and compatibility

- No schema, API, persisted-data, or URL migration is required.
- Existing `?tab=team&team=...` URLs continue to open Bandwidth with All engineers.
- Back/forward behavior remains owned by primary page, epic, and team route state.

### Security and privacy

- Do not put Engineer selection, bandwidth notes, or check-in content into new URLs, logs, analytics,
  or error telemetry.
- Typeahead filtering is local over the already loaded roster; it must not add a search endpoint.

### Observability

- No production event tracking is needed for this visual refinement.
- Existing request diagnostics remain sufficient. If a fetch lifecycle bug is found, fix it at the
  request/component boundary rather than adding Team-navigation telemetry.

## 9. Automated verification

Before every Node-based command, run `nvm use` from the repository root.

```bash
nvm use
npm run typecheck --workspace @ecp/frontend
npm run test --workspace @ecp/frontend
npm run e2e --workspace @ecp/frontend -- team-navigation.spec.ts historical-bandwidth.spec.ts
npm run build --workspace @ecp/frontend
```

Required assertions include:

- exactly one Team analysis tab has `aria-selected="true"` and `tabIndex=0`;
- exactly one associated tabpanel is rendered;
- Left/Right/Home/End navigation wraps and activates the correct panel;
- click switching does not move focus unexpectedly;
- Engineer search opens the full local roster without a loading flash;
- typing clears the committed selection until a result is selected;
- All engineers restores aggregate results;
- Engineer selection survives all three analysis changes;
- a team switch resets an invalid Engineer selection;
- Bandwidth and Availability share the selected month;
- Sprint output contains no month navigation and does not fetch before selection;
- analysis errors leave navigation and scope controls operable;
- 390px viewport has no page-level horizontal overflow.

## 10. Manual validation

1. Open Team with one configured team. Confirm the page reads top-to-bottom as title, analysis tabs,
   Engineer scope, then the active content panel; there is no large empty navigation card.
2. Switch Bandwidth → Availability → Sprint output with a mouse. Confirm the Team heading and
   Engineer control remain stable while only the content and relevant actions change.
3. Repeat with Tab plus Arrow keys, Home, and End. Confirm focus is always visible and the active
   panel has a correct accessible name.
4. Choose an engineer, switch through all analyses, and confirm every analysis remains scoped to the
   same person.
5. Focus the Engineer field. Confirm the full roster appears immediately, the current value is
   selected for replacement, typing clears the committed filter, Escape restores a coherent state,
   and choosing All engineers restores aggregate data.
6. With multiple teams, choose an engineer and switch to another team. Confirm the field resets to
   All engineers unless the selected ID is actually valid for the new team.
7. Choose a non-current month in Bandwidth, switch to Availability, and confirm the same month.
   Switch to Sprint output and confirm no month control implies that the sprint is month-filtered.
8. Trigger or stub an error in each analysis. Confirm the tabs and Engineer field remain available
   and only the failing analysis reports the error.
9. Inspect at 1320px, 960px, 700px, and 390px, then at 200% zoom. Confirm no tab label clips, the
   filter is usable, panel actions stack sensibly, and the page does not overflow horizontally.
10. Re-open a historical Bandwidth day and complete the existing edit/save/close flow. Confirm modal
    focus still returns to the invoking day.

## 11. Acceptance criteria

- Team is visibly the page; the three analyses are visibly in-page tabs; Engineer is visibly a
  filter rather than a peer navigation destination.
- The oversized navigation panel shown in the current UI is gone.
- Bandwidth, Availability, and Sprint output remain discoverable at a glance with text labels.
- Tabs implement complete, keyboard-operable tab semantics and control one named tabpanel.
- The Engineer picker is compact, searchable, local, and uses **All engineers** as its aggregate
  state.
- Valid Engineer scope persists across analyses; invalid scope is cleared on team/dataset changes.
- Month controls appear only in Bandwidth and Availability and the selected month persists between
  them.
- Availability-only and Sprint-output-only actions remain inside their respective panels.
- Team remains independent of the global epic filter and introduces no new route hierarchy.
- Desktop, narrow, keyboard, error, loading, empty, and 200%-zoom states meet the verification
  contract.
- Existing historical Bandwidth and Availability operations still work.
- Frontend typecheck, tests, focused end-to-end tests, and build pass.

## 12. Continuation instructions

**Current status:** plan complete; no implementation files have been changed.

**Completed:** Slice 1 — the Team heading, analysis tabs, and shared scope toolbar are now separate
surfaces. Team analysis tabs use roving tab stops plus Left/Right/Home/End automatic activation and
one associated tabpanel. Engineer scope now reconciles synchronously to the active roster before
any filtered results render, and resets stale selections to the aggregate scope.

**Completed:** Slice 2 — Engineer now uses the shared local Typeahead: it exposes the committed
selection in the field, clears scope while edited, presents the full active roster on focus, and
uses a stable **All engineers** aggregate option. Availability is now a focused local panel
component, retaining all of its existing month, presentation, and Add controls.

**Completed:** Slice 3 — added `team-navigation.spec.ts` coverage for Team tab semantics and focus,
scope persistence and invalid-team resets, lazy Sprint output fetching, shared Bandwidth/Availability
month state, and 390px page overflow. The focused Team and historical Bandwidth browser suite, unit
suite, and production build pass.

**Verification update:** `npm run typecheck --workspace @ecp/frontend` now passes after resolving
the strict-null safety of the Sprint output gauge widths in `src/lib/engineerSprintOutput.ts`.

**Next action:** perform the manual validation checklist in §10 before release or review.

**First files to inspect:**

1. `packages/frontend/src/components/TeamPage.tsx`
2. the Team workspace section of `packages/frontend/src/styles.css`
3. `packages/frontend/src/components/Typeahead.tsx`
4. `packages/frontend/src/App.tsx` and `packages/frontend/src/lib/router.ts` to preserve route
   boundaries
5. `packages/frontend/e2e/historical-bandwidth.spec.ts`

**First commands:**

```bash
git status --short
rg -n "TeamPage|team-header|team-controls|team-view-toggle|member-picker" packages/frontend/src
nvm use
npm run typecheck --workspace @ecp/frontend
```

Keep this file current as slices are implemented. Change **Status**, mark completed slices, and
record material discoveries or deviations here so work can resume after conversation context is
cleared.
