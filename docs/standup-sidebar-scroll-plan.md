# Standup Sidebar Scroll Containment — Durable Implementation Plan

**Status:** Implemented and verified — Current epics and compact post-standup
note-list containment keep active-Standup progression controls reachable.

**Created:** 2026-08-25

**Worktree / branch:** `../engineering_capacity_planner-standup-sidebar-scroll` on
`fix/standup-sidebar-scroll`, created from `main` at `7c16ca1`

**Scope:** Keep the active Standup modal's `Skip` and `Next` controls visible while
follow-up notes and current epics grow. Give Current epics and, once it reaches a
compact two-note visual budget, post-standup notes dedicated local scroll regions
in the left sidebar rather than letting the whole dialog grow and push progression
controls below the viewport. Display the post-standup notes in their current
persisted order with visible ordinal numbers.

**Intended outcome:** During an active Standup, a facilitator can add or retain
post-standup items, review the participant's epics, choose a bandwidth check-in,
and always reach `Skip` or `Next` without scrolling the entire modal. At typical
desktop heights, the composer and existing notes remain immediately available;
the epic cards use the remaining sidebar height and scroll when they do not fit.

## 1. Problem statement and target behavior

The supplied desktop screenshot shows the active Standup dialog after a
post-standup item is present. The left column contains the note list and
composer above a long Current epics card list. That column expands the grid row,
which expands the modal's scrollable content. The `Skip`/`Next` footer follows
the grid in document flow, so it falls below the visible dialog area and requires
the facilitator to scroll before advancing.

The active-dialog layout must instead behave as:

```text
+--------------------------------------------------------------+
| Dialog header and close                                      |
+-------------------------+------------------------------------+
| Follow-up notes         | Participant, timer, bandwidth,     |
| Composer                | and sprint tickets                 |
|                         |                                    |
| Current epics           | (right content may scroll if long) |
| [bounded, scrollable]   |                                    |
+-------------------------+------------------------------------+
|                                            [Skip] [Next]      |
+--------------------------------------------------------------+
```

The header and action footer are fixed within the modal's bounded height. The
body may consume only the remaining space. The Current epics cards, not the
modal document flow, absorb ordinary sidebar overflow. If the notes section is
itself too large to coexist with its composer and a usable epic viewport, the
implementation must preserve the composer and progress controls, then make the
appropriate local content region scroll rather than reintroducing whole-modal
scroll for the active state.

## 2. Verified current behavior and evidence

These facts were verified in the dedicated worktree on 2026-08-25.

### 2.1 Rendering seam

- [`RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx)
  renders `StandupModal` and conditionally appends its `Skip`/`Next` footer
  after `TeamRound`.
- `TeamRound` renders `.standup-grid`. Its `<aside>` currently contains the
  compact `Notes` component, an ungrouped `Current epics` heading, and the
  `.standup-epic-list` card list as sibling content.
- Adding a note updates the same `aggregate.notes` data used by the compact
  sidebar `Notes` instance, so a note immediately increases the height before
  the epic cards. No backend or Jira change is involved.
- Post-standup and completed sessions render their main `Notes` surface instead
  of `TeamRound`; this issue and the proposed active-dialog geometry must not
  change those workflows.

### 2.2 Styling seam and root cause

- [`styles.css`](../packages/frontend/src/styles.css) gives `.standup-modal` a
  `max-height: 94vh` and `overflow: auto`.
- `.standup-grid` is an unconstrained two-column grid and its sidebar only has
  padding and a right border; neither the grid body, aside, nor epic list has a
  `min-height: 0`/overflow boundary.
- `.modal-actions` is a normal footer after that grid. As a result, a tall
  sidebar increases the modal's scroll height and pushes `Skip`/`Next` below
  the viewport. This matches the screenshot and is a frontend layout issue,
  not a participant-state or persistence issue.
- The existing narrow breakpoint at `max-width: 700px` makes the grid
  single-column and the modal full-screen. The desktop two-column containment
  rules must not clip or hide content in that mobile layout.

### 2.3 Existing validation support

- [`standup-note-composer.spec.ts`](../packages/frontend/e2e/standup-note-composer.spec.ts)
  already starts an active Standup with notes and route-mocked API responses.
- The frontend has Playwright support through `npm --workspace @ecp/frontend run e2e` and a
  1280×900 active-Standup harness in
  [`standup-tickets.spec.ts`](../packages/frontend/e2e/standup-tickets.spec.ts).
- No current test asserts that modal actions stay visible after the sidebar has
  enough notes/epics to overflow.

## 3. Decisions, invariants, and non-goals

### 3.1 Adopt a bounded active-Standup shell

Apply the fixed header / flexible body / fixed footer geometry only while a
session is active and a current participant is present. Prefer an explicit
active-state class on the existing `.standup-modal` over changing the generic
`.modal` behavior used by unrelated dialogs.

The active shell must use a concrete viewport-bounded height (or equivalent
`max-height` plus grid sizing), `grid-template-rows: auto minmax(0, 1fr) auto`,
and `overflow: hidden` at the modal boundary. Its body must be allowed to shrink
with `min-height: 0`.

### 3.2 Make Current epics the primary sidebar overflow region

Wrap the Current epics heading and card list in a named sidebar section. Make
that section a local grid/flex region with `min-height: 0`; make its card-list
viewport scroll vertically and retain spacing, card styling, and semantic order.

Keep notes and the note composer above the epics section in normal reading and
tab order. Do not relocate the composer, hide existing notes, or turn every
sidebar item into a generic modal scroll region merely to solve the issue.

If stress testing reveals a notes list large enough to exhaust the sidebar,
bound the notes-list viewport while keeping its heading/composer visible; record
that refinement in this plan. This is a fallback for extreme note counts, not
the default overflow target requested here.

### 3.3 Preserve participant progression and business behavior

- `Skip` and `Next` remain the existing native buttons, labels, disabled state,
  API calls, and focus order.
- The timer, bandwidth check-in, ticket refresh behavior, note persistence,
  drag/reorder interaction, and participant selection are unchanged.
- Do not alter routing, epic filtering, portfolio scope, shared capacity, or
  active/post-standup/completed session transitions.
- Do not add a new frontend banner, resize handle, or independent scrolling
  control.

### 3.4 Accessibility and visual constraints

- Keep the existing dark tokens, compact 8px card geometry, visible focus
  treatment, and semantic headings/lists.
- A scrollable epic region must be keyboard-scrollable when focused and must
  never prevent access to cards or their text. Do not hide scrollbars in a way
  that makes overflow undiscoverable.
- Preserve logical reading/tab order: notes, composer controls, Current epics,
  then the main participant content and footer according to DOM order.
- At narrow/full-screen layout, allow intentional document/body scrolling where
  necessary; do not apply desktop clipping rules that make sidebar content
  unreachable.

### 3.5 Explicit non-goals

- Changing how notes are created, deferred, completed, reordered, or persisted.
- Changing epic ownership/SME sorting, which epics appear, or card contents.
- Modifying backend APIs, database schema, Jira queries, or sync caches.
- Redesigning the right-side bandwidth/ticket surface beyond the overflow
  containment needed to keep it usable.

## 4. Implementation slices

### Slice 1 — Semantic sidebar grouping and active modal state

**Primary file:**

- [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx)

**Work:**

1. Derive a clear `isActiveRound` condition from the existing active session and
   current participant branch, then add a scoped active-layout class to the
   Standup modal without changing post-standup or completed markup.
2. Group the Current epics heading and its list in a named section/container
   (for example, `.standup-current-epics`) with an accessible heading
   relationship if needed.
3. Keep the compact `Notes` component and composer before that section. Do not
   change note API calls, state, or drag/reorder semantics.
4. Add stable class names/data attributes only where the focused Playwright test
   needs to distinguish the modal body, epic scroll viewport, and action footer.

**Exit condition:** active Standup markup identifies the bounded body and epic
region without changing non-active Standup states or data behavior.

### Slice 2 — Desktop containment and responsive CSS

**Primary file:**

- [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css)

**Work:**

1. Scope an active-only grid shell to `.standup-modal` with header, shrinkable
   body, and footer rows; contain overflow at the dialog boundary so the footer
   stays visible.
2. Give `.standup-grid`, its desktop sidebar, and the main participant pane the
   required `min-height: 0` sizing rules. Select local vertical scrolling for
   content that can exceed the flexible body rather than expanding the modal.
3. Make the named Current epics section consume the remaining sidebar space and
   make `.standup-epic-list` its vertically scrollable viewport. Retain current
   cards, role treatments, and normal card spacing.
4. Verify that the notes/composer area remains visually compact and that ordinary
   one-to-several-note cases prioritize epic-list overflow. Add a conservative
   extreme-note constraint only if required to maintain a visible composer and
   footer.
5. At `max-width: 700px`, override or avoid desktop height/overflow assumptions
   so the existing full-screen single-column dialog remains reachable and has no
   horizontal overflow.
6. Inspect desktop and narrow renderings against existing tokens and component
   rhythm; do not introduce a new surface, border family, or heavy visual frame.

**Exit condition:** at desktop height, the footer remains onscreen while a
long epic list scrolls inside the sidebar; at narrow width, all content remains
reachable without clipping or horizontal overflow.

### Slice 3 — Focused browser regression coverage and visual review

**Primary file:**

- [`packages/frontend/e2e/standup-note-composer.spec.ts`](../packages/frontend/e2e/standup-note-composer.spec.ts)
  or a new narrow focused spec alongside it

**Work:**

1. Extend the existing route-mocked active-Standup fixture with enough current
   epics and open notes to exceed a typical desktop modal body.
2. At 1280×900 (or a comparable desktop viewport), assert `Skip` and `Next`
   have bounding boxes wholly inside the modal viewport after notes render and
   after an added note response updates the aggregate.
3. Assert the epic-list viewport has overflow (`scrollHeight > clientHeight`)
   in the stress fixture, can be programmatically/keyboard scrolled, and its
   final card becomes reachable while modal action controls remain visible.
4. Retain current note-composer, mention, add-note, and reorder assertions.
5. At approximately 390×844, assert no horizontal overflow and verify all
   required content/actions remain reachable through the intended mobile scroll
   behavior; do not require the desktop epic-only scroll geometry there.
6. Capture Playwright diagnostics on failure. Use manual visual review rather
   than brittle pixel snapshots unless the repository deliberately adds a
   Standup visual baseline.

**Exit condition:** automated coverage reproduces the pre-fix pressure and
proves the visible-footer/scrollable-epics contract at desktop and reachable
content at narrow width.

## 5. Verification and acceptance criteria

Before Node-based commands, run `nvm use` from the worktree root.

Focused automated checks:

```bash
nvm use
npm --workspace @ecp/frontend run typecheck
npm --workspace @ecp/frontend run e2e -- standup-note-composer.spec.ts
npm --workspace @ecp/frontend run e2e -- standup-tickets.spec.ts
git diff --check
```

Then run `npm --workspace @ecp/frontend test -- --run` and the broader frontend
E2E suite if the focused spec or shared modal behavior reveals a regression.

Manual validation:

1. Start a Standup at a desktop-sized viewport with a team that has many tracked
   epics. Confirm `Skip`/`Next` are visible before any note is added.
2. Add several post-standup notes, including a long note. Confirm the composer
   remains usable and the action footer never moves below the dialog viewport.
3. Scroll Current epics to its final card. Confirm its cards remain readable,
   focusable if interactive content is added later, and its scrolling does not
   move the action footer.
4. Advance with `Next` and skip with `Skip`; confirm participant progression,
   ticket refresh, bandwidth selection, and timer behavior remain unchanged.
5. Resize to approximately 700px and 390px wide. Confirm no horizontal overflow,
   no clipped notes/epics/actions, and reachable single-column content.
6. Open a post-standup and a completed record. Confirm their note workflows and
   Finish/Delete action arrangements retain their current behavior.

The work is accepted when the active Standup footer stays visible with a
populated notes sidebar, Current epics is the normal desktop overflow region,
and all active/non-active/narrow-screen workflows remain reachable.

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| `min-height: 0` is omitted on an intermediate grid item, so content still expands the modal | Apply and verify it on every active-layout flex/grid boundary: modal body, grid, sidebar, and epic viewport. |
| A long notes list consumes all sidebar space | Preserve composer/footer first; add a local notes-list bound only after reproducing the extreme case, keeping epics as the ordinary overflow target. |
| Desktop overflow rules clip mobile content | Scope the bounded shell to desktop active layout and explicitly test the existing ≤700px full-screen layout. |
| A generic `.modal` rule changes unrelated dialogs | Use only Standup-specific active-state selectors. |
| Browser tests pass but hierarchy regresses | Review populated desktop/narrow renderings using the repository's dark UI tokens and compact layout guidance. |

## 7. Compact post-standup note-list cap and numbering (implemented 2026-08-26)

### 7.1 Request and verified seam

The supplied active-Standup screenshot shows two compact post-standup notes,
followed by the note composer. The requested visual boundary is immediately
after approximately two ordinary compact note rows: additional notes must not
continue to displace the composer, Current epics, or the fixed participant
footer. Instead, the existing note list must become vertically scrollable at
that point. Each visible note must also show its one-based current order.

Verified facts:

- `Notes` in
  [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx)
  receives the active sidebar variant through `compact`, while post-standup and
  completed views use the non-compact variant.
- The list is currently an unnumbered `<ul className="standup-note-list">`.
  Its map callback already supplies `index`, and the reorder API persists the
  order emitted from the same `aggregate.notes` array. A displayed ordinal can
  therefore always be derived as `index + 1`; no schema/API change is needed.
- `.standup-notes.compact` and `.standup-note-list` have no local maximum
  height or overflow boundary. Each added note grows the sidebar before the
  Current epics scroll region can use remaining space.
- The active modal and Current epics containment from slices 1–3 remain the
  established baseline. This amendment must not reintroduce whole-modal
  scrolling or change post-standup/completed note workflows.

### 7.2 Decisions and target contract

1. Apply this behavior only to `.standup-notes.compact`, which is the active
   Standup sidebar. The full post-standup and completed Notes surface keeps its
   existing unbounded document flow.
2. Preserve the Notes heading, count badge, composer, audience chip, and Add
   note button outside the local scroll viewport. Only the existing note list
   scrolls.
3. Set a desktop cap sized to approximately two normal compact note rows,
   including their separators. Use a named custom property or named compact
   list selector rather than an anonymous generic `max-height`; tune the final
   pixel value against the supplied desktop reference and record it in the
   implementation notes. The cap must remain sufficient for two short notes
   and must not consume the composer’s usable minimum height.
4. Use semantic ordered-list markup (`<ol>`) and a visible, restrained ordinal
   affordance (for example, a narrow `.standup-note-position` column). Keep
   the visual number separate from the drag handle and checkbox so it cannot
   be mistaken for an interactive control. The ordinal is derived from the
   rendered array (`index + 1`), so drag and keyboard reorder update it on the
   next aggregate render.
5. Retain `data-standup-note-id`, all drag/drop behavior, Arrow Up/Down
   keyboard reordering, checkbox labels, live reorder status, defer/delete
   controls, and API payloads exactly as they are today.
6. At the existing narrow (`max-width: 700px`) full-screen layout, retain a
   reachable local note list: do not disable the cap merely because the layout
   is single-column. The exact cap may be responsive if needed, but horizontal
   overflow, clipped composer controls, and inaccessible notes are prohibited.

Target desktop composition:

```text
Post-standup notes [count]
┌─────────────────────────────────────────┐
│ 1  ⠿  □  First note                     │
│ 2  ⠿  □  Second note                    │
│      (scroll here when additional notes) │
└─────────────────────────────────────────┘
───────────────────────────────────────────
New note composer and Add note controls
```

### 7.3 Implementation slice

**Primary files:**

- [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx)
- [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css)
- [`packages/frontend/e2e/standup-note-composer.spec.ts`](../packages/frontend/e2e/standup-note-composer.spec.ts)

1. In `Notes`, change the note-list semantics from `ul` to `ol` and render a
   non-interactive ordinal from `index + 1` for every note. Add scoped class
   hooks/data test IDs only where needed for the scroll contract; do not alter
   note mutation/reorder code.
2. In CSS, adjust the note-row grid to reserve a compact ordinal column when
   editable and read-only. Reuse `--muted`, existing type scale, gaps, and
   border rhythm; the number should be legible but subordinate to the note
   body. Ensure completed/read-only variants retain aligned, non-overlapping
   checkbox/body content.
3. Add a compact-only note-list viewport with `min-height: 0`, a documented
   approximately-two-row `max-height`, `overflow-y: auto`, and a stable
   scrollbar gutter/padding consistent with the epic scroll region. Keep the
   composer after the viewport in DOM and visual order. Re-check the active
   sidebar grid sizing so the notes cap and epics scroll region coexist.
4. Preserve the full (non-compact) Notes view. Confirm the projection’s
   Required people block remains outside any new compact-only selector.
5. Extend the existing route-mocked note composer test with at least three
   notes. Assert visible ordinals are `1`, `2`, `3`; assert the compact list
   overflows and its final note becomes visible after local scrolling; reorder
   and assert the visible numbering follows the newly rendered order. Continue
   asserting the composer and active footer remain visible.
6. Add a narrow-viewport assertion that the final note remains reachable by
   scrolling the note list, the composer/Add note control remains reachable,
   and `document.documentElement.scrollWidth <= window.innerWidth`.

### 7.4 Acceptance and validation

Before Node-based commands, run `nvm use` in this worktree. Run:

```bash
nvm use
npm --workspace @ecp/frontend run typecheck
PW_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  npm --workspace @ecp/frontend run e2e -- standup-note-composer.spec.ts
npm --workspace @ecp/frontend run test -- --run
git diff --check
```

Manual validation:

1. Start an active Standup with zero, one, two, and at least three follow-up
   notes. Confirm the third note creates a scrollbar inside the note list near
   the screenshot’s requested lower boundary, not a taller sidebar.
2. Confirm the visible labels are one-based and contiguous. Drag a note and
   use Arrow Up/Arrow Down to reorder it; confirm ordinals immediately reflect
   the persisted/rendered order and that existing reorder announcements remain
   correct.
3. Add a long note, scroll to it inside the note list, and confirm the composer,
   Current epics local scroll region, Skip, and Next remain usable.
4. Repeat at roughly 390×844. Confirm no horizontal overflow, all compact note
   rows can be reached, and the composer remains usable.
5. Open post-standup and completed records. Confirm their regular Notes lists
   are not capped or otherwise visually changed.

The amendment is accepted only when the active sidebar displays numbers for
every note, limits normal visible notes to roughly two compact rows, scrolls
additional notes locally, and preserves all existing note, epic, and
participant-progress interactions.

## 8. Continuation instructions

**Current status:** all slices in this plan are implemented and verified in this
worktree.

**Implemented (2026-08-25):**

- Slice 1: added the active-round modal class, named Current epics section, and
  stable epic-scroll/action hooks in `RunStandupPage.tsx`.
- Slice 2: added scoped desktop header/body/footer containment, a local Current
  epics scrollbar, and narrow-screen overrides in `styles.css`.
- Slice 3: added an 18-epic/three-note Playwright stress case that verifies the
  action footer remains inside the modal, the final epic card is reachable by
  local scrolling, a newly added note does not displace actions, and narrow
  layout has no horizontal overflow.

**Validation completed (2026-08-25):**

- `npm run build` — passed (after installing worktree dependencies)
- `npm --workspace @ecp/frontend run typecheck` — passed
- `PW_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' VITE_PORT=5174 npm --workspace @ecp/frontend run e2e -- standup-note-composer.spec.ts` — passed (3 tests)
- `npm --workspace @ecp/frontend run test -- --run` — passed (105 tests)
- `PW_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' VITE_PORT=5175 npm --workspace @ecp/frontend run e2e -- standup-tickets.spec.ts` — passed
- `git diff --check` — passed

**Compact note-list amendment implemented (2026-08-26):**

- Changed the shared note list to semantic ordered-list markup and added a
  restrained, non-interactive one-based ordinal column that follows rendered
  note order after drag or keyboard reordering.
- Added a compact-only `180px` note-list budget. Browser geometry showed the
  ordinary fixture rows at approximately `90px` including metadata and actions,
  so this keeps two complete rows visible while the third creates a dedicated
  local scrollbar. The full post-standup/completed list remains uncapped.
- Extended the active-Standup stress test to verify two complete visible rows,
  three-note overflow, final-note reachability, persisted keyboard reorder and
  renumbering, a fourth added note, footer/epic containment, and narrow-screen
  note/composer/action reachability without horizontal overflow.

**Validation completed (2026-08-26):**

- `npm --workspace @ecp/frontend run typecheck` — passed
- `PW_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' VITE_PORT=5174 npm --workspace @ecp/frontend run e2e -- standup-note-composer.spec.ts` — passed (3 tests)
- `npm --workspace @ecp/frontend run test -- --run` — passed (105 tests)
- `git diff --check` — passed

**Next action:** perform the manual validation in section 7.4, then commit or
open a pull request when requested.

**First files to inspect after context reset:**

1. [`docs/standup-sidebar-scroll-plan.md`](./standup-sidebar-scroll-plan.md),
   especially section 7
2. [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx), especially `StandupModal`, `TeamRound`, and `Notes`
3. [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css), especially `.standup-modal`, `.standup-grid`, `.standup-epic-list`, `.standup-note-list`, `.standup-note`, and the `max-width: 700px` block
4. [`packages/frontend/e2e/standup-note-composer.spec.ts`](../packages/frontend/e2e/standup-note-composer.spec.ts)

**Initial discovery commands:**

```bash
git status --short
rg -n "standup-modal|standup-grid|standup-epic-list|standup-note-list|standup-note" packages/frontend/src
rg -n "Standup|post-standup|epic" packages/frontend/e2e
```

Update this plan as implementation proceeds: mark completed slices, record the
exact successful validation commands, and document material layout decisions or
scope changes here.
