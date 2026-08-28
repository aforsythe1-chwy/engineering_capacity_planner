# Increment Planner edge-routing cleanup — durable implementation plan

**Status:** Implemented and validated in the local working tree; awaiting manual visual validation
**Created:** 2026-08-27
**Scope:** Increment Planner dependency-edge geometry, rendering, labels, and visual verification
**Intended outcome:** Dependency lines take short, stable, readable routes between increment zones
without crossing zone content, stacking labels, or making unnecessary perimeter loops.

**Related plans:**

- [`increment-planner-diagram-plan.md`](./increment-planner-diagram-plan.md) defines the Increment
  Planner product and Jira/local dependency semantics.
- [`increment-planner-canvas-reflow-sync-plan.md`](./increment-planner-canvas-reflow-sync-plan.md)
  establishes that layout geometry is derived and calls for routing edges after nodes settle. This
  focused plan specifies that missing routing work.
- [`planner-product-constitution.md`](./planner-product-constitution.md) remains the product
  boundary. This cleanup does not change navigation, epic filtering, capacity truth, or cross-epic
  dependency inclusion.

## 1. Problem statement and screenshot evidence

The supplied 2026-08-27 screenshot shows a useful increment layout whose dependency lines obscure
the flow:

- several solid Jira edges share a long left-side trunk, leaving repeated `blocks` labels detached
  from the zones they describe;
- the Increment 8 to Increment 9 dependency should be a short vertical connection, but the current
  presentation allows nearby edges and labels to compete for the same corridor;
- the proposed Increment 9 to UAT edge exits from the right, loops around the entire Increment 9
  zone, then returns to UAT from the left even though the target is visually below the source;
- long perimeter routes consume canvas space and make arrow direction harder to scan;
- edge labels sit on top of paths and boundaries at the zoom level shown.

The desired result is not perfectly crossing-free for every possible graph. It is a deterministic
orthogonal diagram in which common forward and downward dependencies are direct, obstacles are
respected, exceptional back-edges remain understandable, and selection reveals detail without
keeping every edge verbally labeled at rest.

## 2. Verified current behavior

These findings are verified against the current working tree on 2026-08-27:

- [`incrementPlannerPrototype.ts`](../packages/frontend/src/lib/incrementPlannerPrototype.ts)
  stores dependency meaning as `source`, `target`, and `sourceKind` and renders every sample edge as
  React Flow `smoothstep`.
- Sample edge ports are selected only from sprint equality: same-sprint edges use
  `bottom -> top`; different-sprint edges use `right -> left`. Actual source/target geometry is not
  consulted. This is the direct cause of the Increment 9 to UAT side-exit loop.
- Every Jira edge receives a visible `blocks` label and every proposed edge receives `proposed`.
  When paths overlap, their labels overlap or appear as a disconnected stack.
- [`reflowPlanner()`](../packages/frontend/src/lib/incrementPlannerPrototype.ts) derives sprint,
  increment, and ticket geometry from semantic membership. Edge paths are left entirely to React
  Flow after this node reflow.
- [`IncrementPlannerPage.tsx`](../packages/frontend/src/components/IncrementPlannerPage.tsx) passes
  semantic edges directly to `<ReactFlow>`, uses the built-in connection preview, and supports
  proposed-edge creation/reconnection.
- [`IncrementZoneNode`](../packages/frontend/src/components/IncrementPlannerPage.tsx) exposes
  source handles on the right and bottom and target handles on the left and top. Those four existing
  ports are sufficient for the normal left-to-right and top-to-bottom flow shown in the sample.
- [`styles.css`](../packages/frontend/src/styles.css) already defines the canvas palette and the
  solid Jira/dashed yellow proposed legend. No new color vocabulary is needed.
- Unit coverage checks edge presence and a few hard-coded handle choices, but does not assert route
  clearance, route length, determinism, label placement, crossings, or overlap.
- Browser coverage takes desktop and narrow screenshots, but it has no graph-legibility assertions.

The working tree already contains in-progress Increment Planner reflow and workspace changes in
`App.tsx`, `IncrementPlannerPage.tsx`, `incrementPlannerPrototype.ts`, `styles.css`, and
`incrementPlannerPrototype.test.ts`. They are user-owned work and must be preserved. Implement this
plan on top of those changes; do not reset or replace the files from `main`.

## 3. Root cause and bounded hypotheses

### Verified root cause

The routing decision uses semantic sprint equality as a proxy for geometry. React Flow's generic
`smoothstep` then finds a path between those preselected handles without knowledge of increment
rectangles as obstacles, route occupancy, or the preferred gutters created by the planner layout.
Repeated always-visible labels amplify any overlapping paths.

### Hypotheses to verify during implementation

- A small deterministic rectilinear router should be fast enough for the representative map size
  because routing happens between increment zones, not every ticket card.
- Existing 58px vertical gaps and 80px sprint-lane gaps provide enough routing channels after a
  modest node-clearance inset is reserved.
- Custom routing will solve the screenshot without changing increment packing. If routes still lack
  clearance, adjust shared layout gap tokens deliberately rather than adding edge-specific pixel
  exceptions.

### Implementation findings (2026-08-27)

- Added a pure deterministic visibility-graph router at
  `packages/frontend/src/lib/incrementPlannerEdgeRouting.ts`. It uses 14px obstacle clearance,
  18px port lead-outs, deterministic Jira-first ordering, orthogonal channel search, and an
  exterior fallback for an unavailable route.
- The renderer derives route data from settled increment rectangles only. Route data, port choices,
  and label points remain presentation state and never enter undo/redo snapshots.
- The current semantic reflow places UAT to the right of Increment 9, so its geometric preferred
  route is right-to-left. If a future settled layout places UAT below Increment 9, the same router
  selects bottom-to-top without a fixture-specific rule.

## 4. Decisions and invariants

### 4.1 Dependency meaning is unchanged

- Preserve `source`, `target`, Jira-versus-proposed source kind, deletion rules, and reconnection
  rules.
- Jira edges remain solid, muted blue-gray, read-only, and not animated.
- Proposed edges remain dashed yellow and editable. Remove continuous animation; selection and
  stronger stroke treatment are enough to communicate local status and avoid unnecessary motion.
- Edge routing is derived presentation state. Do not persist path points, chosen ports, label
  coordinates, or offsets in the eventual durable plan model.
- A reflow, viewport-independent reload, proposed-edge edit, or relevant node-size change must
  regenerate equivalent routes from the same semantic graph.

### 4.2 Route priorities

In descending priority, a route must:

1. start and end at the correct increment perimeter and preserve arrow direction;
2. avoid the padded rectangles of all non-endpoint increment zones;
3. avoid running through the interior of its source or target after leaving/approaching the port;
4. prefer the short geometric direction: `bottom -> top` for a target below with meaningful
   horizontal overlap, and `right -> left` for a target to the right with meaningful vertical
   overlap;
5. minimize length, then bends, then crossings and long shared segments;
6. remain stable under identical inputs and small unrelated changes;
7. use an exterior bypass only for back-edges or graphs with no clear interior corridor.

A path may cross another path when the graph makes that unavoidable. It may not cross a zone or
ticket surface merely to save distance.

### 4.3 Label policy

- Do not render `blocks` on every resting Jira edge. The legend and solid-line treatment already
  convey that meaning.
- Do not render a resting `proposed` word on every dashed edge. The legend and dashed yellow style
  convey source kind.
- When an edge is selected or keyboard-focused, show one compact source-kind badge near the middle
  of its longest clear segment, and retain the full relationship in the inspector.
- Keep an accessible name such as “Increment 8 blocks Increment 9; imported from Jira” independent
  of whether a visible label is present.

### 4.4 Visual and interaction invariants

- Lines remain behind zone and ticket surfaces; selected edges rise visually through contrast and
  stroke width, not by obscuring card text.
- Arrowheads must stop at the target perimeter and remain visible at the supported zoom range.
- Hover, selection, focus-visible, and `prefers-reduced-motion` behavior must be intentional.
- Creating and reconnecting a proposed dependency must use the same normalized routing behavior as
  imported edges as soon as the gesture completes.
- Route recomputation must not change pan/zoom, semantic undo history, selection, or edge identity.

## 5. Target routing contract

Add a pure module, proposed as
`packages/frontend/src/lib/incrementPlannerEdgeRouting.ts`, with no React dependency. Keep semantic
edge creation in the existing prototype/model seam.

Suggested public types and functions:

```ts
type RouteSide = 'top' | 'right' | 'bottom' | 'left';
type RoutePoint = { x: number; y: number };
type RouteRect = { id: string; x: number; y: number; width: number; height: number };

type RoutedIncrementEdge = {
  edgeId: string;
  sourceSide: RouteSide;
  targetSide: RouteSide;
  points: RoutePoint[];
  labelPoint: RoutePoint;
};

routeIncrementEdges(nodes, edges, options?): Map<string, RoutedIncrementEdge>;
routeToSvgPath(points, cornerRadius): string;
```

The exact names may change, but preserve these contracts:

- input is semantic edges plus settled absolute increment rectangles;
- output is render-only route data keyed by stable edge id;
- all path segments before corner rounding are horizontal or vertical;
- output contains no `NaN`, duplicate consecutive points, zero-length segments, or redundant
  collinear points;
- missing endpoints return a documented safe fallback and a development warning rather than
  crashing the whole canvas.

Centralize route constants in this module: node clearance, port lead-out, channel spacing, bend
penalty, crossing penalty, shared-segment penalty, and corner radius. Do not scatter route-specific
magic numbers across fixture data, React components, and CSS.

## 6. Routing algorithm

Implement and test the router as a deterministic rectilinear visibility graph:

1. Read settled increment rectangles after `reflowPlanner()`; ticket rectangles do not need to be
   separate obstacles because they are contained by their increment.
2. Inflate non-endpoint rectangles by the shared clearance token.
3. Generate valid port pairs from the currently supported semantic directions:
   source `right` or `bottom`, target `left` or `top`.
4. Rank port pairs from actual rectangle geometry, not sprint names. Give the natural direct pair a
   large preference, so Increment 8 to 9 and Increment 9 to UAT use `bottom -> top` in the pictured
   layout.
5. Build candidate horizontal and vertical channel coordinates from endpoint lead-outs, padded
   obstacle boundaries, and the midlines of available gaps.
6. Connect visible channel intersections whose segments do not enter a padded obstacle.
7. Use a deterministic shortest-path search with hard obstacle rejection and weighted costs for
   length, bends, backtracking, crossings, and reuse of an already occupied segment. Route edges in
   stable order: Jira before proposed, then source id, target id, and edge id.
8. Collapse collinear points and round corners only while producing the SVG path; collision tests
   continue to use the unrounded orthogonal segments.
9. Place the selected-edge badge on the longest segment that does not overlap a padded node or an
   already allocated badge box. Prefer horizontal segments, then apply a small deterministic offset.
10. If no interior route exists, evaluate top, right, bottom, and left exterior bypass corridors
    and choose the lowest-cost valid path. Mark this as a fallback in development diagnostics.

Do not introduce manual route overrides for individual increment ids. A fixture-specific exception
would reappear when live Jira data replaces the sample.

## 7. Rendering and integration seams

### 7.1 Pure route derivation

In [`IncrementPlannerPage.tsx`](../packages/frontend/src/components/IncrementPlannerPage.tsx):

- derive a `routedEdges` collection from the current settled nodes and semantic edges with
  `useMemo`;
- pass routed render data to React Flow without writing it back into semantic history;
- recompute after reflow, drag completion, resize completion, add/delete/reconnect, undo/redo, or a
  node dimension change;
- while a zone is actively dragged, either recompute at animation-frame cadence for the small
  graph or retain the last stable routes and show a lightweight preview; choose based on profiling,
  but always recompute on drag stop.

### 7.2 Custom edge component

Add a focused renderer, proposed as
`packages/frontend/src/components/IncrementPlannerEdge.tsx`, register it in `edgeTypes`, and render
the route with React Flow's public `BaseEdge`/edge-label facilities where they fit.

The component owns only presentation:

- SVG path creation from routed points;
- marker, hit-target, selected/focused, Jira, and proposed classes;
- conditional selected-edge badge;
- accessible label/description;
- safe fallback to the current React Flow path when route data is temporarily unavailable.

Keep edge colors and widths in
[`styles.css`](../packages/frontend/src/styles.css) using existing planner tokens or the current
canvas palette. Avoid per-edge inline style objects except for values React Flow requires.

### 7.3 Handle normalization

Replace the fixture's `sameSprint` handle choice with the router's chosen geometric sides. Apply the
same normalization to newly connected and reconnected proposed edges. The semantic relationship
must not change when its render ports change.

The first implementation should retain the existing source-right/source-bottom and
target-left/target-top authoring handles. If representative live data proves that upward or
backward dependencies need source-top/source-left routes, extend the port model as a separate,
tested interaction change; do not add overlapping handles speculatively in this cleanup.

## 8. Implementation slices

### Slice 1 — Characterization and pure route model

- Add unit fixtures reproducing vertical neighbors, horizontal neighbors, one blocking middle
  rectangle, parallel edges, the Increment 8/9/UAT case, and a required exterior back-edge.
- Implement geometry primitives, port ranking, obstacle checks, deterministic path search, and
  route cleanup in `incrementPlannerEdgeRouting.ts`.
- Replace the existing tests that assert sprint-based handle selection with geometry-based route
  assertions.

**Exit:** Pure tests show that the pictured 8 -> 9 and 9 -> 10 edges use short bottom-to-top paths,
all segments avoid padded non-endpoint zones, and identical inputs produce byte-equivalent routes.

### Slice 2 — Custom rendering and label cleanup

- Add `IncrementPlannerEdge.tsx` and register the custom edge type.
- Move source-kind styling from inline fixture objects into scoped CSS classes.
- Remove always-visible edge text; add the selected/focused badge and accessible relationship name.
- Remove continuous proposed-edge animation and honor reduced-motion preferences for any remaining
  transition.

**Exit:** Resting edges are visually quiet, source kind is still unambiguous from the legend and
line style, and selecting either edge kind reveals one readable badge plus inspector detail.

### Slice 3 — Lifecycle integration

- Derive routed edges after every semantic reflow and relevant edge mutation.
- Normalize proposed add/reconnect behavior and preserve deletion, selection, undo, and redo.
- Ensure route calculation uses absolute increment geometry and does not accidentally treat sprint
  bands or ticket cards as independent blockers.
- Add a bounded performance guard: memoized inputs, stable ordering, and development-only timing if
  representative routing exceeds one animation frame.

**Exit:** Drag, reflow, resize, proposed-edge creation/reconnection, undo, and redo leave every edge
attached and rerouted without changing the viewport or semantic history.

### Slice 4 — Visual QA and hardening

- Extend `packages/frontend/e2e/increment-planner.spec.ts` with edge-specific selectors and focused
  screenshot coverage at the screenshot's representative desktop viewport.
- Check full canvas, zoomed selection, focus canvas, narrow viewport, and reduced-motion mode.
- Tune shared clearance and cost tokens from evidence; do not tune paths per fixture edge.
- Update this plan's status, findings, and validation record.

**Exit:** The target screenshot region has no duplicated `blocks` labels, no edge crosses an
increment surface, and the proposed 9 -> UAT route no longer loops around Increment 9.

## 9. Verification

Before every Node-based command, run `nvm use` from the repository root as required by `AGENTS.md`.

### Automated

Run:

```sh
nvm use
npm run test --workspace @ecp/frontend -- --run packages/frontend/test/incrementPlannerEdgeRouting.test.ts packages/frontend/test/incrementPlannerPrototype.test.ts
npm run typecheck --workspace @ecp/frontend
npm run build --workspace @ecp/frontend
npm run e2e --workspace @ecp/frontend -- e2e/increment-planner.spec.ts
```

Adapt the Vitest path syntax if the workspace runner expects paths relative to
`packages/frontend`; record the working command here.

Required unit assertions:

- preferred ports come from geometry rather than sprint equality;
- paths are orthogonal before corner rounding;
- paths do not intersect padded non-endpoint rectangles;
- endpoint lead-outs do not re-enter their own rectangles;
- points are finite, normalized, and deterministic;
- simple vertical and horizontal relationships use bounded detours;
- obstacle cases choose a valid gutter;
- exterior fallback is valid and deterministic;
- parallel/shared-corridor edges receive stable separation or crossing penalties;
- selected label placement does not land inside a zone;
- missing endpoint and cyclic semantic graphs fail safely;
- Jira/proposed semantics and proposed editability remain unchanged.

### Manual visual walkthrough

1. Open `?tab=increments` at 1440 x 1000 and fit the plan.
2. Inspect Increments 8, 9, and UAT: 8 -> 9 and 9 -> UAT should read as short downward flows.
3. Pan to the left edge of Increments 8 and 9; confirm there is no detached stack of `blocks`
   labels and no unnecessary shared perimeter trunk.
4. Select one Jira edge and one proposed edge; confirm their badge, arrow direction, inspector
   details, hit target, and keyboard focus are readable.
5. Move a ticket so its increment resizes, move an increment to another sprint, run Reflow, then
   undo/redo; confirm routes remain attached, clear, and stable without viewport jumps.
6. Create, reconnect, and delete a proposed edge; confirm dashed styling and route normalization.
7. Repeat in Focus canvas, at 390 x 844, at 200% browser zoom, and with reduced motion enabled.
8. Capture before/after screenshots in the existing Playwright output location and link any durable
   comparison artifact from this plan.

## 10. Failure, performance, accessibility, and rollout considerations

- **Failure:** A route failure affects only presentation. Fall back to a direct React Flow path,
  keep the edge selectable, and emit a development warning with edge id and failure reason.
- **Performance:** Route increment-to-increment edges only. Start with synchronous pure routing;
  move it to a worker only if profiling with representative live graph sizes shows sustained UI
  blocking. Do not add worker complexity based on the small sample alone.
- **Concurrency:** The current prototype is local single-user state. Always derive all routes from
  one nodes/edges snapshot so concurrent React updates cannot combine stale node geometry with new
  edges.
- **Migration:** None. Route points and handle decisions are not persisted. Existing and future
  saved semantic dependency records remain compatible.
- **Security/privacy:** No new external input, network request, HTML injection, or sensitive data
  handling is introduced. Treat edge labels as text, not HTML.
- **Accessibility:** Visible labels may be suppressed only because equivalent accessible names and
  inspector details remain. Preserve a generous invisible hit path, keyboard selection, visible
  focus, arrow/source meaning, and non-color source-kind text in the legend/inspector.
- **Observability:** No production telemetry is required for the first cleanup. Development-only
  route timing/fallback counts are appropriate; do not log full Jira titles or other unnecessary
  issue data.
- **Rollout:** No feature flag is needed for the prototype. Keep the old path as an internal
  fallback until the new router passes unit, interaction, and screenshot verification.

## 11. Explicit non-goals

- changing dependency data, Jira sync/write-back, or proposed-edge persistence;
- changing sprint membership, increment order, capacity calculations, or ticket packing except for
  a shared gutter-size adjustment proven necessary by routing tests;
- ticket-to-ticket dependency rendering inside an increment;
- a general-purpose whiteboard router or user-authored bend points;
- guaranteeing a mathematically crossing-free drawing for arbitrary cyclic graphs;
- changing page navigation, epic filters, responsive panel architecture, or the product
  constitution;
- adding a new graph/layout dependency before proving the installed React Flow and a small pure
  router are insufficient.

## 12. Acceptance criteria

- The Increment 9 -> UAT proposed edge in the supplied layout exits the bottom of Increment 9 and
  enters the top of UAT without wrapping around Increment 9.
- Increment 8 -> 9 reads as a short top-to-bottom dependency.
- No routed segment intersects a padded non-endpoint increment rectangle in automated fixtures or
  the representative browser scenario.
- Resting canvas edges do not show repeated `blocks`/`proposed` text; selection and accessible
  inspection still identify relationship and source kind.
- Solid Jira and dashed proposed semantics, arrow direction, edit permissions, selection, and
  inspector behavior are preserved.
- Routes are deterministic and regenerate after layout/edit operations without entering semantic
  undo history or persistence.
- Desktop, focus, narrow, zoomed, keyboard, and reduced-motion checks pass.
- Frontend unit tests, typecheck, build, and Increment Planner Playwright coverage pass.
- The existing user-owned working-tree changes remain intact.

## 13. Continuation record

**Current status:** Slices 1–4 implemented locally. The pure router, custom renderer, lifecycle
derivation, unit coverage, and Playwright coverage are complete. No route points are persisted.

**Validation record (2026-08-27):**

- `npm run test --workspace @ecp/frontend -- --run incrementPlannerEdgeRouting.test.ts incrementPlannerPrototype.test.ts` — passed (10 tests).
- `npm run typecheck --workspace @ecp/frontend` — passed.
- `npm run build --workspace @ecp/frontend` — passed.
- `npm run e2e --workspace @ecp/frontend -- e2e/increment-planner.spec.ts` — passed.

**Next action:** Perform the manual visual walkthrough in section 9, especially route clearance and
selected-edge badges at desktop, narrow, focus, zoomed, and reduced-motion settings.

**First files to inspect:**

1. `packages/frontend/src/lib/incrementPlannerPrototype.ts`
2. `packages/frontend/src/components/IncrementPlannerPage.tsx`
3. `packages/frontend/src/styles.css`
4. `packages/frontend/test/incrementPlannerPrototype.test.ts`
5. `packages/frontend/e2e/increment-planner.spec.ts`

**First commands:**

```sh
git status --short
git diff -- packages/frontend/src/components/IncrementPlannerPage.tsx packages/frontend/src/lib/incrementPlannerPrototype.ts packages/frontend/src/styles.css packages/frontend/test/incrementPlannerPrototype.test.ts
nvm use
npm run test --workspace @ecp/frontend -- --run incrementPlannerPrototype.test.ts
```

After each slice, update the status, verified findings, validation results, and next action here so
this file remains the source of truth after conversation context is cleared.
