# Engineer Sprint Output vs Capacity — Durable Implementation Plan

**Status:** Planned

**Created:** 2026-08-28

**Last updated:** 2026-08-28 — initial repository-backed plan

**Working branch:** `plan/engineer-throughput-bandwidth`

**Scope:** add a Team-page view that compares each active engineer's current-sprint Done and In
Review points with that engineer's PTO/on-call-adjusted sprint capacity; reuse and clarify the
existing per-engineer base-velocity configuration

**Intended outcome:** make it possible to see, at a glance and without starting Standup, how many
current-sprint points are Done or In Review for each engineer compared with the points that person
was expected to have available after known availability reductions

**Constraints:** plan only; no Spec Kit/SDD; preserve flat application navigation, team-owned
capacity truth, and the existing Configuration information architecture

## 1. Outcome

Add **Sprint output** as a third in-page Team view beside **Bandwidth** and **Availability**. It
shows one compact row per active team member for the active Jira sprint:

- Done points;
- In Review points;
- Done + In Review points as a percentage of adjusted sprint capacity;
- baseline velocity and adjusted capacity;
- concise PTO, on-call, and velocity-override context that explains any reduction;
- explicit states for missing Jira links, unestimated work, unmatched assignees, unavailable Jira,
  incomplete results, and zero capacity.

The visual comparison should borrow the useful stacked Done/In Review language of the Standup
sprint opener, but it answers a different question. The Standup gauge compares whole-sprint scope
with elapsed time. This view compares work currently attributed to one engineer with that
engineer's modeled full-sprint capacity.

Do not add another Configuration page or route. Per-engineer base velocity already exists in
**Configuration → Team → Team setup → Team members**. Clarify its copy so the value is
unambiguously the expected points for a fully available sprint, before PTO, on-call, or temporary
velocity overrides.

## 2. Verified current behavior and evidence

### 2.1 Team and product boundaries

- `packages/frontend/src/components/TeamPage.tsx` currently has two local views, `bandwidth` and
  `availability`, selected through the existing compact segmented control.
- The same page already owns the selected team and an active-member picker. Its member filter can
  naturally show all engineer rows or one selected engineer without creating a new route.
- `docs/planner-product-constitution.md` defines Team data as team-owned and independent of the
  epic filter. It also requires capacity-aware views to retain total portfolio truth. Therefore the
  new progress query must use the entire active sprint, not the currently selected epic.
- Adding an in-page Team view preserves one-level navigation and does not create an epic drill-down
  or a new primary page.

### 2.2 The requested velocity configuration already exists

- `TeamMember.baseVelocity` in `packages/shared/src/domain.ts` is explicitly documented as
  baseline story points per person per sprint.
- SQLite persists it as the non-null `team_member.base_velocity` column in
  `packages/backend/src/db/schema.ts`.
- `createMember` and `updateMember` in `packages/backend/src/db/repository.ts` validate it as a
  finite number greater than or equal to zero.
- `POST /api/members` and `PUT /api/members/:id` expose those repository operations through
  `packages/backend/src/routes/config.ts`.
- `MembersSection` and `MemberRow` in `packages/frontend/src/components/Configuration.tsx` already
  create and edit the value in points per sprint. The Configuration cleanup deliberately
  consolidated member-owned controls into this one roster.
- Jira reconciliation preserves the locally tuned base velocity instead of replacing it with the
  importer's default.

The conditional “create a configuration page if it does not exist” requirement is therefore
already satisfied. A second editor would create divergent configuration surfaces and conflict with
the existing Configuration consolidation.

### 2.3 Capacity math already handles the requested reductions

- `packages/engine/src/capacity.ts` is the capacity source of truth.
- It spreads `baseVelocity` evenly over the sprint's configured working days.
- PTO sets a member's factor to zero for overlapping working days.
- On-call multiplies capacity by the configured `oncall_multiplier` for overlapping working days.
- Every active `VelocityOverride` also composes multiplicatively for its overlapping dates.
- PTO dominates on-call and velocity overrides on the same day.
- `sprintCapacity` already sums these adjusted daily values and is covered by focused unit tests.
- `packages/frontend/src/lib/gantt.ts` already obtains a per-member capacity breakdown by building a
  capacity context containing only that member. The new work should reuse the same engine
  functions rather than introduce a second PTO/on-call formula.

### 2.4 Current sprint progress cannot be derived safely from the loaded dataset

- The imported `WorkItem` has normalized status, estimate, and current assignee, but only a Boolean
  `jiraSprintAssigned`; it does not retain the authoritative sprint ID for every item.
- Jira-derived placements are created only for work that is not Done. Done items are intentionally
  removed from capacity placements, so placements cannot reconstruct completed active-sprint work.
- Filtering all loaded work by assignee or `jiraSprintAssigned` would mix current, future, and
  closed sprint history and produce a misleading numerator.
- The existing Standup opener solves the scope problem by querying Jira with
  `sprint = <id> ORDER BY Rank ASC`, excluding Epic issues, mapping statuses through
  `mapJiraStatus`, and reading the configured story-points field.
- `StandupSprintProgressItem` currently retains only `assigneeName`; reliable roster attribution
  requires Jira `accountId`, because display names are mutable and non-unique.
- The existing `/api/jira/current-sprint-assignees` route already demonstrates configured-board
  resolution, active-sprint discovery, and account-ID-based roster suggestions, but it returns
  ticket counts rather than statuses or points.

The Team view therefore needs a focused current-sprint read contract backed by Jira. It must not
approximate this metric from `DomainDataset.workItems`.

### 2.5 Existing presentation patterns

- `SprintProgressGauge.tsx` and `standupSprintProgress.ts` already define the Done and In Review
  colors, stacked progress semantics, unestimated-count handling, truncated-result warning, and
  accessible summary used in the Standup opener.
- Team uses `.panel`, `.segmented`, `.section-title`, `MemberAvatar`, compact rows, and the existing
  design tokens in `packages/frontend/src/styles.css`.
- Configuration uses `.config-row`, `.mini`, `.unit`, `.link-btn`, and a single member roster.
- Existing Team and Configuration E2E tests cover historical bandwidth behavior and narrow
  Configuration layout, but there is no Team sprint-output test today.

## 3. Product decisions, definitions, and invariants

### 3.1 Define the metric precisely

For each active team member in the active Jira sprint:

```text
recognized output points = Done points + In Review points

adjusted sprint capacity =
  sum over sprint working days of
    (base velocity / count of sprint working days)
    × PTO factor
    × on-call factor
    × every active velocity-override factor

output-to-capacity ratio = recognized output points / adjusted sprint capacity
```

Rules:

- Use the full active sprint for both numerator and denominator. Planned future PTO/on-call within
  the sprint reduces the denominator even if that date has not arrived yet.
- Count only finite, non-negative estimates. Keep zero-point estimates as estimated work with zero
  contribution. Report unestimated Done/In Review item counts separately.
- Keep Done and In Review distinct in the row and stacked visual; use their sum only for the ratio.
- Do not count To Do or In Progress points in the numerator. They may be shown in optional detail
  only if that detail remains compact and does not obscure the requested comparison.
- Do not clamp the numeric ratio. `12 / 8 = 150%` must remain visible. The bar may cap its filled
  track at 100% only if an overflow label/marker and the exact text still communicate the excess.
- When adjusted capacity is zero, show the output points and **0 pts available** without computing
  an infinite/NaN percentage.
- Round displayed capacity and points consistently to at most one decimal place while retaining
  full precision for calculations.

### 3.2 Attribution semantics

Attribute an issue to the team member whose `jiraAccountId` matches the issue's current Jira
assignee account ID at capture time. This is a snapshot of **currently assigned sprint work**, not
an audit of who performed or transitioned the work.

Use copy such as **Done / in review for currently assigned sprint work**; do not say “points
completed by” because the repository has no assignee history or status-transition author data.

- An active member without a Jira link still gets a row and adjusted-capacity value, but their work
  result is **Jira account not linked**, not zero.
- Unassigned issues, assignees not linked to this team, and issues assigned to inactive members are
  not silently dropped. Return aggregate counts/points and show one concise warning below the list.
- Do not attribute by display-name matching as a fallback.

### 3.3 Sprint and date authority

- The active Jira board sprint is authoritative for the numerator.
- Resolve the configured board ID using the same settings/fallback behavior as current-sprint
  assignee discovery. Do not select a sprint solely from the local calendar date when Jira reports
  a different active sprint.
- Use Jira's active sprint ID/name and its ISO date portions for the capacity window.
- If Jira omits sprint dates, fall back only to a locally stored `Sprint` with the same Jira sprint
  ID. Mark the date source in the response so the UI can explain the fallback.
- If neither source provides a complete date range, return the point aggregates but mark adjusted
  capacity and ratio unavailable. Do not silently substitute the cadence-derived current sprint,
  which may not align with Jira.
- Enumerate working days with the team's configured `workingDays`; PTO/on-call on weekends or other
  non-working days does not reduce capacity.

### 3.4 Status and issue scope

- Query the active sprint directly and exclude Epic issue types, matching the Standup opener.
- Normalize Jira status using the existing `mapJiraStatus`; in particular, a status whose name
  contains “review” maps to In Review before the broader status-category mapping.
- The word “stories” in the request is treated as the opener's current **non-Epic sprint items**
  contract. Restricting the result to Jira issue type `Story` would be a product change because the
  opener currently counts tasks, bugs, and subtasks too.
- If product intent later requires Story-only counting, change the shared Jira selector and the UI
  label together; do not quietly diverge this view from Standup.

### 3.5 Product-scope and interpretation guardrails

- The epic filter never changes the active sprint query, member roster, capacity, totals, or
  warnings. Team retains whole-team truth.
- The selected engineer picker may reduce visible rows but must not change aggregates or trigger a
  narrower Jira query.
- Present the result as a planning/capacity signal, not an individual performance rating. Do not
  assign red/yellow/green “good/bad” status based only on the ratio; work can be collaborative,
  reassigned, unestimated, or intentionally carried over.
- Keep Bandwidth as the default Team view. Fetch Jira sprint output only when **Sprint output** is
  selected, avoiding an unnecessary remote request for users opening the calendar.
- Switching among Team views preserves their local month/member state. Switching teams invalidates
  the sprint-output request and data for the prior team.

## 4. Read contract and backend design

### 4.1 Shared response types

Add a focused aggregate contract near the existing sprint-progress types in
`packages/shared/src/domain.ts`. Exact names may be adjusted, but the response must preserve these
semantics:

```ts
export interface EngineerSprintOutput {
  memberId: string;
  baseVelocity: number;
  adjustedCapacity: number | null;
  donePoints: number;
  inReviewPoints: number;
  unestimatedDoneOrReviewItems: number;
  matchedSprintItems: number;
  availability: {
    ptoWorkingDays: number;
    oncallWorkingDays: number;
    velocityOverrideWorkingDays: number;
  };
  jiraLinked: boolean;
}

export interface TeamSprintOutput {
  teamId: string;
  sprint: {
    id: string;
    name: string;
    startDate: IsoDate | null;
    endDate: IsoDate | null;
    dateSource: 'jira' | 'stored' | 'unavailable';
  } | null;
  capturedAt: string;
  freshness: 'fresh' | 'unavailable';
  truncated: boolean;
  errorMessage: string | null;
  engineers: EngineerSprintOutput[];
  unattributed: {
    itemCount: number;
    estimatedDoneOrReviewPoints: number;
    unestimatedDoneOrReviewItems: number;
  };
}
```

Do not serialize the ratio; derive it from returned point and capacity values so there is one
obvious calculation and no risk of stale redundant fields. Member name/avatar also remain sourced
from the loaded `DomainDataset`, keyed by stable `memberId`.

If implementation needs more diagnostic detail, extend the aggregate with non-sensitive counts or
an enumerated reason. Do not return Jira issue summaries/keys when the UI only needs aggregates.

### 4.2 Endpoint

Add:

```http
GET /api/teams/:teamId/current-sprint-output
```

Behavior:

1. Validate that the team exists; return `404` for an unknown team.
2. Read board, project, Sprint-field, and story-points-field settings through the same JSON-safe
   helpers used by Jira discovery.
3. Resolve the configured board and active sprint. A missing board, active sprint, or points mapping
   returns HTTP `200` with `freshness: "unavailable"`, an explanatory `errorMessage`, and engineer
   capacity rows where the available local data permits them.
4. Query all non-Epic active-sprint issues with the fields needed for status, estimate, issue type,
   and assignee. Reuse/refactor `refreshStandupSprintProgress` rather than duplicating pagination,
   timeout, estimate parsing, and status normalization.
5. Include assignee `accountId` in the internal/shared sprint item mapping. Keep `assigneeName` for
   existing Standup display compatibility, but never use it as the join key.
6. Map issues to members by `team_member.jira_account_id`, aggregate the requested point buckets,
   and separately aggregate unattributed work.
7. Build one-member capacity contexts using `@ecp/engine` with only date ranges belonging to that
   member and the effective configured on-call multiplier. Calculate the full active-sprint
   capacity with the existing daily factors.
8. Return active members in deterministic case-insensitive name order. The response includes all
   active members even when they have no matched sprint items.

Place the orchestration in a focused backend module such as
`packages/backend/src/jira/team-sprint-output.ts` and a small route module such as
`packages/backend/src/routes/team-sprint-output.ts`, registered from `server.ts`. Refactor narrow
board/sprint or sprint-progress helpers out of `routes/jira.ts`/`standup-context.ts` when needed;
do not expand either already dense file with a second copy of the same logic.

### 4.3 Fetching, caching, and completeness

- Reuse the configured `JiraClient`, so normal process-local request caching and in-flight
  coalescing continue to apply without a new cache layer.
- Add a route-level in-flight map keyed by `teamId` if the endpoint performs multiple Jira calls and
  can otherwise duplicate the same aggregate request.
- Paginate deterministically. Use a documented high safety cap rather than the opener's current
  100-item ceiling if necessary for team-wide accuracy.
- If the cap is reached, set `truncated: true`. The UI may show partial bucket numbers, but it must
  suppress the percentage/ratio and clearly say the Jira result is incomplete.
- This slice adds no persistent snapshot table. A Jira failure produces an explicit unavailable
  state rather than presenting an old value as current. Process cache hits are still marked fresh
  within the configured cache TTL.
- A manual **Retry** action reissues the endpoint. It need not bypass the shared Jira TTL unless the
  app establishes that behavior globally; do not invent a Team-only cache invalidation policy.

### 4.4 Database and migration impact

No schema migration or data backfill is required:

- member velocity, Jira account link, PTO, on-call, velocity overrides, sprints, and settings already
  persist all local inputs;
- the new result is a read-time Jira aggregate;
- no Jira content is written and no progress snapshot is stored in this slice.

## 5. Frontend state and component design

### 5.1 Team-page integration

Extend `TeamView` in `packages/frontend/src/components/TeamPage.tsx` to
`'bandwidth' | 'availability' | 'sprint-output'` and add **Sprint output** to the existing segmented
control.

Extract the new panel into `packages/frontend/src/components/EngineerSprintOutput.tsx` so the
already dense calendar page remains orchestration-focused. `TeamPage` supplies:

- the selected team and full team member list;
- the existing selected-member filter;
- whether the frontend is connected to the API;
- the response/load/error state or the information needed for the child to load it.

The component should fetch when first selected, retain the successful result while the same team
remains selected, and ignore/abort late responses after a team change or unmount. A Retry action
replaces the current result only after the matching request resolves.

Add `getCurrentSprintOutput(teamId)` to `packages/frontend/src/data/api.ts`.

### 5.2 Row presentation

Use one quiet primary `.panel` with a compact heading:

- **Sprint output — Sprint 42**;
- date range;
- captured/refresh state;
- one-sentence definition: **Done and In Review points for currently assigned work compared with
  PTO/on-call-adjusted sprint capacity.**

Render rows with:

- `MemberAvatar` and engineer name;
- exact text such as **6 Done + 2 In Review / 8.5 available pts · 94%**;
- a stacked Done/In Review bar using the existing semantic colors and color-independent labels;
- baseline context such as **10 base → 8.5 available** when adjusted;
- compact adjustment badges/counts for PTO, on-call, and overrides when they changed capacity;
- an unestimated-item note when applicable.

Do not turn each row into a large independent card. Reuse the existing panel/row geometry, quiet
borders, `--panel-2` only when a nested surface is necessary, and the current 13px body scale. Add a
shared gauge primitive only if both Standup and Team can use it without weakening either contract;
otherwise reuse tokens and semantics rather than forcing one component to handle unrelated
denominators.

### 5.3 Empty, partial, and unavailable states

- **No active sprint:** show a calm empty state; do not show zero ratios.
- **Jira unavailable/not configured:** retain local capacity context where available, explain why
  sprint output is unavailable, and offer Retry when useful.
- **Member not linked:** show adjusted capacity plus **Link this member to Jira in Configuration**;
  do not render Done/In Review as zero.
- **No matched items for a linked member:** show genuine zero output against capacity.
- **Zero capacity:** show point totals and **0 pts available** without a percentage.
- **Unestimated recognized work:** show the item count beside the point total and explain that it is
  excluded from the ratio.
- **Truncated result:** show a warning, label totals partial, and hide the ratio/gauge comparison.
- **Unattributed work:** show one aggregate note below the rows; do not expose a second pseudo-member
  with invented capacity.
- **Read-only bundled sample mode:** show an explicit “Live Jira sprint output requires the backend”
  state. Do not synthesize current-sprint completion from the fixture's incomplete sprint links.

### 5.4 Configuration clarification

Keep velocity editing in `MembersSection`/`MemberRow` in `Configuration.tsx` and make only a focused
copy/label refinement:

- section hint: **Expected points per fully available sprint; PTO, on-call, and temporary overrides
  adjust this baseline in capacity views.**
- add-member label: **Base velocity (pts/sprint)**;
- existing row unit remains `pts/sprint`, with an accessible label that includes the member name.

Do not create configuration subtabs, a nested route, a duplicate velocity table, or a new setting.
The existing create/update endpoints remain the only persistence path.

### 5.5 Accessibility and responsive behavior

- Use a real tab/tabpanel relationship for the expanded Team segmented control, or preserve the
  repository's existing tab semantics consistently if that broader correction is out of scope.
- Give every engineer row a complete accessible summary including Done points, In Review points,
  adjusted capacity, percentage when valid, and excluded unestimated items.
- Bars are supplemental `role="img"` visuals with an accessible label, never the only source of
  numbers or state.
- Do not rely on green/yellow/red judgment colors. Done/In Review colors must also have visible text
  labels.
- Retry is a native button with busy/disabled text. Loading and errors use appropriate polite
  status/alert regions without stealing focus.
- At narrow widths, place the avatar/name and exact totals above the full-width bar; wrap adjustment
  badges below. Avoid horizontal scrolling and do not compress names or numbers into unreadable
  columns.
- Verify default, hover, focus-visible, loading, empty, error, zero-capacity, overflow, and partial
  states at desktop and approximately 390px width.

## 6. Ordered implementation slices

### Slice 1 — Generalize and test the Jira sprint-progress fetch

Target seams:

- `packages/shared/src/domain.ts`
- `packages/backend/src/jira/standup-context.ts` or a new shared sprint-progress module
- existing Standup sprint-progress tests and route tests

Work:

1. Add stable assignee account ID to sprint-progress items.
2. Extract/reuse the common pagination and mapping path without changing the Standup opener's
   current response behavior.
3. Cover estimate parsing, Review normalization, Epic exclusion, account IDs, pagination, timeout,
   and truncation.

Exit condition: Standup continues to pass unchanged while the shared fetch can support stable
per-member aggregation.

### Slice 2 — Add the current-sprint output aggregate endpoint

Target seams:

- new `packages/backend/src/jira/team-sprint-output.ts`
- new `packages/backend/src/routes/team-sprint-output.ts`
- `packages/backend/src/server.ts`
- `packages/frontend/src/data/api.ts`
- backend route/module tests using `FakeJiraClient`

Work:

1. Resolve team, configured board, active sprint, mapped points field, and sprint dates.
2. Fetch and aggregate Done/In Review points by Jira account ID.
3. Calculate adjusted full-sprint member capacity with the engine.
4. Return all active members plus explicit unattributed/unavailable/partial metadata.
5. Coalesce concurrent requests and keep errors scoped to the response contract.

Exit condition: a read-only API test proves that PTO and on-call reduce the correct engineer's
denominator while Done/In Review attribution remains tied to Jira account ID.

### Slice 3 — Add pure frontend derivation and the Team view

Target seams:

- new `packages/frontend/src/lib/engineerSprintOutput.ts`
- new `packages/frontend/src/components/EngineerSprintOutput.tsx`
- `packages/frontend/src/components/TeamPage.tsx`
- `packages/frontend/src/styles.css`
- focused frontend unit tests

Work:

1. Derive display ratios, rounding, overflow, zero-capacity, and accessible summaries in a pure
   helper.
2. Add the third Team view and lazy request lifecycle.
3. Apply the existing engineer picker to visible rows without changing the API aggregate.
4. Render populated, linked/unlinked, empty, partial, and unavailable states.
5. Add compact responsive styles using existing tokens and row/gauge conventions.

Exit condition: the view is keyboard-usable and truthful for ratios below, at, and above 100%, and
for a member with no capacity or Jira link.

### Slice 4 — Clarify configuration semantics and add end-to-end coverage

Target seams:

- `packages/frontend/src/components/Configuration.tsx`
- `packages/frontend/e2e/configuration.spec.ts`
- new `packages/frontend/e2e/team-sprint-output.spec.ts`

Work:

1. Clarify the existing base-velocity label/help without creating another editor.
2. Mock the aggregate endpoint and verify all-team/member-filter rendering.
3. Verify retry and unavailable/partial behavior.
4. Verify desktop and narrow layout for Team and the updated Configuration copy.

Exit condition: E2E coverage proves discoverability of the existing velocity editor and the new
Team comparison.

## 7. Failure, concurrency, security, and observability

### Failure and data quality

- Missing Jira configuration, no active sprint, missing sprint dates, missing points mapping, Jira
  timeout, and request truncation are distinct states with specific copy.
- Never translate unavailable data into zero output or zero capacity.
- Never treat an unestimated item as zero estimated effort without also counting it as unestimated.
- Do not render a ratio when the Jira result is truncated or the capacity denominator is unknown.
- Keep the last successful response visible only while refreshing the same team; label it as
  refreshing. On a failed replacement request, either retain it with an explicit stale/error banner
  or clear it according to one consistent component policy. Do not silently display old data as
  fresh.

### Concurrency

- Coalesce simultaneous backend reads for the same team.
- Key frontend requests by team ID and ignore/abort late responses after the user switches teams.
- Capacity configuration changes continue through the existing member/settings APIs. Dataset reload
  invalidates the Team aggregate so a subsequent visit/refresh uses the new velocity or availability.
- This is a read-only derived view; no optimistic locking or transaction is required.

### Security and privacy

- Jira access remains read-only and server-side. Never expose credentials, request headers, or raw
  Jira responses to the browser.
- Build Jira queries only from validated numeric sprint IDs; do not interpolate user-provided JQL.
- Return aggregates, stable member IDs, and non-sensitive diagnostics rather than issue summaries or
  unnecessary personnel details.
- Logs and debug events may include team ID, sprint ID, counts, freshness, and duration, but not
  ticket titles, notes, credentials, or Jira response bodies.

### Observability

- Record or log endpoint duration, Jira/cache outcome where available, returned item count,
  unattributed count, truncation, and unavailable reason.
- Preserve the existing Jira request-cache event mechanism rather than adding a parallel cache log.
- Frontend errors remain inside the Sprint output panel and do not replace Bandwidth or
  Availability content.

## 8. Verification plan

Before every Node/npm command, run `nvm use` from the repository root.

### Automated verification

Engine/backend unit and route coverage:

- full availability keeps adjusted capacity equal to base velocity;
- one PTO working day reduces only the matching member by one daily share;
- full-sprint on-call applies the configured multiplier;
- PTO dominates overlapping on-call and velocity overrides compose multiplicatively;
- weekends/non-working days do not reduce capacity;
- Done and In Review points aggregate separately and sum for the ratio;
- To Do and In Progress are excluded from recognized output;
- unestimated Done/In Review items are counted but excluded from points;
- account ID, not display name, selects the member;
- unassigned/unmatched/inactive-assignee work enters the unattributed aggregate;
- members without Jira links remain in the response;
- active sprint dates prefer Jira and fall back only to stored matching sprint dates;
- missing active sprint/config/dates returns a structured unavailable response;
- truncated input suppresses an authoritative ratio in the frontend;
- concurrent same-team requests are coalesced;
- Standup sprint-progress behavior remains compatible after helper extraction.

Frontend unit coverage:

- rounding and ratios below/equal/above 100%;
- zero and unavailable capacity;
- linked zero-output versus unlinked unknown-output distinction;
- partial/truncated response behavior;
- accessible summaries include exact Done, In Review, capacity, and unestimated counts.

End-to-end coverage:

- Team → Sprint output shows all active members and correct stacked values;
- the existing engineer picker narrows visible rows without making another API request;
- PTO/on-call-adjusted capacity and baseline context render clearly;
- retry/loading/unavailable/unattributed warnings are usable;
- the epic filter does not alter results;
- Configuration still has exactly one member roster and saves base velocity;
- 390px layout has no horizontal overflow and preserves readable totals/controls.

Suggested commands after implementation:

```bash
nvm use
npm run typecheck
npm test
npm run build
npm run e2e --workspace @ecp/frontend -- --grep "sprint output|configuration"
```

### Manual verification

1. Configure two active members with different base velocities and Jira links.
2. Add PTO for one working day, an on-call span for several working days, and optionally a velocity
   override inside the active sprint.
3. Open Team → Sprint output with no epic selected. Confirm both engineers appear, exact Done/In
   Review totals match Jira, and only the affected member's capacity is reduced.
4. Select an epic globally. Confirm the Team values do not change.
5. Select one engineer in the Team picker. Confirm the display narrows while totals/source state do
   not refetch or change.
6. Test a member with no Jira link, a linked member with no recognized work, a fully-PTO/zero-capacity
   member, an unestimated Done item, and output above capacity.
7. Disconnect or misconfigure Jira and confirm the panel explains the unavailable state without
   showing false zeroes; restore it and Retry.
8. At desktop and 390px widths, inspect populated, empty, loading, error, focus-visible, partial,
   overflow, and adjustment states.
9. Open Configuration and confirm the one existing Team members roster describes base velocity as
   the pre-availability points-per-sprint baseline and still saves correctly.

## 9. Acceptance criteria

- Team contains a discoverable **Sprint output** in-page view without adding a primary page, nested
  route, or epic drill-down.
- Every active member is represented, or the existing engineer picker shows the selected member.
- Each linked member's Done and In Review points come from the authoritative active Jira sprint and
  join by Jira account ID.
- The comparison denominator starts with that member's existing `baseVelocity` and correctly applies
  sprint working days, PTO, the configured on-call multiplier, and velocity overrides through the
  existing capacity engine.
- Exact Done, In Review, adjusted-capacity, and ratio values remain readable without relying on bar
  color; ratios above 100% and zero capacity are truthful.
- Missing links, unestimated work, unmatched work, no active sprint, missing mappings/dates, Jira
  failures, and truncated results cannot masquerade as valid zeroes or complete ratios.
- Epic selection does not change Team roster, Jira scope, progress values, capacity, or aggregates.
- The existing Configuration Team-member roster remains the only base-velocity editor and clearly
  identifies velocity as points per fully available sprint before availability adjustments.
- No database migration or Jira write is introduced.
- Shared/backend/frontend tests, typecheck, build, focused E2E, and desktop/narrow visual review pass.

## 10. Explicit non-goals

- Historical per-engineer trend reporting or completed-sprint comparisons.
- An employee-performance score, ranking, leaderboard, target color, or alert based on the ratio.
- Historical assignee/transition attribution or claiming who personally completed an issue.
- Changing Jira issue status, estimate, assignee, sprint membership, or any other Jira data.
- Counting only one epic or changing the ratio when the epic filter changes.
- Replacing Bandwidth feelings or merging self-reported workload with delivery output.
- New velocity tables/settings, a second member editor, or a nested Configuration route.
- Automatic velocity calibration from observed output.
- Persistent sprint-output snapshots, notifications, exports, or external telemetry in this slice.

## 11. Assumptions and unresolved decisions

### Accepted implementation assumptions

- “Completed/in review stories” means all non-Epic Jira items included by the existing Standup
  sprint-progress selector, not only Jira issue type `Story`.
- “Allocated bandwidth” means modeled full-sprint capacity from base velocity after known PTO,
  on-call, and velocity overrides; it does not mean points assigned/planned to that person.
- Current Jira assignee is the only available attribution contract.
- Active team members are the primary roster. Work assigned to inactive or unknown people is
  disclosed only in the unattributed aggregate.

### Product decisions to revisit only if these assumptions are wrong

- If the desired numerator is Story-only, define how parent Story points and child Task/Subtask
  points avoid double counting before implementation.
- If “allocated” means planned assigned points rather than available capacity, this is a different
  metric and requires authoritative per-item sprint placement for Done work; do not substitute it
  into this plan without revising the API and acceptance criteria.
- If historical “who completed it” attribution is required, Jira changelog/history access and its
  privacy/performance implications need a separate plan.

## 12. Continuation instructions

**Current status:** planning complete; no application code, schema, or tests have been changed.

**Next action:** implement Slice 1 by adding stable assignee account IDs to the shared sprint-progress
fetch while keeping the Standup opener compatible, then add focused tests before building the Team
aggregate endpoint.

**First files to inspect:**

1. `packages/shared/src/domain.ts`
2. `packages/backend/src/jira/standup-context.ts`
3. `packages/backend/src/routes/jira.ts`
4. `packages/backend/src/routes/standup.ts`
5. `packages/engine/src/capacity.ts`
6. `packages/frontend/src/components/TeamPage.tsx`
7. `packages/frontend/src/components/SprintProgressGauge.tsx`
8. `packages/frontend/src/components/Configuration.tsx`
9. `packages/frontend/src/styles.css`

**Initial discovery commands:**

```bash
rg -n "StandupSprintProgress|current-sprint-assignees|refreshStandupSprintProgress" packages
rg -n "baseVelocity|memberDayFactor|sprintCapacity|oncallMultiplier" packages
rg -n "TeamView|TeamMemberPicker|MembersSection|MemberRow" packages/frontend/src
```

Keep this document current as each slice lands: update Status/Last updated, mark slice completion,
record any contract changes or newly discovered limitations, and leave the next exact action here
before ending work.
