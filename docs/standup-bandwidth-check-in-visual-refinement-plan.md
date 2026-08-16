# Standup Bandwidth Check-in Visual Refinement — Durable Implementation Plan

**Status:** Implemented; focused verification complete

**Created:** 2026-08-16

**Scope:** reposition and visually refine the current participant's bandwidth check-in in the
Standup modal, make every feeling understandable without relying on color or hover, reduce the
optional note's visual weight, and correct participant-local draft/save behavior directly touched
by the refinement

**Intended outcome:** make bandwidth feel like part of the active participant's identity and
standup flow rather than a second form appended after the sprint-ticket list. The participant sees
a compact, accessible check-in immediately below their name and progress, can understand all four
choices at a glance, can add context without a permanently dominant input, and can move through
participants without note state leaking between them.

**Constraints:** frontend-focused change; no Spec Kit/SDD; preserve the flat product model and
standup progression; build on the current uncommitted Standup work without replacing unrelated
user-owned changes

**Related plans:**

- [`bandwidth-feelings-plan.md`](./bandwidth-feelings-plan.md)
- [`standup-facilitation-plan.md`](./standup-facilitation-plan.md)
- [`standup-ticket-list-visual-refinement-plan.md`](./standup-ticket-list-visual-refinement-plan.md)

## 1. Context and problem statement

The active Standup modal uses a two-column layout. The right participant workspace currently
orders its content as:

1. participant name and `Participant n of total`;
2. Sprint tickets;
3. `Today's bandwidth` heading;
4. four small color buttons;
5. a labeled, full-width optional note input.

This placement and treatment produce three problems:

- bandwidth reads as an unrelated form added after ticket review rather than participant-level
  context that applies to the whole conversation;
- the wide empty note field has more visual mass than the four primary choices;
- the buttons expose only color names in visible text, while their meanings live in `title`
  attributes and therefore are not reliably discoverable on touch, by keyboard, or at a glance.

The desired hierarchy is:

```text
Participant name                         Participant n of total

Bandwidth check-in
How is your workload today?
[ Red · Drowning | Yellow · Overloaded | Green · Comfortable | Purple · Available ]
[ Add context (optional) ]

Sprint tickets                                      Updated h:mm AM
...
```

This change follows the repository's calm, information-dense visual language: use spacing and a
quiet section boundary rather than adding another card; keep one accent selection treatment; reuse
existing theme/status colors; and keep the editable note surface compact and subordinate.

## 2. Verified current behavior and evidence

These facts were verified from the working tree on 2026-08-16. Files involved in Standup are
currently uncommitted user-owned work and must be edited surgically.

### 2.1 Rendering and style seams

- [`RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx) defines the
  `feelings` metadata and the local `TeamRound` component.
- `TeamRound` renders participant identity, then `StandupTickets`, then the bandwidth controls.
- The same component owns the current check-in collection, selected entry lookup, note draft, and
  calls to `api.upsertBandwidthCheckIn(...)`.
- [`styles.css`](../packages/frontend/src/styles.css) defines shared `.feeling` and
  `.feeling-{color}` rules used by both Standup and Team bandwidth controls.
- `.standup-grid .control` adds a 16px top margin; combined with the general form-control styling,
  that makes the optional note read as a large, separate form row.
- The modal already becomes a single full-viewport column at `max-width: 700px`; any new control
  must wrap or stack without horizontal overflow in that existing breakpoint.

### 2.2 Persistence contract

- [`api.ts`](../packages/frontend/src/data/api.ts) exposes the existing typed
  `upsertBandwidthCheckIn(memberId, date, { feeling, note })` call.
- [`domain.ts`](../packages/shared/src/domain.ts) defines the stable semantic values `red`,
  `yellow`, `green`, and `purple`; these values must not change for display-copy reasons.
- [`bandwidth.ts`](../packages/backend/src/db/bandwidth.ts) validates those four values, trims a
  note, turns empty text into `null`, enforces the existing 2,000-character limit, and upserts one
  record per member/date.
- No backend, database, migration, or API change is required for this refinement.

### 2.3 Participant-local state defects exposed by the refinement

- `note` is initialized once with `useState('')`, while `TeamRound` remains mounted as its
  `participant` prop advances. Without synchronization, a local draft can carry into the next
  participant and can be sent with that person's feeling selection.
- The input value is currently `note || entry?.note || ''`. When a saved note exists, setting the
  draft to an empty string falls back to the saved note, so the user cannot visibly clear it.
- Feeling saves are asynchronous and unguarded. Rapid selections can resolve out of order, allowing
  an older response to replace the latest intended selection in local state.
- Mutation failures have no participant-local visual state. This plan treats error/retry feedback
  as part of the refined check-in, but does not change the API contract.

### 2.4 Existing verification seam

- [`standup-tickets.spec.ts`](../packages/frontend/e2e/standup-tickets.spec.ts) already creates a
  deterministic active Standup session, stubs participant ticket requests, opens the modal, and
  checks both 1280x900 and 390x844 viewports.
- That harness is the natural place for focused bandwidth placement, interaction, accessibility,
  participant-transition, and overflow coverage. Ticket assertions must remain intact.

## 3. Decisions and invariants

### 3.1 Placement

Render the bandwidth check-in immediately after the participant identity/progress and before
`StandupTickets`. This is the selected design.

Do not place it:

- in the left rail, because it would separate participant input from participant work;
- in the modal footer, because optional context does not belong beside navigation actions and the
  footer must remain dedicated to `Skip` and `Next`;
- beside the participant name at desktop only, because that creates a different interaction order
  at narrow widths and leaves no coherent location for context;
- inside a standalone `.panel` or heavy card, because the section does not need independent
  actionability or another dominant surface.

### 3.2 Visible language and semantic values

Keep the persisted values and their established meanings. Use concise visible labels that remain
recognizable during a spoken standup:

| Value | Visible treatment | Full meaning retained for accessible/supporting copy |
| --- | --- | --- |
| `red` | **Red · Drowning** | Drowning |
| `yellow` | **Yellow · Overloaded** | Things are getting overloaded, but I'm managing |
| `green` | **Green · Comfortable** | I'd be happy if I had this amount of work all the time |
| `purple` | **Purple · Available** | I don't have enough work to do |

The concise second words are display copy, not new domain states. If product review prefers other
short labels, change only the display metadata and tests; do not change API values, stored data,
calendar aggregation, or color mappings.

### 3.3 Selection control

- Present the four options as one compact, equal-weight segmented group at desktop widths.
- Prefer native `input type="radio"` controls with styled labels over manually managed
  `role="radio"` buttons. Native radios provide expected Tab/arrow/Space behavior without a custom
  roving-tabindex implementation.
- Use a semantic `fieldset`/`legend` or an equivalent correctly labeled native group. The compact
  helper question may be visual while the legend supplies the accessible group name.
- Keep the semantic color tint restrained. Show selection with more than color: accent border or
  outline, a check indicator, and `:checked` state. Preserve an obvious `:focus-visible` treatment.
- At narrow widths, use a two-column grid and allow labels to wrap. Fall back to one column only
  when necessary; never force horizontal modal overflow.
- Introduce Standup-specific classes such as `.standup-bandwidth` and
  `.standup-bandwidth-option`. Do not reshape shared `.feeling` rules in a way that changes Team's
  calendar filters unintentionally.

### 3.4 Optional context disclosure

- With no saved note and no selected feeling, do not render a dominant empty input.
- After a feeling is selected, show a compact secondary affordance labeled
  **Add context (optional)**.
- Activating it reveals one text input with the same `--panel-2`, quiet border, 8px radius, type
  scale, hover, and focus treatment as nearby Standup inputs.
- If the participant already has a saved note, reveal the input on entry and label the affordance
  **Edit context (optional)** when a disclosure control remains visible.
- Use the controlled draft as the sole input value. Empty text must remain visibly empty and save
  as `null`; never use truthiness fallback to the saved note.
- Keep the existing maximum of 2,000 characters. Add `maxLength={2000}` for immediate client-side
  consistency while retaining backend validation as authoritative.
- Save a changed note on blur using the currently selected feeling. Do not create a note-only
  record before a feeling exists. Avoid adding an extra primary button.
- Keep a revealed empty input open after the user clears and blurs it during that participant step;
  collapsing it immediately would make the successful clearing action ambiguous.

### 3.5 Save and participant state contract

Treat each `(participant.memberId, aggregate.session.date)` as a distinct editor state:

1. On participant/date change, derive the committed feeling and note from the matching `entry`.
2. Reset the note draft to that entry's note or `''`, reset disclosure to open only when a note is
   present, and clear transient error/saving state.
3. Selecting a feeling updates the visible selection promptly and upserts it with the current
   participant's draft note.
4. Blurring a dirty revealed note upserts the currently committed feeling with the exact draft;
   trimmed empty text becomes `null` on the backend.
5. A successful response replaces that member/date entry in local `checkIns` and becomes the new
   committed baseline.
6. A failed response leaves the attempted draft visible, restores or retains the last confirmed
   selection without pretending it saved, and shows compact participant-local retry guidance.
7. Only the latest request for the current member/date may update committed local state. Use a
   request sequence/ref or equivalent guard so an older response cannot overwrite a newer choice.
8. Navigating to another participant must never send or display the previous participant's draft.

`Next` and `Skip` remain optional with respect to bandwidth: do not disable either merely because
the participant made no selection. This preserves the explicit Standup workflow contract.

## 4. Target states

The implementation must deliberately render and verify:

- **No check-in:** all choices unselected; context affordance withheld until a feeling is chosen.
- **Existing check-in without note:** saved choice selected; `Add context (optional)` available.
- **Existing check-in with note:** saved choice selected; note editor available with exact text.
- **Selecting/saving:** latest choice remains visually clear; a restrained saving indication may
  be announced without shifting layout or focus.
- **Note edited:** draft remains controlled and saves on blur; unchanged blur does not issue a
  redundant request.
- **Note cleared:** empty field stays empty and persistence receives an empty string or `null` so
  the stored note becomes `null`.
- **Save failed:** last confirmed state is distinguishable from the unsaved attempt; error is
  visible, associated with the group, and retryable without losing the draft.
- **Participant advanced:** the new participant shows only their own entry and draft.
- **Desktop:** one compact segmented row, visually subordinate to participant identity and above
  ticket content.
- **Narrow viewport:** options wrap into a usable grid, context fits the content width, and the
  modal has no horizontal overflow.

## 5. Implementation slices

### Slice 1 — Isolate check-in metadata and participant-local state

**Files:**

- `packages/frontend/src/components/RunStandupPage.tsx`

**Work:**

- Expand the existing `feelings` metadata with concise visible copy while retaining the current
  semantic value and full description.
- Prefer extracting a local `StandupBandwidthCheckIn` component from `TeamRound` so participant
  state, mutation ordering, and accessible markup are understandable and testable without further
  enlarging `TeamRound`.
- Pass only the current member/date/entry and an entry-update callback; keep API ownership inside
  the focused component or make the mutation dependency explicit.
- Implement draft initialization/reset, dirty tracking, disclosure state, saving/error state, and
  latest-request guarding.
- Keep `checkIns` replacement keyed by both `memberId` and `date`.

**Exit:** advancing participants cannot carry note state across members, clearing a note remains
visible, and out-of-order responses cannot replace the latest committed check-in.

### Slice 2 — Reorder and restyle the bandwidth section

**Files:**

- `packages/frontend/src/components/RunStandupPage.tsx`
- `packages/frontend/src/styles.css`

**Work:**

- Move the focused check-in component between participant progress and `StandupTickets`.
- Render a compact heading/helper, native radio group, clear selected/focus states, and progressive
  optional-context disclosure.
- Add Standup-specific layout classes using existing tokens and geometry.
- Adjust `.standup-tickets` margins only as needed to create a consistent section rhythm after the
  reorder; do not regress the compact ticket-list treatment.
- Add narrow-screen wrapping/grid rules inside the existing Standup breakpoint.
- Include reduced-motion-safe behavior if any transition is added; no transition is required.

**Exit:** the check-in reads as participant context above tickets at desktop and mobile, without a
new heavy card, browser-default control styling, or overflow.

### Slice 3 — Focused automated and visual verification

**Files:**

- `packages/frontend/e2e/standup-tickets.spec.ts`, if extending the existing integrated harness
  keeps it readable; otherwise add `packages/frontend/e2e/standup-bandwidth.spec.ts`
- focused unit/component test file only if state logic is extracted into a pure helper or the
  repository's test setup supports the component without duplicating the Playwright harness

**Work:**

- Stub `PUT /api/bandwidth-check-ins/:memberId/:date` and record request payloads.
- Assert bandwidth appears before the Sprint tickets section in DOM and visual order.
- Assert the group has four accessible choices with full, non-color-only names.
- Exercise keyboard selection, visible focus, note disclosure, note save, saved-note editing, and
  clearing to `null`/empty.
- Advance to the next participant and prove the prior participant's draft is absent.
- Simulate a failed save and, if practical, reversed response order to cover retry/latest-write
  behavior.
- Retain the existing ticket-list assertions and verify 1280x900 and 390x844 widths have no
  horizontal overflow.
- Capture screenshots for manual comparison when the current test setup supports useful artifacts;
  do not add a brittle pixel snapshot solely for this change.

**Exit:** focused tests prove structure, persistence payloads, participant isolation,
accessibility, and responsive containment.

## 6. Failure, concurrency, accessibility, security, and observability

### Failure

- A bandwidth mutation failure must remain local to the check-in section; it must not close the
  modal, erase the draft, block ticket inspection, or prevent `Skip`/`Next`.
- Use concise inline error text and a retry affordance or make the same selection/blur action
  retryable. Do not route the failure only to a page-level message outside the modal.

### Concurrency

- Multiple quick selections can produce out-of-order network responses. Guard state publication by
  member/date and request sequence, or serialize writes without making the control feel frozen.
- A late response from the previous participant must not alter the current participant's visible
  editor. It may still update the keyed `checkIns` collection for its own member/date if it is the
  latest request for that key.

### Accessibility

- Use native radio semantics with one group label and full accessible names.
- Ensure meaning is available in text; `title` may remain supplemental but cannot be the only
  explanation.
- Preserve Tab, arrow-key, Space, hover, checked, and `:focus-visible` states.
- Announce saving/saved/error changes through a restrained `aria-live="polite"` region when status
  text is dynamic. Avoid announcing the entire Standup modal on every selection.
- Verify selected and focus borders, text, and state indicators under the existing dark theme.
  Color alone cannot communicate selection.

### Security and privacy

- This refinement does not change note storage or exposure. Notes remain plain text sent only to
  the existing bandwidth endpoint.
- Do not add note content to URLs, logs, analytics, ticket refresh requests, test failure messages,
  or accessible labels for aggregate controls.
- Render note content only as an input value; React's normal escaping remains intact.

### Observability

- No new telemetry is required for this local application refinement.
- User-visible inline mutation state is the operational signal. Existing HTTP/backend diagnostics
  remain authoritative for debugging, without logging note bodies.

### Migration

- No schema, data, URL, or stored-value migration is required. Existing records render through the
  new control unchanged.

## 7. Verification

Before any Node.js, npm, npx, Vitest, TypeScript, or Playwright command, run `nvm use` from the
repository root as required by `AGENTS.md`.

### Automated checks

Run focused checks while implementing, then the proportional frontend suite:

```bash
nvm use
npm --workspace @ecp/frontend run typecheck
npm --workspace @ecp/frontend run test
npm --workspace @ecp/frontend run e2e -- standup-tickets.spec.ts
```

If a dedicated spec is created, run it alongside the ticket spec:

```bash
nvm use
npm --workspace @ecp/frontend run e2e -- standup-bandwidth.spec.ts standup-tickets.spec.ts
```

Also run:

```bash
git diff --check
```

Do not claim the entire repository is clean or all tests pass unless those broader checks were
actually run. Preserve unrelated dirty-tree changes.

### Manual visual and interaction walkthrough

At approximately 1280x900:

1. Open Standup and start or resume an active session.
2. Confirm the check-in is directly below participant identity and above Sprint tickets.
3. Confirm all four choices have readable color and meaning, equal visual weight, and a quiet
   unselected treatment.
4. Select each choice with pointer and keyboard; verify checked and focus states independently.
5. Add, edit, clear, blur, and revisit optional context; verify the exact persisted result.
6. Click `Next`; verify the next participant has no prior participant draft or error.
7. Trigger or simulate an API failure and verify the modal remains usable and the attempted draft
   remains retryable.

At approximately 390x844:

1. Repeat the empty and existing-note states.
2. Confirm options form a readable two-column or single-column layout.
3. Confirm the note input fits the participant column and the page has no horizontal overflow.
4. Confirm ticket rows, modal footer, scrolling, and close behavior remain usable.

## 8. Acceptance criteria

The refinement is complete when all of the following are true:

- bandwidth renders below participant identity and above Sprint tickets;
- the section is grouped through rhythm and a quiet boundary, not a heavy standalone card;
- every choice visibly communicates color plus meaning and has a full accessible name;
- selection and keyboard focus are perceivable without relying on fill color;
- native keyboard radio behavior works and the narrow layout does not overflow;
- the empty note input no longer dominates the initial state;
- a participant can reveal, edit, save, and clear optional context;
- saved notes initialize correctly and empty drafts do not fall back to old saved text;
- moving to another participant resets disclosure, draft, saving, and error state to that
  participant's data;
- rapid saves cannot publish stale responses over the latest intended check-in;
- mutation failure preserves an honest last-confirmed state and a retryable attempted draft;
- `Skip` and `Next` remain available when no bandwidth feeling is selected;
- existing bandwidth API/domain/storage contracts and existing records are unchanged;
- ticket loading, populated, stale, unavailable, empty, external-link, and responsive behavior do
  not regress;
- focused typecheck, tests, Playwright coverage, and `git diff --check` pass.

## 9. Explicit non-goals

- Changing bandwidth meanings, persisted values, aggregate scoring, calendar colors, or Team-page
  analytics.
- Requiring a bandwidth selection before `Next` or `Skip`.
- Moving Standup navigation, changing routes, changing epic/team filtering, or amending the product
  constitution.
- Changing backend validation, database schema, check-in retention, or note privacy policy.
- Adding Jira writes, ticket mutations, capacity calculations, forecasting effects, dashboards,
  or telemetry.
- Redesigning the left epic rail, post-standup notes, Sprint ticket grouping, or modal footer.
- Introducing a general segmented-control primitive unless a second concrete consumer needs the
  exact same semantic and responsive behavior.

## 10. Continuation handoff

**Current status:** implemented on 2026-08-16. The focused check-in component now has
participant/date-local drafts, native radio controls, progressive context disclosure, guarded
latest-write handling, and inline retry feedback. The standalone ticket Playwright harness still
passes at desktop and narrow widths; its existing scope was retained rather than adding a second,
duplicative modal harness.

**Next action:** conduct the manual visual walkthrough in section 7 in a live Standup session,
including save-failure simulation if available.

**Inspect first:**

1. `packages/frontend/src/components/RunStandupPage.tsx`, especially `feelings`, `TeamRound`, and
   the current `save`/`note`/`entry` logic;
2. the Standup and bandwidth rules around the Team workspace section in
   `packages/frontend/src/styles.css`;
3. `packages/frontend/e2e/standup-tickets.spec.ts` for the existing deterministic modal harness;
4. `packages/frontend/src/data/api.ts` and `packages/backend/src/db/bandwidth.ts` only to confirm
   the unchanged mutation and note-normalization contract.

**First commands:**

```bash
git status --short
rg -n "feelings|TeamRound|bandwidth-feelings|standup-tickets" \
  packages/frontend/src/components/RunStandupPage.tsx \
  packages/frontend/src/styles.css \
  packages/frontend/e2e
```

Record completed slices, material discoveries, changed decisions, and verification results in this
file so it remains the source of truth after conversation context is cleared.
