# Standup Ticket Status Display Configuration — Durable Implementation Plan

**Status:** Implemented; interactive visual/E2E verification remains

**Created:** 2026-08-16

**Parent plan:** [`standup-facilitation-plan.md`](./standup-facilitation-plan.md)

**Scope:** discover the selected Jira board's ticket statuses, let the user assign each status a
friendly display name and an explicit order in Configuration, persist that presentation policy,
and apply it to the Standup modal's Sprint tickets groups

**Intended outcome:** replace raw, incidentally ordered headings such as `COMPLETE`,
`READY FOR REVIEW`, `IN PROGRESS`, and `QA` with user-controlled labels in a deliberate sequence,
including the ability to place Done last.

**Constraints:** no application implementation is part of this planning change; no Spec Kit/SDD;
preserve the flat planner navigation and the product invariants in
[`planner-product-constitution.md`](./planner-product-constitution.md); do not overwrite the
current in-progress Standup, Team, bandwidth, Configuration, or Jira work in the working tree.

## 1. User context and target experience

The Standup modal currently groups one participant's sprint tickets under Jira's exact status
names. Those names are useful in Jira but are visually noisy in a conversational standup, and the
group order follows whichever status appears first in the returned tickets. The desired behavior
is a small presentation layer:

- discover statuses from the configured Jira board;
- show each source status in Configuration;
- allow a friendlier heading for each status;
- allow a deterministic top-to-bottom order;
- save the policy for the configured board;
- use the saved policy only when displaying Standup tickets;
- continue showing an unfamiliar or newly added Jira status even before it is configured.

The recommended Configuration placement is directly after the existing **Jira setup** section and
before **Sync history**. Status discovery depends on the selected Jira board, while the setting
controls Standup presentation rather than capacity, cadence, membership, or epic scope. It should
not be mixed into **Planning knobs**.

The panel should use the working title **Standup ticket statuses** and helper copy similar to:

> Rename and order the Jira statuses shown during standup. Jira workflows and tickets are not
> changed.

Each compact row contains:

| Control | Behavior |
| --- | --- |
| Order | A visible ordinal plus compact **Move up** and **Move down** buttons |
| Jira status | Read-only source status name, with its board column as muted context |
| Show as | A text input initialized to the Jira status name |

Use accessible buttons rather than drag-and-drop for the first release. This keeps ordering fully
keyboard-operable and avoids introducing a custom interaction for a short administrative list.
The panel has one local primary action, **Save status display**, and a secondary **Reset to board
order** action. Reset changes the local draft only until Save is pressed.

## 2. Verified current behavior and evidence

These are repository facts verified on 2026-08-16.

### 2.1 Standup rendering

- [`RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx) owns the current
  Standup modal and ticket rendering.
- `StandupTickets` reduces `context.tickets` into a `Map<string, tickets>` keyed by
  `ticket.status`, then renders the map without an explicit sort.
- JavaScript `Map` preserves insertion order, so the visible status order is the order in which
  each status first happens to occur in the participant's Jira response. It can differ between
  participants and does not represent configured board-column order.
- The group heading renders the exact Jira status and CSS uppercases it. There is no friendly-name
  or ordering layer.
- `StandupTicket` already carries the raw display `status` and stable `statusCategory`, but it does
  not carry Jira's status ID. Ticket contexts are persisted as JSON snapshots, so adding an
  optional status ID does not require a SQL column migration.

### 2.2 Configuration and persistence seams

- [`Configuration.tsx`](../packages/frontend/src/components/Configuration.tsx) composes the
  Configuration page and already has a shared mutation runner that saves, reloads the dataset,
  disables controls while busy, and surfaces errors.
- Jira setup is rendered near the bottom of Configuration, followed by Sync history and database
  tools. The new panel can be inserted immediately after `JiraSetupWizard` without changing
  navigation or routing.
- [`settings.ts`](../packages/shared/src/settings.ts) defines canonical JSON-backed setting keys,
  and the dataset already exposes global settings to both Configuration and Standup.
- `PATCH /api/settings` and `repo.upsertGlobalSettings(...)` are the existing persistence seam.
  The repository validates an allowlist of editable setting keys before storing JSON.
- The settings table is already schema-flexible for a new JSON value. No database migration is
  needed.

### 2.3 Jira discovery seams

- `JiraClient` currently supports listing boards, board issues, and sprints, but it does not expose
  board configuration or a status catalog.
- The configured board ID and board name already live in `JIRA_BOARD_ID` and `JIRA_BOARD_NAME`.
- [`routes/jira.ts`](../packages/backend/src/routes/jira.ts) already contains the shared logic for
  resolving the configured project and board and translating Jira failures into bounded API
  errors.
- The official Jira Software Cloud API exposes
  [`GET /rest/agile/1.0/board/{boardId}/configuration`](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-configuration-get).
  Its `columnConfig.columns` is explicitly returned in board order and associates status IDs with
  each column. The last populated column is treated by Jira as Done.
- Board configuration returns status IDs but not reliably all friendly status names. The Jira
  status catalog or status data from board issues is therefore needed to resolve IDs to names and
  status categories.

### 2.4 Root cause

The visual problem is not a CSS defect. Raw workflow terminology and incidental first-seen order
are passed directly into the view. The durable fix is a board-aware presentation contract plus a
pure grouping/sorting step; styling alone cannot make the headings stable or friendly.

## 3. Decisions and invariants

### 3.1 Presentation only

This feature must never transition Jira tickets, rename Jira statuses or columns, change workflow
configuration, change status categories, or write any data to Jira. Discovery calls are read-only,
and the saved setting is local planner data.

The mapping must also remain separate from planner `WorkItemStatus`. Standup tickets carry live Jira
workflow states with organization-specific names; the planner's normalized work-item lifecycle has
different semantics.

### 3.2 Prefer board configuration; degrade to observed board statuses

The primary discovery source is the selected board's configuration because it is the only source
that provides empty columns and canonical column order. Resolve the status IDs through Jira's
status catalog.

If board-configuration access returns an authorization/capability error but ordinary board-issue
access works, fall back to unique statuses observed on board issues. Mark the API response source
as `board-issues`, order by `statusCategory` (`new`, `indeterminate`, unknown, `done`) and then name,
and show a muted warning in Configuration that empty statuses may be missing. Do not fail the
entire Configuration page.

Do not choose one arbitrary ticket as the primary strategy. A sample ticket cannot reveal the
board's complete workflow or intended order.

### 3.3 Key mappings by Jira status ID, with a legacy-name fallback

Jira status ID is the durable identity and prevents a Jira rename from creating a second mapping.
Extend live `StandupTicket` snapshots with optional `statusId: string | null`. Preserve
`status: string` as the raw source name for display, diagnostics, old snapshots, and failure
fallback.

When rendering an older snapshot without a status ID, match a configured entry by exact
`sourceName`. If neither ID nor exact name matches, use the raw status as the heading and treat it
as unmapped.

### 3.4 Make configuration board-specific

Mappings for one board must not silently apply to another board with statuses that happen to share
names. Persist configurations inside one versioned global setting, keyed by board ID. Retain a
previous board's mapping if the user switches boards and later switches back.

The selected board ID determines which mapping Standup uses. A missing board entry means raw Jira
names with deterministic fallback ordering.

### 3.5 Order is the saved array order

Do not store separately editable integer ranks that can collide or develop gaps. The order of the
saved `entries` array is the presentation order. The UI may display 1-based ordinals, while Move
up/down simply swaps adjacent entries.

When the board discovery response contains a newly added status, merge it into the draft in board
column order and label it **New** until the user saves. Never remove a saved entry automatically:
an old status can still exist in a persisted standup snapshot. Show statuses no longer found on the
board as **Not currently on board** and keep them at the end of the editor.

At Standup runtime, an unmapped status must never disappear. Append unmatched groups after the
configured groups, ordered by status category and raw status name. This makes the failure mode
predictable, although the user should revisit Configuration after a Jira workflow change.

### 3.6 Shared display names create one display group

Friendly names are presentation groups. Require non-empty names, but allow multiple Jira statuses
to share one friendly name. In Standup, tickets from those source statuses render beneath one
heading in configured status order. This supports workflows with several review states without
exposing their internal distinctions during a conversational standup.

### 3.7 Defaults

For a board without saved configuration:

- create one draft row per discovered Jira status;
- initialize **Show as** to the source status name;
- use board column order, preserving Jira's status order inside each column;
- therefore place the Jira Done column last by default;
- require an explicit Save before creating local settings.

Discovery never mutates settings automatically.

## 4. Proposed contracts

Names can be adjusted to local conventions during implementation, but the semantics should remain
stable.

### 4.1 Shared presentation setting

Add a canonical setting key such as:

```ts
SETTING_KEYS.STANDUP_STATUS_PRESENTATION = 'standup_status_presentation';
```

Store a versioned JSON document:

```ts
interface StandupStatusPresentationSetting {
  version: 1;
  boards: Array<{
    boardId: string;
    boardName: string;
    entries: Array<{
      statusId: string;
      sourceName: string;
      sourceCategory: string;
      sourceColumnName: string | null;
      friendlyName: string;
    }>;
  }>;
}
```

The array position is the saved order. `boardName`, `sourceName`, category, and column are snapshots
for orientation and fallback; IDs are identities. The repository validator must:

- require `version === 1`;
- accept at most 20 board records and 100 statuses per board;
- trim names and reject empty IDs/names;
- cap each user-visible name at 100 characters;
- reject duplicate board IDs and duplicate status IDs within a board;
- reject unknown object keys rather than persisting malformed data accidentally.

Do not add this setting to the mapping-complete gate. Jira sync and Standup remain usable without
it.

### 4.2 Jira discovery API

Add a focused read-only route:

```text
GET /api/jira/board-statuses
```

Proposed response:

```ts
interface JiraBoardStatusDiscovery {
  boardId: string;
  boardName: string;
  source: 'board-configuration' | 'board-issues';
  statuses: Array<{
    id: string;
    name: string;
    category: string;
    columnName: string | null;
    boardOrder: number;
    observedIssueCount: number | null;
  }>;
  warning: string | null;
}
```

The endpoint uses the persisted selected board. Return `400` with a useful message when no board is
configured, `502` for an unavailable Jira request with no fallback, and `200` plus `warning` when
fallback discovery succeeds. Do not return issue summaries, assignees, tokens, JQL, or arbitrary
ticket fields.

### 4.3 Jira client seam

Extend the shared Jira integration seam and both implementations:

- add typed `getBoardConfiguration(boardId)` support;
- add typed status-catalog discovery appropriate to the configured Jira flavor;
- add optional `id` to the existing Jira status wire type;
- update `HttpJiraClient` for the real endpoints;
- update `FakeJiraClient` with configurable columns/status definitions and realistic defaults.

Keep the route responsible for joining board columns to status definitions and producing the small
frontend contract. Do not leak raw board configuration into React.

### 4.4 Pure frontend grouping contract

Create a focused helper, for example
[`lib/standupStatusPresentation.ts`](../packages/frontend/src/lib/standupStatusPresentation.ts),
that accepts tickets plus the active board's saved entries and returns:

```ts
interface StandupTicketGroup {
  identity: string;
  sourceStatus: string;
  displayName: string;
  configured: boolean;
  tickets: StandupTicket[];
}
```

The helper must be deterministic and independent of React:

1. resolve by `statusId`;
2. fall back to exact `sourceName` for legacy snapshots;
3. group tickets by source identity;
4. emit configured groups in saved order;
5. append unmapped groups by category and raw name;
6. omit configured groups that have zero tickets from the participant view;
7. preserve ticket order within each group.

The Configuration merge/reset helpers should also be pure functions so they can be tested without
rendering the whole page.

## 5. Configuration UI behavior

Add a dedicated `StandupStatusConfiguration` component rather than expanding the already broad
`Configuration` function. It receives the current dataset, editability, and mutation/reload seam.

### Loading and empty states

- No selected board: show a compact explanation to finish Jira setup first; do not call discovery.
- Discovering: keep the panel shape stable and show a restrained loading message.
- Discovery failed with a saved mapping: keep the saved rows editable and show that board refresh
  is unavailable.
- Discovery failed without a saved mapping: show the error and a **Retry** action; do not block
  other Configuration sections.
- Bundled/read-only data: show any saved policy read-only; otherwise show that live Jira discovery
  requires the backend.
- No statuses: show a calm empty state and do not enable Save.

### Draft and save behavior

- Merge discovery with the saved mapping on initial load and when the configured board changes.
- Preserve the user's current unsaved edits during unrelated dataset reloads. Only replace the
  draft after a successful Save, explicit Reset, or actual board-ID change.
- Move buttons update draft order immediately; disable Move up for the first row and Move down for
  the last.
- Validate friendly names inline, including blanks and duplicates, and disable Save while invalid.
- Save only the active board record while preserving other board records already in the setting.
- After a successful save, reuse the existing reload flow so an already open/newly opened Standup
  receives the current policy from `DomainDataset.settings`.
- Reset to board order restores discovered source names and order for active statuses while
  retaining inactive saved statuses at the end until Save.

### Visual and accessibility rules

- Reuse `.panel`, `.section-title`, `.control`, `.btn`, `.link-btn`, `--panel-2`, `--border`,
  `--text`, `--muted`, and `--accent` from [`styles.css`](../packages/frontend/src/styles.css).
- Keep rows compact, with quiet borders and the same radius family as existing configuration rows.
- Use a responsive grid at desktop and stack source name, input, and ordering actions at narrow
  width.
- Give icon-only order buttons explicit accessible names; visible text buttons are also acceptable
  if the row remains compact.
- Preserve visible `:focus-visible`, hover, disabled, error, and busy states.
- Announce successful order changes only if testing shows the visual ordinal is insufficient for
  screen-reader users; avoid a noisy live region for every keystroke in a name field.

## 6. Failure, migration, concurrency, security, and observability

### Failure handling

- Jira discovery failure must not stop planner configuration or Standup.
- A stale saved mapping remains usable if Jira is unavailable.
- A saved mapping entry whose Jira status was renamed should be matched by status ID; show the newly
  discovered source name in the draft and only persist that metadata on Save.
- An unconfigured ticket status renders under its raw Jira name.
- Invalid or unparseable legacy setting JSON falls back to no mapping and surfaces a recoverable
  Configuration warning rather than crashing Standup.

### Migration and compatibility

- No SQL migration is required; the feature adds a global settings row and an optional field in
  JSON ticket snapshots.
- Existing databases without the setting retain today's raw names, but use deterministic fallback
  ordering once the new helper is installed.
- Existing persisted Standup ticket snapshots without `statusId` use exact source-name matching.
- Database snapshot/import and Jira reconciliation already preserve settings generically; verify
  this with tests rather than adding special-case copy logic.
- Do not rewrite historical Standup snapshots merely to add status IDs.

### Concurrency

The planner is a local, single-user product, and the current settings API has last-write-wins
semantics. This feature does not introduce a new settings revision protocol. The save path must
still preserve mappings for boards other than the active board from the latest loaded dataset.
If multi-user configuration becomes a product requirement, add settings revisions across the
Configuration surface rather than solving concurrency only for this panel.

### Security and privacy

- All Jira calls are read-only and use the existing server-held credentials.
- Never expose Jira credentials or authorization headers to the frontend.
- The discovery response contains only board/status metadata, not tickets or user data.
- Validate size, shape, and strings server-side before storing the setting to prevent unbounded or
  malformed JSON.

### Observability

- Use existing HTTP error handling and Jira request-cache diagnostics where applicable.
- Do not log ticket bodies or credentials.
- If fallback discovery is used, expose it through the typed response and UI warning; no new
  metrics system is required for this local feature.

## 7. Ordered implementation slices

Each completed implementation slice should update this plan's status and continuation section and
end with the repository's concise manual-validation walkthrough.

### Slice 1 — Shared setting and presentation helpers

Target seams:

- `packages/shared/src/settings.ts`
- `packages/shared/src/domain.ts`
- `packages/backend/src/db/repository.ts`
- `packages/backend/test/repository.test.ts`
- new `packages/frontend/src/lib/standupStatusPresentation.ts`
- new focused frontend unit test

Work:

1. Add the versioned setting key/type and optional `StandupTicket.statusId`.
2. Add strict backend validation for the setting document.
3. Add pure parse, board-selection, merge, reset, group, and ordering helpers.
4. Unit-test configured order, friendly names, legacy-name fallback, unknown statuses, empty
   groups, duplicate validation, and stable ticket order.

Exit condition: settings can be safely persisted and grouping behavior is proven without Jira or
React.

### Slice 2 — Board status discovery

Target seams:

- `packages/backend/src/jira/types.ts`
- `packages/backend/src/jira/client.ts`
- `packages/backend/src/jira/http-client.ts`
- `packages/backend/src/jira/fake-client.ts`
- `packages/backend/src/routes/jira.ts`
- `packages/backend/test/http-client.test.ts`
- `packages/backend/test/jira-route.test.ts`

Work:

1. Add typed board-configuration and status-catalog reads.
2. Join column status IDs to status definitions in canonical board order.
3. Count observed board issues when available without making counts a prerequisite.
4. Implement board-issue fallback and explicit `source`/`warning` metadata.
5. Cover missing-board, primary, fallback, and total-failure responses.

Exit condition: one focused API returns a small, ordered, board-specific status catalog and never
mutates Jira.

### Slice 3 — Configuration panel

Target seams:

- `packages/frontend/src/data/api.ts`
- new `packages/frontend/src/components/StandupStatusConfiguration.tsx`
- `packages/frontend/src/components/Configuration.tsx`
- `packages/frontend/src/styles.css`
- focused component tests, if the current frontend test environment supports DOM rendering

Work:

1. Add the typed discovery client.
2. Insert the panel after Jira setup and before Sync history.
3. Implement loading, fallback, error, read-only, merge, reset, reorder, inline validation, and save
   states.
4. Add responsive and focus-visible styling using existing tokens.

Exit condition: the user can discover, rename, order, validate, and save board statuses without
affecting Jira or other Configuration sections.

### Slice 4 — Apply the policy in Standup

Target seams:

- `packages/backend/src/jira/standup-context.ts`
- related Standup backend tests
- `packages/frontend/src/components/RunStandupPage.tsx`
- focused frontend helper/component tests

Work:

1. Capture Jira status ID in newly refreshed ticket contexts.
2. Select the active board's saved presentation from dataset settings.
3. Replace the inline `Map` grouping in `StandupTickets` with the pure helper.
4. Render `displayName` while retaining source status identity for keys and fallbacks.
5. Verify refreshing/stale/unavailable behavior and Next/Skip semantics are unchanged.

Exit condition: every participant sees consistent configured headings and order; unknown and old
snapshot statuses still render safely.

### Slice 5 — Integration and visual hardening

Target seams:

- backend and frontend focused test suites
- a new or existing Configuration/Standup Playwright spec
- `packages/frontend/src/styles.css`
- this plan's status and continuation section

Work:

1. Add an end-to-end path that saves reordered friendly names and opens Standup.
2. Verify the policy survives reload and database restart/snapshot flows as appropriate.
3. Inspect Configuration and Standup at desktop and narrow viewports.
4. Check populated, newly discovered, inactive, read-only, loading, failure, validation, hover,
   disabled, and keyboard-focus states.
5. Record exact successful commands and any changed decisions in this plan.

Exit condition: automated checks pass and the UI is manually verified in all material states.

## 8. Automated verification

Before every Node/npm command, run `nvm use` from the repository root in the same shell, per
[`AGENTS.md`](../AGENTS.md).

At minimum, run the focused tests introduced above plus:

```sh
nvm use
npm --workspace @ecp/shared run typecheck
npm --workspace @ecp/backend run typecheck
npm --workspace @ecp/backend run test -- --run test/repository.test.ts test/http-client.test.ts test/jira-route.test.ts
npm --workspace @ecp/frontend run typecheck
npm --workspace @ecp/frontend run test -- --run test/standupStatusPresentation.test.ts
npm --workspace @ecp/frontend run e2e -- standup-status-configuration.spec.ts
git diff --check
```

Use the actual focused filenames chosen during implementation if they differ, and record the final
commands here. Run the wider affected package suites before handoff if focused checks reveal shared
contract changes.

Required automated cases:

- board configuration order is preserved, including an empty status/column when the catalog can
  resolve it;
- board-issue fallback is deterministic and clearly identified;
- settings validation rejects malformed, oversized, duplicate, or ambiguous mappings;
- friendly names and order survive dataset reload;
- status IDs survive fresh Standup ticket capture;
- configured order is identical across participants regardless of Jira ticket order;
- legacy snapshots match by exact source name;
- unmapped statuses remain visible with raw names;
- zero-ticket configured statuses do not create empty Standup headings;
- discovery failures do not break Configuration or Standup progression.

## 9. Manual verification

1. Open Configuration with a live configured Jira board. Confirm **Standup ticket statuses** appears
   after Jira setup and lists the board's statuses in column order.
2. Rename representative statuses, for example `Complete` to `Done`, and use Move down until Done
   is last. Save and reload the browser; confirm names and order persist.
3. Start Standup for two participants whose Jira responses contain statuses in different ticket
   orders. Confirm both participants see the same configured group order and friendly headings.
4. Confirm each ticket remains under the correct source status, Jira ticket links still work, and
   Next/Skip plus refresh behavior are unchanged.
5. Add or simulate a newly discovered Jira status. Confirm it appears as **New** in Configuration
   and still appears under its raw name in Standup before saving.
6. Simulate board-configuration denial with board-issue access available. Confirm the fallback
   warning appears and observed statuses remain configurable.
7. Simulate Jira unavailable with a saved mapping. Confirm the saved editor remains usable and
   Standup still applies it to saved ticket snapshots.
8. At a narrow viewport, confirm source names, friendly-name fields, and order buttons stack without
   horizontal overflow. Tab through every control and verify visible focus and logical order.
9. Switch to bundled/read-only mode and confirm controls cannot mutate settings and no browser
   default input styling leaks through.

## 10. Acceptance criteria

- Configuration contains one board-aware **Standup ticket statuses** panel after Jira setup.
- The panel discovers the selected board's statuses and uses true board column order when the Jira
  capability is available.
- The user can assign a non-empty friendly name and explicit order to every discovered status,
  including grouping multiple source statuses under one display name and putting Done last.
- Saving persists a versioned mapping scoped by board ID and survives reload.
- Standup ticket groups use the configured friendly names and exact saved order for every
  participant.
- The feature does not change Jira tickets, columns, workflows, planner status normalization,
  capacity, routing, or epic filtering.
- Newly encountered, removed, renamed, legacy, or unmapped statuses never cause tickets to vanish
  or the Standup modal to fail.
- Missing/failed Jira discovery degrades to observed statuses or saved configuration without
  blocking other Configuration or Standup actions.
- The UI follows the existing dark visual system and is usable by keyboard at desktop and narrow
  widths.
- Focused shared, backend, frontend, and end-to-end tests pass, along with typechecks and
  `git diff --check`.

## 11. Explicit non-goals

- Mutating Jira status, workflow, board-column, or ticket data.
- Mapping Jira statuses into planner `WorkItemStatus` values.
- Filtering tickets out of Standup by status.
- Merging several source statuses into one friendly display group.
- Per-team or per-user overrides when they share the same Jira board.
- A drag-and-drop ordering widget.
- Status colors, icons, WIP limits, or Jira workflow editing.
- A new navigation level or a separate configuration route.
- Retrofitting status IDs into historical Standup snapshot JSON.

## 12. Continuation instructions

**Current status:** Slices 1–4 are implemented. Slice 5 has focused automated verification but
still needs an interactive Configuration/Standup walkthrough on a live Jira board.

**Implemented on 2026-08-16:**

- added the versioned, board-scoped `standup_status_presentation` setting with strict server-side
  size, shape, identity, and unique-friendly-name validation;
- added board configuration/status-catalog discovery plus deterministic observed-issue fallback;
- added the Configuration panel after Jira setup, including merge, reset, order buttons, validation,
  read-only/error/loading states, and responsive styles;
- captured Jira status IDs in new Standup snapshots and applied the persisted policy through a pure
  grouping helper, retaining legacy source-name matching and raw unknown-status fallbacks;
- verified `@ecp/backend` and `@ecp/frontend` typechecks, focused Jira route tests, focused
  presentation-helper tests, and `git diff --check`.

**Next action:** complete the manual verification checklist in §9 against a configured live Jira
board, then add a browser E2E regression if the local environment has representative Jira data.

Read these files first:

1. [`AGENTS.md`](../AGENTS.md)
2. [`planner-product-constitution.md`](./planner-product-constitution.md)
3. [`standup-facilitation-plan.md`](./standup-facilitation-plan.md)
4. [`standup-ticket-refresh-reliability-plan.md`](./standup-ticket-refresh-reliability-plan.md)
5. [`packages/shared/src/settings.ts`](../packages/shared/src/settings.ts)
6. [`packages/shared/src/domain.ts`](../packages/shared/src/domain.ts)
7. [`packages/backend/src/db/repository.ts`](../packages/backend/src/db/repository.ts)
8. [`packages/frontend/src/components/Configuration.tsx`](../packages/frontend/src/components/Configuration.tsx)
9. [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx)

Then run read-only discovery before editing:

```sh
git status --short
rg -n "StandupTickets|JIRA_BOARD_ID|EDITABLE_SETTINGS|listBoardIssues|JiraStatus" packages
```

The working tree contained substantial user-owned changes when this plan was written. Do not reset,
checkout, or re-create those files. Inspect their current state and make narrowly scoped patches.
Keep this document current as slices complete; record tests, manual-validation results, and any
material contract changes here rather than relying on conversation history.
