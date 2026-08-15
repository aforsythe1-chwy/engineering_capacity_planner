# Board Epic Configuration and Epic Kinds — Durable Implementation Plan

**Status:** Proposed  
**Created:** 2026-08-15  
**Scope:** configuration UX, board-epic portfolio intent, timeline/ongoing epic behavior, shared-capacity projection, persistence, API, and verification  
**Constraints:** no Spec Kit/SDD; preserve the flat planner and the invariants in `planner-product-constitution.md`

## 1. Outcome

Allow a user to decide which epics discovered on the configured Jira board belong in this planner,
using a keyboard-accessible fuzzy finder in Configuration. A tracked epic is classified as one of:

- **Timeline** — finite delivery work with a gating target and an expected completion.
- **Ongoing** — continuous work such as KTLO or intern initiatives; it consumes team capacity but
  has no launch-oriented health verdict or projected end date.

Epics not selected for tracking remain discoverable from the board but do not appear in the
planner's normal epic scope. This choice is local planning intent, survives Jira sync, and must not
be overwritten by Jira facts.

This feature configures the managed portfolio. It does not create another navigation level and it
does not replace the page-level Epic filter.

## 2. Current-state findings

The repository already contains most of the architectural seam needed for tracked-epic selection:

- Jira sync discovers all unresolved board roots with remaining work and stores them as `Epic`
  facts.
- `portfolio_epic` stores local `scope_override` (`auto | include | exclude`) and `priority`.
- `PUT /api/portfolio/epics/:key` persists that intent, and reconciliation preserves
  `portfolioEpics` across syncs.
- `projectPortfolioFromDataset()` and `buildPlannerScope()` already omit `exclude` rows.
- The route-backed `EpicPicker` only offers effective active-portfolio epics, so excluded epics
  disappear from page filters as desired.
- The Jira setup preview reads scope overrides, but currently returns only effectively included
  candidates. The Configuration UI therefore has no reliable board-candidate directory from which
  to re-add an excluded epic.
- The frontend has no client or UI for the existing portfolio-intent write endpoint.
- The current shared projection only schedules epics with a gating milestone. An ongoing epic with
  no gate would therefore consume no projected capacity and would be mislabeled `needs-target`.
- Milestone mutations currently enforce that an existing gating milestone cannot be demoted or
  deleted without promoting another. A kind change must not work around that invariant by
  destructively deleting dates.
- Configuration is partly global/team-scoped and partly controlled by the transient page epic
  filter. The new tracked-epic section is portfolio-scoped and must always remain visible on the
  Configuration page.

## 3. Product vocabulary and state boundaries

Use distinct names for three different concepts that are easy to conflate:

| Concept | Meaning | Owner | Persistence |
| --- | --- | --- | --- |
| Board candidate | Jira root currently discoverable from the configured board | Jira fact | Refreshed by discovery/sync |
| Tracked epic | Candidate included in this planner's managed portfolio | Local intent | `portfolio_epic.scope_override` |
| Page epic filter | Temporary choice of which tracked epic(s) a page emphasizes | URL/UI state | `?epics=...` |

The UI may use the friendlier heading **Tracked epics** instead of **Visible epics**. Supporting
copy must say that removing an epic removes its work from this planner's capacity model. This avoids
presenting a capacity-changing operation as a harmless display preference.

The product constitution continues to apply inside the configured portfolio:

- an empty page filter means all tracked active epics;
- changing tracked membership is a Configuration mutation, not navigation;
- changing the page filter never changes tracked membership;
- all tracked timeline and ongoing work contributes to the same team-capacity truth;
- cross-epic context is retained among tracked epics;
- URL state stays page-plus-filter and remains future-multi-select-ready.

## 4. Recommended domain model

### 4.1 Keep Jira facts and local planning intent separate

Do not add kind or visibility to `Epic`. `Epic` remains the Jira-owned lifecycle record. Extend
`PortfolioEpic`, the existing local-intent record:

```ts
export type EpicPlanningKind = 'timeline' | 'ongoing';

export interface PortfolioEpic {
  epicKey: string;
  scopeOverride: 'auto' | 'include' | 'exclude';
  planningKind: EpicPlanningKind;
  priority: number;
}
```

Effective defaults:

- no `portfolio_epic` row: `scopeOverride = 'auto'`, `planningKind = 'timeline'`, `priority = 0`;
- existing rows migrated without a kind: `planningKind = 'timeline'`;
- newly discovered epics remain automatic timeline epics until the user classifies or excludes
  them.

Defaulting to timeline preserves existing behavior and avoids silently changing current health
results. The configuration UI should make unreviewed automatic entries recognizable so users can
classify them deliberately.

### 4.2 Centralize effective intent

Add one shared pure resolver, rather than repeating `portfolioEpics?.find(...)` across the engine
and frontend:

```ts
effectivePortfolioEpic(dataset, epicKey): {
  scopeOverride: PortfolioScopeOverride;
  planningKind: EpicPlanningKind;
  priority: number;
  tracked: boolean;
}
```

`tracked` is true when the imported epic is active and the effective override is not `exclude`.
`auto` follows the board/default-active rule. `include` is applied during board discovery/import so
an otherwise-ineligible board candidate is retained as active; after import, the same resolver can
remain simple and deterministic. All selectors, projection code, API summaries, and UI lists must
use the resolver instead of reimplementing the rule.

### 4.3 State-transition behavior

| Transition | Required behavior |
| --- | --- |
| Tracked -> excluded | Remove from normal pages and modeled portfolio capacity; retain Jira facts, kind, priority, milestones, label settings, and placement history |
| Excluded -> tracked | Restore with its previous kind/intent; prefer `auto` for a currently eligible board candidate and `include` only for an explicit force-include |
| Timeline -> ongoing | Stop using gating dates and completion/buffer health; preserve existing milestones as dormant local data |
| Ongoing -> timeline | Restore preserved milestones; if no gate exists, show `needs-target` and guide the user to configure one |
| Jira active -> archived | Retain all local intent and history; remove from normal tracked scope |
| Jira archived -> active again | Restore the previous include/exclude choice and planning kind |
| Board changed | Use the newly configured board as the discovery source; retain old intent/history until sync archives missing epics, without showing old-board epics as current candidates |

Kind changes must be non-destructive. In particular, switching to ongoing must not delete
milestones merely to satisfy the presentation model.

## 5. Projection and health semantics

### 5.1 Timeline epics

Keep the current date-driven behavior:

- a gating milestone is required for a delivery verdict;
- projected completion, working-day buffer, and red/yellow/green health remain meaningful;
- missing gates yield `needs-target`;
- missing estimates remain explicit rather than appearing healthy.

### 5.2 Ongoing epics

Add `ongoing` as an explicit portfolio presentation state instead of treating the epic as
`needs-target`. For ongoing epics:

- do not require or synthesize a gating milestone;
- do not calculate projected completion or buffer;
- do not show launch, target, or completion controls in normal UI;
- continue to show remaining points, estimate completeness, placement coverage, assignees, and
  capacity contribution;
- allow estimate/planning warnings to take precedence where action is required.

Recommended state precedence for an ongoing epic:

1. `needs-estimates` when remaining work is unestimated;
2. `needs-plan` when estimated remaining work has no dated placement/reservation;
3. `ongoing` when its currently known remaining work is represented in the dated plan.

The `PortfolioHealth` union and all label/color mappings must be exhaustive after adding
`ongoing`. It should use a neutral visual treatment, not green, because continuous work is not a
delivery promise that has been proven healthy.

### 5.3 Capacity treatment

Ongoing work must not disappear from shared capacity merely because it has no target. For the first
implementation, use explicit planning data rather than inventing an end date:

1. Convert ongoing work placements into dated weekly load/reservations.
2. Reserve that load from the team's weekly capacity.
3. Project timeline work against the remaining capacity, retaining its existing target/priority
   ordering.
4. Report unplaced ongoing work as unscheduled/`needs-plan`; do not silently allocate it at the end
   of the horizon or assume that it costs nothing.
5. Keep per-week contribution records for both kinds so a filtered page can explain total load.

For deterministic day-level forecasting, resolve each placement to its sprint/week date interval,
aggregate ongoing points for that interval, and spread the reservation proportionally across its
working days. Clamp the residual capacity available to timeline allocation at zero; if the ongoing
reservation itself exceeds raw weekly capacity, retain the excess as an explicit overload rather
than feeding negative capacity into the allocator. Assigned-member precision can be layered onto
this later without changing the epic-kind contract.

This may expose a broader mismatch: the current portfolio projection derives its weekly load from
target-ordered work rather than treating stored placements as authoritative reservations. The
implementation should isolate a pure `buildPortfolioScheduleInputs()` (or equivalent) and add
invariant tests before changing allocation. Do not patch ongoing work into the candidate list with
a fake far-future target; that would make results depend on an invented launch date.

A percentage-based standing reservation for KTLO may be valuable later, but it is not part of this
request. Add it only when there is a concrete configuration requirement.

## 6. Persistence and migration

Extend `portfolio_epic` with:

```sql
planning_kind TEXT NOT NULL DEFAULT 'timeline'
  CHECK (planning_kind IN ('timeline', 'ongoing'))
```

Implementation requirements:

- include the column in the fresh schema, additive migration, insert, read, and snapshot/import
  paths;
- use an idempotent migration for existing SQLite databases;
- because older databases and JSON fixtures may have no intent row, resolve the effective default
  in one helper rather than requiring eager backfill rows for every epic;
- ensure sync reconciliation preserves `planningKind` alongside scope and priority;
- retain intent rows for archived epics while their epic FK remains retained;
- validate values at the repository boundary even if SQLite also has a check constraint;
- add a round-trip test for both kinds and an old-schema migration test.

If SQLite's additive `ALTER TABLE` path cannot add the desired check constraint safely, add the
column with the default, enforce the enum in application validation, and keep the constraint in the
fresh schema. A table rebuild is unnecessary for this small compatibility gap.

## 7. Backend and API design

### 7.1 Make the existing per-epic update safe and complete

Extend `PUT /api/portfolio/epics/:key` to accept a partial intent patch:

```json
{
  "scopeOverride": "auto",
  "planningKind": "ongoing",
  "priority": 0
}
```

The current route supplies default values for omitted properties, which can reset unrelated intent.
Move the mutation into the validated repository layer and merge omitted fields with the effective
current values before upserting. Return the complete resulting `PortfolioEpic`.

Required validation:

- epic exists;
- scope is `auto | include | exclude`;
- kind is `timeline | ongoing`;
- priority is an integer;
- an empty patch is rejected.

Per-epic writes are sufficient for immediate add/remove/classify interactions. Do not add a bulk
replacement endpoint unless the UI deliberately adopts an explicit multi-change Save workflow.

### 7.2 Return board candidates, not only included epics

Evolve `GET /api/jira/epic-scope/preview` compatibly:

- retain the existing effective `epics` list while callers migrate;
- add a `candidates` collection containing every discovered board root, including excluded and
  default-ineligible roots;
- include lifecycle/status, remaining counts, default eligibility/exclusion reason, effective
  scope override, effective planning kind, and whether it is currently tracked;
- keep the selected board ID in diagnostics and make clear which board produced the result.

This makes an excluded epic searchable and re-addable without using project-wide Jira search, which
could surface epics outside the selected board. When Jira discovery is unavailable, the
Configuration section may fall back to locally stored epics and clearly label the list as the last
synced state.

### 7.3 Align portfolio reads and sync behavior

- Extend `GET /api/portfolio` summaries with effective scope and kind.
- Keep excluded epics in raw sync/import data so their Jira facts can remain current; exclusion is a
  planning decision, not a command to stop fetching data.
- Pass portfolio intent into active-board discovery. A force-included board root must be fetched and
  imported even when the default status/remaining-work rule would omit it; a force-excluded root may
  still be refreshed as a fact but must not become tracked.
- Apply effective inclusion exactly once at the portfolio/scope boundary.
- Preserve intent during reconcile and test archive/reactivation behavior.
- Update sync-log wording only when the effective tracked set changes; a kind-only change belongs
  to configuration history if/when local configuration auditing is introduced, not Jira sync logs.

## 8. Configuration experience

### 8.1 Placement and independence from the page filter

Add a **Tracked epics** panel near the top of Configuration, before epic-specific label/milestone
sections. It is portfolio-scoped and always renders, regardless of the current page Epic filter.

Suggested copy:

> Choose the board epics this planner should track. Tracked epics share the team's modeled
> capacity. Removing an epic keeps its saved settings but removes its work from this plan.

Show the configured board name and candidate freshness (`live preview` or `last synced`) so the user
knows what the picker is searching.

### 8.2 Fuzzy selection

Build a local, multi-selection combobox from the board-candidate response:

- fuzzy-match normalized epic key and title using the existing deterministic epic ranker;
- open on focus and support searching an empty query;
- exclude already tracked entries from add results or mark them selected;
- display key, title, Jira status, remaining items/points, and an excluded/ineligible explanation;
- support Arrow Up/Down, Enter, Escape, active descendant, listbox/option semantics, outside-click
  close, and visible focus;
- do not issue one Jira request per keystroke—the candidate set is already small and local;
- reuse visual primitives from the team/member typeahead, but prefer the keyboard behavior and pure
  ranker used by `EpicPicker`.

Selecting an eligible candidate should add it as `auto` with kind `timeline`. A result that requires
force inclusion must say so and require a deliberate **Include anyway** action.

### 8.3 Tracked list and classification

Below the finder, show tracked epics in two labeled groups or one accessible list with a kind
control:

- epic key/title and source status;
- **Timeline / Ongoing** segmented control or select;
- remaining and unestimated-work counts;
- target summary for timeline epics;
- **Remove from plan** action with capacity-impact language;
- optimistic interaction only if failures can roll back cleanly; otherwise show a row-level busy
  state, persist, reload, and retain focus.

Do not use the top-shell `EpicPicker` itself as the editor: it only knows effective tracked epics and
is route/filter-oriented. Share a generic fuzzy ranking/helper or extract an accessible local
combobox primitive so filter and configuration behavior do not drift.

### 8.4 Epic-specific configuration

When a timeline epic is selected by the page filter, continue showing Gantt-label and Relevant-days
sections. When an ongoing epic is selected:

- keep Gantt-label controls;
- replace Relevant days with a concise explanation that ongoing epics do not use launch/gating
  dates;
- do not expose milestone create/promote/delete controls;
- leave preserved milestones untouched and optionally disclose that they will return if the epic is
  changed back to Timeline.

When all epics are shown, the Epic settings directory should mark each epic's kind and only list
tracked epics. Choosing one still changes the page filter without leaving Configuration.

### 8.5 Route invalidation

If the user removes the epic currently in the URL filter, the post-mutation reload must:

- keep the user on Configuration;
- clear only the invalid epic key;
- show a notice such as “NF-123 is no longer tracked, so you are viewing all tracked epics”;
- avoid the current misleading wording that every invalid key is necessarily archived/inactive.

## 9. Page behavior by epic kind

| Page | Timeline epic | Ongoing epic |
| --- | --- | --- |
| Overview | Target, projected completion, buffer, delivery health | Ongoing badge, capacity/placement/estimate summary, no target or completion |
| Timeline | Dated lane with gating/relevant dates and projection | Neutral ongoing lane with scheduled work/capacity activity; no artificial end marker |
| Dependencies | Existing graph behavior | Same graph behavior |
| Gantt Planner | Existing work lanes and shared load | Same work lanes and shared load |
| Configuration | Kind, labels, milestones | Kind and labels; milestone editing suppressed |

The all-tracked view remains useful with any mix of kinds. Summary counts should not label every
ongoing epic as an exception merely because it lacks a target. “Needs attention” counts should
include actual estimate/plan warnings, not the neutral `ongoing` state.

## 10. Delivery slices

### Slice 1 — Intent contract and safe persistence

- Add `EpicPlanningKind` and the effective-intent resolver.
- Add the database column and migration.
- Update persistence, snapshots/imports, reconciliation, and fixtures.
- Move portfolio-intent writes into the repository and make them partial-update-safe.
- Extend the frontend API client.

**Exit:** timeline/ongoing and include/exclude intent round-trip without data loss, survive sync, and
do not reset each other or priority.

### Slice 2 — Authoritative candidate discovery and tracked-epic editor

- Extend the Jira scope preview with all board candidates and effective intent.
- Add the always-visible Configuration panel.
- Add the fuzzy candidate finder, tracked list, add/remove actions, and kind control.
- Add last-synced fallback behavior and current-filter invalidation messaging.
- Reuse the selector in the setup Epic-scope step where practical so initial setup and later edits
  have one behavior.

**Exit:** a user can exclude, find, re-add, and classify board epics; choices persist through reload
and Jira sync.

Do not expose the Ongoing choice in a release until Slice 3 is complete, or gate the control behind
the end-to-end engine/UI implementation. An ongoing epic must never ship while still appearing as
`needs-target` or consuming zero modeled capacity.

### Slice 3 — Ongoing-aware shared capacity and page presentation

- Add ongoing projection state and exhaustive UI mappings.
- Reserve capacity for placed ongoing work before target-driven timeline projection.
- Surface unestimated and unplaced ongoing work truthfully.
- Adapt Overview and portfolio Timeline rendering.
- Suppress launch-oriented milestone controls for ongoing epics without deleting data.
- Verify Gantt and Dependencies continue using the complete tracked portfolio.

**Exit:** ongoing work consumes explainable shared capacity without a fake date, and every primary
page has a coherent mixed-kind all-tracked state.

### Slice 4 — Integration hardening and documentation

- Complete keyboard, screen-reader, responsive, and read-only fixture behavior.
- Add deterministic mixed-kind fixtures and end-to-end coverage.
- Update setup/help documentation and stale “all active epics” wording to distinguish board
  candidates from tracked epics.
- Search for duplicated inclusion rules and direct `portfolioEpics.find` calls; route all behavior
  through the shared resolver.
- Run the product-constitution change check across all pages and URL transitions.

**Exit:** scope and kind behave consistently across setup, configuration, sync, projection, and all
primary pages.

## 11. Likely implementation map

This is a planning map, not a requirement to preserve today's file boundaries:

| Area | Primary files |
| --- | --- |
| Shared contract/default resolver | `packages/shared/src/domain.ts`, `packages/shared/src/index.ts`, and a focused shared intent helper/module |
| SQLite schema/migration/round-trip | `packages/backend/src/db/schema.ts`, `database.ts`, `persist.ts` |
| Validated intent mutation | `packages/backend/src/db/repository.ts`, `routes/portfolio.ts`, `server.ts` |
| Jira candidates and sync preservation | `packages/backend/src/routes/jira.ts`, `importer/jira.ts`, `db/reconcile.ts`, importer factory as needed |
| Shared-capacity semantics | `packages/engine/src/portfolio.ts` plus engine exports/tests |
| Frontend data contract | `packages/frontend/src/data/api.ts`, `data/loadDataset.ts` |
| Fuzzy selector and Configuration UX | `components/Configuration.tsx`, a focused tracked-epic component, `components/EpicPicker.tsx`/`lib/epicPicker.ts` shared primitives, `styles.css` |
| Scope, routing, and page rendering | `lib/projection.ts`, `lib/portfolioOverview.ts`, `App.tsx`, `PortfolioOverview.tsx`, and portfolio Timeline rendering |
| Verification | shared/backend/engine/frontend unit tests and `packages/frontend/e2e` |

## 12. Verification strategy

### Shared/domain and persistence

- effective defaults for missing intent rows;
- both planning kinds round-trip through SQLite;
- migration of a pre-column database defaults to timeline;
- snapshot/import preserves kind and exclusions;
- invalid kinds are rejected.

### Repository and HTTP API

- partial kind update preserves scope and priority;
- partial scope update preserves kind and priority;
- unknown epic, empty patch, invalid scope/kind, and non-integer priority fail correctly;
- candidate preview includes excluded, ineligible, and tracked roots from the configured board;
- project-wide epics outside the board are not offered;
- archived intent can be retained and restored safely.

### Reconciliation and Jira sync

- exclude, include, kind, priority, milestones, label settings, and placements survive sync;
- excluded epic facts may refresh without re-entering planner scope;
- archive/reactivation restores the prior kind and scope;
- a failed sync changes neither portfolio membership nor lifecycle state.

### Engine/selectors

- excluded epics contribute neither planner rows nor modeled load;
- page filtering never reduces full tracked-portfolio capacity inputs;
- an ongoing epic never yields `needs-target`, completion, or buffer;
- placed ongoing work reduces capacity available to timeline work in the same week;
- unplaced ongoing work is reported rather than silently ignored;
- mixed-kind projection is deterministic and never exceeds capacity without explicit overload;
- changing an epic's kind does not mutate milestones.

### Frontend unit/component coverage

- fuzzy ranking by normalized key/title and deterministic tie order;
- add/remove/re-add and kind-switch state;
- force-include affordance for ineligible candidates;
- read-only bundled data behavior;
- Jira-preview failure fallback and stale-state label;
- exhaustive kind/health labels;
- current route filter clears after removing its epic while the tab remains Configuration.

### End-to-end and visual coverage

- configure a board with several candidates, track a subset, reload, and sync;
- remove the currently filtered epic and verify the canonical URL/notice;
- classify KTLO as ongoing and verify no target UI appears;
- switch ongoing -> timeline and verify preserved or missing-target behavior;
- mixed timeline/ongoing Overview, Timeline, Dependencies, Gantt, and Configuration at desktop and
  mobile widths;
- keyboard-only fuzzy selection and removal;
- shared weekly load visibly includes placed ongoing work while an individual timeline epic is
  filtered.

All Node-based verification commands must run after `nvm use` from the repository root.

## 13. Acceptance criteria

- Configuration always contains a Tracked epics section tied to the configured Jira board.
- The user can fuzzy-find board candidates, add/remove them, and classify tracked entries as
  Timeline or Ongoing.
- Membership and kind are persisted local intent and survive reload, sync, archive, and
  reactivation.
- Excluded epics do not appear in normal page filters or portfolio views and do not affect modeled
  capacity; the UI communicates that consequence before removal.
- Timeline epics retain gating-target health behavior.
- Ongoing epics never require or display a launch target, projected completion, or date-based
  red/yellow/green verdict.
- Placed ongoing work still consumes the shared team capacity used to forecast timeline epics;
  unplaced ongoing work remains visibly unresolved.
- Existing milestones are preserved across kind changes.
- All pages work with an empty page filter (all tracked epics), and filtering never creates a new
  capacity pool.
- The canonical URL remains `tab + optional epics`; no board/portfolio drill-down mode is added.
- Existing databases migrate automatically and existing epics behave as Timeline by default.

## 14. Decisions to confirm before implementation

The plan recommends the following defaults. They should be treated as the implementation contract
unless product direction changes:

1. **Removing an epic means excluding it from the managed portfolio and capacity model**, not only
   hiding its card. If the desired behavior is cosmetic hiding while capacity remains reserved,
   model a separate visibility preference instead of reusing `scopeOverride`.
2. **Ongoing capacity is initially placement-backed.** Only dated placed work is reserved;
   unplaced work is called out as `needs-plan`. A standing percentage reservation is deferred.
3. **Existing and newly discovered epics default to Timeline** for compatibility.
4. **Switching to Ongoing preserves milestones but makes them dormant**; switching back restores
   them.
5. **The current configured board is the only candidate source.** Multi-board portfolios remain out
   of scope; if introduced later, portfolio intent will need an explicit board association.

## 15. Non-goals

- multiple boards or teams in one planner;
- multi-epic page comparison UI;
- changing Jira fields, statuses, rank, sprint assignments, or issue membership;
- automatically classifying KTLO/intern epics from names or labels;
- deleting historical local intent when an epic is removed or archived;
- recurring percentage/capacity reservations for ongoing work;
- a new navigation hierarchy, route mode, or Spec Kit/SDD workflow.
