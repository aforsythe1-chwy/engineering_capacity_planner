# Unified Epic Management, Ownership, and SME Ranking — Durable Implementation Plan

**Status:** Proposed  
**Created:** 2026-08-15  
**Scope:** Configuration UX, epic ownership and expertise intent, relevant-day editing, persistence,
API contracts, synchronization safety, and verification  
**Constraints:** plan only; no Spec Kit/SDD; preserve the flat planner and the invariants in
`planner-product-constitution.md`

## 1. Outcome

Replace the separate **Tracked epics** and **Epic settings** experiences with one durable
**Epics** management surface in Configuration. From that surface, a user can:

- find board epics and add or remove them from the capacity plan;
- classify a tracked epic as Timeline or Ongoing;
- inspect and update relevant days with a calendar picker;
- assign an owner from the epic's team members;
- maintain a priority-ordered subject-matter-expert list in a modal with fuzzy member search;
- continue editing the existing epic-specific Gantt label rules.

Ownership and expertise use one source of truth: the first person in an epic's ordered SME list is
the owner. Everyone else in the list is ordered from most to least knowledgeable. A team member who
is absent from the list is explicitly treated as having no known SME context and as starting from
scratch if moved onto the epic.

This plan records expertise data for use during engineer-movement decisions. It does not introduce
automatic staffing or capacity reallocation in this delivery.

## 2. Product decisions

### 2.1 One epic-management surface

Use one panel titled **Epics** near the top of Configuration. It owns both portfolio membership and
epic-specific settings.

The panel has three layers:

1. A board-epic fuzzy finder for adding candidates to the plan.
2. A compact list of tracked epics with their planning and ownership summaries.
3. An inline expanded editor for one epic at a time.

Remove the standalone **Epic settings** directory after all of its behavior is available in the
new panel. Do not duplicate settings in a second section during the final state.

### 2.2 Editing is independent from the page filter

Opening or closing an epic's editor is local Configuration UI state. It must not change the
route-backed Epic filter. This keeps selection-as-filter distinct from configuration and satisfies
the product constitution:

- opening an editor does not navigate;
- clearing or changing the global Epic filter does not discard the user's place in Configuration;
- all-active Configuration remains useful;
- the URL remains page plus optional filter, with no epic drill-down mode.

When Configuration opens with exactly one epic in the global filter, default that epic's row to
expanded. The user may expand another row without changing the filter. Include a separate **Show
only this epic** action if navigating the global filter is useful; label it as filtering, not
editing.

### 2.3 Owner is derived from SME order

Do not store a separate owner field. The ordered SME list is authoritative:

- index/rank 0 is the owner;
- later entries are additional SMEs in descending knowledge order;
- an empty list means **Unowned · no known SMEs**;
- moving another member to the first position reassigns ownership;
- removing the owner promotes the next member automatically;
- selecting an owner who is not already in the list inserts that member at the top;
- a member may appear at most once in an epic's list.

This avoids owner and expertise records drifting apart and gives future planning logic one
unambiguous ranking to consume.

### 2.4 Expertise is relative, not numeric

The first delivery stores order only. Do not invent knowledge percentages or proficiency levels.
For a given epic:

- lower rank means more knowledge;
- presence means known SME context;
- absence means starting from scratch.

The ranking is epic-specific. Being an SME for one epic says nothing about another epic.

### 2.5 Team-member eligibility

The picker offers members whose `teamId` matches the epic's `teamId`. Show avatar, name, and active
state. Inactive members remain selectable and remain visible in saved lists because expertise does
not disappear when capacity is inactive; mark them clearly so the user does not mistake them for
available capacity. Deleting a team member removes that member from all SME lists and promotes the
next ranked person where applicable.

This delivery does not add cross-team SMEs. If epics later span multiple teams, eligibility must be
revisited as an explicit product change.

## 3. Current-state findings

The implementation already provides much of the required seam:

- `Configuration.tsx` always renders `TrackedEpicsSection`, but epic-specific Gantt labels and
  relevant days render only when the route filter contains one epic.
- `App.tsx` renders a separate `EpicSettingsDirectory` only in the all-active state; selecting an
  entry changes the global Epic filter.
- `MilestonesSection` can add, promote, and remove relevant days. It uses a date input for new days,
  but existing rows show formatted text and cannot edit their name or date even though
  `updateMilestone()` already accepts both fields.
- `PortfolioEpic` stores scope, planning kind, and portfolio priority as local intent that survives
  Jira synchronization.
- `TeamMember` already supplies stable local IDs, team membership, active state, and optional Jira
  avatars.
- No owner or SME/expertise model exists today.

The consolidation should build on these contracts instead of introducing a second epic-settings
store or tying edit state more tightly to routing.

## 4. Target experience

### 4.1 Panel header and candidate finder

Keep the current board context and freshness messaging: configured board name, live-preview versus
last-synced state, and capacity-impact copy.

Upgrade the current candidate search to the repository's keyboard-first combobox behavior:

- fuzzy-rank normalized epic key and title locally;
- search the already-loaded candidate set rather than calling Jira per keystroke;
- support focus-open, Arrow Up/Down, Enter, Escape, outside-click close, visible focus,
  `aria-activedescendant`, listbox, and option semantics;
- show key, title, Jira status, remaining items/points, and exclusion reason;
- mark already tracked results selected;
- retain deliberate **Include anyway** language for an otherwise ineligible candidate.

Adding an epic creates or updates its local portfolio intent and then leaves its row visible in the
same panel. It does not select the epic in the global page filter.

### 4.2 Tracked epic rows

Each tracked row shows enough information to manage the portfolio without opening it:

- epic key and title;
- source status and remaining/unestimated work;
- Timeline or Ongoing kind;
- gating relevant-day name and date, or **Needs target** for a timeline epic;
- owner avatar/name, or **Unowned**;
- additional SME count;
- **Configure**, **Show only this epic**, and **Remove from plan** actions.

Use row-level busy/error state so a mutation on one epic does not disable unrelated configuration
controls. Preserve focus after reload.

Keep removed epics in a visually separate **Removed from plan** group with preserved owner/SME and
target summaries plus **Move back to plan**. Their saved configuration remains intact. Editing may
be disabled until restoration to avoid presenting removed work as active planning input.

### 4.3 Expanded epic editor

Only one tracked row is expanded at a time. The editor contains:

1. **Planning kind** — a Timeline/Ongoing segmented control or select.
2. **Owner and subject matter experts** — owner summary plus an **Edit knowledge list** action.
3. **Relevant days** — editable only for Timeline epics.
4. **Gantt label rules** — the existing apply-parent-labels and ignored-label settings.

Switching Timeline to Ongoing must preserve relevant days but hide their mutation controls behind
the existing explanation. Switching back restores them unchanged.

### 4.4 Relevant-day calendar editing

For each existing relevant day, render:

- an editable name;
- a labeled native `input[type="date"]` backed by the existing ISO `YYYY-MM-DD` value;
- a calendar affordance that opens the browser picker when supported and retains normal keyboard
  and manual-date fallback;
- the gating radio/control;
- row-level Save and Remove actions.

Use the existing `PUT /api/milestones/:id` endpoint for name/date updates. Save only changed fields,
reload the dataset after success, and keep the row in edit state with an inline error on failure.

The add row also uses the calendar picker. If a timeline epic has no relevant days, its first new
day becomes the gate by default. If relevant days exist but none is gating because of legacy or
imported data, require the user to choose whether the new day is the gate and continue showing
**Needs target** until a gate is selected.

Keep the invariant that at most one relevant day is gating. Promoting another day is the supported
way to move the gate. The current backend conflict on deleting the gate remains useful; the UI
should disable that removal and explain that another gate must be selected first.

### 4.5 Owner and SME modal

Open a modal from either the owner summary or **Edit knowledge list**. The modal works on a local
draft and persists only when the user selects **Save**.

The modal contains:

- explanatory copy: “Top to bottom is most to least knowledgeable. The first person is the owner.
  Anyone not listed is assumed to be starting from scratch.”;
- a fuzzy member combobox searching normalized member names locally;
- selected-member rows with avatar, name, active-state badge, rank, and an **Owner** badge on the
  first row;
- drag handles for pointer reordering plus explicit Move up/Move down buttons for keyboard and
  assistive-technology users;
- Remove actions;
- Save and Cancel actions.

Adding a member appends them to the bottom. Already-selected members are excluded or visibly
disabled in results. Reordering immediately updates the draft badges. Empty lists are valid. Save
submits the complete ordered member-ID list atomically; Cancel and backdrop/Escape close discard
the draft. Trap focus within the modal and restore it to the invoking control on close.

Use the same pure fuzzy-ranking helper and accessible combobox primitive for board epics and team
members where practical. Do not reuse the async Jira `Typeahead` unchanged: its network-oriented
debounce and incomplete active-descendant behavior do not match this local, keyboard-first case.

## 5. Domain and storage design

### 5.1 Shared model

Add a normalized local-intent type:

```ts
export interface EpicSme {
  epicKey: string;
  memberId: string;
  rank: number;
}
```

Add `epicSmes?: EpicSme[]` to `DomainDataset`, defaulting missing data to an empty list for old JSON
fixtures and older API payloads.

Add pure shared selectors rather than repeating sort/lookup behavior:

```ts
epicSmes(dataset, epicKey): EpicSme[];       // stable ascending rank
epicOwnerId(dataset, epicKey): string | null;
epicSmeRank(dataset, epicKey, memberId): number | null;
```

`epicSmeRank(...) === null` is the durable representation of “starting from scratch.” Keep this
helper available to future staffing/movement features without changing capacity calculations now.

### 5.2 SQLite schema

Add an additive table created by `SCHEMA_SQL`:

```sql
CREATE TABLE IF NOT EXISTS epic_sme (
  epic_key  TEXT NOT NULL REFERENCES epic(key) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES team_member(id) ON DELETE CASCADE,
  rank      INTEGER NOT NULL CHECK(rank >= 0),
  PRIMARY KEY (epic_key, member_id),
  UNIQUE (epic_key, rank)
);

CREATE INDEX IF NOT EXISTS idx_epic_sme_member ON epic_sme(member_id);
```

The repository, not SQLite, validates that the member belongs to the epic's team because that rule
spans two referenced tables. Full-list writes assign contiguous zero-based ranks. Member deletion
runs transactionally and compacts affected lists so the next entry becomes rank 0.

Because the table is new and `CREATE TABLE IF NOT EXISTS` runs whenever the database opens, no
destructive migration or data backfill is required. Existing databases start with empty SME lists,
which intentionally means unowned/no known experts.

### 5.3 Persistence and synchronization

Extend the complete-dataset persistence path:

- add `epic_sme` after `epic` and `team_member` in insert order and before both in delete order;
- write `dataset.epicSmes ?? []`;
- read rows deterministically by epic key and rank;
- include the field in persistence round-trip/snapshot normalization tests;
- include it in synthetic/fixture defaults as an empty list unless a fixture specifically tests
  ownership.

Treat SME order as local intent, never as a Jira fact. Reconciliation must preserve rows whose epic
and member still exist, including archived or removed epics, just as it preserves milestones and
portfolio intent. Jira sync must not infer, reorder, or clear SME data from work-item assignees.

Database snapshots naturally retain the new table. JSON export/import, obfuscation, and fixture
loaders must include or safely default the field so expertise is not lost when users move a planner
database or use development fixtures.

## 6. API and validation contracts

### 6.1 Ordered SME replacement

Add one atomic local-intent endpoint:

```http
PUT /api/portfolio/epics/:key/smes
Content-Type: application/json

{ "memberIds": ["member-7", "member-2", "member-9"] }
```

Return the canonical ordered rows or an equivalent ordered member-ID payload. The first returned
member is the derived owner.

Validate before changing data:

- the epic exists;
- `memberIds` is an array of strings;
- IDs are unique;
- every member exists;
- every member belongs to the epic's team;
- the request may be empty;
- unknown fields are rejected.

Replace the list in one database transaction: validate everything, delete existing rows for the
epic, insert contiguous ranks, and return the persisted order. Any failure leaves the old list
unchanged.

The frontend's owner quick action uses this same endpoint by moving/inserting the chosen member at
index 0. Do not add a second owner endpoint or field.

### 6.2 Existing epic settings and milestones

Keep current granular endpoints:

- `PUT /api/portfolio/epics/:key` for membership, kind, and priority;
- `PATCH /api/epics/:key/settings` for Gantt label rules;
- `POST /api/epics/:key/milestones` for creation;
- `PUT /api/milestones/:id` for name, calendar date, or gate promotion;
- `DELETE /api/milestones/:id` for non-gating removal.

Combining the UI does not require a broad “save entire epic” endpoint. Each subsection should show
its own busy, dirty, success, and error state so one failed mutation cannot obscure which data was
persisted.

Tighten milestone creation in the repository or request construction so the first relevant day for
an empty timeline epic becomes gating by default. Retain support for an intentionally targetless
timeline epic only when it has no dates or legacy data lacks a gate; the UI continues to show
**Needs target** in that state.

## 7. Frontend composition

### 7.1 Component boundaries

Refactor the large Configuration component along these responsibilities:

- `EpicManagementSection` — candidate preview/search, tracked and removed lists, expanded-row state;
- `TrackedEpicRow` — summary, kind, owner/SME summary, filter/remove/configure actions;
- `EpicSettingsEditor` — composition for relevant days and Gantt labels;
- `RelevantDaysEditor` and `RelevantDayRow` — add/edit/promote/delete with calendar inputs;
- `EpicSmeModal` — draft list, fuzzy add, reorder, owner derivation, save/cancel;
- a generic local `Combobox` plus pure ranker if extraction makes both epic and member search more
  accessible without coupling their display models.

Move the existing `EpicLabelSection` and `MilestonesSection` behavior into the editor rather than
copying it. Remove `EpicSettingsDirectory` from `App.tsx` when the unified panel is complete.

### 7.2 Props and state

Pass Configuration the collection-shaped selected epic keys and an optional filter callback rather
than a permanently singular edit identity. The implementation may still expand only one row, but
its interface stays future-multi-epic-ready.

Keep these state categories separate:

- route/global filter keys, owned by `App`;
- expanded epic key, owned by `EpicManagementSection`;
- modal draft member IDs, owned by `EpicSmeModal`;
- relevant-day row drafts, owned by each editable row;
- backend dataset, refreshed after successful mutations.

On reload, keep the expanded key if that epic still exists. If a mutation removes the globally
filtered epic from tracked scope, retain the existing route invalidation behavior: remain on
Configuration, clear only the invalid filter, and show the notice.

### 7.3 Read-only behavior

Bundled sample data remains fully inspectable. Disable all mutations and modal Save actions while
retaining ownership/SME summaries and relevant-day values. Do not disable search or expansion if
they are only local, read-only discovery actions.

## 8. Delivery slices

### Slice 1 — Domain, schema, and round-trip persistence

- Add `EpicSme`, the optional dataset collection, and shared owner/rank selectors.
- Add `epic_sme` and its index.
- Extend read/write/delete order and fixture defaults.
- Extend member deletion to compact affected lists.
- Add persistence and migration compatibility tests.

**Exit:** an old database opens with no migration loss; a ranked list round-trips exactly; owner is
derived consistently from rank 0.

### Slice 2 — Repository, API, and sync preservation

- Implement validated transactional list replacement.
- Register and type the SME endpoint and frontend client.
- Preserve SME intent through Jira reconciliation, archive, exclusion, and reactivation.
- Cover duplicate IDs, missing IDs, wrong-team IDs, empty lists, rollback, and member deletion.
- Tighten first-relevant-day gating behavior.

**Exit:** the backend provides a complete, atomic ownership/SME contract and Jira sync cannot erase
it.

### Slice 3 — Consolidated epic-management shell

- Introduce `EpicManagementSection` and move the existing tracker behavior into it.
- Add tracked-row target and owner/SME summaries.
- Add local row expansion and keep it independent from URL filter state.
- Move Gantt labels and relevant-day composition into the expanded editor.
- Remove the standalone `EpicSettingsDirectory` only after parity is verified.

**Exit:** Configuration has one Epics panel in both all-active and filtered states, and every
existing tracking/kind/label action remains available.

### Slice 4 — Editable relevant days

- Convert display-only existing dates and names into row drafts.
- Add native calendar picker behavior and explicit dirty Save.
- Preserve gate promotion/removal constraints and ongoing-epic suppression.
- Add inline validation and row-level errors.

**Exit:** users can add and update relevant-day names and dates from the unified editor, and changes
immediately flow to timeline/health projections after reload.

### Slice 5 — Owner and SME modal

- Build the accessible modal, local fuzzy member combobox, selected list, and reorder controls.
- Derive and display owner from the first draft/persisted member.
- Save the full list atomically and surface errors without closing or discarding the draft.
- Add row summary and empty/inactive states.

**Exit:** users can assign an owner, rank all known SMEs, remove people, save, cancel, and operate the
entire flow by keyboard.

### Slice 6 — Integration hardening and documentation

- Add end-to-end coverage for unified epic management.
- Verify read-only sample mode and responsive layouts.
- Update README/current product docs to point to the unified surface and ownership semantics.
- Run full typecheck, unit, backend integration, build, and Playwright suites.

**Exit:** all acceptance criteria below pass and older documentation no longer directs users to a
separate Epic settings directory.

## 9. Verification strategy

### 9.1 Shared and backend unit tests

- owner selector returns the lowest-ranked member and null for an empty list;
- absent member returns null rank (“starting from scratch”);
- persistence preserves order and empty/missing-list compatibility;
- API rejects duplicate, missing, and wrong-team members without partial writes;
- replacing a list writes contiguous ranks;
- deleting the owner promotes and compacts the remaining members;
- deleting an epic cascades its SME rows;
- archiving, excluding, restoring, and Jira syncing preserve expertise intent;
- first relevant day becomes gating and updating a date retains the single-gate invariant.

### 9.2 Frontend unit tests

- pure fuzzy ranking is deterministic for partial and out-of-order name fragments;
- owner and additional-SME summaries are derived from the ordered rows;
- expanded-editor selection does not mutate filter state;
- ongoing epics preserve but suppress relevant-day controls;
- row draft dirty-state and API patch construction include only changed milestone fields.

### 9.3 Playwright flows

1. Open Configuration with all epics, expand one row, and verify the URL/filter does not change.
2. Add/remove/restore a tracked epic and verify its settings and SME data survive.
3. Edit an existing relevant-day name and date through the calendar input, reload, and verify the
   new target appears in both Configuration and Timeline/Overview.
4. Open the SME modal, fuzzy-find members, add several, reorder by buttons and pointer interaction,
   save, reload, and verify the first person is shown as owner.
5. Remove the owner and verify the next SME is promoted.
6. Cancel a dirty modal and verify no persistence.
7. Exercise Arrow keys, Enter, Escape, focus restoration, listbox semantics, and modal focus trap.
8. Verify inactive-member badges, empty-list copy, errors, row-level busy state, and read-only sample
   mode.
9. Verify the panel remains usable at mobile width and long names do not hide owner or actions.

## 10. Acceptance criteria

- Configuration presents one Epics section, not separate Tracked epics and Epic settings sections.
- The single surface is useful with all active epics and with any global epic filter.
- Editing an epic never implicitly changes page/filter routing.
- Users can update the name and ISO date of every existing relevant day with a calendar picker.
- A timeline epic has at most one gating day; gate promotion and deletion rules remain safe.
- Ongoing epics preserve dates but do not expose launch/gating controls.
- Owners are chosen from the epic's team members and are always the first persisted SME.
- Users can fuzzy-find, add, remove, and reorder SMEs in an accessible modal.
- Team members absent from an epic's list have no stored expertise rank.
- Empty, inactive-member, removed-epic, read-only, loading, and failure states are explicit.
- Owner/SME intent survives database restart, export/import, Jira sync, exclusion, archive, and
  restoration.
- No new navigation level, route mode, or capacity allocation rule is introduced.

## 11. Non-goals and follow-on seam

This delivery does not:

- automatically move engineers or optimize assignments;
- convert SME rank into velocity multipliers;
- infer expertise from Jira history, assignees, or ticket counts;
- support people outside the epic's team;
- add numeric proficiency levels;
- add multi-epic bulk editing;
- replace the page-level Epic filter.

A later staffing feature can consume `epicSmeRank()` explicitly: current owner first, other ranked
SMEs next, and unlisted members as ramp-from-zero candidates. Any effect on projected capacity must
be designed and approved separately so expertise metadata does not silently change the planner's
shared-capacity truth.
