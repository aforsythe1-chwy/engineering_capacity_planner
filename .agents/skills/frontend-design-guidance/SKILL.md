---
name: frontend-design-guidance
description: Design or review Engineering Capacity Planner frontend UI so new React and CSS work extends the existing dark visual language, has coherent control hierarchy, and avoids blocky or inconsistent interface elements. Use for frontend components, forms, controls, layouts, styling, and visual QA in this repository.
metadata:
  scope: repo
---

# Planner Frontend Design Guidance

Apply this guidance before changing frontend controls, forms, layout, or visual styling. The goal is a calm, information-dense planning tool: clear hierarchy, restrained surfaces, and controls that belong to the surrounding interface.

## Start with the local system

1. Read the relevant component and its nearby rules in `packages/frontend/src/styles.css` before adding markup or CSS.
2. Reuse the existing tokens (`--bg`, `--panel`, `--panel-2`, `--border`, `--text`, `--muted`, `--accent`, and status colors) and established patterns such as `.panel`, `.btn`, `.link-btn`, `.control`, `.config-row`, `.badge`, and `.subtabs` where their semantics fit.
3. If changing navigation, routing, epic selection, or capacity-aware views, read `docs/planner-product-constitution.md` first.
4. Search for an existing component or class before creating a near-duplicate. Add a shared primitive only when more than one screen needs the same behavior.

## Visual language

- Use `--panel` for primary containers and `--panel-2` for nested or editable surfaces. Let the page background remain visible between groups.
- Use the established compact geometry: typically 8px radii for controls and rows, 10–12px for panels and menus, 1px quiet borders, and 7–12px control padding. Do not introduce conspicuously square, oversized, or heavily outlined elements without an intentional system-wide reason.
- Keep body controls around the existing 13px scale; labels and supporting text are smaller and muted. Reserve strong contrast, large type, and saturated color for hierarchy or meaningful state.
- Use accent color for focus, selection, and the primary action. Use green, yellow, and red only for meaningful status, warnings, or destructive actions—not decoration.
- Prefer whitespace, grouping, and alignment over extra boxes. A row should become a card only when it is independently actionable, needs separation from a dense list, or contains a distinct unit of information.
- Proactively inspect vertical rhythm in every changed view. Reset browser-default heading and paragraph margins where they create accidental empty space, and keep launch surfaces, headers, and action groups compact unless the extra space is intentional and supports hierarchy.
- Check the joins between adjacent UI regions—especially navigation tabs and the first page container—so borders and selected controls never visually collide with the content below. Add a restrained, token-consistent gap when they do.

## Controls and forms

- Match a control to its context. Inline actions should be compact (`.link-btn` or a small `.btn`); form submission and committed actions use `.btn`; only the one primary action in a local action group uses `.btn.primary`.
- Inputs, selects, and textareas need the same surface, border, radius, typography, height, and focus treatment as peer controls. Avoid styling one field as a large gray rectangle while its neighbors use the established compact dark controls.
- Before handoff, audit every newly introduced control in its rendered context. Ensure selector assumptions (including input types and wrapper classes) actually match the markup; no control may fall back to browser-default styling.
- Treat input types such as `search`, `url`, `date`, and `number` as distinct styling targets: shared rules for `input[type='text']` do not cover them. Declare a text input's `type="text"` explicitly; only use a selector for implicit inputs as legacy safety coverage, never as the reason to omit the type. A search control must visibly communicate text entry through a search icon and/or an explicit search placeholder, while retaining a real text input and visible focus state.
- In a searchable picker, render a committed selection as the actual field value—not as placeholder text, helper copy, or a visually ambiguous hint. On focus, select the committed value so the next keystroke replaces it; once the user edits the query, clear the prior selection until they explicitly choose a matching result. This makes both the current state and the next action unambiguous.
- Configure shared typeaheads according to their data source. Local option lists should search immediately and suppress transient “Searching…” status; reserve debouncing and loading feedback for genuinely asynchronous or remote lookups. When opening a local selection list, ensure the full set is discoverable rather than filtering it to the currently committed value.
- Before creating a picker, search for the repository’s shared `Typeahead` and `EpicPicker` primitives. Extend the closest shared primitive for a broadly useful behavior (for example, input type or keyboard semantics) rather than maintaining visually divergent one-off fuzzy pickers.
- Whenever a new dropdown needs filtering, type-ahead discovery, a future-expandable option set, or planner-consistent menu styling, use the shared `Typeahead` component by default. Configure it for local versus remote data as above. Use a native `<select>` only for a genuinely small, static, non-searchable choice set where the platform popup is acceptable.
- For date entry that exposes a calendar popup, use the shared `DatePicker` rather than a browser-native `input[type='date']`. It preserves text entry while keeping the calendar surface, navigation, selection, focus behavior, and automatic upward/downward placement consistent with the planner. Its popover is rendered above modal scroll containers, so it must not be constrained or clipped by a form panel. Extend that component for broadly needed date-picker behavior instead of creating a modal-local calendar.
- Treat modal scroll containers as content boundaries, not overlay boundaries. Any popup that can exceed its triggering control—calendar, typeahead menu, rich select, tooltip, or date range helper—must be positioned against the viewport or rendered in an appropriate overlay layer, then choose a placement that remains visible. Do not rely on `overflow: visible` as a one-off escape hatch: it fails at the viewport edge and produces divergent behavior between screens.
- Keep labels close to their fields, use muted helper text for guidance, and align controls to a shared baseline. On narrow screens, allow sensible wrapping rather than compressing labels or controls into unusable blocks.
- Keep intrinsically paired inputs together. In particular, start and end dates belong on the same desktop row (after any independent type/person selector), then stack cleanly on narrow screens.
- When paired fields share a row, make their grid tracks equal unless there is a deliberate, visible content reason to size them differently. Do not let a parent form’s asymmetric columns leak into a paired range.
- Make disabled, hover, active, error, and focus-visible states intentional. Preserve the repository's visible keyboard-focus outline and native semantics.
- Prefer native controls for short, standard selections. Browser- and OS-rendered `<select>` popups cannot reliably match the planner's dark menu styling.
- Use a segmented control only when the complete, stable choice set is intentionally tiny and comparing the options at a glance is valuable. If a set may gain values, use a native select on its own logical row; this keeps the form extensible without turning future options into a crowded tab strip.
- For a long or visually prominent selection list, first limit options to the relevant active entities. If the menu still needs planner-consistent styling, search, or richer content, build a scoped in-app picker with a capped scrollable list; preserve keyboard operation, focus return, Escape, click-outside dismissal, and listbox/option ARIA semantics.
- Do not place a many-field create form directly in a page panel or toolbar. If creation needs more than three compact inputs, a textarea, a URL, or a graphical picker, use a focused modal launched by one clear action. Keep the page surface for overview and existing records; keep the modal to a readable two-column layout at desktop and one column on narrow screens.
- Before adding a form to an established page, inspect it at its intended populated width. Reject layouts that force unrelated controls into one long horizontal row, produce mismatched control heights, or make the primary action look detached from its inputs. Prefer a modal or a compact vertical group with a clear heading and action footer.

## Anti-pattern: blocky, disconnected UI

Reject a treatment when it reads as an unrelated block pasted into the screen—for example, a full-width, thick-bordered gray input or pill beside compact controls; a new radius, border weight, or background unrelated to adjacent UI; or an action row whose buttons have arbitrary sizing and emphasis.

Before accepting a visual change, compare it with the nearest existing panel and control group:

- Does it use the same tokens, radius family, border weight, and type scale?
- Is its size proportional to the importance and density of its neighbors?
- Does the action hierarchy make the primary action obvious without making every control loud?
- Does it preserve breathing room without adding unnecessary containers?

If any answer is no, refine the existing pattern or deliberately introduce a reusable primitive rather than shipping a one-off treatment.

## Verification

For material visual changes, inspect the affected screen at desktop and a narrow viewport. Check empty, populated, error, disabled, hover, and keyboard-focus states as applicable. Run the relevant frontend checks after implementation; before Node-based commands, run `nvm use` from the repository root.
