# Standup Ticket Cards and Readability — Durable Implementation Plan

**Status:** Implemented; manual validation pending

**Created:** 2026-08-16

**Last updated:** 2026-08-26

**Scope:** Improve the populated **Sprint tickets** section in the active Standup round by using
the available horizontal space, replacing compact rows with responsive ticket cards, and
increasing the ticket area's type scale and contrast so facilitators can read it comfortably
during a spoken standup.

**Intended outcome:** At ordinary desktop modal widths, tickets within each status group appear in
a balanced multi-column card layout with larger keys and summaries. The section remains easy to scan
at a distance, collapses deliberately at narrower widths, and preserves all existing ticket data,
status grouping, refresh states, external-link behavior, accessibility, and Standup progression.

**Superseded decision:** The 2026-08-16 version of this plan intentionally replaced individual
cards with compact list rows. The resulting implementation is shown in the 2026-08-26 reference
screenshot and is now the verified baseline, not the desired end state. This revision supersedes
that row-first decision because the current 11–12px treatment is difficult to see and leaves most
of the ticket pane visually unused when a participant has only a few tickets.

**Related durable context:**

- [`standup-facilitation-plan.md`](./standup-facilitation-plan.md)
- [`standup-status-display-configuration-plan.md`](./standup-status-display-configuration-plan.md)
- [`standup-ticket-refresh-reliability-plan.md`](./standup-ticket-refresh-reliability-plan.md)
- [`standup-speaker-attribution-and-persistent-actions-plan.md`](./standup-speaker-attribution-and-persistent-actions-plan.md)

## 1. Requested outcome and design direction

The user identified three related problems in the populated ticket view:

1. the large right-side content region is underused;
2. ticket rows should become cards; and
3. the current text is hard to see and likely needs a font-size increase.

The redesign should use horizontal space rather than manufacture vertical bulk. Three short
tickets should occupy a clear band of two or three cards near the top of the content region; they
should not stretch to fill the full modal height. More tickets should add natural rows within the
existing independently scrolling active-round body.

### 1.1 Target visual hierarchy

- Keep **Sprint tickets** and freshness information in a quiet section header.
- Keep each configured Jira status as a distinct group with its existing label, category marker,
  and count.
- Within a status group, render tickets as a responsive wrapping card layout.
- Make the Jira key a strong, immediately recognizable eyebrow and the summary the primary
  readable content beneath it.
- Use a visible but restrained card boundary and nested surface consistent with the existing dark
  planner UI.
- Keep the ticket section visually subordinate to the current participant and bandwidth controls,
  but no longer so small that it reads like metadata.

### 1.2 Approximate desktop composition

```text
Sprint tickets                                             Updated 2:50 PM

● IN PROGRESS                                                        [3]

┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ NF-2850 ↗            │  │ NF-2968 ↗            │  │ NF-2846 ↗            │
│ [SPIKE] Task Manager │  │ CLONE - [SPIKE]      │  │ [SPIKE] Define bulk  │
│ export contract      │  │ Review Tech Design   │  │ assign contract…     │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

This diagram expresses hierarchy and flow, not exact pixels. The implementation should choose the
column count from available width and a minimum readable card width, not hard-code exactly three
columns for all desktops.

## 2. Verified current behavior and evidence

These are repository facts verified on 2026-08-26.

### 2.1 Rendering seam

- [`RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx) contains the local
  `StandupTickets` component.
- Populated tickets are grouped through `groupStandupTickets(...)`; configured display names and
  ordering are therefore already separated from presentation.
- Each group is a semantic `<section>` with a heading, marker, count badge, and `<ul>`.
- Each ticket is currently one `<li className="standup-ticket">` with a linked or unlinked key and
  a summary. URL-backed keys open Jira in a new tab with `rel="noreferrer"`; tickets without a URL
  remain noninteractive text.
- The component already preserves initial loading, background refreshing, stale, unavailable,
  empty, populated, linked, and unlinked states. The card work does not require new data.
- The full ticket summary remains in the DOM and in a native `title`, although CSS visually clamps
  it to two lines at desktop widths.

### 2.2 Layout seam

- The active Standup modal is a three-region grid with a fixed header, independently scrolling
  body, and fixed action footer at desktop widths.
- `TeamRound` divides that body into a left sidebar and a right `.standup-round-content` column at
  roughly a 1:2 ratio. `StandupTickets` lives in the right column below participant and bandwidth
  content.
- The modal is up to 1200px wide. The ticket area commonly has enough room for multiple cards, as
  demonstrated by the provided screenshot, but the current row layout uses the width only as one
  long line per ticket.
- At `max-width: 700px`, the Standup view becomes one column and ticket rows currently stack key
  above summary.
- The body scroll contract is important: additional tickets must scroll within the content region
  and must not push **Skip** or **Next** out of view at supported desktop sizes.

### 2.3 Styling seam and readability cause

- The relevant CSS is the `.standup-tickets`, `.standup-ticket-heading`,
  `.standup-ticket-groups`, `.standup-ticket-group`, `.standup-ticket-list`, and
  `.standup-ticket*` block in [`styles.css`](../packages/frontend/src/styles.css).
- Current status headings and freshness text are 11px. Ticket rows are 12px with 5px vertical
  padding, no individual surface, and only a 1px separator.
- Keys and summaries share the same 12px base size. Summaries begin in a narrow fixed 96px-key row
  grid and are clamped to two lines.
- The reference screenshot confirms the consequence: the content is technically compact and
  aligned, but the tickets occupy a thin strip at the top of a large pane and are hard to read.
- The root cause is presentational, not a Jira, API, persistence, refresh, routing, or modal-sizing
  defect.

### 2.4 Existing coverage

- [`standup-tickets.spec.ts`](../packages/frontend/e2e/standup-tickets.spec.ts) already provides a
  deterministic Playwright harness for three status groups, a long summary, linked and unlinked
  tickets, semantic lists, focus visibility, and desktop/mobile overflow.
- [`standupStatusPresentation.test.ts`](../packages/frontend/test/standupStatusPresentation.test.ts)
  covers pure status grouping and group-tone behavior.
- The browser spec currently describes and asserts the compact-row treatment. It must be revised
  to assert card layout behavior without becoming a brittle pixel snapshot.

## 3. Decisions, invariants, assumptions, and non-goals

### 3.1 Use responsive cards inside each status group

Retain the semantic status group and list structure, but style each ticket list as a wrapping card layout. Each
`li` becomes a visually distinct ticket card. Start implementation with a card minimum width near
220–240px and `repeat(auto-fit, minmax(..., 1fr))`, then tune against the actual right-column width.

Expected behavior:

- a wide ticket pane naturally fits three cards when doing so preserves readable summaries;
- a medium pane fits two cards;
- a narrow pane fits one card;
- a single remaining card must not become an implausibly wide banner merely because `auto-fit`
  gives it all remaining space. Cap its width or use a column strategy that keeps lone cards
  visually proportional while allowing a populated row to use the available width.

The exact minimum and maximum widths are visual tuning details, not new global tokens. Prefer a
small scoped CSS custom property only if it makes the grid easier to understand.

### 3.2 Cards are ticket-sized navigation units

A Jira-backed ticket is independently actionable, so making its full card the anchor is
appropriate. Prefer this DOM shape:

```html
<li class="standup-ticket">
  <a class="standup-ticket-card" target="_blank" rel="noreferrer">
    <span class="standup-ticket-key">NF-2850 ↗</span>
    <span class="standup-ticket-summary">…</span>
    <span class="sr-only">Opens in a new tab</span>
  </a>
</li>
```

For a ticket without a URL, render the same internal information hierarchy in a noninteractive
`.standup-ticket-card`, preferably an `<article>`. Do not add fake link/button semantics. Linked
cards receive pointer, hover, active, and `:focus-visible` states; unlinked cards do not imply
clickability.

The accessible link name should include both the key and summary naturally, plus concise new-tab
context once. Avoid an `aria-label` that discards visible summary text or causes duplicate speech.

### 3.3 Increase type size locally, not globally

The readability request is scoped to the Standup ticket surface. Start with these ranges and tune
visually:

- section heading: 17–18px;
- status heading and count: 12–13px;
- ticket key: 14px, bold;
- ticket summary: 14–15px with approximately 1.4 line height;
- freshness/loading metadata: 12px.

Do not change the global body, `.badge`, `.hint`, or modal type scale. Scoped selectors must keep
other screens stable. Use font weight, line height, and contrast together; font size alone will
not solve readability if the summary remains overly muted.

### 3.4 Use restrained card styling

- Use `--panel-2` as the nested ticket surface, `--border` for the quiet 1px boundary, and the
  established 8–10px radius family.
- Use approximately 12–14px card padding and 10–12px grid gaps, then tune vertical rhythm in the
  real modal.
- Use accent color for linked keys, focus, and a restrained linked-card hover border/surface.
- Do not add shadows, saturated status backgrounds, thick borders, gradients, or a new radius
  language.
- Preserve the existing category marker at the group level. Do not repeat a large status badge on
  every card when all cards in the group already share the same status.
- Done cards may be quieter, but must remain comfortably readable. Remove the current whole-row
  opacity reduction; prefer a muted summary or subtle surface/border adjustment so linked keys and
  focus indicators retain full contrast.

### 3.5 Prefer readable wrapping over aggressive truncation

Show at least three summary lines at desktop card widths, and allow natural wrapping when content
is still reasonably bounded. If a clamp is retained to prevent unusually long Jira summaries from
dominating a group, use a three-line minimum, keep the full summary in the DOM and `title`, and
verify that the last line has a clear truncation affordance.

At one-column mobile widths, allow full summary wrapping unless visual testing proves a bounded
policy is necessary. Use `min-width: 0` and `overflow-wrap: anywhere` to prevent long tokens from
creating horizontal overflow.

### 3.6 Preserve system and product contracts

- Keep configured status names, group ordering, fallback ordering, and category-based marker
  tones unchanged.
- Keep loading, refreshing, stale, unavailable, and empty copy/behavior unchanged except for
  scoped readability adjustments.
- Keep the exact freshness `<time>` value and tooltip; do not add a relative-time interval.
- Keep external destinations, `target="_blank"`, safe `rel`, and URL-less behavior.
- Keep **Skip**/**Next** hierarchy, availability rules, DOM/tab order, and the persistent desktop
  footer intact.
- Do not change routing, navigation, epic filtering, portfolio/epic scope, or shared-capacity
  behavior.
- Do not change backend, database, Jira query, refresh concurrency, or snapshot contracts.

### 3.7 Explicit non-goals

- Filling the entire vertical ticket pane with stretched cards.
- Adding descriptions, assignees, avatars, story points, parent epics, or status controls.
- Making tickets editable, draggable, selectable, or expandable inside Standup.
- Adding a list/card preference or persisted display setting.
- Reworking the participant, bandwidth, notes, sidebar, timer, or modal shell.
- Introducing a shared card primitive without a second verified consumer.

## 4. Exact target behavior by viewport and state

| Context | Required behavior |
| --- | --- |
| Wide active-round content pane | Cards use available width in a balanced multi-column grid, normally three columns for the screenshot's three-ticket case |
| Medium pane | Grid reduces to two columns before any card becomes too narrow to read |
| Narrow/mobile pane | One card per row, full readable summary wrapping, no page-level horizontal overflow |
| One ticket in a group | Card remains proportionally sized and aligned to the grid start; it does not stretch into a full-width banner unless the viewport itself is narrow |
| Multiple status groups | Each group owns its grid; cards never reorder or visually merge across statuses |
| Linked ticket | Entire card is a keyboard-focusable external link with visible hover/focus treatment and new-tab context |
| Unlinked ticket | Same readable card hierarchy but no pointer cursor, hover affordance, or interactive semantics |
| Done group | Existing green group marker remains; card content is slightly quieter but fully legible |
| Long summary | At least three readable lines or natural wrapping; full text remains available; no overflow |
| Refreshing with saved data | Existing cards stay visible while restrained refresh status is announced |
| Initial loading | Explicit loading copy remains; no empty-card flash |
| Stale/unavailable/empty | Existing state copy remains clear and uses the enlarged local section hierarchy where applicable |
| Many tickets | Cards add rows inside `.standup-round-content`; desktop footer remains visible and only the stage body scrolls |

## 5. Ordered implementation slices

### Slice 1 — Card markup and interaction contract

**Status:** Implemented

**Primary seam:**

- [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx)

**Work:**

1. Preserve `StandupTickets`, `groupStandupTickets(...)`, group sections/headings, and native list
   semantics.
2. Give each ticket one consistent card-content hierarchy: key row followed by summary.
3. For URL-backed tickets, move the anchor to cover the full card content while retaining
   `target="_blank"` and `rel="noreferrer"`.
4. Replace the current key-only `aria-label` with visible-content-derived naming and one
   screen-reader-only new-tab message.
5. For URL-less tickets, render matching noninteractive card content without click handlers,
   `tabIndex`, or link-like labeling.
6. Keep decorative external glyph and group marker hidden from assistive technology.
7. Preserve the summary's full text and native tooltip.

**Exit:** Linked and unlinked tickets have correct native semantics and the DOM supports a full-card
focus/hover surface without changing grouping or data flow.

### Slice 2 — Responsive card layout and readable visual system

**Status:** Implemented

**Primary seam:**

- [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css)

**Work:**

1. Convert `.standup-ticket-list` from a single-column list to a responsive wrapping card layout.
2. Add a proportional maximum behavior for lone/incomplete rows so cards use space without
   stretching awkwardly.
3. Replace row separators and the 96px key/summary columns with nested card surfaces and a vertical
   key-summary hierarchy.
4. Increase section, group, key, summary, and freshness sizes within the ranges in section 3.3.
5. Add card padding, gaps, border, radius, surface, line height, and text wrapping using existing
   tokens.
6. Add linked-card hover, active, and `:focus-visible` states. Ensure focus outlines are not clipped
   by list/card overflow.
7. Remove whole-card opacity from done groups and apply any de-emphasis only to nonessential text.
8. Raise the summary clamp to at least three lines or remove it when natural wrapping remains
   balanced.
9. Revise the existing `max-width: 700px` rules for a one-column card stack with natural summary
   wrapping.
10. Check the 701–900px range explicitly; add one scoped intermediate breakpoint only if intrinsic
    grid sizing does not transition cleanly.

**Exit:** The screenshot's three-ticket case reads as a balanced multi-card row at comparable
desktop width, text is visibly easier to read, and the layout remains calm rather than blocky.

### Slice 3 — Automated regression coverage

**Status:** Implemented

**Primary seams:**

- [`packages/frontend/e2e/standup-tickets.spec.ts`](../packages/frontend/e2e/standup-tickets.spec.ts)
- [`packages/frontend/test/standupStatusPresentation.test.ts`](../packages/frontend/test/standupStatusPresentation.test.ts)
  only if group logic changes unexpectedly

**Work:**

1. Rename the Playwright test away from “compact” terminology and keep the existing synthetic
   route-mocked harness.
2. Update link expectations for the full-card accessible name and verify the unlinked card remains
   noninteractive.
3. At a representative desktop viewport, measure card bounding boxes to assert that the
   three-ticket active group uses multiple columns. Prefer relationship assertions—distinct
   horizontal positions and shared first-row vertical position—over fixed pixel sizes.
4. Add or adjust the fixture so one group has at least three tickets; retain multiple groups, a
   long summary, a done group, and a URL-less ticket.
5. Assert each card's computed summary font size is at least 14px. This encodes the core readability
   requirement without taking a brittle screenshot diff.
6. Verify a lone card does not consume nearly the entire multi-column group width at desktop.
7. Verify full-card keyboard focus and a visible focus outline.
8. Repeat at approximately 800px if needed to prove the two-column transition and at 390px to prove
   the one-column stack and lack of horizontal overflow.
9. Preserve semantic list, heading/count, timestamp, safe-link, and done-tone assertions.
10. Do not add pixel snapshots unless the repository deliberately adopts them for this surface.

**Exit:** Focused browser coverage fails if cards collapse back to rows, text shrinks below the
readability floor, responsive columns break, semantics regress, or overflow returns.

### Slice 4 — Rendered visual review and plan closeout

**Status:** Implemented; user validation pending

**Work:**

1. Run the focused browser harness and inspect the rendered populated state at wide, medium, and
   narrow viewports.
2. Compare the wide result against the 2026-08-26 reference screenshot for space use and
   legibility, not pixel identity.
3. Tune the card minimum/maximum width, padding, gap, and local font sizes within the documented
   ranges.
4. Exercise loading, refreshing, stale, unavailable, empty, done, long-summary, and many-ticket
   states.
5. Record exact validation results and any material design decisions in this plan. Mark the plan
   implemented only after both automated and manual checks pass.

**Exit:** The card view is visibly easier to read, uses available width intentionally, and does not
compromise scrolling, actions, or responsive behavior.

## 5.5 Validation record — 2026-08-26

- `npm --workspace @ecp/frontend run typecheck` passed under Node 22.22.3.
- `npm --workspace @ecp/frontend run test -- --run test/standupStatusPresentation.test.ts` passed
  (5 tests).
- `npm --workspace @ecp/frontend run e2e -- standup-tickets.spec.ts` passed. The revised browser
  coverage verifies the full-card external link name and focus outline, a three-card desktop row,
  a two-column layout at 900px, a one-column layout at 390px, lone-card sizing, 14px summary
  text, and no page-level horizontal overflow.
- Rendered desktop review confirmed a restrained three-card active-status row, readable key/summary
  hierarchy, appropriately smaller lone cards in later status groups, and persistent action footer.
- Implementation choices: cards use a 220px intrinsic minimum, 280px per-card maximum for
  incomplete rows, 12px gaps, `--panel-2` surfaces, and a three-line desktop clamp. A wrapping
  flex layout packs incomplete rows from the left instead of distributing spare space. At mobile,
  cards use one column and summaries wrap without the clamp.

## 6. Cross-cutting considerations

### Accessibility

- Preserve heading order, native group/list structure, native anchors, and visible focus.
- A full-card link must have one coherent accessible name containing its visible key and summary,
  plus new-tab context; do not duplicate the key or summary through conflicting `aria-label` text.
- Decorative marker and external glyph remain `aria-hidden`.
- Text should remain readable under browser zoom and OS text scaling; cards must grow or reflow
  instead of clipping.
- Do not rely on hover or color alone to identify a linked ticket. The accent key and external
  glyph remain visible without hover.
- Verify muted freshness and done summaries retain usable contrast on `--panel-2`.
- Avoid noisy live-region announcements when the anchor wrapper changes; preserve existing
  `aria-live`/`aria-busy` behavior unless a focused accessibility test proves it duplicative.

### Failure and concurrency

This is a local presentation change. It must not change request ownership, snapshot publication,
retry behavior, stale-data preference, or participant prefetching. Loading or failure must never
disable **Skip** or **Next**.

### Performance

Wrapping flex layout and ordinary anchors are sufficient. Do not add JavaScript resize listeners,
`ResizeObserver`, masonry layout, virtualization, or client-side measurement for the expected
ticket counts. The existing content scroll region handles longer sets.

### Migration and compatibility

No API, shared-domain, database, setting, or migration change is expected. Older snapshots without
URLs continue to render as noninteractive cards. If implementation appears to require a contract
change, stop and record the discovery here before expanding scope.

### Security and privacy

Retain safe external-link attributes. Keep fixtures synthetic and do not add real ticket titles,
Jira URLs, account IDs, or participant data to tests or screenshots committed to the repository.

### Observability

No runtime telemetry is warranted for a visual-only refinement. Existing loading/stale/error copy
remains the operational feedback. Normal Playwright traces and screenshots are sufficient for
test diagnostics.

## 7. Verification

Before every Node-based command, select the repository's declared Node version from the repository
root:

```bash
nvm use
```

Run narrow checks first:

```bash
npm --workspace @ecp/frontend run typecheck
npm --workspace @ecp/frontend run e2e -- standup-tickets.spec.ts
npm --workspace @ecp/frontend run test -- --run test/standupStatusPresentation.test.ts
git diff --check
```

If focused checks pass, run the full frontend unit suite. Run broader repository tests only if the
implementation crosses a shared seam.

### Manual validation walkthrough

1. Open an active Standup round for a participant with three tickets in one active status, matching
   the reference screenshot as closely as practical with synthetic or non-sensitive data.
2. At approximately 1280×900, confirm the cards use the content width as a balanced row, keys and
   summaries can be read comfortably, and the ticket area does not look like tiny metadata.
3. Confirm a lone ticket in another group stays card-sized and aligned rather than stretching into
   a full-width banner.
4. Confirm status labels/counts remain easy to associate with their cards and group order is
   unchanged.
5. Hover and keyboard-focus linked cards. Confirm the whole card is clickable, focus is obvious,
   the destination opens in a new tab, and a URL-less card does not look or act clickable.
6. Inspect a done card and verify it is quieter but not faded into illegibility.
7. Inspect a long summary at wide and medium widths. Confirm at least three lines are available or
   the full text wraps, a tooltip exposes the complete title, and no content overflows.
8. Repeat around 900px, 700px, and 390px. Confirm a natural three/two/one-column progression as
   available width permits, no clipped focus ring, and no page-level horizontal scrolling.
9. Populate enough tickets to overflow the round body. Confirm only that body scrolls and **Skip**
   and **Next** remain visible on desktop.
10. Exercise initial loading, background refresh, stale, unavailable, and empty states. Confirm
    their meaning and progression behavior are unchanged.

## 8. Acceptance criteria

- Tickets render as visibly distinct, restrained cards rather than separator-based rows.
- At the reference screenshot's approximate content width, three same-status tickets normally use
  a multi-column row rather than three full-width lines.
- The layout transitions according to available space and produces one readable column on narrow
  mobile screens without horizontal overflow.
- A lone ticket remains proportionally card-sized in a wide group and does not become an oversized
  banner.
- Ticket summaries render at 14px or larger with comfortable line height; keys render at 14px or
  larger; local section/status metadata also receives the documented modest increase.
- Long summaries show at least three lines or wrap naturally, preserve the full text, and do not
  overflow.
- A linked ticket's entire card is keyboard and pointer actionable, retains safe new-tab behavior,
  and has visible default, hover, active, and focus states.
- URL-less tickets use the same information hierarchy without fake interactivity.
- Existing configured group names/order, category markers, count badges, freshness, loading,
  refreshing, stale, unavailable, empty, and done behavior remain correct.
- Done content remains readable without whole-card opacity suppression.
- Many tickets scroll inside the active-round body while the desktop action footer remains visible.
- Focused typecheck, unit, browser, overflow, and manual visual checks pass.
- No backend, Jira, database, modal-shell, routing, navigation, or product-scope behavior changes
  are included.

## 9. Continuation instructions

**Current status:** Implementation and automated validation are complete. User manual validation
is pending. The working tree may contain unrelated user-owned changes; preserve them.

**Next action:** No further implementation is planned. Re-run the focused frontend checks if this
surface changes.

**First files to inspect after context reset:**

1. [`docs/standup-ticket-list-visual-refinement-plan.md`](./standup-ticket-list-visual-refinement-plan.md)
2. [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx),
   especially `TeamRound` and `StandupTickets`
3. [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css), especially
   `.standup-modal`, `.standup-round-content`, and `.standup-ticket*`
4. [`packages/frontend/e2e/standup-tickets.spec.ts`](../packages/frontend/e2e/standup-tickets.spec.ts)
5. [`packages/frontend/src/lib/standupStatusPresentation.ts`](../packages/frontend/src/lib/standupStatusPresentation.ts)
6. [`packages/frontend/test/standupStatusPresentation.test.ts`](../packages/frontend/test/standupStatusPresentation.test.ts)

**Initial discovery commands:**

```bash
git status --short
rg -n "StandupTickets|standup-ticket|standup-round-content" packages/frontend/src packages/frontend/test packages/frontend/e2e
```

Keep this artifact current as slices complete. Mark slice statuses, record successful commands,
capture any deviations from the sizing/layout decisions, and update **Next action** before ending
each implementation slice.
