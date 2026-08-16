# Standup Ticket Refresh Reliability — Durable Fix Plan

**Status:** Implemented; manual validation pending

**Created:** 2026-08-16

**Scope:** fix the Standup modal's indefinitely spinning in-progress-ticket panel without broad Jira syncs or changes to standup progression semantics

**Parent plan:** [`standup-facilitation-plan.md`](./standup-facilitation-plan.md)

## 1. Outcome

When a standup opens, the current participant's saved ticket snapshot appears immediately when one exists, while a targeted Jira refresh runs in the background. The next participant is prefetched independently. Every request reaches a terminal fresh, stale, empty, or unavailable state within a bounded time; no participant remains on **Refreshing** indefinitely.

The fix must remain correct under React Strict Mode, modal close/reopen, participant advancement, refresh failure, and a Jira request that never answers. Ticket loading must never disable **Next** or **Skip**.

## 2. Verified current behavior and root cause

### 2.1 Request contract

The frontend currently refreshes a participant with:

```text
POST /api/standups/:sessionId/participants/:memberId/tickets/refresh
```

The backend performs a targeted Jira search equivalent to:

```text
sprint = <active sprint id>
AND assignee = "<participant Jira account id>"
AND statusCategory = "In Progress"
ORDER BY Rank ASC
```

This is the correct scope. Do not replace it with a full Jira dataset refresh or planner reconciliation.

### 2.2 Evidence

- Direct refreshes for pending participants completed as cache hits in roughly 2 ms during investigation.
- The underlying Jira search completed in roughly 380–524 ms and returned fresh contexts, including three tickets for one tested participant and an empty result for another.
- The backend therefore was not hanging in the observed failure.
- `packages/frontend/src/main.tsx` enables React `StrictMode`.
- `packages/frontend/src/components/RunStandupPage.tsx` records participant IDs in `requestedTicketMembers` before requests complete, batches the current and next participant in `Promise.all`, and publishes results only while an effect-local `active` flag remains true.

### 2.3 Root cause

React Strict Mode runs the effect, its cleanup, and the effect again in development. The first run marks both member IDs as requested. Cleanup sets its `active` flag to false. The second run sees those IDs in the permanent requested set and attaches to nothing. When the original requests resolve, their results are discarded because the first effect is inactive. No context enters React state, so the UI stays on **Refreshing** forever.

`Promise.all` is a second defect: even outside Strict Mode, a slow prefetch for the next participant prevents the already-completed current participant result from rendering.

The backend HTTP Jira client also has no bounded request timeout, so an actual network stall could still produce the same user-visible symptom after the frontend lifecycle bug is fixed.

## 3. Product and engineering invariants

- Load only the current participant and at most the next participant.
- Keep current and next refreshes independent; one cannot block the other.
- Prefer a persisted snapshot immediately, then revalidate in the background.
- Preserve a last-known-good snapshot when refresh fails and label it stale.
- Show explicit empty, stale, and unavailable states; never equate missing data with an empty ticket list.
- Keep **Next**, **Skip**, close, and reopen functional during ticket loading or failure.
- Do not mutate Jira, assignments, sprint scope, or the planner dataset.
- Do not log ticket summaries, note bodies, credentials, or raw Jira responses merely to diagnose timing.

## 4. Target state model and lifecycle

Replace the permanent `Set<string>` guard with a modal-scoped request coordinator keyed by participant ID. Each entry should represent both display data and in-flight work:

```ts
type TicketLoadState =
  | { status: 'idle'; context: null }
  | { status: 'loading'; context: StandupMemberTicketContext | null }
  | { status: 'fresh'; context: StandupMemberTicketContext }
  | { status: 'stale'; context: StandupMemberTicketContext; errorMessage?: string }
  | { status: 'unavailable'; context: null; errorMessage: string };
```

The coordinator may keep a promise beside this UI state, but the promise is not the state itself.

### 4.1 Opening or resuming the modal

For the current and next participant, independently:

1. Fetch `GET /api/standups/:sessionId/participants/:memberId/tickets` for a persisted snapshot.
2. Render any saved context immediately, including its captured time and freshness.
3. Start or reuse exactly one in-flight targeted refresh for that session/member.
4. Publish each refresh result as soon as it settles; do not wait for the other participant.
5. On success, replace the snapshot with the fresh result.
6. On failure or timeout, retain an existing usable snapshot as stale; otherwise render unavailable.

The snapshot read and refresh may begin concurrently, but a late snapshot must not overwrite a newer refresh result. Compare a request generation or captured timestamp before publishing.

### 4.2 Strict Mode and lifecycle safety

- `ensureRefresh(memberId)` returns the same in-flight promise to every caller.
- A Strict Mode effect rerun attaches a new subscriber to that promise instead of treating the participant as permanently handled.
- Effect cleanup prevents obsolete UI publication; it must not invalidate shared in-flight work needed by the immediate rerun.
- Guard writes by session ID and a modal request generation so a response from a closed or replaced session cannot update the new session.
- Remove a failed promise from the in-flight map so a deliberate retry or later reopen can try again.
- Keep a successful context reusable while that modal/session is active.

Use stable scalar effect dependencies such as `sessionId`, `currentMemberId`, and `nextMemberId`; do not depend on a newly allocated `pending` array.

### 4.3 Participant advancement

- If the next participant's refresh is complete, promote its existing state without another request.
- If it is still loading, display its snapshot/loading state and keep the same promise.
- Begin snapshot/revalidation for the newly adjacent next participant.
- Evict entries only when they are no longer useful or when the session changes; avoid unbounded accumulation while preserving back-navigation/reopen behavior within the session.

### 4.4 Bounded Jira behavior

Add a configurable timeout to the standup Jira request path. Prefer passing an `AbortSignal` through the Jira client so the underlying fetch is cancelled, rather than only racing an uncancelled promise. The timeout must:

- return a typed unavailable/stale result within a defined bound;
- distinguish timeout from ordinary empty results;
- release in-flight coordinator state so retry remains possible;
- preserve the last successful persisted snapshot instead of overwriting it with an empty failure record.

Choose the exact default from existing backend configuration conventions. If none exists, start with 10 seconds and document the environment override.

## 5. Implementation slices

### Slice 1 — Frontend coordinator and independent publication

Primary seams:

- `packages/frontend/src/components/RunStandupPage.tsx`
- optionally a focused hook/module such as `packages/frontend/src/hooks/useStandupTicketContexts.ts`
- `packages/frontend/src/data/api.ts`

Work:

1. Add a typed API method for the existing snapshot `GET` endpoint.
2. Extract ticket loading from the modal component into a small coordinator/hook with per-member state and deduplicated promises.
3. Remove `requestedTicketMembers` and `Promise.all`.
4. Load current and next independently and publish them independently.
5. Model loading-with-snapshot separately from loading-without-data so the UI can show usable stale content during revalidation.
6. Add a restrained refresh indicator and terminal stale/unavailable messaging without blocking the modal controls.

Exit condition: under Strict Mode, current and next each make at most one refresh request per in-flight cycle, and either can render before the other.

### Slice 2 — Backend timeout and last-known-good fallback

Primary seams:

- `packages/backend/src/jira/http-client.ts` or the current shared Jira request abstraction
- `packages/backend/src/jira/standup-context.ts`
- `packages/backend/src/routes/standup.ts`
- `packages/backend/src/db/standup.ts`

Work:

1. Thread a bounded abort signal through the targeted standup Jira request.
2. Map timeout/network failures to an explicit failure result.
3. Read the previous persisted member context before refresh publication.
4. On failure, return the last-known-good context marked stale when available; do not destroy it by persisting an empty unavailable context over it.
5. Return unavailable only when no usable snapshot exists.

Exit condition: the endpoint finishes within the configured bound and never erases a prior successful snapshot because Jira is temporarily unavailable.

### Slice 3 — Regression coverage and operational feedback

Primary seams:

- frontend hook/component tests near the standup feature
- `packages/backend/src/jira/standup-context.test.ts` or the repository's equivalent test location
- existing Standup end-to-end coverage

Add deterministic tests for:

- Strict Mode effect setup → cleanup → setup with one in-flight request;
- current participant resolving before the next participant;
- next participant failure not delaying current participant display;
- snapshot-first rendering followed by fresh replacement;
- a late snapshot not overwriting a newer refresh;
- advancing promotes the prefetched participant and starts only the new neighbor;
- failure releases the request for retry;
- close/session replacement ignores late publication;
- timeout reaches a terminal state;
- failure retains last-known-good persisted data;
- no snapshot plus failure renders unavailable;
- **Next** and **Skip** remain enabled during loading and failure.

Add privacy-safe timing feedback only where useful: request phase, duration, terminal outcome, session/member opaque IDs, and timeout classification. Avoid raw response bodies and ticket text.

Exit condition: automated coverage reproduces the original Strict Mode hang before the fix and passes after it.

## 6. Verification

Run repository commands only after selecting the declared Node version from the repository root:

```bash
nvm use
npm --workspace @ecp/frontend run typecheck
npm --workspace @ecp/frontend run test
npm --workspace @ecp/backend run test
```

Use the repository's narrower standup test targets if the package scripts differ; record the exact successful commands here during implementation.

Manual validation with Jira sync mode:

1. Open Standup with browser developer tools on the Network panel.
2. Confirm the current participant shows a saved snapshot immediately when one exists and a subtle refresh state while revalidating.
3. Confirm current and next issue separate targeted refresh requests.
4. Throttle one request and verify the other participant's completed context is not held back.
5. Advance and confirm the prefetched participant appears without a duplicate refresh.
6. Simulate offline/timeout behavior and confirm stale or unavailable appears within the timeout bound.
7. Verify **Next**, **Skip**, close, and reopen remain usable throughout.
8. Confirm no full Jira sync/reconciliation request is triggered.

## 7. Acceptance criteria

- No participant remains on **Refreshing** after its request succeeds, fails, or times out.
- React Strict Mode does not discard the only subscriber to in-flight results.
- Current and next participant results render independently.
- At most one request per session/member is in flight at a time.
- Successful prefetch is reused on advancement.
- A previous successful snapshot survives transient refresh failure.
- A Jira stall terminates within the documented timeout.
- Loading and failure never block standup progression.
- Tests cover the original lifecycle race and the timeout/fallback paths.

## 8. Continuation record

**Current status:** frontend request coordination, snapshot-first rendering, independent current/next publication, bounded backend refreshes, and stale-snapshot fallback are implemented. Automated type checks and the backend server regression suite pass.

**Next action:** manually validate the live Jira flow, then add focused deferred-promise UI coverage if the feature test harness is extended.

**Start here:**

1. `packages/frontend/src/components/RunStandupPage.tsx`
2. `packages/frontend/src/data/api.ts`
3. `packages/backend/src/routes/standup.ts`
4. `packages/backend/src/jira/standup-context.ts`
5. `packages/backend/src/jira/http-client.ts`

Update this section and each slice's status as work proceeds. Record any changed contract or newly discovered cause in this file so implementation can resume without conversation history.
