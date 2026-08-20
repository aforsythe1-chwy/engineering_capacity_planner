# Historical Standup Bandwidth Entry — Durable Implementation Plan

**Status:** Implemented

**Created:** 2026-08-20

**Last updated:** 2026-08-20 — implemented and verified

**Working branch:** `feat/historical-standup-bandwidth-records`

**Scope:** let a user click a past date in the Team Bandwidth calendar and add, edit, or clear the manually backfilled bandwidth check-ins for that day

**Related plan:** [Team Workspace, Daily Bandwidth Check-ins, and Calendar](./bandwidth-feelings-plan.md)

**Constraints:** plan only; no Spec Kit/SDD; preserve the existing flat navigation and the distinction between the live Standup workflow and Team calendar analysis

## 1. Outcome

Turn each past date in **Team → Bandwidth** into an accessible action. Clicking a date opens a compact day editor containing the selected team's roster. The user can record each person's Red, Yellow, Green, or Purple bandwidth feeling and an optional note, then save the day's changes together.

This feature is a backfill and correction surface for the bandwidth signal. It does **not** create or reconstruct a Standup session, participant order, notes, ticket snapshots, timer state, completion state, or walk-off music activity. A manually entered row remains a normal `BandwidthCheckIn` with `sessionId: null`.

The ownership of each date remains explicit:

- A past date with no Standup session is editable from the Team calendar.
- A date owned by an existing Standup session is visible but read-only in this editor; the dialog explains that the check-ins came from Standup.
- Today remains owned by the live Standup workflow. Clicking today may show its details, but the calendar does not write them.
- Future dates are not actionable.

This completes the backfill intent in `bandwidth-feelings-plan.md` while replacing the current absolute “Calendar analysis only” rule with a narrower rule: Team analyzes every day and may maintain manual historical check-ins; the Standup page remains the only place that captures a real Standup session.

## 2. Verified current behavior and root cause

### 2.1 What already exists

- `packages/shared/src/domain.ts` defines `BandwidthCheckIn`, with one mutable row per member/date, an optional `sessionId`, one of four feelings, an optional note, and timestamps.
- SQLite already enforces one record per `(member_id, check_in_date)`. No schema migration is required for manually backfilled rows.
- `packages/backend/src/db/bandwidth.ts` already validates real ISO dates, supported feelings, and the 2,000-character note limit.
- `GET /api/bandwidth-check-ins?teamId=...&from=...&to=...` already loads a visible month.
- Per-member `PUT` and `DELETE` endpoints already make isolated manual edits possible.
- `packages/frontend/src/components/TeamPage.tsx` already owns the visible month's `checkIns` state and reloads it when the team or month changes.
- The calendar already renders all dates, weekday headings, average/count presentations, and response distributions.

### 2.2 Why historical entry is unavailable

- Each calendar day is a styled `<div>`, not an interactive control. It has a pointer cursor but no click handler, keyboard behavior, focus state, or editor state.
- `BandwidthView` receives check-ins and month navigation only. It does not receive the team roster, editability, a date-selection callback, or a save callback.
- The current copy explicitly directs all collection to Standup.
- Saving a full roster through the existing per-member endpoints can partially succeed, leaving half of a day's intended backfill saved if a later request fails.
- The generic bandwidth upsert currently assigns `session_id = excluded.session_id`. A calendar client that omits `sessionId` can therefore detach an existing Standup-owned row. That must be fixed before exposing a broader editor.
- A month response alone cannot reliably identify a Standup-owned date when the session has no check-ins, so the editor needs a day-level read contract.

### 2.3 Architectural boundary

`standup_session` has a unique `(team_id, standup_date)` identity and completed sessions store a final snapshot. Mutating session-owned check-ins from Team could make that snapshot disagree with the session and undermine completed-Standup immutability. The historical editor therefore owns only manual rows on dates without a session.

## 3. Product and interaction decisions

### 3.1 Entry point and date rules

- Keep the user on Team → Bandwidth; do not add a page or navigation level.
- Render every real date cell as a native `<button type="button">` when it can open details.
- Past cells open the day editor. They remain clickable in both Average and Count modes.
- Today opens a read-only detail state with a concise **Use Standup for today** explanation/action if the app has an existing Standup entry point available to reuse.
- Future cells are rendered as disabled/non-actionable calendar surfaces and expose that state to assistive technology.
- Weekend/non-working days remain eligible for historical entry because real check-ins may exist on them.
- Date comparisons use the same browser-local `localToday()` behavior as the rest of the frontend, avoiding UTC rollover errors.

### 3.2 Dialog layout

Open a focused modal titled **Bandwidth check-ins — Thursday, August 13, 2026**. Reuse the repository's `.modal-backdrop`, `.modal`, `.modal-heading`, `.modal-actions`, `.btn`, and color-token conventions.

The dialog contains:

1. A short line stating whether the day is editable, Standup-managed, today, or read-only sample data.
2. Response coverage, such as **3 of 8 reported**.
3. Active members first, ordered consistently with the team's normal roster.
4. An **Inactive members** disclosure when inactive members belong to the team and have an existing record for that date. Do not silently hide historical respondents.
5. One compact row per included member with avatar/name, a four-option radiogroup, and an optional note disclosure.
6. A persistent footer with **Cancel** and **Save changes**. Save is disabled until the draft differs from the server baseline and all fields are valid.

For a past, session-free date, include all active team members even when the page-level engineer filter is active. The filter may determine the initially focused/scrolled member, but it must not redefine the day's roster or cause omitted rows to be deleted.

For a Standup-managed date, show the recorded members and source state as read-only. Do not render controls that appear editable and fail only at save time.

### 3.3 Draft semantics

- Missing remains missing; opening and saving a day must never infer Green.
- Selecting a feeling creates or changes that member's draft.
- **Clear response** is an explicit row action and is shown only when a manual saved response or new draft exists.
- Notes are optional, trimmed, stored as `null` when blank, and limited to 2,000 characters.
- A note cannot be saved without a feeling.
- Cancel or backdrop/Escape close with a confirmation only when there are unsaved changes.
- Keep the attempted draft and show an inline error after a failed save. Do not close the dialog or discard text.
- After success, replace that date in `TeamPage`'s month state with the server-confirmed rows, update the calendar immediately, announce success in a polite live region, and close the dialog.

### 3.4 Read-only/sample mode

When the frontend is running without a writable backend, date details may still open from the loaded dataset. All controls and save actions are absent or disabled, and the dialog explains that sample data is read-only. No network mutation is attempted.

## 4. Data and API contracts

### 4.1 Shared day contract

Add explicit request/response types near `BandwidthCheckIn` in `packages/shared/src/domain.ts`:

```ts
export interface BandwidthDayStandupSource {
  sessionId: string;
  status: StandupSession['status'];
  committedAt?: string | null;
}

export interface BandwidthDay {
  teamId: string;
  date: IsoDate;
  checkIns: BandwidthCheckIn[];
  standup: BandwidthDayStandupSource | null;
}

export interface BandwidthDayPatch {
  upserts: Array<{
    memberId: string;
    feeling: BandwidthFeeling;
    note?: string | null;
  }>;
  deleteMemberIds: string[];
}
```

If importing `StandupSession['status']` creates an undesirable declaration order, extract/export the existing status union once and use it from both models. Do not duplicate string literals in frontend and backend.

### 4.2 Read one day

Add:

```http
GET /api/teams/:teamId/bandwidth-check-ins/:date
```

Successful response: `BandwidthDay`.

Behavior:

- Validate the team and real ISO date.
- Return all existing check-ins for that team/date, including inactive members' rows.
- Return the date's Standup source even if that session has zero check-ins.
- Order check-ins deterministically by active members first, then member name, then member ID.
- Return `404` for an unknown team and `400` for an invalid date.

The dialog loads this endpoint on open instead of trusting only the month snapshot. This provides current data and the authoritative session-ownership state without reloading the entire dataset.

### 4.3 Patch one day atomically

Add:

```http
PATCH /api/teams/:teamId/bandwidth-check-ins/:date
Content-Type: application/json

{
  "upserts": [
    { "memberId": "member-1", "feeling": "yellow", "note": "Interrupt load" }
  ],
  "deleteMemberIds": ["member-2"]
}
```

Successful response: the complete, server-confirmed `BandwidthDay` after the transaction.

Validation and transaction rules:

- Require at least one operation.
- Reject duplicate member IDs within either list.
- Reject a member that appears in both lists.
- Validate every feeling and note using the existing single-record rules.
- Require every referenced member to belong to `:teamId`; do not permit cross-team writes.
- Reject the entire request with `409` when a `standup_session` exists for that team/date, regardless of session status or whether it currently has check-ins.
- Run all validations before writes, then perform every upsert/delete in one SQLite transaction.
- Roll back the whole patch on any failure.
- Upserts create manual records with `session_id = null`.
- Deletes are idempotent for absent manual rows but must never remove a session-owned row.
- Omitted members are untouched. This is a patch, not “replace the day.”
- Return the full day after commit so the client does not synthesize timestamps or ordering.

Use row-level last-write-wins, consistent with the existing app. Because the request sends only changed rows, a second dialog saving a different member does not erase the first dialog's work. If two clients change the same member, the later committed patch wins and its returned day becomes authoritative.

### 4.4 Harden existing single-record mutations

Keep the existing endpoints for compatibility, but close the session-link hazards:

- In `upsertBandwidthCheckIn`, an omitted/null generic `sessionId` must preserve an existing non-null session link instead of overwriting it with null. A Standup-specific call may attach its own session ID.
- Generic `DELETE /api/bandwidth-check-ins/:memberId/:date` must reject deletion of a session-owned row with `409`.
- Standup's own delete/session lifecycle continues using its dedicated database path.

Add regression tests for both rules even though the new day editor uses the team-day endpoint.

### 4.5 No database migration

Manual rows fit the existing `bandwidth_check_in` schema. The distinction between sources is already represented by `session_id IS NULL` versus a non-null Standup foreign key. Do not add a second historical table or invent synthetic session IDs.

## 5. Frontend state and component design

### 5.1 `TeamPage` ownership

Extend `TeamPage` to own:

- `selectedBandwidthDate: string | null`;
- dialog open/close state;
- the current `BandwidthDay` and its load/error state;
- a callback that replaces only the saved date in `checkIns`.

Pass `team`, the team's full member list, `editable`, `selectedMemberId`, `onSelectDate`, and the existing calendar data into `BandwidthView`. Keep API side effects out of individual calendar cells.

When the visible team or month changes, close a stale dialog. A successful save should not trigger a full month fetch; merge the returned day into the existing state. A later normal month refresh remains the reconciliation path.

### 5.2 Extract a focused editor

Create `packages/frontend/src/components/BandwidthDayEditor.tsx` instead of expanding the already dense `TeamPage.tsx` further. Its inputs should be domain data and callbacks, not direct access to the entire `DomainDataset`.

Suggested responsibilities:

- `BandwidthDayEditor`: modal, loading/error/read-only states, focus restoration, dirty-close behavior, and save orchestration.
- `BandwidthMemberDraftRow`: avatar/name, feeling radiogroup, note disclosure, and clear action.
- `packages/frontend/src/lib/bandwidthDayDraft.ts`: pure baseline-to-draft conversion, dirty comparison, validation, and minimal patch generation.

The pure draft helper should make these cases deterministic and unit-testable:

- unchanged rows emit no operation;
- new feeling emits one upsert;
- changed feeling/note emits one upsert;
- cleared existing manual row emits one delete;
- a missing row left blank emits nothing;
- whitespace-only note normalizes to null;
- note without feeling is invalid;
- inactive rows not shown in the active roster are never deleted by omission.

### 5.3 Calendar cell semantics

Update `BandwidthView` so the full visual cell is a button where details can be opened. Preserve the day number, current background signal, count bars, and accessible summary.

Each accessible name should include:

- full date;
- response count;
- average signal or count summary;
- action/state, for example “Open historical check-ins,” “View today's check-ins; use Standup to edit,” or “Future date; unavailable.”

Do not nest the count-bar focus targets inside a button. Once the cell itself is interactive, make the bars presentational within the button and put their exact counts in the button's accessible label/title or a single non-interactive tooltip. Nested interactive controls are invalid and produce a poor keyboard sequence.

Restore focus to the originating day button after the dialog closes. Give past-day buttons a visible `:focus-visible` ring. Keep color-independent text/count labels.

### 5.4 Styling and responsive behavior

Extend `packages/frontend/src/styles.css` using existing tokens (`--panel`, `--panel-2`, `--border`, `--text`, `--muted`, and semantic feeling colors).

- Preserve the restrained dark calendar surface; interactivity should be signaled with a subtle hover border/raised background, not a new saturated card treatment.
- Use compact member rows rather than large repeated panels.
- Keep feeling controls equal-sized with text or symbols in addition to color.
- Use a scrollable modal body and a stable footer on shorter screens.
- At narrow widths, stack the member identity above the controls and keep touch targets at least 44px.
- Respect `prefers-reduced-motion` for modal and hover transitions.

## 6. State transitions and failure behavior

### 6.1 User flow

```text
Calendar day button
  -> open dialog and GET authoritative day
     -> loading
     -> read-only (today, future, sample mode, or Standup-managed)
     -> editable manual-history draft
        -> unchanged: close safely
        -> dirty: cancel/confirm discard
        -> save minimal PATCH
           -> success: replace date in month state, announce, close
           -> failure: keep draft open, show error, allow retry
```

### 6.2 Required failure cases

- **Day GET fails:** keep the modal open with the selected date, show a retry action, and do not fall back to editing stale month data.
- **Validation fails:** show row-specific guidance and focus the first invalid row; no request is sent.
- **Date became Standup-managed after open:** backend returns `409`; reload the day, switch the dialog to read-only, retain a non-destructive explanation, and do not retry the patch automatically.
- **Member changed teams/deleted after open:** backend rejects and rolls back. Reload the day/roster before another attempt.
- **Network/server error:** retain every draft value and expose Retry and Cancel.
- **Double submit:** disable actions while saving and use one in-flight promise.
- **Closing while saving:** block close until the request settles, preventing an ambiguous state.

## 7. Privacy, security, and observability

- Treat notes as private human-authored text. Do not log request bodies, note text, or returned day payloads.
- Existing database snapshot/import warnings about bandwidth notes continue to apply.
- Validate team ownership server-side; frontend filtering is not authorization or integrity enforcement.
- Preserve plain-text rendering for notes. Never inject note HTML.
- Errors may identify the date/member ID needed to resolve a conflict, but must not echo note content.
- No new analytics are required. Existing request status/error logging is sufficient if it excludes bodies.

## 8. Implementation slices

Each slice should end with the repository's standard concise manual-validation handoff before the next slice begins.

### Slice 1 — Safe day-level backend contract

Files:

- `packages/shared/src/domain.ts`
- `packages/backend/src/db/bandwidth.ts`
- `packages/backend/src/routes/bandwidth.ts`
- `packages/backend/test/server.test.ts`

Work:

1. Add the shared day and patch types.
2. Add the authoritative day query, including session ownership.
3. Add the atomic patch transaction and validation.
4. Harden existing upsert/delete behavior around session links.
5. Add API tests before connecting the UI.

Slice exit criteria:

- A session-free past day can be patched for multiple members atomically.
- Invalid/cross-team/conflicting operations make no writes.
- A Standup-managed date returns day details but rejects all day patches.
- Generic mutations cannot detach or delete a session-owned check-in.

### Slice 2 — Calendar interaction and draft editor

Files:

- `packages/frontend/src/data/api.ts`
- `packages/frontend/src/components/TeamPage.tsx`
- `packages/frontend/src/components/BandwidthDayEditor.tsx` (new)
- `packages/frontend/src/lib/bandwidthDayDraft.ts` (new)
- `packages/frontend/test/bandwidthDayDraft.test.ts` (new)
- `packages/frontend/src/styles.css`

Work:

1. Add typed day GET/PATCH client methods.
2. Extract/test draft diff generation.
3. Make calendar dates accessible controls in both display modes.
4. Add dialog loading, edit, read-only, dirty-close, save, and retry states.
5. Merge the saved day into the visible month without a full reload.
6. Replace the header's “analysis only” copy with concise backfill guidance.

Slice exit criteria:

- Clicking a past date opens the correct roster/date.
- Multiple changes save in one request and update the cell immediately.
- Today, future, sample, and Standup-managed states cannot write.
- Mouse, keyboard, and screen-reader paths have complete labels and focus behavior.

### Slice 3 — End-to-end coverage and visual hardening

Files:

- `packages/frontend/e2e/historical-bandwidth.spec.ts` (new)
- `packages/frontend/src/styles.css`
- this plan's status/history section

Work:

1. Cover opening an empty past day, entering multiple feelings/notes, saving, reopening, editing, and clearing.
2. Cover Count mode to ensure the interactive cell does not regress its visualization.
3. Cover read-only Standup-managed and future/today behavior.
4. Cover server-error draft retention and retry.
5. Verify desktop and narrow layouts in the real app with the repository's configured browser path.
6. Record any implementation deviations and mark this plan implemented only after automated and manual verification pass.

## 9. Automated verification

Before Node/npm commands, run `nvm use` from the repository root.

Backend tests must prove:

- valid day GET with active/inactive/manual/session-owned records;
- real-date, unknown-team, unknown-member, duplicate, overlap, feeling, note-length, and cross-team validation;
- atomic rollback when one operation is invalid;
- absent deletes are idempotent;
- omitted members remain unchanged;
- Standup-managed day conflict, including a session with zero check-ins;
- existing session ID survives generic upsert;
- generic delete cannot remove a session-owned row;
- response timestamps and complete day contents come from the database.

Frontend unit tests must prove the minimal patch rules in §5.2.

End-to-end tests must prove:

- a keyboard user can open a past cell, choose feelings, enter a note, save, and regain focus on the same day;
- reopened data matches the saved state;
- aggregate/count visuals refresh from the server response;
- clearing a manual record removes it;
- inactive historical records remain visible and are not deleted by omission;
- read-only modes send no mutation;
- a failed save retains the draft and succeeds on retry;
- no console errors or accessibility-invalid nested controls occur.

Run the relevant repository scripts discovered from `package.json`; expected minimum coverage is shared typecheck/build, backend tests, frontend unit tests, and the focused Playwright spec.

## 10. Manual validation walkthrough

Use a writable local database with at least two active members and one inactive member.

1. Open Team → Bandwidth in Average mode and tab to a past empty date.
2. Confirm the focus ring and accessible description identify the date and “0 reports.”
3. Open it with Enter, add two different feelings and one note, then save.
4. Confirm the dialog closes, focus returns to the same date, and the cell immediately shows two reports with the correct aggregate.
5. Reopen the date, confirm values persisted, change one, clear the other, and save.
6. Switch to Count mode and confirm the same date remains clickable and count bars update correctly.
7. Verify a date with an existing Standup opens read-only and cannot be mutated.
8. Verify today points toward Standup and a future date is unavailable.
9. Simulate a backend failure, confirm the draft remains intact, restore the backend, and retry successfully.
10. Repeat the primary flow at a narrow viewport and with keyboard only; confirm no clipped controls, trapped/lost focus, or color-only meaning.

## 11. Acceptance criteria

- A user can click any past, session-free Bandwidth calendar date and backfill one or more team members in a single editor.
- The user can edit or explicitly clear manual historical records.
- Missing responses remain missing and are never inferred as Green.
- Saved changes update the visible calendar immediately and persist after reopen/reload.
- No synthetic Standup session or other Standup artifacts are created.
- Existing Standup-managed dates and session-owned check-ins cannot be changed through Team.
- A multi-member save is atomic and omitted members are untouched.
- Inactive historical respondents remain discoverable.
- Notes retain existing trimming, length, privacy, and plain-text rules.
- Calendar cells, dialog controls, errors, focus restoration, and read-only states are keyboard- and screen-reader-accessible.
- Average and Count modes retain their current analytic meaning and remain usable after cells become interactive.
- Automated backend, unit, and focused end-to-end tests pass.
- Desktop and narrow manual validation pass without visual regressions.

## 12. Non-goals

- Creating, importing, or reconstructing `standup_session` records for historical dates.
- Backfilling participant order, Standup notes, ticket snapshots, timers, status, completion snapshots, or audio events.
- Editing completed or active Standup-owned check-ins from Team.
- Bulk CSV import, multi-day paste, or copying one day to another.
- Changing forecast/capacity math based on feelings.
- Changing navigation, routing, epic filtering, or team scope.
- Adding hosted authorization/audit systems to the current local single-user app.

## 13. Continuation instructions

To resume after context is cleared:

1. Read this plan and `docs/bandwidth-feelings-plan.md`.
2. Confirm the branch/worktree and preserve unrelated user changes.
3. Inspect the current versions of the files named in Slice 1; line numbers may have moved.
4. Start with the backend day contract and session-link regression tests. Do not begin UI writes until that safety boundary passes.
5. Implement slices in order and update **Status**, **Last updated**, and a short change log below after each slice.
6. Run `nvm use` before every Node/npm/npx command.
7. End each completed slice with a concise manual-validation walkthrough tailored to what changed.

## 14. Change log

- **2026-08-20:** Initial durable plan created from verified frontend, API, SQLite, and Standup-session behavior.
- **2026-08-20:** Implemented the atomic team-day API, session-history protections, accessible calendar day editor, focused unit/API/browser coverage, and responsive visual checks.
