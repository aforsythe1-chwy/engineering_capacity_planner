# Configuration Page Cleanup — Durable Implementation Plan

**Status:** Implemented 2026-08-24
**Created:** 2026-08-21
**Scope:** Configuration-page information architecture, team-member configuration, Standup audio composition, responsive styling, and focused verification
**Intended outcome:** Make Configuration easier to scan and maintain by grouping settings by owner and removing duplicate editing surfaces, especially the second team-member list used only for per-person walk-off songs.

## 1. Outcome

Reorganize Configuration into a small number of understandable groups while preserving the
planner's flat, one-level product navigation. The page remains a single peer page; this work does
not add nested routes, configuration tabs, or an epic drill-down mode.

The most visible consolidation is team-member audio:

- each member's walk-off song is configured on that member's row in **Team members**;
- the separate audio assignment list is removed;
- the shared track library and team default stay in a team-level/Standup-audio subsection because
  they are not owned by any one person;
- existing `inherit`, `off`, and `track` behavior and saved data remain unchanged.

The rest of the page is grouped by responsibility—portfolio planning, team, Standup, Jira/data
integration, and local maintenance—using headings and spacing rather than introducing another
navigation level.

## 2. Verified current behavior and evidence

### 2.1 Page composition

`packages/frontend/src/components/Configuration.tsx` currently renders a long, flat sequence:

1. read-only/error notices;
2. `EpicManagementSection`;
3. Planning knobs;
4. Team cadence;
5. Team members;
6. an Availability panel that only links to the Team page;
7. `JiraSetupWizard`;
8. `StandupStatusConfiguration`;
9. Standup settings (speaker threshold and raw pseudogroup JSON);
10. `StandupAudioConfiguration`;
11. `SyncLog`;
12. `DatabaseTools`.

Most of these are independent `.panel` siblings with equal visual weight. There is no page-level
grouping that distinguishes day-to-day planning settings from setup, integration, or maintenance.

### 2.2 Duplicated member editing surface

- `MembersSection` renders every member through `MemberRow`, with avatar, active state, base
  velocity, save, and remove actions.
- `StandupAudioConfiguration` separately filters and renders the same team's members through
  `AudioAssignments`, with avatar, effective-song summary, and an Edit action.
- `MemberOverride` already supports all required per-person states:
  `inherit`, `off`, and `track`.
- The current UI calls the feature **Walk-off audio**. The user described it as a walk-on song; this
  plan preserves the existing product term unless copy is deliberately changed as a separate
  decision.

The root cause of the duplication is component ownership, not a domain-model limitation: audio
loading, library management, defaults, and assignments all live inside one standalone
`StandupAudioConfiguration` component, so its assignment controls cannot currently be composed
inside `MemberRow`.

### 2.3 Existing data and API contracts

The existing contracts already support the target UI:

- `TeamStandupAudioSettings` contains one `defaultTrackId` and member assignments keyed by
  `memberId`.
- Missing/inherit assignments use the team default; `off` means deliberate silence; `track` points
  to a library track.
- `GET /api/teams/:teamId/standup-audio` reads the full team audio document.
- `PUT /api/teams/:teamId/standup-audio` atomically replaces the team default and explicit member
  overrides.
- Audio tracks use the existing list/upload/preview/delete endpoints.
- `standup_audio_member_override.member_id` has `ON DELETE CASCADE`, so deleting a member already
  removes that member's audio override.
- Track deletion is intentionally rejected while the track is referenced by a team default or a
  member override.

Therefore this cleanup requires no schema migration, data backfill, or API contract change.

### 2.4 Existing visual and product guardrails

- `docs/planner-product-constitution.md` requires one-level application navigation and treats Team
  data as team-owned, independent of the epic filter.
- The local frontend guidance favors quiet grouping, compact controls, existing `.panel`, `.control`,
  `.config-row`, `.btn`, `.link-btn`, and token usage, with desktop and narrow-viewport review.
- The current Configuration CSS already contains the core row and form patterns. Audio assignment
  rows use a near-duplicate row treatment (`.standup-audio-member`) that can be retired after the
  member controls move.
- There is focused E2E coverage for epic configuration, but no current Configuration E2E coverage
  for member/audio composition.

## 3. Decisions and invariants

### 3.1 Information architecture

Keep one continuous Configuration page and introduce semantic, non-interactive group headings in
this order:

| Group | Contents | Treatment |
| --- | --- | --- |
| Portfolio planning | Epics; planning defaults/knobs | Keep the large epic manager independent; present knobs as a compact sibling |
| Team | Team cadence; team members; Team availability link | Consolidate into one team configuration panel with internal subsections |
| Standup | Facilitation settings; status display; audio library and team default | Consolidate under one Standup group while allowing the dense status editor to keep its own internal subsection |
| Jira and sync | Jira setup wizard; sync history | Keep task-specific panels, but place them under one clear group heading |
| Data maintenance | Database snapshot/import | Keep visually isolated because import is destructive and operationally different |

Group headings are document structure, not tabs, subtabs, accordions, or routes. All settings stay
discoverable by scrolling and browser Find. Do not add sticky side navigation in this slice.

### 3.2 Team configuration

Combine cadence, member roster, and the Team availability handoff in a single
`TeamConfigurationSection` (name may vary during implementation). Use internal subsection headings
and quiet dividers rather than nesting `.panel` elements.

The member row owns all per-person configuration that can be changed safely in place:

- identity summary/avatar;
- active state;
- base velocity;
- effective walk-off song summary;
- an **Edit song** action;
- save/remove actions already present.

The Add member form remains compact and inline because it has only name and base velocity. Do not
make audio selection part of member creation: the member ID must exist before an audio override can
be saved, and coupling two resource writes would introduce partial-success handling for little UX
benefit. After creation, the new row is immediately available for song selection.

The Availability handoff becomes a compact callout/footer inside the Team panel, not a full panel
with the same visual weight as editable configuration.

### 3.3 Audio placement and semantics

Split the current all-in-one audio component into composable state and views:

- a team-audio controller/hook owns tracks, team settings, loading, busy state, and errors;
- an audio-library/default subsection owns upload, preview, delete, and team-default selection;
- a member-song control receives the current member, tracks, effective assignment, and a save
  callback and is rendered by `MemberRow`;
- there is exactly one rendered roster of team members on the page.

Preserve these states without reinterpretation:

| Stored state | Member-row summary | Editor choice |
| --- | --- | --- |
| no explicit assignment | `Uses team default: <track>` or `No team default` | Use team default |
| `mode: off` | `No song` | No song |
| `mode: track` with valid track | track display name | Custom song |
| referenced track unexpectedly unavailable | `Missing song` warning | Require a valid replacement or switch to default/off |

Use the existing `Typeahead` for custom-track selection because the library can grow and it already
supports local, immediate search and portal placement. The stable three-state mode can remain a
small radio group. Do not use a native long `<select>` for tracks.

Keep upload limits, legal-use copy, preview behavior, and delete-reference protection unchanged.
The team-default control and library belong in the Standup/audio subsection, even though their
effective result is shown in member rows.

### 3.4 Save and concurrency behavior

The current audio endpoint replaces the whole team's settings document. UI extraction must not
turn two near-simultaneous member edits into stale last-write-wins updates.

The audio controller must:

1. derive every replacement payload from the latest committed controller state, not from a stale
   row closure;
2. allow at most one team-audio settings write at a time, disabling related audio controls while it
   is pending;
3. update committed settings from the server response;
4. retain the editor and show an inline error if saving fails;
5. reload tracks/settings after a successful upload or deletion when needed;
6. keep non-audio member edits governed by the existing Configuration mutation runner.

This is a local single-user application, so API revisions or optimistic-lock tokens are not added
in this slice. Documented last-write-wins behavior across separate browser sessions remains an
accepted limitation.

### 3.5 State and scope invariants

- Moving controls must not rewrite or normalize existing settings until the user saves a change.
- Inactive members remain visible and configurable, with the existing subdued treatment.
- A team/epic filter change must not alter the roster or audio settings.
- Read-only fixture mode shows all values and disables every mutation, including song edit, upload,
  delete, and team-default changes; preview may remain available if the track content is reachable.
- No setting is hidden behind a required selection, nested route, or new navigation layer.
- Configuration mutations continue to refresh dependent planner data where they do today.
- Audio errors are scoped to the Team/Standup-audio area and do not replace the page-wide error
  banner used by the shared mutation runner.

## 4. Explicit non-goals

- No database or API redesign solely to attach audio fields directly to `TeamMember`.
- No change to Standup playback order, facilitator audio opt-in, timer behavior, or note workflow.
- No renaming of **Walk-off audio** to **walk-on song** without a product-copy decision.
- No redesign of the Jira setup wizard or sync-log detail modal.
- No graphical pseudogroup editor; the existing JSON editor may be moved and visually normalized,
  but replacing it is a separate feature.
- No new configuration route, subtab system, sticky table of contents, or accordion that hides
  settings.
- No change to planning math, epic filtering, portfolio scope, or the Team page's availability
  ownership.
- No broad CSS-system rewrite. Reuse local tokens and primitives and remove only styles made dead by
  this consolidation.

## 5. Target component seams

The exact names may be adjusted to match implementation, but responsibilities should end up near
these seams:

- `packages/frontend/src/components/Configuration.tsx`
  - owns page group ordering and the shared configuration mutation runner;
  - composes the new Team and Standup groups;
  - no longer renders a standalone Availability panel or standalone member-assignment roster.
- `packages/frontend/src/components/StandupAudioConfiguration.tsx`
  - extract the data/controller hook and library/default subsection;
  - export a reusable member-song editor/control, or move that focused control to a clearly named
    sibling module;
  - remove `AudioAssignments` after its behavior is represented in `MemberRow`.
- `packages/frontend/src/components/StandupStatusConfiguration.tsx`
  - support embedded/subsection rendering without adding a nested `.panel`;
  - preserve discovery, draft, error, reset, and save behavior.
- `packages/frontend/src/components/Configuration.tsx` member components
  - accept audio-controller data/actions without making rows fetch independently;
  - render effective song summary and editor affordance.
- `packages/frontend/src/styles.css`
  - add restrained group/subsection rhythm and a responsive member-row layout;
  - reuse current tokens and control styles;
  - remove obsolete `.standup-audio-member` rules once no longer referenced.
- `packages/frontend/e2e/configuration.spec.ts` (new)
  - cover composition, member-song states, read-only behavior, and responsive/keyboard essentials.

Do not move backend modules unless implementation uncovers a contract defect. Backend audio tests
remain regression coverage for persistence and validation.

## 6. Ordered implementation slices

### Slice 1 — Establish page grouping without changing behavior

**Status:** Implemented 2026-08-24

1. Add semantic group wrappers/headings to Configuration in the target order.
2. Add a reusable embedded/subsection presentation option where child components currently force
   their own `.panel` wrapper.
3. Combine Team cadence, Team members, and Availability handoff into one Team panel while leaving
   the member/audio duplication temporarily intact.
4. Group the Standup controls visually without changing their save paths.
5. Verify that all current settings still render in live and fixture modes.

This slice creates a reviewable information architecture before changing data ownership.

**Implemented:** `Configuration.tsx` now renders semantic Portfolio planning, Team, Standup,
Jira and sync, and Data maintenance groups. Cadence, roster, and the availability handoff compose
inside one `TeamConfigurationSection` panel using internal subsection boundaries. This did not
change any persistence or audio assignment behavior. `npm --workspace @ecp/frontend run typecheck`
passed after selecting Node 22 with `nvm use`.

### Slice 2 — Extract the shared team-audio controller

**Status:** Implemented 2026-08-24

1. Move track/settings loading, busy/error handling, and save serialization out of the standalone
   visual component.
2. Expose focused actions for team-default changes and one-member assignment changes while still
   sending the existing complete replacement document.
3. Preserve upload, preview, deletion, and reload behavior.
4. Add pure helper tests for effective member labels and replacement-payload construction if those
   helpers are extracted outside React.
5. Confirm no backend or schema change is necessary.

### Slice 3 — Move song configuration into member rows

**Status:** Implemented 2026-08-24

1. Pass tracks, settings, and audio actions from the Team configuration composition into member
   rows.
2. Show a concise effective-song summary in every member row.
3. Open a compact inline expander or focused modal for the three assignment modes. Prefer a modal
   if the populated desktop row becomes crowded or the track picker overlay would be clipped.
4. Use the shared `Typeahead` for custom tracks and preserve keyboard selection, Escape/cancel,
   focus return, portal placement, and visible focus states.
5. Remove `AudioAssignments` and its duplicate roster after parity is verified.
6. Keep the audio library and team default in the team-level Standup/audio subsection.

### Slice 4 — Responsive and visual refinement

**Status:** Implemented 2026-08-24

1. Convert the member row to an explicit grid so name, active state, velocity, song summary, and
   actions remain aligned at populated desktop width.
2. At narrow widths, stack logical groups without shrinking numeric inputs or creating detached
   actions.
3. Keep panel/subsection radii, borders, type sizes, and focus styles within the existing visual
   system.
4. Ensure group headings add hierarchy without looking like a second tab bar.
5. Remove dead one-off audio-member CSS and run a selector audit for every changed input type.

### Slice 5 — Regression coverage and handoff

**Status:** Implemented 2026-08-24

1. Add Configuration E2E coverage against a live seeded backend for successful audio mutations;
   fixture-only tests cannot prove writes.
2. Cover inherited default, explicit track, explicit no-song, inactive member, failed save, and
   read-only states.
3. Run focused frontend typecheck/tests/E2E and existing backend audio tests.
4. Perform desktop and narrow manual visual/keyboard validation.
5. Update this plan's status, completed slices, discoveries, and any changed decisions.

## 7. Failure, migration, security, accessibility, and observability

### Failure handling

- A failed song save leaves the previously committed summary visible, keeps the editor available,
  and shows a local actionable error.
- A failed track upload does not clear the selected file/name until the user can retry or cancel.
- A rejected referenced-track deletion continues to surface the backend conflict; the UI may add a
  clearer explanation but must not silently clear assignments.
- If audio loading fails, core member controls remain usable; only audio controls show unavailable.
- Invalid pseudogroup JSON remains isolated from unrelated Standup settings. If touched during the
  composition work, catch parse errors before invoking the API rather than letting the click
  handler throw an uncaught exception.

### Migration and compatibility

- No schema or data migration is expected.
- Existing assignment rows continue to resolve by member ID.
- Old databases without any audio rows continue to display `No team default`/inherit semantics.
- Snapshot/import behavior remains unchanged because the existing audio tables already participate
  in database persistence.

### Security and media constraints

- Preserve the 12 MiB per-track and 128 MiB library limits and MPEG validation.
- Do not log or expose audio blobs in client errors.
- Keep the existing legal-use guidance beside upload controls.
- Do not introduce remote media URLs or automatic playback.

### Accessibility

- Group headings use real headings in a coherent hierarchy; visual groups do not rely on color.
- Every song summary and action includes the member name in its accessible label when needed.
- The song editor has an accessible name, logical radio-group semantics, Escape/cancel behavior,
  initial focus, and focus return to its opener.
- Loading, save success where announced, and errors use suitable status/alert semantics without
  stealing focus.
- Keyboard users can reach all member, default, upload, preview, and deletion controls.
- Narrow layouts retain a sensible DOM/tab order.

### Observability

This local UI does not need new telemetry. Preserve actionable client error text and existing
backend HTTP status behavior. Automated regression tests are the primary observability addition.

## 8. Automated verification

Before every Node-based command, run `nvm use` from the repository root.

Recommended focused commands:

```bash
nvm use
npm --workspace @ecp/frontend run typecheck
npm --workspace @ecp/frontend test
npm --workspace @ecp/backend test -- standup-audio standup-audio-routes snapshot
PW_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  npm --workspace @ecp/frontend run e2e -- configuration.spec.ts epic-management.spec.ts
```

Also run the repository-wide typecheck before handoff if focused checks pass:

```bash
nvm use
npm run typecheck
```

### Recorded implementation validation (2026-08-24)

- `npm --workspace @ecp/frontend run typecheck` passed.
- `npm --workspace @ecp/frontend test` passed: 19 files, 105 tests.
- `npm --workspace @ecp/backend test -- standup-audio standup-audio-routes snapshot` passed:
  3 files, 15 tests.
- `npm --workspace @ecp/frontend run e2e -- configuration.spec.ts epic-management.spec.ts` passed
  in Chromium, including desktop and 390 px Configuration coverage.

Minimum E2E assertions:

- Configuration shows the intended group order with one visible team roster.
- Each member row displays its effective song.
- Editing a member from inherit to a custom track persists after reload.
- Editing a member to no song persists after reload.
- Changing the team default updates summaries for inheriting members but not explicit overrides.
- Upload and preview remain usable; deletion remains blocked while referenced.
- A failed audio request does not disable velocity/active-state editing.
- Read-only fixture mode exposes values and disables every mutation.
- The member-song editor is keyboard operable and returns focus on close.

## 9. Manual validation

Use a seeded live database that contains multiple active members, at least one inactive member, at
least two audio tracks, a team default, an explicit track override, and an explicit off override.

1. Open `?tab=configuration` at a typical desktop width.
2. Scan from top to bottom and confirm portfolio, team, Standup, Jira/sync, and maintenance settings
   are clearly grouped without nested application navigation.
3. Confirm there is one member roster and that cadence, roster, and the Team availability handoff
   read as one team-owned area.
4. Change one inheriting member to a custom track, reload, and confirm the summary persists.
5. Change the team default and confirm only inheriting summaries change.
6. Set a member to no song, reload, and verify playback resolution remains silent for that member.
7. Preview a track, stop it, and verify audio never starts automatically.
8. Try deleting an assigned track and confirm the conflict is clear and no data is lost.
9. Repeat the layout and edit flow near 390 px width; confirm controls stack cleanly and no picker
   or dialog is clipped.
10. Navigate the Team and Standup groups by keyboard, including opening/canceling the song editor,
    and confirm visible focus and focus return.
11. Force or mock an audio API failure and confirm roster velocity/active controls remain usable.
12. Open fixture/read-only mode and confirm the consolidated page remains understandable with all
    mutation controls disabled.

## 10. Acceptance criteria

- Configuration remains one peer page and introduces no route, subtab, or drill-down hierarchy.
- Settings are visibly grouped by portfolio, team, Standup, Jira/sync, and maintenance ownership.
- Team cadence, team members, and the Availability handoff occupy one coherent Team area.
- The page renders each team member exactly once.
- Every member row exposes the effective walk-off song and an accessible way to select team
  default, no song, or a custom track.
- The shared track library and team default remain available without duplicating the member roster.
- All existing audio assignments persist without migration and resolve identically before and
  after the UI change.
- Concurrent UI actions cannot send overlapping stale whole-document audio saves.
- Audio failures do not block unrelated member configuration.
- Existing track upload, preview, size/type validation, reference-protected deletion, and legal-use
  guidance are preserved.
- Read-only, inactive-member, empty-library, missing-track, loading, error, and narrow-layout states
  are intentional and tested or manually verified as appropriate.
- Changed controls use existing design tokens/primitives and pass desktop, narrow, and keyboard
  visual QA.
- Focused frontend and backend tests pass, and this plan is updated with final validation evidence.

## 11. Assumptions and unresolved decisions

### Assumptions used by this plan

- “Team specific walk on song” means the per-team-member override currently rendered in the audio
  assignment roster, not a request to remove the team-wide default.
- The current product term **Walk-off audio** remains canonical for this implementation.
- Configuration should become easier to scan through grouping and consolidation, not by hiding
  settings behind additional navigation.

### Decision to make during Slice 3 after populated-width inspection

- Use an inline row expander if it stays compact and does not clip the Typeahead overlay; otherwise
  use a focused member-song modal. This is deliberately deferred until the real populated row is
  rendered. Either choice must meet the same keyboard, focus, and persistence contracts.

No other product decision is required to begin Slice 1.

## 12. Continuation instructions

**Current status:** Implementation and automated validation are complete.
**Next action:** Use the manual validation steps above against a live local database before making
any product follow-up decisions. If a future audio API gains per-member patch semantics or revision
tokens, revisit the serialized full-document save controller.

First inspect:

1. `packages/frontend/src/components/Configuration.tsx`
2. `packages/frontend/src/components/StandupAudioConfiguration.tsx`
3. `packages/frontend/src/components/StandupStatusConfiguration.tsx`
4. `packages/frontend/src/styles.css` around `.panel`, `.controls`, `.config-row`, status config, and
   Standup audio rules
5. `packages/shared/src/standup-audio.ts`
6. `packages/backend/src/db/standup-audio.ts`
7. `packages/backend/src/routes/standup-audio.ts`
8. `docs/planner-product-constitution.md`

Useful discovery commands:

```bash
rg -n "Configuration|MembersSection|MemberRow|StandupAudioConfiguration|AudioAssignments|MemberOverride" packages/frontend/src
rg -n "standup-audio|standup_audio" packages/shared packages/backend packages/frontend
rg -n "config-row|standup-audio|section-title|panel" packages/frontend/src/styles.css
```

Keep this file current as slices complete. Record actual test commands/results and any component or
interaction decision changes here so a future agent can resume without the original conversation.
