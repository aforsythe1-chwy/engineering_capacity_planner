# Engineering Capacity Planner — Product Constitution

**Status:** Active

**Adopted:** 2026-08-15

**Last amended:** 2026-08-15 — added Team/Standup and clarified that team-owned signals are not epic-filtered

**Purpose:** Lightweight product and architecture guardrails. This is not an SDD or Spec Kit
constitution and creates no required specification process or ceremony.

## Core principles

### 1. The planner has one navigation level

Overview, Timeline, Dependencies, Gantt Planner, Team, Standup, and Configuration are peer
pages in one planner. An epic must not become a child application, drill-down mode, or prerequisite
navigation layer.

### 2. Epic selection is a filter

On epic-aware planning pages, selecting an epic changes the visible scope of the current page. It
must not implicitly navigate, replace the application shell, reveal a separate set of primary
pages, or require a special action to return to the portfolio.

Team-owned data such as roster, availability, and daily bandwidth check-ins is not epic data. Team
is calendar analysis; Standup is the separate data-collection workflow. Both preserve the epic
filter when navigating, but the filter must not hide engineers or change team-level aggregates.
Team, standup, and calendar controls are explicit, independent state.

Changing pages preserves the epic filter. Changing or clearing the epic filter preserves the page.

### 3. All active epics is the default useful state

Every primary page must provide a useful all-active view. An empty epic selection means **all active
epics**, not missing input and not an empty result. No primary page may require selecting an epic
before it can be used.

### 4. Filtering never changes the capacity truth

The team has one shared capacity pool across the active portfolio. Filtering may hide, collapse, or
emphasize presentation, but it must not remove other active work from shared-load calculations or
make the selected epic appear to own the team's unused capacity.

Capacity-aware views must preserve both:

- total portfolio load and capacity;
- the filtered epic contribution when a filter is active.

### 5. Cross-epic context is first-class

Dependencies, schedule conflicts, milestones, and capacity interactions may cross epic boundaries.
A filtered view must retain enough outside context to explain those interactions rather than
silently severing them.

### 6. Scope state is future-multi-epic-ready

Epic scope is represented as a collection of keys even while the initial UI supports all epics or
one epic. New routing, component, and selector contracts must not assume that a single epic is the
permanent maximum.

This principle does not require delivering multi-select or comparison UI now.

### 7. URLs describe page and filter independently

Canonical navigation state consists of a page plus an optional epic filter. URLs must remain
shareable and support reload, back, and forward behavior without a full application reload.

Do not reintroduce a `portfolio` versus `epic` view mode. Legacy URLs may be read for compatibility
but must be rewritten to the flat canonical form.

## Change check

Before accepting a change to navigation, routing, epic selection, or a capacity-aware page, verify:

- Can the page still be used with all active epics?
- Does selecting or clearing an epic leave the user on the same page?
- Does switching pages preserve the filter?
- Does Team keep roster, availability, and check-in data independent of the epic filter?
- Do Team's in-page data views avoid creating another primary navigation level?
- Are total portfolio load and cross-epic context still truthful?
- Does the design avoid assuming there can only ever be one selected epic?
- Does the canonical URL avoid a portfolio/epic hierarchy?

If any answer is no, the change conflicts with this constitution. Treat that as a product decision,
not an incidental implementation shortcut: document the conflict and obtain explicit approval
before proceeding.

## Relationship to implementation plans

The detailed migration path is documented in
[`flattened-planner-layout-plan.md`](./flattened-planner-layout-plan.md). The Team workspace and its
initial calendar modes are planned in
[`bandwidth-feelings-plan.md`](./bandwidth-feelings-plan.md). Plans may evolve as the code changes,
but the principles above remain the review boundary unless explicitly amended.

## Lightweight governance

- Amend this file directly when the product direction intentionally changes.
- Record the amendment date and rationale in the commit or pull request that changes it.
- Keep this document short and principle-focused; implementation sequencing belongs in plans.
- No additional SDD artifacts, templates, approvals, or recurring ceremonies are implied.
