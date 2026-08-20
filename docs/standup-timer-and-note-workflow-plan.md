# Standup Timer and Post-Standup Note Workflow — Durable Implementation Plan

**Status:** In progress; the persisted note workflow and focused `@` mention composer cleanup in
section 11 are implemented. The first visual hierarchy refinement, larger Standup note type scale,
and pointer drag reorder in section 12 are implemented. Section 13's required-people projection and
All Team audience card are implemented; its large note-tile and responsive-layout slices remain.
Section 14 specifies optional walk-off MP3 audio with a team default and member overrides and is
ready for implementation. Edit-in-place remains outside these slices.

**Created:** 2026-08-19

**Last updated:** 2026-08-20

**Scope:** add an automatic per-participant timer, isolated pixel-fire overtime effect, and optional
walk-off MP3 whose volume follows the fire heat; add configurable standup timing, team pseudogroups,
a team-default song, and per-member overrides; add structured `@` mentions, completion, reordering,
and next-standup deferral to post-standup notes; preserve all note state with the standup session

**Intended outcome:** while a participant is up, Standup starts a visible timer automatically and
gives the facilitator Pause/Resume and Reset controls. At the configured threshold (20 seconds by
default), a contained, accessible pixel-fire treatment appears around the Standup modal. Notes can
be tagged to several people or configured team groups through an `@` fuzzy finder, completed and
reopened, reordered, or deferred to the next standup. Every note mutation is durable and remains
part of the session record. When the facilitator explicitly enables walk-off audio, the resolved
team/member MP3 starts at overtime and becomes progressively louder from the same heat stages that
drive the fire, without ever blocking Standup when media playback is unavailable.

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

- Add a global integer setting named `standup_speaker_threshold_seconds`, default `20`, with an
  initial accepted range of 5–600 seconds.
- The current dataset setting is read when the modal renders. A configuration change takes effect
  the next time the dataset reloads/modal opens; no live cross-tab settings channel is required.
- Overtime begins when `elapsedMs >= thresholdSeconds * 1000`. Reset removes overtime immediately.
  Pausing after the threshold leaves the warning visible but pauses decorative movement; Resume
  continues it.
- At threshold, fire begins at a visible approximately 22% modal height. Heat advances every five
  seconds, reaching the fourth/maximum stage roughly 15 seconds after overtime starts. The edge glow,
  flame layers, and ember density all advance with heat; this is intentionally a strong facilitation
  cue, not a subtle background animation.
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
- Notes may be reordered at any time the session is `active` or `post_standup`. Provide a focusable
  drag handle that supports pointer/touch dragging plus **Arrow Up**/**Arrow Down** movement.
  Dragging is an enhancement, never the only keyboard-accessible mechanism.
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
  SPEAKER_THRESHOLD_SECONDS: 20,
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
- Reorder uses a focusable drag handle with pointer/touch dragging, Arrow Up/Arrow Down movement,
  keyboard boundary feedback, and a polite order-change announcement.

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

1. In Configuration, set the threshold to 20 seconds. Create **Oracle Engineers** and **SEIII**,
   add several team members with overlap, save, reload, and verify exact persistence. Confirm
   `@All Team` is always present but not editable.
2. Start Standup. Confirm the first participant timer begins at zero without a click. Pause for a
   few seconds, Resume, Reset, then advance; confirm the next participant gets a fresh running
   timer.
3. Let/fake the timer cross 20 seconds. Confirm **Over time** appears immediately with a visible
   pixel-fire effect; after five, ten, and fifteen additional seconds, confirm the cue escalates
   through stronger heat stages. Pause, Resume, and Reset.
4. Repeat step 3 with reduced motion and at desktop/narrow widths. Confirm a static warning remains
   understandable and all controls/typeahead overlays remain reachable.
5. Create a note by typing `@`, fuzzy-selecting multiple people/groups, and entering body text.
   Confirm visible chips, resolved names, save, close/reopen, and page reload.
6. Complete the note and reopen it. Confirm checked/unchecked state, gray/strike treatment, text
   status, stable order, and no lost tags.
7. Create several notes. Reorder by drag and by focused-handle Arrow Up/Arrow Down, reload, and verify exact persisted
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
- The overtime threshold defaults to 20 seconds, is configurable and validated in Configuration,
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

## 11. Focused follow-up: `@` mention composer and visual cleanup

**Status:** Implemented and validated by focused automated checks on 2026-08-19

**Added:** 2026-08-19

**Scope:** replace the temporary checkbox/native multi-select audience controls in the post-standup
note composer with the originally specified `@`-triggered local picker; tighten the empty-state
composer layout shown in the current UI; preserve the existing note API, persisted audience
snapshots, session revision behavior, and completed-session read-only rules

**Intended outcome:** the facilitator writes in one compact plain-text composer. The composer starts
with a visible `@All Team` audience chip. Typing `@` at a valid token boundary opens a dark,
planner-consistent overlay containing `@All Team`, configured team pseudogroups, and active team
members. Choosing an option removes the trigger/query text, updates removable audience chips, and
returns focus to the textarea. The action area reads as one coherent form instead of a large
textarea, standalone native checkbox, and full-width button stacked as unrelated blocks.

### 11.1 Verified current behavior and evidence

These are verified facts from the working tree and the supplied screenshot on 2026-08-19:

- [`RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx) implements the
  entire note list and composer in the local `Notes` component. Composer state is split across
  `draft`, `allTeam`, and an array of `member:*` / `group:*` string IDs.
- A new composer defaults to `allTeam=true`. It renders a checked native **All team** checkbox; only
  after unchecking that box does a native multiple `<select>` appear for people and groups.
- [`styles.css`](../packages/frontend/src/styles.css) gives `.standup-note-composer` a one-column
  grid. The textarea, checkbox label, optional multiple select, and `.btn` therefore occupy separate
  stacked rows. No composer-specific action alignment, chip treatment, placeholder styling, hover
  state, or focus-visible rule completes the form treatment.
- The screenshot reflects those rules: the empty composer is visually dominated by a wide
  textarea and a full-width **Add note** button, while audience selection reads as a separate
  checkbox rather than part of the note-entry interaction.
- The screenshot also contains a small warm/red mark below the textarea. This was traced during
  implementation to the overtime fire's full-modal ember layer. The final CSS constrains embers to
  the lower modal edge so the intentional fire remains visible without appearing through composer
  spacing.
- The frontend already has [`Typeahead.tsx`](../packages/frontend/src/components/Typeahead.tsx),
  with local search support, listbox/option semantics, Arrow/Home/End/Enter/Escape behavior,
  click-outside dismissal, and viewport-positioned portal menus. It currently owns and renders a
  single-line `<input>`, so it cannot directly consume a query embedded at the caret of the existing
  textarea without a reusable controlled-menu seam.
- [`fuzzySearch.ts`](../packages/frontend/src/lib/fuzzySearch.ts) already supplies the repository's
  dependency-free fuzzy scoring helper.
- The structured audience contract is already implemented. `createStandupNote(...)` accepts either
  `{ allTeam: true }` or `{ allTeam: false, mentions: [...] }`; the backend resolves groups,
  deduplicates members, snapshots labels, validates the session revision, and returns a fresh
  aggregate. No schema, migration, or endpoint change is required for this cleanup.
- Existing Playwright coverage in
  [`standup-tickets.spec.ts`](../packages/frontend/e2e/standup-tickets.spec.ts) verifies the ticket
  area only. The mention composer paths specified in section 7.3 do not yet have focused E2E
  coverage.

### 11.2 Decisions and invariants

- Keep the note body a controlled `<textarea>` and keep audience selections as structured React
  state. Do not use `contenteditable`, embed HTML in the body, or persist display-only `@label`
  strings as note text.
- Preserve `@All Team` as the initial selection so the existing quick path still works. Render it as
  an actual selected chip, not placeholder text or a checkbox. Selecting any member or group clears
  `@All Team`; selecting `@All Team` clears every other chip.
- A note may contain several distinct member/group chips. Selecting an already-selected option is
  a no-op and must not create duplicate mention payload entries.
- Search only configured groups for the standup's team and active members of that team. Display
  options in category order: **All Team**, groups, people. Within groups and people, apply fuzzy
  score and then stable configured/name order. Use secondary hints such as **Group · 4 people** and
  **Person** rather than concatenating type information into the primary label.
- Open the menu only when the caret is immediately after a valid `@query` whose `@` begins the body
  or follows whitespace/punctuation. Do not trigger inside an email-like token. The query ends at
  the caret and may not cross whitespace. Cursor movement and body edits recompute or close the
  active trigger.
- Choosing an option removes only the active `@query` span. Preserve all other body text and place
  the caret where the removed span began. Dismissing with Escape or clicking outside leaves the
  literal typed text unchanged.
- Keep typing in the textarea while the menu is open. Arrow keys, Home/End, and Enter operate the
  menu; Escape closes it; normal text/editing keys continue to edit the body. After pointer or
  keyboard selection, return focus to the textarea and restore the calculated caret position.
- Keep local search immediate: `debounceMs=0`, no **Searching…** state, and no network calls while
  typing. The full option set is discoverable for a bare `@`.
- Render the menu through the existing viewport overlay strategy so it is not clipped by
  `.standup-modal { overflow: auto; }`. Recalculate on modal/document scroll and viewport resize,
  and choose above/below placement based on available room.
- Preserve create semantics: trim validation, 4,000-character maximum, current
  `expectedRevision`, draft/chips on failure, and reset only after a successful aggregate response.
  **Add note** remains disabled if the body is empty or the audience is empty.
- This slice does not add note editing, pointer drag reorder, new pseudogroup management behavior,
  backend changes, schema changes, notification delivery, or parsing persisted body text as
  executable mentions.

### 11.3 Target interaction and visual contract

The empty/default form should render in this order:

1. A compact textarea with placeholder copy such as **Add a follow-up note… Type @ to choose who
   it’s for.** The body remains the most prominent editable surface, but it should use the existing
   13px control scale, 8px radius, quiet border, `--panel-2`, muted placeholder, hover border, and
   visible accent focus ring.
2. A wrapping audience row containing the selected `@All Team`, group, and person chips. Each
   removable chip has a visible label and a named **Remove [label]** button. If the last chip is
   removed, show muted guidance to type `@` and keep **Add note** disabled.
3. A compact footer row with quiet helper/status copy on the left and one `.btn.primary` **Add
   note** action aligned right. The action must size to its content on desktop and remain easy to
   tap without becoming a detached full-width slab. At narrow widths, allow the row to wrap or make
   the button full-width only when that produces the clearer mobile hierarchy.
4. While an `@query` is active, a portaled menu aligned to the composer/textarea and at least as
   wide as the useful option content. It uses existing typeahead menu tokens and geometry, caps its
   height, scrolls internally, and never produces page-level horizontal overflow.

In the compact active-round rail, use the same component and semantics with tighter spacing rather
than a second composer implementation. In the roomier post-standup stage, let the composer use the
available width but retain the same control sizes and hierarchy. Do not add a new surrounding card
unless rendered comparison proves separation is necessary; whitespace and alignment should do the
grouping first.

### 11.4 Component and helper seams

1. Extract the composer from `Notes` into a focused
   `packages/frontend/src/components/StandupNoteComposer.tsx`. Give it the team-scoped members,
   groups, session identity/revision, save callback/result handling, and `compact` presentation flag;
   keep note-list mutation code in `RunStandupPage.tsx` for this slice.
2. Add pure mention helpers in
   `packages/frontend/src/lib/standupNoteMentions.ts` for:
   - locating a valid trigger/query span from body plus `selectionStart` / `selectionEnd`;
   - removing the selected trigger span while returning the next caret index;
   - building/category-sorting fuzzy options;
   - applying All Team exclusivity and deduplicating selections;
   - converting selected option identities to the existing `StandupNoteAudience` request shape.
3. Refactor `Typeahead.tsx` without breaking existing call sites so its listbox/controller and
   portaled menu can be driven by an external text control. The reusable seam must own option
   loading, active-index bounds, listbox IDs, outside dismissal, placement, and option rendering;
   the existing single-line `Typeahead` continues to compose that seam. The standup textarea owns
   body/caret handling and delegates menu navigation/selection to it. Do not copy the typeahead CSS
   and keyboard logic into a standup-only divergent picker.
4. Update the Standup section of `styles.css` with tightly scoped composer, chip, footer, status,
   and mention-menu rules. Reuse `--panel-2`, `--border`, `--text`, `--muted`, and `--accent`; keep
   radii and padding in the existing 8–12px / 7–12px families. Add no global control override.
5. Keep existing `Notes` consumers unchanged beyond rendering the extracted composer in editable
   active/post-standup states. Completed sessions continue to omit the composer entirely.

### 11.5 State transitions and failure behavior

```text
default chips [All Team]
  -> type valid @query -> menu open/filtering
  -> choose member/group -> remove query, clear All Team, add chip, focus textarea
  -> type another @query -> choose -> append distinct chip
  -> choose All Team -> replace all chips with All Team
  -> remove last chip -> empty audience, Add note disabled
  -> save succeeds -> clear body, restore [All Team], close menu
  -> save fails/stale revision -> retain exact body, chips, and caret-safe closed menu; show error
```

- If group settings are absent or malformed, still offer `@All Team` and active people. The current
  safe parsing behavior remains; malformed settings must not crash Standup.
- If an option becomes invalid before save, keep the draft and chips after the server rejection,
  surface the existing error, and require a fresh explicit selection after options reload. Do not
  silently convert it to All Team.
- Prevent double submission while a create request is pending. The plan assumes a composer-local
  `saving` flag even though the current code does not expose one; label or live status may say
  **Adding…**, and the successful response remains the only reset signal.
- A `409` remains non-destructive to the draft. If aggregate refresh/retry UX is implemented with
  this slice, record it here; otherwise retain the error and do not claim conflict recovery beyond
  what the current API client supports.
- Identify the screenshot's warm/red artifact by inspecting the owning DOM node and stacking
  context. Fix the cause at its source while preserving the intentional overtime fire. Do not hide
  all overflow or remove the effect speculatively.

### 11.6 Accessibility, security, performance, and compatibility

- Associate the textarea with the live listbox using the appropriate combobox/autocomplete ARIA
  contract, including `aria-expanded`, `aria-controls`, and `aria-activedescendant` while open.
  Verify the final textarea/listbox pattern with Playwright accessibility queries and keyboard use;
  do not rely on visual focus alone.
- Announce selection/removal and save failure/success through one scoped polite live region without
  repeating a message for every query keystroke.
- Every chip remove control and menu option is keyboard reachable or correctly participates in the
  textarea's active-descendant pattern. Escape closes only the mention menu before any modal-level
  close behavior.
- Render note bodies and labels as React text. Do not use `dangerouslySetInnerHTML`; mention parsing
  remains local string/index manipulation.
- Use `useMemo`/`useCallback` where needed to keep the local option search stable. Team rosters and
  groups are small, so no virtualization or remote search is warranted.
- The refactored shared typeahead must retain behavior for Icon Picker, Jira Setup, Important Dates,
  Epic Management, and other current consumers. Existing API and CSS class compatibility is an
  explicit regression requirement.
- No migration, concurrency protocol, analytics, or external observability change is required. Do
  not log note bodies, queries, or selected audiences.

### 11.7 Ordered implementation slices

1. **Pure mention model and tests**
   - Add trigger parsing, query replacement, ordering, exclusivity, deduplication, and request-shape
     helpers plus focused Vitest coverage.
   - Exit: edge cases are executable without React, including start-of-body `@`, punctuation and
     whitespace boundaries, email suppression, caret movement, Escape-preserved text, duplicate
     selection, and All Team replacement.
2. **Shared controlled typeahead seam**
   - Extract the controller/menu behavior from `Typeahead.tsx`; keep its public single-line picker
     behavior and styling compatible.
   - Exit: existing typeahead unit/E2E coverage is green, and a textarea caller can control query,
     open state, active option, selection, dismissal, focus return, and portal anchor.
3. **Standup composer integration**
   - Add `StandupNoteComposer.tsx`, replace the checkbox/multiple select in `Notes`, wire existing
     create requests, add pending/error behavior, and restore `[All Team]` only on success.
   - Exit: keyboard and pointer selection create the exact current API payload, and failure retains
     the draft/audience.
4. **Visual refinement and responsive overlay QA**
   - Apply the compact textarea/chip/footer/menu treatment; test both compact rail and full
     post-standup stage; trace and remove the screenshot artifact at its verified source.
   - Exit: desktop and 390px layouts have no clipping or horizontal overflow, all states match the
     repository's visual language, and the overtime effect remains contained and intentional.
5. **Focused browser coverage and regression pass**
   - Add deterministic composer E2E coverage and run the frontend/unit/workspace checks below.
   - Exit: acceptance criteria pass with no shared-Typeahead or standup-ticket regression.

After each implementation slice, update this section's status and the continuation record before
starting the next slice so the durable artifact remains the source of truth.

### 11.8 Verification

Add unit tests, preferably in
`packages/frontend/test/standupNoteMentions.test.ts`, for:

- bare and filtered triggers at start, after whitespace, and after punctuation;
- non-triggering email/word cases, whitespace-crossing queries, no trigger behind the caret, and
  selection-range behavior;
- exact trigger-span removal/caret restoration without damage to surrounding text;
- category order plus fuzzy order, active-member filtering, group counts, and empty queries;
- All Team exclusivity, duplicate prevention, chip removal, and exact audience payloads.

Add a focused Playwright file such as
`packages/frontend/e2e/standup-note-composer.spec.ts` with deterministic route fixtures for:

- default `@All Team` chip and disabled/enabled Add note states;
- bare `@` showing all categories and typed fuzzy filtering;
- keyboard selection with Arrow/Home/End/Enter/Escape and pointer selection;
- multiple group/person chips, duplicate selection, chip removal, and All Team replacement;
- exact create payload, pending double-submit protection, success reset, and server-error draft/chip
  preservation;
- menu placement in the active-round compact rail and post-standup full view;
- click-outside dismissal, focus return, completed-session read-only state, and no modal close on the
  first Escape used to dismiss the menu;
- desktop and 390x844 viewport screenshots/assertions with no menu clipping or horizontal overflow;
- overtime decoration enabled while composing, proving the menu and controls remain above it and
  the unexpected warm/red artifact is absent.

Run from the repository root, invoking `nvm use` before each Node/npm command group:

```text
nvm use
npm --workspace @ecp/frontend test -- standupNoteMentions

nvm use
npm --workspace @ecp/frontend run typecheck

nvm use
npm --workspace @ecp/frontend run e2e -- standup-note-composer.spec.ts

nvm use
npm --workspace @ecp/frontend run e2e -- standup-tickets.spec.ts

nvm use
npm test
npm run typecheck
```

Manual visual verification must cover:

1. Active-round compact rail and post-standup full stage with zero, one, and several saved notes.
2. Default, empty-audience, menu-open, no-results, pending, success, error, completed-session,
   hover, focus-visible, and disabled states.
3. `@All Team`, one group, one person, and mixed group/person selection with long labels and chips
   wrapping naturally.
4. Keyboard-only operation from textarea through selection, chip removal, submission, and back to
   the modal controls.
5. Desktop and 390px viewport behavior near the top and bottom of the scrollable modal, including
   above/below menu placement and scrolling while the menu is open.
6. Overtime and reduced-motion modes, confirming the fire neither leaks through the form nor
   obscures/captures the mention menu.

### 11.9 Acceptance criteria

- The native **All team** checkbox and native multiple select no longer appear in an editable note
  composer.
- A new composer visibly selects `@All Team`; typing a valid `@` opens the complete local audience
  menu without a request; choosing any member/group clears All Team and creates a removable chip.
- Multiple distinct people/groups can be selected, duplicate chips cannot be created, and choosing
  All Team clears every other chip.
- The chosen audience is sent through the existing structured API contract exactly, and successful
  save/reload displays persisted snapshot labels. Failed saves keep the body and chips.
- The textarea, chips, helper/status text, and Add note action form one compact, coherent group in
  both Standup layouts. The button is compact on desktop, focus is visible, and no browser-default
  multi-select styling remains.
- The menu supports pointer, Arrow keys, Home/End, Enter, Escape, click outside, focus restoration,
  listbox semantics, active descendant, portal placement, internal scrolling, and no clipping or
  horizontal overflow at desktop or 390px.
- The screenshot's stray warm/red mark is traced to a concrete DOM/style cause and is absent after
  the fix without disabling the intentional overtime effect.
- Existing Typeahead consumers, standup ticket layout, completed-session immutability, revision
  validation, audience snapshots, and backend tests remain green.

## 12. Focused follow-up: saved-note and composer visual hierarchy

**Status:** Implemented and verified by automated checks; manual product validation remains

**Implemented:** 2026-08-19

**Added:** 2026-08-19

**Scope:** clean up the populated post-standup note area shown in the 2026-08-19 supplied screenshot;
improve the heading/count relationship, saved-note information hierarchy, note actions, and
composer grouping while preserving the implemented `@` mention behavior and every persistence
contract from sections 3 and 11

**Intended outcome:** a saved note reads as one compact, scannable list row: completion control,
body, concise audience/state metadata, and a subordinate action group. The composer reads as the
next deliberate action rather than a large field followed by three disconnected rows. The result
should remain calm and information-dense at both the full post-standup stage and the narrower
active-round rail.

**Implementation record (2026-08-19):** `Notes` now renders a heading/count pair and semantic note
list, with contextual `For …` metadata, a compact keyboard-capable drag handle, and a danger-styled Delete
action. `StandupNoteComposer` now uses one audience/action toolbar and only renders save/error
status when needed. Standup-scoped CSS reduces textarea height, gives the composer a quiet boundary,
styles the native checkbox intentionally, and quiets the disabled Add note action. No API, schema,
or mention-logic changes were made.

**Extension implemented (2026-08-19):** the affected Standup modal heading, note body/metadata,
actions, composer textarea, audience chips, and Add note action now use a larger local type scale.
Each editable note has a pointer/touch drag handle. Moving over the upper or lower half of another
note shows a before/after insertion line; releasing persists the resulting order through the
existing revision-checked reorder API. The focusable drag handle provides the keyboard-accessible
fallback with Arrow Up/Arrow Down, and completed sessions show neither drag handle nor mutation controls.

**Drag-preview refinement (2026-08-19):** the insertion boundary now expands into a compact,
accent-tinted, dashed **Drop note here** slot. The originating row remains subdued while dragging,
so the intended destination is visible without relying solely on a thin line.

**Motion refinement (2026-08-19):** the source fade, destination gap, and drop-slot entrance now
use a brief ease-out transition. Reduced-motion users receive the same states with no animation.

### 12.1 Verified current behavior, screenshot evidence, and root cause

These facts were verified from the working tree and the supplied screenshot on 2026-08-19:

- [`RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx) renders the heading
  as one `<h3>` containing both **Post-standup notes** and an unframed `.hint` count. The screenshot
  therefore reads as the fused title **Post-standup notes 1** rather than a title with secondary
  count metadata.
- Each `.standup-note` is a two-column CSS grid. The checkbox occupies the first column, while the
  body, audience, carry/deferred metadata, and action group are independent children forced into
  successive rows of the second column. With one ordinary note, the audience becomes a prominent
  standalone line and the four actions become another full line.
- Audience labels are emitted without context (`Alfie Zhang` rather than `For Alfie Zhang`), and
  carried/deferred labels would add still more isolated rows. The DOM has no single metadata seam
  that can wrap those facts together.
- Reordering is visually represented by a single compact drag grip beside the checkbox rather than
  action text or arrows. **Defer** and **Delete** use distinct, compact action treatments; Delete
  follows the repository's existing `.link-btn.danger` semantic color.
- The saved-note checkbox has no Standup-specific size, margin, `accent-color`, or focus treatment.
  Its native dark rendering is functional but visually less intentional than nearby controls.
- [`StandupNoteComposer.tsx`](../packages/frontend/src/components/StandupNoteComposer.tsx) renders a
  textarea, a separate audience row, and a separate footer containing persistent helper copy plus
  the primary button. The placeholder already teaches the `@` interaction, so **Type @ to add
  people or groups.** repeats the same guidance and adds an otherwise empty third visual row.
- [`styles.css`](../packages/frontend/src/styles.css) gives the composer a generic grid gap but no
  boundary from the saved-note list. Its `68px` textarea is followed by a `24px`-minimum audience
  row and another footer row, which makes the composer visually taller and more fragmented than its
  simple task requires.
- The global disabled primary style lowers the opacity of the entire filled accent button. In the
  screenshot the unavailable **Add note** action still has a large saturated footprint while its
  label recedes, making the disabled state both prominent and visually muddy.
- The implemented mention picker, audience chips, save/pending/error behavior, portaled overlay,
  and structured audience payload are already covered by
  [`standup-note-composer.spec.ts`](../packages/frontend/e2e/standup-note-composer.spec.ts) and
  [`standupNoteMentions.test.ts`](../packages/frontend/test/standupNoteMentions.test.ts). The issue
  is local markup/CSS hierarchy, not the mention algorithm, API, backend, or database.

Root cause: semantic content that belongs together is emitted as peer grid rows, while repeated
instructional text and equal action styling give every element similar weight. This can be fixed by
introducing explicit heading, content, metadata, and toolbar wrappers and then applying the
repository's existing compact tokens. It does not require a new card, global design token, or data
change.

### 12.2 Decisions, invariants, assumptions, and non-goals

#### Selected visual direction

- Keep the section on the page background; do not wrap either each note or the composer in another
  filled card. Use one quiet divider, compact padding, alignment, and typography to establish
  grouping.
- Split the heading into a flex wrapper containing an unchanged `<h3>` label and the existing
  neutral `.badge` count primitive. Give the section an explicit accessible label relationship;
  avoid announcing the count twice.
- Keep saved notes as a semantic list of compact rows. A row has a completion column and one
  content column; within the content column, render the body first and one wrapping lower line for
  audience/state metadata and actions.
- Prefix audience copy with **For** so `For all team` and `For Alfie Zhang` are understandable in
  isolation. Join carried/deferred state into the same muted metadata line with visual separators
  rather than allocating one row per fact. Preserve the exact stored labels and dates.
- Replace the verbose reorder labels with one compact drag grip beside the checkbox. It is focusable,
  has a descriptive label, supports pointer/touch drag plus Arrow Up/Arrow Down movement, and keeps
  the operation available to assistive technology without adding visual action clutter. Keep
  **Defer**/**Reopen** and **Delete** as text because their consequences are less safely represented
  by ambiguous icons.
- Apply `.link-btn.danger` to Delete. Defer/Reopen remains a secondary link action, not a primary
  button or warning color.
- Keep the textarea as the dominant composer control but reduce its default minimum height into the
  existing compact range (target approximately `56px`, with the compact rail approximately
  `50px`; tune after rendering). Do not remove vertical resize.
- Collapse the stable composer footer into one wrapping toolbar: audience chips/guidance occupy the
  flexible left side and **Add note** sits at the right. Remove the persistent duplicate helper
  sentence. Render a compact live status row only when saving or when an error/success message
  actually exists.
- Give this composer's disabled primary action a local quiet treatment: muted panel/border/text
  colors with no saturated filled footprint. The enabled action continues to use `.btn.primary`.
  Do not change disabled primary buttons globally in this slice.
- At narrow widths, let metadata/actions and chips/button wrap deliberately. The Add note button may
  become full width only at a verified breakpoint where keeping it inline makes chip labels or the
  action unusably narrow.

#### Invariants

- Preserve all note state transitions, ordering requests, revision checks, audience snapshots,
  deferred-note materialization, completed-session read-only behavior, and successful-save reset.
- Preserve the `@` trigger parsing, local option ordering, keyboard interaction, portaled menu,
  selection exclusivity/deduplication, and exact request payload implemented in section 11.
- Keep note bodies and metadata as React text; do not parse or inject markup.
- Keep the checkbox a real native checkbox with its existing accessible state. Styling must not
  replace it with a non-semantic custom control.
- Reuse `--panel`, `--panel-2`, `--border`, `--text`, `--muted`, `--accent`, `--red`, `.badge`,
  `.btn`, and `.link-btn`. Do not introduce hard-coded decorative colors or a new radius family.
- Preserve one-level navigation, filtering, shared capacity, and future multi-epic behavior. This
  work does not touch those product-constitution seams.
- Treat the current dirty working tree as user-owned. Make surgical edits and preserve the
  untracked `packages/backend/packages/` directory.

#### Assumptions and dependencies

- The full stage and compact rail can share one semantic markup structure; the existing `compact`
  class is sufficient for spacing overrides.
- A small local markup refactor in `Notes` is acceptable because no public component API consumes
  its internal note-row DOM.
- Existing `.badge` and `.link-btn.danger` styles are the correct shared primitives. New classes
  should be Standup-scoped when no second consumer exists.
- No icon package is required. Use a text grip glyph or a tiny inline SVG already consistent with
  repository practice; do not add a dependency solely for the reorder affordance.

#### Explicit non-goals

- No edit-in-place, note expansion/collapse, bulk completion, confirmation modal, undo toast, or
  new note state.
- No API, backend, schema, migration, fixture-domain, concurrency, or notification change.
- No redesign of the entire Standup modal, header, fire effect, participant rail, tickets, bandwidth
  check-in, or footer.
- No global rewrite of `.btn`, `.link-btn`, `.badge`, checkbox, textarea, or modal styling.
- No change to audience-selection meaning, group management, or persisted body text.

### 12.3 Exact target structure and behavior

The populated surface should be structurally equivalent to:

```text
Post-standup notes  [1]
────────────────────────────────────────────────────────────
☐  Testing something here
   For Alfie Zhang                 [↑] [↓]  Defer  Delete

   [ Add a follow-up note… Type @ to choose who it’s for. ]
   [@All Team ×]                                  [Add note]
```

The ASCII line represents the existing quiet token border, not a literal character. At a narrow
width the metadata and action group may wrap onto adjacent lines, but the body, metadata, and
actions must still read as one note. The composer toolbar may wrap below the textarea; it must not
create horizontal scrolling or detach the Add note action from its audience state.

Required state treatments:

| State | Target treatment |
| --- | --- |
| No saved notes | Heading shows neutral `0` badge; composer begins without an empty-list card |
| Open note | Normal body; muted `For …` metadata; compact actions |
| Completed note | Checked native control; body recedes/strikes through; metadata remains legible |
| Deferred note | Muted **Deferred to next standup** metadata; action changes to **Reopen** |
| Carried note | **Carried from DATE** shares the metadata line without competing with the body |
| One note | Both reorder controls remain disabled in stable positions, with an intentional quiet disabled style |
| Long body/audience | Natural body wrapping; metadata/chips wrap with no ellipsis that hides required information |
| Empty draft | Quiet disabled Add note action; selected audience remains clear |
| Draft plus audience | Enabled accent Add note action is the only primary action in the composer |
| No audience | Inline **Type @ to choose an audience** guidance replaces the chip area; Add note remains disabled |
| Saving | Prevent double submit; show compact polite **Adding…** status without layout collision |
| Save error | Keep body/audience; render readable local error beneath the toolbar; no global toast required |
| Completed session | No composer or mutation actions; note content/metadata alignment remains intact |
| Mention menu open | Existing portaled listbox remains above the modal/fire and aligned to the textarea |

### 12.4 Component and stylesheet seams

1. In `Notes` within
   [`RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx):
   - introduce `.standup-notes-heading`, a stable heading ID, and a separate `.badge` count;
   - render notes as a semantic `<ul>`/`<li>` list with reset list styling;
   - add `.standup-note-content`, `.standup-note-body`, `.standup-note-lower`, and
     `.standup-note-meta` wrappers;
   - format audience/carry/deferred facts in the metadata wrapper without changing source data;
   - keep mutations and API calls unchanged while adding accessible reorder labels/titles and the
     danger class to Delete.
2. In
   [`StandupNoteComposer.tsx`](../packages/frontend/src/components/StandupNoteComposer.tsx):
   - combine audience and action into a single `.standup-note-composer-toolbar`;
   - replace the always-present helper sentence with conditional live status/error content;
   - retain the existing textarea, chips, listbox ARIA, state, save guard, and portal behavior;
   - if success needs announcement, introduce a transient status only if it can be tested without
     changing the successful reset contract.
3. In [`styles.css`](../packages/frontend/src/styles.css):
   - reset the section heading margin and add the heading/count alignment;
   - replace the peer-row note grid assumptions with the explicit content/lower-line structure;
   - style the native checkbox at the local Standup seam with `accent-color`, compact dimensions,
     margin reset, and `:focus-visible` treatment;
   - add compact reorder-button geometry, metadata wrapping, danger emphasis, composer boundary,
     toolbar layout, conditional status spacing, and local disabled Add note treatment;
   - remove or retire obsolete `.standup-note-add` and old composer-footer rules only after `rg`
     confirms they have no remaining consumer.
4. In
   [`standup-note-composer.spec.ts`](../packages/frontend/e2e/standup-note-composer.spec.ts), extend
   the deterministic fixture to include a populated note and assert structure, accessible action
   names, state styling hooks, wrapping/overflow, and composer status behavior. Keep mention/payload
   assertions intact.

No shared component extraction is planned. If implementation discovers another live consumer for
the exact note-row or compact toolbar pattern, record that discovery before introducing a shared
primitive.

### 12.5 Failure, concurrency, migration, security, accessibility, and observability

- **Failure:** styling must not clear the draft or selected audience. The current local save error
  remains visible and polite; changing wrappers must not move it outside the composer association.
- **Concurrency:** continue disabling submission while `saving`; do not alter optimistic revision
  handling or add retries. Reorder/state mutations keep the current aggregate revision contract.
- **Migration:** none. No persisted shape or snapshot version changes.
- **Security/privacy:** render note bodies, audience labels, and errors as text. Do not log note
  content or audience selections for visual diagnostics.
- **Accessibility:** preserve semantic heading order, list semantics, native checkbox behavior,
  named actions, `aria-live` save/error feedback, visible focus, and a minimum practical pointer
  target for the drag grip. Color may reinforce Delete/disabled/completed state but cannot be the
  only signal.
- **Responsive behavior:** verify long labels and 200% text zoom in addition to viewport width. Do
  not solve wrapping by globally hiding overflow or clipping text.
- **Reduced motion:** no new motion is planned. Existing fire and menu behavior remain governed by
  their current reduced-motion rules.
- **Observability:** no analytics or production logging change. Automated DOM, interaction, and
  screenshot/overflow checks are sufficient for this local presentation change.

### 12.6 Ordered implementation slices

1. **Saved-note semantic structure and hierarchy**
   - Refactor the section heading/count and note row wrappers in `RunStandupPage.tsx`.
   - Add contextual audience copy, inline metadata grouping, accessible compact reorder controls,
     and destructive Delete styling without changing callbacks.
   - Exit: one and several notes render as semantic list rows; all actions call the existing
     mutations with unchanged IDs/revisions; completed/deferred/carried states remain intelligible.
2. **Composer toolbar consolidation**
   - Merge the audience and action rows in `StandupNoteComposer.tsx`; remove duplicated stable helper
     copy; keep conditional live feedback.
   - Exit: default composer is textarea plus one compact toolbar; empty-audience, saving, error, and
     success behavior remains correct; mention selection/payload tests are unchanged.
3. **Scoped responsive styling**
   - Update only the Standup note styles in `styles.css`, using existing tokens and compact
     geometry. Retire obsolete selectors after confirming usage.
   - Exit: full and compact layouts have intentional vertical rhythm, one clear primary action,
     readable disabled/destructive states, and no overflow at desktop, 390px, long-content, or 200%
     text zoom conditions.
4. **Focused regression and visual QA**
   - Extend the Playwright fixture/assertions, run focused unit/type/E2E checks, and manually inspect
     the state matrix below.
   - Exit: section 12 acceptance criteria pass and the durable plan records commands/results,
     screenshots or notable visual findings, deviations, and the next unfinished action.

After every slice, update this section's status and the continuation record before proceeding.

**Completion record (2026-08-19):** all four slices are complete. The focused Playwright fixture
now includes a populated note and asserts the heading/count structure, compact semantic row,
audience context, keyboard-capable drag handle, destructive Delete class, and stable composer toolbar.
Desktop, narrow default, and narrow mention-menu screenshots were inspected with local Chromium;
the compact rail preserved readable wrapping and no horizontal overflow.

**Extension verification record (2026-08-19):** the focused fixture now creates two notes, verifies
the visible drag handles and keyboard boundary feedback, pointer-drags the first note below the second, and
asserts the exact persisted `noteIds` order plus updated rendering. Local Chromium screenshots
confirmed the larger type scale and drag affordance at desktop and 390px widths.

### 12.7 Automated and manual verification

Run from the repository root, invoking `nvm use` before each Node/npm command group:

```text
nvm use
npm --workspace @ecp/frontend test -- standupNoteMentions

nvm use
npm --workspace @ecp/frontend run typecheck

nvm use
npm --workspace @ecp/frontend run e2e -- standup-note-composer.spec.ts

nvm use
npm --workspace @ecp/frontend run e2e -- standup-tickets.spec.ts

nvm use
npm test
npm run typecheck
```

**Completed automated verification (2026-08-19):**

- `npm --workspace @ecp/frontend run typecheck` — passed.
- `npm --workspace @ecp/frontend run e2e -- standup-note-composer.spec.ts` — passed.
- `npm --workspace @ecp/frontend run e2e -- standup-tickets.spec.ts` — passed.
- `npm test` — passed: 42 test files and 346 tests across shared, engine, backend, and frontend.
- `npm run typecheck` — passed across shared, engine, backend, and frontend.

Automated coverage should verify:

- separate heading/count structure and correct singular/plural accessible labeling;
- semantic list rows with named checkbox, keyboard-capable drag handle, defer/reopen, and delete controls;
- drag-handle keyboard boundaries for one, first, middle, and last notes;
- unchanged state/reorder/delete requests and revision values;
- all-team, member/group, carried, deferred, completed, long-body, and long-audience rendering;
- textarea/chip/button toolbar behavior in default, empty-audience, enabled, saving, and error states;
- unchanged mention keyboard/pointer selection, exact create payload, success reset, and error
  preservation;
- document/modal horizontal overflow checks at 1280x900 and 390x844, with the mention menu open and
  closed.

Manual visual validation must inspect:

1. Zero, one, and several notes in both the active-round compact rail and full post-standup stage.
2. One-note disabled arrows, middle-note enabled arrows, Defer/Reopen, Delete, hover, pressed,
   disabled, and keyboard-focus-visible states.
3. All-team and mixed long audiences; carried and deferred metadata combinations; short, wrapped,
   and maximum-practical note bodies.
4. Default, no-audience, mention-menu-open, saving, error, success-reset, and completed-session
   composer states.
5. Desktop, 390x844, and 200% browser text zoom, including textarea resize and modal scrolling.
6. Overtime/reduced-motion modes to confirm the local styling does not regress the contained fire
   or the portaled mention menu's stacking.

### 12.8 Acceptance criteria

- The section title and count are visually distinct and semantically coherent; the UI no longer
  reads as the fused string **Post-standup notes 1**.
- Every saved note reads as one compact row with body first and one subordinate wrapping line for
  `For …`, carry/deferred state, and actions.
- Reorder actions use compact named controls with correct disabled boundaries; Defer/Reopen remains
  clear; Delete is visibly destructive; all existing mutations and revision values are unchanged.
- The completion checkbox looks intentional in the dark interface, remains native and keyboard
  operable, and has visible focus. Completed content remains readable.
- The stable composer contains a textarea and one audience/action toolbar; duplicate `@` guidance
  is removed, while no-audience, pending, and error guidance appears when relevant.
- Disabled Add note is quiet and unmistakably unavailable; enabled Add note is the only primary
  composer action and remains attached to the selected audience.
- Both Standup layouts remain free of clipping and horizontal overflow at desktop, 390px, long
  content, and 200% text zoom. The mention menu remains correctly portaled and positioned.
- Existing note creation, mention selection, audience payloads, reorder/state/delete behavior,
  completed-session immutability, Typeahead consumers, ticket display, and backend contracts do not
  regress.
- No new panel/card, global token, backend/schema change, or unrelated Standup redesign is
  introduced.

## 13. Projection-first post-standup stage with required people

**Status:** In progress; slices 1–2 (required-people derivation and full-stage projection section)
are implemented and verified by focused unit/browser checks. Slices 3–5 remain.

**Added:** 2026-08-19

**Scope:** redesign the full `post_standup` stage shown in the supplied 2026-08-19 screenshot so it
uses the wide modal effectively during screen sharing; derive and display the people required for
the remaining follow-ups from the notes' persisted audiences; replace compact text-heavy note rows
with larger, icon-led note tiles while preserving every existing note mutation and audience
contract

**Intended outcome:** before discussing the notes, everyone can see at a glance who needs to remain
in the conversation and how many open follow-ups involve each person. The notes themselves should
be readable from a shared screen, use the modal's horizontal room rather than leaving a long empty
right edge, and expose completion, reorder, defer, and delete actions through recognizable icons
paired with unambiguous text or accessible names. The active-round compact rail remains compact.

### 13.1 Verified current behavior and evidence

The following facts were verified from the working tree and supplied screenshot on 2026-08-19:

- [`RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx) renders the same
  `Notes` component for the compact active-round rail, the full `post_standup` stage, and the
  completed read-only stage. The existing `compact` prop is therefore the correct seam for
  preventing a projection-focused layout from bloating the active-round rail.
- The full Standup modal already uses `width: min(1200px, calc(100vw - 32px))` and `max-height:
  94vh` in [`styles.css`](../packages/frontend/src/styles.css). The screenshot shows two note rows
  stretching across almost that entire width while their content occupies mainly the left edge and
  actions sit at the far right. The issue is internal layout, not insufficient modal width.
- Saved notes are currently a single-column semantic list. Each row has a small text glyph drag
  handle, a `17px` native checkbox, a `15px` body, `13px` metadata/actions, and no leading visual
  identity beyond the checkbox. This is legible at a personal workstation but not optimized for a
  projected or screen-shared view.
- The composer is full width below the notes and uses a `15px` textarea, `13px` audience chips, and
  a `14px` Add note action. There is no explicit composer heading, so the large empty lower/right
  region in a short note list has little structure.
- [`StandupNote`](../packages/shared/src/domain.ts) already exposes `allTeam`, `memberIds`, and
  ordered snapshot `mentions`. The backend's `audience(...)` implementation in
  [`standup.ts`](../packages/backend/src/db/standup.ts) resolves group tags into a deduplicated
  `memberIds` set when the note is saved. It deliberately leaves `memberIds` empty for `@All Team`.
- The aggregate already includes persisted standup participants with `memberId`, `memberName`, and
  roster `position`. `@All Team` can therefore expand to the actual session roster without another
  request, while direct and group tags can use each note's resolved `memberIds`.
- [`TeamMember`](../packages/shared/src/domain.ts) includes `avatarUrl`, and the repository already
  has a shared [`MemberAvatar`](../packages/frontend/src/components/MemberAvatar.tsx) plus stable
  member colors from [`memberColors.ts`](../packages/frontend/src/lib/memberColors.ts). Required
  people do not need a new avatar implementation.
- `lucide-react` is already a frontend dependency and is used by existing icon-bearing interfaces.
  This redesign can use focused imports such as `MessageSquareText`, `CheckCircle2`, `Circle`,
  `Clock3`, `GripVertical`, `Trash2`, and `Users` without adding a package or inventing glyphs.
- The existing pointer reorder calculation decides before/after from the pointer's vertical half of
  a row. A two-column note grid will require a grid-aware insertion calculation or an equally clear
  alternate drop model; applying CSS columns alone would make pointer ordering ambiguous.

Root cause: the full stage still uses the compact list's one-dimensional information hierarchy.
It has no derived summary for the people involved, no projection-specific type/control scale, and
no layout that turns the available width into readable information groups. The persisted aggregate
already contains the necessary people and note data, so this is a frontend derivation and
presentation problem rather than a schema or API gap.

### 13.2 Decisions, invariants, assumptions, and non-goals

#### Required-people derivation

- “Required people” means the distinct people involved in at least one **open** note in the current
  editable `post_standup` session. Completed notes no longer require discussion; deferred notes are
  explicitly for a later standup. Reopening either state adds its audience back immediately.
- For a note with `allTeam: true`, render one distinct **All team** audience card with the shared
  people icon and its open-follow-up count. Do not expand it into every participant: the card is the
  clearer summary of the built-in whole-team audience.
- For every other open note, use `note.memberIds`, not only `note.mentions`. `memberIds` is the
  persisted, deduplicated expansion of member and pseudogroup tags, so a group tag contributes its
  actual members without being re-evaluated from possibly changed settings.
- Count a person at most once per note, then report the number of open follow-ups involving that
  person. Order people by persisted participant position so the strip does not jump when notes are
  reordered; append any audience member absent from the participant snapshot by display name.
- Resolve display data in this order: session participant name, matching `dataset.members` record,
  matching direct-member mention snapshot, then a visible **Unavailable teammate** fallback. Never
  silently omit a persisted member ID from the required count.
- Use the shared `MemberAvatar` at a projection-friendly size with name and **1 follow-up** / **N
  follow-ups** text for individual people. The All Team card uses the shared people icon rather than
  a misleading list of every team avatar.
- Show the section in the full editable `post_standup` stage. Do not add it to the compact
  active-round rail. Completed sessions remain historical note records and do not claim that people
  are still “required”; redesigning that read-only summary is a separate product decision.
- Keep a stable section with an explicit empty state such as **No one is required — all follow-ups
  are complete or deferred.** This avoids a layout jump and confirms that the derivation succeeded.

#### Projection-first note direction

- In the full stage, render saved notes as a responsive grid of large note tiles: two columns when
  each tile can remain at least approximately `440–480px` wide, one column below that threshold.
  DOM order remains note order, flowing left-to-right then top-to-bottom.
- A tile uses `--panel-2`, a quiet `--border`, the existing 10–12px radius family, and restrained
  padding. This is one of the cases where a card is justified: each note is independently
  actionable, the available width supports side-by-side units, and the current full-width rows are
  difficult to scan on a shared screen.
- Give each tile a clear icon/status rail and content region. Use a note/status icon around
  `24–28px`, a body around `18px` with comfortable line height, metadata/actions no smaller than
  `15px`, and pointer targets at least `40px`. Final values must be tuned in rendered context at the
  target viewports rather than copied blindly into CSS.
- Icons reinforce state and action; they do not replace essential language. Defer/Reopen and Delete
  retain visible text beside their icons in the full stage. Reorder may remain icon-only only with
  its existing descriptive accessible name and tooltip. Completion keeps a real checkbox input or
  equivalent native checkbox semantics while presenting a large `Circle` / `CheckCircle2` visual.
- Open, completed, and deferred notes use distinct icon plus text/state treatment. Do not rely on
  blue/green/yellow/red alone. Completed bodies may remain struck through but must retain sufficient
  contrast for screen sharing.
- Add an explicit **Add follow-up** composer heading with a small note/add icon in the full stage,
  and raise the textarea, chip, and button typography into the same local projection scale. Keep
  the current composer data flow, `@` behavior, and one clear primary Add note action.
- Keep **Finish Standup** as the single modal-level primary action. If the larger content requires
  scrolling at `1280x720`, make the action footer sticky within the modal using opaque token-based
  backing and a quiet top border; do not let it obscure the composer or mention menu.

#### Invariants

- Preserve note create, completion/reopen, deferral/reopen, delete, keyboard reorder, pointer
  reorder, carry-forward, revision checking, finalization, and completed-session immutability.
- Preserve structured mention snapshots and resolved member audiences exactly. The required-people
  summary is derived React state and must never be written back to a note or session.
- Preserve semantic heading order, list order, native control semantics, named actions, visible
  focus, live mutation errors, reduced-motion behavior, and text-only rendering of note bodies.
- Reuse shared tokens, `MemberAvatar`, member color helpers, `.badge`, `.btn`, and `.link-btn` where
  semantics fit. Use tightly scoped Standup classes for the new stage, tiles, and people strip.
- Preserve the one-level navigation and shared-capacity principles in
  [`planner-product-constitution.md`](./planner-product-constitution.md); this work changes neither.
- Treat the dirty working tree as user-owned. Preserve current note/composer/typeahead edits and
  the untracked `packages/backend/packages/` path.

#### Assumptions to validate during implementation

- The requested “larger icon based notes” means icon-led note tiles with larger typography and
  controls, not user-selectable note categories or a persisted icon per note.
- “Required people” is a live facilitation aid for unresolved/open notes rather than a record of
  everyone ever tagged. The state-transition contract below makes this interpretation explicit.
- Two columns will materially improve the common screen-share layout. If rendered inspection at
  `1280x720` shows tiles are too narrow for long names/actions, record the evidence and use one
  wide projection row with a constrained readable text measure instead of shrinking the type.

#### Explicit non-goals

- No persisted per-note icon, note category/type selector, new note state, priority, due date,
  assignee workflow, notification, attendance tracking, or “required” acknowledgement.
- No backend, API, database, migration, final-snapshot, Jira, pseudogroup configuration, or
  analytics change.
- No redesign of the active speaker/timer, bandwidth check-in, ticket list, overtime fire,
  navigation, or general modal system.
- No removal of visible action labels solely to achieve an icon-only aesthetic.
- No edit-in-place, bulk action, note filtering, or separate required-people management UI.

### 13.3 Exact target behavior and state transitions

The full editable stage should be structurally equivalent to:

```text
Post-standup notes
NF Sprint 69 · 2026-08-19 · Post-standup

Required people                                                2 people
[AM  Ali McNamara · 1 follow-up] [AZ  Alfie Zhang · 2 follow-ups]

Follow-up notes                                                2 notes
┌────────────────────────────────┐  ┌────────────────────────────────┐
│  ○  note  Testing another thing│  │  ○  note  Testing something   │
│           Ali, Alfie            │  │           Alfie Zhang         │
│  grip     Defer  Delete         │  │  grip     Defer  Delete       │
└────────────────────────────────┘  └────────────────────────────────┘

Add follow-up
[ Add a follow-up note… Type @ to choose who it’s for.             ]
[@All Team ×]                                             [Add note]
                                                        [Finish Standup]
```

The words `note` and `grip` in this wireframe stand in for Lucide icons and accessible controls;
implementation does not render platform emoji or these placeholder words.

Required-people transitions:

```text
create open note -> add/increment people or the All team card
complete open note -> remove/decrement its people
reopen completed note -> add/increment its people
defer open/completed note -> remove/decrement its people
reopen deferred note -> add/increment its people
delete open note -> remove/decrement its people
reorder note -> people and counts unchanged
finish standup -> required-people live section is no longer shown
```

Required state treatments:

| State | Required-people section | Note tile |
| --- | --- | --- |
| No notes | Stable empty message | No empty card grid; composer follows |
| Open member note | One tile per resolved person with count | Open status icon, full-contrast body |
| Open pseudogroup note | One tile per persisted `memberIds` entry | Group snapshot label may remain in metadata |
| Open All Team note | One icon-led **All team** card with its follow-up count | **All team** remains visible metadata |
| Same person on several notes | One person tile with pluralized count | Notes remain independent tiles |
| Completed note | Its audience is excluded | Check icon, **Completed** text, readable subdued body |
| Deferred note | Its audience is excluded | Clock/defer icon and **Deferred to next standup** text |
| Carried open note | Its audience is included | **Carried from DATE** remains visible |
| Unknown persisted member | Visible fallback person/count | Stored audience metadata remains visible |
| Mutation pending/error | Keep last confirmed summary until aggregate response | Existing control guard/error remains; no optimistic count drift |
| Completed session | Section omitted | Read-only large note presentation may remain, with no mutation controls |

### 13.4 Component and helper seams

1. Add a pure helper such as
   `packages/frontend/src/lib/standupRequiredPeople.ts`:
   - accept the current notes, persisted participants, and team members;
   - filter to open notes, aggregate `allTeam` into one audience-card count, consume resolved
     `memberIds`, deduplicate within each note, resolve display records, and return stable roster
     order;
   - keep React, DOM, and API concerns out of the helper so edge cases receive focused unit tests.
2. In `Notes` within
   [`RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx):
   - introduce an explicit full-stage/projection mode rather than inferring presentation from
     unrelated session state throughout the row;
   - derive required people with `useMemo` and render a labelled `RequiredPeople` section only for
     full editable post-standup;
   - render shared avatars with the stable member color map and visible names/counts;
   - refactor note-row markup enough to support an icon/status rail, large tile content, and
     icon-plus-text actions while keeping callbacks and aggregate revisions unchanged;
   - keep the compact rail markup/class path intentionally compact, even if it shares semantic
     subcomponents with the tile.
3. Either add a small local `StandupNoteIcon` component beside `RunStandupPage.tsx` or import the
   focused Lucide icons directly. Do not add an icon registry or persisted icon model for this
   fixed semantic set.
4. In
   [`StandupNoteComposer.tsx`](../packages/frontend/src/components/StandupNoteComposer.tsx):
   - add an optional full-stage heading/presentation hook without duplicating composer logic;
   - preserve textarea/listbox ARIA, chips, payload construction, pending guard, failure retention,
     successful reset, and portaled menu placement.
5. In [`styles.css`](../packages/frontend/src/styles.css):
   - add scoped required-people strip, person tile, projection note grid/tile, icon rail, larger
     action/control, composer heading, and optional sticky footer rules;
   - keep default and `.compact` rules explicit so desktop projection sizing cannot leak into the
     active-round rail;
   - collapse the grid to one column before readable line length or action targets are compromised;
   - preserve the fire layer's stacking context and Typeahead portal behavior.
6. Extend
   [`standup-note-composer.spec.ts`](../packages/frontend/e2e/standup-note-composer.spec.ts) with
   deterministic member, group-expanded, All Team, completed, deferred, and unknown-member cases.
   Add a focused unit file such as
   `packages/frontend/test/standupRequiredPeople.test.ts` for aggregation and state transitions.

If a `RequiredPeople` view becomes reusable outside Standup during implementation, record the live
second consumer before extracting it. The derivation helper may be shared immediately because it
has a stable domain purpose; the visual section should remain local until reuse is real.

### 13.5 Failure, concurrency, migration, security, accessibility, and observability

- **Failure:** required people derive only from the last confirmed aggregate. If completion,
  deferral, reopen, or deletion fails, the relevant person remains in the summary and the existing
  error stays visible; do not optimistically show a false attendance requirement.
- **Concurrency:** preserve the session revision on every mutation and let the returned aggregate
  drive both tiles and people. Do not cache derived counts across aggregates or add an independent
  fetch that can race note mutations.
- **Migration:** none. `memberIds`, `allTeam`, participants, names, and avatars already exist in the
  current contracts. A discovered missing case must be recorded before proposing persistence work.
- **Security/privacy:** note bodies, person names, snapshot labels, and mutation errors remain React
  text. Do not log note audiences or expose hidden IDs in the UI. Existing avatar URL handling is
  reused without adding a new remote image source.
- **Accessibility:** people are a semantic labelled list, not a row of unnamed avatars. Follow-up
  counts are text. Icons used only for decoration are `aria-hidden`; icon-only controls retain
  precise names, tooltips, visible focus, and at least `40px` targets. The completion control keeps
  checkbox semantics and its checked state. Visual tile order equals DOM/tab order.
- **Screen sharing and zoom:** prioritize contrast, visible names, and line wrapping over density.
  Verify at 100%, 150%, and 200% browser zoom; never clip note bodies, person names, counts, or
  action labels to preserve a two-column grid.
- **Responsive behavior:** the note grid, person strip, composer toolbar, and footer wrap without
  page-level horizontal scrolling. At narrow widths the layout becomes one column and does not
  retain oversized desktop padding.
- **Reduced motion:** the redesign adds no required motion. Existing reorder preview transitions
  remain disabled under `prefers-reduced-motion`; status meaning is still visible.
- **Observability:** no product analytics or production logging. Unit derivation tests, interaction
  assertions, viewport/zoom screenshots, and overflow checks are the appropriate evidence.

### 13.6 Ordered implementation slices

1. **Required-people domain derivation**
   - Add the pure helper and unit tests for member tags, expanded groups, All Team, duplicate
     audiences, open/completed/deferred states, unknown members, note deletion, and stable order.
   - Exit: one deterministic function returns exact people/counts from an aggregate without an API
     or schema change.
2. **Required-people projection section**
   - Add the full-stage mode, render the labelled avatar/name/count list and empty state, and wire
     it to confirmed aggregate updates.
   - Exit: create/complete/reopen/defer/delete transitions update the visible people exactly as
     specified; compact and completed views do not show a misleading required list.
3. **Large icon-led note tiles**
   - Refactor the full note surface into a responsive semantic grid; add state/note/action icons,
     larger type and targets, and readable state metadata while preserving visible action labels.
   - Adapt pointer drop targeting for two-dimensional DOM order, or use a rendered and documented
     one-dimensional fallback if the grid interaction cannot be made unambiguous. Keep Arrow
     Up/Down reorder fully operable.
   - Exit: tiles render in stable DOM order, all mutations send unchanged IDs/revisions, and open,
     completed, deferred, carried, long-content, drag, focus, and read-only states are clear.
4. **Composer, footer, and responsive rhythm**
   - Add the full-stage composer heading and projection scale; tune spacing and optionally pin the
     Finish footer only if `1280x720` inspection proves it improves access without covering content.
   - Exit: the modal uses its width well, keeps the primary actions attached to their scopes, and
     has no clipping at desktop, narrow, or zoomed layouts.
5. **Regression and visual QA**
   - Extend focused Playwright fixtures/assertions, run the unit/type/E2E/workspace checks, inspect
     the manual state matrix, and record results and deviations here.
   - Exit: section 13 acceptance criteria pass and the continuation record identifies any remaining
     manual product validation rather than implementation work.

After every slice, update this section's status, implementation record, verification evidence, and
continuation record before beginning the next slice.

**Implementation record (2026-08-19, slice 1):** added
[`standupRequiredPeople.ts`](../packages/frontend/src/lib/standupRequiredPeople.ts), a pure frontend
derivation that consumes the returned notes, persisted participants, and current member display
metadata. It aggregates only open notes, retains All Team as one distinct icon-led audience count,
uses saved resolved `memberIds` for direct/group tags, deduplicates a person within one note, orders people by
participant position, and surfaces snapshot/unknown-member fallbacks. Focused Vitest coverage in
[`standupRequiredPeople.test.ts`](../packages/frontend/test/standupRequiredPeople.test.ts) passes
for direct/group audiences, All Team, completed/deferred/reopened states, duplicates, roster order,
and unavailable people. No API, schema, or UI markup has changed yet.

**Implementation record (2026-08-19, slice 2):** `Notes` now enables a dedicated projection mode
only for the editable full `post_standup` stage and renders a labelled **Required people** section
before the saved notes. It uses the pure derivation, shared `MemberAvatar`, and stable member colors
to show each open-note audience member with a visible name and singular/plural follow-up count;
the section instead shows a clear empty state when no open audiences remain. The active compact rail
and completed historical sessions intentionally omit the section. Added a deterministic Playwright
case that verifies direct audiences plus the one-card All Team summary and exclusion of a completed note. `tsc`, focused
Vitest, and the focused Chrome-fallback Playwright suite pass.

### 13.7 Automated and manual verification

Run every Node-based command from the repository root after selecting the repository's declared
Node version:

```text
nvm use
npm --workspace @ecp/frontend test -- standupRequiredPeople standupNoteMentions

nvm use
npm --workspace @ecp/frontend run typecheck

nvm use
npm --workspace @ecp/frontend run e2e -- standup-note-composer.spec.ts

nvm use
npm --workspace @ecp/frontend run e2e -- standup-tickets.spec.ts

nvm use
npm test
npm run typecheck
```

Focused automated coverage must assert:

- exact people and pluralized counts for direct members, pseudogroup-expanded `memberIds`, and the
  distinct All Team card;
  mixed/duplicate audiences, and unknown persisted members;
- exclusion and reinclusion across complete, defer, reopen, delete, and create aggregate responses;
- required-people omission in compact and completed stages plus the full-stage empty state;
- semantic list/heading relationships, visible member names, avatars/fallbacks, note count badges,
  icon accessibility, checkbox semantics, and named action controls;
- two-column presentation at a wide target viewport and one-column presentation below the chosen
  breakpoint without changing DOM order;
- exact reorder/state/delete/create request bodies and expected revisions after the markup change;
- no document/modal horizontal overflow and no clipped mention menu at desktop and `390x844`.

Manual visual verification must cover:

1. The supplied two-note scenario at `1440x900` and the common screen-share constraint `1280x720`.
2. Browser zoom at 100%, 150%, and 200%, including long note bodies and long person/group names.
3. Zero, one, two, and at least six notes; zero, one, and enough required people to wrap the strip.
4. Direct, pseudogroup, All Team, overlapping group/member, inactive, and unavailable-person data.
5. Open, completed, deferred, carried, read-only, dragging, drop-target, pending, failure, disabled,
   hover, and keyboard-focus states.
6. Keyboard-only note completion, reorder, defer/reopen, delete, composer mention selection, Add
   note, and Finish Standup flow.
7. Reduced motion and overtime fire together with the note grid, people strip, sticky footer if
   used, and open mention menu.

### 13.8 Acceptance criteria

- The editable full post-standup stage contains a clearly labelled **Required people** section
  before the notes. Every person involved in an open follow-up appears once with a visible name,
  avatar/fallback, and accurate singular/plural follow-up count.
- Individual tags use their member, group tags use the persisted resolved `memberIds`, and All Team
  is one icon-led audience card. Overlap never double-counts a person for one note.
- Completing, deferring, reopening, deleting, or creating a note updates required people from the
  confirmed returned aggregate with no stale or optimistic mismatch. Reordering changes no counts.
- The required section has an explicit zero state, never hides unknown persisted members silently,
  and is absent from the compact active-round and completed historical stages.
- At a wide screen-share viewport, notes use a readable responsive tile layout rather than sparse
  full-width rows. At narrower/zoomed widths they become one column before content or controls are
  compressed.
- Note bodies are approximately `18px` in the final rendered full stage, supporting information and
  actions are at least `15px`, key icons are approximately `24–28px`, and interactive icon targets
  are at least `40px`; exact tuned values are recorded after visual QA.
- Icons clearly reinforce note, completion, deferred, reorder, and destructive states. Visible text
  or accessible names make every action and state understandable without recognizing the icon or
  distinguishing color.
- The full composer is visibly introduced as **Add follow-up**, uses the larger local scale, keeps
  `@` selection and failure retention intact, and does not compete with **Finish Standup** for
  modal-level primary hierarchy.
- Pointer and keyboard reorder, completion, defer/reopen, delete, create, Finish Standup, revision
  handling, immutable completed sessions, mention payloads, Typeahead overlay, and overtime fire do
  not regress.
- The full stage has no horizontal overflow or clipped required content at `1440x900`, `1280x720`,
  `390x844`, or 200% zoom, and the active-round compact rail retains its current density.
- No backend/schema/API change, global token rewrite, persisted icon model, or unrelated Standup
  redesign is introduced.

## 14. Walk-off audio synchronized with fire

**Status:** implemented through Slice 5 on 2026-08-20; consolidated manual browser/audio validation remains pending.

**Requested outcome:** allow a team to upload and select a default MP3 walk-off song. A member can
inherit that default, select a different uploaded song, or explicitly opt out. Once the facilitator
enables audio for the open Standup modal, the current member's resolved song starts when overtime
and fire begin and becomes progressively louder from the same heat stages that drive the fire.

The term **walk-off song** is used below for the requested “walk of song.” This feature is an
optional facilitation cue. It is not performance data and must never make the timer, fire, speaker
advance, note workflow, or Standup completion depend on successful media playback.

### 14.1 Verified repository baseline

These findings were verified in the repository before writing this section:

- `RunStandupPage.tsx` owns the modal and participant transitions. `StandupSpeakerTimer.tsx`
  derives the current `overTime`, `paused`, and integer `heat` values and reports them upward. The
  timer uses a monotonic clock and is not persisted.
- The current fire has four heat stages. It starts at the configured overtime threshold, advances
  every five seconds, and reaches maximum heat about 15 seconds after overtime starts. There must
  remain one heat calculation rather than a separate audio timer that can drift.
- The backend uses Fastify and `better-sqlite3`. Routes are registered in `server.ts`, persistent
  schema is created by `db/schema.ts`, and older files receive additive changes in
  `db/database.ts`.
- The SQLite database file is deliberately the shareable application unit. There is no existing
  media library, upload pipeline, multipart dependency, static-media directory, or audio playback
  abstraction.
- Database download already copies the SQLite file and would therefore include BLOB data. Database
  import accepts raw `application/octet-stream`, stages the uploaded file, reads its domain data,
  and writes that data into the current database. Focused audio tables outside `DomainDataset`
  would not be restored unless import explicitly copies them.
- The database import body limit is currently 64 MiB. It is too small once several songs are part
  of a shareable database and must be deliberately raised with bounded per-track and library caps.
- Global, team, and epic settings are stored through the existing settings contract. There is no
  member setting scope. Adding a fake member scope would weaken the shared settings type and is not
  necessary for this focused relationship.
- Configuration already uses the shared `Typeahead`, existing dark-surface tokens, avatars, compact
  panels, and focused edit controls. The audio library and overrides should extend those patterns
  rather than add a dense JSON editor or a permanent form for every member.
- CORS currently allows only `Content-Type`; a raw upload that carries a safe display name in a
  header requires an explicit allow-list update.

### 14.2 Product decisions, assumptions, and non-goals

#### Resolution and ownership

- A **team default** is optional. With no team default, members who inherit have no song.
- A member has exactly one of three effective modes:
  1. **Inherit team default** — represented by no member override row.
  2. **No song** — an explicit `off` override that wins over the team default.
  3. **Custom song** — an explicit `track` override that references one uploaded track.
- “Overridable” means a per-member override in this release. It does not mean a one-session song
  picker, a per-session default, a personal volume curve, or a live override during a speaker turn.
- The team default and overrides are facilitation preferences, not historical Standup facts. They
  are not copied into `StandupSession`, final snapshots, notes, analytics, logs, or reports.
- Tracks are reusable library records. The same uploaded track can be a default or override for
  several teams and members without duplicating the MP3 bytes.
- Overrides for inactive members remain stored so reactivation restores their choice. The
  Configuration UI visually separates or collapses inactive members rather than deleting data.
- Configuration changes take effect the next time the Standup modal opens. No live cross-tab or
  mid-turn configuration channel is required.

#### Playback and volume

- Audio does not start when the speaker turn starts. It starts at the overtime threshold, exactly
  when heat changes from 0 to 1 and the fire appears.
- The timer's existing heat integer is the only progression input. Audio must not calculate its own
  elapsed duration or schedule a second sequence of heat changes.
- Use this initial fixed gain curve, indexed by heat: `0 → 0`, `1 → 0.16`, `2 → 0.32`,
  `3 → 0.55`, `4 → 0.80`. Maximum gain is intentionally capped below 100%. Product tuning changes
  this single constant and its tests, not CSS timing or separate magic values.
- Apply gain changes through a Web Audio `GainNode`, ramping to the new value over approximately
  350 ms. This prevents abrupt jumps while still making each five-second increase unmistakable.
- The song loops if it is shorter than the overtime period. A member transition always stops and
  rewinds the old song before resolving the new member.
- **Pause** pauses the song at its current playback position and freezes fire motion. **Resume**
  continues it. **Reset**, participant advance/skip, modal close, transition to `post_standup`, and
  completed state pause, rewind, and set gain to zero.
- If the tab is backgrounded, the monotonic timer remains authoritative. When callbacks resume,
  fire and gain catch up to the current heat rather than replaying missed stages.
- `prefers-reduced-motion` keeps the existing static fire treatment but does not silently mute
  audio. Sound has its own explicit enable/mute controls because motion and sound preferences are
  different accessibility needs.

#### Browser permission and screen sharing

- Browsers may reject programmatic playback without a user gesture. The modal therefore shows an
  explicit **Enable walk-off audio** control when at least one resolvable track exists. Enabling it
  creates/resumes the audio context and primes playback for that modal instance.
- Permission is modal-local, intentionally not implied by an old local-storage preference. Each
  newly opened Standup asks for a fresh, understandable user gesture before it can make sound.
- After enablement, the current and later resolved songs start automatically at the fire threshold.
  A compact **Mute** control remains available throughout the active round.
- A rejected `play()` call, unavailable audio device, decode failure, or network/content failure
  produces a small non-blocking status with **Retry**. Fire and timer behavior continue unchanged.
- Audio plays only in the facilitator's browser. Whether remote viewers hear it depends on the
  browser/meeting application's “share tab/system audio” setting; the application cannot guarantee
  or silently configure that setting.

#### Deliberate non-goals

- MP3 (`audio/mpeg`) is the only accepted format in the first release. There is no WAV, M4A, OGG,
  transcoding, waveform generation, clipping, normalization, ID3 editor, playlist, shuffle, or
  start-offset editor.
- There are no Spotify, Apple Music, YouTube, remote URL, or external CDN integrations. Avoiding
  URLs prevents SSRF/CORS behavior, disappearing tracks, and a second backup model.
- The application ships no copyrighted default song. Users supply audio they are authorized to
  use; Configuration should state that responsibility briefly near upload.
- There is no per-track, per-team, or per-member volume customization in the first release. The
  fixed safe curve plus modal mute is the full volume surface.
- There is no server-side playback, device synchronization, remote audience control, playback
  analytics, or storage of who heard which track.

### 14.3 Persistence model and invariants

Use focused tables rather than stretching generic settings or embedding base64 in JSON. Add all
three definitions to `SCHEMA_SQL`. `openDatabase` executes that idempotent schema before `migrate`,
so the same `CREATE TABLE IF NOT EXISTS` statements also add these whole tables to older database
files; no redundant table-creation block or `ALTER TABLE` step is required. Prove both fresh and
older-file paths in migration tests.

```sql
CREATE TABLE IF NOT EXISTS standup_audio_track (
  id                TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type         TEXT NOT NULL CHECK(mime_type = 'audio/mpeg'),
  byte_length       INTEGER NOT NULL CHECK(byte_length > 0),
  sha256            TEXT NOT NULL UNIQUE,
  audio_blob        BLOB NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS standup_audio_team_default (
  team_id    TEXT PRIMARY KEY REFERENCES team(id) ON DELETE CASCADE,
  track_id   TEXT NOT NULL REFERENCES standup_audio_track(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS standup_audio_member_override (
  member_id  TEXT PRIMARY KEY REFERENCES team_member(id) ON DELETE CASCADE,
  mode       TEXT NOT NULL CHECK(mode IN ('track', 'off')),
  track_id   TEXT REFERENCES standup_audio_track(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  CHECK(
    (mode = 'track' AND track_id IS NOT NULL) OR
    (mode = 'off' AND track_id IS NULL)
  )
);
```

Persistence invariants:

- `audio_blob` and `byte_length` are checked together on insert; API metadata never includes the
  BLOB or a base64 representation.
- `sha256` is calculated server-side from the exact uploaded bytes and prevents duplicate storage.
  Track IDs are generated server-side with the repository's existing ID convention.
- Display name and original filename are plain text, trimmed, control-character-free, and length
  bounded. They are rendered as text, never HTML.
- Deleting a team or member cascades its assignment. Deleting a referenced track is rejected with
  HTTP 409; assignments are never silently cleared. The user must change the references first.
- Assignment writes run in one transaction. Every referenced track must exist, every member must
  belong to the target team, and the team must exist before any row changes.
- Absence has meaning: no team-default row means no default; no member-override row means inherit.
  Do not materialize redundant `inherit` rows.
- Jira/domain sync does not clear, rewrite, export, or recreate these tables. A sync that updates a
  member's ordinary fields leaves their audio override intact.

### 14.4 API and media delivery contract

Create a focused backend route module such as `routes/standup-audio.ts` and a focused persistence
module such as `db/standup-audio.ts`. Register it in `server.ts`. Keep raw media concerns out of the
ordinary configuration settings route.

#### Shared response types

```ts
interface StandupAudioTrackSummary {
  id: string;
  displayName: string;
  originalFilename: string;
  mimeType: 'audio/mpeg';
  byteLength: number;
  createdAt: string;
}

type StandupAudioMemberMode = 'inherit' | 'off' | 'track';

interface StandupAudioMemberAssignment {
  memberId: string;
  mode: StandupAudioMemberMode;
  trackId: string | null;
}

interface TeamStandupAudioSettings {
  teamId: string;
  defaultTrackId: string | null;
  memberAssignments: StandupAudioMemberAssignment[];
}
```

The read model may additionally return resolved track summaries for convenience, but track content
must always use its own endpoint.

#### Track library endpoints

- `GET /api/standup/audio-tracks` returns summaries ordered case-insensitively by display name and
  then creation time. It never selects or serializes `audio_blob`.
- `POST /api/standup/audio-tracks` accepts raw `audio/mpeg` bytes. Use `X-ECP-Track-Name` for the
  user-facing display name and `X-ECP-Track-Filename` for the original filename, with UTF-8 values
  URI-encoded by the client if required by header rules. Add only those names to the CORS allowed
  header list.
- Set a 12 MiB per-track body limit and a 128 MiB aggregate library limit. Check the body is
  non-empty, declared as `audio/mpeg`, has an `.mp3` original filename, and begins with either an
  ID3 header or a valid MPEG frame sync. This is pragmatic format screening, not a security claim
  that the media has been fully decoded.
- A successful upload returns `201` plus the summary. An existing SHA-256 returns `409` with the
  existing track summary so the client can select it. Invalid format/name is `400`, per-track or
  library-size overflow is `413`, and an unexpected storage error is `500` without logging bytes.
- `GET /api/standup/audio-tracks/:trackId/content` returns `audio/mpeg`, `Content-Length`, an ETag
  derived from SHA-256, `Cache-Control: private, max-age=3600`, and `Content-Disposition: inline`.
  Support `Range: bytes=...`, `Accept-Ranges: bytes`, `206`, and `416` so browsers can seek and loop
  without repeatedly transferring the entire BLOB. Do not return partial content outside the
  validated byte bounds.
- `DELETE /api/standup/audio-tracks/:trackId` returns `204`, `404`, or `409` when referenced. The
  `409` response identifies the blocking team/member assignment summaries but does not include
  unrelated personal data.

#### Team assignment endpoints

- `GET /api/teams/:teamId/standup-audio` returns the optional default plus explicit member
  overrides. The frontend derives inherited effective values with a shared pure resolver.
- `PUT /api/teams/:teamId/standup-audio` replaces that team's default and explicit overrides in
  one transaction. Its request uses `defaultTrackId: string | null` and member entries limited to
  `off` or `track`; omitted members inherit. Reject duplicate member IDs, an `off` entry with a
  track, a `track` entry without one, a foreign-team member, or a missing track with `400`/`404` and
  no partial write.
- Return the confirmed aggregate after write. The frontend updates from that response rather than
  assuming its request became the stored state.
- Concurrent assignment saves use the application's existing last-write-wins configuration
  semantics. Duplicate concurrent uploads converge through the unique SHA-256 constraint.

### 14.5 Database snapshot, import, and capacity behavior

- Ordinary database download needs no new export format: because MP3s are BLOBs in SQLite, the
  copied database file includes tracks and assignments automatically.
- Extend `importDatabaseFromBuffer` replacement semantics to detect the three optional audio tables
  in the staged incoming database. Within the same import transaction, clear current assignment
  rows before tracks, copy valid incoming tracks, then team defaults and member overrides after
  their referenced domain rows exist.
- Importing an older database with no audio tables deliberately produces an empty audio library and
  no assignments. It must not retain songs from the database being replaced.
- Reject malformed audio rows or broken references and roll back the whole import. Do not commit
  the normal domain data while leaving audio in a half-replaced state.
- Include track/default/override counts in the import result summary so restore behavior is
  observable without exposing media names or bytes.
- Raise the raw database import limit from 64 MiB to 256 MiB. The 128 MiB audio-library and 12 MiB
  track caps keep normal databases materially below that ceiling while leaving space for planning
  data, SQLite overhead, and future growth.
- The existing JSON fixture/domain dataset path remains audio-free. Synthetic data generation and
  Jira sync must not create or remove tracks. The SQLite snapshot remains the supported way to move
  an audio-enabled installation.

### 14.6 Frontend configuration experience

Add a dedicated **Walk-off audio** panel in Configuration. It should use existing section spacing,
surface tokens, typography, buttons, `Typeahead`, and `MemberAvatar`; do not append the feature to
the already dense Standup status fields or expose raw IDs/JSON.

#### Track library

- The panel begins with a compact explanation: uploaded songs are stored in the shareable database,
  play only after the facilitator enables audio, and should be files the user is allowed to use.
- Show each track as a restrained row with a `Music` icon, readable display name, secondary
  filename/file size, **Preview/Stop**, and **Delete**. Icons reinforce rather than replace labels.
- Upload uses a labelled file input accepting `.mp3,audio/mpeg`, an optional prefilled display-name
  field derived from the filename, and a clear upload button/progress state. Do not optimistically
  add the row before the server confirms it.
- Only one preview may play at once. Preview begins only on click, uses a fixed safe gain near 0.35,
  and stops when another preview starts, the panel unmounts, or the user navigates away.
- Upload validation explains the MP3-only and 12 MiB constraints before submission. Duplicate,
  capacity, invalid-format, and referenced-delete errors stay next to the relevant track/action.

#### Team default and member overrides

- Choose the team default with the shared searchable `Typeahead`. Include **No default song** as an
  explicit first option and show the current selection as a compact summary.
- Below it, show members as readable summary rows with avatar, name, and one of **Uses team
  default**, **No song**, or the custom track name. Keep a single **Edit** action per row rather than
  three always-visible selectors for every member.
- **Edit** opens a small focused dialog or anchored panel with three radio-style choices:
  **Inherit team default** (recommended/default), **No song**, and **Custom song**. Selecting custom
  reveals the same track `Typeahead`. Save and Cancel are explicit; invalid custom selection cannot
  save.
- Active members appear first. Inactive members are visually subdued and collapsed behind a count,
  but remain editable and are never silently removed.
- Save the default and explicit overrides as one team aggregate, retain local edits on failure, and
  replace local state with the server-confirmed response on success.
- At narrow widths, rows stack and actions remain at least 40px targets. Typeahead overlays must
  escape panel clipping and remain keyboard navigable, following the established component.

### 14.7 Runtime playback design

Create a focused hook/controller, for example `useStandupWalkOffAudio`, rather than spreading
`AudioContext`, element, and cleanup branches through `RunStandupPage`.

Inputs:

- active modal/stage, current member ID, resolved track ID/content URL;
- current timer `heat`, paused state, participant turn identity;
- modal-local enabled and muted states.

Outputs:

- `enable()`, `retry()`, and `toggleMute()` controls;
- status: `unavailable | disabled | ready | playing | paused | muted | blocked | error`;
- concise error/status copy for the modal control.

Internal state and lifecycle:

1. Keep one `HTMLAudioElement`, one lazily created `AudioContext`, one media-element source, and one
   `GainNode` per mounted controller. Reuse them instead of creating a new graph at every heat step.
2. `enable()` runs from the user's click, creates/resumes the context, connects the graph once, and
   primes the current audio element. Do not emit audible sound before heat 1.
3. Resolve effective track with a pure function: custom member track wins; `off` yields none;
   otherwise use the team default. A missing assignment or track is `unavailable`, not an error.
4. On participant/track identity change, pause, set gain to 0, reset `currentTime`, replace `src`,
   call `load()`, and wait for heat plus enablement before playback.
5. At heat 1–4, if enabled, unmuted, and not paused, call `play()` and ramp the `GainNode` to the
   fixed target. Heat 0 always ramps immediately to zero, pauses, and rewinds.
6. Pause preserves `currentTime`; modal reset/advance/close does not. Mute ramps to zero but may let
   the element continue so unmute stays synchronized; close/unmount always stops and rewinds.
7. Catch every `play()` promise. A failure changes only audio status and presents Retry; it must not
   reject a participant mutation or propagate into the modal error boundary.
8. Remove event listeners, disconnect nodes, clear `src`, and close the audio context on unmount.
   Guard late media events so an old member cannot overwrite the new track's status.

The modal control is compact and subordinate to timer controls: a music icon, **Enable walk-off
audio** before permission, then Mute/Unmute and a short status. It remains readable while screen
shared but does not compete with **Next**, **Skip**, or **Finish Standup**. Fire retains visible
**Over time** text, so sound is never the only overtime signal. Do not announce every heat increase
through a live region; that would create noisy repeated screen-reader output.

### 14.8 Failure, concurrency, privacy, and operational behavior

- An upload aborted before commit creates no metadata row. Database insertion and aggregate-size
  checking occur inside one transaction to avoid a race exceeding the cap.
- Server logs may include track ID, byte length, result code, and timing. They must not log raw MP3
  bytes, request bodies, filenames, display names, header contents, or member assignment payloads.
- Treat file names as untrusted text. Limit header lengths, reject CR/LF/control characters, decode
  defensively, and rely on React text escaping in the UI.
- The local application's existing authorization posture is unchanged; this feature adds no
  external fetch. If application authentication is added later, upload/content/delete and
  assignment routes must inherit it together.
- Track download failure, unsupported Web Audio, decoding failure, autoplay rejection, audio device
  loss, and a missing track all degrade to silent Standup with a recoverable status. No such error
  may disable timer controls or participant actions.
- Multiple Configuration tabs use last-write-wins for assignments. Track deletion remains protected
  by the database foreign keys and conflict response. A stale tab receiving 409 refreshes the
  library/assignment aggregate before inviting another delete.
- A visibility change or throttled interval can jump directly from one heat to a later heat. Ramp
  directly to the current target; do not replay intermediate volume stages.
- Use stable observability vocabulary (`uploaded`, `duplicate`, `deleted`, `delete_conflict`,
  `play_blocked`, `play_error`) if structured logging exists when implemented. Do not add playback
  analytics or member-level metrics solely for this feature.

### 14.9 Implementation slices

Each slice ends with automated checks, a concise user-specific manual-validation walkthrough, and
an update to this durable continuation record before the next slice begins.

#### Slice 1 — contracts, schema, and repository

**Completed 2026-08-20:** added shared track/assignment contracts and the pure effective-track
resolver; added the three additive SQLite tables and assignment indexes; implemented focused track
metadata/BLOB, capacity, assignment, and protected-delete repository operations. Focused repository
tests cover fresh and pre-audio databases, duplicate hashes, limits, inherit/off/custom precedence,
inactive members, cross-team rejection, and delete conflicts. Validated with
`npm --workspace @ecp/backend test -- standup-audio`, `npm --workspace @ecp/shared run build`, and
`npm --workspace @ecp/backend run typecheck` after `nvm use`. No HTTP or user-facing surface exists
yet, so the manual checkpoint is repository-level only; continue with Slice 2 after acceptance.

- Add shared metadata/assignment types and pure effective-track resolution.
- Add fresh-schema and additive-migration tables, indexes, and constraints.
- Implement focused repository operations for metadata, BLOB insert/read ranges, aggregate
  capacity, assignments, reference-safe deletion, and team validation.
- Add repository/schema tests for fresh and migrated databases, inheritance/off/custom precedence,
  inactive members, cross-team rejection, duplicate hashes, limits, cascades, and delete conflicts.

#### Slice 2 — backend HTTP and database portability

**Completed 2026-08-20:** added raw MP3 upload/list/ranged-content/delete routes and atomic team
assignment routes, with the two specific upload headers added to CORS. Uploads screen MP3 signatures,
deduplicate with a `409` track summary, and enforce the 12 MiB route limit; content supports ETag,
`200`/`206`/`416`, and validated ranges. Database imports now support 256 MiB, atomically replace
audio BLOBs/assignments, clear audio for legacy snapshots, validate imported media and references,
and report audio counts. Validated with `npm --workspace @ecp/backend test -- standup-audio snapshot`
and `npm --workspace @ecp/backend run typecheck` after `nvm use`. Continue with Slice 3 after the
backend checkpoint is accepted.

- Add raw MP3 upload, metadata list, ranged content, deletion, and team assignment routes.
- Register body parser/limits and the two explicit CORS headers without broadening CORS generally.
- Extend database import to replace optional audio tables atomically, report counts, support older
  snapshots, and accept bounded 256 MiB database files.
- Test content signatures, body limits, range parsing (`200`, `206`, `416`), ETag, duplicate upload,
  transactional settings, snapshot/import round trips, old snapshots, malformed imports, and sync
  preservation.

#### Slice 3 — Configuration library and assignments

**Completed 2026-08-20:** added the Configuration Walk-off audio panel with MP3 upload, one-at-a-time
preview/stop, protected deletion feedback, searchable team-default selection, and per-member
inherit/off/custom assignment editing. The panel uses the existing dark surfaces, Typeahead overlay,
avatars, compact controls, and responsive wrapping.

- Add typed frontend API functions and query/load state.
- Build the token-consistent track library, upload workflow, one-at-a-time preview, team-default
  `Typeahead`, and focused member override editor.
- Cover keyboard/focus behavior, narrow layouts, inactive members, failure retention, delete
  conflicts, and cleanup when the panel unmounts.

#### Slice 4 — modal audio controller and fire synchronization

**Completed 2026-08-20:** added a focused `useStandupWalkOffAudio` controller. It resolves the
current member's effective track, requires explicit modal-local enablement, uses the timer heat as
its only gain input (`0`, `.16`, `.32`, `.55`, `.80`), loops, pauses/resumes, resets on turn/stage
changes, mutes, retries after browser blocking, and cleans up its media graph at unmount. The
Standup header now keeps a compact enable/mute/retry control subordinate to participant actions.

- Expose existing timer heat/paused/turn identity cleanly to the modal without duplicating time.
- Implement the audio controller, permission enablement, fixed gain ramp, loop, pause/resume,
  reset/advance/close cleanup, mute, retry, and unsupported-browser fallback.
- Add the compact modal control and accessible status using existing Standup tokens and responsive
  hierarchy.

#### Slice 5 — integration, visual QA, and documentation

**Completed 2026-08-20:** added focused persistence, route/range, and snapshot round-trip coverage;
ran shared/backend/frontend type checks. The configuration helper copy documents the MP3 limit,
shareable database storage, rights reminder, facilitator enablement, and the browser-controlled
screen-share-audio limitation. Real MP3/browser/meeting-client audio validation is explicitly
deferred to the final manual walkthrough.

- Run complete backend/frontend regressions and focused E2E with media/Web Audio test doubles.
- Test a real MP3 manually in supported browsers and screen sharing, including the meeting client's
  share-audio requirement.
- Tune only the centralized gain values if real-speaker QA shows they are unsafe or ineffective;
  record the final values and reason here.
- Document MP3 limits, backup behavior, rights reminder, enable/mute behavior, and screen-share audio
  caveat in the relevant user-facing repository documentation.

### 14.10 Automated and manual validation

Run Node commands only after selecting the repository version:

```text
nvm use
npm --workspace @ecp/backend test -- standup-audio snapshot server
npm --workspace @ecp/backend run typecheck
npm --workspace @ecp/frontend test -- standupAudio
npm --workspace @ecp/frontend run typecheck
PW_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  npm --workspace @ecp/frontend run e2e -- standup-audio.spec.ts standup-tickets.spec.ts
npm test
npm run typecheck
git diff --check
```

Backend coverage must prove:

- a valid small MP3 uploads, metadata excludes bytes, duplicate content is rejected, spoofed or
  empty input is rejected, and per-file/library caps hold under transactions;
- byte ranges and cache headers are correct at first, middle, final, unsatisfiable, and malformed
  ranges;
- assignment reads/writes preserve inherit/off/custom semantics and reject foreign members,
  missing tracks, duplicate member entries, and partial writes;
- referenced deletion returns conflict, unreferenced deletion succeeds, and team/member deletion
  has the intended cascade behavior;
- database snapshot/import preserves audio, an old database clears current audio, malformed audio
  rolls back, and routine Jira/domain sync does not touch focused audio tables.

Frontend unit/component coverage must prove:

- the resolver precedence is custom → off → team default → none;
- the gain mapping and controller lifecycle respond correctly to heat, pause, reset, member change,
  mute, modal close, post-standup, blocked play, failed load, and direct heat jumps;
- track preview is click-only, one-at-a-time, safely capped, and cleaned up;
- Configuration keeps unsaved selections/errors appropriately and produces only explicit `off` or
  `track` rows while omitting inherited members.

Playwright may stub media/Web Audio APIs for deterministic assertions, but manual QA must use a real
MP3. Verify all of the following:

1. Upload a short and a long MP3, preview each, select a team default, set one member to a custom
   song and one to **No song**, reload Configuration, and confirm all effective labels.
2. Open Standup without enabling audio. Cross the threshold and confirm fire appears while no sound
   plays. Enable audio, reset, cross again, and confirm the correct team song starts.
3. Advance through an inheriting member, custom-song member, no-song member, and inactive/reactivated
   member. Confirm the old song always stops and rewinds and no-song remains silent.
4. At a 5-second threshold, confirm four clearly progressive but safe volume stages. Pause between
   stages, Resume, Reset, Mute/Unmute, switch tabs long enough to skip a callback, and confirm fire
   and gain stay synchronized.
5. Deny/block playback and simulate a missing/invalid file. Confirm Retry/status appears and all
   Standup controls, notes, fire, and Finish Standup continue normally.
6. Download the database, restore it into a fresh instance, and confirm tracks plus assignments.
   Import an older no-audio database and confirm the current library is cleared as replacement
   semantics require.
7. At `1440x900`, `1280x720`, `390x844`, keyboard-only navigation, 200% zoom, reduced motion, and a
   screen reader, confirm labels/focus/targets remain usable and sound is independently controllable.
8. Share the Standup screen in the supported meeting client both with and without “share system/tab
   audio.” Confirm the caveat is accurate and remote audio does not depend on the visual fire.
9. Perform speaker/headphone safety QA before a live team session. If 0.80 maximum gain is excessive,
   reduce the centralized curve and record the verified replacement here.

### 14.11 Acceptance criteria

- A user can upload a validated MP3 to a durable, reusable library without adding external storage
  or URLs; metadata responses never contain audio bytes.
- A team can select no default or one default track. Every team member can inherit it, select one
  custom track, or explicitly select no song, and reload preserves that choice.
- The effective member song is deterministic: custom wins, off is silent, inherit uses the team
  default, and no default is silent.
- Audio begins only at heat 1 after explicit modal-local enablement. Heat 1–4 uses the one documented
  gain curve and the timer's existing heat source, so volume and visible fire cannot drift.
- Pause/Resume preserves playback position. Reset, speaker change, modal close, post-standup, and
  completion silence and rewind playback without leaking elements, contexts, listeners, or old
  status into another member.
- Autoplay rejection, load/decode failure, unavailable Web Audio, and missing songs never block or
  alter the Standup timer, fire, notes, participant transitions, or completion.
- The modal always has clear enable/mute/retry state. Fire retains visible **Over time** text, and
  sound is never the only indicator or forced by the reduced-motion preference.
- Track deletion cannot silently break assignments. Duplicate content, invalid MP3s, oversized
  media, aggregate capacity, unsafe names, malformed ranges, and cross-team assignment are handled
  with tested bounded failures.
- SQLite download/restore preserves tracks and assignments; replacement import from an older file
  intentionally clears them; routine sync leaves them untouched.
- Configuration follows the existing dark visual language, uses the shared Typeahead and member
  identity patterns, avoids a sprawling permanent form, and remains usable at screen-share and
  narrow/zoomed sizes.
- No copyrighted song is bundled, no external provider is contacted, and no playback/member-level
  analytics are introduced.

### 14.12 Continuation instructions for this slice

Begin with slice 1 only. First re-verify the timer callback shape and current schema/snapshot import
transaction because those files may change while section 13 continues. Preserve all unrelated and
untracked work. The likely first files are:

1. [`packages/shared/src/domain.ts`](../packages/shared/src/domain.ts)
2. [`packages/backend/src/db/schema.ts`](../packages/backend/src/db/schema.ts)
3. [`packages/backend/src/db/database.ts`](../packages/backend/src/db/database.ts)
4. a new `packages/backend/src/db/standup-audio.ts`
5. [`packages/backend/src/db/snapshot.ts`](../packages/backend/src/db/snapshot.ts)
6. [`packages/backend/src/routes/db.ts`](../packages/backend/src/routes/db.ts)
7. a new `packages/backend/src/routes/standup-audio.ts`
8. [`packages/backend/src/server.ts`](../packages/backend/src/server.ts)
9. [`packages/frontend/src/data/api.ts`](../packages/frontend/src/data/api.ts)
10. [`packages/frontend/src/components/Configuration.tsx`](../packages/frontend/src/components/Configuration.tsx)
11. [`packages/frontend/src/components/StandupSpeakerTimer.tsx`](../packages/frontend/src/components/StandupSpeakerTimer.tsx)
12. [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx)
13. [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css)

Before implementation, rediscover with:

```text
git status --short
rg -n "StandupSpeakerTimer|onOvertimeChange|heat|standup-fire" packages/frontend/src
rg -n "importDatabaseFromBuffer|IMPORT_BODY_LIMIT|SCHEMA_SQL|function migrate" packages/backend/src
rg -n "Access-Control-Allow-Headers|register.*Routes" packages/backend/src/server.ts
rg -n "Typeahead|MemberAvatar|Standup settings" packages/frontend/src/components
```

Do not add multipart or audio dependencies until native browser/Fastify/Node APIs have been proven
insufficient. After each slice, record the exact schema/API deviations, final limits/gain curve,
test commands/results, manual validation, and next action in section 15.

## 15. Continuation record

**Current status (2026-08-20):** implementation started. Shared threshold/pseudogroup contracts,
additive note migration, team settings API, structured note audience snapshots, note lifecycle and
order endpoints, carry-forward materialization, snapshot schema v2, local speaker timer, contained
pixel-fire cue, and compact standup note/configuration UI have been added. Existing repository and
server regressions plus workspace typecheck pass. Section 12 now records the requested
post-implementation note-list/composer styling refinement; it is implemented and has passed focused
and workspace automated verification. Section 13's required-people projection and simplified All
Team audience card are implemented; the large icon-led note tiles and responsive layout remain.
Section 14 is the implementation-ready plan for durable MP3 storage, team defaults, member
inherit/off/custom overrides, and fire-synchronized modal playback. No audio code or schema has
been implemented yet.

**Implemented (2026-08-19):** section 11 now has a plain-text `@` mention composer with visible
audience chips, structured all-team/group/member request construction, a portaled shared Typeahead
menu surface, compact composer styling, unit coverage for parsing/audience behavior, and focused
desktop/narrow Playwright coverage. The stale Standup ticket E2E aggregate fixture was updated with
the fields already required by the modal. Section 12 adds larger local Standup typography and
pointer/touch drag reorder while preserving keyboard operation on the focused drag handle.
Edit-in-place remains separate unfinished work. Preserve the existing user-owned
`packages/backend/packages/` path.

**Timer tuning (2026-08-20):** the default overtime threshold is now 20 seconds for new settings.
After any configured threshold, the fire begins at a visible 22% height, advances heat every five
seconds, reaches maximum heat after about 15 seconds, and uses stronger modal glow plus denser,
faster embers. Existing saved threshold values remain user-configurable and are not silently
overwritten. Frontend typecheck and the Standup ticket Playwright regression pass using the installed
Chrome fallback.

**Walk-off audio planning (2026-08-20):** section 14 records the complete feature contract. MP3s are
stored as deduplicated, size-bounded SQLite BLOBs so database snapshots remain self-contained. A
team may have one default; each member inherits, opts out, or selects another library track. Audio
requires an explicit gesture per modal, starts at fire heat 1, and uses the centralized gain curve
`[0, 0.16, 0.32, 0.55, 0.80]`. Playback failure is always non-blocking. The plan also covers ranged
media delivery, replacement import, configuration UI, accessibility, speaker safety, tests, and
manual screen-share validation.

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

**Next action:** if the walk-off audio request is the next priority, implement section 14 slice 1:
shared contracts, the effective-track resolver, schema/migration tables, and focused repository
tests. Do not start playback UI before the persistence contract is verified. Section 13 slice 3
(large icon-led note tiles and grid-aware pointer reorder) remains independent unfinished work and
can resume afterward. Preserve the current user-owned diffs and the untracked
`packages/backend/packages/` path; do not repeat the already implemented sections 11–12 or section
13's required-people/All Team work.

**First files to inspect:**

1. [`packages/shared/src/settings.ts`](../packages/shared/src/settings.ts)
2. [`packages/shared/src/domain.ts`](../packages/shared/src/domain.ts)
3. [`packages/backend/src/db/repository.ts`](../packages/backend/src/db/repository.ts)
4. [`packages/backend/src/routes/config.ts`](../packages/backend/src/routes/config.ts)
5. [`packages/backend/src/db/standup.ts`](../packages/backend/src/db/standup.ts)
6. [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx)
7. [`packages/frontend/src/components/Typeahead.tsx`](../packages/frontend/src/components/Typeahead.tsx)
8. [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css)
9. [`packages/frontend/src/components/StandupNoteComposer.tsx`](../packages/frontend/src/components/StandupNoteComposer.tsx)
10. [`packages/frontend/e2e/standup-note-composer.spec.ts`](../packages/frontend/e2e/standup-note-composer.spec.ts)
11. [`packages/frontend/src/components/MemberAvatar.tsx`](../packages/frontend/src/components/MemberAvatar.tsx)
12. [`packages/frontend/src/lib/memberColors.ts`](../packages/frontend/src/lib/memberColors.ts)

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
