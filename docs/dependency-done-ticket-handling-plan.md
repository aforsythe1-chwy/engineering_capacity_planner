# Dependency View Done-Ticket Handling — Durable Implementation Plan

**Status:** Implemented (2026-08-17)

**Created:** 2026-08-17

**Scope:** Dependency graph completion semantics, remaining-work leverage, done-node visibility,
focus behavior, styling, and regression coverage

**Intended outcome:** The Dependencies page never recommends a completed ticket as work to do next.
Done tickets remain available as muted graph context by default, and the user can hide or restore
them without changing epic scope, dependency data, or shared-capacity truth.

**Constraints:** This plan covers frontend and pure graph-analysis behavior only. It does not change
Jira status mapping, persist a user preference, mutate ticket status, or introduce Spec Kit/SDD.
Preserve the flat planner and the filter/context invariants in
[`planner-product-constitution.md`](./planner-product-constitution.md).

## 1. User context and target experience

The current Dependencies page can show a done ticket in **Work these next**. The screenshot that
motivated this plan shows `NF-2579` as a green/done graph node while the same ticket is the first
recommendation. The graph also contains many done tickets but provides no way to reduce that visual
noise.

The target experience separates two valid uses of completion state:

- **Recommendations are actionable.** Completed tickets never appear in **Work these next**, and
  completed downstream tickets do not inflate an unfinished ticket's remaining leverage.
- **The graph is explanatory.** Done tickets are shown by default as subdued historical/context
  nodes so the dependency chain remains understandable.
- **Context is optional.** A compact **Show done tickets** checkbox in the graph header lets the
  user hide all done nodes and their incident edges. Turning it back on restores them.

The initial checkbox state is on for each mounted Dependencies view. It is deliberately local UI
state for this slice: it is not added to the URL or saved settings. This keeps shared URLs defined
only by page and epic filter and avoids turning a small density preference into application-wide
configuration.

## 2. Verified current behavior and evidence

These are repository facts verified on 2026-08-17.

### 2.1 Done state already has one effective definition

- [`graph.ts`](../packages/frontend/src/lib/graph.ts) exposes `nodeState(item, scenario)`.
- A node is done when either its source `WorkItem.status` is `Done` or its key is present in
  `scenario.doneItemKeys`.
- [`DependencyGraph.tsx`](../packages/frontend/src/components/DependencyGraph.tsx) passes that state
  to each SVG node. The rendering adds `is-done` and a check mark.
- The app currently initializes the scenario's `doneItemKeys` as an empty set, so Jira-imported
  `Done` status is the normal live-data path. Tests already cover both sources of done state.

The implementation must continue to use this effective definition everywhere. The toggle,
recommendations, counts, node styling, focus cleanup, and tests must not each invent their own done
predicate.

### 2.2 The recommendation path ignores completion

- [`DependencyGraph.tsx`](../packages/frontend/src/components/DependencyGraph.tsx) builds a second,
  unfocused layout and reads `analysis.leaderboard` from it.
- It filters only for `transitiveDependents > 0` and takes the first five entries. It does not test
  `node.done`.
- [`packages/engine/src/graph.ts`](../packages/engine/src/graph.ts) analyzes opaque keys and edges.
  It has no completion input, so `directDependents`, `transitiveDependents`, leverage tiers, and the
  leaderboard describe the full structural graph regardless of item status.
- The same all-node metrics are painted on graph nodes and used to emphasize high-leverage edges.

This is the root cause: completion is currently a paint-layer attribute, while recommendations and
leverage are computed from the unfiltered structural graph.

### 2.3 The graph has no done visibility control

- `DependencyGraph` owns only `focusKey` local state.
- The graph always lays out every work item in the supplied dependency scope, including done items.
- The current legend renders done with a green swatch, and `.graph-node.is-done` uses a green-tinted
  box. There is no visibility toggle or persisted setting.
- Focus mode computes a ticket's upstream and downstream subtree before any completion filtering.
  The focus banner reports the number of nodes returned by the layout.

### 2.4 Scope and cross-epic context must remain intact

- [`plannerPageScopes.ts`](../packages/frontend/src/lib/plannerPageScopes.ts) intentionally keeps
  direct external dependency nodes when an epic filter is selected.
- A done visibility preference is presentation state below that scope boundary. It must not alter
  the epic picker, route, active-epic collection, capacity calculations, imported dependency data,
  or the rule that selected epics retain relevant cross-epic context.

### 2.5 Existing verification seams

- [`packages/frontend/test/graph.test.ts`](../packages/frontend/test/graph.test.ts) covers effective
  done state, layout geometry, subtree focus, and empty graphs.
- [`packages/engine/test/graph.test.ts`](../packages/engine/test/graph.test.ts) covers the generic
  structural analyzer. Its status-agnostic contract is currently valid and reusable.
- [`packages/frontend/e2e/timeline.spec.ts`](../packages/frontend/e2e/timeline.spec.ts) covers the
  Dependencies page, leaderboard focus, and the existing focus-mode **Show all** behavior.

## 3. Decisions and invariants

### 3.1 Separate structural graph data from actionable analysis

Keep the engine's generic `analyzeGraph(keys, edges)` contract status-agnostic. Do not teach the
engine about `WorkItem`, Jira status, or `Scenario` merely to support a view preference.

At the frontend graph seam, derive:

1. **Structural scope:** the supplied work items and dependencies, optionally narrowed to a focused
   subtree. This preserves explanatory context and cycle reporting.
2. **Actionable scope:** structural items that are neither effectively done nor cut, with the
   induced dependency edges between those remaining items. This produces recommendation order,
   direct/total remaining-dependent counts, leverage tiers, and high-leverage emphasis.
3. **Visible scope:** structural nodes after applying the local show-done preference. This controls
   SVG nodes, SVG edges, dimensions, and the visible count in the focus banner.

The actionable graph is an induced graph: when a done node is hidden or excluded from remaining
work, do not create a synthetic edge between its predecessor and successor. A synthetic edge would
claim a direct Jira dependency that does not exist. If stale/inconsistent Jira data contains an
unfinished predecessor of a done node, show the imported relationship when done context is visible
but do not count the completed node as remaining leverage.

### 3.2 Done and cut are never work recommendations

Although the reported defect is about done tickets, **Work these next** promises actionable work.
The actionable predicate should therefore exclude both:

- effectively done items (`scenario.doneItemKeys` or source status `Done`);
- scenario-cut items (`scenario.cutItemKeys`).

This aligns recommendation semantics with existing faded/cut presentation and prevents the same
class of contradiction for a ticket intentionally removed from the plan. Cut visibility behavior
does not change in this slice; cut nodes remain visible with their existing reduced opacity.

### 3.3 Remaining leverage replaces lifetime leverage in action-oriented UI

For an unfinished node:

- `directDependents` is the number of its direct unfinished, non-cut dependents;
- `transitiveDependents` is the number of distinct unfinished, non-cut descendants reachable in the
  actionable graph;
- its tier and emphasized outgoing edges use those remaining counts;
- **Work these next** includes it only when remaining `transitiveDependents > 0`.

Done nodes receive zero actionable counts and the neutral/no-leverage tier even when shown for
context. This prevents a muted historical node from retaining blue high-leverage emphasis.

Use wording such as **remaining** or **unfinished** in tooltips/helper text where needed so the
metric cannot be mistaken for lifetime impact.

### 3.4 Show muted done context by default; allow hiding it

Add an accessible checked checkbox labelled **Show done tickets**, with a visible count such as
`Show done tickets (9)` when the count is known. Place it with the graph-level controls, not in the
global epic picker or Configuration.

When checked:

- render done nodes and their real edges;
- style done nodes as low-contrast grey/muted context with a check mark;
- suppress high/medium leverage styling and actionable metrics on those nodes.

When unchecked:

- remove done nodes from the rendered layout;
- remove every edge whose source or target is hidden;
- recompute layout dimensions and rows for only visible nodes;
- keep actionable rankings and counts unchanged, because done tickets never participate in them.

The checkbox itself must not disappear when there are no done tickets. Disable it or render it with
`(0)` so the current filter state remains understandable and the control does not cause header
layout shift as data changes.

### 3.5 Make focus and visibility transitions deterministic

Focus remains a structural subtree operation. In focus mode, hiding done tickets removes done nodes
from that subtree but retains all unfinished nodes that were already part of it. Do not recompute a
different transitive neighbourhood by bridging across hidden nodes.

If the currently focused ticket is done and the user turns off **Show done tickets**, clear focus
and show the full remaining graph. This avoids a banner claiming to focus a node that is not
visible. Implement this in the toggle event or an explicit state-transition helper, not as an
unbounded render-time state update.

The focus banner's ticket count reports visible nodes. Rename its **Show all** action to
**Show full graph** (including its instructional copy and test selector usage as appropriate) so it
is not confused with the independent **Show done tickets** control. This action clears focus only;
it does not change the done preference.

Clicking a recommendation still focuses that unfinished ticket. Changing epic scope or receiving a
dataset where the focus key no longer exists should continue to fall back to the full graph.

### 3.6 Preserve useful empty states

Handle the states independently:

| State | Graph panel | Work these next |
| --- | --- | --- |
| No work items in scope | Existing no-work message; toggle shows `(0)` or is omitted with the graph | Explain there are no tickets to recommend |
| All scoped work is done and done is shown | Muted completed graph remains visible | `No unfinished blockers to recommend.` |
| All scoped work is done and done is hidden | Purposeful empty canvas/message with a **Show done tickets** action/control | Same no-unfinished-blockers message |
| Unfinished tickets exist but none block unfinished work | Show the remaining graph normally | `No unfinished blockers to recommend.` |
| Focus subtree becomes visually empty after hiding done | Clear focus and show the full remaining graph; if still empty, use the all-done state | Same no-unfinished-blockers message |

Do not leave an empty ordered list as the only signal.

## 4. Target contracts and implementation seams

Exact type names may be adjusted during implementation, but retain these responsibilities.

### 4.1 Extend the frontend graph layout input/output

In [`packages/frontend/src/lib/graph.ts`](../packages/frontend/src/lib/graph.ts):

- extract/export a canonical effective-state or actionable predicate built on `nodeState`;
- add an explicit layout option such as `{ showDone: boolean }`, rather than filtering the
  `EpicScope` in the React component;
- preserve structural cycle information separately from actionable recommendations;
- expose a typed recommendation collection (for example `recommendations`) so the component never
  has to rediscover which `analysis.leaderboard` is safe;
- expose done counts and/or visible counts needed by the control and focus banner;
- ensure `LayoutNode` metrics/tier represent remaining actionable leverage;
- build edge emphasis from the actionable source-node metrics;
- compute geometry only after visible nodes and edges have been selected.

Avoid overloading a single `analysis` field with incompatible structural and actionable meanings.
A future reader should be able to tell which analysis drives cycle warnings/layout and which drives
the action list.

### 4.2 Update the React view and interaction state

In
[`packages/frontend/src/components/DependencyGraph.tsx`](../packages/frontend/src/components/DependencyGraph.tsx):

- add local `showDone` state initialized to `true`;
- pass it into both focused and full-layout computations;
- render the accessible checkbox and done count;
- source the top five entries from the layout's typed actionable recommendations;
- render the explicit empty recommendation message;
- implement the done-focus cleanup transition;
- update focus copy/action from **Show all** to **Show full graph**;
- update node tooltip text to describe remaining unfinished impact;
- retain Jira links and keyboard activation for nodes/recommendations.

Do not make the recommendation list depend on the current focus or show-done setting. It remains a
whole-current-scope ranking of unfinished blockers.

### 4.3 Make done styling contextual rather than prominent

In [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css):

- replace the green-tinted done node/swatch with neutral grey/muted treatment;
- reduce done node text and edge prominence without making text unreadable;
- add compact graph-control styling consistent with existing dark controls;
- preserve visible keyboard focus for the checkbox and all clickable graph/list controls;
- ensure high-leverage selectors cannot override the done neutral treatment.

CSS is a presentation reinforcement, not the correctness mechanism: a done item must already have
been removed from recommendations and actionable metrics before styling is applied.

### 4.4 Leave page scope, routing, backend, and persistence unchanged

No changes should be required in `App.tsx`, `plannerPageScopes.ts`, shared domain types, importer,
database schema, settings endpoints, or the engine's generic structural analyzer unless a testable
implementation constraint proves otherwise. If such a change becomes necessary, record the reason
and revised contract in this plan before making it.

## 5. Ordered implementation slices

### Slice 1 — Pure remaining-work analysis and layout contracts

1. Add focused fixtures with mixed `To Do`, `Done`, scenario-done, and cut nodes.
2. Introduce the canonical actionable predicate and separate structural/actionable analyses.
3. Add the show-done layout option and visible-geometry/edge filtering.
4. Expose typed actionable recommendations and counts.
5. Preserve cycle detection and focus behavior over structural data.

This slice is complete when unit tests can prove correctness without rendering React.

### Slice 2 — View control, recommendation behavior, and empty states

1. Add `showDone` local state and the graph control.
2. Replace direct access to the structural leaderboard with the actionable recommendation contract.
3. Add focus cleanup and rename the focus-reset affordance.
4. Add explicit all-done/no-blockers states.
5. Update helper copy and tooltips to say that leverage describes unfinished work.

### Slice 3 — Visual treatment and accessibility

1. Change done nodes/legend to muted grey context.
2. Style the compact checkbox/control group at narrow and wide widths.
3. Verify keyboard access, focus indicators, label association, SVG accessible name, and sufficient
   contrast in both toggle states.
4. Ensure the scroll container behaves correctly when hiding done nodes significantly shrinks the
   canvas.

### Slice 4 — Browser regression and final validation

1. Add deterministic mixed-status browser coverage.
2. Run targeted frontend tests, typecheck, build, and Dependencies Playwright coverage.
3. Manually inspect the motivating live-data shape if available, without making Jira mutations.
4. Record any material contract changes or follow-up work in this plan.

## 6. Verification plan

### 6.1 Unit tests

Extend
[`packages/frontend/test/graph.test.ts`](../packages/frontend/test/graph.test.ts) with small explicit
graphs whose expected sets and counts are obvious. Cover at least:

- a source-status `Done` blocker never appears in recommendations;
- a scenario-done blocker never appears in recommendations;
- a cut blocker never appears in recommendations;
- done and cut descendants do not contribute to direct or transitive remaining leverage;
- an unfinished blocker still ranks by the count of unfinished descendants;
- a done node shown for context has `done: true`, zero actionable leverage, and neutral tier;
- `showDone: false` removes done nodes and every incident rendered edge;
- hiding done recomputes rows, width/height, and visible focus count;
- showing done restores only real nodes/edges and never creates bridge edges;
- focus over a mixed subtree preserves its unfinished members when done is hidden;
- structural cycles still produce a warning even if one involved node is done (unless the product
  later explicitly decides cycle warnings should be visibility-scoped);
- all-done and no-actionable-edge inputs produce an empty recommendation collection without
  crashing or returning invalid geometry.

Keep the existing engine graph tests unchanged unless the generic analyzer itself changes. This
feature should be testable as frontend adaptation of its opaque-key result.

### 6.2 Browser tests

Extend
[`packages/frontend/e2e/timeline.spec.ts`](../packages/frontend/e2e/timeline.spec.ts), or create a
focused `dependencies.spec.ts` if the section grows enough to justify it. Use a deterministic
fixture with at least one done high-lifetime-leverage ticket and one unfinished blocker.

Verify:

1. open the Dependencies tab;
2. confirm the done node is visible and visually carries the done state by default;
3. confirm that ticket key is absent from **Work these next**;
4. confirm recommendation counts exclude completed descendants;
5. uncheck **Show done tickets** and confirm done nodes and their incident edges disappear;
6. confirm unfinished nodes, the epic scope summary, and recommendations remain;
7. re-check it and confirm done context returns but the done recommendation does not;
8. focus a done node, hide done, and confirm focus clears to the full remaining graph;
9. focus an unfinished recommendation and confirm **Show full graph** clears only focus, preserving
   the done checkbox state;
10. verify the checkbox and recommendation rows work by keyboard.

Prefer semantic locators and stable `data-testid` values for graph nodes/control state. Avoid
asserting generated SVG coordinates in Playwright; geometry belongs in unit tests.

### 6.3 Commands

Run from the repository root. The repository requires selecting its declared Node version before
every Node-based command:

```sh
nvm use
npm --workspace @ecp/frontend run test -- graph.test.ts

nvm use
npm --workspace @ecp/frontend run typecheck

nvm use
npm --workspace @ecp/frontend run build

nvm use
npm --workspace @ecp/frontend run e2e -- timeline.spec.ts --workers=1
```

Then run the broader workspace checks required by the repository before merging. Also run
`git diff --check` as a non-Node formatting sanity check.

### 6.4 Manual validation

Using data with a mix of done and unfinished dependency nodes:

1. Open Dependencies with all active epics and with a selected epic.
2. Confirm done nodes are grey context, not green/actionable emphasis.
3. Confirm no done or cut key appears in **Work these next**.
4. Pick one unfinished recommendation and manually compare its direct/total counts to unfinished
   downstream nodes in the graph.
5. Hide done tickets; confirm the remaining graph becomes easier to scan and does not invent edges.
6. Restore done tickets; confirm cross-epic context and focus/Jira links still work.
7. Exercise all-done, no-blockers, focused-done, and cycle-warning states if fixtures make them
   available.
8. At a narrow viewport, confirm the graph header control wraps without colliding with its helper
   text and the SVG remains horizontally scrollable.

## 7. Failure, concurrency, migration, security, accessibility, and observability

- **Failure handling:** The feature is pure client derivation over already loaded data. Unexpected
  missing edge endpoints should continue to be ignored safely. Empty visible/actionable sets must
  produce explicit UI states rather than exceptions or blank unexplained panels.
- **Concurrency:** There are no asynchronous writes. If a dataset reload changes status while the
  page is mounted, memoized layout and recommendations must update from the new `scope`/`scenario`;
  invalid focus must be cleared or treated as full graph.
- **Migration/persistence:** None. `showDone` is intentionally ephemeral and defaults on after a
  remount/reload. Persisting the preference can be considered separately if actual use shows value.
- **Security/privacy:** No new network calls, Jira permissions, user input rendering, or sensitive
  data surfaces are introduced. Continue using the existing safe Jira link construction.
- **Accessibility:** The visibility control requires a programmatic label, checked/disabled state,
  keyboard operation, and visible focus. Empty-state changes should be understandable without color.
  Grey done styling must retain readable contrast, and the check mark/text must carry completion
  meaning independently of color.
- **Observability:** No production telemetry is needed for local derived UI state. Automated tests
  are the guardrail. Do not log ticket titles or graph contents merely to observe toggle use.
- **Performance:** The view currently analyzes the graph twice (focused and full leaderboard).
  Prefer one reusable pure derivation per structural scope/show-done combination or otherwise avoid
  multiplying whole-graph traversals. Optimize only after preserving clear structural/actionable
  contracts; current portfolio sizes do not justify opaque caching.

## 8. Explicit non-goals

- Changing which Jira statuses normalize to `WorkItem.status === 'Done'`.
- Adding a Jira transition or planner action to mark a ticket done.
- Removing done work from the imported dataset or database.
- Persisting **Show done tickets** globally, per user, per epic, or in the URL.
- Changing the epic picker, route contract, cross-epic context rules, or shared capacity model.
- Rewriting the dependency graph with a third-party visualization library.
- Synthesizing dependencies across hidden completed nodes.
- Showing historical/lifetime leverage alongside remaining leverage in this slice.

## 9. Acceptance criteria

- A ticket effectively done by source status or scenario override never appears in **Work these
  next**.
- A scenario-cut ticket never appears in **Work these next**.
- Recommendation order, badges, node metrics, tiers, and emphasized edges are based only on
  unfinished, non-cut dependent work.
- Done tickets are visible by default as muted grey context and are not styled as actionable/high
  leverage.
- **Show done tickets** hides/restores done nodes and real incident edges without changing
  recommendations, epic scope, URLs, capacity data, or imported dependencies.
- Hiding a focused done ticket clears focus predictably; **Show full graph** resets focus without
  changing done visibility.
- All-done and no-unfinished-blocker states display explicit, useful messages.
- Existing cross-epic dependency context, cycle warning, Jira links, scrolling, and keyboard focus
  behavior continue to work.
- Unit and browser regressions fail under the current behavior and pass after implementation.
- Frontend typecheck, build, targeted tests, and Dependencies browser coverage pass.

## 10. Open questions and deferred choices

No blocking product decision is required for the proposed first slice. The following are explicitly
deferred and should be revisited only with usage evidence:

- whether **Show done tickets** should default off instead of on;
- whether the preference should persist locally or be represented in a shareable URL;
- whether to offer separate historical/lifetime impact metrics;
- whether a very large all-active graph needs additional epic grouping or density controls.

If implementation reveals that users interpret a done node's incident edge as an active blocker,
prefer clearer muted edge styling or tooltip copy before changing graph truth or synthesizing edges.

## 11. Continuation instructions

**Current status:** Implemented. The dependency view now derives structural, actionable, and visible
graphs independently; its local done-ticket preference defaults on and is not persisted. Focus,
cycle reporting, cross-epic scope, and Jira links remain structural behaviors.

**Validation completed:** Focused graph unit tests, frontend typecheck/build, Dependencies Playwright
coverage, and `git diff --check` passed on 2026-08-17. Browser coverage uses a mixed-status fixture
to verify that done context is visible by default, absent from recommendations, and removable with
the toggle.

**First files to inspect:**

1. [`packages/frontend/src/lib/graph.ts`](../packages/frontend/src/lib/graph.ts)
2. [`packages/frontend/test/graph.test.ts`](../packages/frontend/test/graph.test.ts)
3. [`packages/frontend/src/components/DependencyGraph.tsx`](../packages/frontend/src/components/DependencyGraph.tsx)
4. [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css)
5. [`packages/frontend/e2e/timeline.spec.ts`](../packages/frontend/e2e/timeline.spec.ts)
6. [`packages/engine/src/graph.ts`](../packages/engine/src/graph.ts) for the intentionally generic
   structural-analysis contract

**Initial discovery commands:**

```sh
git status --short
rg -n "buildGraphLayout|nodeState|analysis\.leaderboard|Work these next|is-done|graph-show-all" packages/frontend packages/engine
```

Before running tests or other Node-based commands, run `nvm use` from the repository root as
required by `AGENTS.md`.
