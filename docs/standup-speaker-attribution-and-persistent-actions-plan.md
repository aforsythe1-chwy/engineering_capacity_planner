# Standup Speaker Attribution and Persistent Actions — Durable Implementation Plan

**Status:** Ready for implementation

**Created:** 2026-08-24

**Last updated:** 2026-08-24

**Scope:** Ensure every note created during an active participant's turn durably includes that
participant, even when the facilitator does not explicitly `@`-tag them, and keep the Standup
modal's stage-level actions—especially **Next**—available without scrolling to the end of the
content.

**Intended outcome:** A facilitator can type and save a follow-up while Alfie is the current
participant and trust that Alfie is visibly and durably associated with the note. Explicit people,
groups, and **All Team** remain additive audience choices. The modal header and action footer stay
in place while only the stage content scrolls, so **Skip** and **Next** remain usable at every
supported viewport size.

**Related durable context:**

- [`standup-timer-and-note-workflow-plan.md`](./standup-timer-and-note-workflow-plan.md) owns the
  broader timer, note lifecycle, mention, required-people, and optional audio design.
- [`standup-facilitation-plan.md`](./standup-facilitation-plan.md) owns the original active-round and
  post-standup state machine.
- [`standup-bandwidth-check-in-visual-refinement-plan.md`](./standup-bandwidth-check-in-visual-refinement-plan.md)
  owns bandwidth selection behavior and explicitly keeps **Skip**/**Next** in the modal footer.

This is a focused plan because the active-speaker guarantee and modal scrolling defect can be
implemented and validated independently of the unfinished audio and note-tile work in the broader
timer/note plan. Keep both plans' continuation records accurate if implementation changes a shared
contract.

## 1. Requested behavior and product decisions

### 1.1 Active speaker is required note context

- “The person active at that point” means the first pending Standup participant at the instant the
  create-note transaction succeeds. It does not mean the participant who was active when the user
  first typed into the composer.
- A note created while the session is `active` receives that participant as immutable context. The
  context is also part of the note's resolved audience, so the person appears in saved note copy,
  required-people projection, final snapshots, and deferred carry-forward behavior.
- The active participant is additive to the facilitator's explicit audience:

  ```text
  Current participant: Alfie

  No explicit selection beyond the current default  -> All Team + Alfie
  Explicit @Nick                                    -> Nick + Alfie
  Explicit @Backend group                           -> Backend group + Alfie
  Explicit @All Team                                -> All Team + Alfie
  ```

- **All Team** remains exclusive among user-selected audiences, as it is today. The one intentional
  exception is the system-owned current-participant context. Users cannot create arbitrary
  **All Team + selected people** combinations; the server adds only the verified current
  participant.
- Show the required current participant as a pinned, non-removable audience chip in the compact
  active-round composer. Give it accessible copy such as **Current participant: Alfie (always
  included)**. Do not represent a mandatory value with a remove button that silently reappears.
- Keep explicitly selected people/groups removable. Continue to use the current `@` typeahead and
  the existing **All Team** default rather than replacing the composer or adding a second picker.
- When **Next** or **Skip** changes the participant while an unsaved draft exists, preserve the
  body and explicit selections but replace the pinned system context with the new current
  participant. The server still decides the authoritative participant at save time. This avoids
  draft loss while preventing stale speaker attribution.
- If the note request loses a revision race with participant advancement in another tab, preserve
  the draft and explicit selections, show the existing mutation error, refresh/reconcile through
  the existing aggregate flow, and require a deliberate retry. Never silently save against a
  participant the user cannot see.

### 1.2 Post-standup and historical behavior

- Notes created in the `post_standup` stage have no implicit participant because no participant is
  active. Their composer retains today's audience behavior and **All Team** default.
- Existing notes receive no inferred context during migration. There is no reliable way to recover
  which participant was active when an historical note was created.
- Completed/committed records remain read-only. Context is included in future final snapshots
  through the normal `StandupAggregate`; do not introduce a separate audit or analytics stream.
- Updating a note may change its body and explicit audience, but must not remove or replace the
  participant context captured at creation.
- Deferring/carrying a note preserves the original participant context and snapshot name. It does
  not reassign the note to whichever participant is active when the next session starts.

### 1.3 Persistent modal actions

- The Standup modal is a three-region layout: non-scrolling header, independently scrolling stage
  body, and non-scrolling action footer.
- **Skip** and **Next** remain visible in the active round without requiring the facilitator to
  scroll, including when notes, epics, bandwidth controls, or Jira tickets make the body taller
  than the viewport.
- Apply the same structural footer behavior to `post_standup` and `completed` actions so **Finish
  Standup**, **Delete**, and **Commit Standup** do not regress into a second layout model.
- Do not use a sticky footer that overlays content. Give the body its own scroll region and reserve
  layout space for the footer. The last content row must be fully scrollable above the action area.
- Preserve current button hierarchy and semantics: **Skip** is secondary, **Next** is the active
  round's sole primary action, **Finish Standup** is the post-stage primary action, and existing
  disabled/busy behavior is unchanged.
- Keep the modal's contained fire effect behind all three regions, preserve its clipping and
  pointer-event behavior, and keep the portaled mention menu positioned from its textarea when the
  internal body scrolls.

## 2. Verified current implementation

These are repository findings, not hypotheses.

### 2.1 Note attribution gap

- [`RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx) finds the current
  participant in `StandupModal`, but `TeamRound` renders compact `Notes` without passing that
  participant into `Notes` or `StandupNoteComposer`.
- [`StandupNoteComposer.tsx`](../packages/frontend/src/components/StandupNoteComposer.tsx)
  initializes `selected` from the first empty-query mention option. In
  [`standupNoteMentions.ts`](../packages/frontend/src/lib/standupNoteMentions.ts), that option is
  **@All Team**.
- The composer knows only `teamId`, `sessionId`, and `expectedRevision`; it has no current-speaker
  contract or pinned audience state.
- [`api.ts`](../packages/frontend/src/data/api.ts) sends only the body, user-selected audience, and
  expected revision to `POST /api/standups/:sessionId/notes`.
- [`standup.ts`](../packages/backend/src/db/standup.ts) validates and persists exactly the submitted
  audience. `createNote` does not query the current pending participant. An `allTeam: true`
  audience currently discards all mentions and resolved member IDs.
- [`schema.ts`](../packages/backend/src/db/schema.ts) has note/member and mention tables but no field
  that distinguishes system-captured participant context from removable explicit mentions.
- `updateNote` replaces the full persisted audience. Without separately stored context, a later
  edit could remove an auto-added person or incorrectly add the participant active at edit time.
- [`standupRequiredPeople.ts`](../packages/frontend/src/lib/standupRequiredPeople.ts) treats an All
  Team note as one distinct card and stops processing that note's member IDs. It cannot currently
  project both **All team** and the system-captured participant.
- Saved note metadata in `Notes` renders either **All team** or mention labels, never both.

### 2.2 Scrolling cause

- `StandupModal` renders the heading, active/post/completed stage, and footer as direct children of
  the same `.standup-modal` element.
- [`styles.css`](../packages/frontend/src/styles.css) gives `.standup-modal` `max-height: 94vh` and
  `overflow: auto`. Therefore the footer is ordinary content after the full `TeamRound` grid and
  naturally scrolls out of view.
- At widths up to `700px`, the modal becomes full-viewport height but remains the same single scroll
  container, so stacked columns can push **Next** even farther below the fold.
- The body scroll lock already applied by `StandupModal` correctly prevents the page behind the
  dialog from scrolling. The defect is the modal's internal region structure, not page overflow.

### 2.3 Existing reusable seams

- The current modal already owns the authoritative rendered `current` participant and participant
  transition aggregate.
- The note API already uses optimistic `expectedRevision`, and participant resolution increments
  the same session revision. This can reject cross-tab participant/note races without a new lock or
  client timestamp.
- `standup_note` already has additive migration precedent in
  [`database.ts`](../packages/backend/src/db/database.ts).
- Note member IDs, mention snapshots, final snapshots, and deferred carry-forward already exist;
  the new context should extend these paths rather than create parallel note storage.
- The mention menu is portaled to `document.body` and already listens for capture-phase scroll
  events, so it should remain viewport-aware when the new body region scrolls. This must still be
  tested rather than assumed.

## 3. Persistence and API contract

### 3.1 Additive note context

Add nullable context fields to the durable note record:

```text
standup_note.context_member_id    TEXT NULL
standup_note.context_member_name  TEXT NULL
```

- Add the columns to fresh schema creation in `packages/backend/src/db/schema.ts` and through
  idempotent `ensureColumn` calls in `packages/backend/src/db/database.ts`.
- `context_member_id` identifies the participant snapshot row/member. `context_member_name` freezes
  the display name from `standup_participant.member_name` so later member edits do not rewrite
  history.
- Fresh schema may use a restrictive foreign key where compatible. Because SQLite additive
  migrations cannot reliably retrofit it, repository validation is authoritative for upgraded
  databases, following the existing `source_note_id` precedent.
- Leave both fields `NULL` for old notes and for notes created in `post_standup`.
- Extend the shared `StandupNote` shape with `contextMemberId: string | null` and
  `contextMemberName: string | null`. Update every fixture/constructor intentionally; do not hide a
  required domain migration behind broad type assertions.

### 3.2 Create transaction

Within the existing `createNote` transaction:

1. Load and revision-check the session as today.
2. Parse the submitted explicit audience as today.
3. If status is `active`, query the first pending participant ordered by position.
4. If there is no pending participant in an active session, return a conflict instead of creating
   an unattributed note in an internally inconsistent state.
5. Store that participant's ID and snapshot name in the note context fields.
6. Merge the participant into the resolved member IDs used by the returned aggregate, deduplicating
   against a direct mention or group that already contains them.
7. Preserve explicit mention ordering and labels separately; system context is not a removable
   user mention.
8. Insert the note, write the audience, and increment the shared session revision atomically.

The request payload does not need a trusted `contextMemberId`. The client may render the current
participant for immediate feedback, but the backend derives the authoritative value from the
session. This prevents a stale or modified client from assigning arbitrary system context.

### 3.3 Read, update, snapshot, and carry-forward behavior

- `notesFor` returns the new context fields and exposes `memberIds` as the deduplicated union of
  explicitly resolved members and `contextMemberId`. This preserves `memberIds` as the complete
  resolved audience contract used by projections.
- Keep `mentions` as user-selected member/group snapshots. UI rendering explicitly combines the
  All Team label, context snapshot, and mention labels with ID-aware deduplication.
- `updateNote` replaces only the explicit audience and body. It retains the original context fields,
  and `notesFor` continues to union that context into the returned resolved member IDs.
- `materializeDeferred` copies both context columns along with the body, state lineage, explicit
  member IDs, and mention snapshots.
- The final schema-v2 snapshot automatically gains the two nullable JSON properties through the
  returned aggregate. No database snapshot version bump is needed unless implementation discovers
  a strict external consumer; record that discovery here before changing the version.
- API routes and request shapes remain unchanged. The response shape changes additively through the
  shared `StandupNote` fields.

## 4. Frontend behavior and layout design

### 4.1 Pinned participant context

- Pass the current `StandupParticipant` from `StandupModal` through `TeamRound` and compact `Notes`
  to `StandupNoteComposer` as a narrowly typed optional required context.
- The full post-standup/completed `Notes` call passes no context.
- Render the pinned current-participant chip in the existing `.standup-note-audience` group, using
  the same token, radius, border, and type scale as existing chips plus a restrained visual marker
  or accessible suffix that communicates it is automatic.
- Do not render a remove button for the pinned chip. Explicit chips retain their existing remove
  buttons and focus states.
- Update the combined-payload helper so a direct explicit selection matching the current
  participant does not duplicate UI or request identities. The server still deduplicates as the
  source of truth.
- A system context counts as a valid audience if the facilitator removes every explicit chip. The
  **Add note** button should remain enabled for a non-empty body because the server will persist the
  verified current participant.
- When the required context prop changes, preserve draft/error state and selected explicit audience,
  update the pinned chip immediately, and ensure a retry uses the latest aggregate revision and
  visible participant. If the current implementation's component identity prevents this safely,
  lift draft state to `Notes`; do not key-remount the composer and discard user text.
- Render saved audience metadata from a helper with this order: **All team**, current-participant
  snapshot, remaining explicit people/groups. Deduplicate a direct explicit mention of the current
  participant without deduplicating a group label that happens to contain them.
- Update `deriveStandupRequiredPeople` to count `memberIds` even when `allTeam` is true. An open note
  can therefore contribute once to the All Team card and once to its captured participant's count.
  Continue counting any person at most once per note.

### 4.2 Three-region modal

Restructure the Standup dialog without changing global `.modal` behavior:

```text
standup-modal (height-constrained grid; overflow hidden)
├── modal-heading (fixed layout row)
├── standup-modal-body (min-height: 0; overflow: auto)
│   └── TeamRound or Notes
└── modal-actions (fixed layout row)
```

- Add one `.standup-modal-body` wrapper around the stage renderer in
  `RunStandupPage.tsx`.
- Make `.standup-modal` a grid/flex column with `overflow: hidden`; give the body `min-height: 0`,
  `min-width: 0`, and `overflow: auto`.
- Preserve the modal's current maximum desktop height and full-height narrow behavior. Use existing
  `--panel`, `--border`, `--text`, and `--muted` tokens.
- Give the footer a quiet top divider/background/padding only if needed to make the scroll boundary
  legible. It must look like part of the existing modal, not a floating card or oversized bar.
- Ensure header/footer spacing comes from their own regions rather than relying on the current
  whole-modal `margin-bottom`/`margin-top` rules. Avoid double gaps at the first and last body rows.
- Keep the fire effect absolutely positioned against the modal. Confirm the new body wrapper does
  not create a clipping or stacking context that puts content behind the effect.
- Retain `overscroll-behavior: contain` on the body/modal so wheel and touch scrolling do not escape
  to the hidden page.
- At narrow widths, the body—not the entire dialog—fills the flexible middle row and scrolls. The
  footer may wrap its existing buttons but must remain fully visible.

## 5. Ordered implementation slices

### Slice 1 — Durable participant context and server enforcement

**Files/subsystems:**

- `packages/shared/src/domain.ts`
- `packages/backend/src/db/schema.ts`
- `packages/backend/src/db/database.ts`
- `packages/backend/src/db/standup.ts`
- relevant backend note/API tests

**Work:** Add nullable context fields, derive the current participant inside the create transaction,
preserve context through update/read/carry-forward, and return a complete deduplicated resolved
audience.

**Exit:** Backend tests prove active creation captures the current participant, post-stage creation
does not invent one, explicit/direct/group/All Team audiences deduplicate correctly, revision races
fail without creating a note, updates cannot remove context, and deferred copies preserve it.

### Slice 2 — Composer and projection behavior

**Files/subsystems:**

- `packages/frontend/src/components/RunStandupPage.tsx`
- `packages/frontend/src/components/StandupNoteComposer.tsx`
- `packages/frontend/src/lib/standupNoteMentions.ts` or a focused audience-display helper
- `packages/frontend/src/lib/standupRequiredPeople.ts`
- `packages/frontend/src/styles.css`
- frontend unit and E2E fixtures containing `StandupNote`

**Work:** Thread required context into the compact composer, render a pinned chip, combine the
effective audience, update saved-note copy and required-people projection, and preserve drafts as
the active participant changes.

**Exit:** Active-round UI clearly shows the current person as always included; saved notes and the
post-stage projection show that person with accurate counts; post-stage standalone creation remains
unchanged.

### Slice 3 — Persistent action layout

**Files/subsystems:**

- `packages/frontend/src/components/RunStandupPage.tsx`
- the Standup-scoped section of `packages/frontend/src/styles.css`
- Standup Playwright coverage

**Work:** Introduce the body wrapper, move overflow to it, reserve header/footer rows, and tune
desktop/narrow spacing and stacking without changing generic modal styles.

**Exit:** **Next** is visible before any scrolling with deliberately overflowing active-round
content at desktop and narrow viewports; the full body remains reachable; all other stage actions,
typeahead placement, drag reorder, and fire layering work.

### Slice 4 — Regression verification and durable handoff

**Work:** Run focused and workspace checks, perform the manual walkthrough in section 7, record exact
results/deviations in this file, update the broader timer/note plan if a shared contract changed,
and set the continuation record to the next genuinely unfinished action.

**Exit:** All acceptance criteria in section 8 are evidenced, or remaining failures are recorded as
specific blockers rather than implied complete work.

## 6. Automated verification

Before every Node/npm/npx command, run `nvm use` from the repository root as required by
`AGENTS.md`.

### 6.1 Backend coverage

Add focused route/repository tests, preferably in a new coherent Standup-note test file rather than
further enlarging unrelated server coverage:

- creating during Alfie's active turn stores `contextMemberId/contextMemberName` and returns Alfie
  in `memberIds`;
- explicit `@Alfie` does not duplicate Alfie;
- a group containing Alfie does not duplicate `memberIds` and retains the group mention snapshot;
- All Team remains `allTeam: true` while also returning Alfie's context/member ID;
- a `post_standup` create has null context;
- an incorrect revision after another tab advances rejects the create and writes no note;
- updating an active-round note cannot remove or replace its captured context;
- a deferred/carry-forward copy preserves context;
- opening an older database adds nullable columns without backfilling historical notes.

### 6.2 Frontend unit coverage

Extend:

- [`standupNoteMentions.test.ts`](../packages/frontend/test/standupNoteMentions.test.ts) for combined
  system/explicit audience payload and deduplication behavior;
- [`standupRequiredPeople.test.ts`](../packages/frontend/test/standupRequiredPeople.test.ts) for an
  All Team note that also has a context member and for once-per-note person counting;
- any new saved-audience display helper tests for label order and direct-person deduplication.

### 6.3 Playwright coverage

Extend [`standup-note-composer.spec.ts`](../packages/frontend/e2e/standup-note-composer.spec.ts) or
add a focused workflow spec that proves:

1. The active composer displays a non-removable current-participant chip alongside the current
   default audience.
2. A note saved without manually tagging the participant renders them in its audience metadata.
3. Explicitly tagging another person keeps both people; selecting All Team keeps the contextual
   participant visible.
4. Advancing to the next participant updates the pinned chip without losing an unsaved draft.
5. A mocked conflict retains the draft and exposes the error.
6. With enough notes/tickets to overflow at `1280x600`, **Next** is inside the viewport before body
   scroll; scrolling reaches the final content without moving the footer out of view.
7. Repeat the footer/body assertion at `390x844`, and assert no horizontal document overflow.
8. Open the `@` menu near the bottom of the body, scroll the body, and confirm the portaled menu
   remains attached/visible with keyboard selection intact.
9. Enter `post_standup` and `completed` states and confirm their footer actions use the same
   persistent structure.

### 6.4 Commands

```bash
nvm use
npm --workspace @ecp/backend test -- --run <focused-standup-note-test>
npm --workspace @ecp/frontend test -- --run standupNoteMentions standupRequiredPeople
npm --workspace @ecp/frontend run e2e -- standup-note-composer.spec.ts standup-tickets.spec.ts
npm run typecheck
npm test
git diff --check
```

Use the repository's installed Chrome fallback for Playwright if bundled Chromium is unavailable;
record the exact command and browser used in this plan.

## 7. Manual validation walkthrough

1. Start the backend and frontend, open Standup at a viewport short enough that the round content
   exceeds the dialog, and confirm **Skip**/**Next** are immediately visible.
2. Verify only the middle content region scrolls. Reach the first and last ticket/note rows and
   confirm neither is hidden beneath the footer.
3. While Alfie is active, confirm the composer visibly shows Alfie as always included and that the
   chip is not removable.
4. Add a note without typing an `@` mention. Confirm its saved metadata and eventual required-people
   projection include Alfie.
5. Add a note explicitly for Nick. Confirm the result includes Nick and Alfie once each.
6. Add an All Team note. Confirm **All team** and Alfie are both visible, and the post-stage
   projection contains an All Team card plus Alfie's correct follow-up count.
7. Begin another draft, advance/skip to the next participant, and confirm the body/explicit chips
   remain while the pinned participant changes.
8. In a second tab, advance the participant before saving the first tab's draft. Confirm the first
   save conflicts, preserves the draft, and does not create a wrongly attributed note.
9. Complete the round. Confirm **Finish Standup** remains visible while the notes area scrolls and
   post-stage-created notes have no fabricated participant context.
10. Defer an active-round note, begin the next dated Standup, and confirm the carried note still
    names the original participant.
11. Repeat core layout and composer checks at a narrow viewport using pointer and keyboard; verify
    visible focus, typeahead placement, footer wrapping, and no horizontal page scroll.
12. Let the overtime fire activate and confirm it remains behind header, body, and footer and never
    intercepts their controls.

## 8. Acceptance criteria

- Every note successfully created while a Standup session is `active` stores the server-verified
  current pending participant's ID and snapshot name.
- The captured participant cannot be removed by the composer, a later audience update, or
  carry-forward.
- The effective resolved audience contains the captured participant exactly once, even when an
  explicit person or group already resolves to them.
- All Team notes created during a participant turn retain All Team semantics and also visibly
  identify/count the captured participant.
- Notes created after the session enters `post_standup` have null participant context and preserve
  existing explicit/default audience behavior.
- Historical notes are not guessed or backfilled; upgraded databases open through an idempotent,
  additive migration.
- Cross-tab participant advancement cannot result in a note silently attributed to the wrong
  person.
- The current participant is visibly presented as always included before save, with accessible
  semantics and no misleading remove control.
- **Skip** and **Next** remain fully visible without scrolling whenever an active participant is
  rendered, at both desktop and narrow supported viewports.
- The stage body can scroll from first to last content without being obscured by the footer, and
  post/completed actions share the same persistent layout.
- Note mutation, bandwidth, ticket refresh, typeahead, drag reorder, fire, close, and revision
  behavior continue to pass focused and workspace regressions.

## 9. Risks, failure handling, and non-goals

### 9.1 Failure and concurrency

- The shared revision check plus server-side current-participant lookup is the concurrency
  boundary. Do not trust a client-provided participant or add a timestamp race heuristic.
- Keep the existing composer behavior that retains drafts after failures. Do not auto-retry a
  conflict because the participant context may have changed.
- Schema migration is additive and nullable. If either context column cannot be added, fail database
  startup through the existing migration path rather than running with a partial guarantee.

### 9.2 Accessibility and responsive behavior

- The pinned participant needs visible text and screen-reader meaning; color/lock icon alone is not
  sufficient.
- Preserve logical DOM/tab order: header close, scroll-body controls, then footer **Skip** and
  **Next**. A persistent visual footer must not duplicate buttons or move them ahead of body
  controls in the DOM.
- Keyboard users must be able to scroll the body and still reach every control. Preserve focus when
  participant data updates unless the focused control unmounts as part of the existing transition.
- Test reduced motion, typeahead overlay position, and mobile footer wrapping as described above.

### 9.3 Security, privacy, and observability

- Participant context is existing team/session metadata, not a new sensitive data class. Validate
  it from the session roster on the server and escape/render it as text through React.
- No analytics, per-person timing metrics, audit events, or remote telemetry are added. Existing
  error UI and server responses are sufficient; verification relies on returned aggregates and
  tests.

### 9.4 Explicit non-goals

- Retrofitting context onto historical notes.
- Changing participant ordering, bandwidth-selection requirements, timer thresholds, Jira ticket
  loading, note body editing UI, or note state/reorder semantics.
- Replacing `@` mentions, pseudogroups, or All Team with a new audience picker.
- Changing global modal behavior or frontend navigation/routing/portfolio scope.
- Implementing the unfinished large note-tile or walk-off-audio slices from the broader plan.
- Creating Jira tickets or external notifications from follow-ups.

## 10. Continuation record

**Current status (2026-08-24):** Slice 1 is implemented on branch
`feat/standup-speaker-attribution`. `standup_note` now has nullable
`context_member_id/context_member_name` fields in the fresh schema and additive migration path.
Creation during an active round derives the first pending participant inside the revision-checked
transaction; read projection unions that person into `memberIds`; updates retain the captured
context; and deferred copies preserve it. `packages/backend/test/standup-notes.test.ts` covers
active creation, update retention, carry-forward, stale-revision rejection, and post-standup null
context. The focused backend test passed with Node 22.22.3.

**Next action:** After the Slice 1 validation checkpoint, implement Slice 2: thread the current
participant into the compact composer, render its pinned chip, surface context in saved-note and
required-people projections, and update shared frontend fixtures for the additive domain fields.

**First files to inspect:**

1. [`packages/backend/src/db/standup.ts`](../packages/backend/src/db/standup.ts)
2. [`packages/backend/src/db/schema.ts`](../packages/backend/src/db/schema.ts)
3. [`packages/backend/src/db/database.ts`](../packages/backend/src/db/database.ts)
4. [`packages/shared/src/domain.ts`](../packages/shared/src/domain.ts)
5. [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx)
6. [`packages/frontend/src/components/StandupNoteComposer.tsx`](../packages/frontend/src/components/StandupNoteComposer.tsx)
7. [`packages/frontend/src/lib/standupNoteMentions.ts`](../packages/frontend/src/lib/standupNoteMentions.ts)
8. [`packages/frontend/src/lib/standupRequiredPeople.ts`](../packages/frontend/src/lib/standupRequiredPeople.ts)
9. [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css)
10. [`packages/frontend/e2e/standup-note-composer.spec.ts`](../packages/frontend/e2e/standup-note-composer.spec.ts)

**Discovery commands:**

```bash
git status --short
rg -n "StandupModal|TeamRound|StandupNoteComposer|function Notes" packages/frontend/src/components
rg -n "createNote|updateNote|materializeDeferred|function audience|notesFor" packages/backend/src/db/standup.ts
rg -n "standup-modal|standup-modal-body|modal-actions" packages/frontend/src/styles.css
rg -n "StandupNote" packages --glob '*.ts' --glob '*.tsx'
```

After each slice, update this section with completed work, exact commands/results, material contract
deviations, manual validation performed, and the next action. Do not mark the plan complete until
all acceptance criteria have evidence.
