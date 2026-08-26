# Post-Standup Intake Requests — Durable Implementation Plan

**Status:** Planned; implementation not started

**Created:** 2026-08-26

**Branch:** `plan/post-standup-intake-requests`

**Scope:** add a Jira-backed list of current Technician Experience intake requests to the editable
post-standup stage, prefetch that list while the team round is running, provide a pane-local Sync
action, and optionally persist when the team became aware of a listed request

**Intended outcome:** by the time the facilitator reaches post-standup, the current
`tech-exp-intake` Jira requests are normally ready to review. The facilitator can refresh the pane
after making Jira changes in another tab and may, but is never required to, record the awareness
date, confidence in that date, and supporting notes for a specific request.

## 1. Product decisions and boundaries

### 1.1 Decisions for this plan

- **Current intake request** means any Jira issue visible to the configured Jira credentials with
  the label `tech-exp-intake` and a status category other than Done. The initial JQL is:

  ```text
  labels = "tech-exp-intake" AND statusCategory != Done ORDER BY updated DESC, key ASC
  ```

  Do not add the configured planning project or board as an implicit constraint: the request says
  all current labeled tickets, and the normalized planner dataset may omit issues outside its
  imported epic hierarchy.
- Render the feature only in the editable `post_standup` stage. Do not add a live/current Jira list
  to completed historical standups; a historical intake-report view is explicitly deferred.
- Preserve the existing post-standup notes, Required people summary, note composer, and Finish
  Standup footer. Add the intake list as a peer pane; do not replace or subordinate the existing
  workflow.
- Start the intake refresh as soon as the standup modal opens for an active session. It is
  background enrichment: it must not delay session creation, participant progression, bandwidth
  saving, note saving, closing/reopening, or finishing.
- The pane's **Sync** action refreshes only this focused intake query. It must not call the global
  planner `POST /api/sync`, reconcile the DomainDataset, or change Jira.
- Launch **Log incoming request** from an individual intake row. The selected Jira key is implicit
  form context and is persisted with the entered values.
- Store at most one awareness record per Jira key. This represents when the team first became aware
  of that request, not a recurring standup event. A duplicate create returns a conflict instead of
  silently overwriting the original evidence. The list may expose only a `logged`/not-logged state;
  displaying or editing the saved date, confidence, and notes is deferred.
- The logging mechanism is optional. No awareness record, incomplete form, or failed save may
  disable or intercept **Finish Standup**.

### 1.2 Assumptions to revisit only if product intent changes

- Jira's status category is the durable definition of current, rather than a configured list of
  status names.
- Jira credentials have permission to search every project in the desired intake scope. “All” is
  bounded by those Jira permissions.
- The date and confidence are required when a record is submitted; **Other notes** is optional.
- The awareness date cannot be after the standup date from which it is logged. This permits
  backdating but prevents a future-awareness value and avoids server-local timezone ambiguity.
- `high`, `medium`, and `low` are the complete initial confidence vocabulary.

If any of these assumptions is rejected during implementation, update this document before
changing the contracts below.

### 1.3 Invariants

- Standup remains team-scoped and independent of the global epic filter, consistent with
  [`planner-product-constitution.md`](./planner-product-constitution.md). This feature introduces no
  navigation, route, or epic-scope change.
- Jira access is read-only. Assignment and other ticket changes happen in Jira, in another tab.
- A failed refresh never replaces a last-known-good session snapshot with an empty failure result.
- Empty, loading, refreshing-with-data, stale, unavailable, and genuinely empty results are
  distinct states.
- Jira issue keys and source display fields are untrusted external data and are rendered as text;
  notes are stored and rendered later as plain text, never HTML.
- Intake snapshots and awareness records live outside DomainDataset replacement so a planner sync
  cannot erase locally captured history.

### 1.4 Non-goals

- Creating, editing, assigning, or transitioning Jira tickets.
- Adding intake tickets to the imported capacity model, epics, stories, or work items.
- Viewing or editing the saved awareness date, confidence, or notes after submission.
- Reporting, analytics, dashboards, notifications, or SLA calculations from awareness records.
- A completed-standup intake-history view.
- Making awareness logging mandatory or part of the standup revision/finalization transaction.
- Changing primary navigation, routing, epic filtering, or portfolio capacity behavior.

## 2. Verified current behavior and evidence

The following findings are verified against the repository on 2026-08-26.

### 2.1 Post-standup presentation

- [`RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx) owns standup launch,
  the modal, the active team round, post-standup, and completed history.
- Active standup renders `TeamRound`; all other stages currently render the same full-width `Notes`
  component. The `post_standup` variant adds `RequiredPeople`, retains the note list/composer, and
  shows **Finish Standup** in a separate modal footer.
- The modal is already approximately `min(1200px, calc(100vw - 32px))`; active-round layout becomes
  a single column below 700px. The full post-standup body does not yet have its own two-pane layout.
- [`styles.css`](../packages/frontend/src/styles.css) contains the established `.panel`, `.btn`,
  `.link-btn`, `.control`, `.badge`, modal, standup, focus, and responsive patterns. New styles must
  use the existing dark tokens and compact geometry.
- [`DatePicker.tsx`](../packages/frontend/src/components/DatePicker.tsx) is the required shared,
  text-editable calendar picker. Its popover is portaled to `document.body` and positions upward or
  downward against the viewport, so it can be used safely from the logging form.

### 2.2 Jira and refresh seams

- [`JiraClient`](../packages/backend/src/jira/client.ts) exposes cursor-paginated `searchJql` with an
  explicit field list. [`HttpJiraClient`](../packages/backend/src/jira/http-client.ts) uses Jira
  Cloud's `POST /rest/api/3/search/jql` endpoint.
- [`standup-context.ts`](../packages/backend/src/jira/standup-context.ts) already maps Jira issues
  into focused display records, applies a bounded timeout, and distinguishes fresh from unavailable
  participant-ticket results.
- [`standup.ts`](../packages/backend/src/routes/standup.ts) already exposes snapshot GET and targeted
  refresh POST routes for participant tickets, retaining last-known-good data as stale on failure.
  This is the closest reliability contract for intake refreshes.
- `standup_context_snapshot` in [`schema.ts`](../packages/backend/src/db/schema.ts) already supports a
  session-scoped `global` record with source/freshness metadata and JSON payload. Use
  `scope_kind = 'global'` and `scope_key = 'intake_requests'`; no snapshot schema migration is
  required.
- The normalized `work_item` table and `DomainDataset` retain labels but contain only issues reached
  by the configured planner import. They are therefore not authoritative for an all-Jira intake
  query.
- [`SyncButton.tsx`](../packages/frontend/src/components/SyncButton.tsx) and `POST /api/sync` perform
  broad planner reconciliation. They must not be reused for the pane-local Sync behavior.
- [`FakeJiraClient`](../packages/backend/src/jira/fake-client.ts) currently supports only its narrow
  importer JQL dialect. Its matcher must learn the exact label and status-category clauses needed
  here so backend tests remain deterministic.

### 2.3 Persistence and API seams

- Standup operational data is kept outside DomainDataset and is accessed through focused API
  methods in [`api.ts`](../packages/frontend/src/data/api.ts).
- [`schema.ts`](../packages/backend/src/db/schema.ts) defines fresh databases, while
  [`database.ts`](../packages/backend/src/db/database.ts) contains additive/idempotent migrations for
  existing SQLite files.
- A completed standup freezes `StandupAggregate` into `final_snapshot_json`. Intake snapshots and
  awareness records need not be added to that payload for this scope because the feature is absent
  from completed history.
- There is no authentication or multi-user authorization layer in this local single-user app.
  Backend validation remains necessary even though the UI supplies controlled values.

## 3. Target experience

### 3.1 Post-standup layout

Introduce a `PostStandup` composition instead of teaching the reusable `Notes` component about Jira
intake data:

```text
Post-standup notes                       Sprint · date · Post-standup
┌──────────────────────────────────────┬──────────────────────────────┐
│ Existing Notes                       │ Intake requests       Sync   │
│ - Required people                    │ Updated 10:24 AM · 8         │
│ - note list and actions              │ KEY-123  Summary             │
│ - note composer                      │          Status · Assignee   │
│                                      │          Log incoming request│
└──────────────────────────────────────┴──────────────────────────────┘
                                      [Finish Standup]
```

- At the intended desktop width, use a restrained two-column body: notes receive roughly two thirds
  and intake roughly one third. Separate panes with whitespace/a quiet divider or nested
  `--panel-2` surface, not two heavy standalone cards.
- Keep the modal header and Finish footer stable. Give the body the remaining height and audit the
  populated layout before choosing scroll ownership. The preferred implementation is one scroll
  region per content column at desktop so a long intake list cannot push Finish below the viewport;
  avoid scroll regions inside individual ticket rows.
- At a narrow viewport, stack existing notes first and intake second, return to one document scroll,
  and keep every row/action free of horizontal overflow.
- Do not render the pane during the participant round or on a completed record.

### 3.2 Intake list contents

The heading includes:

- **Intake requests**;
- a count badge when data is available;
- freshness text using the snapshot's `capturedAt`;
- a compact secondary **Sync** button whose accessible name is **Sync intake requests**.

Each row includes only information useful for triage and verifying an external assignment:

- Jira key as a normal external link using the configured Jira base URL;
- summary;
- current display status;
- assignee display name, or **Unassigned**;
- **Log incoming request**, or a quiet **Logged** state when a record already exists.

Sort by Jira's query order (`updated DESC`, then key) and retain that order through persistence and
rendering. Do not group by status or assignee in the initial slice.

### 3.3 Loading, failure, and synchronization states

Use a snapshot-first state model:

```ts
type StandupIntakeContext = {
  capturedAt: string;
  source: 'jira' | 'snapshot';
  freshness: 'fresh' | 'stale' | 'unavailable';
  requests: IntakeRequest[];
  errorMessage: string | null;
};

type IntakePaneState =
  | { status: 'loading'; context: null }
  | { status: 'refreshing'; context: StandupIntakeContext | null }
  | { status: 'ready'; context: StandupIntakeContext }
  | { status: 'stale'; context: StandupIntakeContext; message: string }
  | { status: 'unavailable'; context: null; message: string };
```

- On modal open, read the saved session snapshot and begin/reuse one background refresh immediately.
- A saved snapshot may paint immediately while Jira refreshes.
- The pane is not mounted until `post_standup`, but its state/promise lives at `StandupModal` level
  (or in a modal-scoped hook), so successfully prefetched data is immediately available at the
  transition.
- A background result may publish while participants advance. Closing or replacing the session
  prevents late publication into another modal.
- React Strict Mode setup/cleanup/setup must attach to the same in-flight promise, not discard the
  sole subscriber or issue duplicate searches.
- The Sync button starts or joins the same per-session in-flight refresh, disables only itself, and
  announces success/failure through a polite live region.
- On refresh failure, keep a usable prior snapshot and mark it stale. With no snapshot, show an
  unavailable message and leave Sync available for retry.
- A successful zero-result response says **No current intake requests**. It is never represented as
  unavailable.

### 3.4 Optional awareness form

Use a focused child dialog launched from the selected row. It must have a higher overlay layer than
the standup body, trap focus, close on Escape, restore focus to the row action, and leave the
underlying standup inert while open. Reuse `DatePicker`; do not use native `input[type='date']`.

Fields:

1. **Date we were made aware** — required ISO date, displayed/edited through `DatePicker`; default to
   the current standup date and allow earlier dates.
2. **Confidence in this date** — required `high | medium | low`. Use an accessible compact radio or
   segmented group because the complete stable set is intentionally tiny. Do not preselect a value
   that could imply confidence the user did not choose.
3. **Other notes** — optional plain-text textarea, trimmed on save, maximum 4,000 characters.

The dialog title identifies the Jira key. **Save log** is disabled until date and confidence are
valid, shows pending state during the request, prevents double submission, and closes only after a
successful response. After saving, change that row's action to **Logged** without exposing the
stored field values. Errors remain in the dialog; cancelling discards the draft and has no effect
on standup state.

## 4. Contracts and persistence

### 4.1 Shared types

Add focused types near the existing standup Jira types in
[`domain.ts`](../packages/shared/src/domain.ts):

```ts
export interface IntakeRequest {
  key: string;
  url: string | null;
  summary: string;
  status: string;
  statusCategory: string;
  assigneeAccountId: string | null;
  assigneeName: string | null;
  updatedAt: string | null;
  awarenessLogged: boolean;
}

export interface StandupIntakeContext {
  capturedAt: string;
  source: 'jira' | 'snapshot';
  freshness: 'fresh' | 'stale' | 'unavailable';
  requests: IntakeRequest[];
  errorMessage: string | null;
}

export type IntakeAwarenessConfidence = 'high' | 'medium' | 'low';

export interface IntakeAwarenessRecord {
  id: string;
  jiraKey: string;
  standupSessionId: string;
  awareDate: IsoDate;
  dateConfidence: IntakeAwarenessConfidence;
  notes: string | null;
  createdAt: string;
}
```

`awarenessLogged` is a local projection joined when the context is returned; do not persist it in
the Jira snapshot payload because awareness may be saved after that snapshot was captured.

### 4.2 Jira query service

Add a focused module such as
`packages/backend/src/jira/intake-context.ts` rather than expanding participant-specific logic:

1. Run the exact JQL from section 1.1 through `JiraClient.searchJql`.
2. Request only `summary`, `status`, `assignee`, and `updated`.
3. Follow `nextPageToken` until Jira reports the last page. The requirement is all current requests;
   do not silently truncate to the first page.
4. Apply the configured bounded Jira timeout to the overall operation. If the existing timeout
   helper remains non-cancelling, either share it intentionally for this slice or extract a common
   helper; do not introduce a second inconsistent timeout policy.
5. Map only display-safe fields plus the Jira browse URL. Treat missing summary/status/assignee as
   explicit fallbacks.
6. Return explicit unavailable context when Jira is absent, credentials/configuration are invalid,
   or the query times out.

The fake Jira matcher must support `labels =`, `statusCategory != Done`, and deterministic ordering
or the query module should be tested with a purpose-built `JiraClient` stub. Prefer extending the
fake because the clauses are reusable and its existing comment should then be corrected.

### 4.3 Snapshot repository

Add repository functions, either in [`standup.ts`](../packages/backend/src/db/standup.ts) or a small
`db/intake.ts` module:

- `getStandupIntakeContext(sessionId)` reads the `global/intake_requests` snapshot and joins
  `awarenessLogged` from the awareness table by Jira key.
- `saveStandupIntakeContext(sessionId, context)` writes only successful or intentionally
  unavailable first results. It must not overwrite last-known-good fresh/stale data with an
  unavailable result.
- Validate that the session exists. Manual refresh is allowed only while status is `active` or
  `post_standup`; completed records are read-only.

JSON parsing failure is treated as unavailable and reported without returning raw payload data.

### 4.4 Awareness table and migration

Add this table to fresh schema and idempotently create it from `migrate()` for existing databases:

```sql
CREATE TABLE IF NOT EXISTS intake_request_awareness (
  id TEXT PRIMARY KEY,
  jira_key TEXT NOT NULL UNIQUE,
  standup_session_id TEXT NOT NULL
    REFERENCES standup_session(id) ON DELETE RESTRICT,
  aware_date TEXT NOT NULL,
  date_confidence TEXT NOT NULL
    CHECK(date_confidence IN ('high', 'medium', 'low')),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_intake_awareness_date
  ON intake_request_awareness(aware_date, jira_key);
```

- This table is local history and is never included in `writeDataset` replacement or Jira sync.
- Use `ON DELETE RESTRICT` so deleting a standup cannot silently delete the only provenance for an
  awareness record. Update the current destructive standup-delete behavior to return a clear 409
  when awareness history references the session; do not cascade or orphan the record.
- Validate the awareness date as a real ISO calendar date and require `aware_date <= standup_date`.
- Validate the confidence enum and reject unknown request fields.
- Trim notes; store blank as `NULL`; enforce 4,000 characters.
- Confirm the Jira key is present in that session's latest intake snapshot before insert. This binds
  the form to a real displayed request and prevents arbitrary key injection.
- On the unique-key conflict, return 409 **This intake request has already been logged**. Do not
  update the existing record in this slice.

### 4.5 HTTP and frontend API

Add focused endpoints under the standup session:

```text
GET  /api/standups/:sessionId/intake-requests
POST /api/standups/:sessionId/intake-requests/refresh
POST /api/standups/:sessionId/intake-requests/:jiraKey/awareness
```

- GET returns the saved context or `null`, with current `awarenessLogged` flags projected in.
- Refresh returns fresh, stale-with-data, or unavailable context. Coalesce concurrent refreshes by
  session ID so initial prefetch, Strict Mode, and a rapid manual Sync cannot multiply the Jira
  query. Remove settled/failed promises so later Sync can genuinely re-query Jira.
- Awareness POST accepts `{ awareDate, dateConfidence, notes }`, returns the created record (or a
  minimal success shape if avoiding future read-contract commitment), and does not increment the
  standup revision.
- Encode both session ID and Jira key in frontend paths. Add typed functions and avoid coupling
  these calls to `StandupAggregate` refreshes.

## 5. Ordered implementation slices

Keep this document current as work proceeds: mark each slice complete, record exact validation
commands, and document contract changes here instead of relying on chat history.

### Slice 1 — Intake query, snapshots, and focused APIs

**Primary seams**

- `packages/shared/src/domain.ts`
- `packages/backend/src/jira/intake-context.ts` (new)
- `packages/backend/src/jira/fake-client.ts`
- `packages/backend/src/db/standup.ts` or `packages/backend/src/db/intake.ts` (new)
- `packages/backend/src/routes/standup.ts`
- `packages/backend/src/server.ts` if a refresh coordinator is injected
- `packages/frontend/src/data/api.ts`

**Work**

1. Add the shared request/context types.
2. Implement and unit-test cursor-paginated label/status-category search, mapping, timeout, empty,
   and unavailable behavior.
3. Persist/retrieve the session-global snapshot and join local logged flags at read time.
4. Add a per-session in-flight coordinator and the GET/refresh routes.
5. Add typed frontend clients.

**Exit:** one focused API call returns every matching current Jira issue, survives pagination,
retains last-known-good data on failure, and never invokes planner reconciliation.

### Slice 2 — Background lifecycle and post-standup pane

**Primary seams**

- `packages/frontend/src/components/RunStandupPage.tsx`
- optionally `packages/frontend/src/lib/useStandupIntakeRequests.ts` (new)
- optionally `packages/frontend/src/components/StandupIntakeRequests.tsx` (new)
- `packages/frontend/src/styles.css`

**Work**

1. Start snapshot read plus deduplicated refresh when an active standup modal opens.
2. Retain the state above the stage switch so it is ready on entry to `post_standup`.
3. Introduce the two-pane `PostStandup` composition and list states.
4. Add pane-local Sync with independent pending/error/live-region state.
5. Add responsive/focus styling using existing tokens and control classes.

**Exit:** reaching post-standup normally paints prefetched requests immediately; manual Sync shows
external Jira changes without disturbing notes or standup progression.

### Slice 3 — Optional awareness persistence and form

**Primary seams**

- `packages/backend/src/db/schema.ts`
- `packages/backend/src/db/database.ts`
- `packages/backend/src/db/intake.ts` (preferred new module)
- `packages/backend/src/routes/standup.ts`
- `packages/frontend/src/data/api.ts`
- `packages/frontend/src/components/IntakeAwarenessModal.tsx` (new)
- `packages/frontend/src/components/RunStandupPage.tsx` or the extracted intake pane
- `packages/frontend/src/components/DatePicker.tsx` (reuse; change only for broadly useful fixes)
- `packages/frontend/src/styles.css`

**Work**

1. Add fresh-schema and additive migration support.
2. Implement strict validation, uniqueness, provenance, and create endpoint.
3. Build the accessible child dialog with shared DatePicker, confidence choices, textarea, and
   pending/error states.
4. Project `awarenessLogged` after success and on subsequent snapshot reads without exposing saved
   values.
5. Confirm awareness history is not lost through planner sync, database reopen, or attempted
   standup deletion.

**Exit:** a facilitator can optionally save exactly one awareness record for a displayed Jira
request; cancel/no-log/failed-log paths leave Finish Standup fully usable.

### Slice 4 — Regression, visual, and operational hardening

**Primary seams**

- focused backend tests near `packages/backend/test/`
- focused frontend unit tests where pure state/helpers are extracted
- a new or extended Playwright standup spec under `packages/frontend/e2e/`
- `packages/frontend/src/styles.css`

**Work**

1. Cover concurrency and snapshot state transitions, including Strict Mode setup/cleanup/setup.
2. Cover populated, empty, stale, unavailable, syncing, and logged list states.
3. Cover the child-dialog keyboard/focus path and DatePicker overlay placement.
4. Inspect populated desktop and narrow layouts and refine scroll ownership/vertical rhythm.
5. Add privacy-safe backend timing logs: session ID, duration, page/request count, result count,
   coalesced flag, and terminal outcome. Do not log summaries, awareness notes, credentials, JQL
   response bodies, or assignee names.

**Exit:** automated and manual checks demonstrate that the feature remains responsive and usable
under long lists, slow Jira, refresh failure, duplicate logging, and narrow viewports.

## 6. Failure, concurrency, migration, and security considerations

### Failure and concurrency

- Initial Jira failure is non-blocking and retryable from the pane.
- Snapshot read and refresh may race; compare `capturedAt` or a request generation so a late older
  snapshot cannot overwrite a newer refresh.
- Only one refresh per session is in flight. Every caller observes the same promise; cleanup removes
  subscribers, not the underlying reusable promise.
- Manual Sync results for a closed/replaced modal may persist safely to SQLite but must not publish
  into the wrong React session.
- Awareness submission disables its own Save action, and the unique Jira-key constraint is the
  final protection against retry/double-click duplicates.
- Awareness creation is independent of standup revision so a note edit in another tab does not make
  the intake form spuriously stale. Session status is re-read inside the insert transaction.

### Migration and lifecycle

- The new table is additive and needs no data backfill.
- Test both a fresh in-memory database and an existing-file upgrade path.
- Database snapshot/export/import operates on the whole SQLite file, so the table is naturally
  retained. DomainDataset JSON replacement must not touch it.
- A standup with referenced awareness history becomes non-deletable in this slice. Surface this
  explicitly in the UI/backend rather than relying on a generic foreign-key 500.

### Security and privacy

- Jira permissions remain the authority for which intake requests are returned.
- Do not accept raw JQL, label, or Jira base URL from the browser; keep the label/query server-owned.
- Build browse URLs from configured Jira base URL plus an encoded key, and use `target="_blank"`
  with `rel="noreferrer"`.
- Validate all fields server-side, reject unknown confidence values/extra fields, and never render
  notes as markup.
- Avoid sensitive operational logging as described in Slice 4.

### Accessibility

- The pane has a labelled region, meaningful list semantics, a count that is not the only source of
  status, and a polite non-chattering live region for Sync completion.
- Freshness uses a semantic `<time dateTime>` and does not rely only on color.
- Loading animations respect existing reduced-motion rules.
- Every row action includes the Jira key in its accessible name.
- The child dialog traps focus, restores it, supports Escape/Cancel, labels all controls and error
  text, and keeps the DatePicker operable by keyboard.
- Desktop scroll regions are keyboard-scrollable and use visible focus; narrow layout avoids nested
  scrolling.

## 7. Automated verification

Before every Node/npm/npx command, select the repository's declared Node version from the repository
root:

```bash
nvm use
```

Run at minimum:

```bash
npm run typecheck
npm run test
npm run build
npm --workspace @ecp/frontend run e2e -- --grep "intake|post-standup"
```

Add deterministic coverage for:

- exact label plus non-Done filtering, including a Done labeled issue and a non-labeled open issue;
- cursor pagination returning all matching issues in stable order;
- missing Jira, timeout, and ordinary Jira error;
- first successful snapshot save/read;
- failed refresh preserving last-known-good context as stale;
- empty success remaining distinct from unavailable;
- concurrent initial/manual refresh coalescing and later retry after settlement;
- `awarenessLogged` joined from local state rather than frozen into snapshot JSON;
- awareness validation: malformed/future date, invalid confidence, oversized notes, unknown fields,
  issue absent from snapshot, duplicate Jira key, completed session, and successful insert;
- awareness persistence across database reopen and DomainDataset sync/replacement;
- React Strict Mode prefetch lifecycle and no duplicate query;
- active stage does not show the pane; post-standup does; completed stage does not;
- manual Sync updates assignee/status/count without replacing notes or disabling Finish;
- loading, stale-with-data, unavailable, empty, and retry rendering;
- awareness dialog defaults date correctly, requires confidence, saves, restores focus, marks the row
  Logged, and does not affect standup revision;
- desktop/narrow overflow and keyboard access.

Record exact successful commands and any intentionally scoped exceptions in this plan during
implementation.

## 8. Manual validation

Use a disposable test database and Jira fake or non-production Jira tenant. Never validate write
paths against production data.

1. Start a standup with several participants and confirm no intake pane appears during the team
   round and participant ticket behavior remains unchanged.
2. Observe the network or privacy-safe server logs and confirm the intake query begins near modal
   open, not only after the last participant.
3. Advance to post-standup and confirm the notes, Required people, composer, and Finish action are
   unchanged and the intake list is already populated when Jira responded in time.
4. Confirm key, summary, status, assignee/Unassigned, updated time, count, and Jira links are clear.
5. Change an assignee or status in Jira in another tab, click **Sync intake requests**, and confirm
   the row updates without a global planner sync.
6. Add/remove the label or move an issue to Done, Sync again, and confirm membership/count updates.
7. Simulate slow Jira. Confirm prior data remains usable with a restrained syncing state and that
   notes plus Finish stay interactive.
8. Simulate Jira failure with and without a prior snapshot. Confirm stale versus unavailable states,
   then retry successfully.
9. Open **Log incoming request** from a row. Exercise keyboard-only DatePicker use, confidence
   selection, optional notes, cancel, validation error, server error, and successful save.
10. Confirm a successful row becomes **Logged**, a duplicate is rejected without data loss, and no
    saved date/confidence/notes viewer has been introduced.
11. Finish the standup without logging any request and confirm completion succeeds normally.
12. Inspect at approximately 1280×900 and 390×844 with zero, one, and many intake rows and notes.
    Confirm no clipped controls, horizontal overflow, inaccessible nested scroll, or footer loss.

## 9. Acceptance criteria

- Every Jira issue visible to configured credentials matching label `tech-exp-intake` and not in
  Done status category is returned, across all cursor pages; non-matches are excluded.
- The intake query starts in the background when an active standup opens and never blocks starting,
  advancing, closing, reopening, note/check-in work, or finishing.
- The editable post-standup screen preserves all current content and adds a usable responsive intake
  pane; active and completed stages do not show it.
- The pane distinguishes initial loading, syncing with data, fresh, stale, unavailable, empty, and
  retry states.
- Sync is focused to the intake query and displays Jira status/assignee changes made in another tab
  without running full planner reconciliation.
- Initial and manual refreshes are deduplicated safely under Strict Mode, publish only to the correct
  session, and retain last-known-good data after failure.
- Each listed request can optionally create one durable awareness record containing Jira key,
  standup provenance, awareness date, high/medium/low confidence, optional notes, and created time.
- Skipping/cancelling/failing the awareness form never blocks Finish Standup and does not mutate the
  standup revision or Jira.
- Awareness values survive database reopen and Jira/planner sync, duplicate records cannot be
  created accidentally, and saved values are not otherwise viewed or edited in this scope.
- The desktop and narrow layouts meet the existing visual language and remain keyboard accessible,
  focus-safe, and free of horizontal overflow.
- Automated typecheck, tests, build, and focused end-to-end coverage pass after `nvm use`.

## 10. Continuation instructions

**Current status:** planning is complete on branch `plan/post-standup-intake-requests`; no production
code or schema changes have been made.

**Next action:** implement Slice 1, beginning with shared contracts and a tested Jira query service.

**First files to inspect:**

1. [`packages/shared/src/domain.ts`](../packages/shared/src/domain.ts), especially `StandupTicket` and
   `StandupMemberTicketContext`.
2. [`packages/backend/src/jira/standup-context.ts`](../packages/backend/src/jira/standup-context.ts)
   for mapping, timeout, and failure conventions.
3. [`packages/backend/src/jira/fake-client.ts`](../packages/backend/src/jira/fake-client.ts) for JQL
   matching and pagination.
4. [`packages/backend/src/db/schema.ts`](../packages/backend/src/db/schema.ts) and
   [`packages/backend/src/db/database.ts`](../packages/backend/src/db/database.ts) for persistence.
5. [`packages/backend/src/routes/standup.ts`](../packages/backend/src/routes/standup.ts) and
   [`packages/frontend/src/data/api.ts`](../packages/frontend/src/data/api.ts) for focused route/API
   patterns.
6. [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx)
   and the nearby standup rules in [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css)
   before Slice 2.
7. [`packages/frontend/src/components/DatePicker.tsx`](../packages/frontend/src/components/DatePicker.tsx)
   before Slice 3.

**Initial commands:**

```bash
git status --short
git branch --show-current
nvm use
rg -n "StandupMemberTicketContext|standup_context_snapshot|refreshStandupMemberTickets|post_standup" \
  packages/shared packages/backend packages/frontend
```

Do not initialize Spec Kit or create SDD artifacts for this work. Before each completed
implementation slice, update this file with discoveries/status and provide the user a concise manual
validation walkthrough for that slice.
