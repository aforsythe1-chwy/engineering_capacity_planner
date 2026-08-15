# Portfolio Page UX and Epic Selection — Durable Implementation Plan

**Status:** Proposed  
**Last updated:** 2026-08-14  
**Scope:** portfolio overview, shared application chrome, single-epic selection, and a multi-select-ready navigation contract

## 1. Problem

The portfolio page is functionally present but visually and structurally unfinished:

- `PortfolioOverview` emits `portfolio-grid`, `portfolio-card`, `portfolio-health`, and
  `portfolio-load`, but the stylesheet contains no rules for those classes.
- The whole card is a `<button>` while the Jira key inside it is also an interactive link. Nested
  interactive controls are invalid and produce unreliable pointer and keyboard behavior.
- Health, planning completeness, target dates, point totals, and capacity are rendered as an
  unstructured stream of text, so the eye has no reliable scan path.
- Weekly capacity is a prose list with raw ISO dates rather than a chart or compact load table.
- Portfolio and epic pages duplicate their headers and source-state treatments.
- Opening an epic assigns `window.location.href`, causing a full reload instead of updating durable
  application navigation state.
- The current route accepts only one `epic` query parameter, and epic selection is not consistently
  available from portfolio and drill-down pages.
- The generic setup `Typeahead` is asynchronous and mouse-oriented. It is not the right long-term
  primitive for a local, keyboard-first fuzzy epic finder or future multiple selection.

This should be treated as an information-architecture and interaction pass, not a collection of
isolated CSS tweaks.

## 2. Product outcome

The portfolio page should answer, in this order:

1. Is the portfolio healthy and is the team overcommitted?
2. Which epics need attention first, and why?
3. What planning input is missing?
4. Where does shared capacity become tight or overloaded?
5. How do I open or switch to an epic without losing my place?

Every page that presents epic-specific information should expose one consistent fuzzy epic picker.
The first release selects one epic at a time. Its state and component API must use arrays of epic
keys so a later compare view can select two or more without replacing the navigation model.

## 3. Design principles

- **Exception first:** red, yellow, and incomplete work appear before green work.
- **Structured density:** prefer aligned metrics and compact rows over paragraph-shaped cards.
- **One global selector:** epic navigation belongs to application chrome, not individual tabs.
- **Health is more than color:** always pair color with a label, reason, and icon or marker.
- **Facts versus forecast:** clearly distinguish Jira counts from projected dates and buffers.
- **Progressive disclosure:** summary first; ticket-level detail stays in epic drill-downs.
- **Keyboard complete:** selection, card navigation, and menus work without a pointer.
- **Future comparison without premature UI:** adopt plural selection state now; defer compare
  visualization until its product rules are defined.

## 4. Target information architecture

### 4.1 Shared application shell

Introduce an `AppShell` used by portfolio, epic drill-down, configuration, loading, and empty states.
It owns:

- product title and primary Portfolio navigation;
- an `EpicPicker` whenever the dataset contains active epics;
- current view/tab navigation;
- sync control and a compact source/freshness badge;
- a consistent content width and responsive page gutters.

The epic picker label changes with context:

- Portfolio: **Jump to epic**;
- Epic drill-down: current epic key and title;
- future comparison: selected epic chips plus **Add epic**.

### 4.2 Portfolio overview

Use four visual regions:

1. **Page introduction** — “Portfolio”, board/team name, active-epic count, and a one-line shared
   capacity explanation.
2. **Portfolio summary strip** — health counts, remaining estimated points, unestimated item count,
   and peak utilization/overloaded-period count.
3. **Epic health list** — risk-ordered rows or cards with aligned fields.
4. **Shared capacity section** — a compact weekly utilization chart/table with overload and slack.

The page should use a wider content frame than the current 1080px maximum where screen space permits
(target 1240–1360px), while retaining readable line lengths within cards.

### 4.3 Epic health row/card anatomy

Each epic entry contains:

- health marker and accessible health label;
- epic key and title, with a separate external-Jira action;
- gating milestone/date or a prominent “Needs target” prompt;
- projected completion and buffer, when trustworthy;
- remaining estimated points and unestimated-item count;
- placed/unplanned breakdown shown as a small progress bar;
- assigned-engineer/avatar summary when available;
- short reason text limited to two lines;
- a single internal “Open epic” link target.

Do not make an element containing other links into a `<button>`. Use an `<article>` with a stretched
internal route link, or make only the explicit “Open epic” affordance interactive.

At desktop widths, use a compact two-column card grid only if each field remains aligned. Prefer a
single-column health table/list when the portfolio contains many epics. At mobile widths, entries
stack and secondary metrics collapse behind a details affordance.

### 4.4 Shared capacity visualization

Replace prose rows such as `2026-08-01 — 12 / 20 pts` with a semantic utilization view:

- one column per real sprint week;
- capacity as the full track;
- planned load as a filled bar;
- explicit numeric `load / capacity` and slack/overload;
- yellow at the configured warning threshold and red above capacity;
- hover/focus detail listing contributing epics;
- a readable table fallback for assistive technology and narrow screens.

The engine must return actual week start/end values. Do not derive display weeks by bucketing days
into the 1st/8th/15th/22nd of a month. The capacity view model should also expose peak utilization
and overloaded-week count so the summary strip and chart use the same calculation.

## 5. Epic picker and fuzzy search

### 5.1 Component contract

Create a portfolio-specific component rather than extending the setup wizard's async `Typeahead`:

```ts
interface EpicPickerProps {
  epics: EpicPickerOption[];
  selectedKeys: string[];
  selectionMode: 'single' | 'multiple';
  onSelectionChange: (keys: string[]) => void;
  placeholder?: string;
}
```

`selectedKeys` is plural from day one. In the initial single mode, choosing an epic replaces the
one selected key and navigates to its drill-down. Multiple mode later toggles keys and retains the
menu for additional selection.

### 5.2 Search behavior

Search the already-loaded active epic collection locally; switching epics must not require a Jira
request. Rank matches using a pure, tested scorer:

1. exact key;
2. key prefix;
3. title word prefix;
4. ordered token/subsequence match;
5. title substring;
6. stable health/order tie-breaker.

Normalize case, whitespace, punctuation, and hyphen differences. Match both `NF-123` and `nf123`.
Show health, key, title, target date, and remaining points in each result so similarly named epics
can be distinguished.

### 5.3 Interaction and accessibility

Implement the WAI-ARIA combobox/listbox interaction model:

- `ArrowUp`/`ArrowDown` moves the active option;
- `Enter` selects;
- `Escape` closes and returns focus;
- typing opens and filters immediately;
- the active option is exposed through `aria-activedescendant`;
- selected options use `aria-selected`;
- empty, no-match, and archived-only states are announced;
- focus is restored predictably after route changes.

The external Jira link must remain a separate action from internal epic selection.

## 6. Durable navigation state

Add a small query-string router hook that listens for `popstate` and updates history without a full
reload. Canonical URLs:

```text
/?view=portfolio
/?view=epic&epics=NF-123&tab=timeline
/?view=epic&epics=NF-123&tab=dependencies
/?view=compare&epics=NF-123,NF-456        # reserved for the future compare view
```

Rules:

- Read the legacy singular `epic=NF-123` parameter and canonicalize it to `epics=NF-123`.
- Validate every selected key against active/visible dataset epics.
- Preserve the selected epic when switching drill-down tabs.
- Preserve tab state in the URL so reload/back/forward work.
- If an epic becomes archived, keep a clear archived state or return to Portfolio with an
  explanation; never silently substitute `epics[0]`.
- Unknown views, tabs, or keys fall back deterministically to Portfolio.

## 7. View-model boundaries

Keep rendering components free of portfolio scheduling logic. Add pure frontend selectors:

```text
buildPortfolioOverview(dataset, projection)
  -> summary metrics
  -> ordered epic rows
  -> capacity week rows
  -> picker options
```

The view model should preformat neither colors nor JSX. It returns semantic values such as health,
dates, load, capacity, and diagnostics. Components decide presentation; shared formatting helpers
render dates and point values consistently.

Before polishing the capacity chart, complete these projection outputs:

- actual week start/end boundaries;
- per-week epic contributions;
- per-member load when available;
- epic gating date and milestone name;
- assigned-member IDs;
- deterministic reason codes alongside human-readable messages.

Reason codes avoid UI logic based on parsing sentence text.

## 8. Screenshot and visual QA workflow

The repository already has Playwright and a Vite-managed test server. Add a deterministic visual
harness rather than relying on a developer's live SQLite/Jira state.

### 8.1 Fixtures

Create a multi-epic visual fixture containing at least:

- one red, one yellow, and one green epic;
- one epic missing a target;
- one epic with unestimated work;
- one epic with substantial unplanned work;
- an overloaded week and a week with visible slack;
- long epic titles and enough epics to exercise wrapping/scrolling.

Use Playwright request interception for `/api/dataset` and `/health`, or a dedicated deterministic
fixture loader. Do not make screenshot output depend on live Jira, today's database, or network.
Pin the planning date and locale/timezone.

### 8.2 Capture cases

Add `e2e/portfolio.visual.spec.ts` with these captures:

1. portfolio default — 1440×1000;
2. portfolio dense state — 1024×900;
3. portfolio mobile — 390×844;
4. epic picker open with a fuzzy query;
5. epic drill-down showing the picker with a current selection;
6. empty/no-match and incomplete-planning states.

Initial iteration screenshots go to `test-results/portfolio-screenshots/` and remain uncommitted.
Once the design is approved, promote stable cases to `expect(page).toHaveScreenshot()` baselines.

Add scripts:

```json
"e2e:portfolio": "playwright test e2e/portfolio.visual.spec.ts",
"screenshots:portfolio": "playwright test e2e/portfolio.visual.spec.ts --update-snapshots"
```

The contributor loop is:

```text
nvm use
run deterministic visual spec
inspect desktop/tablet/mobile screenshots
adjust layout and interaction
rerun screenshots
run unit, accessibility, and full e2e tests
```

### 8.3 Visual acceptance checks

- no horizontal page scroll at the three target widths;
- no clipped dropdowns, metrics, health labels, or long titles;
- no layout shift when the picker opens;
- color contrast meets WCAG AA for body text and controls;
- all information conveyed by color also has text;
- focus rings are visible in screenshots and keyboard runs;
- external Jira links and internal navigation have distinct affordances;
- loading, empty, error, and incomplete states are deliberately styled.

## 9. Delivery slices

### Slice 1 — Visual harness and semantic view model

- Add the deterministic multi-epic fixture and screenshot spec.
- Capture the current page at desktop, tablet, and mobile widths.
- Add portfolio selectors and correct real week boundaries.
- Record the initial screenshots as review artifacts, not permanent baselines.

**Exit:** current visual defects are reproducible and portfolio display data comes from tested pure
selectors.

### Slice 2 — App shell, routing, and epic picker

- Introduce `AppShell` and consolidate duplicated headers/source state.
- Add the plural-key query router with legacy URL compatibility.
- Build the keyboard-accessible fuzzy `EpicPicker` in single-selection mode.
- Display it on Portfolio and every epic drill-down page.
- Replace full-page navigation with history updates.

**Exit:** a user can fuzzy-find and switch epics from any relevant page; reload/back/forward retain
the correct epic and tab.

### Slice 3 — Portfolio visual redesign

- Add the page introduction and summary strip.
- Replace unstyled button cards with accessible, risk-ordered epic entries.
- Add consistent health, target, completion, buffer, planning, and ownership fields.
- Add responsive desktop/tablet/mobile styling and deliberate empty/error states.

**Exit:** the portfolio is scannable, accessible, and visually coherent at all target widths.

### Slice 4 — Shared capacity visualization

- Replace prose weekly load with semantic utilization bars/table.
- Show warning/overload thresholds and per-epic contributions.
- Connect chart focus/click actions to filtered portfolio or epic details.

**Exit:** users can see when shared capacity becomes constrained and which epics contribute.

### Slice 5 — Visual regression and hardening

- Review screenshot artifacts and resolve overflow, hierarchy, and contrast issues.
- Promote approved screenshots to Playwright baselines.
- Add keyboard, URL restoration, and selection tests.
- Run the complete unit/type/build/e2e suite under the `.nvmrc` Node version.

**Exit:** the approved portfolio layout and selector behavior are protected against regression.

### Future slice — Multi-epic comparison

- Enable `selectionMode="multiple"` and selected-epic chips.
- Add `view=compare` for two or more validated keys.
- Define whether comparison means overlay, combined filtering, or what-if scheduling before adding
  visualizations.
- Reuse the same shared-capacity projection; comparison must never give each selected epic a fresh
  capacity pool.
- Set a practical initial selection cap and explain when cross-epic dependencies affect results.

The future slice changes presentation and selection behavior, not URL shape or core picker state.

## 10. Test strategy

### Unit

- fuzzy scoring, normalization, and deterministic ordering;
- plural query parsing/serialization and legacy singular migration;
- invalid/archived selection handling;
- portfolio ordering and summary calculations;
- exact week boundaries and utilization thresholds.

### Component/integration

- keyboard combobox behavior and focus restoration;
- choosing an epic updates URL and content without reload;
- picker appears on Portfolio and every epic drill-down tab;
- cards contain no nested interactive controls;
- health and incomplete states have accessible labels;
- long names and no-match states render correctly.

### End-to-end

- Portfolio → fuzzy-select epic → change tab → back → Portfolio;
- direct-load a canonical epic URL;
- direct-load and canonicalize a legacy `epic=` URL;
- reload preserves epic and tab;
- screenshots at desktop, tablet, and mobile widths;
- future: select two epics and restore the comparison URL.

## 11. Acceptance criteria

- The portfolio page has an intentional visual hierarchy and no unstyled portfolio primitives.
- Red/yellow/incomplete epics and the reason for their state are identifiable in one scan.
- Shared load and capacity are visually comparable by real week.
- Users can fuzzy-find and open an active epic from Portfolio or any epic drill-down page.
- Epic switching is keyboard accessible and does not reload the application.
- Selection and tab state survive reload/back/forward through canonical URLs.
- The selection contract stores `string[]` even while the UI permits one selection.
- Jira links remain separate from internal navigation controls.
- Deterministic Playwright screenshots cover desktop, tablet, mobile, picker-open, and incomplete
  states.
- Approved screenshots, unit tests, typecheck, build, and end-to-end tests pass under `nvm use`.

## 12. Decisions deferred deliberately

1. Whether the future multi-epic view is a side-by-side comparison, a shared filtered schedule, or
   an editable what-if scenario.
2. The maximum number of simultaneously selected epics.
3. Whether archived epics appear in the picker behind an explicit filter.
4. Whether capacity contribution drill-down opens inline or routes to the Gantt view.

These choices do not block the redesign because the plural URL state, picker contract, and shared
projection boundary support them without another navigation migration.
