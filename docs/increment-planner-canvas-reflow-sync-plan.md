# Increment Planner canvas, reflow, and Jira sync-helper plan

**Status:** Proposed  
**Scope:** Increment Planner usability, deterministic layout, durable editing, and Jira reconciliation  
**Product boundary:** The Increment Planner remains a peer planner page. Epic selection remains a filter, all-active remains useful, and cross-epic dependencies remain visible.

## 1. Outcome

Turn the current Increment Planner prototype into a content-first planning workspace where:

- the diagram uses most of the available viewport and can enter a focused canvas mode;
- moving a ticket or increment records planning intent, then snaps the board back into a predictable structure;
- local edits survive reloads and are not represented by pixel coordinates;
- a sync review explains what Jira changed and how the board was affected;
- a separate Jira to-do list explains which Jira issues should be updated to reflect the local plan, with direct links;
- the user can understand and resolve conflicts without the planner silently overwriting local intent or writing to Jira.

The first release should remain a manual Jira handoff. It should not update Jira automatically.

## 2. Verified current state

- `IncrementPlannerPage.tsx` creates the board from `makeSamplePlanner()` and keeps nodes, edges, and unassigned work only in React state.
- The application shell is capped at `1320px`; the Increment Planner then reserves `220px` for the ticket tray and `240px` for the inspector, leaving a relatively narrow canvas.
- The workspace and both side panels have a fixed `760px` height.
- Ticket nodes use `parentId` plus `extent: 'parent'`, so they cannot currently be dragged from one increment to another.
- `arrangeIncrementsBySprint()` runs ELK separately inside each hard-coded sprint column. It does not use cross-sprint edges to establish the overall structure and does not repack ticket cards.
- Sprint positions, widths, loads, and increment membership are fixture data, not derived from `DomainDataset`.
- Existing Jira reconciliation already separates Jira-owned facts from local intent, preserves manual Gantt placements, logs inbound changes, and reports Jira/local sprint-placement conflicts.
- Existing sync history is optimized for Configuration: it stores human-readable `SyncChange` rows but not enough structured before/after data to compute all board impacts or a durable outbound Jira checklist.

## 3. Product and interaction rules

### 3.1 Content is canonical; geometry is derived

Persist these meanings:

- which increment a ticket belongs to;
- which sprint an increment belongs to;
- the stable order of increments within a sprint;
- the stable order of tickets within an increment;
- increment metadata and proposed dependency changes.

Do not persist free-form `x`, `y`, width, or height as the source of truth. The layout engine derives those values from the semantic plan. This makes sync, resize, reload, and reflow deterministic.

### 3.2 Drops are commands, not coordinates

Interpret drag completion as one of a small set of commands:

- move ticket to increment;
- move ticket to the unassigned tray;
- move increment to sprint;
- reorder ticket within increment;
- reorder increment within sprint.

Show a drop target and insertion marker while dragging. On drop, apply the command, recompute totals and capacity, and reflow the affected area. The exact pointer coordinate is discarded.

### 3.3 Jira facts and planner intent stay distinct

Jira remains authoritative for ticket identity, title, status, estimate, assignee, Jira sprint assignment, and imported blockers. The planner owns proposed increment membership, local order, locally proposed sprint placement, and proposed blocker edits.

An outbound to-do is a recommendation to make Jira match planner intent. It is not evidence that Jira has already changed.

## 4. Proposed workspace layout

### 4.1 Page-specific wide mode

Add a page modifier to the application shell when `tab === 'increments'` and remove the global `1320px` cap for this page only. Preserve the same top-level header, tabs, epic filter, and sync control.

Use a compact workspace bar below the tabs for:

- board title and Jira epic link;
- sync status / unresolved-change count;
- Undo and Redo;
- Reflow;
- Focus canvas;
- Add increment.

Move explanatory copy and the legend behind compact help/legend disclosure instead of permanently spending vertical space.

### 4.2 Canvas-first panel behavior

- Give the workspace a viewport-relative height such as `calc(100dvh - measured shell chrome)` with a sensible minimum.
- Make the canvas the flexible center region.
- Make the ticket tray and inspector independently collapsible; remember those UI preferences locally.
- On medium widths, turn the inspector into an overlay drawer rather than a full-width row under the canvas.
- Add Focus canvas mode using a fixed, viewport-filling workspace surface with a clear Exit action and Escape support.
- Keep React Flow controls visible and add “Fit plan” plus “Fit selection” actions. Do not auto-fit after every edit because that makes the viewport jump.
- Retain the minimap on wide displays; collapse or hide it when it obscures useful canvas area.

### 4.3 Accessibility and responsive behavior

- Expose non-drag alternatives in the ticket and increment inspectors: “Move to increment,” “Move to sprint,” and order controls.
- Announce the semantic result after a move, for example, “NF-2817 moved to Increment 4; 3 tickets reflowed.”
- Return focus to the moved item after reflow.
- Preserve visible keyboard focus, Escape behavior for overlays, and no horizontal document overflow at narrow widths.

## 5. Semantic board model and persistence

Introduce a board projection rather than persisting React Flow nodes directly. Suggested records:

- `increment_plan`: board id, epic/scope identity, revision, created/updated timestamps;
- `plan_increment`: id, plan id, number, title, objective, kind, sprint id, sort rank;
- `plan_increment_item`: increment id, work-item key, sort rank;
- `plan_dependency_override`: source/target identity, operation (`add` or `remove`), sort-independent metadata;
- `plan_edit_session` or a lightweight revision ledger for the sync baseline and undoable commands.

Use stable IDs and optimistic revision checks. Add repository and API operations around semantic commands rather than a generic “save these nodes” endpoint. A useful first contract is:

- `GET /api/increment-plans?epics=...`;
- `PUT /api/increment-plans/:planId/increments/:incrementId/items/:workItemKey`;
- `DELETE /api/increment-plans/:planId/increments/:incrementId/items/:workItemKey`;
- `PUT /api/increment-plans/:planId/increments/:incrementId/sprint`;
- `PUT /api/increment-plans/:planId/order`;
- endpoints for increment metadata and dependency overrides.

The frontend converts the returned board projection into React Flow nodes and edges. Keep the fixture adapter temporarily so the UI can be developed before the live migration, but do not add sync behavior directly to the fixture.

## 6. Deterministic reflow engine

Move layout work into pure functions in a dedicated module, leaving React Flow as rendering and interaction infrastructure.

### 6.1 Structural layout

1. Order sprint bands chronologically from `DomainDataset.sprints`, with an explicit local buffer/UAT lane only when the plan contains one.
2. Assign increments to their semantic sprint lanes.
3. Within each sprint, derive dependency layers using all increment dependencies, including cross-sprint edges as ordering constraints.
4. Use ELK to place increments within those constraints, with fixed spacing tokens and deterministic tie-breakers (`sortRank`, increment number, stable id).
5. Route blocker edges after nodes settle, favoring lane gutters so labels and lines do not run through ticket cards.

If an edge contradicts sprint order, retain the plan but flag it as a scheduling conflict rather than allowing the layout engine to hide it.

### 6.2 Container and ticket layout

- Derive an increment's ticket-column count from available lane width and configured card minimum width.
- Pack tickets into a stable grid using their semantic order.
- Derive the increment height from header, objective, row count, and padding.
- Recompute increment points and ticket count from membership instead of incrementing cached totals in UI callbacks.
- Reflow both the source and destination increments after a ticket move, then reflow their sprint lanes.
- Reflow the source and destination sprint lanes after an increment move.
- Keep unaffected ticket order and unaffected sprint lanes stable.

### 6.3 Reflow triggers and viewport policy

Run targeted reflow after:

- ticket add, move, remove, or reorder;
- increment add, move, resize-policy change, or metadata change that affects measured size;
- blocker add, remove, or reconnect;
- Jira sync that adds/removes tickets, changes sprint facts, or changes dependencies;
- viewport or panel-width changes, debounced.

Keep a manual Reflow action for recovery and experimentation. Preserve the user's pan and zoom for targeted reflows; only Fit plan on initial load, explicit request, or when the previously focused selection no longer exists.

### 6.4 Drag transaction

On drag start, capture the semantic source and current revision. During drag, calculate candidate containers from measured bounds. On drag stop:

1. resolve the best valid target and insertion index;
2. reject invalid/cyclic moves with a visible reason;
3. optimistically apply one semantic command;
4. run targeted reflow;
5. persist the command with the expected revision;
6. roll back and explain if persistence fails.

Store the inverse command so Undo/Redo operates on semantic changes and remains reliable after layout changes.

## 7. Jira sync helper

Present one Sync review drawer from the Increment Planner workspace with two explicit tabs.

### 7.1 “Changed in Jira” tab

After a sync, show inbound changes grouped by board impact rather than only raw field category:

- Added to board / removed from board;
- Ticket facts changed;
- Sprint assignment changed;
- Dependency changed;
- Plan adjusted automatically;
- Conflict requiring a decision;
- No visible board impact.

Each row should include the Jira issue link, before and after values, the resulting planner action, and whether local intent was preserved. Examples:

- “NF-2817 moved to Sprint 70 in Jira. Kept your local Sprint 69 plan; Jira to-do created.”
- “NF-2774 is Done in Jira. Removed it from future capacity and reflowed Increment 1.”
- “NF-2940 left the active board scope. Removed from the canvas; local history retained.”

Add structured fields to `SyncChange` (entity kind/key, field, before, after, impact, resolution) while retaining a derived human-readable detail for older log entries. Record the plan revision before and after reconciliation.

### 7.2 “Update Jira” tab

Compute the current checklist by diffing the latest Jira fact snapshot against current planner intent. Do not build it solely by replaying UI events; a derived diff automatically removes obsolete or already-completed tasks.

Initial supported to-do types:

- move ticket to sprint;
- clear ticket sprint;
- add blocker link;
- remove blocker link;
- update a mapped increment field when the Jira setup explicitly maps one.

Every to-do includes:

- a checkbox for the user's working state;
- Jira issue link and concise instruction;
- current Jira value and desired planner value;
- source (“local move,” “proposed blocker,” or “conflict kept local”);
- copyable value/instruction;
- “Recheck Jira” action.

Checkbox state is local workflow state, not confirmation that Jira changed. On the next sync, automatically mark an item verified when Jira matches, reopen it when Jira still differs, and retire it when the local plan no longer requests the change.

If an intent has no configured Jira representation, label it “Planner only” and explain which field mapping would be needed; do not create an impossible Jira task.

### 7.3 Sync baseline and conflict policy

- Capture a board baseline at the last successful Jira sync: source fact fingerprints plus plan revision.
- Continue using the existing rule that Jira facts refresh while local human intent is preserved.
- Classify concurrent changes as conflicts when Jira and the local plan changed the same semantic field since the baseline.
- Never silently choose Jira or local intent for a conflict. Keep the safe local plan visible, show both values, and offer “Use Jira” or “Keep plan / add Jira to-do.”
- A normal Sync remains a read from Jira. Any future direct Jira write-back must be a separate, explicitly reviewed initiative.

### 7.4 Backend/API additions

Extend the existing sync coordinator rather than creating a second sync path:

- return and persist structured changes plus affected plan ids/revisions;
- reconcile increment membership, sprint intent, and dependency overrides after Jira facts are stored;
- generate a deterministic `JiraHandoffItem[]` projection from latest facts and local intent;
- expose `GET /api/increment-plans/:planId/sync-review`;
- expose local checklist-state updates separately from planner intent;
- optionally accept `POST /api/increment-plans/:planId/recheck` as a normal sync plus refreshed review response.

Use the configured Jira base URL for links and the existing `JiraLink` components in the UI.

## 8. Delivery slices

### Slice 1 — Canvas space and focus mode

- Add the Increment Planner page modifier, viewport-relative workspace, collapsible panels, compact workspace bar, and Focus canvas mode.
- Preserve the existing fixture and interactions.
- Add desktop, medium, narrow, and focus-mode visual coverage.

**Exit:** At a 1440px desktop viewport, the canvas receives most of the width and usable vertical space; either side panel can be hidden without losing its state; Focus canvas fills the viewport and exits by button or Escape.

### Slice 2 — Pure semantic reflow on the fixture

- Extract fixture semantics from React Flow geometry.
- Implement ticket packing, derived container sizes, dependency-aware increment layout, and targeted reflow.
- Add semantic drag/drop between increments and sprints plus Undo/Redo.
- Keep changes browser-local for this slice.

**Exit:** Moving a ticket between increments or an increment between sprints snaps it into a deterministic position, updates counts/capacity, leaves no overlap, and preserves unrelated order.

### Slice 3 — Durable Increment Planner model

- Add schema, repository functions, APIs, dataset-to-plan adapter, revision checks, and migrations.
- Replace the production fixture with selected/all-active scope data while retaining cross-epic context.
- Persist semantic commands and reload them into the same derived layout.

**Exit:** A plan survives reload and backend restart with equivalent content and ordering, independent of viewport size or prior pixel positions.

### Slice 4 — Inbound Jira impact review

- Enrich `SyncChange`, add plan-impact reconciliation, persist plan revisions in sync history, and build the “Changed in Jira” drawer.
- Reflow affected content after sync without resetting pan/zoom unnecessarily.

**Exit:** A controlled Jira fixture change produces a linked, before/after explanation and the board visibly reflects the documented result.

### Slice 5 — Outbound Jira to-do list

- Build the fact-versus-intent diff, supported Jira handoff types, checklist state, recheck behavior, and “Planner only” explanations.
- Add conflict resolution actions without Jira writes.

**Exit:** After local edits, the drawer lists the exact Jira updates needed with links; after those fixture changes are made in Jira and synced, matching items verify and leave the open list.

### Slice 6 — Hardening and polish

- Add cycle/conflict diagnostics, empty/error/loading states, keyboard move controls, performance instrumentation, and large-board tests.
- Validate all-active and filtered scopes against the product constitution.

**Exit:** The planner remains responsive and understandable with representative portfolio data, sync failures do not lose local work, and all constitutional checks pass.

## 9. Validation strategy

### Unit tests

- Layout output is deterministic for identical semantic input.
- Ticket moves repack source and destination without overlap.
- Container height and sprint load derive correctly from membership.
- Cross-sprint dependencies influence ordering and cycles become diagnostics.
- Fact-versus-intent diff creates, updates, verifies, and retires Jira handoff items.
- Old human-readable sync-log records remain readable after the structured schema addition.

### Backend integration tests

- Semantic commands persist with optimistic revision protection.
- Sync preserves local intent, records plan impact, and produces correct conflicts.
- Removed/Done/moved Jira items update the plan according to policy.
- Handoff items are derived idempotently and cannot claim verification without matching Jira facts.
- A failed or timed-out sync leaves the plan and its baseline unchanged.

### Playwright tests

- Collapse panels, enter/exit Focus canvas, and fit the plan.
- Drag a ticket across increments and verify snap/reflow/count updates.
- Move an increment across sprints and verify capacity and edge layout.
- Complete the same moves without drag using inspector controls.
- Sync controlled fixture changes and inspect inbound impacts.
- Create a local mismatch, follow its Jira link, recheck, and verify the to-do lifecycle.
- Check desktop, medium, and narrow layouts for document overflow and obscured controls.

### Manual visual QA

- Inspect populated, empty, syncing, sync-error, conflict, and no-open-to-do states.
- Verify canvas/panel joins, quiet borders, compact controls, and existing dark tokens.
- Test high node counts and long ticket titles at common desktop zoom levels.

Before all Node-based validation commands, run `nvm use` from the repository root.

## 10. Likely implementation areas

- `packages/frontend/src/App.tsx` — page-specific shell modifier and sync/reload wiring;
- `packages/frontend/src/components/IncrementPlannerPage.tsx` — workspace composition and semantic command handlers;
- `packages/frontend/src/lib/incrementPlannerPrototype.ts` — split fixture data from the reusable layout engine;
- new frontend board projection, command, and sync-review modules;
- `packages/frontend/src/styles.css` — wide/focus workspace, drawers, reflow feedback, and sync-review styles;
- `packages/frontend/src/data/api.ts` — increment-plan and sync-review contracts;
- `packages/shared/src/domain.ts` and `packages/shared/src/jira.ts` — plan, structured sync impact, and Jira handoff types;
- backend schema, repository, planning routes, `db/reconcile.ts`, and `sync/sync-service.ts`;
- existing Increment Planner, reconcile, sync, and Playwright test suites.

## 11. Recommended decisions

1. Treat increment membership and order as local planning intent unless a Jira field is explicitly mapped.
2. Treat sprint placement and blocker links as the first outbound Jira handoff types because the repository already imports both.
3. Keep write-back manual in this initiative; make the helper trustworthy before adding mutation permissions.
4. Use automatic targeted reflow after semantic edits, with manual Reflow as a recovery/control action.
5. Preserve pan/zoom during routine reflow and never auto-fit on every drop.
6. Deliver canvas sizing first, then semantic reflow, then persistence, then sync review. Sync UX built on the current fixture would be disposable work.

