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
- Keep labels close to their fields, use muted helper text for guidance, and align controls to a shared baseline. On narrow screens, allow sensible wrapping rather than compressing labels or controls into unusable blocks.
- Make disabled, hover, active, error, and focus-visible states intentional. Preserve the repository's visible keyboard-focus outline and native semantics.
- Prefer native controls for standard selection and input. Build custom widgets only when the interaction genuinely requires search, richer content, or multi-selection; then preserve keyboard and ARIA behavior.

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
