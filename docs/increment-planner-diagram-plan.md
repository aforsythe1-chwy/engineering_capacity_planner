# Increment Planner and Delivery Map - Durable Implementation Plan

**Status:** Proposed for review; no implementation has started

**Created:** 2026-08-19

**Repository baseline:** `9af3479` (`main` at plan creation)

**Planning branch:** `codex/task-manager-diagram-plan`

**Worktree:** `/private/tmp/ecp-task-manager-diagram-plan`

**Scope:** a new peer-level Increment Planner tab for creating Jira-linked delivery maps with
editable increment zones, blocking relationships, sprint/capacity context, and deterministic
planning assistance

**Governed by:** [`planner-product-constitution.md`](./planner-product-constitution.md)

**Reference artifact:** `/Users/aforsythe1/Downloads/Ops Task Manager Increment Diagram.pdf`

## 1. Intended outcome

Add an **Increment Planner** tab where a team can turn a tracked epic into a durable, editable
delivery map like the Ops Task Manager diagram:

- create and resize named increment zones;
- place Jira tickets inside zones while retaining direct Jira links and current Jira facts;
- see and create blocker relationships within and across zones;
- keep one-hop external dependencies visible rather than silently dropping them;
- position the work against sprint capacity and move it as a planning exercise;
- get deterministic assistance for layout, critical-path analysis, and feasible sprint placement;
- save the map locally, reload it, sync Jira, and import/export the planner database without losing
  the human-authored layout.

The result is not a generic whiteboard. It is a structured planning surface whose shapes are backed
by typed domain data, whose tickets remain grounded in Jira, and whose sprint bands use the same
shared-capacity truth as the rest of the application.

## 2. Verified source findings

### 2.1 PDF model

The supplied PDF is a one-page, wide canvas containing an embedded 8192 x 3797 image. Visual review
at full resolution confirms these semantics:

- sprint capacity bands run across the top for Sprints 68, 69, and 70;
- the stated capacity assumption is 2.5 engineers at 15 points each, or 37.5 points per sprint;
- the displayed sprint loads are 26, 36, and 38 points;
- ten increment zones group Jira cards into delivery outcomes;
- ticket-level arrows represent prerequisite direction;
- arrows cross zone boundaries, so zones do not replace ticket dependencies;
- the diagram calls out Increment 4 as a broad UI gate and Increment 6 as the gate for Increments 7
  and 8;
- embedded product screenshots act as outcome/acceptance evidence between groups of work;
- a separate UAT Testing Buffer is deliberately modeled even though it has no Jira scope yet;
- at least one linked item (`NF-2940`) sits outside the main flow and is marked as part of CPC.

The current increment breakdown in the diagram and current one-pager is:

| Increment | Name | Jira scope shown in the current one-pager | Planning LOE |
| --- | --- | --- | ---: |
| 1 | Login & Page Access | NF-2774, NF-2841, NF-2842, NF-2843 | 3 |
| 2 | Discovery & Spikes | NF-2806, NF-2844 through NF-2853 with gaps; NF-2847/2848/2849 called critical | 17 |
| 3 | Network Health Bar | NF-2868, NF-2827 | 2 known / 6 assumed |
| 4 | CHIRP MUI Data Grid Setup | NF-2807, NF-2839, NF-2840 | 5 |
| 5 | Task Table Data Hydration | NF-2817, NF-2818, NF-2820, NF-2811 | 12 assumed |
| 6 | Task Table UI Foundation | NF-2821, NF-2814, NF-2815, NF-2837, NF-2838, NF-2813 | 13 known / 19 assumed |
| 7 | Search, Filter, Navigation | NF-2810, NF-2829, NF-2830, NF-2831 | 8 |
| 8 | Task Reassignment | NF-2854, NF-2855, NF-2856, NF-2858, NF-2857, NF-2859 | 12 known / 18 assumed |
| 9 | Assignment Logic & Audit | NF-2835, NF-2836, NF-2823, NF-2824, NF-2825, NF-2826 | 4 known / 12 assumed |
| 10 | UAT Testing | TBD | buffer |

The one-pager schedules Increments 1-3 into Sprint 68, carryover plus Increments 4-6 into Sprint 69,
Increments 7-9 into Sprint 70, and test/buffer work into Sprint 71. That sequencing is planning intent,
not a Jira-native hierarchy.

### 2.2 Current internal planning sources

The current authoritative planning page is the [Ops Task Manager UI One-Pager](https://chewyinc.atlassian.net/wiki/spaces/PPE/pages/5406031959/Ops+Task+Manager+UI+One-Pager),
version 2, last updated 2026-08-11. It identifies [NF-2771](https://chewyinc.atlassian.net/browse/NF-2771)
as the current engineering epic. The older [Task Manager UI Epic One-Pager](https://chewyinc.atlassian.net/wiki/spaces/PPE/pages/5137760798/Task+Manager+UI+Epic+One-Pager)
and [Task Manager technical page](https://chewyinc.atlassian.net/wiki/spaces/PPE/pages/4835411265/Task+Manager)
remain useful historical context but contain VSRB-era scope and should not drive the initial map.

A read-only Jira snapshot on 2026-08-19 found:

- NF-2771 is the **Ops Manager Task UI** epic and is currently To Do;
- `parent = NF-2771` returns 75 issues: 67 To Do, 5 Complete, and 3 In Progress;
- those issues expose 68 outward `Blocks` edges;
- 51 of those edges point to another direct NF-2771 child and 17 point outside that direct-child
  result set;
- NF-2877 currently fans out to 28 downstream issues, NF-2807 to 12, and NF-2846 to 4;
- the epic therefore contains substantially more Jira work than the curated set placed in the PDF.

This proves that the canvas needs an **unassigned ticket tray**. Automatically putting every epic
child into a visible zone would reproduce Jira noise rather than the engineer's curated plan.

### 2.3 Current application seams

Verified against the repository baseline:

- [`packages/frontend/src/App.tsx`](../packages/frontend/src/App.tsx) owns a flat peer-tab shell and
  preserves an epic filter while changing pages.
- [`packages/frontend/src/lib/router.ts`](../packages/frontend/src/lib/router.ts) serializes the page
  and epic filter independently. A new tab can use `?tab=increments&epics=NF-2771` without introducing
  a drill-down route.
- [`packages/frontend/src/components/DependencyGraph.tsx`](../packages/frontend/src/components/DependencyGraph.tsx)
  is a useful read-only SVG graph, but it has no node dragging, grouping, edge editing, resizing,
  viewport persistence, or compound layout.
- [`packages/frontend/src/lib/graph.ts`](../packages/frontend/src/lib/graph.ts) already provides cycle,
  leverage, and transitive-dependency analysis worth reusing.
- [`packages/frontend/src/components/GanttBoard.tsx`](../packages/frontend/src/components/GanttBoard.tsx)
  and [`packages/frontend/src/lib/gantt.ts`](../packages/frontend/src/lib/gantt.ts) already model
  draggable ticket placement and full-portfolio weekly load.
- [`packages/shared/src/domain.ts`](../packages/shared/src/domain.ts) defines Jira-owned work items and
  dependencies separately from human-authored planned placements.
- [`packages/backend/src/db/schema.ts`](../packages/backend/src/db/schema.ts) and
  [`packages/backend/src/db/reconcile.ts`](../packages/backend/src/db/reconcile.ts) establish the
  important pattern: Jira facts are refreshed; local planning intent is reconciled and preserved.
- The current Jira mapper discards an issue link unless **both** endpoints are in the one epic's
  `workItemKeys`. Aggregating epics later cannot recover a discarded cross-epic edge. This is the
  root cause of incomplete external dependency context today.
- Database snapshot files contain every SQLite table, but drag-and-drop database import currently
  reads and rewrites only `DomainDataset`. New map tables must participate in that read/write path or
  they will be lost during import.

## 3. Product decisions and invariants

### 3.1 One peer tab, not an epic sub-application

Add `increments` to `PlannerTab` and label it **Increment Planner**. It remains a peer of Overview,
Timeline, Dependencies, Gantt Planner, Team, Standup, and Configuration.

- Empty epic filter: show an all-active **map index** with one row/card per tracked epic, map status,
  unmapped-ticket count, blocker count, known/unestimated points, and next overloaded sprint.
- One selected epic: show its editable delivery map.
- Selecting or clearing an epic never changes the active tab.
- Changing tabs preserves the epic selection.
- Continue using `string[]` for route scope even though one map is edited at a time.

This satisfies the constitution's useful all-active state without trying to render every epic's
editable canvas at once.

### 3.2 Three kinds of truth

Keep these concerns explicit in types and UI:

| Ownership | Examples | Sync behavior |
| --- | --- | --- |
| Jira facts | key, title, status, points, assignee, parent, native Blocks links | refreshed by sync |
| Local planning intent | zones, membership, positions, viewport, notes, proposed edges, schedule locks | preserved by sync |
| Derived analysis | zone totals, rolled-up blockers, cycle warnings, capacity verdicts, suggested schedule | recomputed; never persisted as fact |

The UI must visually distinguish a Jira blocker from a locally proposed blocker. A Jira edge is
solid and read-only in the initial release. A proposed edge is dashed, editable, and labeled
**Proposed**.

### 3.3 Jira must not be mutated implicitly

Creating, moving, grouping, or deleting objects on the canvas does not modify Jira. The prototype
and initial production slice are local-first.

If Jira write-back is approved later, add an explicit **Publish dependency to Jira** action with a
preview and confirmation. It must call a narrow backend route, use the configured Blocks link type,
be idempotent, report permission/conflict errors, and refresh Jira afterward. Never bind Jira writes
directly to a drag or connect gesture.

### 3.4 Capacity remains portfolio truth

Sprint bands always show:

- total load from all active portfolio work;
- the selected epic/map contribution;
- available team capacity after PTO, on-call, and velocity overrides;
- known points and unestimated-ticket count separately.

Filtering to NF-2771 must not make other work disappear from the capacity calculation. This reuses
the Gantt's existing `portfolioWorkItems` / `portfolioPlacements` separation.

### 3.5 A zone is not a Jira hierarchy

An increment zone is a local grouping of work toward a demonstrable outcome. It does not change the
ticket's Jira parent, label, component, sprint, or issue type. A ticket belongs to at most one zone
per epic map and may remain in the unassigned tray.

## 4. Target user experience

### 4.1 All-active map index

When no epic is filtered, render a compact portfolio-oriented page rather than an empty prompt:

- one row/card per active epic;
- `No map`, `Draft`, `Needs attention`, or `Mapped` status;
- mapped / total ticket count;
- known remaining points plus unestimated count;
- unresolved external blocker and cycle counts;
- capacity warning for the earliest overloaded sprint;
- **Open map** applies that epic to the existing filter but stays on Increment Planner.

### 4.2 Epic canvas

Use this structure at desktop widths:

```text
Increment Planner toolbar
  Add increment | Add Jira ticket | Auto-layout | Suggest schedule | Undo/Redo | Fit

Unassigned ticket tray | Zoomable delivery canvas | Selection inspector
                         Sprint capacity bands
                         Increment group nodes
                           Jira ticket nodes
                         Jira + proposed dependency edges
                         External dependency stubs
```

The tray and inspector collapse to maximize the canvas. The canvas is the page's primary surface;
avoid wrapping it in several heavy panels.

Core interactions:

- pan, zoom, fit-to-view, minimap, marquee selection, and keyboard selection;
- create, rename, resize, recolor, reorder, and delete a zone;
- drag an unassigned Jira ticket into a zone;
- move tickets between zones or back to the tray;
- create a proposed blocker by connecting explicit **blocks** and **blocked by** handles;
- delete or reconnect only proposed edges;
- click the Jira key/icon to open the issue in a new tab without selecting or dragging the node;
- select a ticket, zone, or edge to inspect its source, status, point contribution, blockers, and
  scheduling impact;
- auto-layout the full map or only the selected zone;
- show an autosave state: `Saving`, `Saved`, `Conflict`, or `Offline/read-only`.

### 4.3 Node and zone presentation

Reuse the existing dark tokens and compact geometry.

- Ticket node: Jira key, two-line title, status, points or `Unestimated`, assignee, Jira icon, and
  source badge when external.
- Zone: restrained tinted border/header, name, objective, known/unestimated totals, mapped ticket
  count, derived sprint state (`Unplanned`, one sprint, or `Split`), and blocker warning.
- Sprint band: sprint name/dates, total load/capacity, selected-map contribution, and a green/yellow/
  red verdict used only for meaningful capacity state.
- External issue: compact dashed boundary node; it can explain a blocker but cannot be placed into a
  zone owned by this epic unless the issue becomes part of the tracked portfolio.
- Buffer/milestone zone: supports a `buffer` kind so UAT can exist without fake Jira tickets or fake
  points.

### 4.4 Narrow viewport and accessibility

Diagram editing is desktop-first, but a narrow viewport must remain usable:

- collapse tray and inspector into modal sheets;
- keep the canvas pannable rather than shrinking ticket text below legibility;
- provide an **Outline** view listing zones, tickets, and dependencies in semantic DOM order;
- allow zone assignment and dependency creation from accessible forms as an alternative to dragging;
- keep React Flow keyboard movement and focus support enabled;
- give nodes and edges meaningful `aria-label` text and announce save/layout results;
- never use color as the only indicator of source, status, or capacity.

## 5. Diagramming stack decision

Use:

- [`@xyflow/react`](https://reactflow.dev/) for the interactive editor;
- [`elkjs`](https://www.npmjs.com/package/elkjs) for deterministic compound auto-layout.

As of this plan, `@xyflow/react` 12.11.x and `elkjs` 0.12.x are the current package lines. Pin normal
compatible ranges in `packages/frontend/package.json` and commit the lockfile after running `nvm use`.

Why React Flow:

- MIT licensed and supports custom nodes/edges, dragging, pan/zoom, selection, controls, minimap,
  reconnectable edges, and keyboard accessibility;
- `parentId`, `extent: 'parent'`, and `expandParent` provide the compound/group behavior needed for
  increment zones;
- controlled node/edge state fits the repository's React architecture and permits local undo plus
  explicit persistence.

Why ELK rather than Dagre:

- ELK Layered supports compound graphs, ports, orthogonal routing, and cross-hierarchy edges;
- React Flow's own layout guidance notes a Dagre limitation for subflows connected to nodes outside
  the subflow, which is a primary requirement here;
- ELK can lay out ticket nodes inside zones and route cross-zone blockers while preserving the
  blocker-to-blocked left-to-right direction.

Do not copy React Flow Pro example source. Implement a small project-owned adapter against the
public React Flow and ELK APIs. Start with measured node sizes and a Web Worker-backed ELK adapter so
auto-layout cannot freeze the UI as maps grow.

The existing SVG dependency graph remains available for the Dependencies tab. Reuse its pure graph
analysis and Jira-link presentation; do not try to incrementally turn its renderer into an editor.

## 6. Domain and persistence design

Add optional, default-empty collections to `DomainDataset` so maps participate in existing
transactional dataset replacement, Jira reconciliation, database snapshots, and drag-and-drop DB
import. Focused APIs still load and mutate a single map; the full dataset remains the recovery and
portability contract.

Suggested shared types:

```ts
interface IncrementMap {
  id: string;
  epicKey: string;          // one map per epic initially
  name: string;
  revision: number;         // optimistic concurrency
  viewportX: number;
  viewportY: number;
  viewportZoom: number;
  createdAt: string;
  updatedAt: string;
}

type IncrementKind = 'delivery' | 'discovery' | 'buffer';

interface IncrementZone {
  id: string;
  mapId: string;
  name: string;
  objective: string | null;
  kind: IncrementKind;
  colorToken: string;       // allowlisted semantic token, never arbitrary CSS
  order: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scheduleLocked: boolean;
}

interface IncrementMapNode {
  id: string;
  mapId: string;
  issueKey: string;
  issueSource: 'tracked' | 'external';
  zoneId: string | null;    // null means tray/boundary context
  x: number;                // relative to zone when grouped; canvas when external
  y: number;
  width: number;
  height: number;
}

interface ProposedDependency {
  id: string;
  mapId: string;
  blockerIssueKey: string;
  blockedIssueKey: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface JiraIssueReference {
  key: string;
  title: string;
  status: string;
  statusCategory: string | null;
  points: number | null;
  parentKey: string | null;
  url: string;
  lastSeenAt: string;
}

interface ExternalDependency {
  id: string;
  blockerIssueKey: string;
  blockedIssueKey: string;
  lastSeenAt: string;
}
```

SQLite tables mirror these types:

- `increment_map` with `UNIQUE(epic_key)` and `revision >= 0`;
- `increment_zone` with finite coordinate/size validation in the repository;
- `increment_map_node` with `UNIQUE(map_id, issue_key)`;
- `proposed_dependency` with `UNIQUE(map_id, blocker_issue_key, blocked_issue_key)`;
- `jira_issue_reference` for one-hop linked issues not present as tracked work items;
- `external_dependency` for a Jira Blocks edge with one or both endpoints outside `work_item`.

Fresh tables use foreign keys where the target is structurally stable. Polymorphic issue keys are
validated in repository transactions against either `work_item` or `jira_issue_reference`.

Required invariants:

- one map per epic for the initial release;
- one node per issue per map;
- a tracked issue may be in zero or one zone in its epic map;
- external references may be boundary nodes but not members of a local increment;
- no self-edge and no duplicate directed edge;
- deleting a zone moves its nodes to the tray; it does not delete Jira tickets or dependencies;
- deleting a map deletes only local map intent;
- coordinates and sizes are finite, bounded numbers;
- every mutation increments the map revision in the same transaction.

Update all durability seams together:

- `SCHEMA_SQL`, insertion/deletion order, migration initialization, indexes;
- `readDataset` / `writeDataset` and fixture defaults;
- Jira reconciliation so local maps, zones, positions, and proposed edges survive;
- snapshot import summary and tests so an imported DB retains maps;
- obfuscated export so titles/keys are transformed consistently and no internal map data leaks into
  a shareable fixture accidentally.

## 7. Focused backend API

Add `packages/backend/src/routes/increment-maps.ts` and
`packages/backend/src/db/increment-maps.ts`.

Recommended endpoints:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/increment-maps` | all-active map index projection |
| GET | `/api/epics/:epicKey/increment-map` | map, live issue data, edges, tray, sprints, and capacity |
| POST | `/api/epics/:epicKey/increment-map` | create the epic's map |
| PATCH | `/api/increment-maps/:mapId` | rename or save viewport with `expectedRevision` |
| POST | `/api/increment-maps/:mapId/zones` | create a zone |
| PATCH | `/api/increment-maps/:mapId/zones/:zoneId` | edit zone metadata |
| DELETE | `/api/increment-maps/:mapId/zones/:zoneId` | remove zone and ungroup nodes |
| PUT | `/api/increment-maps/:mapId/layout` | atomic, debounced positions/sizes/membership batch |
| POST | `/api/increment-maps/:mapId/proposed-dependencies` | add a local proposed edge |
| DELETE | `/api/increment-maps/:mapId/proposed-dependencies/:id` | remove a proposed edge |
| POST | `/api/increment-maps/:mapId/schedule-preview` | preview zone-to-sprint placement changes |
| POST | `/api/increment-maps/:mapId/schedule-apply` | atomically apply an accepted preview to ticket placements |

Every write accepts `expectedRevision`. A stale write returns `409` with the current revision. Layout
updates are complete batches for the changed nodes/zones, sent after a short debounce and on pointer
release. The client updates optimistically, retains an undo/redo command stack, and clearly reports
save failure rather than pretending the drag persisted.

The map projection should provide already-resolved ticket cards and derived summaries so the React
component does not recreate backend ownership rules:

```ts
interface IncrementMapProjection {
  map: IncrementMap;
  zones: IncrementZone[];
  nodes: Array<IncrementMapNode & { issue: ResolvedIssueCard }>;
  jiraEdges: ResolvedDependency[];
  proposedEdges: ResolvedDependency[];
  unassignedIssues: ResolvedIssueCard[];
  sprintBands: SprintCapacityBand[];
  warnings: MapWarning[];
}
```

## 8. Jira import and reconciliation changes

### 8.1 Preserve cross-epic edges

Move final dependency extraction to a portfolio-aware pass:

1. Fetch and map each active epic as today.
2. Build the complete set of imported work-item keys across all mapped epics.
3. Scan the retained raw Jira issues' configured Blocks links.
4. Persist an internal `Dependency` when both endpoints are tracked work items, even when they belong
   to different epics.
5. Collect missing endpoint keys and fetch one bounded hop of issue details in JQL chunks.
6. Persist missing endpoints as `JiraIssueReference` plus their edge as `ExternalDependency`.
7. Do not recursively traverse dependencies of those external references.

Bound the one-hop expansion by a configurable maximum and return a visible truncation warning. Cache
the fetched fields through the existing Jira request cache. Request only key, summary, status,
parent, assignee, configured points field, and issue links needed for the projection.

### 8.2 Reconcile without losing human layout

On sync:

- Jira work item fields and Jira edges refresh;
- external issue stubs refresh or become stale when unavailable;
- zone membership and coordinates remain for surviving issue keys;
- a removed/archived ticket becomes an orphaned map node with its last-known reference instead of
  silently disappearing;
- the UI offers **Remove from map** or **Relink**, but sync does not decide for the user;
- proposed edges survive unless an endpoint is explicitly removed from the map;
- when Jira gains the same edge as a proposed edge, mark the proposal as satisfied and offer a
  one-click cleanup rather than rendering two overlapping edges;
- existing local ticket placements retain the reconciliation precedence already implemented for
  Gantt.

Add sync-log counts for external references discovered/refreshed, map nodes orphaned, and proposals
satisfied by Jira.

## 9. Sprint placement and "Tetris" behavior

`planned_placement` remains the canonical ticket-level schedule. The map does not invent a second
capacity ledger.

Derived zone schedule:

- **Unplanned:** no unfinished zone ticket has a placement;
- **Sprint N:** all unfinished placed tickets are in the same sprint;
- **Split:** unfinished tickets occupy more than one sprint or some are placed and some are not.

Dragging a zone onto a sprint band opens a placement preview; it does not write immediately. The
preview shows:

- affected, skipped, completed, and unestimated tickets;
- current and proposed sprint load;
- selected epic contribution and total portfolio load;
- capacity verdict before and after;
- dependency violations introduced by the move;
- conflicts with locally locked/manual placements.

Default apply mode is **place only currently unplanned unfinished tickets**. An explicit alternate
mode can replace existing placements for all unfinished zone tickets. Apply the accepted batch in a
single backend transaction. Moving an individual ticket continues to use the existing placement
contract and can intentionally create a split increment.

Never treat an unestimated ticket as zero effort in a fit decision. Display `known points + N
unestimated`. A configurable what-if estimate may be used in a suggestion preview, but it must be
labeled as an assumption and never overwrite Jira points.

## 10. Automatic assistance

Deliver assistance as deterministic, previewable operations before considering any AI-backed
clustering.

### 10.1 Auto-layout

- transform zones, ticket nodes, ports, and blockers into an ELK compound graph;
- lay out blocker-to-blocked from left to right with orthogonal edges;
- order high-leverage blockers earlier within a zone;
- preserve locked zone positions;
- allow full-map or selected-zone layout;
- show a preview and support undo before autosave.

### 10.2 Map diagnostics

Continuously derive:

- cycles;
- zone-to-zone rolled-up blockers;
- outside dependencies;
- unassigned and orphaned tickets;
- unestimated work;
- work scheduled before an unfinished prerequisite;
- zones that exceed a sprint's remaining capacity;
- critical path and highest-leverage blockers using the existing graph analysis.

### 10.3 Suggested schedule

Produce a proposal, never an automatic commit:

1. collapse ticket dependencies into a zone DAG while retaining intra-zone edges for detail;
2. refuse to claim a valid ordering when a cycle exists;
3. respect completed blockers, locked zones, existing manual placements, and cross-epic prerequisites;
4. process ready zones by critical-path length, then downstream leverage, then stable zone order;
5. choose the earliest sprint with sufficient **remaining full-portfolio capacity**;
6. report zones that do not fit or contain unestimated work instead of quietly overcommitting;
7. return a diff the user can accept per zone or as one transaction.

### 10.4 Suggested grouping (later)

After the editor is proven, suggest zones from Jira parent stories, labels, components, title prefixes,
and dependency communities. NF-2771's mostly direct-child shape means no one Jira field can recreate
the engineer's ten semantic increments. Suggestions must therefore stay editable and show why each
ticket was grouped. Confluence/one-pager ingestion is an explicit future integration, not a hidden
dependency of the first release.

## 11. Ordered implementation slices

### Slice 0 - Prototype checkpoint: validate the editor choice

**Goal:** a reviewable visual prototype using current dataset data, with no persistence and no Jira
mutation.

Files:

- `packages/frontend/package.json` / root lockfile;
- `packages/frontend/src/App.tsx`;
- `packages/frontend/src/lib/router.ts`;
- new `packages/frontend/src/components/increment-planner/IncrementPlannerPage.tsx`;
- new ticket, zone, edge, tray, inspector, and sprint-band components under that directory;
- new `packages/frontend/src/lib/incrementPlannerPrototype.ts`;
- `packages/frontend/src/styles.css`;
- new focused frontend unit and Playwright tests.

Prototype capabilities:

- peer tab plus useful all-active index;
- filtered epic canvas populated from existing `DomainDataset`;
- create/move/resize in-memory zones;
- drag Jira tickets from a searchable tray into zones;
- render native Jira blockers and create in-memory proposed blockers;
- direct Jira links, pan/zoom, minimap, fit, selection, and ELK auto-layout;
- sprint capacity bands using existing engine inputs;
- desktop and narrow visual review plus keyboard/outline smoke test.

Use a synthetic fixture shaped like the PDF (ten zones, external blocker, buffer, cross-zone edges)
for automated tests. Do not commit Chewy Jira payloads or the source PDF.

**Review gate:** validate interaction vocabulary, zone/card density, edge legibility, sprint-band
model, tab name, and whether the inspector/tray arrangement feels natural before adding schema.

### Slice 1 - Durable map contracts and SQLite persistence

- add shared types and default-empty dataset collections;
- add schema tables, indexes, migration initialization, persistence mapping, repository validation,
  revision handling, and focused map routes;
- register routes in `server.ts` and add typed frontend API calls;
- update snapshot/import, reconcile, obfuscation, and fixture compatibility;
- replace prototype in-memory mutations with optimistic saves and conflict handling.

Primary tests: schema migration, repository invariants, route status codes, revision conflicts,
round-trip persistence, sync preservation, snapshot/import preservation, obfuscated export.

### Slice 2 - Jira graph completeness

- refactor dependency extraction into the portfolio-aware pass;
- add one-hop external issue resolution and bounds;
- render cross-epic/internal and external boundary nodes distinctly;
- add sync warnings and orphan handling;
- extend Dependencies-tab scope where the new data makes its existing cross-epic promise real.

Primary tests: same-epic edge, cross-epic edge, outside-board stub, pagination/chunking, truncation,
missing permissions, stale external issue, deduplication, and cyclic graph.

### Slice 3 - Production editor hardening

- complete CRUD, reconnect/delete rules, multi-selection, undo/redo, autosave, fit/minimap, and
  locked positions;
- add full and per-zone ELK worker layout;
- complete accessible Outline/forms and live announcements;
- add error recovery for save conflicts and backend loss;
- finish visual states against the repository design skill.

Primary tests: pure React Flow adapter tests, keyboard interactions, layout determinism at the
adapter boundary, save debounce, 409 recovery, empty/populated/error/read-only states, and browser
tests with at least 100 nodes.

### Slice 4 - Capacity-integrated scheduling

- add sprint-band projection and selected-vs-portfolio contributions;
- add zone placement preview/apply and individual ticket placement actions;
- derive Unplanned/one-sprint/Split state;
- surface unestimated and dependency-order warnings;
- keep Gantt and Increment Planner consistent after either page changes placements.

Primary tests: no filtered-capacity distortion, atomic batch apply, default unplanned-only behavior,
explicit replace behavior, done-ticket exclusion, unestimated handling, split zones, sync conflicts,
and rollback on one invalid ticket.

### Slice 5 - Deterministic planning assistance

- add rolled-up zone graph and diagnostics in `packages/engine/src/increment-plan.ts`;
- add schedule suggestion preview and selective apply;
- add grouping suggestions with explainable rules only after real-map evaluation;
- record timing/error telemetry locally without sending internal planning data externally.

Primary tests: topological ordering, cycles, external blockers, locked zones, capacity exhaustion,
stable tie-breaking, no silent overcommit, and deterministic repeated output.

### Slice 6 - Optional Jira dependency publishing

Proceed only after an explicit product decision.

- add a narrow create-link backend route around the existing Jira client method;
- preview and confirm one proposed edge at a time or a clearly enumerated batch;
- validate configured link type and both issue keys;
- handle 401/403/404/409 and duplicate links;
- sync and mark the proposal satisfied after success;
- log the external mutation without logging credentials or sensitive payloads.

## 12. Failure, migration, security, and observability

### Failure and concurrency

- Optimistic updates roll back or remain visibly unsaved on failure.
- `expectedRevision` prevents two tabs from silently overwriting layouts.
- Auto-layout and scheduling are cancellable; stale results are ignored if the revision changed.
- Batch placement is transactional.
- A Jira outage leaves the last saved map readable and local edits available when the backend DB is
  available; Jira-dependent refresh/publish actions explain the outage.

### Migration and recovery

- Tables are additive and empty for old databases.
- Optional dataset collections default to `[]` for old fixtures.
- Snapshot before any database-import replacement remains mandatory.
- Map data must be included in import verification and summaries.
- No migration infers zones from labels automatically; users choose whether to create a draft.

### Security and privacy

- Sanitize all free-text zone names, objectives, and notes by rendering them as text, never HTML.
- Validate URL generation against the configured Jira base URL and issue-key format.
- Do not expose Jira credentials through map APIs or diagnostics.
- Bound Jira JQL chunks, external-hop counts, map node counts, text lengths, and coordinate ranges.
- Do not commit the supplied PDF, rendered crops, live Jira payloads, or internal screenshots.
- Jira writes, if later enabled, require explicit user confirmation and existing Jira permissions.

### Observability

Use structured backend logs for map ID/epic key, operation, revision, duration, counts, and outcome.
Do not log zone notes or Jira descriptions. Track locally:

- map load/save latency and conflicts;
- ELK layout duration/node/edge counts and cancellation;
- external dependency fetch count/truncation/failure;
- schedule-preview duration and warning counts;
- Jira dependency publish outcome if that slice is enabled.

## 13. Verification strategy

Before every Node-based command, run `nvm use` from the worktree root.

Automated checks:

```text
nvm use
npm run typecheck
npm test
npm run build
npm --workspace @ecp/frontend run e2e -- increment-planner.spec.ts
git diff --check
```

Add focused coverage in:

- `packages/backend/test/increment-maps.test.ts`;
- `packages/backend/test/jira-importer.test.ts` and `jira-mapper.test.ts`;
- `packages/backend/test/reconcile.test.ts`, `snapshot.test.ts`, and `obfuscate.test.ts`;
- `packages/engine/test/increment-plan.test.ts`;
- `packages/frontend/test/incrementPlanner.test.ts`;
- `packages/frontend/e2e/increment-planner.spec.ts`.

Manual validation after each meaningful slice:

1. Open all-active Increment Planner and verify every active epic has a useful summary.
2. Filter to a populated epic without leaving the tab.
3. Create/rename/resize/delete a zone; verify delete returns tickets to the tray.
4. Move tickets between tray/zones with mouse and keyboard/Outline alternatives.
5. Create, reconnect, and remove a proposed edge; verify Jira edges cannot be edited.
6. Open several Jira links and confirm dragging is not accidentally triggered.
7. Auto-layout the whole map and one zone; undo both.
8. Reload and sync Jira; confirm zones, positions, proposals, and viewport survive.
9. Snapshot/import the DB and confirm the map survives.
10. Move a zone onto a sprint, inspect the preview, apply it, and confirm Gantt matches.
11. Validate capacity while another active epic has work in the same sprint.
12. Inspect desktop and narrow viewports plus keyboard focus, high zoom, cycles, 100+ nodes, long
    titles, unestimated tickets, missing Jira access, and external dependencies.

## 14. Acceptance criteria

The production outcome is accepted when:

- Increment Planner is a peer tab with canonical, shareable page/filter URLs;
- all-active scope is useful and a selected epic opens an editable map without a new navigation
  level;
- a user can recreate the ten-zone structure of the reference diagram, including a buffer zone;
- Jira ticket cards show current key/title/status/points and open the correct Jira issue;
- an epic's unmapped Jira children remain discoverable in a searchable tray;
- native Jira blockers, cross-epic blockers, external boundary stubs, and proposed blockers are
  visibly distinct and directionally correct;
- zones, membership, coordinates, viewport, and proposals survive reload, Jira sync, database
  snapshot, and database import;
- auto-layout handles compound zones and cross-zone edges without blocking the UI;
- cycle, external-blocker, unestimated, orphan, and capacity warnings are explicit;
- sprint bands retain full-portfolio capacity truth while showing selected-map contribution;
- moving a zone produces a reviewable, atomic ticket-placement diff and Gantt reflects accepted
  changes;
- no canvas gesture silently mutates Jira;
- keyboard and Outline workflows cover the meaningful editor operations;
- repository typecheck, unit, build, E2E, and visual checks pass.

## 15. Explicit non-goals for the prototype and initial release

- a general-purpose freehand whiteboard, arbitrary shapes, or rich-text document editor;
- real-time multi-user collaboration;
- automatic parsing of Confluence pages, PDFs, screenshots, or Figma into zones;
- changing Jira parents, issue types, labels, estimates, or sprints directly from arbitrary drags;
- silently publishing proposed blockers to Jira;
- replacing the existing Dependencies or Gantt tabs before the new workflow is proven;
- claiming an exact schedule when work is unestimated or dependencies are cyclic;
- recursive import of an unlimited external dependency graph.

## 16. Review decisions still needed

These do not block the prototype; the plan uses the recommended default in parentheses.

1. **Product label:** `Increment Planner` or `Delivery Map`? (**Increment Planner**, because the main
   authored objects are increments and the existing app already uses planner terminology.)
2. **Jira dependency publishing:** should the first production release publish proposed blockers?
   (**No; local-only first, explicit publishing as Slice 6.**)
3. **Zone scheduling default:** when dropping a zone on a sprint, place only unplanned tickets or
   replace every unfinished ticket placement? (**Only unplanned by default, with an explicit replace
   option in the preview.**)
4. **Source-document automation:** should a later release read the one-pager/Confluence mapping?
   (**Defer until manual maps and deterministic Jira suggestions reveal the stable schema.**)

## 17. Continuation instructions

Current status: research and planning are complete; implementation has not started.

Next action after plan approval: implement **Slice 0 only** in the existing
`codex/task-manager-diagram-plan` worktree, then provide a user-specific manual validation walkthrough
before creating persistence tables.

Start by inspecting:

```text
docs/increment-planner-diagram-plan.md
docs/planner-product-constitution.md
packages/frontend/src/App.tsx
packages/frontend/src/lib/router.ts
packages/frontend/src/components/DependencyGraph.tsx
packages/frontend/src/lib/graph.ts
packages/frontend/src/components/GanttBoard.tsx
packages/frontend/src/lib/gantt.ts
packages/frontend/src/styles.css
```

Then run:

```text
nvm use
npm install @xyflow/react elkjs --workspace @ecp/frontend
```

Do not start Slice 1 until the Slice 0 review gate has resolved the editor layout, sprint-band
interaction, and product label. Before implementing against newer repository state, rebase or merge
the worktree branch onto the then-current clean `main` and re-read the constitution; the user's main
worktree had unrelated uncommitted changes when this plan was created and was intentionally left
untouched.
