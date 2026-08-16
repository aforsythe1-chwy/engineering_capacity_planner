# Standup Ticket List Visual Refinement — Durable Implementation Plan

**Status:** Implemented; focused frontend validation in progress

**Created:** 2026-08-16

**Scope:** refine the populated Sprint tickets section in the Standup modal so it is compact,
easy to scan, responsive, and visibly consistent with the planner's restrained dark UI

**Intended outcome:** replace the current stack of full-width ticket cards with a compact,
aligned status list; clarify group counts and status; reduce timestamp prominence; handle long
summaries deliberately; and make Jira-link behavior apparent without changing ticket data,
grouping policy, refresh behavior, or standup progression

**Related plans:**

- [`standup-facilitation-plan.md`](./standup-facilitation-plan.md)
- [`standup-status-display-configuration-plan.md`](./standup-status-display-configuration-plan.md)
- [`standup-ticket-refresh-reliability-plan.md`](./standup-ticket-refresh-reliability-plan.md)

## 1. Context and target experience

The populated Sprint tickets section currently renders each ticket as a bordered, rounded,
`--panel-2` card. In a short status summary this gives every row more visual weight than its
content warrants, creates large vertical gaps, and makes the list slower to scan during a spoken
standup.

The target is a calm, information-dense list:

- `Sprint tickets` remains the section heading and the freshness indicator remains available;
- status groups remain in the configured order and retain their configured display names;
- each status heading has a restrained semantic marker and a compact count badge;
- ticket keys align in one stable column, with summaries aligned beside them;
- ticket rows use quiet separators instead of individual card surfaces;
- completed work recedes slightly without becoming hard to read or looking disabled;
- long summaries do not cause horizontal overflow or unbounded row growth;
- Jira-backed keys visibly indicate that they open an external page;
- keyboard focus, hover, loading, stale, unavailable, empty, and narrow-screen states remain
  intentional.

## 2. Verified current behavior and evidence

These facts were verified from the working tree on 2026-08-16. The Standup implementation and
related plans are currently uncommitted user-owned work; preserve and build on them rather than
replacing them.

### 2.1 Rendering seam

- [`RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx) contains the
  local `StandupTickets` component.
- The populated state calls `groupStandupTickets(...)`, renders a heading row with a freshness
  label, then renders status groups and ticket rows.
- A ticket key is an external `<a target="_blank" rel="noreferrer">` when `ticket.url` exists and
  a `<strong>` otherwise. The summary is a separate `<span>`.
- The whole section currently has `aria-live="polite"` and exposes `aria-busy` while a background
  refresh is active.
- Loading, unavailable, stale, empty, and populated states already exist. This visual change must
  retain those contracts.

### 2.2 Presentation seam

- [`standupStatusPresentation.ts`](../packages/frontend/src/lib/standupStatusPresentation.ts)
  performs configured display-name mapping, configured ordering, fallback ordering, and merging
  of source Jira statuses that share a display name.
- Every ticket still carries `statusCategory`, so the view can derive a restrained group tone
  without parsing display labels.
- Jira `statusCategory` values distinguish `new`, `indeterminate`, and `done`, but do not reliably
  distinguish organization-specific states such as “In review” from “In progress.” Visual tone
  must therefore remain category-based and must not infer semantics from friendly display text.

### 2.3 Styling seam and root cause

- The relevant rules are the `.standup-tickets`, `.standup-ticket-heading`,
  `.standup-ticket-groups`, `.standup-ticket-group`, `.standup-ticket-list`, and
  `.standup-ticket` rules near the Standup styles in
  [`styles.css`](../packages/frontend/src/styles.css).
- `.standup-ticket` currently adds a border, 8px radius, `--panel-2` background, and padding to
  every ticket. `.standup-ticket-list` adds a gap between those card surfaces, and status groups
  add another level of gap.
- Ticket rows each create their own `auto minmax(0, 1fr)` grid. Because the key column is computed
  independently for each row, summary starts are not a deliberate shared alignment contract.
- The root cause is a card treatment applied to list data, combined with nested gaps. No backend,
  database, Jira, or refresh change is required.

### 2.4 Existing design-system support

- `styles.css` already defines `--panel`, `--panel-2`, `--border`, `--text`, `--muted`,
  `--accent`, and meaningful status colors.
- The existing `.badge` treatment provides the correct compact neutral count geometry.
- The repository already has a global visible `:focus-visible` outline for buttons, anchors,
  inputs, and focusable elements.
- There is pure Vitest coverage for status grouping in
  [`standupStatusPresentation.test.ts`](../packages/frontend/test/standupStatusPresentation.test.ts),
  but no focused Standup Playwright spec currently exists.

## 3. Decisions, invariants, and assumptions

### 3.1 Use list rows, not ticket cards

Render each status's tickets as a semantic list. A group may retain one quiet boundary, but an
individual ticket does not receive its own filled card, rounded outline, shadow, or status-colored
background. Separate rows with a 1px token-consistent divider and compact vertical padding.

This follows the local UI rule that cards are reserved for independently actionable or richer
units. Only the Jira key is actionable here; the row itself is not.

### 3.2 Keep status communication restrained and semantic

Add a small marker beside each status heading:

- `new`: neutral/muted;
- `indeterminate`: accent;
- `done`: green;
- mixed or unknown: neutral/muted.

If a configured display group combines source statuses, treat it as `done` only when every ticket
in the rendered group has `statusCategory === 'done'`; treat it as `new` only when every ticket is
`new`; otherwise use the active/accent tone. Do not infer state from `displayName` or
`sourceStatus` text.

Done rows may use a modest opacity or muted summary color, but their keys and focus outlines must
remain legible. Do not use strikethrough: completed tickets are relevant standup accomplishments,
not deleted or excluded work.

### 3.3 Reuse the existing badge primitive for counts

Render the count as a visually distinct `.badge`-based element in a flex status-heading row,
rather than appending an unframed number to the heading text. The accessible heading should still
communicate both label and count, for example “In review, 2 tickets”; avoid redundant screen-reader
announcements from decorative count text.

### 3.4 Establish an explicit key column

Use one compact fixed key column at ordinary modal widths so summaries begin on the same vertical
line. Start with a width in the existing compact geometry (approximately 88–96px) and verify it
against representative Jira keys. The exact value is an implementation tuning detail, not a new
global token.

At the existing `max-width: 700px` Standup breakpoint, allow a ticket row to switch to a compact
stack when the fixed column would materially squeeze the summary. Keys must never overlap,
ellipsis themselves into ambiguity, or cause horizontal scrolling.

### 3.5 Bound long summaries without hiding them from assistive technology

Keep the complete summary string in the DOM. Visually clamp populated summaries to two lines and
provide the full value through a native `title` tooltip for pointer users. The narrow layout may
allow natural wrapping if the two-line clamp makes the row harder to understand during testing.
In all cases, `min-width: 0`, overflow-wrap behavior, and responsive inspection must prevent
horizontal overflow.

### 3.6 Make external navigation apparent

Append a small external-link glyph to Jira-backed ticket keys. The glyph is decorative and
`aria-hidden`; the anchor's accessible label must indicate that it opens in a new tab. Tickets
without a URL remain noninteractive strong text and must not show the glyph or receive fake button
semantics.

Retain `target="_blank"` and `rel="noreferrer"`. Do not make the whole row clickable because that
would create a large, unexpected navigation target and complicate summary text selection.

### 3.7 Reduce freshness prominence without adding a clock lifecycle

Keep the exact local refreshed time rather than introducing a minute-by-minute relative-time
timer. A live “2m ago” value would otherwise become stale or require cosmetic interval state
inside an already live region. Render the value as a semantic `<time dateTime={capturedAt}>` with
smaller muted styling and a full date/time tooltip. The visible copy may remain “Updated 8:43 AM.”

This satisfies the hierarchy goal: freshness remains discoverable but no longer competes with the
section title. Loading and unavailable labels retain enough contrast to communicate their state.

### 3.8 Preserve behavior outside this local surface

- Do not change routing, navigation, epic filtering, portfolio scope, or shared-capacity behavior.
- Do not change configured status names or ordering, Jira queries, ticket refresh orchestration,
  standup participant progression, or persistence.
- Do not introduce a shared component unless implementation discovers a second real consumer for
  the same row pattern.
- Reuse repository tokens and the existing compact radius/type scale; do not add one-off colors.

## 4. Exact target structure and behavior

The rendered populated structure should be equivalent to:

```text
Sprint tickets                                      Updated 8:43 AM

● IN PROGRESS                                             [1]
  NF-2733 ↗  Implement 'Use this panel' takeover

● IN REVIEW                                               [2]
  NF-2682 ↗  Prevent duplicate Communicator panels from loading
  -----------------------------------------------------------
  NF-2947 ↗  Test and deploy quick dialer bug

● DONE                                                    [2]
  NF-2521 ↗  Ali - Set up development environment for Genesys
  -----------------------------------------------------------
  NF-2894 ↗  [Rollover - review for design] Do duplicate panel…
```

The ASCII divider illustrates grouping and alignment, not literal characters. Actual separators
use `border-top` or `border-bottom` with `--border`.

Interaction and state contracts:

| State | Required behavior |
| --- | --- |
| Populated | Compact grouped list, aligned keys, semantic markers, badge counts |
| Refreshing with data | Existing tickets remain readable; restrained spinner/status remains |
| Initial loading | Existing explicit loading copy remains; no empty-list flash |
| Stale | Existing stale explanation remains visible and is not mistaken for a normal timestamp |
| Unavailable | Existing terminal error copy remains visible |
| Empty | Existing “No tickets in this sprint” copy remains visible |
| Jira URL present | Key is a keyboard-focusable external link with glyph and accessible new-tab label |
| Jira URL absent | Key is noninteractive text with no glyph |
| Done group | Marker is green; rows recede modestly but remain readable/focusable |
| Narrow viewport | No horizontal overflow; key/summary layout wraps or stacks intentionally |

## 5. Ordered implementation slices

### Slice 1 — Semantic markup and derived group tone

**Primary seam:**

- [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx)

**Work:**

1. Keep `StandupTickets` local unless testability or reuse provides a concrete reason to extract it.
2. Replace the ticket-group/list `div` structure with headings plus `ul`/`li` list semantics;
   reset native list margins and markers in the scoped CSS.
3. Derive each rendered group's category tone from its tickets using the all-done/all-new rule in
   section 3.2. Prefer a small pure helper if it makes the rule independently testable.
4. Split the status heading into label, decorative marker, and `.badge`-based count while keeping
   one coherent accessible heading.
5. Render freshness with `<time dateTime={context.capturedAt}>` and an exact timestamp tooltip.
6. Add an `aria-hidden` external-link glyph only for URL-backed ticket keys and make the link's
   accessible name communicate new-tab behavior.

**Exit condition:** the DOM has meaningful group/list semantics and preserves every populated,
loading, stale, unavailable, empty, linked, and unlinked state without changing data flow.

### Slice 2 — Compact list styling and responsive behavior

**Primary seam:**

- [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css)

**Work:**

1. Remove per-ticket `--panel-2` fills, rounded borders, and inter-card gaps.
2. Add quiet intra-group separators, compact row padding, and approximately 25–30% less vertical
   space across the populated list while retaining clear group boundaries.
3. Introduce an explicit ticket-key column and ensure links, non-link keys, and summaries share the
   same alignment.
4. Add scoped marker tones using existing neutral, accent, and green tokens.
5. Reuse `.badge` geometry for counts; add only the scoped alignment/accessibility adjustments
   that the status heading needs.
6. Add restrained done-row de-emphasis without reducing key contrast or focus visibility below a
   usable level.
7. Add two-line summary clamping, full-value tooltip support, `min-width: 0`, and safe word wrapping.
8. Reduce freshness size/contrast relative to the section heading.
9. Extend the existing Standup narrow-screen media query so rows stack or reflow cleanly at and
   below 700px.
10. Define intentional hover and `:focus-visible` behavior for ticket links without overriding the
    repository's global focus outline.

**Exit condition:** the populated list reads as one compact status summary, not a stack of cards,
and produces no horizontal overflow at desktop or narrow widths.

### Slice 3 — Focused regression coverage

**Primary seams:**

- [`packages/frontend/test/standupStatusPresentation.test.ts`](../packages/frontend/test/standupStatusPresentation.test.ts)
- a new focused Playwright spec such as
  `packages/frontend/e2e/standup-tickets.spec.ts`

**Work:**

1. If group-tone derivation is placed in a pure helper, cover all-done, all-new, active, mixed,
   and unknown inputs with Vitest. Do not move presentational DOM into a utility merely to increase
   unit-test count.
2. Add a deterministic Standup browser harness using route interception, following the repository's
   existing Playwright pattern. Mock the dataset/health state, standup-start response, saved ticket
   snapshot, and targeted refresh response; do not require Jira or a local database.
3. Cover multiple status groups, multiple tickets in one group, a long summary, a done group, one
   ticket without a URL, and a known `capturedAt` value.
4. Assert semantic group/list structure, badge counts, external-link target/label, absence of a link
   for URL-less tickets, and no horizontal overflow.
5. Exercise keyboard focus on a Jira key and verify the focus indicator is visible.
6. Run the same populated harness at desktop and approximately 390px wide. Capture diagnostic
   screenshots in Playwright output when useful; do not add brittle pixel snapshots unless the
   repository adopts them deliberately for this surface.
7. Retain or add state assertions for loading, stale, unavailable, and empty output if the harness
   can cover them without coupling to internal component implementation.

**Exit condition:** automated coverage detects lost semantics, external-link regressions, and
desktop/mobile overflow; manual visual review remains the authority for hierarchy and rhythm.

## 6. Cross-cutting considerations

### Accessibility

- Preserve heading order beneath the participant heading.
- Use native lists and anchors; do not add click handlers to noninteractive rows.
- Treat marker and external-link glyphs as decorative; communicate state/navigation in text or
  accessible labels.
- Ensure muted done rows and freshness text retain readable contrast.
- Preserve visible keyboard focus and verify it against both normal and done-row treatments.
- Keep full summary text available to assistive technology even when visually clamped.
- Avoid duplicate or noisy announcements from the existing live region. If markup changes expose
  repeated announcements during refresh, narrow the live status to the loading/stale message
  rather than removing status feedback entirely.

### Failure and concurrency

This work does not change request ownership, deduplication, retry, snapshot ordering, or response
publication. Preserve `aria-busy` and all current terminal states. Do not add a relative-time
interval or other cosmetic effect that introduces cleanup/concurrency concerns.

### Migration and compatibility

No API, shared-domain, setting, database, or data migration is expected. Existing ticket snapshots,
including older snapshots without URLs or status IDs, must continue to render. If implementation
appears to require a backend contract change, stop and record why in this plan before expanding
scope.

### Security and privacy

Retain safe external-link attributes. Do not add logging, analytics, screenshots, or fixture data
containing real ticket summaries, Jira URLs, people, or account identifiers. E2E fixtures must be
synthetic.

### Observability

No new runtime telemetry is needed for a local visual refinement. Existing refresh/loading/error
signals remain the operational feedback. Test failures should retain Playwright traces/screenshots
under the normal test-results path.

## 7. Verification

Before every Node-based command, select the repository's declared Node version from the repository
root:

```bash
nvm use
```

Automated verification, narrowed first:

```bash
npm --workspace @ecp/frontend run typecheck
npm --workspace @ecp/frontend run test -- --run test/standupStatusPresentation.test.ts
npm --workspace @ecp/frontend run e2e -- standup-tickets.spec.ts
git diff --check
```

If the focused checks pass, run the full frontend unit suite. Run broader repository tests only if
implementation crosses a shared seam or uncovers a regression outside the frontend surface.

Manual visual validation:

1. Open Standup with a participant who has the representative populated ticket mix: one active
   group, one multi-ticket review group, one done group, a long summary, and both linked and
   unlinked keys.
2. At a desktop viewport, confirm the section reads as a compact list, summaries align, count
   badges are secondary, and the timestamp does not compete with `Sprint tickets`.
3. Compare total list height with the pre-change screenshot and confirm spacing is visibly reduced
   without status groups running together.
4. Confirm active/new/done markers use restrained category semantics and done rows remain legible.
5. Hover and keyboard-focus each linked key; verify underline/focus treatment and the external-link
   affordance. Confirm unlinked keys do not look interactive.
6. Verify the full long summary remains available through screen-reader text and pointer tooltip.
7. Repeat at approximately 700px and 390px; verify deliberate wrapping/stacking, no clipped keys,
   and `document.documentElement.scrollWidth <= window.innerWidth`.
8. Exercise initial loading, background refresh with saved data, stale, unavailable, and empty
   states; confirm controls and ticket status remain understandable.
9. Advance to the next participant and confirm the refreshed list changes without layout jumps or
   regressions in Standup progression.

## 8. Acceptance criteria

- Ticket rows no longer appear as individual filled, rounded cards.
- Populated-list vertical space is reduced by approximately 25–30% while group boundaries remain
  obvious.
- Status headings include a restrained semantic marker and a compact, accessible count badge.
- Summary text begins at a consistent position at ordinary modal widths.
- Done groups are visually quieter but remain readable and keyboard accessible; they are not struck
  through.
- Freshness remains visible as semantic exact time but is clearly subordinate to the section title.
- Long summaries use a deliberate two-line/wrapping policy, expose their full text, and never cause
  horizontal overflow.
- Jira-backed keys show an external-link affordance, announce new-tab behavior, and retain safe
  `target`/`rel` attributes; URL-less tickets remain noninteractive.
- Loading, refreshing, stale, unavailable, empty, configured-order, and friendly-name behavior are
  unchanged.
- Desktop and narrow-screen automated checks pass, visible keyboard focus is preserved, and manual
  visual inspection confirms the compact hierarchy.
- No backend, Jira, database, routing, navigation, or product-scope behavior changes are included.

## 9. Continuation instructions

**Current status:** semantic list markup, category-based group tones, compact responsive styling,
and focused unit/browser coverage have been implemented. Validation results are recorded after the
commands in section 7 complete.

**Validation completed (2026-08-16):**

- `npm --workspace @ecp/frontend run typecheck` — passed
- `npm --workspace @ecp/frontend run test -- --run test/standupStatusPresentation.test.ts` — passed (5 tests)
- `PW_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm --workspace @ecp/frontend run e2e -- standup-tickets.spec.ts` — passed (desktop and 390px harness)
- `npm --workspace @ecp/frontend run test -- --run` — passed (74 tests)
- `git diff --check` — passed

**Next action:** implement Slice 1 in the existing `StandupTickets` component while preserving the
uncommitted Standup work already present in the working tree. Then implement the scoped CSS before
adding the Playwright harness.

**First files to inspect after context reset:**

1. [`docs/standup-ticket-list-visual-refinement-plan.md`](./standup-ticket-list-visual-refinement-plan.md)
2. [`packages/frontend/src/components/RunStandupPage.tsx`](../packages/frontend/src/components/RunStandupPage.tsx)
3. [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css), especially the
   `.standup-ticket*` rules
4. [`packages/frontend/src/lib/standupStatusPresentation.ts`](../packages/frontend/src/lib/standupStatusPresentation.ts)
5. [`packages/frontend/test/standupStatusPresentation.test.ts`](../packages/frontend/test/standupStatusPresentation.test.ts)
6. Existing Playwright route-mocking conventions in
   [`packages/frontend/e2e/portfolio.visual.spec.ts`](../packages/frontend/e2e/portfolio.visual.spec.ts)

**Initial discovery commands:**

```bash
git status --short
rg -n "StandupTickets|standup-ticket" packages/frontend/src packages/frontend/test packages/frontend/e2e
```

Update this artifact as slices complete. Mark each slice's status, record exact successful
validation commands, and document any material design or scope decision here rather than relying
on conversation history.
