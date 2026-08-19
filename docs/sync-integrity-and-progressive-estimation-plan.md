# Sync Integrity, Progressive Epic Estimation, and Custom Relevant Days — Durable Implementation Plan

**Status:** Implementing — core sync integrity, progressive estimation, and relevant-day work landed 2026-08-16; release-hardening follow-up remains

**Created:** 2026-08-16

**Scope:** Jira-to-planner synchronization, reconciliation and persistence boundaries, progressive
epic workload estimation, shared-capacity forecasting, post-sync estimate review, relevant-day
creation, observability, migration, and verification

**Constraints:** plan only; no Spec Kit/SDD; preserve the flat planner, filter-not-drill-down
behavior, shared-capacity truth, and future-multi-epic contracts in
[`planner-product-constitution.md`](./planner-product-constitution.md)

**Related plans and docs:**
[`jira-first-sync.md`](./jira-first-sync.md),
[`portfolio-capacity-planner-plan.md`](./portfolio-capacity-planner-plan.md),
[`board-epic-configuration-plan.md`](./board-epic-configuration-plan.md), and
[`unified-epic-management-plan.md`](./unified-epic-management-plan.md)

## 1. Intended outcome

The planner must answer a central delivery question throughout an epic's lifecycle:

> Given the launch date and the team's one shared capacity pool, can the active portfolio finish
> the work that is currently known **plus** the work we reasonably believe remains unrefined?

Deliver that outcome through three coordinated workstreams:

1. **One authoritative sync pipeline.** A full Jira refresh has one orchestration boundary, one
   reconciliation policy, one atomic database commit, and one typed outcome. Read-only Jira
   discovery and targeted Standup refreshes remain distinct workflows and cannot accidentally
   replace planner facts.
2. **Progressive estimation.** Each epic can carry a user-owned **unrefined work remaining** point
   estimate alongside Jira-owned pointed tickets. Forecasts use the explicit sum and show the
   breakdown. When synchronization introduces newly created, newly pointed, increased, or reopened
   work, the estimate becomes review-needed rather than being silently adjusted.
3. **Custom relevant days.** A user can create a relevant day with any non-empty name, such as
   **Bug Bash**, while retaining convenient launch/UAT suggestions and the existing single-gating-day
   rules.

The final system should make synchronization safer to change, expose uncertainty instead of
turning it into zero work, and keep the capacity model useful before BRD/technical refinement is
complete.

## 2. Product decisions and vocabulary

### 2.1 Use an additive remaining-work estimate, not a competing total

Store one local value per epic named **unrefined work remaining**. It means:

> The estimated points of remaining work not already represented by pointed, not-Done Jira work.

This value may cover unpointed Jira tickets and work for which tickets do not exist yet. It is not
the epic's original estimate and is not an estimate of the entire epic.

Use these terms everywhere in code, API responses, tests, and UI copy:

| Term | Owner | Definition |
| --- | --- | --- |
| Jira-estimated remaining | Jira fact | Sum of points on not-Done Jira work that has an estimate |
| Unestimated Jira items | Jira fact | Count of not-Done Jira work with no point value |
| Unrefined work remaining | Local intent | User-entered points for work not represented by the first bucket |
| Modeled remaining | Derived | Jira-estimated remaining + unrefined work remaining |

The invariant is:

```text
modeledRemainingPoints = jiraEstimatedRemainingPoints + unrefinedRemainingPoints
```

Do not store `modeledRemainingPoints`; derive it through one workload resolver. Do not call the
local field merely `estimate` or `total estimate`, because either name invites double-counting.

Example progression:

| Stage | Jira-estimated | Unrefined | Modeled | Meaning |
| --- | ---: | ---: | ---: | --- |
| Early BRD | 0 | 50 | 50 | The epic is understood only at a rough level |
| Partially refined | 25 | 25 | 50 | Half is represented by pointed tickets; half remains a black box |
| Sync adds 8 pointed points before review | 33 | 25 | 58 | The planner conservatively shows 58 and asks for review |
| User revises the unrefined amount | 33 | 17 | 50 | The user confirms that 17 points remain outside pointed Jira work |

### 2.2 Absence and zero are different

- No epic-estimate row means the user has not supplied or acknowledged an unrefined-work estimate.
- A persisted value of `0` means the user explicitly believes there is no additional unrefined
  work at the time of review.
- Do not backfill zero rows for existing epics. That would turn “unknown” into “none.”
- Validate the value as finite and non-negative. Fractional points remain allowed because the
  existing domain uses `REAL`/`number`.

### 2.3 Forecast completeness and health

- A timeline epic with pointed tickets and no unestimated tickets can be forecast without an
  unrefined estimate; Jira may already represent all known work.
- A timeline epic with unestimated Jira items requires an unrefined estimate acknowledgment before
  its forecast can be considered complete. Once acknowledged, those items are assumed to be
  represented by the unrefined bucket until they receive points.
- A tracked, non-Done timeline epic with no remaining Jira work and no estimate row is **needs
  estimates**, not automatically zero-work/green. A saved `0` is the explicit way to confirm that
  no work remains outside Jira.
- A stale estimate remains in the capacity math so the planner does not make work disappear. Its
  forecast is labeled **estimate review needed** or **provisional**, with the ordinary delivery
  color retained as a separate attribute. Review state must not be collapsed into green/yellow/red.
- Done Jira work never contributes to either Jira-estimated remaining or the review basis.
- For an Ongoing epic, unrefined points contribute to its outstanding/unplanned total but do not
  receive an invented launch date or automatic dated reservation. They remain visible as unplanned
  work until a future explicit reservation mechanism exists.

### 2.4 Review only when Jira facts can invalidate the soft/hard split

When an epic has an estimate row, compare its last acknowledged Jira fact basis with the current
remaining Jira facts. Require review for:

- a new remaining Jira item, whether pointed or unpointed;
- an unpointed item receiving points;
- an existing remaining item's points increasing;
- previously absent/completed work reopening into the remaining set.

A point decrease, completion, or removal does not by itself require review. Those changes reduce
the modeled remainder and do not create the specific double-counting risk this workflow is meant
to catch. The user can still edit the estimate at any time.

Never automatically decrement unrefined points when Jira points appear. Refinement is not always a
one-for-one conversion, and automatic subtraction would encode confidence the tool does not have.

The review interaction offers:

- **Keep current amount** — acknowledge current Jira facts without changing the number;
- a numeric field plus **Update estimate** — save a revised amount and acknowledge the facts;
- **Review later** — close the prompt while leaving a persistent review-needed indicator.

Acknowledgment must be optimistic-concurrency-safe. The client submits the current Jira fact
signature; if another sync changed the epic after the prompt opened, return `409` and reload the
review instead of accepting a stale acknowledgment.

### 2.5 The review prompt is non-blocking and portfolio-aware

After a successful sync, show one compact review dialog/surface containing all affected tracked
epics, not a chain of one modal per epic. A user can review one, several, or none. Synchronization
is already committed before this surface appears.

The same review-needed state must be visible after reload from Overview and the epic's Configuration
editor. Dismissing the immediate prompt cannot erase it. The dialog does not navigate or mutate the
route-backed epic filter. With a filter active, it may emphasize the selected epic but must still
report that other active epics need review.

### 2.6 Custom relevant days use free text with suggestions

In the active epic editor, replace the creation-only two-value `select` with a compact native text
input. Offer **Production Launch**, **UAT Testing Start**, and **Bug Bash** through a `datalist` or
small suggestion mechanism, but accept any trimmed non-empty string.

Keep the current behavior:

- the first relevant day for an epic becomes gating by default;
- promoting another day atomically demotes the old gate;
- the current gate cannot be deleted or directly demoted;
- existing names and dates remain editable;
- relevant days remain local intent and survive synchronization;
- Ongoing epics preserve but suppress their relevant-day controls.

Do not add a rigid `milestoneType` enum. The requested value is deliberately custom, and the
existing backend/domain already model the name as free text.

### 2.7 Assumptions, dependencies, and implementation-tunable choices

Assumptions:

- BRD/technical-review rough estimates use the same point scale as Jira story points. This plan
  does not convert person-days, T-shirt sizes, or confidence ranges into points.
- The deployed planner remains a local, single-process application with SQLite. Process-level
  coalescing plus database transactions are sufficient for this deployment model.
- The configured board/single-epic scope is the authoritative Jira fact boundary. Work outside that
  scope is not silently inferred into an epic.
- Review is intended to catch scope expansion and work moving from soft to hard data; it is not a
  general approval ceremony for every status or estimate decrease.

Dependencies:

- The existing Jira field mapping must continue to distinguish absent estimates through
  `isEstimated`; review correctness cannot be based on numeric zero alone.
- Epic keys and work-item keys remain stable Jira identities.
- The portfolio engine continues to allocate one shared team capacity pool and to honor
  Timeline/Ongoing distinctions.
- SQLite snapshot/import remains the durable sharing mechanism for local intent.

There is no unresolved product blocker in this plan. Two values remain deliberately tunable during
implementation and must be recorded here when chosen:

- the default full-sync timeout (start by testing 120 seconds against the largest expected board,
  then configure it through the existing backend config pattern);
- the bounded raw-cache schema/version for a complete multi-epic snapshot.

Changing the additive meaning of unrefined points, the review triggers, or the Ongoing behavior is
a product-contract change, not an implementation tuning decision.

## 3. Verified current behavior and evidence

These are verified facts from the 2026-08-16 working tree, not assumptions.

### 3.1 What is already centralized

- The only production HTTP planner-fact sync endpoint is `POST /api/sync` in
  [`packages/backend/src/routes/sync.ts`](../packages/backend/src/routes/sync.ts).
- The only production frontend caller is `SyncButton` through `syncNow()` in
  [`packages/frontend/src/components/SyncButton.tsx`](../packages/frontend/src/components/SyncButton.tsx)
  and [`packages/frontend/src/data/api.ts`](../packages/frontend/src/data/api.ts).
- Jira transport calls use the `JiraClient` interface; the real and fake clients share that seam.
- Raw Jira issues are mapped into the domain in
  [`packages/backend/src/jira/mapper.ts`](../packages/backend/src/jira/mapper.ts).
- Jira facts and local intent are merged in the pure-looking `reconcileDataset()` seam in
  [`packages/backend/src/db/reconcile.ts`](../packages/backend/src/db/reconcile.ts).
- Reconciliation already preserves milestones, portfolio intent, SME order, team configuration,
  availability, member capacity settings, and human Gantt placements while refreshing Jira facts.
- Read-only setup/discovery endpoints in
  [`packages/backend/src/routes/jira.ts`](../packages/backend/src/routes/jira.ts) and targeted
  Standup ticket refreshes do not call `writeDataset()` or `reconcileDataset()`; they are not
  alternate planner sync implementations.

Conclusion: sync policy is not scattered across many independent reconcilers. The core seam is
good. The end-to-end lifecycle around that seam still has correctness gaps and duplicated
derived-workload logic.

### 3.2 Verified sync lifecycle gaps

1. **Manual sync can consume cached Jira reads.** `server.ts` wraps the Jira client in
   `CachedJiraClient` with a default five-minute TTL and passes that same client into the sync
   route. `JiraImporter` calls cacheable `listBoardIssues`, `listSprints`, `searchJql`, and
   `getIssue` methods. Clicking Sync can therefore report success while reusing pre-sync discovery
   data rather than forcing a fresh Jira read.
2. **Local edits can be lost during a long fetch.** `routes/sync.ts` reads `current` before awaiting
   `importer.fetch()`, then reconciles against that stale snapshot. A milestone, estimate, velocity,
   placement, or other local mutation committed during the Jira fetch is absent from `merged` and
   can be overwritten by the dataset replacement.
3. **A successful sync is not one atomic commit.** `writeDataset()`, `recordSyncTime()`, and
   `appendSyncLog()` run as separate database operations. Dataset replacement is transactional by
   itself, but a later timestamp/log failure can leave refreshed facts without matching freshness
   or history.
4. **Concurrent sync requests are not coalesced or rejected.** Two tabs can perform duplicate Jira
   reads and commits with no process-level in-flight coordination.
5. **Startup import bypasses reconciliation and sync history.** `server.ts` calls
   `createImporter(config, [], jiraClient)` and `writeDataset()` directly when the epic table is
   empty. This is a second planner-fact import path and ignores persisted mapping settings at the
   point it builds the importer.
6. **The “no active epics” case fails instead of reconciling an empty active scope.** `JiraImporter`
   throws when it produces no active datasets. If the last active epic finishes or leaves the board,
   sync cannot commit the empty active result, archive the epic, or remove its capacity load.
7. **Importer completeness is implicit.** Reconcile treats absence from `incoming` as leaving the
   active scope, but the importer contract carries no explicit board/scope identity or “complete
   snapshot” marker. That makes future partial-import optimizations dangerous.
8. **Lifecycle facts are lossy around archived/completed roots.** The active-board importer filters
   completed/no-remaining roots before mapping. Reconcile may retain old archived item facts rather
   than the final Jira statuses that caused the root to leave active capacity.
9. **The raw sync cache is written during per-epic fetching.** Multi-epic fetches overwrite the
   singular cache payload per epic, and a later failure can leave a partial `jira-last-sync.json`
   even though planner state was not committed.
10. **The reconcile function owns an undeclared clock.** Its comment says it is pure/no-clock, but
    it calls `new Date()` for archive/reactivation metadata. Tests cannot fully control the result.

### 3.3 Verified workload-calculation gaps

- [`packages/engine/src/project.ts`](../packages/engine/src/project.ts) and
  [`packages/engine/src/portfolio.ts`](../packages/engine/src/portfolio.ts) independently sum
  remaining ticket points and evaluate unestimated work.
- Portfolio presentation and setup preview carry additional `remainingPoints` calculations and
  labels. The same term currently means Jira ticket points only.
- There is no epic-level local estimate model, storage table, mutation endpoint, review basis, or
  hard/soft breakdown.
- A new active epic with no child work can appear to have zero remaining work unless another
  completeness condition intervenes.
- The portfolio scheduler allocates timeline work as item jobs. It needs a first-class aggregate
  job for unrefined points; creating a fake Jira work item would corrupt source ownership and
  Gantt/dependency semantics.

### 3.4 Verified relevant-day gap

- `EpicMilestone.name` and the SQLite `epic_milestone.name` column are already free text.
- Repository validation accepts any non-empty milestone name.
- Existing relevant-day rows in `EpicManagementSection.tsx` already permit name and date edits.
- The currently rendered creation control in `RelevantDaysEditor` restricts new names to
  **Production Launch** or **UAT Testing Start** with a `select`.
- `Configuration.tsx` still contains an older exported `MilestonesSection` with a free-text add
  input, but the active Configuration flow renders `EpicManagementSection`; changing the dead/old
  surface alone would not deliver the feature.

## 4. Target architecture and contracts

### 4.1 Authoritative synchronization flow

```text
HTTP / startup trigger
        |
        v
SyncCoordinator (single in-flight run, timeout, typed errors)
        |
        +--> fresh Jira import --> complete SyncSnapshot
        |
        +--> re-read latest local dataset after fetch
        |
        +--> verify mapping/scope fingerprint did not change
        |
        v
reconcileDataset(latestLocal, snapshot, syncedAt)
        |
        +--> resolve estimate-review deltas
        |
        v
one SQLite transaction
  replace dataset rows + last_synced_at + sync log
        |
        +--> best-effort complete raw-cache write (temp + rename)
        v
typed SyncOutcome --> reload --> optional review dialog
```

Introduce a backend application service, for example
`packages/backend/src/sync/sync-service.ts`. Routes and startup wiring may trigger it; neither may
reimplement fetch/reconcile/commit behavior.

The coordinator owns:

- a single in-flight promise so concurrent callers coalesce onto one network operation and one log
  entry;
- a configurable, cancellable full-sync timeout;
- a fresh-read cache policy;
- clock injection;
- source/mapping fingerprint capture;
- the post-fetch re-read of local intent;
- reconciliation and estimate-review derivation;
- the atomic commit;
- privacy-safe operational logging;
- conversion of known errors to typed HTTP results.

### 4.2 Explicit import completeness

Replace the bare `Importer.fetch(): DomainDataset` result for planner sync with an explicit snapshot
contract. A representative shape is:

```ts
interface SyncSnapshot {
  dataset: DomainDataset;
  source: 'jira' | 'synthetic';
  scope: {
    kind: 'complete-board' | 'complete-single-epic' | 'complete-dataset';
    projectKey: string | null;
    boardId: string | null;
    observedEpicKeys: string[];
    activeEpicKeys: string[];
    complete: true;
  };
  rawCache?: JiraSyncCacheVNext;
}
```

Rules:

- A failed page/request produces no `SyncSnapshot` and no database commit.
- Only a `complete: true` snapshot may archive facts because of absence.
- A valid complete snapshot may contain zero active epics. That is a successful sync, not a mapping
  error.
- Include enough final facts for completed/archived roots to record final ticket statuses and pull
  obsolete placements before removing them from active capacity.
- Keep source lifecycle (`activeEpicKeys`) separate from local tracking intent
  (`PortfolioEpic.scopeOverride`/`planningKind`).
- Synthetic/demo bootstrap can construct the same contract; read-only discovery does not.

### 4.3 Fresh-read policy

A user-initiated full sync must not reuse TTL-cached board issues, sprints, issue details, or JQL
pages. Implement one explicit policy rather than relying on call order:

- preferred: retain a raw Jira client for full sync and a cached decorator for read-only discovery;
- acceptable if kept explicit and tested: add a `fresh` request policy that bypasses cache entries
  while still coalescing identical in-flight calls.

Clearing the entire cache as an undocumented side effect in the route is a temporary migration
step, not the desired final contract. After successful sync, discovery caches may be invalidated so
the setup UI does not show an older view than the committed dataset.

### 4.4 Atomic persistence and latest-intent preservation

Refactor `persist.ts` so the row replacement body can participate in a caller-owned transaction:

- `replaceDatasetRows(db, dataset)` performs the deletes/inserts without starting its own
  transaction;
- existing `writeDataset()` wraps that primitive for seeding/import tooling;
- `commitSync()` wraps dataset replacement, the exact `last_synced_at` value, and sync-log append in
  one outer transaction.

Fetch Jira without holding a SQLite transaction. After fetch:

1. re-read the current dataset;
2. compare its Jira mapping/scope fingerprint with the one used for the fetch;
3. return `409`/retry guidance if mapping or board scope changed;
4. otherwise reconcile against this latest dataset, preserving local mutations committed while
   Jira was in flight;
5. commit once.

Inject `syncedAt` into reconciliation. No domain merge function should call the clock directly.

### 4.5 Epic estimate storage contract

Add a local-intent entity to `@ecp/shared` and `DomainDataset`:

```ts
export interface EpicEstimate {
  epicKey: string;
  unrefinedPoints: number;
  /** Canonical JSON-compatible map of remaining Jira item key -> points, null when unestimated. */
  reviewedFactBasis: Record<string, number | null>;
  reviewedAt: string;
  updatedAt: string;
}
```

Add an optional `epicEstimates?: EpicEstimate[]` collection for backward-compatible JSON fixtures,
then normalize absence to an empty collection at repository/engine boundaries.

Add a table:

```sql
CREATE TABLE epic_estimate (
  epic_key                  TEXT PRIMARY KEY REFERENCES epic(key) ON DELETE CASCADE,
  unrefined_points          REAL NOT NULL CHECK(unrefined_points >= 0),
  reviewed_fact_basis_json TEXT NOT NULL,
  reviewed_at               TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
```

The basis contains only not-Done Jira work at acknowledgment time. Derive review-needed state by
comparing it with current facts; do not persist a second boolean that can drift. Canonicalize key
order before hashing/signing.

The row is local intent and must survive sync, exclusion, Timeline/Ongoing switches, archive, and
reactivation as long as the epic is retained. It participates in SQLite snapshot/export/import and
is filtered only for referential safety.

### 4.6 One workload resolver

Add a pure resolver in the engine, for example
`packages/engine/src/workload.ts`:

```ts
interface EpicWorkload {
  epicKey: string;
  jiraEstimatedRemainingPoints: number;
  unrefinedRemainingPoints: number;
  modeledRemainingPoints: number;
  unestimatedJiraItems: number;
  hasUnrefinedEstimate: boolean;
  estimateReviewRequired: boolean;
  estimateReviewChanges: EstimateReviewChange[];
  factSignature: string;
}
```

Use it from:

- `projectEpicFromDataset()` and scenario projection;
- `projectPortfolioFromDataset()`;
- Overview/Timeline read models and epic picker metrics;
- Configuration estimate summaries;
- sync response review derivation;
- backend portfolio routes where breakdowns are returned.

The Jira setup preview operates on live Jira candidates before they are in `DomainDataset`; it may
retain a focused preview calculation, but it must use the same estimated/unestimated definitions
and must not include local unrefined points for an unsynced candidate.

Treat the old ambiguous `remainingPoints` projection field as a compatibility alias for
`modeledRemainingPoints` during migration, then update call sites and UI labels to use explicit
names. Do not leave some screens showing Jira-only points under the same label used for modeled
points elsewhere.

### 4.7 Projection changes

Extend the single-epic projection input with an explicit aggregate additional-work field rather
than synthesizing a `WorkItem`:

```ts
interface ProjectionInput {
  // existing fields...
  unrefinedRemainingPoints?: number;
  unestimatedWorkCovered?: boolean;
}
```

For timeline portfolio projection, create an internal aggregate forecast job per epic when
`unrefinedRemainingPoints > 0`. It shares the epic's target and priority and contributes to the
same weekly load/capacity buckets. It has no Jira key, placement, dependency, assignee, or Gantt
card.

Expose breakdowns in `ProjectionResult` and `PortfolioEpicProjection`. Completion/buffer/health use
modeled remaining work. Filtered pages still use the full active portfolio schedule; filtering can
only change presentation.

### 4.8 Estimate mutation and review API

Add focused endpoints rather than treating the value as an untyped setting:

```text
PUT    /api/epics/:key/estimate
DELETE /api/epics/:key/estimate
```

Representative request:

```ts
{
  unrefinedPoints: 25,
  expectedFactSignature: "..."
}
```

`PUT` creates/updates the value, captures the current canonical fact basis, and clears review-needed
state by construction. Sending the same value implements **Keep current amount**. Reject a stale
signature with `409`. Validate epic existence, finite/non-negative input, and an object-shaped
basis. Return the saved row plus the freshly resolved `EpicWorkload`.

`DELETE` removes the local estimate and returns the epic to unknown/no-acknowledgment semantics. It
must be an explicit action with confirmation in the UI; setting zero does not delete.

### 4.9 Sync outcome contract

Replace the frontend's `Record<string, number>` summary with a shared typed response. Include:

```ts
interface SyncOutcome {
  runId: string;
  source: string;
  syncedAt: string;
  coalesced: boolean;
  summary: ReconcileSummary;
  changes: SyncChange[];
  estimateReviews: Array<{
    epicKey: string;
    workload: EpicWorkload;
  }>;
}
```

Extend fact diffing so a transition from unestimated to estimated is visible even when legacy
numeric points were both zero. Associate work-item changes with their epic internally so review
derivation and log summaries do not reimplement hierarchy lookup.

## 5. User experience

### 5.1 Epic estimation editor

Add a compact **Work estimate** group to the existing `EpicEditor` in
`EpicManagementSection.tsx`, adjacent to Planning kind and Relevant days.

Show:

- **Jira-estimated remaining** — read-only points and pointed-item count;
- **Unestimated Jira items** — read-only count;
- **Unrefined work remaining** — editable numeric input with `pts` unit;
- **Modeled remaining** — derived sum;
- last-reviewed time;
- a restrained review-needed warning with the relevant change summary.

Helper copy should say that unrefined points cover work not already represented by pointed Jira
tickets. On save, show the exact resulting equation before/after where useful.

Use the repository's existing `.control`, `.btn`, `.link-btn`, `--panel-2`, border, radius, focus,
and status tokens. Keep it an information-dense group inside the existing modal, not a large new
card. Allow controls to wrap at the current narrow breakpoint.

### 5.2 Post-sync review surface

After `SyncButton` receives a successful outcome and reloads the dataset:

- if `estimateReviews` is empty, retain the concise success message;
- otherwise show `Synced … · N estimates need review` and open one accessible review dialog;
- list each affected epic with the previous acknowledged unrefined amount, Jira point change
  summary, current modeled total, numeric edit field, **Keep**, and **Update** actions;
- process rows independently so one failure does not discard successful acknowledgments;
- keep Escape/close as **Review later**, preserving the warning in persisted/derived state;
- trap focus in the modal and restore focus to Sync when it closes;
- announce save/error state through a restrained `aria-live="polite"` region.

Because review is derived from the stored basis, a browser reload, a dismissed modal, or another
tab cannot lose the warning.

### 5.3 Overview and Timeline presentation

Replace ambiguous totals with an at-a-glance breakdown:

```text
Modeled remaining 50 pts
25 Jira-estimated + 25 unrefined
3 unestimated Jira items · reviewed Aug 16
```

When review is needed, add an action-oriented indicator without replacing the underlying delivery
health color. The Overview portfolio total uses modeled points. The selected epic's contribution
and total portfolio load remain visible together, as required by the product constitution.

Timeline completion and buffer use modeled remaining points. Custom relevant days appear like all
other non-gating milestones; only the selected gating day drives the delivery verdict.

### 5.4 Relevant-day creation

In `RelevantDaysEditor`:

- use a free-text name input with preset suggestions;
- default the empty form to **Production Launch** only as a convenience, not a constraint;
- allow **Bug Bash** or any other trimmed name;
- preserve the current date input and add behavior;
- disable Add only for read-only/busy, blank name, or invalid/blank date;
- clear or reset the form after success and retain it with inline error on failure.

Remove or consolidate the unused older `MilestonesSection` so future fixes cannot land in a dead
parallel UI. Do not create a second relevant-day editor.

## 6. Implementation slices

Each slice updates this document's status/continuation record and ends with the repository's
manual-validation walkthrough before proceeding.

### Slice 1 — Characterize and centralize full sync

Primary seams:

- `packages/backend/src/routes/sync.ts`
- new `packages/backend/src/sync/sync-service.ts`
- `packages/backend/src/server.ts`
- `packages/backend/src/importer/factory.ts`
- `packages/backend/src/importer/jira.ts`
- `packages/backend/src/jira/request-cache.ts`
- `packages/backend/src/db/reconcile.ts`

Work:

1. Add regression tests proving current cache reuse, pre-fetch local snapshot loss, separate commit
   behavior, concurrent calls, and zero-active-epic failure.
2. Introduce `SyncCoordinator`/service with one in-flight run and injected clock.
3. Make a full sync explicitly fresh and add the bounded abort/timeout contract.
4. Return an explicit complete snapshot with scope identity, including a valid empty active set and
   final facts for roots leaving active capacity.
5. Re-read local state after the fetch and reject mapping/scope changes with `409`.
6. Route `POST /api/sync` through the service; keep the HTTP route thin.
7. Route Jira/demo startup population through the same service or skip it until explicit sync when
   mapping is incomplete. Keep synthetic fixture seeding as clearly named non-Jira tooling.

**Exit:** every production planner-fact refresh uses one service; Sync always reads Jira freshly;
concurrent calls produce one Jira operation; an empty active board commits successfully; local
intent edited during fetch survives.

### Slice 2 — Make sync persistence atomic and cache output truthful

Primary seams:

- `packages/backend/src/db/persist.ts`
- `packages/backend/src/db/sync-log.ts`
- `packages/backend/src/routes/sync.ts` or the new service
- `packages/backend/src/jira/sync-cache.ts`

Work:

1. Extract non-transaction-owning dataset row replacement.
2. Add one `commitSync()` transaction covering dataset rows, `last_synced_at`, and sync log.
3. Inject and reuse one exact `syncedAt` value throughout the merge, setting, log, and response.
4. Build a complete multi-epic raw cache only after all fetches succeed; write via temporary file
   plus rename after the DB commit. Treat cache-write failure as a warning, not a rollback of valid
   planner state.
5. Add privacy-safe run ID, duration, trigger, fresh/cache policy, counts, and terminal error class
   to application logs. Never log credentials, tokens, raw responses, or new ticket titles.

**Exit:** a forced timestamp/log failure rolls back the planner replacement; a fetch/cache failure
cannot leave a partial planner commit; raw cache represents the same complete source fetch as the
successful sync.

### Slice 3 — Persist progressive epic estimates

Primary seams:

- `packages/shared/src/domain.ts`
- `packages/backend/src/db/schema.ts`
- `packages/backend/src/db/database.ts`
- `packages/backend/src/db/persist.ts`
- `packages/backend/src/db/repository.ts`
- `packages/backend/src/routes/portfolio.ts` or a focused estimate route module
- `packages/frontend/src/data/loadDataset.ts`
- synthetic and bundled fixtures

Work:

1. Add `EpicEstimate`, the optional dataset collection, and the additive SQLite table/migration.
2. Round-trip rows through persistence, binary database snapshot/import, and JSON fixture loading.
3. Preserve estimate rows in reconciliation for active, excluded, archived, and reactivated epics.
4. Add validated `PUT`/`DELETE` endpoints with fact-signature concurrency checking.
5. Seed deliberate sample cases without backfilling real databases.

**Exit:** absent, zero, and positive estimates remain distinct; estimates survive restart,
snapshot/import, Jira sync, exclusion, kind changes, archive, and reactivation.

### Slice 4 — Centralize workload math and update capacity projection

Primary seams:

- new `packages/engine/src/workload.ts`
- `packages/engine/src/project.ts`
- `packages/engine/src/adapter.ts`
- `packages/engine/src/portfolio.ts`
- `packages/engine/src/index.ts`
- `packages/frontend/src/lib/projection.ts`
- `packages/frontend/src/lib/portfolioOverview.ts`
- `packages/backend/src/routes/portfolio.ts`

Work:

1. Implement canonical remaining-fact basis, signature, review-delta, and workload breakdown helpers.
2. Replace duplicated remaining-point calculations in projection/read models with the resolver.
3. Add the aggregate unrefined forecast job for timeline epics.
4. Apply explicit completeness rules for no-ticket, unestimated-ticket, acknowledged-zero, stale,
   and Ongoing cases.
5. Expand projection results with Jira/unrefined/modeled breakdowns and a separate review state.
6. Keep shared capacity allocation global even when the page is filtered.

**Exit:** all forecast dates, buffers, health calculations, portfolio totals, and displayed point
breakdowns agree on one modeled workload contract.

### Slice 5 — Epic estimate editor and post-sync review

Primary seams:

- `packages/frontend/src/components/EpicManagementSection.tsx`
- `packages/frontend/src/components/PortfolioOverview.tsx`
- `packages/frontend/src/App.tsx` / Timeline presentation
- `packages/frontend/src/components/SyncButton.tsx`
- a focused review component if extraction improves clarity
- `packages/frontend/src/data/api.ts`
- `packages/frontend/src/styles.css`

Work:

1. Add the compact estimate breakdown/editor to the existing epic configuration modal.
2. Add persistent review-needed indicators and actions to Overview/Configuration.
3. Make `SyncResponse` typed and present one multi-epic post-sync review dialog.
4. Implement Keep, Update, Review later, per-row errors, stale-signature reload, focus management,
   live-region feedback, and narrow layout.
5. Update portfolio totals and labels to distinguish modeled from Jira-only values.

**Exit:** a user can start at 50 unrefined points, progressively transfer work into Jira facts,
review changes after sync, and always see the exact capacity total being forecast.

### Slice 6 — Custom relevant days

Primary seams:

- `packages/frontend/src/components/EpicManagementSection.tsx`
- `packages/frontend/src/components/Configuration.tsx` cleanup
- `packages/frontend/src/styles.css`
- existing milestone repository/API tests

Work:

1. Replace the active add-row select with a free-text input and suggestions.
2. Add **Bug Bash** as a suggestion while retaining launch/UAT convenience.
3. Validate blank names/dates in the UI and retain backend validation as authority.
4. Remove/consolidate the unused duplicate milestone surface.
5. Add keyboard, edit, reload, gate-invariant, custom-name, and narrow-viewport coverage.

**Exit:** a custom-named relevant day can be added, edited, displayed, gated, reloaded, and synced
without special backend schema or enum changes.

### Slice 7 — Documentation and release hardening

Primary seams:

- [`README.md`](../README.md)
- [`jira-first-sync.md`](./jira-first-sync.md)
- relevant existing durable plans
- package unit/integration/e2e suites

Work:

1. Update the facts-versus-intent documentation to include unrefined estimates and explicit sync
   review behavior.
2. Document the forced-fresh and atomic sync guarantees, timeout, retry behavior, and complete-empty
   board behavior.
3. Correct old wording that implies every import-like path is the same as a sync.
4. Run the full verification matrix and the manual workflow below.
5. Record exact commands, results, material discoveries, and any approved contract change in this
   plan.

**Exit:** docs match implemented ownership/math; all acceptance criteria pass; no stale plan tells
future work to reintroduce ticket-only totals or a second sync implementation.

## 7. Failure, concurrency, migration, security, and accessibility

### 7.1 Failure and retry

- Any Jira request/page failure or timeout commits no planner facts, freshness timestamp, or success
  log.
- A complete snapshot with zero active epics is success and may archive/remove capacity load.
- A local mapping/scope change during fetch returns `409` with “configuration changed; sync again.”
- A failed estimate acknowledgment keeps the user's input and warning visible.
- Raw-cache export failure does not invalidate a committed sync; expose it as a warning/log event.
- A stale estimate remains in math until reviewed; never replace it with zero or omit it.

### 7.2 Concurrency

- Coalesce concurrent sync calls in one process; one fetch, one reconcile, one commit, one log.
- Read local intent after the network phase, immediately before reconcile.
- Verify the mapping/scope fingerprint used for the fetch before commit.
- Estimate updates submit a fact signature and fail safely if another sync won the race.
- Do not hold a database transaction open across network I/O.
- Database import remains an explicit wholesale restore, not a sync. Coordinate it with an in-flight
  sync at the route/service boundary or return a clear conflict rather than interleaving two full
  replacements.

### 7.3 Migration and compatibility

- The new table is additive. Old databases and JSON fixtures have no estimate rows and therefore
  preserve unknown semantics.
- `epicEstimates` is optional while fixtures/call sites migrate, then can become required in a later
  versioned cleanup.
- Existing `remainingPoints` response consumers receive a temporary modeled-total alias until they
  migrate to explicit fields.
- Existing sync logs remain readable; new categories/summary fields use tolerant readers.
- Binary snapshots naturally carry the new table; imported older snapshots are migrated before
  `readDataset()` and yield an empty estimate collection.
- Do not infer unrefined estimates from old ticket totals or milestones.

### 7.4 Security and privacy

- Jira credentials remain environment-only and never enter settings, estimate rows, sync logs, raw
  cache metadata, or client responses.
- Estimate review bases contain ticket keys and numeric/null estimates only; do not duplicate titles,
  descriptions, comments, or assignee details.
- Operational logs use run IDs, durations, counts, and error classes. Do not add raw Jira payloads or
  estimate-review content to normal logs.
- Preserve the current gitignored treatment of raw Jira cache files and the obfuscation workflow.

### 7.5 Accessibility and visual behavior

- Reuse native number, text, date, and radio controls with explicit labels.
- The review dialog traps focus, supports Escape/close as Review later, restores focus, and reports
  row saves/errors through a polite live region.
- Status is never color-only: spell out delivery health and estimate review state.
- Use existing dark tokens, compact control geometry, and established focus-visible behavior.
- Verify desktop and narrow layouts, long epic/milestone names, read-only sample mode, busy, error,
  empty, zero, stale, and disabled states.

## 8. Automated verification

Before every Node/npm/npx command, run `nvm use` from the repository root as required by
`AGENTS.md`.

### 8.1 Shared/domain and persistence

- absent estimate collection normalizes to empty;
- positive and explicit-zero estimates round-trip exactly;
- invalid negative, non-finite, malformed-basis, missing-epic, and stale-signature writes fail with
  no partial mutation;
- old database import migrates with no fabricated estimate;
- new database snapshot/import preserves estimates and review bases;
- archived/excluded estimate rows survive and reactivate intact.

### 8.2 Workload and projection engine

- `hard 0 + unrefined 50 = modeled 50`;
- `hard 25 + unrefined 25 = modeled 50`;
- Done items do not count;
- unestimated items without acknowledgment produce needs-estimates;
- unestimated items with an estimate row use the unrefined bucket and remain disclosed;
- no tickets/no estimate is not healthy zero; explicit saved zero is distinct;
- stale estimates still consume capacity and carry separate review state;
- aggregate unrefined timeline work shifts completion/buffer by the expected capacity amount;
- Ongoing unrefined work is visible/unplanned and receives no invented completion date;
- filtered projections preserve total portfolio load and selected contribution.

### 8.3 Review delta derivation

- new pointed and new unpointed items require review;
- `null -> points` requires review;
- a point increase requires review;
- point decrease, Done, and removal alone do not require review;
- reopen requires review when the item was absent from the acknowledged remaining basis;
- multiple syncs before review derive one current, de-duplicated delta;
- Keep and Update capture the current basis and clear review state;
- a changed fact signature rejects a stale acknowledgment.

### 8.4 Sync service and backend integration

- manual sync bypasses a warm Jira discovery cache;
- two concurrent `POST /api/sync` calls execute one fetch and create one log;
- a local milestone, placement, capacity edit, and epic estimate saved during fetch survive commit;
- a mapping/board change during fetch returns conflict and commits nothing;
- timeout or failure on any page commits nothing and leaves last success unchanged;
- zero active epics commits and removes prior active load;
- completed roots carry final status into reconciliation and pull placements;
- dataset, timestamp, and log roll back together on an injected commit failure;
- startup Jira/demo import uses the service; read-only discovery and Standup refresh cannot replace
  planner facts;
- complete raw cache contains all synced epics and is not written for a failed/partial fetch.

### 8.5 Frontend unit and Playwright coverage

- custom **Bug Bash** and arbitrary relevant-day names save and reload;
- the first custom day becomes the gate; promotion/deletion invariants remain intact;
- the estimate editor shows hard + unrefined = modeled and distinguishes absent from zero;
- Sync opens one review dialog for all affected epics;
- Keep, Update, Review later, and per-row errors behave independently;
- review indicators survive reload/dismissal and appear in all-active and filtered views;
- filter/page URL is unchanged by estimate review or epic configuration;
- keyboard order, focus trap/restoration, Escape, live-region output, and visible focus pass;
- desktop and narrow layouts show no overflow or browser-default styling leakage.

### 8.6 Expected command matrix

Record the exact successful commands during implementation. The expected baseline is:

```bash
nvm use
npm run typecheck
npm run test
npm run build
npm --workspace @ecp/frontend run e2e -- jira-mapping.spec.ts
npm --workspace @ecp/frontend run e2e -- epic-management.spec.ts
npm --workspace @ecp/frontend run e2e -- portfolio.visual.spec.ts
```

Add focused backend/engine Vitest targets while iterating. Run Playwright with the repository's
configured browser/environment and document any narrower command actually used.

## 9. Manual validation walkthrough

Use fake Jira first, then repeat the freshness-sensitive steps against a live non-production Jira
board.

1. Track a timeline epic with a launch gate and no pointed tickets. Enter `50` as unrefined work
   remaining. Confirm Overview/Timeline show `0 Jira + 50 unrefined = 50 modeled` and forecast against
   the shared team capacity.
2. Add/point Jira work totaling `25`, then click Sync. Confirm the request performs a fresh Jira
   read, the planner shows `25 + 50 = 75` conservatively, and one review row explains why.
3. Change unrefined work to `25`. Confirm the modeled total returns to `50`, the warning clears, and
   the new completion/buffer appears everywhere.
4. Add another pointed ticket and sync twice before reviewing. Confirm one de-duplicated persistent
   review remains; dismiss and reload to prove it survives.
5. Choose **Keep current amount** and verify only the review basis changes.
6. Open the review in one tab, sync in another, then try to save the stale row. Confirm `409`, reload,
   and no acknowledgment is lost or incorrectly accepted.
7. Edit a milestone or placement while a deliberately delayed sync is fetching. Confirm the local
   edit survives the sync commit.
8. Warm Jira discovery data, modify Jira, and immediately click Sync. Confirm the change appears
   despite the discovery cache TTL.
9. Complete/remove the final active epic. Confirm Sync succeeds, active capacity no longer includes
   it, final facts/history are retained, and the app does not report a mapping failure.
10. Add a relevant day named **Bug Bash**, edit it to **Checkout Bug Bash**, reload, promote it to
    gate, and verify Timeline/calendar rendering. Promote another gate before removing it.
11. Repeat estimate and relevant-day interactions using only the keyboard at desktop and narrow
    viewport widths. Verify focus, labels, announcements, errors, wrapping, and read-only behavior.
12. Inspect sync history and operational logs. Confirm one entry per run, matching timestamp/counts,
    no partial runs, and no credentials/raw Jira content.

## 10. Acceptance criteria

- One backend service owns every production planner-fact sync from trigger through typed outcome.
- Reconciliation remains the single facts-versus-intent policy seam; routes, startup, and UI do not
  duplicate it.
- User-initiated Sync is demonstrably fresh, bounded, coalesced, and all-or-nothing.
- Local intent saved while Jira is being fetched cannot be overwritten by a stale pre-fetch read.
- A complete board snapshot with zero active epics is valid and removes obsolete active capacity.
- Dataset facts, `last_synced_at`, and the success log commit atomically with one timestamp.
- Each epic can store absent, zero, or positive unrefined remaining points as local intent.
- Every capacity forecast and point total uses the documented Jira-estimated + unrefined formula
  through one workload resolver.
- New/newly pointed/increased/reopened Jira work produces a durable, non-blocking review state and
  never silently changes the user's unrefined amount.
- Users can keep or revise an estimate with stale-write protection.
- Review state and delivery health remain separate and visible in all-active and filtered views.
- Ongoing work receives no invented launch date or capacity reservation.
- Users can create arbitrary relevant-day names, including Bug Bash, without weakening the
  single-gating-day invariant.
- Estimate, milestone, placement, roster/capacity, portfolio, and SME intent survive sync,
  restart, snapshot/import, exclusion, archive, and reactivation as specified.
- No new navigation level, epic drill-down mode, single-epic capacity pool, or secret persistence is
  introduced.
- Automated checks and the manual walkthrough pass, and product/sync documentation matches the
  shipped contracts.

## 11. Explicit non-goals

- Probabilistic/Monte Carlo forecasting or confidence intervals.
- Automatically inferring unrefined points from BRDs, ticket counts, history, labels, or AI.
- Automatically decrementing the unrefined estimate when Jira points appear.
- Editing Jira issue estimates, statuses, sprints, or launch dates from this planner.
- Creating fake Jira tickets or Gantt cards to represent aggregate unrefined work.
- Adding milestone-type enums, mandatory milestone templates, or a new calendar/navigation level.
- Automatically scheduling Ongoing unrefined work without a future explicit reservation product
  decision.
- Turning targeted Standup ticket refresh or Jira setup discovery into full planner syncs.
- Broad multi-process/distributed locking; this local single-process app uses process-level
  coalescing plus SQLite atomicity. Revisit if the deployment model changes.

## 12. Implementation continuation record

### 2026-08-16 — core delivery slice

Implemented:

- `SyncCoordinator` now owns full planner-fact refreshes. It coalesces in-process callers, reads
  Jira through the uncached client, bounds the fetch with the configured 120-second timeout,
  re-reads local state after I/O, protects against mapping changes, and atomically persists the
  reconciled dataset, timestamp, and sync log.
- Jira imports return an explicit complete snapshot, accept an empty active scope, and produce a
  complete multi-epic raw-cache payload only after successful fetches. The cache is written with a
  temporary file and rename after the database transaction.
- Local `epic_estimate` rows distinguish absent, zero, and positive unrefined work. They survive
  reconcile/archive/reactivation and SQLite snapshot/import. Focused optimistic-concurrency-safe
  `PUT`/`DELETE /api/epics/:key/estimate` endpoints acknowledge the current Jira fact basis.
- The engine's workload resolver is now the source for Jira-estimated, unrefined, modeled, and
  unestimated-work calculations. Timeline capacity includes an internal aggregate job for
  unrefined work; Ongoing work keeps that amount visible as unplanned.
- Configuration has a compact estimate editor for Timeline epics only; Ongoing epics deliberately
  expose no work-remaining option. Overview and Timeline disclose the modeled equation; Sync opens
  one keyboard-accessible multi-epic review surface. The epic list uses a compact upper-left icon
  (violet infinity for Ongoing; blue calendar for Timeline) plus text status, so planning kind is
  not conveyed by color alone.
- Relevant days now use free text with Production Launch, UAT Testing Start, and Bug Bash
  suggestions. The older unused Configuration editor was removed.

Automated evidence recorded for this slice:

```bash
nvm use
npm run typecheck
npm --workspace @ecp/backend run test
npm --workspace @ecp/engine run test
npm --workspace @ecp/frontend run test
npm --workspace @ecp/engine run test -- workload.test.ts
npm --workspace @ecp/backend run test -- persist.test.ts sync.test.ts
```

All listed commands passed. Remaining release-hardening work is the broader visual/Playwright
matrix and live non-production Jira freshness exercise in §9; no product-contract change was made.

## 12. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Users treat unrefined points as a total and double-count | Use “remaining not represented by pointed Jira work” copy and always show the equation |
| Review prompts become noisy | Trigger only scope-expanding/refinement events; consolidate all epics; allow Review later |
| Stale estimates make forecasts look authoritative | Preserve the load but add a separate visible provisional/review state and last-reviewed time |
| Empty/partial Jira data archives valid work | Require an explicit complete snapshot; any request/page failure commits nothing |
| Cache makes manual sync stale | Give full sync an explicit fresh-read client/policy and test a warmed-cache case |
| Local changes disappear during network I/O | Re-read after fetch and validate mapping fingerprint before reconcile |
| Atomic refactor breaks snapshot/seed tooling | Keep `writeDataset()` as a transactional wrapper; add a separate `commitSync()` wrapper |
| Soft aggregate work leaks into Jira/Gantt/dependencies | Model it as an engine forecast job only, never a `WorkItem` |
| Old fixtures silently mean zero | Optional collection plus absence semantics; no backfill |
| Custom day UI diverges from existing visual system | Reuse compact native controls/tokens and remove the dead duplicate editor |

## 13. Continuation record

**Current status:** core delivery is implemented on `feat/sync-integrity-progressive-estimation`.
The current worktree also contains unrelated user changes in Standup/backend/shared files; preserve
them while continuing work on this plan.

**Next action:** complete the remaining release-hardening work: visual/Playwright coverage for the
configuration and review flows, plus a live non-production Jira freshness exercise.

**Latest verification:**

```bash
nvm use
npm --workspace @ecp/frontend run typecheck
npm --workspace @ecp/frontend run test
git diff --check
```

All commands passed on 2026-08-16. Update this record with exact verification and any material
contract discovery as implementation continues. If the additive-estimate meaning or review triggers
change, record the rationale here before changing schema or projection behavior.
