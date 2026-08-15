# Flattened Planner Layout and Epic Filtering — Durable Implementation Plan

**Status:** Proposed  
**Last updated:** 2026-08-15  
**Scope:** frontend information architecture, URL state, epic filtering, and conversion of existing planner pages to portfolio-aware views  
**Governed by:** [`planner-product-constitution.md`](./planner-product-constitution.md)  
**Supersedes:** the portfolio-to-epic drill-down navigation model in `portfolio-page-ux-plan.md` and `portfolio-capacity-planner-plan.md`; their portfolio calculations, visual hierarchy, and shared-capacity requirements still apply

## 1. Problem

The application currently has two navigation levels:

```text
Portfolio
  -> choose an epic
       -> epic-only Timeline / Dependencies / Gantt / Configuration
```

That creates two different modes of using the planner. The URL, page shell, headings, and component
tree all reinforce the distinction:

- `PlannerRoute.view` chooses either `portfolio` or `epic`.
- `App.tsx` renders `PortfolioOverview` or `LoadedPlanner` as mutually exclusive branches.
- Choosing an epic changes both the selected data and the page being viewed.
- The Portfolio button is effectively an "exit epic mode" action.
- Timeline, dependency, Gantt, and epic configuration components accept `EpicScope`, so their
  rendering boundary assumes exactly one epic.
- The route already stores `epics` as an array, but the application immediately reads only
  `route.epics[0]`.

This makes an epic feel like a child application instead of a filter over the same portfolio. It
also makes a future two-epic view harder because selection is encoded as a navigation mode rather
than an independent scope.

## 2. Product outcome

The planner has one navigation level: its pages. Epic selection is a persistent filter that applies
to those pages.

```text
Planner
  Overview | Timeline | Dependencies | Gantt Planner | Configuration
       + Epic filter: All active epics or one epic
```

The initial release supports two filter states:

1. **All active epics** — the default; represented by no selected epic keys.
2. **One epic** — show only that epic's detail while retaining portfolio context.

The internal and URL contracts continue to use `string[]`, even though the first filter UI permits
only zero or one key. A later release can allow two or more keys without adding another navigation
level or replacing the route model.

## 3. Design decisions

### 3.1 Pages and filters are independent

- Changing pages preserves the epic filter.
- Changing the epic filter preserves the current page.
- Clicking an epic on Overview applies the filter; it does not navigate to Timeline or enter a new
  mode.
- Clearing the filter returns the current page to all active epics.
- Browser back/forward restores page and filter together.
- No page requires the user to choose an epic before it can render a useful state.

### 3.2 Filtering presentation must not create fake capacity

The shared team schedule is always calculated from the full active portfolio. Filtering to one epic
changes what is emphasized or expanded, not which work consumes capacity.

Every capacity-aware page must distinguish:

- **portfolio load** — all active work consuming the team's capacity;
- **filtered contribution** — the selected epic's portion of that load.

For example, a filtered Gantt may hide or collapse other epic rows, but the weekly header continues
to show total portfolio load and identifies the selected epic's contribution. It must never show
the selected epic against a newly empty team-capacity pool.

### 3.3 One persistent application shell

The shell owns:

- product identity and data-source/sync state;
- primary page tabs;
- the epic filter and a visible **Clear filter / Show all epics** action;
- active-filter context such as `Showing NF-123` or `Showing all 7 active epics`.

Remove the Portfolio button and the `Epic drill-down` page heading. Overview becomes a peer tab,
not a parent page. Jira links remain separate external actions and never change the local filter.

### 3.4 Filtering is local and immediate

The active epic list is already in `DomainDataset`. Applying or clearing a filter must not fetch Jira
or reload the dataset. A sync may update the available filter options, after which route validation
handles archived or removed keys explicitly.

## 4. Canonical navigation contract

Replace the `view + tab + epics` route with `tab + epics`:

```text
/?tab=overview                         # all active epics
/?tab=timeline                         # all-active portfolio timeline
/?tab=gantt&epics=NF-123              # Gantt filtered to one epic
/?tab=dependencies&epics=NF-123       # dependencies filtered to one epic
```

Route state:

```ts
type PlannerPage =
  | 'overview'
  | 'timeline'
  | 'dependencies'
  | 'gantt'
  | 'configuration';

interface PlannerLocation {
  page: PlannerPage;
  epicKeys: string[]; // [] means all active epics
  invalidEpicKeys: string[];
  needsCanonicalization: boolean;
}
```

Rules:

- `overview` is the default page.
- Empty `epicKeys` means all active epics, never "no data."
- Keys are deduplicated, validated against active epics, and serialized in deterministic dataset
  order.
- An invalid or newly archived key is removed and a visible notice explains that the page is now
  showing all active epics. Do not silently substitute the first epic.
- Unknown pages fall back to Overview while retaining any valid epic filter.
- The canonical URL omits the obsolete `view` parameter.
- `usePlannerRoute` continues to use `pushState`, `replaceState`, and `popstate`; filtering must not
  reload the application.

Legacy URLs are read and replaced canonically:

| Legacy URL | Canonical result |
| --- | --- |
| `?view=portfolio` | `?tab=overview` |
| `?view=epic&epics=NF-123&tab=timeline` | `?tab=timeline&epics=NF-123` |
| `?view=epic&epic=NF-123&tab=gantt` | `?tab=gantt&epics=NF-123` |
| `?view=epic&epics=missing&tab=gantt` | `?tab=gantt`, plus an invalid-filter notice |

Keep legacy parsing for at least one release after flattened navigation ships. New code, tests, and
links must only emit canonical URLs.

## 5. Target component and state shape

`App.tsx` should have one ready-state rendering path:

```text
Planner
  -> AppShell
       -> PlannerTabs
       -> EpicFilter
       -> FilterNotice / ScopeSummary
       -> PlannerPage
            -> Overview
            -> Timeline
            -> Dependencies
            -> Gantt Planner
            -> Configuration
```

Replace the mutually exclusive `PortfolioOverview` / `LoadedPlanner` branches with a single page
switch inside the shell. Lift these states above the page switch so they survive page and filter
changes:

- route-backed page and epic keys;
- scenario edits (`cutItemKeys`, `doneItemKeys`), keyed by work-item identity;
- any filter-independent planning state that should not reset during navigation.

Retain component-local presentation state such as graph focus, open menus, or the selected sprint
when it is genuinely page-specific.

### 5.1 Pure selection scope

Introduce a pure selector, named according to the repository's eventual conventions, with a
contract equivalent to:

```ts
interface PlannerScope {
  activeEpics: Epic[];
  selectedEpicKeys: string[];
  visibleEpics: Epic[];
  visibleStories: UserStory[];
  visibleWorkItems: WorkItem[];
  visibleMilestones: EpicMilestone[];

  // Full active-portfolio inputs retained for shared scheduling and context.
  portfolioWorkItems: WorkItem[];
  portfolioDependencies: Dependency[];
  portfolioPlacements: PlannedPlacement[];
}

buildPlannerScope(dataset, selectedEpicKeys): PlannerScope
```

`visible*` drives emphasis and detail. `portfolio*` drives shared capacity and interaction context.
This separation should be explicit in types so a component cannot accidentally recompute capacity
from filtered work alone.

Keep `scopeEpic()` temporarily as a compatibility helper while components are converted, then
remove it from application composition. Unit-level helpers may remain when a calculation is truly
defined for one epic.

### 5.2 Epic filter component

Evolve `EpicPicker` from navigation control to filter control:

- label it **Epic filter**;
- display **All active epics** when `selectedKeys` is empty;
- expose an explicit clear/show-all action when one key is selected;
- keep fuzzy search and keyboard interaction;
- call `onSelectionChange([])` to clear;
- in the first release, choosing an option replaces the one selected key;
- do not change the current page from inside the component;
- preserve the plural prop and callback contracts for future multi-select.

On Overview, replace **Open epic** with **Show only this epic**. The action updates the same filter
used by the shell and leaves Overview active.

## 6. Page behavior matrix

| Page | All-active state | One-epic filtered state | Portfolio context that must remain |
| --- | --- | --- | --- |
| Overview | Current portfolio summary, all epic health rows, shared capacity | Selected epic row and metrics; filtered contribution highlighted | Total load/capacity and a clear route back to all epics |
| Timeline | One lane/section per active epic with target, projected completion, and health | Expanded timeline for the selected epic | Other epic milestones or load conflicts summarized without crowding the detailed lane |
| Dependencies | Cross-epic graph grouped or colored by epic | Selected epic nodes plus directly connected outside-epic nodes | Cross-epic edges and outside-node identity must not disappear |
| Gantt Planner | Shared schedule, rows/backlog grouped by epic | Selected epic rows expanded; other portfolio work collapsed or de-emphasized | Weekly total portfolio load, total capacity, and other-work contribution |
| Configuration | Global/team settings plus an epic-settings directory/summary | Global/team settings plus the selected epic's labels and milestones | Global/team controls remain available in either filter state |

### 6.1 Overview

- Filter `model.rows` for the selected epic without rebuilding portfolio capacity from that subset.
- In filtered mode, show selected remaining points and placement metrics alongside total portfolio
  load.
- Capacity bars show total load and visually distinguish the selected epic contribution.
- The filter action is an explicit button; the Jira key remains an external link.

### 6.2 Timeline

The current timeline assumes one gating date and one `ProjectionResult`. Do not put several epics'
markers on one undifferentiated axis.

- Add a portfolio timeline model with one aligned lane per epic.
- Reuse the shared date domain so cross-epic timing is comparable.
- In all-active mode, show compact lanes with health, gating target, projected completion, and
  buffer.
- In one-epic mode, expand the selected lane with its full milestone and sprint detail.
- Derive completion and health from the shared portfolio projection, not separate calls to
  `runScenario()` that grant full capacity to each epic.

### 6.3 Dependencies

- Build the graph from active-portfolio dependencies so cross-epic edges are available.
- Add epic identity to graph nodes and deterministic grouping/coloring.
- In one-epic mode, include the selected epic's nodes and any directly connected external nodes;
  mark external nodes as context rather than pretending they belong to the selected epic.
- Rank blockers over the displayed dependency context and state clearly when a blocker belongs to
  another epic.
- Add a density strategy for all-active portfolios, such as epic-group collapse, before rendering
  an unbounded full ticket graph.

### 6.4 Gantt Planner

This is the most important shared-capacity conversion because the current `GanttBoard` and
`buildGanttView` accept an `EpicScope`.

- Build the schedule from all active stories, work items, placements, members, and sprints.
- Add epic identity to lanes, backlog groups, cards, and test IDs where necessary.
- Calculate week verdicts from total portfolio placements.
- In one-epic mode, expand matching rows and collapse nonmatching work into an **Other portfolio
  work** contribution; do not remove it from the header load.
- Dragging and unplacing remain work-item operations, so the existing placement API can remain
  unchanged.
- Epic-specific label rules apply to their own work when producing portfolio lanes.

### 6.5 Configuration

Configuration combines global, team, and epic-scoped controls, so filtering should change only the
epic-scoped portions.

- Always show planning knobs, cadence, members, availability, Jira setup, sync log, and database
  tools when their existing prerequisites are present.
- With all epics visible, replace the absence of epic controls with an epic-settings directory or
  compact list. Choosing an epic there updates the global epic filter without leaving
  Configuration.
- With one epic filtered, show its Gantt-label and milestone sections inline.
- Keep mutation endpoints epic-specific; flattening the layout does not require a new bulk-edit API.

## 7. Delivery slices

### Slice 1 — Lock the route and filtering contract

- Add route tests for the new `page + epicKeys` model and every legacy migration case.
- Add `buildPlannerScope()` tests covering all-active, one-epic, invalid, archived, and empty
  datasets.
- Document in code that `[]` means all active epics.
- Refactor the shell and picker so page changes and filter changes are independent.

**Exit:** canonical URLs contain no `view`; tabs and filter survive reload/back/forward; no Jira
request occurs when filtering.

### Slice 2 — Flatten application composition and Overview

- Replace `LoadedPlanner` and the portfolio/epic branch with one shell and page switch.
- Make all tabs visible in both filter states.
- Convert Portfolio to the Overview tab.
- Replace **Open epic** with **Show only this epic** and add clear/show-all behavior.
- Move scenario state above the page switch so navigation does not discard it.

**Exit:** there is no portfolio-to-epic transition in the UI, and Overview works for all or one
epic without changing pages.

### Slice 3 — Convert shared-capacity pages

- Convert Gantt to portfolio inputs and total-load verdicts.
- Add filtered contribution versus total-load presentation.
- Convert Timeline to aligned portfolio lanes driven by shared projections.
- Remove application-level use of per-epic projections where they would double-count capacity.

**Exit:** Timeline and Gantt render meaningful all-active states; filtering changes emphasis, not
capacity allocation.

### Slice 4 — Convert relationship and configuration pages

- Convert Dependencies to retain cross-epic edges and add epic grouping/context.
- Split Configuration's global/team content from its filtered epic sections.
- Add all-active empty, dense, and incomplete-planning states for both pages.

**Exit:** every primary page works without first selecting an epic, and every page honors the same
filter contract.

### Slice 5 — Remove obsolete hierarchy and harden

- Remove `PlannerRoute.view`, `LoadedPlanner`, the Portfolio navigation button, `Epic drill-down`
  copy, and application assumptions based on `epics[0]`.
- Remove or narrow `scopeEpic()` once no primary page requires an epic-only application scope.
- Update visual and end-to-end fixtures to canonical URLs.
- Add responsive and keyboard coverage for all-active, filtered, cleared, invalid, and archived
  states.
- Search for obsolete `view=portfolio`, `view=epic`, `Open epic`, and `Current epic` strings before
  completing the change.

**Exit:** the old hierarchy remains only in the deliberate legacy URL parser.

## 8. Test strategy

### Unit

- canonical route parsing and serialization;
- legacy `view` and singular `epic` migration;
- all-active (`[]`) and one-epic scope construction;
- invalid/archived key handling and deterministic key order;
- filter-independent portfolio load and selected contribution calculations;
- portfolio timeline lanes and shared date domain;
- cross-epic dependency inclusion;
- Gantt total load remaining constant when filters change.

### Component/integration

- the same tab bar renders in all filter states;
- choosing or clearing an epic does not change the current tab;
- switching tabs does not clear the filter;
- Overview's row action applies the filter and does not follow the Jira link;
- the filter announces all-active and selected states accessibly;
- Configuration swaps only its epic-scoped sections;
- invalid filters produce a visible notice instead of selecting another epic;
- scenario edits survive page and filter changes.

### End-to-end and visual

- load the canonical all-active Overview URL;
- filter to one epic, visit every page, then clear the filter;
- use back/forward across page and filter changes;
- load and canonicalize each legacy URL form;
- sync/replace the fixture so the selected epic becomes archived and verify the notice;
- assert that Gantt weekly total load is identical before and after filtering;
- capture Overview, Timeline, Dependencies, Gantt, and Configuration in all-active and filtered
  states at desktop and mobile widths;
- include cross-epic dependencies and an overloaded week in deterministic fixtures.

Before Node-based verification, run `nvm use` from the repository root as required by `AGENTS.md`.

## 9. Acceptance criteria

- The planner exposes exactly one primary navigation layer: Overview, Timeline, Dependencies,
  Gantt Planner, and Configuration.
- There is no Portfolio-versus-epic page mode, Portfolio back button, or epic drill-down heading.
- All primary pages render a useful all-active state without requiring an epic selection.
- Epic selection is visibly described and implemented as a filter.
- Selecting or clearing an epic never changes the current page.
- Changing pages never changes the epic filter.
- Empty selection consistently means all active epics.
- Canonical URLs use `tab` and optional plural `epics`; they do not emit `view`.
- Legacy portfolio and epic URLs restore the equivalent page/filter and are replaced canonically.
- Filtering never grants the selected epic the team's full capacity or hides other work from
  shared-load totals.
- Timeline completion/health, Gantt verdicts, and Overview capacity all use the same shared
  portfolio projection.
- Cross-epic dependencies remain visible as context when one epic is filtered.
- The filter uses a plural key contract even while the first UI supports at most one key.
- No Jira or dataset request occurs merely because the filter changed.
- Unit, integration, end-to-end, visual, type, and build checks pass under the repository's selected
  Node version.

## 10. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A cosmetic flattening still leaves pages unusable without an epic | Require a useful all-active state for every page before removing the old hierarchy |
| Filtered Gantt/timeline accidentally overstates available capacity | Keep full portfolio scheduling inputs distinct from visible filtered inputs in the type contract and add invariant tests |
| All-active dependency graphs become unreadable | Add epic grouping and collapse/density behavior before enabling an unbounded full graph |
| Timeline semantics become ambiguous with several targets | Use aligned per-epic lanes, not mixed markers on one lane |
| Configuration loses access to epic settings in all-active mode | Provide an epic-settings directory that applies the same global filter in place |
| Scenario state disappears when filters change | Key scenario edits by work-item ID and lift them above the page renderer |
| Old shared links stop working | Retain explicit legacy parsing and canonicalize with `replaceState` |
| The plural route is mistaken for delivered compare mode | Keep the initial UI single-select and document multi-select as a separate future slice |

## 11. Deliberately deferred

These are enabled by the flattened model but are not part of the first implementation:

- selecting two or more epics in the UI;
- comparison-specific layouts or metrics;
- saved filter presets;
- filters for engineer, status, label, or archived epics;
- bulk editing epic-scoped settings;
- changing portfolio allocation or priority rules;
- supporting multiple teams or boards in one planner.

A future multi-epic release should enable `selectionMode="multiple"`, serialize several keys in the
existing `epics` parameter, and define each page's comparison presentation. It should not add a
`compare` view or restore a second navigation level.

## 12. Implementation guardrails

- This plan requires no database, Jira import, or persistence migration.
- Preserve the current shared-capacity and portfolio-health work already present in the worktree.
- Keep filtering as presentation state; do not mutate active/included epic state.
- Make incremental component conversions, but do not consider the feature complete while any
  primary page still redirects to or requires an epic-only mode.
- Do not remove legacy URL parsing until its compatibility window is explicitly closed.
