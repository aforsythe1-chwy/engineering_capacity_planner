# Standup Timer and Post-Standup Note Workflow — Durable Implementation Plan

**Status:** Proposed; implementation not started

**Created:** 2026-08-19

**Scope:** add an automatic per-participant timer and isolated pixel-fire overtime effect; add
configurable standup timing and team pseudogroups; add structured `@` mentions, completion,
reordering, and next-standup deferral to post-standup notes; preserve all note state with the
standup session

**Intended outcome:** while a participant is up, Standup starts a visible timer automatically and
gives the facilitator Pause/Resume and Reset controls. At the configured threshold (45 seconds by
default), a contained, accessible pixel-fire treatment appears around the Standup modal. Notes can
be tagged to several people or configured team groups through an `@` fuzzy finder, completed and
reopened, reordered, or deferred to the next standup. Every note mutation is durable and remains
part of the session record.

**Constraints:** no Spec Kit/SDD; preserve the one-level planner and team-wide Standup semantics in
[`planner-product-constitution.md`](./planner-product-constitution.md); build on the existing
standup tables, revision protocol, APIs, modal, shared `Typeahead`, and visual tokens; do not turn
timer data into performance analytics

**Related plans:**

- [`standup-facilitation-plan.md`](./standup-facilitation-plan.md)
- [`standup-bandwidth-check-in-visual-refinement-plan.md`](./standup-bandwidth-check-in-visual-refinement-plan.md)
- [`standup-ticket-list-visual-refinement-plan.md`](./standup-ticket-list-visual-refinement-plan.md)
- [`standup-status-display-configuration-plan.md`](./standup-status-display-configuration-plan.md)

## 1. Product decisions and invariants

These decisions make the requested behavior executable without relying on the original
conversation. Change them in this artifact before implementation if product intent differs.

### 1.1 Timer lifetime

- The timer belongs to the current participant turn, not to the whole modal or standup session.
- When the first participant appears, or the current participant changes after **Next** or
  **Skip**, elapsed time resets to `00:00` and starts automatically.
- **Pause** freezes elapsed time and becomes **Resume**. **Reset** returns to `00:00` and
  immediately continues running; a paused user can Reset and then Pause again if they want it held
  at zero.
- The timer exists only in the active team round. It stops and unmounts in `post_standup` and
  `completed` states.
- Timer elapsed time, pause state, and resets are deliberately not persisted, included in the final
  snapshot, logged, or reported. Reopening/reloading an active participant starts a fresh timer.
  This is a facilitation cue, not a measurement of individual performance.
- Use a monotonic clock (`performance.now()`) plus accumulated elapsed time rather than counting
  interval callbacks. Background-tab throttling must not make the displayed duration inaccurate;
  the display catches up from the monotonic clock when the page becomes visible again.

### 1.2 Overtime threshold and fire treatment

- Add a global integer setting named `standup_speaker_threshold_seconds`, default `45`, with an
  initial accepted range of 5–600 seconds.
- The current dataset setting is read when the modal renders. A configuration change takes effect
  the next time the dataset reloads/modal opens; no live cross-tab settings channel is required.
- Overtime begins when `elapsedMs >= thresholdSeconds * 1000`. Reset removes overtime immediately.
  Pausing after the threshold leaves the warning visible but pauses decorative movement; Resume
  continues it.
- The effect is a pixel-art edge treatment: blocky flame/ember shapes, stepped animation, and a
  restrained warm border/glow around the modal. It must not cover text, controls, dropdowns, or
  the footer, change layout dimensions, capture pointer events, or use red/yellow as the only
  overtime signal.
- Render visible **Over time** copy next to the timer. The fire itself is decorative and
  `aria-hidden`.
- Under `prefers-reduced-motion: reduce`, show the overtime label and a static pixel-fire frame;
  disable flame, ember, glow, and flicker animation.
- Keep the implementation consolidated in a focused timer/effect component and a tightly
  namespaced Standup CSS section. Do not add generic `.fire`, `.pixel`, or global animation names,
  a canvas particle loop, an animation dependency, or fire conditionals throughout the modal.

### 1.3 Mentions and pseudogroups

- `@All Team` is a built-in, reserved audience choice. It always appears first in the mention
  finder and is not deletable or renameable in Configuration.
- Configured pseudogroups are team-scoped flat lists of member IDs. Examples such as **Oracle
  Engineers** and **SEIII** are user-created configuration, not hard-coded production defaults.
  Groups cannot contain other groups in the first release.
- A note may tag several individual members and/or several pseudogroups. Selecting `@All Team`
  clears all other selections; selecting a person or pseudogroup clears `@All Team` because the
  latter already includes everyone.
- Typing `@` at a token boundary in the note body opens a local, immediate fuzzy finder anchored to
  the composer. Text after `@` up to the caret filters people and groups. Arrow keys, Home/End,
  Enter, Escape, pointer selection, click-outside dismissal, listbox semantics, and visible focus
  follow the shared [`Typeahead.tsx`](../packages/frontend/src/components/Typeahead.tsx) behavior.
- On selection, remove the trigger/query text and render the selected person/group as a removable
  chip attached to the plain-text composer. Do not use `contenteditable` or make the note body
  HTML. This avoids text/structured-tag drift and keeps rendering safe.
- Search active members of the standup team plus configured groups. Persisted notes continue to
  display snapshot labels for inactive/renamed members or deleted/renamed groups.
- At save time, persist both the selected mention identities/labels and the deduplicated resolved
  member audience. A later group edit must not silently change the historical audience of an
  existing note.

### 1.4 Note state, completion, ordering, and deferral

Use one mutually exclusive note state:

```text
open <-> completed
  |          |
  +------> deferred
              |
              +--> open, only before carry-forward materializes
```

- New and carried notes start `open`.
- Completing a note sets `completed_at`; reopening sets it back to `open` and clears
  `completed_at`. The row stays in its current position.
- A completed note remains visible with muted text, a line-through, a checked native checkbox, and
  an accessible **Completed** label. Completion is not represented by styling alone.
- Deferring an open or completed note marks the original `deferred`, sets `deferred_at`, and leaves
  it visible in the original session with **Deferred to next standup** metadata. It is not moved out
  of, or reassigned away from, that session.
- A deferred note may be reopened before its carry-forward copy exists. Once a copy has been
  materialized, the immutable origin/copy relationship must not be undone automatically.
- On the next editable standup for the same team with a later standup date, each queued deferred
  note is copied exactly once to the end of that session as `open`. The copy preserves body,
  structured mention snapshots, resolved audience, and a `source_note_id` link; show compact
  **Carried from YYYY-MM-DD** metadata.
- Starting/resuming an existing active or post-standup session also materializes older unclaimed
  deferrals. A completed later session is never mutated; an unclaimed deferral waits for the next
  future editable session.
- A carried note may itself be deferred, forming an auditable chain rather than rewriting history.
- Notes may be reordered at any time the session is `active` or `post_standup`. Provide pointer
  dragging plus explicit **Move up**/**Move down** actions. Dragging is an enhancement, never the
  only keyboard-accessible mechanism.
- All note editing, state changes, and ordering stop after **Finish Standup**, preserving the
  existing immutable completed-session contract. “Completion can be undone” therefore applies
  while the current session is editable. A deferred note can still appear as an open carried note
  in a future session even though its origin session is complete.

### 1.5 Persistence and session ownership

- `standup_note.session_id` remains the ownership boundary for every note. Completion, deferral,
  position, mention snapshots, and resolved member audiences are persisted incrementally rather
  than held only in React state.
- Closing the modal, reloading, restarting the backend, or running Jira sync must retain the exact
  note list, state, order, and audience.
- Finishing the session writes final snapshot schema version 2 containing the expanded notes. Do
  not rewrite version 1 snapshots from existing completed standups.
- Timer state is the only requested state deliberately excluded from session persistence.

## 2. Verified current behavior and evidence

The following facts were verified from the working tree on 2026-08-19.

### 2.1 Existing standup domain and persistence

- [`schema.ts`](../packages/backend/src/db/schema.ts) already defines `standup_session`,
  `standup_participant`, `standup_note`, `standup_note_member`, and
  `standup_context_snapshot`. `standup_note` has a durable `session_id`, contiguous `position`,
  body, `all_team`, and timestamps.
- [`standup.ts`](../packages/backend/src/db/standup.ts) creates and returns normalized note rows,
  validates that tagged members belong to the standup team, compacts positions after delete, and
  uses `standup_session.revision` for optimistic concurrency.
- Existing create/update/delete note mutations reject completed or committed sessions through
  `assertMutable(...)` and increment the session revision through `touch(...)`.
- `finishStandup(...)` currently serializes the aggregate as final snapshot schema version 1 and
  makes the session read-only.
- [`database.ts`](../packages/backend/src/db/database.ts) runs idempotent additive migrations after
  `CREATE TABLE IF NOT EXISTS`, which is the seam for new note columns on existing SQLite files.
- Dataset replacement deliberately leaves standup-owned tables outside `INSERT_ORDER` /
  `DELETE_ORDER`; [`persist.ts`](../packages/backend/src/db/persist.ts) defers foreign-key checks
  while teams and members are refreshed. Existing sync coverage verifies an active standup and its
  participants survive Jira reconciliation.

### 2.2 Existing API and UI

- [`routes/standup.ts`](../packages/backend/src/routes/standup.ts) exposes focused start/get/list,
  participant, check-in, note CRUD, finish, commit, and delete routes.
- [`api.ts`](../packages/frontend/src/data/api.ts) has typed aggregate/start/get/create-note calls,
  but does not yet expose note update/delete, state, or reorder calls.
- [`RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx) owns the launch
  page, modal, participant progression, bandwidth, tickets, and a minimal local `Notes` component.
- The minimal note UI always creates `allTeam: true`, renders member IDs rather than names, and
  exposes no audience picker, edit, delete, completion, reorder, or deferral behavior. The backend
  member-tag join is therefore present but not meaningfully reachable from the UI.
- The current modal identifies the active participant as the first `pending` participant; that
  stable `participant.memberId` change is the correct automatic timer reset/start seam.
- [`Typeahead.tsx`](../packages/frontend/src/components/Typeahead.tsx) already supplies local or
  async search, keyboard navigation, listbox semantics, portaled placement, focus return, and
  planner-consistent menu styling.
- [`styles.css`](../packages/frontend/src/styles.css) contains a consolidated Standup section,
  modal breakpoints, token-based controls, and an existing reduced-motion rule. The codebase uses
  one global stylesheet, so isolation should come from strict `standup-speaker-*`,
  `standup-fire-*`, and `standup-note-*` prefixes/root selectors rather than introducing an
  unrelated styling system.

### 2.3 Existing settings seam

- [`settings.ts`](../packages/shared/src/settings.ts) defines canonical setting keys and JSON
  shapes. `DomainDataset.settings` carries global, team, and epic scopes.
- [`repository.ts`](../packages/backend/src/db/repository.ts) validates a fixed allowlist of global
  settings, and `PATCH /api/settings` persists them. Team-scoped setting writes are not yet
  implemented even though the domain supports the scope.
- [`Configuration.tsx`](../packages/frontend/src/components/Configuration.tsx) already has a shared
  mutation runner and a Standup status configuration section. A focused **Standup settings** panel
  is the correct place for the timer threshold and pseudogroups; this feature does not add a route
  or navigation level.

### 2.4 Existing verification seam and worktree caution

- [`standup-tickets.spec.ts`](../packages/frontend/e2e/standup-tickets.spec.ts) supplies a
  deterministic active-session modal harness at desktop and narrow widths and should remain a
  regression test.
- There is no focused backend standup repository test file and no timer/mention parser unit test.
  Add them rather than overloading unrelated suites.
- The working tree contained an unrelated untracked `packages/backend/packages/` directory during
  planning. Treat it as user-owned and do not edit, delete, stage, or use it as the intended source
  tree.

## 3. Target contracts

### 3.1 Shared settings

Add the following to [`settings.ts`](../packages/shared/src/settings.ts):

```ts
SETTING_KEYS.STANDUP_SPEAKER_THRESHOLD_SECONDS = 'standup_speaker_threshold_seconds';
SETTING_KEYS.STANDUP_PSEUDOGROUPS = 'standup_pseudogroups';

export const STANDUP_DEFAULTS = {
  SPEAKER_THRESHOLD_SECONDS: 45,
} as const;

export interface StandupPseudogroup {
  id: string;
  name: string;
  memberIds: string[];
}

export interface StandupPseudogroupsSetting {
  version: 1;
  groups: StandupPseudogroup[];
}
```

Contract details:

- Seed the global threshold default in `defaultGlobalSettings()`.
- Store `standup_pseudogroups` at `scope='team'`, `scope_id=<teamId>`. Absence means no custom
  groups; `@All Team` still exists as a system choice.
- Initial bounds: at most 50 groups per team, 100 characters per group name, and 100 members per
  group. Trim names, reject empty names, duplicate IDs, case-insensitive duplicate names, unknown
  fields, unknown teams, cross-team members, and duplicate member IDs. Preserve configured group
  order.
- Group IDs are stable opaque IDs so renaming does not change identity. Configuration creates them
  once; do not derive identity from the mutable display name.

### 3.2 Shared note types

Extend [`domain.ts`](../packages/shared/src/domain.ts) with explicit note contracts:

```ts
export type StandupNoteState = 'open' | 'completed' | 'deferred';
export type StandupNoteMention =
  | { kind: 'member'; id: string; label: string }
  | { kind: 'group'; id: string; label: string };

export interface StandupNote {
  // existing id, sessionId, body, allTeam, memberIds, position, timestamps
  state: StandupNoteState;
  completedAt: string | null;
  deferredAt: string | null;
  sourceNoteId: string | null;
  sourceSessionDate: IsoDate | null;
  mentions: StandupNoteMention[];
}
```

Keep `memberIds` as the resolved, deduplicated audience snapshot. `mentions` records which direct
people/groups the author selected and in what order. `allTeam` remains the reserved system choice.

### 3.3 SQLite schema and migration

Extend `standup_note` for fresh databases and add the same columns idempotently in
[`database.ts`](../packages/backend/src/db/database.ts):

```sql
note_state     TEXT NOT NULL DEFAULT 'open'
               CHECK(note_state IN ('open', 'completed', 'deferred')),
completed_at   TEXT,
deferred_at    TEXT,
source_note_id TEXT REFERENCES standup_note(id) ON DELETE SET NULL
```

Add a mention snapshot table:

```sql
CREATE TABLE IF NOT EXISTS standup_note_mention (
  note_id      TEXT NOT NULL REFERENCES standup_note(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL CHECK(position >= 0),
  mention_kind TEXT NOT NULL CHECK(mention_kind IN ('member', 'group')),
  mention_id   TEXT NOT NULL,
  label        TEXT NOT NULL,
  PRIMARY KEY(note_id, position),
  UNIQUE(note_id, mention_kind, mention_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_standup_note_source
  ON standup_note(source_note_id) WHERE source_note_id IS NOT NULL;
```

Migration requirements:

- Existing note rows become `open` with null lifecycle/source columns.
- Existing `all_team` rows need no mention row. For older member-tagged notes without mention
  snapshots, the row mapper synthesizes direct member mentions from `standup_note_member` and the
  current/snapshotted member label; do not require a destructive backfill.
- Verify the additive self-reference works against an existing on-disk test database. If the
  supported SQLite version cannot add the reference safely, add the nullable column without the
  legacy-table FK and keep repository validation authoritative; fresh schemas still receive the
  FK.
- Never rewrite existing `final_snapshot_json` documents. New completions set
  `final_schema_version = 2`.

### 3.4 Settings APIs

- Continue using `PATCH /api/settings` for the global threshold and add strict integer validation.
- Add `PATCH /api/teams/:teamId/settings` for allowlisted team-scoped settings. Initially its only
  editable key is `standup_pseudogroups`.
- Implement a repository-level `upsertTeamSettings(db, teamId, patch)` that verifies team/member
  ownership transactionally. Do not broaden the global settings endpoint to accept arbitrary
  scopes or keys.
- Return the saved settings rows and reload the dataset through the existing Configuration
  mutation runner.

### 3.5 Note mutation APIs

Retain existing note routes and extend their request contracts:

```ts
type StandupNoteAudienceInput =
  | { allTeam: true; mentions?: never }
  | {
      allTeam: false;
      mentions: Array<
        { kind: 'member'; id: string } |
        { kind: 'group'; id: string }
      >;
    };

type StandupNoteWriteInput = {
  body: string;
  audience: StandupNoteAudienceInput;
  expectedRevision: number;
};
```

- On create/update, validate mention uniqueness and team ownership, load the current team group
  configuration, snapshot mention labels, resolve group members, deduplicate the member audience,
  and rewrite `standup_note_mention` plus `standup_note_member` in the same transaction.
- Reject zero-audience notes unless product direction explicitly changes. A note must tag at least
  one person/group or `@All Team`.
- Add:

```text
PATCH /api/standups/:sessionId/notes/:noteId/state
  { state: 'open' | 'completed' | 'deferred', expectedRevision }

PUT /api/standups/:sessionId/notes/order
  { noteIds: string[], expectedRevision }
```

- State mutations set/clear timestamps consistently and enforce the transition rules in section
  1.4. Reopening `deferred` must reject with `409` if a child note already exists.
- Reorder validates that `noteIds` contains every current session note exactly once, with no
  foreign, missing, or duplicate ID. Update positions atomically using a collision-safe two-phase
  offset because `(session_id, position)` is unique. Increment the session revision once.
- Keep delete position compaction and update it to account for source-note behavior. Deleting an
  unmaterialized deferred note cancels that queued deferral; deleting a source with an existing
  child must not delete the child.
- All routes continue returning the complete `StandupAggregate`, allowing the client to replace
  its canonical server state and revision after each mutation.

### 3.6 Deferred-note materialization

Move standup start/resume into one transaction that can also materialize carryovers:

1. Resolve or create the requested team/date session.
2. If it is `active` or `post_standup`, select deferred notes from earlier sessions for the same
   team where no row has `source_note_id = deferred.id`.
3. Order them by origin `standup_date`, then origin note `position`, then ID for deterministic
   ties.
4. Copy body, `all_team`, member audience, and mention snapshots; set `note_state='open'`, append
   positions, set `source_note_id`, and use new create/update timestamps.
5. Increment the target session revision once if any notes were copied.
6. Return the aggregate. The unique partial source index plus the transaction makes retry or two
   simultaneous start requests idempotent.

Do not copy from the same date, into a completed session, or across teams. A deferred origin stays
deferred forever as historical evidence even after its copy is completed.

## 4. Frontend design and component seams

### 4.1 Decompose the current standup file

[`RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx) is already compact
but owns several unrelated concerns. Keep page/modal orchestration there and extract focused
components instead of expanding its one-line local functions:

- `components/StandupSpeakerTimer.tsx` — timer state, controls, elapsed formatting, threshold
  state, and the single integration point for the decorative effect;
- `components/StandupFireEffect.tsx` — decorative, pointer-transparent pixel layers only;
- `components/StandupNotes.tsx` — persisted list, composer, note row actions, retry/conflict state,
  and reorder orchestration;
- `components/StandupMentionComposer.tsx` — plain-text draft, cursor-aware `@` trigger, selected
  chips, and shared/local combobox menu integration;
- `components/StandupConfiguration.tsx` — threshold and team pseudogroup editor;
- `lib/standupTimer.ts` and `lib/standupMentions.ts` — pure formatting/state/parser/fuzzy helpers
  suitable for unit tests.

If direct reuse of `Typeahead` is blocked because it owns its `<input>`, extract its menu/keyboard
portion into a shared internal combobox primitive used by both `Typeahead` and the mention
composer. Do not fork visually similar menu logic into Standup.

### 4.2 Timer placement and behavior

- Place the timer in the active participant heading, aligned opposite the name/progress at wide
  widths and wrapped below them at narrow widths.
- Show a tabular-numeric `MM:SS` `<time>` display plus compact Pause/Resume and Reset buttons. Keep
  **Next** as the single primary action in the footer; timer controls are quiet secondary actions.
- Key the timer by `${session.id}:${participant.memberId}` so participant changes reset it even if
  the enclosing TeamRound component is reused.
- Update visible seconds no more than four times per second and display whole seconds. Clear
  interval/visibility listeners on participant change, pause, and unmount. React Strict Mode must
  not create duplicate timers.
- Do not announce every tick to assistive technology. Announce only **Timer started**, **paused**,
  **resumed**, **reset**, and **over time** in a polite status region.

### 4.3 Fire isolation

- Let `StandupSpeakerTimer` report one `overTime` Boolean to the modal shell. The modal adds one
  root state class/data attribute and renders one `StandupFireEffect`; no other child needs to know
  about the threshold.
- Establish a local stacking context on `.standup-modal`; keep effect layers behind interactive
  content but above the modal background. Use `pointer-events: none`, `overflow: clip` where safe,
  and CSS custom properties scoped to the fire root.
- Prefer blocky CSS gradients/box shadows and `steps(...)` keyframes over image assets. Animate
  transform/opacity when possible and cap the number of ember elements; do not run a JavaScript
  particle system.
- Prefix every selector and keyframe, for example `standup-fire-edge` and
  `standup-pixel-flame-flicker`. Add the reduced-motion override in the same Standup section.

### 4.4 Note list and composer

- Use a `textarea` for the body with the existing 4,000-character server limit and a compact tag
  chip row. The textarea stays a plain-text controlled field.
- The mention finder combines options in this order: `@All Team`, configured groups, active team
  members. Fuzzy score within each category, then stable configured/name order. Show hints such as
  **Group · 4 people** and **Person**.
- Open only for an `@query` touching the current caret at a token boundary. Closing the menu leaves
  typed text intact; choosing an option removes just the trigger span and adds a chip. Do not
  trigger on email-address text.
- Disable **Add note** until the trimmed body is non-empty and an audience exists. Preserve body
  and chips after a failed request. Clear them only after a successful aggregate response.
- Render notes as a compact ordered list, not a stack of heavy cards. Each row contains a native
  completion checkbox, drag handle, body, audience chips, lifecycle/carry metadata, and a quiet
  action menu or compact actions for edit, defer/reopen, move, and delete.
- Keep completed/deferred notes in the same persisted order. Do not silently group or sort them by
  state because that would conflict with explicit reordering.
- Use the resolved member names/mention snapshot labels, never raw member IDs, in visible UI.
- During pointer reorder, update a local draft order for feedback, send the full ID list on drop,
  and revert to the last server aggregate on failure. Move buttons send the same full-order API.
- In the compact team-round rail, preserve note actions that fit; the full post-standup stage may
  use the roomier layout. Popovers must be portaled or viewport-positioned so modal overflow does
  not clip the mention finder/action menu.

### 4.5 Configuration panel

Add a focused **Standup settings** panel in
[`Configuration.tsx`](../packages/frontend/src/components/Configuration.tsx), near the existing
Standup status section:

- one integer **Speaker overtime threshold (seconds)** input, defaulting to 45, with concise helper
  copy explaining the pixel-fire cue;
- one pseudogroup list for the selected team;
- add/rename/remove group controls;
- for each group, a local member `Typeahead` and removable selected-member chips/rows;
- a non-editable `@All Team` row explaining that it is always available in Standup;
- one clear save action for the threshold and one for group edits, or one atomic action only if the
  UI clearly represents the different global/team scopes and handles partial failure.

Reuse `--panel`, `--panel-2`, `.control`, `.config-row`, `.btn`, `.link-btn`, 8–12px radii, quiet
borders, and the repository's visible focus treatment. Avoid a new configuration subroute or
oversized blocky inputs.

## 5. Ordered implementation slices

Keep this section current during implementation. Mark a slice complete only after its automated
checks and user-specific manual walkthrough are recorded here.

### Slice 1 — Shared contracts and settings persistence

**Files/subsystems:**

- `packages/shared/src/settings.ts`
- `packages/shared/src/domain.ts`
- `packages/backend/src/db/repository.ts`
- `packages/backend/src/routes/config.ts`
- focused shared/backend tests

**Work:**

1. Add threshold defaults/types and team pseudogroup types.
2. Add strict global threshold validation.
3. Add allowlisted team-scoped settings persistence and ownership validation.
4. Add the typed frontend API call for team settings.

**Exit:** malformed thresholds/groups fail without writes; valid settings survive dataset reload;
existing global/epic settings behavior is unchanged.

### Slice 2 — Note schema, row mapping, and write contracts

**Files/subsystems:**

- `packages/backend/src/db/schema.ts`
- `packages/backend/src/db/database.ts`
- `packages/backend/src/db/standup.ts`
- `packages/backend/src/routes/standup.ts`
- `packages/frontend/src/data/api.ts`
- `packages/backend/test/standup.test.ts` (new)

**Work:**

1. Add lifecycle/source columns, mention table, and source uniqueness.
2. Map new fields and synthesize mentions for legacy tagged rows.
3. Extend create/update with structured audience resolution and snapshots.
4. Add state and full-order endpoints with revision/ownership validation.
5. Preserve body, tags, state, and order across get/restart/sync.

**Exit:** the backend contract is complete and tested independently of React, including stale
revisions and legacy database opening.

### Slice 3 — Exactly-once deferral and final snapshot v2

**Files/subsystems:**

- `packages/backend/src/db/standup.ts`
- `packages/backend/test/standup.test.ts`
- `packages/backend/test/sync.test.ts`
- snapshot/import coverage where needed

**Work:**

1. Implement state transitions and deferred-note materialization in start/resume.
2. Prove same-team/later-date selection and exactly-once copying under repeated start.
3. Preserve mention/audience snapshots and source metadata through carryover.
4. Write final snapshot schema version 2 and retain version 1 compatibility.

**Exit:** completing an origin and starting the next session yields one linked open copy; retries,
sync, reload, and a skipped calendar date do not duplicate or lose it.

### Slice 4 — Timer and isolated pixel-fire effect

**Files/subsystems:**

- new `StandupSpeakerTimer.tsx`, `StandupFireEffect.tsx`, `lib/standupTimer.ts`
- `RunStandupPage.tsx`
- the Standup section of `styles.css`
- timer unit/E2E coverage

**Work:**

1. Implement the monotonic auto-start/pause/resume/reset state machine.
2. Integrate once at participant identity and reset on participant key change.
3. Add threshold/overtime copy and the single modal-shell fire state.
4. Add pixel-art CSS, narrow layout, static reduced-motion treatment, and cleanup.

**Exit:** timer controls and threshold transition are deterministic under a fake clock; the effect
is visually contained and cannot block interaction.

### Slice 5 — Mention-aware note UI and configuration

**Files/subsystems:**

- new `StandupNotes.tsx`, `StandupMentionComposer.tsx`, `StandupConfiguration.tsx`
- `Typeahead.tsx` only if a shared headless menu extraction is required
- `Configuration.tsx`
- `RunStandupPage.tsx`
- `styles.css`
- mention parser/unit/E2E coverage

**Work:**

1. Build the threshold/pseudogroup editor with team membership validation feedback.
2. Build cursor-aware `@` search and removable structured chips.
3. Replace the minimal `Notes` function with durable create/edit/delete, completion/reopen,
   defer/reopen, source metadata, and retry states.
4. Add pointer and button/keyboard ordering through the full-order endpoint.

**Exit:** all requested note behaviors work from both team-round and post-standup views, visible
labels never expose IDs, and drafts survive failures.

### Slice 6 — Integrated persistence, accessibility, and visual regression

**Files/subsystems:**

- `packages/frontend/e2e/standup-timer.spec.ts` (new)
- `packages/frontend/e2e/standup-notes.spec.ts` (new)
- existing `standup-tickets.spec.ts`
- backend standup/sync/snapshot tests
- this continuation record

**Work:**

1. Exercise a full active → post-standup → completed → next-session carryover flow.
2. Verify close/reopen, page reload, backend restart where practical, and Jira sync preservation.
3. Verify pointer, keyboard, reduced-motion, desktop/narrow, empty, saving, conflict, and failure
   states.
4. Run full typecheck/test/build and visually inspect the rendered modal.

**Exit:** every acceptance criterion below is evidenced by an automated check or the recorded
manual walkthrough.

## 6. Failure, concurrency, migration, and operational considerations

### 6.1 Concurrency

- Preserve `expectedRevision` on every note write, state change, delete, and reorder. A stale write
  returns `409` without partial mutation.
- On a frontend `409`, refetch the aggregate. Preserve an unsaved composer/edit draft and selected
  chips, explain that the list changed in another tab, and let the user retry. Reorder reverts to
  server order.
- State/order/audience changes run in transactions and touch the session once. Carryover creation
  and source uniqueness are also transactional.

### 6.2 Failure states

- A failed timer is not meaningful because it is local; ensure component cleanup prevents leaked
  intervals rather than displaying an error.
- Note create/update/state/reorder failure must not show a false completed/deferred/saved state.
  Keep or restore the last confirmed aggregate and provide compact retry guidance.
- If a configured group is removed between composer selection and save, reject the stale group
  mention, retain the draft, reload configuration/options, and ask for a new selection. Existing
  saved notes remain valid through their snapshots.
- If a member is deactivated, keep historical audience display. New direct searches omit inactive
  members; configuration visibly marks existing inactive group members so the user can remove
  them.

### 6.3 Migration and compatibility

- Test fresh in-memory schema and a pre-feature SQLite file opened through `openDatabase(...)`.
- Existing completed snapshot version 1 remains readable/read-only. New UI defaults absent note
  fields to `open` only at the compatibility boundary, not throughout components.
- Binary database snapshot/import naturally includes new tables/columns. Verify the import path
  runs additive migration before the database is served.
- Dataset/Jira replacement must not delete note lifecycle, mentions, ordering, or carryover links.

### 6.4 Security and privacy

- Render note bodies as React text, never `dangerouslySetInnerHTML`; the `@` trigger is parsing,
  not markup.
- Validate session/note ownership, team/group/member ownership, body length, setting bounds,
  mention counts, exact order membership, and all unknown fields on the server.
- Do not log note bodies, selected people/groups, final snapshot JSON, or timer durations. Error
  messages may identify a malformed field/ID but must not echo full note content.
- No feature in this plan writes to Jira, Slack, email, Confluence, or another external system.

### 6.5 Accessibility and motion

- Timer buttons have explicit accessible names and visible focus; elapsed text uses tabular digits.
  Do not flood a live region once per second.
- Overtime has text in addition to color/fire; decorative layers are hidden and pointer-inert.
- Honor reduced motion and verify that no animation continues in the effect subtree.
- The mention picker uses combobox/listbox semantics and remains visible at modal/viewport edges.
  Chips have named Remove buttons.
- Completion uses a native checkbox and textual state. Line-through/muting is supplemental.
- Reorder has named Move up/down controls with disabled boundary states and a polite order-change
  announcement. Pointer dragging is optional.

### 6.6 Performance and observability

- Run at most one timer interval for the current participant. Do not rerender ticket/note trees on
  sub-second ticks; isolate timer state in its own component.
- Use CSS transforms/opacity/stepped frames and a bounded number of decorative nodes. No canvas,
  requestAnimationFrame particle emitter, or new animation package.
- Pseudogroup/member search is local and immediate; no API call per keystroke.
- Existing API error handling plus user-visible mutation status is sufficient. Do not add timer or
  note-content telemetry. If server diagnostics are added later, record endpoint/status/duration
  only.

## 7. Automated verification

### 7.1 Backend tests

Add focused coverage for:

- threshold and team pseudogroup setting validation, including cross-team IDs and duplicate names;
- note creation with one member, several members, overlapping groups, and `@All Team` exclusivity;
- persisted mention labels/resolved audiences remaining stable after group/member rename;
- complete → reopen and open/completed → deferred transitions and timestamps;
- rejection of reopening a deferral after its copy exists;
- exact full-list reorder, boundary order, duplicates, foreign IDs, omissions, and stale revisions;
- delete compaction and source-child preservation;
- carryover to the next later editable same-team session exactly once, including repeated/concurrent
  start attempts and a completed later session;
- final snapshot schema version 2 plus legacy version 1 behavior;
- preservation across Jira sync and database snapshot/import;
- additive migration from a database containing pre-feature standup notes.

### 7.2 Frontend unit tests

Add pure tests for:

- `MM:SS` formatting, threshold boundary, pause accumulation, Reset, and participant-key reset;
- `@` token-boundary/caret parsing, email suppression, query-span removal, and Escape behavior;
- fuzzy option order, duplicate audience resolution, All Team exclusivity, and removed chips;
- reorder helper behavior without mutating the server aggregate.

### 7.3 Frontend E2E

Use deterministic route fixtures and Playwright's clock controls; never wait 45 real seconds.
Cover:

- initial participant auto-start, Pause, Resume, Reset, participant advance reset, and no timer in
  post-standup;
- exact threshold boundary, overtime text/root class, paused fire state, and reset removal;
- reduced-motion static state and absence of pointer obstruction;
- `@` search for a person, `@All Team`, Oracle Engineers, and SEIII; multiple selections; keyboard
  selection; chip removal; and exact request payloads;
- create/reload persistence, complete/reopen styling and payload, pointer/button reorder, defer,
  finish, next-session carryover metadata, and exactly one copy;
- stale revision/failure draft preservation;
- desktop and 390px-wide modal with portaled menus and no horizontal overflow;
- existing ticket grouping/freshness/focus assertions remain green.

### 7.4 Commands

Run from the repository root. Per `AGENTS.md`, run `nvm use` before every Node/npm command group:

```text
nvm use
npm --workspace @ecp/backend run test -- standup.test.ts repository.test.ts sync.test.ts

nvm use
npm --workspace @ecp/frontend run test -- --run test/standupTimer.test.ts test/standupMentions.test.ts

nvm use
npm --workspace @ecp/frontend run e2e -- standup-timer.spec.ts standup-notes.spec.ts standup-tickets.spec.ts

nvm use
npm run typecheck
npm run test
npm run build

git diff --check
```

## 8. Manual validation walkthrough

After each meaningful slice, update this section with the date/result rather than relying on chat
history. Final validation should use a backend-connected writable dataset.

1. In Configuration, set the threshold to 45 seconds. Create **Oracle Engineers** and **SEIII**,
   add several team members with overlap, save, reload, and verify exact persistence. Confirm
   `@All Team` is always present but not editable.
2. Start Standup. Confirm the first participant timer begins at zero without a click. Pause for a
   few seconds, Resume, Reset, then advance; confirm the next participant gets a fresh running
   timer.
3. Let/fake the timer cross 45 seconds. Confirm **Over time** appears and the modal edges gain a
   restrained pixel-fire effect without shifting or obscuring content. Pause, Resume, and Reset.
4. Repeat step 3 with reduced motion and at desktop/narrow widths. Confirm a static warning remains
   understandable and all controls/typeahead overlays remain reachable.
5. Create a note by typing `@`, fuzzy-selecting multiple people/groups, and entering body text.
   Confirm visible chips, resolved names, save, close/reopen, and page reload.
6. Complete the note and reopen it. Confirm checked/unchecked state, gray/strike treatment, text
   status, stable order, and no lost tags.
7. Create several notes. Reorder by drag and by Move up/down, reload, and verify exact persisted
   order. Exercise a forced failure/stale revision and confirm rollback/draft preservation.
8. Defer an open and a completed note, undo one before finishing, then finish the session. Confirm
   the final record is read-only and the deferred origin remains attached to it.
9. Start the next later standup for the same team. Confirm exactly one open copy appears at the end
   with **Carried from** metadata, the original body/audience snapshots, and no duplicate after
   close/reopen or another start request.
10. Run Jira sync and restart/reopen the database. Confirm both origin and carried note remain
    intact and no timer duration was recorded.

## 9. Acceptance criteria

- The current participant's timer starts automatically at `00:00`, supports Pause/Resume and
  Reset, and resets/starts when participant identity changes.
- The overtime threshold defaults to 45 seconds, is configurable and validated in Configuration,
  and is read from persisted settings.
- Reaching the threshold produces visible **Over time** text and a contained pixel-art fire effect
  without layout shift, input obstruction, global CSS leakage, or uncontrolled motion.
- Reduced-motion users receive a static, fully understandable overtime state.
- Configuration supports durable team pseudogroups with validated member membership; `@All Team`
  is always available as a reserved system choice.
- Typing `@` in a note composer opens an accessible fuzzy finder for groups and active members;
  several structured tags can be selected and removed.
- Notes persist body, selected mention snapshots, resolved member audience, lifecycle state,
  timestamps, source link, and explicit order under their standup session.
- Note completion is checked, gray, struck through, textually identified, persisted, and undoable
  while the session is editable.
- Notes can be reordered with pointer and keyboard-accessible controls, with order retained across
  close/reload/restart.
- Deferring leaves the origin on its session and creates exactly one linked open copy in the next
  later editable same-team standup.
- Completing a standup writes final snapshot schema version 2; completed sessions are immutable and
  older version 1 snapshots remain valid.
- Note data survives Jira sync, database snapshot/import, backend restart, member/group rename or
  deactivation, and route/filter changes.
- Stale revisions and failed saves never silently overwrite another tab or discard the user's
  unsaved body/tags.
- Existing bandwidth, ticket refresh/grouping, participant progression, Standup routing, and the
  one-level/team-wide product model do not regress.

## 10. Explicit non-goals

- Persisting, reporting, ranking, or analyzing speaker durations.
- Automatically advancing or skipping a participant at the threshold.
- Sound, browser notifications, vibration, or a full-screen fire takeover.
- Nested/dynamic groups, Jira groups, role synchronization, or external directory lookup.
- Parsing notes into executable mentions in Slack/Jira/Confluence or notifying tagged people.
- Creating Jira tickets or comments from notes.
- Editing note lifecycle/order after the origin session is completed.
- Replacing the current immutable final snapshot/commit model or adding a new Standup route.

## 11. Continuation record

**Current status (2026-08-19):** implementation started. Shared threshold/pseudogroup contracts,
additive note migration, team settings API, structured note audience snapshots, note lifecycle and
order endpoints, carry-forward materialization, snapshot schema v2, local speaker timer, contained
pixel-fire cue, and compact standup note/configuration UI have been added. Existing repository and
server regressions plus workspace typecheck pass.

**Deviation / next action:** the current audience picker is a compact persisted multi-select (with
All Team, groups, and people) rather than the specified cursor-anchored `@` Typeahead composer.
Pointer drag reorder, edit-in-place, focused new tests, and visual/E2E validation remain to finish
the complete plan. Preserve the existing user-owned `packages/backend/packages/` path.

**Manual validation checkpoint (not yet performed):**

1. Run the backend, open **Configuration**, and save a threshold between 5 and 600. Reload and
   confirm it remains set; values outside that range should show a validation error.
2. In **Standup settings**, save a group document such as
   `[ { "id": "eng", "name": "Engineers", "memberIds": ["M1"] } ]`; reload and confirm it
   persists. Try a member from another team and confirm save is rejected.
3. Start Standup and confirm the current participant’s timer starts automatically. Pause, Resume,
   Reset, and advance to confirm the next participant begins at zero.
4. Set a 5-second threshold and confirm **Over time** and a non-interactive modal-edge fire cue
   appear without obscuring controls; Reset should remove it.
5. Add a note for All team and another for a selected person/group. Complete, defer, move, reload,
   and verify body/audience/state/order survive. Start a later standup and verify one carried copy
   appears for the deferred note.

**First files to inspect:**

1. [`packages/shared/src/settings.ts`](../packages/shared/src/settings.ts)
2. [`packages/shared/src/domain.ts`](../packages/shared/src/domain.ts)
3. [`packages/backend/src/db/repository.ts`](../packages/backend/src/db/repository.ts)
4. [`packages/backend/src/routes/config.ts`](../packages/backend/src/routes/config.ts)
5. [`packages/backend/src/db/standup.ts`](../packages/backend/src/db/standup.ts)
6. [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx)
7. [`packages/frontend/src/components/Typeahead.tsx`](../packages/frontend/src/components/Typeahead.tsx)
8. [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css)

**Discovery commands:**

```text
git status --short
rg -n "STANDUP_|StandupNote|standup_note|createNote|updateNote|startStandup" \
  packages/shared/src packages/backend/src packages/frontend/src
rg -n "standup-|Typeahead|StandupStatusConfiguration|KnobsSection" \
  packages/frontend/src/components packages/frontend/src/styles.css
```

Before implementation, preserve the unrelated untracked `packages/backend/packages/` path and any
new user-owned changes. After every completed slice, update its status, discoveries, deviations,
verification results, and the next action in this file.
