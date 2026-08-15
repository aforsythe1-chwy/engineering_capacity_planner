# Portfolio Capacity Planner — Durable Implementation Plan

**Status:** Proposed  
**Last updated:** 2026-08-14  
**Supersedes:** the single-epic Jira import and `epics[0]` application flow  
**Scope:** one Jira board, one team, multiple concurrent active epics

## 1. Problem

The planner currently answers whether one epic can finish by one gating date while assuming that
epic can consume the team's full capacity. That assumption breaks down for teams running several
epics at the same time:

- Jira imports only one selected epic and its descendants.
- The frontend automatically opens the first epic in the dataset.
- Each epic projection independently consumes the full team capacity, so calculating several
  epics separately would double-count the same engineers.
- The Gantt scopes weekly load to one epic, hiding work from other epics that consumes the same
  sprint capacity.
- There is no portfolio view showing which engineers are overloaded, which have slack, or which
  epic is putting another epic's target at risk.

The planner must become portfolio-first: the selected board defines the work in scope, all active
epics compete for one shared team-capacity schedule, and each epic remains available as a detailed
drill-down.

## 2. Product outcome

The primary user should be able to answer:

1. Which active epics are on target, at risk, or missing enough planning information to decide?
2. Is the team overcommitted across the active portfolio?
3. Which engineers or weeks are overloaded, and where does spare capacity exist?
4. Which epic, assignment, dependency, or unplanned work is responsible for the risk?
5. What changes when work or engineers are moved in a local what-if scenario?

Target flow:

```text
Jira board
  -> active epic portfolio
  -> shared team-capacity schedule
  -> epic health + engineer load + portfolio risks
  -> selected epic drill-down
       -> timeline
       -> calendar
       -> dependencies
       -> Gantt planning
       -> milestones and label configuration
```

## 3. Goals

- Use the selected Jira board as the portfolio boundary.
- Discover and import every active epic with in-flight work.
- Calculate team capacity once and allocate it across all active work.
- Produce a health result for each epic without double-counting capacity.
- Show total and per-engineer load by sprint/week.
- Make overload, slack, missing estimates, missing targets, and unplanned work visible.
- Preserve existing epic-level timeline, dependency, Gantt, milestone, and label capabilities as
  drill-downs.
- Preserve local intent across Jira syncs: cadence, velocities, availability, milestones, Gantt
  placements, inclusion/exclusion choices, and future what-if assignments.
- Retain epics that leave the active portfolio as archived history instead of deleting local
  planning data.
- Keep the system local, single-user, SQLite-backed, and configuration-driven.

## 4. Non-goals for the first usable release

- Managing several Jira boards or several teams in one portfolio.
- Writing assignee or sprint changes back to Jira.
- Automatically moving engineers or claiming that one reassignment is optimal.
- Replacing Jira rank or Jira's sprint-planning UI.
- Monte Carlo forecasting or probabilistic delivery dates.
- Partial-progress percentages beyond the current Done/not-Done model.
- Resource planning across non-engineering roles or skills-based matching.
- Hosted, multi-user, or real-time collaborative planning.

## 5. Working definitions

### 5.1 Active epic

Default rule:

> An active epic is an unresolved epic in the selected board's scope with at least one descendant
> work item that is not Done.

The rule must use Jira status-category semantics where available rather than matching a single
status name. The setup UI must preview the discovered epics before the first sync.

Exceptions:

- **Force include:** retain an epic that does not match the default rule.
- **Exclude:** hide an epic that matches the rule but should not consume this portfolio's planning
  attention.
- Include/exclude choices are local intent and survive sync.
- An epic that was previously imported but no longer matches the rule becomes archived. It is not
  hard-deleted.

### 5.2 Portfolio health states

- **Green:** projected completion leaves at least the configured green buffer before the epic's
  gating milestone.
- **Yellow:** projected completion is on or before the gating milestone but below the green buffer.
- **Red:** projected completion is after the gating milestone or unreachable within the horizon.
- **Needs target:** the epic has no gating milestone.
- **Needs estimates:** remaining work contains unestimated items that prevent a trustworthy result.
- **Needs plan:** material remaining work is not placed or schedulable under the selected planning
  policy.

Unknown or incomplete inputs must never be represented as green.

### 5.3 Facts and intent

Jira owns facts:

- epic/story/work-item identity and title;
- Jira status and status category;
- estimates, assignees, labels, issue hierarchy, sprint membership, and dependencies;
- sprint identity and dates.

The local planner owns intent:

- active-portfolio include/exclude overrides;
- epic priority and gating/relevant dates;
- team cadence, velocity, PTO, on-call, and velocity overrides;
- Gantt placements;
- future what-if assignment overrides;
- display preferences and label rules.

## 6. User experience

### 6.1 Jira setup

Replace `Connect -> Board -> Epic -> Fields -> Members` with:

```text
Connect -> Board -> Epic scope -> Fields -> Members -> Review
```

The **Epic scope** step must:

- query the selected board;
- show the active-epic rule in plain language;
- preview matching epic keys, titles, statuses, remaining-item counts, and remaining points;
- identify epics that need estimates;
- allow force-include and exclude overrides;
- show previously imported epics that will be archived;
- avoid requiring a single epic selection.

The **Review** step must summarize:

- active epics to import;
- archived and excluded epics;
- required field mappings;
- connected member count;
- current backend source mode;
- the fact that one shared capacity pool will be used.

### 6.2 Portfolio overview

The default landing view becomes **Portfolio**. It contains:

- one card or row per active epic;
- epic key/title and Jira link;
- health state and reason;
- gating milestone and date;
- projected completion and buffer;
- remaining estimated points and unestimated-item count;
- placed versus unplanned work;
- engineers currently assigned to the epic;
- blocking-work summary;
- capacity share over the selected horizon.

Default ordering:

1. red;
2. yellow;
3. needs target/estimates/plan;
4. green;
5. then nearest gating date;
6. then configured epic priority and epic key as deterministic tie-breakers.

Selecting an epic opens its existing detailed tabs. The current selection must be represented in
the URL or another durable navigation state so reload/back/forward behavior is predictable.

### 6.3 Shared portfolio plan

The portfolio Gantt shows one sprint at a time with:

- total team capacity per week;
- total planned load across every active epic;
- epic rows or groups, with work cards retaining epic identity;
- overload color based on the combined portfolio load;
- unplanned work grouped by epic;
- filters for epic, engineer, status, and label.

An epic drill-down may filter the same shared schedule, but its capacity header must continue to
show total portfolio consumption. It must not imply that the selected epic owns unused team
capacity.

### 6.4 Engineer load

Provide an engineer-by-week view that shows:

- available capacity after PTO, on-call, and velocity overrides;
- assigned/planned points across all epics;
- overload or slack;
- the epic breakdown of that load;
- unassigned work as a separate portfolio row;
- drill-down to the contributing tickets.

The first release identifies rebalancing opportunities. A later release may allow temporary local
assignment overrides and compare the resulting portfolio health before persisting any planning
intent.

## 7. Domain and persistence changes

The existing schema already supports several epics, stories, work items, milestones, dependencies,
and placements. Changes should be additive.

### 7.1 Epic lifecycle

Extend `Epic` and the `epic` table with:

- `active` — whether it currently participates in the portfolio;
- `source_status` — Jira display status for orientation;
- `status_category` — normalized Jira status category when available;
- `archived_at` — local timestamp set when an imported epic leaves active scope;
- `last_seen_at` — last successful sync that observed the epic.

Existing rows migrate with `active = true`; new nullable metadata columns default to `NULL`.

### 7.2 Portfolio intent

Add a `portfolio_epic` table rather than mixing local planning intent into Jira facts:

```text
epic_key          PK/FK -> epic.key
scope_override    auto | include | exclude
priority          integer
```

Future assignment experiments should use a separate `planned_assignment` table:

```text
work_item_key     PK/FK -> work_item.key
member_id         FK -> team_member.id
```

`planned_assignment` is not required for the first multi-epic import slice, but the portfolio
engine and API should avoid designs that make it difficult to add.

### 7.3 Work-item completeness

The current numeric `points` field cannot distinguish a real zero from an absent estimate. Add an
explicit estimate state, preferably `points: number | null` in the domain and nullable storage.
Capacity calculations must report unestimated remaining work instead of treating it as zero.

If changing `points` to nullable causes excessive compatibility risk, add `is_estimated` as an
intermediate migration, then converge on a single representation later.

### 7.4 Settings migration

Add:

- `jira_epic_scope_mode` — `single` or `active`;
- portfolio horizon and display settings only when a concrete UI requirement needs them.

Compatibility rule:

- A database with `jira_epic_key` and no scope mode remains in legacy `single` mode.
- New board setups default to `active` mode.
- The wizard offers an explicit migration from the legacy selection to all active epics.
- Do not silently change an existing database's import scope.

## 8. Jira import architecture

### 8.1 Board-scoped discovery

The selected Agile board is authoritative. Extend `JiraClient` with a paginated board-issues read,
using the Agile board issue endpoint and explicit fields. Avoid assuming that every board is a
whole Jira project or that project epics are necessarily visible on the board.

Discovery sequence:

1. Fetch board metadata and sprints.
2. Fetch the board's issues with parent, status/status-category, assignee, estimate, sprint, labels,
   and link fields.
3. Resolve parent chains to their epic ancestors, fetching missing parents as needed.
4. Group stories and work items by epic.
5. Apply the default active rule and local include/exclude overrides.
6. Fetch any additional descendants needed for included epics while retaining board-scope rules.
7. Map the complete result into one `DomainDataset` containing all active and retained archived
   epics.

All reads must paginate. Hierarchy must continue to use parent relationships rather than hardcoded
issue-type names where practical.

### 8.2 Importer and mapper

Replace the single `resolveEpicKey()` flow with portfolio discovery. Refactor the mapper from:

```text
one epic + its stories + its work items -> dataset
```

to:

```text
epic groups[] + board sprints -> dataset
```

The mapper remains pure and independently testable. Shared members, sprints, and dependencies are
deduplicated across epic groups. Dependencies may cross epic boundaries and must remain available
to the portfolio engine even if an epic drill-down filters them from its local graph.

### 8.3 Sync cache

Bump the Jira sync-cache schema from a single `epicIssue` to `epicIssues`/epic groups. The
obfuscator and committed test fixture must support multiple epics. A clear version error is
acceptable for old raw cache files; the SQLite migration must remain automatic.

### 8.4 Reconciliation

On a successful sync:

- refresh facts for observed epics and descendants;
- add newly active epics;
- mark epics that leave scope inactive/archived instead of deleting them;
- preserve milestones, epic priority, scope overrides, placements, and future planned assignments;
- retain members and their capacity settings;
- prune or flag placements whose item/sprint disappeared according to the existing safety rules;
- record added, reactivated, archived, included, and excluded epic changes in the sync log.

An importer failure must not partially archive or replace the current portfolio.

## 9. Shared-capacity model

### 9.1 Core invariant

For any team and day/week:

> The sum of capacity allocated to all epics must never exceed the capacity calculated for the
> team or engineer for that period without producing an explicit overload.

Capacity is calculated once from active members, velocity, PTO, on-call, and velocity overrides.
Epic projections consume from that shared result; they do not each rebuild a full-capacity context.

### 9.2 Planning inputs

The portfolio engine consumes:

- active epics and their gating milestones;
- all remaining estimated work;
- explicit sprint/week placements;
- Jira assignees and future local assignment overrides;
- work-item dependencies, including cross-epic edges;
- epic priority;
- configured capacity and verdict thresholds.

### 9.3 Scheduling policy

The engine must be deterministic and explainable. Initial policy:

1. Respect completed work and dependency readiness.
2. Respect explicit local placements before inferred scheduling.
3. Use planned assignment when present; otherwise use Jira assignee.
4. Schedule unassigned work against the shared unassigned/team pool and report it separately.
5. Order otherwise eligible work by:
   - placed sprint/week;
   - earliest gating date;
   - configured epic priority;
   - Jira/issue key as a deterministic final tie-breaker.
6. Consume each engineer's capacity at most once per day/week.

If the scheduling model cannot place work because of missing estimates, missing assignments, no
capacity, or unresolved dependencies, return structured diagnostics rather than hiding the gap.

### 9.4 Outputs

Return a `PortfolioProjection` containing:

- one shared capacity trace;
- per-week team load and verdict;
- per-member capacity/load/slack;
- per-epic projected completion, buffer, health state, and reason;
- remaining and unestimated work counts;
- placed versus inferred versus unscheduled points;
- blocking and unschedulable diagnostics;
- the capacity allocation trace needed to explain results in the UI.

The existing single-epic `ProjectionResult` may remain as a drill-down adapter, but portfolio
health must come from the shared projection.

## 10. Backend and API changes

Add read APIs shaped around user tasks rather than exposing raw tables:

- `GET /api/portfolio` — active/archived epic summaries and shared health.
- `GET /api/portfolio/load` — team and engineer load over the selected sprint/horizon.
- `GET /api/epics/:key` — epic drill-down dataset or summary.
- `GET /api/jira/epic-scope/preview` — discovered active epics before first sync.
- `PUT /api/portfolio/epics/:key` — include/exclude and priority intent.

Keep the existing full-dataset endpoint during migration. Mutating APIs must validate epic/team
membership and preserve foreign-key safety.

Sync responses and logs should include:

- active epics;
- newly active epics;
- reactivated epics;
- archived epics;
- excluded epics;
- work-item and sprint totals;
- unestimated active items.

## 11. Frontend architecture

### 11.1 Selection and routing

Remove the `epics[0]` assumption. Introduce explicit application state:

- `portfolio` — default route/view;
- `selectedEpicKey` — validated against the dataset;
- epic drill-down route/view preserving the existing tabs.

Prefer URL-addressable state, for example:

```text
/?view=portfolio
/?view=epic&epic=NF-123&tab=timeline
```

A lightweight query-string router is sufficient; a routing dependency is not required unless the
UI grows beyond these needs.

### 11.2 View models

Add portfolio-level selectors alongside `scopeEpic`:

- `scopePortfolio(dataset)`;
- `portfolioEpicSummaries(dataset, projection)`;
- `engineerLoadView(dataset, projection, sprintId)`;
- shared Gantt view builders operating on all active work.

Keep epic-specific transformations pure so they remain easy to test.

### 11.3 Drill-down correctness

Timeline, dependency graph, work list, milestones, and label settings remain epic-scoped. Gantt
capacity and engineer load remain portfolio-scoped even when work cards are filtered to one epic.
The UI must label this distinction clearly.

## 12. Delivery slices

Each slice should be reviewable and leave the application usable.

### Slice 1 — Multi-epic fixture and additive domain migration

- Add an active/archived epic model and portfolio intent storage.
- Add explicit unestimated-work representation.
- Expand synthetic/fake Jira data to several concurrent epics.
- Update persistence round-trip and migration tests.

**Exit:** the database and dataset losslessly hold multiple active epics without changing the
single-epic UI yet.

### Slice 2 — Board-scoped Jira portfolio import

- Add board-issue pagination and parent-chain discovery.
- Map several epic groups in one import.
- Add active/include/exclude behavior and preview API.
- Update cache, obfuscation, fixtures, reconciliation, and sync logs.

**Exit:** one sync imports every matching active epic, retains archived history, and preserves local
intent.

### Slice 3 — Portfolio navigation and overview shell

- Replace the single Epic wizard step with Epic scope and Review.
- Add explicit portfolio/epic navigation.
- Add overview cards with factual counts and completeness states before shared forecasting lands.
- Preserve all existing epic drill-downs.

**Exit:** users can see and navigate every active epic; no view silently selects `epics[0]`.

### Slice 4 — Shared portfolio projection

- Implement the deterministic shared-capacity scheduler.
- Add engine diagnostics and invariants.
- Replace per-epic full-capacity health with shared portfolio health.
- Add portfolio and load APIs.

**Exit:** several epics cannot claim the same capacity, and every health result is explainable.

### Slice 5 — Shared Gantt and engineer load

- Make weekly load aggregate all active epics.
- Add epic filtering without changing capacity totals.
- Add engineer-by-week capacity/load/slack and contributing-ticket drill-down.
- Surface rebalancing opportunities without auto-reassigning work.

**Exit:** the user can identify overloaded engineers, available engineers, and affected epics.

### Slice 6 — Local assignment what-if scenarios

- Add planned assignment intent.
- Support temporary/persisted local reassignment scenarios.
- Recompute portfolio health and engineer load immediately.
- Clearly distinguish Jira fact from local scenario intent.

**Exit:** users can test a proposed engineer move without modifying Jira.

## 13. Acceptance criteria

### Import and lifecycle

- Selecting a board does not require selecting exactly one epic.
- A sync imports every epic matching the active rule and configured overrides.
- Pagination does not truncate epics, descendants, sprints, or board issues.
- An epic leaving active scope is archived without losing milestones or local settings.
- Reappearing epics reactivate with local intent intact.
- Manual exclusions persist across syncs.

### Capacity correctness

- Team and member capacity is calculated once per period.
- Two concurrent epics cannot each receive 100% of the same capacity.
- Portfolio load equals the sum of contributing work across epics.
- PTO, on-call, and velocity overrides affect portfolio and engineer results consistently.
- Missing estimates, targets, or schedulable capacity produce explicit incomplete states.
- Cross-epic dependencies affect eligibility and diagnostics.

### User experience

- Portfolio is the default view after a multi-epic sync.
- Every active epic has an accessible drill-down.
- Health cards explain why an epic is green/yellow/red/incomplete.
- Engineer load identifies overload, slack, epic contribution, and tickets.
- Filtering to one epic never changes or hides the shared-capacity denominator.
- Jira mode and setup readiness remain explicit.

### Compatibility

- Existing single-epic databases open without manual SQL changes.
- Existing single-epic behavior is preserved until the user switches scope mode.
- Database snapshots remain valid recovery points.
- Existing epic milestones, placements, member links, PTO, on-call, and velocity settings survive
  the migration.

## 14. Test strategy

### Engine

- Shared-capacity no-double-counting invariants.
- Several gating dates and priorities.
- Per-member overload/slack.
- PTO/on-call/velocity interactions.
- Missing estimate, missing target, unassigned work, no-capacity, and dependency-cycle diagnostics.
- Cross-epic dependencies.
- Deterministic results independent of input ordering.

### Backend

- Multi-page board and sprint reads.
- Parent-chain discovery with missing parent issues.
- Several active, inactive, excluded, and reactivated epics.
- Multi-epic mapper deduplication.
- Reconciliation preserves local intent and archives safely.
- Sync transaction rollback on partial Jira failure.
- Cache/obfuscation round-trip for multiple epics.
- Legacy database and setting migration.

### Frontend

- Portfolio ordering and completeness states.
- Explicit selection instead of `epics[0]`.
- URL/restored epic selection.
- Epic drill-down scoping.
- Shared Gantt totals under epic filters.
- Engineer-load calculations and ticket drill-downs.
- Setup preview/include/exclude behavior.

### End-to-end

- Configure a fake board containing several concurrent epics.
- Preview scope, exclude one epic, sync, and verify active/archived results.
- Add gating milestones and verify shared-capacity health.
- Verify that moving between portfolio and epic views preserves state.
- Create an overloaded engineer/week and identify the contributing epics.
- Apply a what-if assignment in Slice 6 and verify health/load changes without Jira writes.

## 15. Migration, rollout, and rollback

### Migration

- Take a database snapshot before the first multi-epic schema migration.
- Apply additive SQLite migrations on open.
- Default existing epic rows to active.
- Preserve legacy single-epic scope until explicitly changed.
- Migrate fixtures and raw-cache tooling separately from live SQLite data.

### Rollout

- Land the delivery slices in order.
- Keep existing single-epic drill-downs operational throughout.
- Introduce the portfolio overview before switching shared health calculations.
- Label factual counts versus forecast results during transitional slices.
- Do not call independent per-epic projections “portfolio health.”

### Rollback

- Restore the pre-migration database snapshot before running an older build.
- Do not sync a multi-epic database with an older single-epic importer; it may replace facts with a
  single subtree.
- Additive schema columns may remain, but scope settings and multi-epic facts require the new
  importer/reconciler for safe operation.

## 16. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Board filters do not align with project boundaries | Use the Agile board issue API as the authoritative scope. |
| Jira hierarchy differs across project styles | Resolve parent chains and test company-/team-managed shapes. |
| Missing estimates create false confidence | Represent missing estimates explicitly and block green health. |
| Independent projections double-count capacity | Make one portfolio projection the source of epic health. |
| Archived epics lose local planning data | Archive instead of deleting and preserve local intent tables. |
| Shared scheduling appears like an opaque optimizer | Use deterministic policy and return an explainable allocation trace. |
| Assignee does not equal who will actually deliver work | Separate Jira assignee facts from future local planned assignments. |
| Portfolio UI becomes too dense | Lead with health/exception summaries and retain epic drill-downs. |
| Large boards cause slow sync | Paginate, batch parent/descendant queries, cache raw results, and expose sync counts/timing. |

## 17. Decisions to confirm during implementation

The plan uses these proposed defaults; change them deliberately if real NF board behavior shows they
are wrong:

1. Active means unresolved epic plus at least one non-Done descendant in board scope.
2. Manual include/exclude overrides are local and durable.
3. Missing estimates prevent a green result.
4. Earliest gating date precedes manual epic priority in the default inferred schedule.
5. Jira assignee is the initial capacity owner; local planned assignment overrides arrive later.
6. Completed/out-of-scope epics are archived, not deleted.
7. The first release supports one board and one team.

## 18. Completion definition

This initiative is complete when a user can connect one Jira board containing several active
epics, see trustworthy shared-capacity health for each epic, identify overloaded and available
engineers, drill into the work causing risk, and test a local reassignment without modifying Jira
or double-counting team capacity.
