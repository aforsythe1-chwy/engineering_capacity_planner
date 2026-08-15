# Gantt Planner Epic Filter — Durable Fix Plan

**Status:** Proposed  
**Created:** 2026-08-15  
**Scope:** Gantt presentation filtering, shared-capacity calculation, placement interaction, and regression coverage  
**Constraints:** Preserve the flat planner and the invariants in `planner-product-constitution.md`; this is not Spec Kit/SDD work.

## 1. Outcome

When the route has an epic filter (for example, `?tab=gantt&epics=CKT`), the Gantt Planner must
show only that epic's lanes, placed cards, and backlog cards. Its weekly header must continue to
report total load and capacity for every tracked active epic, so the selected epic is never shown
as owning the team's unused capacity.

The unfiltered Gantt continues to show all tracked active work.

## 2. Current-state finding

`PlannerPage` passes a `displayScope` to `GanttBoard`. In `makeDisplayScope()` the `workItems`
collection is restricted only when `includeDependencyContext` is true. That flag is true solely for
the Dependencies tab, so the Gantt gets `planner.portfolioWorkItems` even when `selectedKeys`
contains an epic.

As a result, `buildGanttView()` derives its lanes, placed cells, backlog bag, and week totals from
the same all-portfolio collection. The route filter is visible in the shell but has no filtering
effect on Gantt work rows.

## 3. Required behavior

| State | Gantt rows and cards | Weekly header and verdict | Backlog bag |
| --- | --- | --- | --- |
| No selected epic | All tracked active work | Total portfolio placement load and shared team capacity | All unplaced active work |
| One selected epic | Only selected epic work | Unchanged total portfolio placement load and shared team capacity | Only selected epic's unplaced work |

Additional rules:

- A card from another epic must not appear in a selected epic's lane or bag.
- A placement from another epic must still contribute to the displayed `placedPoints` and
  green/yellow/red verdict for its week.
- Dragging a visible card and returning it to the bag must preserve existing placement API behavior.
- A selected epic's labels must continue to use that epic's label configuration. The implementation
  must not apply one epic's Gantt label settings to another epic's work.
- The filter remains collection-shaped at the routing boundary, even though the current picker is
  single-select.

## 4. Implementation approach

### 4.1 Replace the ambiguous display scope

Do not use the current `EpicScope` adapter as both the visible-work input and the capacity input.
Create a Gantt-specific view-input contract (for example, `GanttScope`) that explicitly separates:

- **visible work:** selected/all-active stories, work items, and the subset of placements whose
  work item is visible; these produce lanes, cells, card chips, and the backlog bag.
- **portfolio load:** all tracked active work items and all corresponding placements; these produce
  `placedPoints` and week verdicts only.
- **shared team context:** team, members, availability, defaults, and sprints.

The new contract should make it impossible for a caller to accidentally compute visible cards from
the portfolio list merely because a tab-specific boolean was false.

### 4.2 Build the Gantt input in `App.tsx`

Replace `makeDisplayScope(..., includeDependencyContext)` with two clear adapters:

1. A dependency adapter that keeps its direct external-node context behavior.
2. A Gantt adapter that obtains visible stories/work items from `PlannerScope.visibleStories` and
   `visibleWorkItems`, while retaining `portfolioWorkItems` and `portfolioPlacements` as capacity
   inputs.

For an empty filter, the visible and portfolio collections are equivalent. For a selected filter,
they diverge only at the intentional presentation/capacity boundary.

### 4.3 Update `buildGanttView()`

Refactor the pure builder so it:

1. indexes visible work for cells, lanes, cards, and backlog;
2. indexes portfolio work for week-load calculation;
3. filters the selected-sprint placement list independently for visible cells and portfolio weekly
   load;
4. derives `placedPointsByWeek` from every placed, non-done portfolio item;
5. derives `lanes`, `cells`, `bag`, and visible placement counts from visible work only.

Keep the existing member-capacity calculation unchanged: it is team-scoped and filter-independent.

If the UI needs to expose nonselected load more explicitly later, add a separate
`otherPortfolioPoints` field to each week rather than rendering other-epic cards. It is not required
for this corrective change because the header already communicates that it is portfolio-wide.

### 4.4 Keep interaction bounds aligned to visible work

`GanttBoard` currently uses `scope.workItems` to guard `place()`. Change that guard to the visible
work collection, so a filtered board cannot receive or manipulate a hidden item through a stale drag
payload. Continue keeping the complete placement list in local state so a visible placement mutation
recalculates full-portfolio weekly totals immediately.

## 5. Verification plan

### Unit tests

Extend `packages/frontend/test/gantt.test.ts` with a synthetic two-epic input sharing a team and
sprint. Assert that, for a filtered Gantt input:

- lane totals, cells, and bag contain only the selected epic's item keys;
- a placed item from the other epic is absent from visible cells;
- the same other-epic placement is included in `weeks[n].placedPoints` and affects its verdict;
- removing the selected epic filter restores both epics' cards;
- a visible card can be placed/unplaced without dropping the other epic's load from the header.

Add an adapter-level test (new `App` helper test or extracted pure helper test) to assert that a
single route key produces divergent visible and portfolio collections, while an empty filter yields
equivalent collections.

### Browser regression

Extend the Gantt Playwright coverage using a fixture with at least two tracked epics:

1. open `?tab=gantt&epics=<epic-A>`;
2. verify epic A's known card is visible and epic B's is not present in a lane or bag;
3. verify the weekly header still reports the all-portfolio load;
4. clear the filter and verify epic B's card becomes visible;
5. repeat a drag/unplace action for epic A and verify the header changes only by A's points.

### Commands

Run from the repository root, selecting the repository's Node version first:

```sh
nvm use
npm --workspace @ecp/frontend run typecheck
npm --workspace @ecp/frontend run test
npm --workspace @ecp/frontend run e2e -- gantt.spec.ts
```

Run the complete workspace test/build checks required by the repository before merging.

## 6. Acceptance criteria

- `?tab=gantt&epics=<tracked-key>` visibly filters Gantt lanes, placed chips, and bag cards to that
  epic.
- No selected-filter state hides other active work from weekly total load or capacity verdicts.
- An empty epic filter remains a useful all-active Gantt view.
- Gantt drag/unplace behavior remains functional for visible cards and remains backed by the existing
  placement endpoints.
- Unit and browser tests fail under the current bug and pass with the fix.
- No route, navigation-level, or capacity-model behavior changes outside the Gantt presentation
  boundary.

## 7. Decisions and open questions

**Decision:** This fix uses filtered presentation plus total portfolio load, as required by the
product constitution. It does not attempt to create a separate per-epic schedule or capacity model.

**Decision:** Do not silently collapse another epic's cards into the selected epic's label lanes;
hidden work must remain hidden while its contribution stays in the weekly total.

**Open question (non-blocking):** Whether to add a small explicit “other portfolio work” number to
each week header can be evaluated after the correctness fix. It is a UX enhancement, not a
prerequisite for restoring filter semantics.
