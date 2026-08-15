# Encrypted Offline Jira Store — Durable Implementation Plan

**Status:** Proposed
**Last updated:** 2026-08-14
**Scope:** one committed, password-encrypted Jira replay store that can seed a writable local ECP
database and back every Jira-facing API route without network access

## 1. Decision summary

Create an immutable, encrypted **offline Jira store** and treat the local SQLite database as a
disposable working copy derived from that store.

```text
committed *.jira-store.enc + separately delivered passphrase
                         |
              decrypt and validate in memory
                         |
            +------------+-------------+
            |                          |
    ReplayJiraClient             canonical ECP seed
            |                          |
   /api/jira/* + /api/sync       writable, gitignored SQLite
            |                          |
            +------------+-------------+
                         |
                    existing UI/API
```

The encrypted file is never the live database. UI edits, local planning intent, and sync
reconciliation must write to a normal gitignored SQLite file. This keeps the committed ciphertext
stable and makes reset/replay deterministic.

Recommended runtime configuration:

```dotenv
ECP_DATA_SOURCE=jira-store
ECP_JIRA_STORE_PATH=./packages/backend/testdata/team-board.jira-store.enc
ECP_JIRA_STORE_PASSWORD_FILE=/path/outside/the/repo/jira-store-password.txt
ECP_DB_PATH=./packages/backend/data/offline-jira.db
ECP_SEED_IF_EMPTY=true
```

The passphrase must never be committed, embedded in an npm script, placed in a command-line
argument, written to SQLite, or logged. A password-file environment variable is the preferred
non-interactive mechanism; a direct password environment variable may be supported for temporary
local use but should not be the documented default.

## 2. Why this fits the current repository

The repository already has most of the required seams:

- `JiraClient` is the only interface used for both importer reads and Configuration-page Jira
  discovery.
- `FakeJiraClient` already implements connection identity, users, fields, link types, JQL, issue
  lookup, boards, board issues, and sprints.
- startup can seed an empty SQLite database through an importer;
- `/api/sync` reconciles Jira facts into local intent;
- the DB is already gitignored and the DB import/snapshot flow establishes that it is a portable
  working unit;
- a raw Jira sync cache and an obfuscated fixture export already exist.

The existing artifacts are not sufficient as the committed offline store:

- `jira-last-sync.json` has a one-epic shape. In active portfolio mode the importer calls its cache
  writer inside the epic loop, so each epic overwrites the previous one. Encrypting this file would
  silently retain only the final imported epic.
- `jira-board-discovery.json` contains the whole board issue set, but it does not form a complete
  `JiraClient` snapshot: it lacks the authenticated user, field catalog, link types, boards,
  directory-user data, and sprint catalog required by setup and sync flows.
- `obfuscated-jira.json` intentionally replaces titles, people, project identifiers, sprint names,
  and other fidelity that this use case wants to retain.
- `ECP_JIRA_FAKE` is generated from the synthetic dataset rather than loaded from a captured board.
- `DataSource` currently distinguishes only `synthetic` and live `jira`; there is no explicit
  offline-replay mode or store/database identity check.
- active portfolio discovery currently contains literal `issuetype = Epic` checks even though other
  importer documentation describes hierarchy by parent depth. A faithfully captured board may have
  top-level planning records whose issue type is not named “Epic”; the store must retain them and the
  live/replay paths must share one explicit hierarchy-root rule.

The current local board-discovery cache is approximately 17 MB, while the last-sync cache is much
smaller. That reinforces the need to build the first store from a board-level capture, not from the
legacy per-epic cache.

## 3. Product outcome

A developer who has the repository, the encrypted store, the passphrase, and the project's runtime
dependencies can:

1. start the application with all network access disabled;
2. use a realistically populated portfolio built from the captured Jira board;
3. exercise Connect, Board, Epic scope, Fields, Members, ticket lookup, sync, and the regular ECP
   dataset API;
4. edit local capacity and planning intent in a writable SQLite working copy;
5. delete that DB and recreate the same baseline from the encrypted store;
6. distinguish captured Jira records from any deliberately generated coverage records.

There are two distinct offline promises:

- **No-network runtime:** the developer already has Node and installed dependencies; no request to
  Jira or any other remote service is made. This is the first implementation milestone.
- **Fresh air-gapped workstation:** the developer receives the runtime, native dependencies, source,
  and encrypted store in an OS/architecture-specific handoff kit. A committed store alone cannot
  satisfy this stronger promise because `npm install`, Node installation, and the native
  `better-sqlite3` module otherwise require previously downloaded artifacts.

### 3.1 Near-1:1 replay fidelity contract

“Almost 1:1” means that everything the capacity planner can currently read from Jira or display
from its local planning database is preserved at the capture instant. It does not mean a complete
Jira backup or a local implementation of Jira screens the planner never calls.

| Surface | Required replay fidelity |
| --- | --- |
| Jira issues | Same issue IDs/keys, summaries, issue types, statuses and status categories, parent hierarchy, configured point values, field-mapper candidates, labels, sprint fields, assignees, update timestamps, and issue-link topology |
| Boards and sprints | Same selected board identity/name/type/project, sprint IDs/names/states/dates, and board issue membership/order |
| Jira metadata | Same field IDs/names/types, link types, current-user identity, and the user directory subset visible to the planner |
| People | Same account IDs and display names; preserve email only when Jira returns it, the UI consumes it, and the approved capture profile permits it |
| Avatars | Capture a bounded Jira avatar thumbnail into the encrypted payload and rewrite it to a localhost asset URL during replay; use initials only when capture fails or policy excludes the image |
| ECP team state | Same team/member IDs and names, active state, base velocities, cadence, PTO, on-call, velocity overrides, milestones, portfolio intent, placements, sync history, and application settings selected by the seed allowlist |
| Query behavior | Same result membership, field projection, board scope, paging, and ordering for every `JiraClient` read used by the application |

The replay is a **frozen snapshot**. It will look and behave like the captured Jira/ECP state but
will not reflect changes made in Jira after `capturedAt`. Outbound Jira links, attachment downloads,
and Jira mutations cannot work with zero network connectivity.

The capture profile must be named and versioned, for example `planner-surface-v1`. Adding a new
Jira field or screen to the application requires updating this profile, its fidelity comparison,
and the README before claiming near-1:1 behavior for that feature.

The current ticket/sample routes request `*all` fields even though most values are not rendered.
Before capture is implemented, narrow their public response contract to the core fields, configured
fields, and dynamic scalar field-mapper candidates the UI actually consumes. The profile projection
must explicitly remove descriptions, comments, attachments, worklogs, and other excluded values
before data enters the store. Fidelity comparisons apply to this documented projection, not to
unused fields Jira happened to return over the wire.

### 3.2 Fidelity verification

The producer workflow must prove fidelity rather than relying only on record counts:

1. run a contract probe against the live `JiraClient` for every read method the app uses and project
   its responses through the versioned capture profile;
2. build and encrypt the store;
3. run the same probe against `ReplayJiraClient`;
4. canonicalize responses and compare field-by-field, ignoring only documented volatile transport
   values such as pagination tokens;
5. build a fresh SQLite DB from `ecpSeed.dataset` and compare its canonical dataset with the source
   DB, ignoring only store identity and newly generated sync timestamps;
6. compare embedded avatar content hashes and report any people using the fallback avatar;
7. write the detailed fidelity report inside the encrypted store and print only a safe pass/fail
   summary outside it.

Any mismatch on a field consumed by the UI fails `jira-store:verify`. Optional or intentionally
excluded fields must appear as named degradations in the fidelity report, never as silent omissions.

## 4. Goals

- Capture every issue in the configured Jira board, including multiple active and completed epics,
  while fetching only the fields needed by the application.
- Preserve exact planner-visible keys, titles, status categories, estimates, hierarchy, assignees,
  labels, dependencies, sprint membership, board metadata, query ordering, and sprint boundaries at
  the capture instant.
- Preserve a canonical ECP seed dataset so the offline UI also starts with useful local intent such
  as cadence, velocities, milestones, availability, and placements.
- Preserve team-member appearance by embedding approved avatar thumbnails in the encrypted store and
  serving them locally during replay.
- Encrypt and authenticate the entire payload before it enters Git.
- Keep all source identifiers, record counts, and captured data inside the encrypted portion; the
  public envelope exposes only format and cryptographic metadata.
- Back the existing Jira routes and importer with one replay client rather than adding route-specific
  fixture branches.
- Make the store immutable at runtime and reset the local DB explicitly.
- Detect store/schema incompatibility and DB/store mismatches with actionable errors.
- Provide capture, verify, inspect, diff, reset, and start workflows that do not require hand-editing
  JSON or decrypting a file onto disk.
- Prove with automated tests that offline mode makes no network requests.

## 5. Non-goals

- Replacing Jira with a general-purpose local Jira clone.
- Supporting arbitrary Jira REST endpoints outside the current `JiraClient` contract.
- Writing offline edits back into the encrypted store or later merging them into live Jira.
- Committing a plaintext SQLite database, raw board-discovery cache, raw sync cache, passphrase, or
  decrypted JSON.
- Capturing comments, descriptions, attachments, worklogs, audit history, or every custom field by
  default. “All issues” means the complete board issue population, not every sensitive field on each
  issue.
- Claiming that encryption makes weak passwords safe or revokes copies already committed to Git.
- Making one encrypted blob portable across future incompatible schemas without a versioned
  migration path.

## 6. Security and data-handling contract

This store contains real Jira data. Encryption protects the committed bytes at rest; it does not
make the data non-sensitive.

### 6.1 Required controls

- Confirm that the repository's access boundary and internal data policy permit storing this Jira
  subset, even as ciphertext, before the first store is committed.
- Deliver the passphrase through a different channel from the repository.
- Use a high-entropy generated passphrase or a long multi-word passphrase. Do not use a team name,
  project key, or other guessable value.
- Never include Jira credentials. The capture path uses credentials in memory through the existing
  live client; the payload schema has no token or HTTP authorization fields.
- Capture an allowlist of fields only. The initial allowlist should include `summary`, `status`,
  `parent`, `issuetype`, `assignee`, `issuelinks`, `updated`, the configured points/sprint/labels
  fields, and any other field with a demonstrated UI consumer.
- Never retain a remote avatar URL as the replay URL. When the approved fidelity profile includes
  avatars, fetch one size-bounded thumbnail during online capture, validate its media type and byte
  limit, encrypt it with the rest of the payload, and serve it from localhost. Otherwise render
  initials and report the fidelity degradation. Preserve email addresses only when Jira returns
  them, the current UI uses them, and the approved capture profile explicitly allows them.
- Never create a plaintext temporary fixture. Build the payload in memory, compress it, encrypt it,
  write ciphertext to a same-directory temporary file, verify it, then atomically rename it.
- Decrypt once at startup into process memory. Best-effort zero key buffers after use, recognizing
  that JavaScript does not guarantee full memory erasure.
- Treat the generated SQLite working copy as plaintext sensitive data. Keep it gitignored, do not
  include it in bug reports, and provide a cleanup command that identifies exactly which local DB
  and snapshots it will remove.
- Keep decrypted titles, names, keys, or field values out of logs and error messages. Inspection
  commands should print counts and schema/capture metadata by default; detailed output must be an
  explicit option.

### 6.2 Cryptographic envelope

Use only Node's built-in `node:crypto` and `node:zlib` so decryption has no new package dependency:

- password KDF: `scrypt`, with a random 16-byte salt;
- initial work factors: `N=2^17`, `r=8`, `p=1`, with an explicit `maxmem` safely above the required
  128 MiB and a runtime guard that rejects unsupported or excessive envelope values;
- cipher: AES-256-GCM with a fresh random 12-byte IV and a 16-byte authentication tag;
- compression: gzip before encryption;
- password text: UTF-8 after documented Unicode normalization;
- authenticated additional data: the canonical public envelope header, including format version,
  KDF parameters, cipher, and compression.

Every encryption uses a new salt and IV. Identical source data must therefore produce different
ciphertext. Decryption must authenticate before parsing or decompressing, reject wrong passwords
without exposing parse details, cap ciphertext and decompressed sizes, and validate the payload
schema before constructing a client or touching the database.

Recommended public envelope:

```ts
interface EncryptedJiraStoreEnvelopeV1 {
  format: 'ecp-jira-store';
  formatVersion: 1;
  kdf: {
    name: 'scrypt';
    N: 131072;
    r: 8;
    p: 1;
    salt: string;       // base64
  };
  cipher: {
    name: 'aes-256-gcm';
    iv: string;         // base64, 12 bytes
    tag: string;        // base64, 16 bytes
  };
  compression: 'gzip';
  ciphertext: string;  // base64
}
```

The envelope is deliberately versioned. KDF parameters are stored with the ciphertext so a later
format can raise the work factor without making older stores unreadable.

### 6.3 Limits of passphrase rotation

Re-encrypting a refreshed store with a new passphrase does not revoke an old passphrase from prior
Git commits. Anyone who has the old repository object and old passphrase can still decrypt it.
Actual revocation requires removing/restricting the repository or rewriting and purging history,
which is operationally disruptive. Choose the initial audience and passphrase distribution model
accordingly.

## 7. Decrypted payload contract

The decrypted, decompressed payload should be one canonical JSON document:

```ts
interface OfflineJiraStoreV1 {
  schemaVersion: 1;
  storeId: string;
  capturedAt: string;
  source: {
    projectKey: string;
    boardId: number;
    boardName: string;
    jiraFlavor: 'cloud' | 'server';
    hierarchy: {
      mode: 'jira-epic' | 'board-root';
      rootIssueTypeNames: string[];
    };
  };
  mapping: JiraMapping;
  jira: {
    currentUser: JiraUser;
    fields: JiraField[];
    issueLinkTypes: JiraIssueLinkType[];
    boards: JiraBoard[];
    sprintsByBoard: Record<string, JiraSprint[]>;
    issues: JiraIssue[];
    directoryUsers: JiraUser[];
    avatarAssetsByAccountId: Record<string, {
      mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
      bytesBase64: string;
      sha256: string;
    }>;
  };
  ecpSeed: {
    dataset: DomainDataset;
    syncLog: SyncLogEntry[];
  };
  provenance: {
    captureProfile: 'planner-surface-v1';
    capturedIssueKeys: string[];
    generatedIssueKeys: string[];
    augmentationProfile: string | null;
  };
  fidelity: {
    jiraClientContract: FidelityCheck[];
    ecpSeedContract: FidelityCheck[];
    avatarFallbackAccountIds: string[];
  };
}
```

Implementation details:

- `storeId` is a random identifier regenerated for a materially new capture.
- The board issue list is the authoritative replay set and contains each issue once. Epic/story/work
  partitions are derived rather than serialized separately.
- `directoryUsers` contains deduplicated issue assignees, the current user, and Jira identities
  already linked to ECP team members. Do not scrape the broader company directory.
- `avatarAssetsByAccountId` contains only the smallest useful approved thumbnail. The replay loader
  replaces captured remote avatar URLs with localhost asset routes; it never attempts
  to load the original host.
- `ecpSeed.dataset` comes from `readDataset` against the chosen local DB after a successful Jira sync.
  It then passes through an explicit seed allowlist/sanitizer before encryption. This preserves useful
  local planning intent without tying the store to SQLite page format or accidentally carrying
  remote avatar URLs or values outside the approved planner-surface profile. Member avatar references
  are rewritten to store asset references before the seed is serialized.
- The capture command must verify that the seed dataset's Jira facts correspond to the captured
  issue population and mapping. A mismatch fails capture unless the user explicitly chooses a
  Jira-only store.
- `syncLog` is captured because it is visible in the Configuration UI and is therefore part of the
  planner-visible fidelity contract. It remains encrypted with the rest of the store.
- All metadata in this interface is encrypted. A small sidecar checksum, if desired for artifact
  integrity/download verification, hashes ciphertext only and contains no source names or counts.

## 8. Capture and optional augmentation

### 8.1 Online capture

Add a read-only producer command:

```bash
npm run jira-store:capture -- \
  --db ./packages/backend/data/new-team.db \
  --out ./packages/backend/testdata/team-board.jira-store.enc \
  --password-file /path/outside/repo/jira-store-password.txt
```

The command must:

1. resolve board, project, and field mapping from the selected DB settings with existing environment
   fallbacks;
2. use the live `JiraClient` to capture current user, selected board, complete board issues, sprints,
   field catalog, and link types;
3. request the documented field allowlist, paginate to completion, and deduplicate by issue key;
4. derive directory users from captured issues, the current user, and ECP-linked team members;
5. fetch and validate one approved, size-bounded avatar thumbnail per visible account, recording
   explicit fallbacks for unavailable or excluded images;
6. read the synchronized ECP domain dataset and visible sync history from the DB;
7. generate a coverage and fidelity report before encryption;
8. record and validate the board's hierarchy-root interpretation rather than assuming every Jira
   project calls its root planning record “Epic”;
9. validate cross-references, issue counts, mapping fields, and seed/store consistency;
10. compress, encrypt, write, reopen, decrypt, and validate the candidate store;
11. run the live-versus-replay and source-DB-versus-seed contract comparisons;
12. replace the destination only after all verification succeeds;
13. print a safe summary and ciphertext SHA-256, never captured values or the passphrase.

The existing 17 MB board-discovery cache can help build and test the migration path, but the first
committed production-quality store should be made by the complete capture command while Jira is
available. The discovery cache alone lacks required metadata and should not be silently promoted.

### 8.2 Coverage report

Before optional augmentation, report whether the store exercises:

- multiple active epics and at least one completed/archived epic;
- To Do, in-progress, and done status categories;
- estimated and unestimated work;
- assigned and unassigned work;
- labels used by Gantt lanes;
- dependency edges, including at least one multi-hop chain;
- active, future, and closed sprints;
- work both inside and outside the current sprint;
- multiple assignees and realistic capacity/placement data;
- an epic missing a gating date and one with a configured gating date.

This is a warning/reporting step, not a reason to rewrite captured records.

### 8.3 Optional generated coverage board

Do not silently insert fake tickets into the captured real project. If the real board misses UI
states needed for development, `--augment-coverage` should add a second, clearly identified `LAB`
project and board to the payload using a deterministic generator. Its records must be listed under
`generatedIssueKeys`, and the UI should display an “Offline generated coverage” badge when that
board is selected.

This gives the user both:

- the untouched captured board for high-fidelity UI work; and
- a repeatable coverage board for rare states and visual regression tests.

The augmentation profile should be versioned and seeded so refreshing real data does not produce
unrelated synthetic churn.

## 9. Runtime integration

### 9.1 Configuration

Extend `DataSource` with `jira-store` and add:

- `jiraStorePath: string | null`;
- `jiraStorePasswordFile: string | null`;
- optional `jiraStorePassword: string | null`, treated as secret and never returned by any API;
- an explicit maximum decrypted payload size.

Offline mode must not require `JIRA_BASE_URL`, `JIRA_EMAIL`, or `JIRA_API_TOKEN`. Live `jira` mode
keeps its existing behavior.

Startup errors should distinguish missing store, missing passphrase, unsupported version, wrong
passphrase/tampering, invalid payload, and DB/store mismatch without echoing sensitive values.

### 9.2 Replay client

Generalize `fakeClientFromFixture` into a store-backed `ReplayJiraClient` that still satisfies the
existing `JiraClient` interface. Reuse `FakeJiraClient` internals where practical, but load all
captured catalogs and boards instead of default demo values.

The replay client must support:

- connection identity;
- board and epic searches;
- recent-ticket queries;
- current-sprint assignee suggestions;
- field and link-type mapping;
- ticket lookup;
- board-scope preview;
- the same configured hierarchy-root rule used by live Jira mode;
- importer pagination and field projection;
- sprints and board issue listing.

No route should contain `if (offline)` fixture data. The server constructs one replay client at
startup and injects it into the same importer, sync, and Jira route registrations used in live mode.

Writes on `JiraClient` are out of scope for the runtime store. If the interface requires them, the
replay implementation should return a typed read-only error rather than mutating in-memory data and
giving the impression that changes will persist.

### 9.3 Database bootstrap and identity

When the configured DB is empty:

1. validate/decrypt the store;
2. prefer `ecpSeed.dataset` and write it through the existing persistence layer;
3. otherwise run `JiraImporter` against the replay client;
4. write hidden/global settings for store ID and payload schema version;
5. confirm the resulting Jira mapping matches the store.

When the configured DB is not empty:

- if it has the same store ID, keep it and preserve the developer's local intent;
- if it has no store ID, fail with instructions to choose a new DB or explicitly adopt/reset it;
- if it belongs to another store ID, fail rather than mixing fixture facts and unrelated local
  intent.

`POST /api/sync` in offline mode replays the immutable captured Jira facts and exercises the normal
reconciliation path. Repeated sync must be deterministic except for sync timestamps/log rows.

Provide an explicit reset command that validates the exact target and snapshots or moves the old DB
before replacing it. Never reset a non-empty DB merely because the store changed.

### 9.4 Offline UI behavior

- `/health` and the source badge report `jira-store` / “Offline Jira replay.”
- Do not show the store path, password path, or decrypted capture metadata in browser responses.
- Disable outbound Jira links in offline mode or render them as non-clickable captured keys with an
  “Unavailable offline” hint.
- Serve captured avatar thumbnails from a localhost route backed by the in-memory store. Do not load
  remote avatar URLs, fonts, analytics, CDNs, source maps, or other external assets.
- Local edits work normally because they target SQLite, not the immutable store.

## 10. Developer commands and files

Proposed root commands:

```text
npm run jira-store:capture   # online producer; always writes encrypted output
npm run jira-store:verify    # decrypt/authenticate/schema-check; safe summary
npm run jira-store:inspect   # safe metadata and coverage report
npm run jira-store:diff      # decrypt two stores in memory; structural diff
npm run jira-store:reset-db  # explicit snapshot + rebuild of one working DB
npm run dev:offline          # load .env.offline.local and run existing app
```

Proposed repository layout:

```text
packages/backend/src/jira/store/
  schema.ts
  crypto.ts
  load.ts
  replay-client.ts
  coverage.ts
packages/backend/src/scripts/
  capture-jira-store.ts
  verify-jira-store.ts
  diff-jira-store.ts
  reset-offline-db.ts
packages/backend/testdata/
  team-board.jira-store.enc      # tracked ciphertext
  obfuscated-jira.json           # existing non-sensitive regression fixture
.env.offline.example             # tracked, contains no password
.env.offline.local               # gitignored
```

Extend `.gitignore` defensively for plaintext store variants such as `*.jira-store.json`,
`*.jira-store.dec`, and local password files. Do **not** ignore `*.jira-store.enc`, because the
ciphertext is the intended tracked artifact.

Because ciphertext is opaque, `jira-store:diff` should show reviewable structural changes after
decrypting both versions in memory: issue additions/removals by key, type/status-category counts,
sprint changes, field-mapping changes, seed dataset counts, and augmentation changes. Titles and
people remain hidden unless a reviewer explicitly requests a sensitive diff.

### 10.1 README and repeatable operator documentation

The root `README.md` must be the entry point for this feature. The implementation is not complete
unless the README contains tested, copy/pasteable instructions for both sides of the handoff.

Required README sections:

1. **What the encrypted Jira store is** — immutable ciphertext, separately delivered passphrase,
   writable gitignored DB, supported fidelity profile, and the distinction between runtime-offline
   and a fresh air-gapped machine.
2. **Create or refresh a store** — prerequisites, `nvm use`, selecting/syncing the source DB,
   creating a password file outside the repository, capture, fidelity verification, structural diff,
   and expected safe output.
3. **Safely commit the encrypted store** — verify the destination has the `.jira-store.enc` suffix,
   confirm raw caches/plaintext/password files remain ignored, inspect `git status`, stage the exact
   ciphertext path rather than using a broad add, review the PR diff/size, and deliver the password
   separately.
4. **Set up Jira replay** — obtain the password separately, copy `.env.offline.example`, configure
   store/password/DB paths, start offline mode, verify the source badge and baseline summary, and
   exercise setup/sync without Jira credentials.
5. **Reset, refresh, and clean up** — snapshot local experiments, explicitly reset the working DB,
   change stores without mixing IDs, remove plaintext working artifacts, and explain the Git-history
   limitation of password rotation.
6. **Fidelity and limitations** — the near-1:1 table from this plan, how to inspect the encrypted
   capture timestamp and local fidelity report, avatar fallbacks, excluded Jira fields/features,
   selected-board and directory-subset boundaries, frozen-snapshot behavior, and no outbound Jira
   writes. Do not copy real snapshot metadata into the tracked README.
7. **Troubleshooting** — wrong/missing password, corrupt or unsupported store, DB/store mismatch,
   missing avatar fallback, native dependency/platform mismatch, and proof that no network request
   occurred.

The commands documented in the README must land in the same change as their package scripts and
must be executed in a clean walkthrough before merge. The README must never instruct users to put a
password on the command line or commit a local `.env`, password file, raw cache, decrypted payload,
SQLite DB, WAL, or snapshot.

Because store creation and handoff are repeatable, security-sensitive workflows, also add a
repository-scoped `.agents/skills/offline-jira-store/SKILL.md`. It should call the checked-in scripts,
enforce exact-path staging and verification, and point humans to the README; CLI details remain in
the scripts rather than being reimplemented in prompts.

## 11. True air-gapped handoff kit

After no-network runtime mode works, add a separate packaging workflow for a developer starting on
a machine with no package registry or Node download access.

The handoff kit must be built for a declared OS and architecture and include:

- a repository checkout at a recorded commit;
- the encrypted store;
- the Node version pinned by `.nvmrc` or a compatible portable runtime;
- installed workspace dependencies, including the matching native `better-sqlite3` binary, or a
  complete verified offline npm cache and install script;
- built frontend/backend artifacts for smoke-testing before editing;
- source and type declarations needed for UI iteration;
- optional Playwright browser binaries only if offline E2E execution is required;
- checksums and a short start/reset/cleanup runbook.

Do not commit `node_modules` to Git. Produce the kit as a versioned release/handoff archive and test
it inside a clean network-disabled machine or container matching the target platform.

## 12. Implementation phases

### Phase 0 — data boundary and baseline inventory

Deliverables:

- approve repository and audience for encrypted real Jira data;
- document the field allowlist and passphrase delivery owner;
- inventory current board-discovery cache, sync cache, and synchronized DB by counts and schema;
- record whether the selected board uses literal Jira epics or parentless board roots as the
  planner's logical epics;
- record the required target OS/architecture for a later air-gapped kit.

Exit criteria:

- no credential-bearing fields are in the proposed payload;
- the selected board and DB snapshot times are compatible;
- repository/data handling is explicitly acceptable.

### Phase 1 — versioned store and crypto primitive

Deliverables:

- envelope and payload TypeScript types plus strict runtime validation;
- scrypt + AES-256-GCM + gzip encrypt/decrypt helpers;
- bounded parsing/decompression and stable error classes;
- in-memory tests with no real data.

Exit criteria:

- correct passphrase round-trips;
- wrong passphrase, changed header, changed ciphertext, changed tag, truncation, unsupported version,
  excessive KDF parameters, and decompression overflow all fail closed;
- repeated encryption of identical bytes produces different ciphertext;
- no plaintext temp file is created.

### Phase 2 — complete capture and coverage reporting

Deliverables:

- live board-level capture command;
- domain seed capture from SQLite;
- structural validation and coverage report;
- optional versioned LAB-board augmentation;
- verify/inspect/diff commands.

Exit criteria:

- captured board issue count and unique keys match `listBoardIssues` exactly;
- all parent/link/sprint references needed by the app resolve or are reported;
- root records are not discarded merely because their Jira issue type is not named “Epic”;
- multiple epics survive one capture;
- the first candidate store can be decrypted and replayed without reading either legacy cache;
- searching tracked files for selected real-data canaries finds them only inside ciphertext, never as
  plaintext.

### Phase 3 — replay client and API integration

Deliverables:

- `jira-store` data source configuration;
- store loader and replay client;
- injection into startup, Jira routes, and sync route;
- explicit offline source/health state and outbound-link behavior.

Exit criteria:

- Connect, Boards, Epics, Recent tickets, Epic scope preview, Users, Sample, Ticket, and Sync routes
  work from the store;
- live and replay modes produce the same logical epic/root set from the same captured issues;
- a test that makes every external `fetch` throw still passes the offline API suite;
- no live credential is required or read in offline mode;
- route responses contain no store/password filesystem paths.

### Phase 4 — database bootstrap, identity, and reset

Deliverables:

- seed an empty DB from the canonical ECP seed;
- store ID/schema settings and mismatch checks;
- explicit snapshot/reset workflow;
- deterministic offline resync while preserving local intent.

Exit criteria:

- an empty DB reaches the expected team/epic/story/item/dependency/sprint counts;
- user edits to velocity, PTO, milestones, and placements survive offline sync;
- reset recreates the baseline after preserving the prior DB recoverably;
- a DB derived from store A cannot silently start against store B.

### Phase 5 — offline developer experience and documentation

Deliverables:

- `.env.offline.example` and one-command local start path;
- root README sections covering store creation, fidelity verification, exact-path staging/commit,
  replay setup, reset/cleanup, limitations, and troubleshooting;
- producer refresh, reviewer verify/diff, consumer start/reset, and cleanup runbooks, with all README
  commands executed in a clean walkthrough;
- repository-scoped `.agents/skills/offline-jira-store/SKILL.md` wrapping the checked-in workflow;
- UI/E2E coverage for source badge, disabled external links, missing password, and corrupt store;
- refresh checklist that starts with `nvm use` before Node/npm commands.

Exit criteria:

- a developer with existing dependencies can clone/copy the repo, receive the password separately,
  disable networking, and run the app without source changes;
- a producer unfamiliar with the implementation can follow only the README to create, verify, stage,
  and safely commit a refreshed ciphertext;
- a consumer unfamiliar with the implementation can follow only the README to create a working
  replay DB and validate the documented fidelity report;
- browser-level network monitoring observes only localhost requests;
- no hidden dependency on the producer's `.env`, DB, home directory, or Jira session remains.

### Phase 6 — air-gapped development kit

Deliverables:

- OS/architecture-specific archive builder;
- bundled/pinned runtime and native dependencies;
- checksums and clean-machine validation script;
- documented boundaries for supported platforms.

Exit criteria:

- the kit starts on a clean target machine with DNS and outbound networking disabled;
- source edits, frontend rebuild, backend restart, and the agreed test subset work offline;
- no install step reaches a registry, GitHub, CDN, or Jira.

## 13. Test matrix

| Layer | Required cases |
| --- | --- |
| Crypto | round-trip, random salt/IV, wrong password, tamper, truncation, header AAD, KDF bounds, size bounds |
| Schema | unknown version, missing catalog/board/issues, duplicate keys, broken parent/link refs, invalid seed |
| Capture | pagination, field allowlist, all-board equality, multi-epic, user dedupe, bounded avatar assets, no credentials, atomic replace |
| Replay client | every read method, projection, pagination, ordering, JQL clauses, board scoping, issue lookup, localhost avatars, read-only writes |
| Fidelity | canonical live-versus-replay contract, source-DB-versus-seed contract, avatar hashes, explicit allowed degradations |
| DB | empty seed, store ID, mismatch, reset backup, seed fallback, exact team/planning baseline, local-intent preservation after sync |
| API | health/source, all Jira setup routes, dataset, sync repeatability, typed failure responses |
| UI/E2E | realistic portfolio, setup wizard, ticket mapping, sync, local edits, offline badge, no outbound links |
| Leak checks | plaintext canaries absent from tracked files/logs/errors; password absent from process args/output |
| Handoff | clean OS/arch target, network disabled, install-free start, edit/rebuild/test subset |

Tests must use generated canary fixtures. Real decrypted data must never appear in snapshots, test
failure output, CI artifacts, or golden files.

## 14. Acceptance criteria

The feature is complete when:

1. exactly one encrypted fixture file is committed for the chosen captured board;
2. the passphrase and plaintext data are absent from Git history and documented to travel separately;
3. the committed store represents the full selected board rather than the final epic from the
   legacy cache;
4. an empty DB can be built from the store and a known baseline summary is verified;
5. all existing Jira-facing API flows use the replay client with the network disabled;
6. local planning changes persist in SQLite but never modify the committed store;
7. reset is explicit, recoverable, and deterministic;
8. corruption, wrong password, incompatible schema, and DB/store mismatch fail closed with useful
   errors;
9. optional generated issues are isolated on the LAB board and visibly marked;
10. `jira-store:verify` reports exact equality for every planner-consumed Jira field and every
    allowlisted ECP seed field, with any avatar fallback or exclusion named explicitly;
11. team members retain their captured display names, account mappings, capacity settings, and
    approved avatar appearance; tickets retain their captured keys, titles, status, hierarchy,
    estimates, assignees, labels, sprint membership, and dependency links;
12. the README alone is sufficient for a new producer to create/verify/commit a store and for a new
    consumer to configure/validate a replay environment;
13. the documented handoff level—runtime-only or full fresh-machine air gap—is demonstrated in the
    corresponding clean offline test.

## 15. Refresh and handoff runbook

### Producer, while Jira is reachable

1. Run `nvm use` from the repository root.
2. Sync the selected DB from Jira and confirm its board/mapping.
3. Run the encrypted capture command with the passphrase supplied from a file outside the repo.
4. Review the safe coverage report and structural diff against the committed store.
5. Verify the new store by decrypting and replaying it in memory.
6. Confirm the live-versus-replay, source-DB-versus-seed, and avatar fidelity checks pass or show only
   explicitly approved degradations.
7. Start offline mode with networking disabled and run the API/UI smoke suite.
8. Inspect `git status`, then stage the exact ciphertext path and intentional source/docs files only.
9. Commit only the ciphertext and intentional source/docs changes.
10. Deliver the passphrase separately; never paste it into a PR, issue, chat transcript, or commit.

### Consumer, with no Jira/network access

1. Obtain the repository or handoff kit and passphrase through separate channels.
2. Place the password file outside the repository and restrict its filesystem permissions.
3. Copy `.env.offline.example` to the gitignored local configuration and set the two paths.
4. Start offline mode; startup verifies the store before opening or seeding the DB.
5. Confirm verification reports `PASS`, locally inspect the encrypted fidelity summary, and spot-check
   the team roster/avatars, representative ticket details, and baseline DB counts it reports. The
   tracked README uses placeholders and must not publish those real snapshot values.
6. Iterate normally against localhost.
7. Use the reset command to return to baseline; use the DB snapshot flow to preserve experiments.
8. Remove the working DB, snapshots, local env file, and password file when the handoff ends.

## 16. Recommended defaults and decisions to record before implementation

| Decision | Recommended default |
| --- | --- |
| Captured scope | every issue returned by the selected board |
| Captured fields | strict application allowlist; no descriptions/comments/attachments/worklogs |
| People | real display names/account IDs; preserve returned email only when approved/used; embed bounded avatar thumbnails and serve locally |
| Local planning intent | include canonical `DomainDataset` from the synchronized DB |
| Augmentation | off by default; optional separate deterministic LAB board |
| Encryption | scrypt + AES-256-GCM using Node built-ins |
| Secret input | password file outside repo |
| Runtime mutation | writable gitignored SQLite only; store remains immutable |
| First delivery | no-network runtime for developers with dependencies already installed |
| Strong delivery | platform-specific air-gapped development kit |
| Refresh cadence | intentional/manual, with verify + structural diff before commit |

The implementation should not begin committing real ciphertext until the repository audience,
field allowlist, passphrase owner, and required air-gapped target platforms have been recorded.

## 17. References

- [Node.js `node:crypto` documentation](https://nodejs.org/api/crypto.html) for `scrypt`, random IVs,
  authenticated encryption, AAD, and authentication tags.
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
  for current scrypt work-factor guidance.
- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
  for cryptographic storage and key-management considerations.
