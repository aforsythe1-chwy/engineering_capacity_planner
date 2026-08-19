# Global Important Dates Plan

**Status:** Core feature implemented; reusable fuzzy icon finder expansion planned
**Date:** 2026-08-18
**Scope:** Add locally managed, portfolio-global important dates with a per-date icon choice,
optional link and notes, render them in the existing portfolio Calendar, and replace the initial
seven-option icon menu with a reusable fuzzy-search icon picker and an expanded safe catalog.
**Intended outcome:** A planner owner can create, edit, and remove dates such as company events,
release freezes, launches, or planning deadlines, choose a recognizable icon for each one, and see
those dates on the Calendar regardless of the current epic filter. Icon selection remains quick and
keyboard-accessible as the built-in catalog grows, and future planner forms can reuse the same
searchable picker without copying listbox behavior.

## 1. Request and product intent

The planner currently shows epic relevant days, projected completion dates, and shared load on its
Calendar. It has no way to represent a date that matters to the whole portfolio rather than one
epic. Add that missing global concept without attaching it to a synthetic epic or changing capacity
calculations.

The feature must answer two needs:

1. A planner owner can maintain portfolio-wide dates in Configuration.
2. Everyone viewing Calendar can recognize each date by its chosen icon and full text label.

“Custom icon” in this first release means choosing a different icon for each date from a curated,
built-in palette. Arbitrary SVG markup, image uploads, remote image URLs, and unconstrained emoji
are explicit non-goals. Stable icon keys keep stored data portable, avoid unsafe content, and allow
the renderer to remain visually consistent with the planner.

## 2. Verified current state and evidence

The following facts were verified in the live worktree on 2026-08-18:

- [`packages/shared/src/domain.ts`](../packages/shared/src/domain.ts) defines `DomainDataset` as the
  application snapshot contract. It currently has epic-scoped `milestones: EpicMilestone[]` but no
  portfolio-global date collection.
- `EpicMilestone` requires `epicKey` and `isGating`. Reusing it for a global date would create a
  false epic relationship and incorrectly inherit the exactly-one-gate-per-epic invariant.
- [`packages/backend/src/db/schema.ts`](../packages/backend/src/db/schema.ts) persists milestones in
  `epic_milestone`. `INSERT_ORDER` and `DELETE_ORDER` define dataset replacement order.
- [`packages/backend/src/db/database.ts`](../packages/backend/src/db/database.ts) runs
  `CREATE TABLE IF NOT EXISTS` before additive column migrations, so a new standalone table is
  created safely when an existing database opens; no destructive migration is necessary.
- [`packages/backend/src/db/persist.ts`](../packages/backend/src/db/persist.ts) owns complete
  `DomainDataset` write/read round trips. Database export/import also depends on this contract, so
  the new collection must be handled there rather than through an isolated side table.
- [`packages/backend/src/db/reconcile.ts`](../packages/backend/src/db/reconcile.ts) explicitly
  separates Jira facts from locally owned intent. It preserves milestones, settings, estimates,
  SMEs, availability, and placements during sync. Global important dates must join that local-intent
  set or a Jira sync would erase them.
- [`packages/backend/src/db/repository.ts`](../packages/backend/src/db/repository.ts) provides
  validated mutation functions, and
  [`packages/backend/src/routes/config.ts`](../packages/backend/src/routes/config.ts) exposes the
  Configuration write API. Existing milestone CRUD is a useful structural precedent, but its
  gating behavior must not be copied.
- [`packages/frontend/src/components/Configuration.tsx`](../packages/frontend/src/components/Configuration.tsx)
  composes top-level Configuration panels and already centralizes mutation busy/error/reload
  behavior. Global important dates belong here as their own panel, not inside an epic editor.
- [`packages/frontend/src/lib/portfolioCalendar.ts`](../packages/frontend/src/lib/portfolioCalendar.ts)
  builds exact-day calendar events from epic milestones and projections. Its current event kinds
  are `gating`, `milestone`, and `dev-complete`; selected epic keys filter all existing exact-day
  events.
- [`packages/frontend/src/components/PortfolioMonthCalendar.tsx`](../packages/frontend/src/components/PortfolioMonthCalendar.tsx)
  renders the month, layers, event density disclosure, event labels, and legend. It currently has
  no icon renderer and no global-date layer.
- [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css) contains the existing
  compact dark calendar and Configuration visual language. The frontend has no icon-library
  dependency; the repository uses small inline SVG components for its existing icons.
- [`docs/portfolio-calendar-page-plan.md`](portfolio-calendar-page-plan.md) is the implemented source
  of truth for the Calendar page itself. This plan extends that page but remains separate because it
  adds a new persisted domain entity and mutation workflow.
- [`docs/planner-product-constitution.md`](planner-product-constitution.md) requires one-level
  navigation, useful all-active views, epic selection as a filter, and shared-capacity truth.
  Global important dates are team/portfolio-owned context: an epic filter must not hide them or
  change them.
- The worktree contains extensive pre-existing modified and untracked files, including most seams
  named above. These changes belong to the user. Implementation must inspect the live diff before
  every overlapping edit and preserve unrelated work.

## 3. Decisions, invariants, and assumptions

### 3.1 Domain boundary

- Introduce a first-class `GlobalImportantDate` rather than overloading `EpicMilestone` or a JSON
  setting.
- Store dates as ISO `YYYY-MM-DD` calendar dates, consistent with the rest of the domain. A date is
  a single day in v1; ranges, times, and time zones are not part of the contract.
- The entity is locally authored and portfolio-global. It has no `epicKey`, `teamId`, gating flag,
  capacity effect, Jira mapping, or delivery-health meaning.
- Add `importantDates?: GlobalImportantDate[]` to `DomainDataset` initially. Optionality keeps older
  JSON fixtures and snapshots readable; all consumers normalize absence to `[]`. A later cleanup
  may make it required after every fixture/export format has migrated.
- Stable sorting is `date`, then case-insensitive name, then `id`.

Proposed shared contract:

```ts
export const IMPORTANT_DATE_ICON_KEYS = [
  'calendar',
  'star',
  'flag',
  'rocket',
  'megaphone',
  'shield',
  'users',
] as const;

export type ImportantDateIconKey = typeof IMPORTANT_DATE_ICON_KEYS[number];

export interface GlobalImportantDate {
  id: string;
  name: string;
  date: IsoDate;
  iconKey: ImportantDateIconKey;
}
```

The exact palette may be refined during visual implementation, but persisted keys must be semantic,
documented, allowlisted by the backend, and rendered from one exhaustive frontend registry. Use
`calendar` as the create-form default and as the defensive read fallback for unknown historical
keys. Do not silently accept an unknown key on create/update.

### 3.2 Visibility and filtering

- Global important dates appear on Calendar in all-active mode and when any epic filter is active.
- Epic filters continue to narrow epic milestones, projected completions, and Delivery outlook; they
  do not narrow global important dates.
- Global important dates do not alter portfolio projection inputs, load bands, target dates, health,
  or delivery verdicts.
- Add an **Important dates** Calendar layer, enabled by default and independent of **Relevant days**.
  Turning that layer off is local display state only; it does not modify saved dates.
- If a global date shares a day with epic events, it participates in the same deterministic density
  limit and `+N more` disclosure. Important dates sort before epic gating/milestone/completion events
  so portfolio context remains easy to find.

### 3.3 Management surface

- Add a top-level **Important dates** panel in Configuration, positioned after epic management and
  before lower-level planning knobs. It remains visible when no team is selected because the data is
  global.
- The add form contains Name, Date, Icon, and one primary **Add date** action.
- Existing entries are displayed in chronological order with icon preview, editable Name/Date/Icon,
  explicit Save, and Remove actions. Use the Configuration page's existing mutation runner so edits
  disable conflicting actions, reload the dataset after success, and surface API errors.
- Use a compact in-app icon picker/listbox rather than a native select because the choices are
  graphical and need consistent dark styling. It must support arrow-key navigation, Enter/Space
  selection, Escape, click-outside dismissal, focus return, and visible text names in addition to
  icons.
- Removal is immediate in v1, matching non-gating milestone CRUD. If implementation shows accidental
  removal is likely during visual QA, add an inline confirmation state rather than a blocking browser
  dialog.

### 3.4 Icon rendering and accessibility

- Implement icons as trusted inline SVG selected by a stable key. Keep the SVG decorative
  (`aria-hidden="true"`, `focusable="false"`) wherever the adjacent date name is the accessible
  label.
- The picker option exposes a readable icon name such as “Rocket”; selection and focus are never
  communicated by icon shape or color alone.
- Calendar event accessible names include the date name and the phrase “Global important date.” The
  chosen icon must not replace the text label in the DOM.
- Reuse the existing compact radius, border, type scale, focus-visible outline, `--panel`,
  `--panel-2`, `--border`, `--text`, `--muted`, and `--accent` tokens. Do not give each icon a
  decorative status color; important dates use one restrained semantic treatment.

## 4. Persistence, API, and state contracts

### 4.1 SQLite and dataset round trip

Add a standalone table:

```sql
CREATE TABLE IF NOT EXISTS global_important_date (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  date     TEXT NOT NULL,
  icon_key TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_global_important_date_date
  ON global_important_date(date, id);
```

- Add the table to schema insert/delete ordering at a position with no foreign-key dependencies.
- Extend `replaceDatasetRows` and `readDataset` to round-trip the collection and normalize a missing
  input collection to `[]`.
- Opening an existing SQLite database creates the new empty table through the existing idempotent
  schema path. Do not rebuild or drop tables.
- Database snapshot export/import must preserve important dates automatically through the extended
  `DomainDataset` contract; verify this explicitly in persistence/server tests.
- During Jira reconcile, preserve `current.importantDates ?? []` exactly. Incoming Jira datasets do
  not own or replace this collection.

### 4.2 Validation and mutations

Add repository functions parallel to other local configuration entities:

```ts
createImportantDate(db, { name, date, iconKey }): GlobalImportantDate
updateImportantDate(db, id, { name?, date?, iconKey? }): GlobalImportantDate
deleteImportantDate(db, id): void
```

Validation contract:

- `name` is trimmed, non-empty, and subject to the repository's normal bounded string policy; add a
  reasonable explicit maximum if the shared helper has none.
- `date` must be a real ISO calendar date through the existing `assertIsoDate` helper.
- `iconKey` must be a member of `IMPORTANT_DATE_ICON_KEYS`.
- Update rejects an empty patch and unknown fields rather than silently succeeding.
- Unknown IDs return 404. Invalid input returns 400. Delete returns 204.
- Generated IDs use the existing local `newId` convention with a distinct prefix such as `date`.

Expose the endpoints through the Configuration route surface:

```text
POST   /api/important-dates
PUT    /api/important-dates/:id
DELETE /api/important-dates/:id
```

The normal `GET /api/dataset` response remains the read contract; do not add a redundant read
endpoint. Frontend API functions use `GlobalImportantDate` types from `@ecp/shared`.

### 4.3 Mutation and concurrency behavior

- Follow current Configuration semantics: one in-flight mutation per panel/page, then reload the
  authoritative dataset after success.
- Creation uses unique IDs, so simultaneous creates do not overwrite each other.
- V1 updates are last-write-wins, consistent with the existing Configuration API. Document this in
  code/tests; do not introduce revision columns only for this entity.
- A failed mutation leaves the last loaded row visible and exposes the server error. Forms must not
  reset until the mutation succeeds.
- Calendar state is derived from the reloaded dataset, so a successful mutation appears without a
  full browser refresh and does not require duplicating optimistic state.

## 5. Calendar model and presentation contract

Extend `PortfolioCalendarEventKind` with `important-date` and add an optional `iconKey` that is
present only for that kind:

```ts
type PortfolioCalendarEvent =
  | {
      id: string;
      date: IsoDate;
      label: string;
      kind: 'important-date';
      iconKey: ImportantDateIconKey;
      epicKey: null;
    }
  | {
      id: string;
      date: IsoDate;
      label: string;
      kind: 'gating' | 'milestone' | 'dev-complete';
      epicKey: string;
      health?: PortfolioHealth;
    };
```

A discriminated union is preferred over making every field loosely optional because it prevents a
global date from accidentally entering selected-epic contribution logic.

`buildPortfolioCalendarModel` must:

1. Add every `dataset.importantDates ?? []` entry independently of `selectedKeys` and epic planning
   kind.
2. Preserve current filtering for epic-scoped events and preserve unfiltered shared-capacity weeks.
3. Create stable event IDs such as `important-date:<id>`.
4. Sort same-day events by important date, gating, projected completion, ordinary milestone, then
   stable identity.
5. Keep `hasVisibleDatedEvents` true when global dates are the only exact-day events.

`PortfolioMonthCalendar` must:

- add the default-on Important dates layer;
- render the chosen SVG icon before the visible label without reducing the label's available
  accessible text;
- use a distinct `important-date` class/data kind and a text-bearing legend item;
- include global dates in dense-day disclosure, keyboard behavior, titles, and full accessible
  labels;
- retain current previous/today/next navigation, seven-day grid, scroll containment, load bands,
  and epic-event behavior.

## 6. Explicit non-goals

- No new primary page, nested navigation, route, or drill-down mode.
- No arbitrary file upload, remote icon URL, user-authored SVG/HTML, icon color customization, or
  external icon service.
- No recurring rules, date ranges, time-of-day, timezone conversion, reminders, notifications, or
  calendar subscription/export in v1.
- No association to an epic, team, member, sprint, Jira issue, or external calendar.
- No effect on capacity, shared load, projection dates, health, or delivery verdicts.
- No bulk import/reordering UI. Chronological order is derived.
- No icon support added to epic relevant days in this slice; custom icons apply to the new global
  important-date entity only.

## 7. Failure, migration, security, accessibility, and observability

### Failure and empty states

- With no important dates, Configuration shows concise empty guidance plus the add form; Calendar
  simply has no events of this kind.
- A date outside the displayed month remains reachable through normal month navigation.
- Unknown persisted icon keys from a future/newer database render with `calendar` as a defensive UI
  fallback, while new mutations still reject unknown keys.
- Read-only bundled-data mode shows the panel and any fixture dates but disables add/edit/remove
  controls consistently with other Configuration panels.
- A backend error remains visible through the existing Configuration error surface and preserves
  unsaved form values.

### Migration and data durability

- Existing databases receive an empty `global_important_date` table without data loss.
- Full dataset writes, database export/import, seed/fixture loading, and Jira reconcile retain the
  new collection.
- Older JSON without `importantDates` loads as an empty collection. New exports include the field.
- Add regression coverage specifically proving a Jira sync does not delete global important dates.

### Security

- Store and accept only icon keys from the shared allowlist. Never store or render supplied markup,
  class names, file paths, or URLs.
- Render names as normal React text, not HTML. Normal JSON request size and local API trust boundaries
  remain unchanged.
- The feature introduces no credentials, external network requests, or new CORS methods.

### Accessibility

- Every input has a persistent text label; errors are associated with the relevant field or exposed
  through the page status/error region.
- The icon picker follows listbox semantics and complete keyboard/focus behavior.
- SVGs are decorative where adjacent readable text supplies meaning. Calendar and picker labels do
  not rely on color or shape alone.
- Event text remains visible and available in tooltips/accessibility names when visually truncated.
- Add/edit/remove controls have unambiguous names when multiple rows exist.

### Observability

- No production telemetry is needed for this local feature.
- Add stable test identifiers for the Configuration panel, add form, saved rows, icon picker, and
  Calendar important-date events. Prefer role/name queries where they are reliable.
- Repository, persistence, reconcile, model, component, and E2E tests provide the diagnostic seams.

## 8. Ordered implementation slices

### Slice 1 — Shared contract and durable persistence

1. Inspect the live diff for every target file before editing; preserve unrelated user changes.
2. Add the icon-key constant/type and `GlobalImportantDate` shared type; add the optional dataset
   collection and update any exhaustive fixture helpers that require it.
3. Add the SQLite table/index and dataset insert/read handling.
4. Preserve the collection in Jira reconcile.
5. Add persistence, old-fixture compatibility, database reopen, export/import, and reconcile tests.

**Exit:** important dates round-trip through SQLite and snapshots, existing databases open with an
empty collection, and Jira sync cannot remove locally authored dates.

### Slice 2 — Validated CRUD API

1. Add repository row mapping and create/update/delete functions.
2. Enforce name/date/icon allowlist and empty/unknown-patch validation.
3. Register POST/PUT/DELETE Configuration endpoints.
4. Add frontend API client functions and backend repository/server tests for happy paths and every
   documented 400/404/204 behavior.

**Exit:** a client can safely maintain global dates through the API, failed writes do not change the
database, and a subsequent dataset read returns deterministic results.

### Slice 3 — Configuration panel and shared icon renderer

1. Add one exhaustive `ImportantDateIcon` component/registry with readable option names and compact
   inline SVGs; do not add an icon-library dependency for this small palette.
2. Add `ImportantDatesSection` as a focused component and compose it into Configuration.
3. Implement the create form, chronological editable rows, icon preview/picker, busy/read-only/error
   behavior, and successful reload/reset behavior.
4. Add focused component/E2E coverage for keyboard picker use, create, edit, remove, failed mutation,
   empty state, and read-only state.
5. Inspect populated and empty panels at desktop and narrow widths; refine `styles.css` with existing
   tokens and control patterns.

**Exit:** all CRUD is operable by mouse and keyboard, icon choices have readable names, narrow layout
wraps cleanly, and the panel looks native to Configuration.

### Slice 4 — Calendar integration

1. Extend the pure portfolio-calendar event contract/model and deterministic ordering.
2. Add the Important dates layer, renderer, semantic styling, legend, accessible labels, and
   density-disclosure integration to `PortfolioMonthCalendar`.
3. Add model tests proving global dates survive all-active and selected-epic states without changing
   load/capacity data.
4. Add Calendar E2E/visual scenarios for a global date, icon rendering, layer toggle, same-day
   density, epic filtering, and narrow viewport containment.
5. Run the complete focused validation set and review the final diff for accidental changes to the
   user's work.

**Exit:** global dates appear with the selected icon in Calendar, remain visible under epic filters,
can be hidden only by their layer toggle, and have no effect on capacity truth.

## 9. Automated verification

Add or extend tests for:

- shared icon-key typing/allowlist and older dataset inputs without `importantDates`;
- database creation on a fresh and pre-feature database;
- full write/read and snapshot/export/import round trips;
- Jira reconcile preservation;
- repository create/update/delete, trimming, ISO date validity, icon allowlist, unknown ID, empty
  patch, and transaction rollback behavior;
- API status codes and `GET /api/dataset` visibility after each mutation;
- Configuration empty, populated, editable, busy, failed, and read-only states;
- icon picker mouse, arrows, Enter/Space, Escape, click-outside, focus return, and accessible names;
- portfolio-calendar model all-active versus selected-epic visibility, stable same-day ordering,
  global-only `hasVisibleDatedEvents`, and unchanged shared-load totals;
- Calendar layer toggling, icon/label rendering, dense-day disclosure, tooltip/accessible labels,
  month navigation, and narrow containment;
- create/edit/remove flowing from Configuration reload into Calendar without a hard refresh.

Likely commands, always from the repository root and only after `nvm use`:

```sh
nvm use
npm --workspace @ecp/shared test
npm --workspace @ecp/shared run typecheck
npm --workspace @ecp/backend test
npm --workspace @ecp/backend run typecheck
npm --workspace @ecp/frontend test
npm --workspace @ecp/frontend run typecheck
npm --workspace @ecp/frontend run build
npm --workspace @ecp/frontend run e2e -- timeline.spec.ts --workers=1 --reporter=list
npm --workspace @ecp/frontend run e2e -- portfolio.visual.spec.ts --workers=1 --reporter=list
git diff --check
```

Confirm exact scripts in the root and workspace `package.json` files before running. If focused
Configuration coverage lives in another E2E file, run that file as well.

## 10. Manual verification walkthrough

1. Open Configuration against the live backend. Confirm **Important dates** is a top-level panel and
   is available without selecting an epic or team.
2. Create `Quarterly planning` on a future date, choose the Users icon using only the keyboard, and
   save. Confirm the form resets only after success and the new chronological row appears.
3. Edit its name, date, and icon; reload the browser and confirm all three values persist.
4. Create two more dates on the same day with different icons. Confirm ordering is deterministic and
   every row action has an unambiguous accessible name.
5. Open Calendar on the relevant month. Confirm each global date shows its selected icon and full
   label, and the legend explains the treatment.
6. Select one epic. Confirm the global dates remain visible while epic events/Delivery outlook
   filter normally; compare a load band before and after filtering to confirm its total is unchanged.
7. Turn off **Important dates** in Layers. Confirm only global dates hide, then re-enable the layer.
8. Put enough global and epic events on one day to trigger `+N more`. Open and close it by keyboard;
   confirm every global date and icon is available and focus returns to the trigger.
9. Delete one global date in Configuration and return to Calendar. Confirm it is gone and unrelated
   dates remain.
10. Run a Jira sync, export/import the database snapshot, and restart against the same database.
    Confirm all remaining global dates survive each operation.
11. Repeat Configuration and Calendar checks near 390px width. Confirm controls wrap, the icon picker
    remains within the viewport, the calendar scrolls only in its labelled region, and the page has
    no horizontal overflow.
12. Repeat create/edit/delete and Calendar inspection with keyboard navigation and a screen reader or
    accessibility tree. Confirm icons are not announced as meaningless duplicate content.

## 11. Acceptance criteria

- A first-class global important-date entity exists independently of epic milestones.
- A user can create, edit, and remove a global date with a non-empty name, valid ISO date, and one
  allowlisted icon.
- Each date's icon choice persists through reload, application restart, database export/import, and
  Jira sync.
- Existing SQLite databases and older JSON fixtures load without destructive migration or manual
  backfill.
- Configuration provides a coherent, responsive Important dates panel and an accessible graphical
  icon picker.
- Calendar renders every global date on its day with the chosen icon and readable text.
- Global dates remain visible when any epic filter is active and are hidden only when the Important
  dates layer is disabled.
- Global dates never alter projection, health, shared load/capacity, or delivery outlook.
- Important dates participate correctly in same-day ordering and `+N more` disclosure.
- User-authored markup, files, paths, URLs, and unknown icon keys are never accepted or rendered.
- Empty, read-only, failed-mutation, desktop, narrow, mouse, keyboard, and assistive-technology states
  are covered proportionately.
- Focused shared/backend/frontend unit tests, typechecks, build, E2E/visual checks, and
  `git diff --check` pass.
- Unrelated pre-existing worktree changes remain intact.

## 12. Continuation record

**Current status:** Slices 1–4 are implemented. `GlobalImportantDate` and its allowlisted icon keys
round-trip through SQLite and dataset replacement, survive reconcile, and are maintained through
the Configuration API. Configuration has a responsive Important dates panel and keyboard-operable
icon chooser. Calendar has a default-on Important dates layer, icon rendering, deterministic
same-day ordering, and global dates remain visible under epic filters. Existing user-owned changes
were preserved.

**Automated validation completed:** after `nvm use`, shared/backend/frontend typechecks passed;
backend tests passed (156 tests), frontend tests passed (85 tests), frontend production build
passed, and `git diff --check` passed. The production build reports the pre-existing Vite large
chunk advisory only.

**Remaining action:** perform the manual browser walkthrough in section 10, especially narrow
viewport visual inspection and icon-picker keyboard/focus behavior.

**2026-08-18 extension:** Added optional `notes` (plain text, maximum 2,000 characters) and
`linkUrl` (validated HTTP(S) URL) fields. Existing SQLite databases gain nullable columns through
the additive migration path. The Configuration panel supports editing both fields; Calendar exposes
notes in the accessible label/tooltip and makes linked dates open safely in a new tab.

**2026-08-18 UI refinement:** Removed the multi-field inline Configuration form. Calendar now
offers a compact **Add date** action that opens a focused modal for name, date, icon, link, and
notes. This preserves Calendar as the operational context and prevents a wide, mismatched control
row from degrading the Configuration page.

**2026-08-18 modal consolidation:** The Calendar add modal now has three scoped tabs: Global date,
Epic date, and Availability. Global dates retain icon/link/notes; epic dates create existing
epic-scoped relevant days (including an explicit gating option); Availability creates PTO or on-call
ranges for an active team member. All tabs use existing validation and mutation APIs.

**2026-08-18 availability refinement:** Replaced the native team-member select in the Availability
tab with an in-app fuzzy finder. It matches case-insensitively by prefix, substring, then ordered
characters; keyboard arrows, Enter, and Escape work without leaving the modal.

**2026-08-18 selected-value refinement:** The fuzzy finder displays the chosen member as the
actual field value, not placeholder text. Focusing the field selects that value so typing replaces
it; editing clears the prior selection until a result is explicitly chosen.

**2026-08-18 date-picker refinement:** Added the reusable planner-styled `DatePicker` to replace
browser-native date popups in both add-availability surfaces. It retains typed ISO/US-formatted
date entry, provides dark month navigation and selection, and supports minimum dates for ranges.
Frontend guidance now directs future calendar-popup date fields to this shared component.

**2026-08-18 picker-placement refinement:** `DatePicker` measures available viewport space when
opened and flips upward for lower-page controls, preventing the calendar panel from colliding with
modal actions or being pushed below the visible viewport. Its popover is rendered in the document
layer instead of inside the modal's scroll container, so the modal cannot clip it.

**2026-08-18 epic-editor reuse:** The existing epic relevant-day editor now also uses `DatePicker`
for both the Name/Date add row and each editable (including gating) date row, keeping all relevant
day entry surfaces on the same date-input and calendar behavior.

**2026-08-18 relevant-day name refinement:** Replaced the browser-native name datalist in the
epic relevant-day add row with shared `Typeahead`. Suggested names are immediately discoverable,
while the field continues to accept an arbitrary relevant-day name.

**2026-08-18 epic-date modal audit:** Replaced the browser-native Epic select with local shared
`Typeahead`, and made the Epic-date Name field a shared typeahead with editable common suggestions.
This also removes the implicit-type input that had fallen through to browser-default styling.

**2026-08-18 cross-tab control audit:** Made Global-date Name explicit `type="text"` and added
the missing shared `url` (plus legacy implicit-input) style coverage, so every control in the
relevant-day modal receives intentional planner styling.
**First files to inspect:**

1. `packages/shared/src/domain.ts`
2. `packages/backend/src/db/schema.ts`
3. `packages/backend/src/db/database.ts`
4. `packages/backend/src/db/persist.ts`
5. `packages/backend/src/db/reconcile.ts`
6. `packages/backend/src/db/repository.ts`
7. `packages/backend/src/routes/config.ts`
8. `packages/frontend/src/components/Configuration.tsx`
9. `packages/frontend/src/lib/portfolioCalendar.ts`
10. `packages/frontend/src/components/PortfolioMonthCalendar.tsx`
11. `packages/frontend/src/styles.css`

**Implementation note:** Update this continuation record and slice status after each completed slice.
Record material deviations, newly discovered constraints, validation results, and remaining manual
checks here so a future agent can resume without the original conversation.

## 13. Reusable fuzzy icon finder extension

This section is the implementation plan for the 2026-08-18 request to turn the initial icon menu
into a reusable fuzzy finder with substantially more choices. It supersedes only the original
small-palette implementation details in sections 3.1, 3.3, 8.3, 9, and 10. The global-date domain,
persistence, API, Calendar visibility, and capacity invariants elsewhere in this document remain in
force.

### 13.1 Verified current behavior and evidence

The following was verified in the live worktree on 2026-08-18:

- [`packages/shared/src/domain.ts`](../packages/shared/src/domain.ts) defines exactly seven persisted
  keys: `calendar`, `star`, `flag`, `rocket`, `megaphone`, `shield`, and `users`. The database stores
  the key as text, and backend create/update validation uses this allowlist.
- [`packages/frontend/src/components/ImportantDateIcon.tsx`](../packages/frontend/src/components/ImportantDateIcon.tsx)
  contains both the seven labels and seven hand-authored SVG branches. It safely falls back to
  `calendar` for an unknown read value.
- [`packages/frontend/src/components/ImportantDatesSection.tsx`](../packages/frontend/src/components/ImportantDatesSection.tsx)
  declares `IconPicker` as a file-local component. It opens a fixed list of all keys, has no text
  input or fuzzy matching, and moves the actual persisted selection while the user merely arrows
  through the menu.
- The current picker places `.important-date-picker-menu` absolutely inside `.modal`. The shared
  `.modal` is height-capped and scrollable, so a taller catalog would be clipped or force awkward
  nested scrolling near the viewport edge.
- [`packages/frontend/src/components/Typeahead.tsx`](../packages/frontend/src/components/Typeahead.tsx)
  is the repository's shared combobox. It already owns async/local search, active-option keyboard
  movement, stale-request protection, no-match/error/loading states, click-outside dismissal, and
  `aria-activedescendant`. Its option model currently supports text, hint, and image URL only; it
  cannot yet render a trusted React icon before an option or inside the input.
- `Typeahead` currently filters on the visible committed value when opened, always reports
  `aria-selected="false"`, and blurs on Escape. Those defaults are tolerable for remote Jira lookup
  but do not meet the local-picker contract of showing the full set on focus, distinguishing active
  from selected, and keeping focus in the field when the popup closes.
- A small fuzzy scorer currently lives inside `ImportantDatesSection.tsx` for team members. It
  prefers prefix, then substring, then ordered-character matches, but is not reusable and cannot
  score an icon's label plus aliases such as `release`, `deadline`, or `security`.
- The frontend has no icon-package dependency. Seven inline SVGs were reasonable for the initial
  palette; maintaining several dozen bespoke paths would make visual consistency, accessibility,
  and future expansion unnecessarily error-prone.
- Frontend unit tests run in a Node environment and currently cover pure functions, not React DOM
  interactions. Playwright is therefore the existing seam for actual combobox keyboard, focus,
  overlay, and visual behavior.
- The worktree has extensive pre-existing modified and untracked files, including all of these
  seams and this plan. They are user-owned and must be preserved. Inspect the live diff before each
  overlapping edit.

**Root cause:** the first implementation optimized for a very small, fixed list and combined icon
registry, picker behavior, and the global-date form in one feature-specific path. More choices turn
that fixed list into a discovery problem and expose the menu's modal-clipping limitation. The
missing abstraction is not another global-date-only dropdown; it is a reusable local searchable
picker presentation layered on the existing shared `Typeahead`, plus a separately typed icon
catalog.

### 13.2 Decisions and component boundaries

#### Shared combobox capabilities

Extend `Typeahead` with optional capabilities rather than creating a second generic combobox:

```ts
interface TypeaheadProps<T extends TypeaheadOption> {
  // Existing props remain source-compatible.
  selectedId?: string | null;
  renderOptionLeading?: (option: T) => ReactNode;
  inputLeading?: ReactNode;
  selectValueOnFocus?: boolean;
  searchAllOnFocus?: boolean;
  portalMenu?: boolean;
  emptyLabel?: string;
  onDismiss?: () => void;
}
```

- Defaults preserve every existing caller's behavior except for safe accessibility bug fixes that
  are separately regression-tested.
- `selectedId` controls `aria-selected`; the keyboard `activeIndex` remains a distinct transient
  highlight.
- `renderOptionLeading` and `inputLeading` receive only trusted React nodes created by application
  code. They never render HTML, SVG strings, URLs, or class names supplied by saved data.
- `selectValueOnFocus` selects the visible committed label so the next keystroke replaces it.
- `searchAllOnFocus` displays the complete local set while leaving the committed label visibly in
  the real input. After the first edit, the typed query becomes the search input.
- `portalMenu` measures the input, renders the listbox under `document.body`, matches the control's
  width (with a practical icon-picker minimum), and chooses upward or downward placement from
  available viewport space. It repositions on window resize and capture-phase scroll and closes if
  the anchor is no longer visible. This follows the existing `DatePicker` overlay precedent and
  avoids modal clipping.
- Escape closes the list without blurring the combobox. Outside click closes it. Selection closes
  the list and returns/retains focus on the input. Clamp `activeIndex` whenever results change so
  `aria-activedescendant` never points at a missing option.

Create a reusable [`packages/frontend/src/components/IconPicker.tsx`](../packages/frontend/src/components/IconPicker.tsx)
that composes those capabilities. It is domain-agnostic and receives its allowlisted options and
renderer:

```ts
export interface IconPickerOption<K extends string> extends TypeaheadOption {
  id: K;
  keywords: readonly string[];
}

export interface IconPickerProps<K extends string> {
  label: string;
  value: K | null;
  options: readonly IconPickerOption<K>[];
  renderIcon: (key: K, className?: string) => ReactNode;
  onChange: (key: K | null) => void;
  disabled?: boolean;
  placeholder?: string;
  testId?: string;
}
```

Do not make `IconPicker` import important-date types. That boundary allows a future status,
category, or display-configuration form to supply its own stable keys while reusing the same
search, listbox, overlay, and state behavior.

#### Fuzzy matching

Move the existing member scorer into
[`packages/frontend/src/lib/fuzzySearch.ts`](../packages/frontend/src/lib/fuzzySearch.ts) and make it
operate on normalized searchable terms. `IconPicker` searches each option's label, stable key, and
aliases. Ranking is deterministic:

1. exact label or key;
2. label/key prefix;
3. alias prefix;
4. label/key substring;
5. alias substring;
6. ordered-character match;
7. original catalog order as the final tie-breaker.

Normalization is locale-aware lowercase plus whitespace/punctuation folding, so `check circle`,
`check-circle`, and `Check Circle` are equivalent. An empty query returns the full catalog in its
declared order. Do not add a fuzzy-search package for this bounded local list.

Reuse the extracted scorer in `MemberFuzzyPicker` in the same slice, with regression coverage to
prove member results retain prefix/substring/ordered-character behavior.

#### Icon registry and dependency

Keep persisted keys in `@ecp/shared`, but move all visual/search metadata into one exhaustive
frontend catalog exported by `ImportantDateIcon.tsx` (or a neighboring `importantDateIcons.tsx` if
that makes the component easier to read):

```ts
type ImportantDateIconDefinition = {
  key: ImportantDateIconKey;
  label: string;
  keywords: readonly string[];
  Icon: ComponentType<LucideProps>;
};
```

Add `lucide-react` as a frontend runtime dependency and use explicit named imports so the build can
tree-shake unused icons. Map stored keys through the curated registry; never index arbitrary
library exports with persisted/user text. Existing keys and labels remain unchanged. Preserve the
current `ImportantDateIcon` public renderer and `safeImportantDateIcon` fallback so Calendar and
saved rows do not need to know which icon package supplies the paths.

The initial expanded allowlist is 35 stable keys:

```text
calendar, star, flag, rocket, megaphone, shield, users,
alert-triangle, bell, bookmark, briefcase, bug, cake, check-circle,
circle-dollar-sign, clock, cloud, code, database, file-text, gift, globe,
heart, key, lightbulb, link, lock, map-pin, package, plane, presentation,
target, trophy, wrench, zap
```

**Product decision (2026-08-18):** ship this curated 35-icon core rather than exposing or
generating a much larger library catalog in the initial release. The goal is a strong set of
planning-relevant choices with useful aliases, not maximum icon count. The reusable picker and
catalog definition remain intentionally extensible so a later feature can add more built-in icons
or provide a controlled add-more workflow without replacing the picker. That future workflow must
receive its own persistence, trust, compatibility, and administration design; it must not be
implemented now by accepting arbitrary icon names or markup.

Give every definition a concise visible label and useful semantic aliases. At minimum, make common
planning language discover the expected choice: `event/date` → Calendar, `important/favorite` →
Star, `milestone/deadline` → Flag, `launch/release/deploy` → Rocket, `announcement/comms` →
Megaphone, `security/freeze` → Shield or Lock, `team/people` → Users, `incident/risk/warning` →
Alert Triangle, `demo/slides` → Presentation, and `maintenance/tools` → Wrench.

Catalog order is a product decision, not alphabetical sorting: retain the original seven familiar
choices first, then put generally useful planning icons ahead of specialized choices. Search
ranking supersedes catalog order only when there is a query.

### 13.3 Exact interaction and state contract

The reusable picker has four observable states:

| State | Field and popup behavior | Form value |
| --- | --- | --- |
| Closed/committed | Real search input shows the selected label and leading decorative icon | selected key |
| Focused/unedited | Input text is selected; popup shows the full catalog; selected option is marked | selected key |
| Editing | Input shows the query; selected adornment/selection clears; results update immediately | `null` |
| Selected | Input changes to the chosen label and icon; popup closes; input retains focus | chosen key |

- `IconPicker` keeps its displayed query synchronized when the parent changes `value`, including
  form reset and edit-row reload.
- Escape while editing cancels the pending query and restores the key/label that was committed when
  the popup opened. Escape while unedited only closes the popup.
- Tabbing away with unmatched text leaves `value === null`; a required form must remain visibly
  incomplete and its submit action disabled. Re-focusing reveals all choices again.
- Arrow Down/Up moves the active option without changing `value`. Home/End move to first/last.
  Enter selects the active result. Printable characters edit the query through the native input.
- Pointer hover updates only visual/active treatment; click commits one option. The visible label,
  not icon shape or color, conveys meaning.
- The menu is a single capped, scrollable list (roughly 8–10 rows) rather than a 35-row panel. The
  active option scrolls into view. The empty state says **No matching icons**.
- Use a search icon only if it does not compete with the selected icon adornment; the placeholder
  **Search icons** and `type="search"` already communicate the interaction.
- In `AddRelevantDayModal`, change `iconKey` to `ImportantDateIconKey | null`, initialize it to
  `calendar`, require a non-null value in `valid`, and narrow it before the create request. The
  server contract remains a non-null allowlisted key.

### 13.4 Compatibility, migration, failure, and security

- This is an additive data migration only: the SQLite column is already text and requires no schema
  change. Existing seven keys retain identical stored values, labels, and meaning.
- Backend validation automatically accepts the new keys only after the shared allowlist changes.
  Add backend tests for one newly added key and for continued rejection of arbitrary strings.
- Newer snapshots containing a new key are not guaranteed to be editable by an older application
  build. This normal downgrade limitation does not justify weakening allowlist validation.
- Frontend reads continue to fall back to Calendar for unknown/future keys so a malformed or newer
  dataset cannot crash rendering. Do not silently rewrite that fallback key unless the user saves.
- A missing icon library component for an allowlisted key is a developer error: make the registry
  exhaustive at compile time and add a catalog-completeness test. Runtime should still use the safe
  Calendar fallback rather than crash a Calendar page.
- Search is entirely local and synchronous. It creates no network traffic, loading indicator,
  telemetry, or concurrency race. The existing async `Typeahead` sequencing remains for remote
  callers.
- Do not accept custom SVG, emoji, icon names, CSS classes, data URLs, remote URLs, or dynamic
  package import paths. Every rendered component comes from the static registry.
- If the icon dependency materially increases the production bundle despite named imports, stop
  and record measurements before switching strategies. The fallback is to retain the same catalog
  contract with locally wrapped SVG components, not to reduce validation or dynamically import by
  user-controlled key.
- No observability event is needed for a local picker. Search/result tests, E2E traces on failure,
  and existing API errors are sufficient diagnostic seams.

### 13.5 Accessibility and visual invariants

- The field retains a persistent visible **Icon** label and a real `input[type="search"]` with
  `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, and a valid
  `aria-activedescendant` only while a result is active.
- Result rows use `role="option"`; `aria-selected` reflects the committed key, not the active row.
  Active and selected states may share accent-family styling but remain distinguishable by a check
  mark or explicit selected treatment in addition to color.
- SVGs in the input and option rows are `aria-hidden` because the visible option label supplies the
  accessible name. The Calendar's existing text-bearing event labels remain unchanged.
- Announce result count or no-match changes through a restrained status region if accessibility-tree
  inspection shows the listbox changes are otherwise silent. Avoid chatty announcements on every
  arrow press.
- Keep the current dark tokens and compact geometry: 8px field/row radii, 10–12px popup radius,
  quiet 1px borders, 13px row text, and accent only for focus/selection. Do not add per-icon colors.
- The selected icon/search input must match the height, border, surface, focus ring, and label rhythm
  of the adjacent Date and Link controls. The menu must stay within the viewport at desktop and
  near 390px width and must not cause modal or page horizontal scrolling.

### 13.6 Explicit non-goals

- No arbitrary icon upload, custom SVG/HTML, remote icon provider, emoji browser, or user-created
  icon aliases.
- No user-facing **Add icon** or catalog-management function in this slice. Preserve a clean catalog
  seam for that possible future feature, but do not pre-design its trust model or silently widen the
  runtime allowlist.
- No color picker, icon animation, recent/favorite icons, drag ordering, categories as tabs, or
  server-side icon search in this slice.
- No change to global-date API shapes beyond accepting the expanded allowlist.
- No icon choice for epic dates, availability, statuses, or navigation yet. The picker is reusable
  so those can be separate product decisions rather than being silently added now.
- No redesign of unrelated `Typeahead` consumers. New props are opt-in, and existing Jira, epic,
  member, and relevant-day pickers must remain behaviorally and visually stable.
- No navigation, routing, epic-filter, or capacity behavior changes. The product constitution's
  one-level navigation and shared-capacity rules are unaffected.

## 14. Ordered implementation slices for the extension

### Slice 5 — Fuzzy search utility and catalog contract

1. Inspect current diffs for `domain.ts`, `ImportantDatesSection.tsx`,
   `ImportantDateIcon.tsx`, package manifests/lockfile, tests, and `styles.css` before editing.
2. Extract and test normalization/scoring in `lib/fuzzySearch.ts`; migrate `MemberFuzzyPicker` with
   no visible behavior change.
3. Add the 28 new keys to `IMPORTANT_DATE_ICON_KEYS` without renaming or reordering the original
   seven.
4. Add `lucide-react` to the frontend workspace after `nvm use`; build one exhaustive catalog with
   label, aliases, and explicit component imports. Preserve the current renderer/fallback API.
5. Add pure tests for exact/prefix/alias/substring/ordered-character ranking, punctuation folding,
   stable ties, empty queries, catalog uniqueness, and allowlist/registry completeness.

**Exit:** the old and new keys render through one compile-time-complete registry, aliases search
deterministically, existing saved dates still look correct, and member fuzzy search has not
regressed.

### Slice 6 — Shared Typeahead hardening

1. Add the optional leading-renderer, selected-id, select-on-focus, show-all-on-focus, dismiss,
   empty-label, and portal-menu capabilities to `Typeahead` with source-compatible defaults.
2. Separate committed selection from active navigation, clamp active state when results change,
   retain focus on Escape, and scroll the active result into view.
3. Implement viewport-aware portal positioning using the DatePicker behavior as the repository
   precedent; avoid coupling the primitive to modal markup.
4. Regression-test existing local and remote consumers through focused Playwright flows, including
   stale async results, loading/error/no-match output where applicable.

**Exit:** `Typeahead` can present trusted leading visuals and a viewport-safe local full list without
changing existing picker contracts.

### Slice 7 — Reusable IconPicker and global-date integration

1. Implement generic `IconPicker<K>` by composing `Typeahead` and the shared fuzzy utility.
2. Implement the exact state transitions in section 13.3, including null-on-edit, Escape restore,
   full-list focus, deterministic filtering, keyboard selection, and parent-value resynchronization.
3. Replace the file-local `IconPicker` in `ImportantDatesSection.tsx`; delete its old custom menu,
   event listeners, and feature-specific listbox styles.
4. Update modal validity/narrowing for a nullable in-progress icon selection. Do not change the API
   payload after a valid selection is committed.
5. Add shared icon-picker styles adjacent to Typeahead styles and retain only important-date-specific
   layout rules in the modal section.

**Exit:** Global date uses the reusable fuzzy picker, all 35 icons are discoverable by empty-list
browsing and aliases, and a typed-but-unselected query cannot be saved as an icon key.

### Slice 8 — Interaction, viewport, and regression coverage

1. Add a deterministic important date to the Calendar visual fixture, because the current fixture
   omits `importantDates` and cannot exercise the picker or event icon.
2. Add Playwright coverage for opening the Add relevant day modal; full-list discovery; fuzzy alias
   search; no match; arrows/Home/End/Enter/Escape; active versus selected semantics; pointer
   selection; focus retention; and disabled submit for an uncommitted query.
3. Exercise portal placement with the trigger near both top and bottom viewport edges, modal scroll,
   resize, and a 390px-wide viewport. Assert the popup bounds stay inside the viewport and no page
   horizontal overflow appears.
4. Verify one original key and one new key through create request, dataset reload, Calendar render,
   and defensive unknown-key fallback. Confirm epic filtering and load data remain unchanged.
5. Run the focused and full frontend/backend/shared validation listed below, inspect screenshots at
   desktop and narrow sizes, and review the final diff for unrelated changes.

**Exit:** automated and manual evidence covers the reusable component, its global-date consumer,
the expanded persistence allowlist, and the viewport/accessibility risks introduced by a large
catalog.

## 15. Verification for the extension

### Automated checks

Add or extend coverage for:

- fuzzy normalization and every ranking tier, including alias and stable catalog-order ties;
- unique keys, non-empty unique labels, useful aliases, original-key preservation, and exact
  allowlist-to-registry coverage;
- safe fallback for unknown/null keys and rendering for every registry entry;
- backend create/update with a new key and rejection of an arbitrary key;
- shared Typeahead source compatibility, active-index clamping, selected versus active semantics,
  show-all-on-focus, Escape focus behavior, and portal positioning;
- IconPicker parent reset, committed display, null-on-edit, Escape restore, empty query, no matches,
  mouse and full keyboard selection;
- global-date modal validity and payload narrowing;
- Calendar rendering for old/new/fallback icons and unchanged epic-filter/capacity behavior;
- desktop and 390px visual/overflow checks.

From the repository root, run Node-based commands only after `nvm use`:

```sh
nvm use
npm --workspace @ecp/shared run typecheck
npm --workspace @ecp/backend test
npm --workspace @ecp/backend run typecheck
npm --workspace @ecp/frontend test
npm --workspace @ecp/frontend run typecheck
npm --workspace @ecp/frontend run build
npm --workspace @ecp/frontend run e2e -- timeline.spec.ts --workers=1 --reporter=list
npm --workspace @ecp/frontend run e2e -- portfolio.visual.spec.ts --workers=1 --reporter=list
git diff --check
```

Add a focused E2E file for the reusable picker if the scenarios make `timeline.spec.ts` harder to
navigate; if so, include it explicitly in the command list and keep the visual fixture in
`portfolio.visual.spec.ts`.

### Manual walkthrough

1. Open Calendar, launch **Add date**, and inspect Global date. Confirm Icon is a normal search field
   with Calendar shown as its real value and a decorative leading icon.
2. Focus Icon. Confirm the text selects and all 35 choices are available in a capped list without
   moving or clipping the modal.
3. Type `release`, `deadline`, `security`, `demo`, and `maintenance` in turn. Confirm the intended
   options rank first and the result order is stable when a query is repeated.
4. Type a nonsense query. Confirm **No matching icons**, no selected adornment, and disabled **Add
   day**. Press Escape and confirm Calendar is restored and the field retains focus.
5. Select Alert Triangle using only Arrow keys and Enter. Confirm the visible value and icon update,
   the popup closes, focus stays in the field, and Add day becomes enabled when other required
   fields are valid.
6. Reopen and select another icon with the pointer. Click outside to dismiss, reopen, use Home/End,
   and confirm active navigation never silently changes the committed value.
7. Create the date, reload, and confirm the same icon appears in Calendar. Edit/reopen the form if
   that surface is available and confirm the selected key remains stable.
8. Repeat near the bottom of a short desktop viewport and at 390px width. Confirm the popup flips or
   constrains itself within the viewport, the active row remains visible, and neither modal nor page
   gains horizontal overflow.
9. Navigate the whole flow with keyboard and inspect the accessibility tree or a screen reader.
   Confirm the combobox state, active option, selected option, no-match status, and visible labels
   are understandable without announcing duplicate SVG names.
10. Smoke-test Epic, Availability/team-member, Jira, and relevant-day Typeaheads. Confirm their
    current search, selection, loading/no-match, and Escape behavior has not unintentionally changed.

## 16. Acceptance criteria for the extension

- The icon field is a real, visibly searchable combobox that shows its committed selection as the
  actual input value.
- Focusing an unedited field exposes the entire catalog; typing filters immediately by label, stable
  key, and documented semantic aliases using deterministic fuzzy ranking.
- At least the 35 keys in section 13.2 are available. The original seven keys retain their stored
  values, labels, rendering, and backend validity.
- The shipped catalog is deliberately limited to the curated 35-icon core; expanding it or adding a
  user-facing add-more function is deferred and does not weaken the current static allowlist.
- The icon registry is compile-time exhaustive against the shared allowlist, has no duplicate keys,
  and never resolves a user-controlled string through dynamic imports or markup.
- The reusable `IconPicker` has no important-date dependency and is suitable for another planner
  form by supplying options and a trusted renderer.
- The picker reuses the shared `Typeahead`; no second generic combobox/listbox implementation remains
  in `ImportantDatesSection.tsx`.
- Keyboard, pointer, focus, active/selected, cancellation, no-match, disabled, and parent-reset
  behaviors match section 13.3 and use valid combobox/listbox semantics.
- The portal menu remains within the viewport, is not clipped by modal overflow, does not cause page
  overflow, and uses the existing dark control language at desktop and narrow widths.
- Existing global dates round-trip without schema changes. New keys persist through API reload and
  render in Calendar; invalid keys remain rejected and unknown reads remain safe.
- Jira, epic, member, and relevant-day Typeahead consumers pass regression checks.
- The feature introduces no navigation, epic-filter, capacity, external-network, telemetry, upload,
  or arbitrary-icon behavior.
- Focused tests, typechecks, production build, relevant E2E/visual checks, and `git diff --check`
  pass, with material bundle-size changes recorded before handoff.

## 17. Continuation record for the extension

**Current status:** Slices 5–8 implemented. The original global-date feature remains implemented
in the live worktree. The extension adds the curated 35-key allowlist, `lucide-react` icon catalog,
shared fuzzy utility, reusable `IconPicker`, and opt-in `Typeahead` leading-icon, selection,
full-list-on-focus, keyboard, and viewport-safe portal capabilities.

**2026-08-18 catalog decision:** Ship the curated 35-icon core in this extension. A larger generated
catalog or user-facing function for adding more icons is a future product slice, not part of slices
5–8. The generic `IconPicker` and exhaustive catalog seam are the intentional preparation for that
future without loosening current validation.

**Validation (2026-08-18):** after `nvm use`, shared/frontend/backend typechecks passed; backend
tests passed (156); frontend tests passed (88); the focused Calendar Playwright suite passed (7);
frontend production build passed; and `git diff --check` passed. The build reports the existing
Vite large-chunk advisory. The production bundle is 177.93 kB gzip for the main JavaScript asset
after adding the explicit Lucide imports.

**Remaining manual checks:** inspect the icon picker at desktop and 390px width; verify portal
placement near the bottom of the modal, keyboard selection/Escape restoration, and Calendar
rendering for a newly selected expanded-catalog icon.

**First files to inspect:**

1. `packages/shared/src/domain.ts`
2. `packages/frontend/src/components/ImportantDateIcon.tsx`
3. `packages/frontend/src/components/ImportantDatesSection.tsx`
4. `packages/frontend/src/components/Typeahead.tsx`
5. `packages/frontend/src/components/DatePicker.tsx`
6. `packages/frontend/src/styles.css`
7. `packages/frontend/package.json`
8. `package-lock.json`
9. `packages/frontend/vitest.config.ts`
10. `packages/frontend/e2e/timeline.spec.ts`
11. `packages/frontend/e2e/portfolio.visual.spec.ts`
12. `packages/backend/test/repository.test.ts`
13. `packages/backend/test/server.test.ts`

**First commands:**

```sh
git status --short
git diff -- packages/shared/src/domain.ts packages/frontend/src/components/ImportantDateIcon.tsx \
  packages/frontend/src/components/ImportantDatesSection.tsx \
  packages/frontend/src/components/Typeahead.tsx packages/frontend/src/styles.css
rg -n "IMPORTANT_DATE_ICON_KEYS|ImportantDateIcon|IconPicker|Typeahead|fuzzyScore" \
  packages/shared packages/frontend packages/backend/test
nvm use
```

Update this record after every slice with completed work, validation results, dependency/bundle
measurements, material deviations, and remaining manual checks. Do not rely on chat history.
