# Inactive Team Member Roster Cleanup — Durable Implementation Plan

**Status:** Implemented and verified

**Created:** 2026-08-30

**Scope:** The Team members roster pictured in the Configuration page, its inactive-member
presentation and interaction behavior, focused styling, and regression coverage

**Intended outcome:** Keep the day-to-day Team members roster focused on active people while
preserving an obvious, accessible way to find, reactivate, or remove inactive people when needed.

**Branch:** `plan/hide-disabled-team-members`

**Related artifacts:**

- [Configuration Page Cleanup](./configuration-page-cleanup-plan.md)
- [Planner Product Constitution](./planner-product-constitution.md)

## 1. Problem statement and recommendation

The Configuration page currently renders every person in the selected team as the same full-width,
fully detailed member row. Inactive people are dimmed, but they still consume the same vertical
space and show the same velocity, walk-off-song, save, and remove controls as active people. A team
with several former members is therefore dominated by records that are not part of current
capacity or standup work.

Split the roster into two presentation groups:

1. render active members in the existing primary `config-list` with the existing full member row;
2. render inactive members under a collapsed-by-default native disclosure labeled
   **Inactive members (N)**;
3. when the disclosure is expanded, keep inactive members manageable through the existing row and
   mutation contracts, including reactivation and removal.

Do not delete, archive, migrate, or omit inactive members from the loaded dataset. This is a
presentation change at the Configuration roster seam. The collapsed group is important because
deactivation is intentionally reversible and some members cannot be deleted once they have
bandwidth history.

Use the domain and product term **inactive** in UI copy even though the request describes these
people as disabled. `TeamMember.active` is the established model, and the row currently labels its
checkbox `active`.

## 2. Verified current behavior and evidence

### 2.1 The pictured screen

The supplied screenshot corresponds to `MembersSection` in
`packages/frontend/src/components/Configuration.tsx`, inside the Configuration page's **Team →
Team setup → Team members** subsection. It is not the Team analysis workspace implemented by
`packages/frontend/src/components/TeamPage.tsx`.

Verified in `Configuration.tsx`:

- `Configuration` derives all members for the selected `teamId` without filtering on `active`.
- `TeamConfigurationSection` passes the complete array to `MembersSection`.
- `MembersSection` maps that array directly into one `config-list`.
- `MemberRow` adds the `inactive` class when `member.active` is false, but otherwise renders the
  same avatar, name, active checkbox, base velocity input, walk-off-song control, save action, and
  remove action.
- Toggling the active checkbox calls `PUT /api/members/:id` through `api.updateMember`, then the
  shared `useConfigActions` runner reloads the dataset.
- The shared runner disables Configuration controls while a mutation is pending and surfaces a
  page-level error if the update or reload fails.

Verified in `packages/frontend/src/styles.css`:

- `.config-row.inactive` only applies `opacity: 0.55`.
- An inactive row therefore takes the same grid space as an active row and is visually harder to
  read without becoming less prominent structurally.
- Existing `.config-list`, `.config-row`, `.link-btn`, token, border, and compact-radius patterns
  are sufficient for the row itself. Only a restrained disclosure wrapper and summary treatment
  should be needed.

### 2.2 Data and mutation contracts

Verified in `packages/shared/src/domain.ts`, `packages/frontend/src/data/api.ts`, and
`packages/backend/src/db/repository.ts`:

- `TeamMember.active` is a required boolean.
- `api.updateMember` already accepts `active` in its patch and needs no contract change.
- `repository.updateMember` persists `active` without deleting or rewriting other member data.
- New members default to active when `active` is omitted.
- Deleting a member is materially different from deactivating one. In particular, the backend
  rejects deletion when a member has bandwidth check-in history and instructs the caller to
  deactivate the member instead.
- Removing a deletable member also cascades or clears related records. This cleanup must not turn
  hiding inactive people into deletion or encourage removal as the only way to clean the screen.

No database migration, backfill, shared-domain change, or backend endpoint is required.

### 2.3 Other product surfaces already use active scope

Verified in the current frontend and backend:

- `TeamPage` derives `activeMembers` for the shared Engineer picker, Availability creation, and
  Sprint output.
- Standup note mentions, current standup participants, Important Dates member selection, sprint
  output, Gantt capacity, and synthetic work assignment already filter to active members where
  current-team participation matters.
- `BandwidthDayEditor` provides a useful precedent: it shows active members normally and only
  reveals inactive members with relevant historical check-ins under an
  `Inactive members (N)` disclosure.

The visible pollution in the supplied screenshot is therefore a Configuration-roster presentation
problem, not evidence that capacity calculations include inactive people.

### 2.4 Existing test coverage

`packages/frontend/e2e/configuration.spec.ts` currently asserts that all five bundled fixture
members render in `cfg-members`. The fixture contains four active members and one inactive member.
That assertion encodes the current flat roster and must change with this work.

The same spec also verifies that member walk-off-song summaries are consolidated into this one
roster and that the Team panel remains usable at a 390px-wide viewport. Those contracts remain
relevant and must not be weakened when the inactive row moves behind a disclosure.

## 3. Root cause

The model and API already express the correct lifecycle distinction. The UI problem comes from a
flat render path:

```text
all selected-team members
        ↓
members.map(MemberRow)
        ↓
one full-height list with opacity as the only inactive distinction
```

Opacity communicates state but does not establish information hierarchy. The roster needs to
partition the same data into current, frequently edited members and inactive, occasionally managed
members before rendering.

## 4. Decisions, invariants, and interaction contract

### 4.1 Roster partition

Derive `activeMembers` and `inactiveMembers` in `MembersSection` from the already team-scoped
`members` prop. Preserve the incoming order within each group unless an existing repository-wide
sort contract is discovered during implementation. Do not introduce alphabetical sorting as an
unrelated behavior change.

Render active members in the primary list. Render the inactive disclosure only when
`inactiveMembers.length > 0`.

When no active members exist, show concise empty copy in the primary roster such as
**No active team members. Add a member below or reactivate an inactive member.** If inactive people
exist, the latter phrase must make the recovery path clear. Do not leave a blank gap above the Add
member form.

### 4.2 Inactive disclosure

Use native `<details>` and `<summary>` semantics rather than a custom toggle. The summary label is
`Inactive members (N)` and remains keyboard operable without additional JavaScript.

The disclosure is collapsed by default on initial render and after a full page load. Its open state
does not need to be persisted in the URL, local storage, backend, or domain model.

When expanded, render inactive records using `MemberRow` so the existing contracts stay available:

- checking **active** reactivates the member;
- **remove** remains available when backend rules allow it;
- base velocity and walk-off-song data remain visible and editable;
- the existing `inactive` class continues to communicate status.

Do not create a second compact row component in the first slice. A second representation would risk
dropping song, velocity, read-only, error, and remove behavior and would add a maintenance seam for
a group users visit only occasionally.

### 4.3 State transitions

| Event | Primary active list | Inactive disclosure | Mutation/error behavior |
| --- | --- | --- | --- |
| Load with active and inactive members | Active rows visible | Closed, count shown | No mutation |
| Load with active members only | Active rows visible | Not rendered | No mutation |
| Load with inactive members only | Empty-state guidance | Closed, count shown | No mutation |
| Deactivate active member | Member leaves primary list after reload | Appears in count/group | Existing busy and error handling |
| Reactivate inactive member | Member appears in primary list after reload | Count decrements or group disappears | Existing busy and error handling |
| Remove inactive member | No primary-list change | Count decrements or group disappears | Backend may reject historical member deletion |
| Update fails | Current dataset presentation remains | Current group/count remains | Existing Configuration error is shown |
| Read-only fixture mode | Rows and disclosure remain inspectable | Summary can open; mutation controls stay disabled | No write attempted |

Because `useConfigActions` reloads the dataset after a successful mutation, grouping should be
derived from props on every render. Do not maintain duplicate active/inactive arrays in component
state or optimistically move rows before the server result.

If a user deactivates a member while the inactive disclosure is open, native disclosure state may
remain open while the component stays mounted. That is acceptable and useful. Persisting that state
across page loads is out of scope.

### 4.4 Visual and accessibility contract

- Keep the active roster visually identical to the current full rows.
- Style the inactive disclosure as a quiet secondary management surface using `--border`,
  `--panel-2`, `--muted`, existing compact radii, and restrained spacing.
- Do not wrap each group in a new heavy panel or make the summary look like a primary action.
- Preserve the existing visible keyboard focus treatment. Add an explicit `summary:focus-visible`
  rule if the browser's default is not sufficiently visible in the dark theme.
- Keep the disclosure count in text; do not rely on opacity, color, or a chevron alone to explain
  the hidden content.
- The summary must remain usable at 390px width, and expanded inactive rows must follow the existing
  responsive member-row layout without introducing horizontal page overflow.
- Read-only mode disables mutations but must not disable the disclosure itself; viewing inactive
  configuration is still legitimate.

### 4.5 Product invariants

- `active` remains the source of truth; do not infer inactivity from Jira linkage, contractor text,
  missing avatars, velocity, or song assignment.
- Inactive members remain in `dataset.members` so historical bandwidth, existing availability,
  expertise, Jira associations, and audio configuration can still resolve them where appropriate.
- Existing capacity, sprint output, standup, availability, and routing behavior must not change.
- The selected team continues to scope both groups. Members from other teams must never appear.
- Adding a member remains the same compact inline workflow and creates an active member by default.
- Do not alter the Jira setup wizard's separate member-linking list in this focused slice. Its job
  is account linking and discovery, not the pictured capacity roster; it needs its own UX decision
  if inactive Jira-linked users are noisy there as well.

## 5. Assumptions and unresolved follow-ups

### Confirmed implementation assumption

“Disabled users do not pollute the UI” means inactive members should be absent from the primary
roster but still intentionally discoverable and recoverable. Fully removing them from the DOM or
dataset by default would make reactivation difficult and conflict with the backend's deactivate-
instead-of-delete lifecycle.

### Follow-up only if implementation evidence contradicts the assumption

If product intent is instead to make inactive members completely undiscoverable on Configuration,
that requires a separate management/recovery entry point before implementation can safely hide
them. Do not silently remove the disclosure from this plan without recording where reactivation
moves.

## 6. Explicit non-goals

- No deletion, bulk archival, database migration, or change to member lifecycle semantics.
- No backend or shared-domain modifications.
- No change to capacity math, sprint-output attribution, standup participation, bandwidth history,
  PTO/on-call behavior, or availability calculation.
- No change to frontend navigation, routing, epic filtering, team selection, or portfolio scope.
- No redesign of MemberRow controls, walk-off-song behavior, the Add member form, or the Jira setup
  wizard.
- No bulk enable/disable, search, pagination, virtualization, or alphabetical sorting.
- No persisted disclosure preference.
- No broad Configuration-page or CSS-system redesign.
- No SDD or GitHub Spec Kit artifacts.

## 7. Implementation slices

### Slice 1 — Partition and present the roster

**Primary file:** `packages/frontend/src/components/Configuration.tsx`

1. Derive active and inactive arrays in `MembersSection`.
2. Keep the existing `data-testid="cfg-members"` on a stable container that owns the full roster
   region so existing test queries remain meaningful.
3. Render active `MemberRow` instances in the primary `.config-list`.
4. Add the active-empty guidance described above.
5. When inactive members exist, add a collapsed native disclosure with a stable targeted test ID
   (for example `cfg-inactive-members`) and the count in its summary.
6. Render inactive `MemberRow` instances inside the expanded disclosure.
7. Keep `MemberRow` mutation logic shared; do not fork active and inactive behaviors.

**Slice completion signal:** The default Configuration roster contains only active rows, the
inactive count is visible without scrolling through inactive rows, and expanding the disclosure
reveals the existing inactive controls.

### Slice 2 — Integrate quiet responsive styling

**Primary file:** `packages/frontend/src/styles.css`

1. Add narrowly scoped classes for the inactive disclosure container, summary, and nested list.
2. Reuse existing tokens, border weight, radius family, text scale, and spacing.
3. Preserve `.config-row.inactive`; its subdued state is still useful after expansion.
4. Ensure the nested list has deliberate top spacing and no accidental doubled bottom margin from
   `.config-list`.
5. Add or verify a clear focus-visible style for the summary.
6. Check desktop and 390px layouts with the group collapsed and expanded.

**Slice completion signal:** The disclosure reads as secondary roster management, not a new panel;
expanded rows remain aligned and the page does not overflow at the existing narrow test width.

### Slice 3 — Lock behavior with focused end-to-end coverage

**Primary file:** `packages/frontend/e2e/configuration.spec.ts`

Update the existing bundled-fixture expectations and add focused assertions for:

1. four active fixture rows visible in the primary list on load;
2. `Inactive members (1)` visible while the inactive fixture row is not visible by default;
3. activating the disclosure reveals Esteban and his existing controls/song summary;
4. the summary is operable with the keyboard and exposes native expanded/collapsed state;
5. read-only fixture mode keeps mutation controls disabled while the disclosure remains operable;
6. the 390px test exercises the expanded group and asserts no horizontal page overflow;
7. if a lightweight route-backed mutable test is practical in the existing spec, deactivation and
   reactivation move a member between groups after dataset reload. If not, cover that transition in
   a focused component test rather than introducing a broad fake backend.

Prefer role, label, and disclosure-scoped selectors for interaction. Keep stable test IDs only for
group boundaries and records whose dynamic visibility is the contract.

**Slice completion signal:** Regression coverage fails if inactive people return to the primary
roster, become impossible to reactivate, or cause narrow-layout overflow.

## 8. Failure, concurrency, migration, security, and observability

### Failure and concurrency

Continue using `useConfigActions` for all writes. It serializes Configuration interactions by
setting the shared busy state and reloads canonical data after success. This UI partition adds no
new requests and must not introduce optimistic group movement. The existing limitation of
last-write-wins behavior across separate browser sessions is unchanged.

If a write succeeds but reload fails, the current page-level error behavior remains authoritative;
do not locally guess which group the member belongs to.

### Migration and data compatibility

There is no migration. Existing active and inactive rows render under different groups based on the
same required boolean. Empty, all-active, all-inactive, and mixed rosters must all render safely.

### Security and privacy

No authorization, credentials, uploads, or external data access changes. Collapsing a row is not a
security boundary; inactive records remain available in the client dataset and can be revealed by
the user.

### Observability

No new production telemetry is justified for a local presentation-only change. Existing API errors
remain visible through the Configuration error banner. Test IDs provide deterministic E2E
observability of the two roster groups.

## 9. Verification plan

Before every Node-based command, run `nvm use` from the repository root as required by
`AGENTS.md`.

### Automated verification

Run the focused checks first:

```bash
nvm use
npm run typecheck --workspace @ecp/frontend
npm run test --workspace @ecp/frontend
npm run e2e --workspace @ecp/frontend -- e2e/configuration.spec.ts
npm run build --workspace @ecp/frontend
```

If shared roster behavior or unrelated components must change during implementation, expand to the
repository-wide checks:

```bash
nvm use
npm run typecheck
npm run test
npm run build
```

### Manual verification

Use a dataset containing multiple active and inactive people and verify:

1. Open **Configuration → Team setup → Team members** at desktop width.
2. Confirm only active people occupy the primary roster and the summary reports the exact inactive
   count.
3. Expand **Inactive members (N)** with pointer and keyboard; confirm every inactive member appears.
4. In editable backend mode, deactivate one active person. Confirm the successful reload removes
   the person from the primary roster and increments the inactive count.
5. Expand the group and reactivate that person. Confirm the successful reload restores the person
   to the primary roster and decrements the count.
6. Attempt to remove an inactive person with bandwidth history, if available. Confirm the backend
   rejection is surfaced and the person remains recoverable.
7. Confirm velocity, walk-off-song summary/editor, and remove controls still work when the group is
   expanded.
8. Repeat at approximately 390px wide with the group collapsed and expanded. Confirm no horizontal
   page overflow, clipped summary, or unreachable actions.
9. In bundled read-only mode, confirm the disclosure opens but all mutating controls remain
   disabled.
10. Capture a screenshot of the populated desktop roster and, if the expanded narrow layout
    materially differs, a narrow screenshot for visual review.

## 10. Acceptance criteria

- The primary Team members roster renders active members only.
- Inactive members do not consume full row space until the user intentionally expands a disclosure.
- A collapsed-by-default `Inactive members (N)` summary appears only when inactive members exist and
  always reports the correct selected-team count.
- Expanding the summary reveals every inactive member and preserves reactivation, velocity,
  walk-off-song, removal, read-only, busy, and error behavior.
- Deactivation and reactivation move a member between groups after the existing canonical dataset
  reload; no duplicate local member state is introduced.
- Empty, all-active, all-inactive, and mixed rosters have understandable output.
- The disclosure is keyboard accessible, has a visible focus state, and does not use color alone to
  convey hidden inactive content.
- Desktop and 390px layouts remain coherent with no new horizontal page overflow.
- No API, database, shared-domain, capacity, standup, routing, epic-filter, or Jira-linking behavior
  changes.
- Focused Configuration E2E coverage and frontend typecheck, tests, and build pass.

## 11. Continuation instructions

### Current status

Slices 1–3 are implemented: the Configuration roster now partitions active and inactive members,
uses a native inactive-members disclosure, and has focused E2E coverage for its default, expanded,
keyboard, and narrow-screen behavior. No recovery-path or lifecycle decision changed. The worktree
was already dirty before this plan was created. In particular, it contains user-owned changes to Team navigation and Sprint
output files, including `TeamPage.tsx`, `EngineerSprintOutput.tsx`,
`lib/engineerSprintOutput.ts`, `styles.css`, the Team navigation plan, and a new Team navigation E2E
spec. Preserve those changes and do not reset or overwrite them.

This plan intentionally adds only this Markdown file. It does not modify the existing dirty
frontend files.

### Verification completed

On 2026-08-30, frontend typecheck, all 118 frontend unit tests, the focused Configuration
Playwright spec, and the frontend production build passed. The focused E2E spec verifies keyboard
expansion and no horizontal overflow at 390px.

### Next action

No further implementation is required for this slice. Any future change should preserve the
active/inactive partition and the shared `MemberRow` mutation path.

### First files and commands to inspect

```bash
git status --short --branch
git diff -- packages/frontend/src/styles.css
sed -n '380,465p' packages/frontend/src/components/Configuration.tsx
sed -n '1425,1515p' packages/frontend/src/styles.css
sed -n '1,100p' packages/frontend/e2e/configuration.spec.ts
```

After inspecting, update this plan's status and slice completion notes as implementation proceeds.
Record any material change to the inactive-member recovery path here so a future agent does not
need the original conversation.
