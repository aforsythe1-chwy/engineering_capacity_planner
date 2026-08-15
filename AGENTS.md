# Repository Agent Instructions

## Development workflow

- Before running any Node.js, npm, npx, or other Node-based command, run `nvm use` from the repository root to select the version declared by the project.
- This repository does not use Spec-Driven Development (SDD) or GitHub Spec Kit.
- Do not initialize Spec Kit, create SDD artifacts, or invoke SDD workflows unless the user explicitly requests them for a specific task.

## Product architecture guardrail

- Before changing frontend navigation, routing, epic filtering, or portfolio/epic scope behavior, read `docs/planner-product-constitution.md`.
- Preserve its one-level navigation, filter-not-drill-down, shared-capacity, and future-multi-epic principles unless the user explicitly approves a product-direction change.
- This is a lightweight repository guardrail and does not authorize or require SDD or Spec Kit.

## Referencing other repositories

1. Check whether the repository exists locally under `/Users/aforsythe1/Documents/coding/chewy/repos`.
2. If it exists, switch to its main branch and pull the latest changes before using it as a reference.
3. If it does not exist locally, fetch it from GitHub and clone it into that directory for future reference.

## Pull requests

- Before opening a PR, inspect and use the repository's PR template exactly as the starting point.
- Fill in applicable sections, preserve checklist wording, and add extra context only within the template structure.

## Discovery

- Do not ask for validation before running read-only search or discovery commands.
- The exception is when the search target obviously appears sensitive, including secrets, credentials, keys, tokens, or private environment files.
