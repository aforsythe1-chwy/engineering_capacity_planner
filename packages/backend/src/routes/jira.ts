/**
 * Jira introspection endpoint (project plan §7). Powers the Configuration tab's
 * live field mapper: it fetches the field catalog, the issue-link types, and a
 * real sample issue from the target board so the user can *point at* the field
 * that holds story points / the sprint / labels rather than typing an opaque
 * `customfield_*` id. The app records the canonical id and uses it thereafter.
 */
import type { Setting } from '@ecp/shared';
import { isBlocksLinkType, parseJiraTicketKey, SETTING_KEYS } from '@ecp/shared';
import type { FastifyInstance } from 'fastify';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/database.js';
import { readDataset } from '../db/persist.js';
import { HttpError } from '../http-error.js';
import { buildJiraClient } from '../importer/factory.js';
import type { JiraClient } from '../jira/client.js';
import { pickAvatarUrl } from '../jira/mapper.js';
import type { JiraIssue } from '../jira/types.js';
import type { JiraRequestCache } from '../jira/request-cache.js';

/** Read a global string setting (JSON-decoded), or null. */
function settingStr(settings: Setting[], key: string): string | null {
  const row = settings.find((s) => s.scope === 'global' && s.key === key);
  if (!row) return null;
  try {
    const v = JSON.parse(row.value);
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  } catch {
    return null;
  }
}

/** Jira returns sprint fields as objects, arrays, or legacy strings. */
function belongsToSprint(raw: unknown, sprintId: number): boolean {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return values.some((value) => {
    if (typeof value === 'object' && value !== null) return String((value as { id?: unknown }).id) === String(sprintId);
    return typeof value === 'string' && new RegExp(`(?:id=|"id"\\s*:\\s*)${sprintId}(?:[\\],}]|$)`).test(value);
  });
}

/**
 * Choose an issue to show as the mapping sample. Prefer a work item under the
 * epic (that's where story points carry a value); fall back to any project
 * issue.
 */
async function pickSample(
  client: JiraClient,
  projectKey: string,
  epicKey: string | null,
): Promise<string | null> {
  // Fall back to the project's first epic when none is pinned, so we can still
  // drill to a work item (that's where story points carry a value).
  let epic = epicKey;
  if (!epic) {
    const epics = await client.searchJql({
      jql: `project = "${projectKey}" AND issuetype = Epic ORDER BY created ASC`,
      fields: ['summary'],
      maxResults: 1,
    });
    epic = epics.issues[0]?.key ?? null;
  }
  if (epic) {
    const stories = await client.searchJql({ jql: `parent = "${epic}"`, fields: ['summary'], maxResults: 1 });
    const story = stories.issues[0]?.key;
    if (story) {
      const work = await client.searchJql({ jql: `parent = "${story}"`, fields: ['summary'], maxResults: 1 });
      if (work.issues[0]) return work.issues[0].key;
      return story;
    }
    return epic;
  }
  const any = await client.searchJql({
    jql: `project = "${projectKey}" ORDER BY created DESC`,
    fields: ['summary'],
    maxResults: 1,
  });
  return any.issues[0]?.key ?? null;
}

export interface JiraSampleResponse {
  projectKey: string;
  sampleKey: string | null;
  /** The sample issue's full fields, for the field picker. */
  fields: Record<string, unknown> | null;
  /** Field catalog: canonical id → human name + value type. */
  catalog: Array<{ id: string; name: string; custom: boolean; type: string | null }>;
  linkTypes: Array<{ id: string; name: string; inward: string; outward: string }>;
}

export interface JiraFieldRef {
  id: string;
  name: string;
  custom: boolean;
  type: string | null;
}

/**
 * How the target ticket represents its "blocks / is blocked by" relationships.
 * In stock Jira this is the native `Blocks` issue-link type — there's nothing to
 * map, so the UI can auto-confirm it and tell the user. If a team modeled
 * blocking through a *custom field* instead, {@link customFieldCandidate}
 * surfaces it so it can be mapped like story points.
 */
export interface JiraBlocksAnalysis {
  /** The link type name that expresses blocking, auto-detected, or null. */
  linkType: string | null;
  /** True when blocking is Jira's native issue-link mechanism (the common case). */
  isNativeLink: boolean;
  /** Keys this ticket is blocked by, per its issue links. */
  blockedBy: string[];
  /** Keys this ticket blocks, per its issue links. */
  blocking: string[];
  /** A custom field on this ticket whose name mentions "block", if any. */
  customFieldCandidate: JiraFieldRef | null;
}

export interface JiraTicketResponse {
  /** Normalized key we resolved from the user's input. */
  key: string;
  summary: string | null;
  status: string | null;
  issueType: string | null;
  /** The issue's full fields, so the picker can preview values. */
  fields: Record<string, unknown>;
  catalog: JiraFieldRef[];
  /** Custom fields currently holding a finite number — story-point candidates. */
  numericFields: Array<JiraFieldRef & { value: number }>;
  linkTypes: Array<{ id: string; name: string; inward: string; outward: string }>;
  blocks: JiraBlocksAnalysis;
}

/** Case-insensitive substring match, tolerant of an empty query (matches all). */
function matches(haystack: string, q: string | undefined): boolean {
  const needle = (q ?? '').trim().toLowerCase();
  return needle === '' || haystack.toLowerCase().includes(needle);
}

export function registerJiraRoutes(
  app: FastifyInstance,
  db: Db,
  config: AppConfig,
  jiraClient?: JiraClient,
  jiraCache?: JiraRequestCache,
): void {
  /** Build the client or throw a 400 the wizard can render. */
  const client = (): JiraClient => {
    try {
      return buildJiraClient(config.jira, jiraClient);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
  };
  app.get('/api/jira/cache/events', async () => ({ enabled: jiraCache?.enabled ?? false, events: jiraCache?.snapshot() ?? [] }));
  app.post('/api/jira/cache/refresh', async () => { jiraCache?.clear(); return { cleared: Boolean(jiraCache) }; });

  /** Resolve the project key from the query, persisted settings, or env. */
  const resolveProject = (query?: string): string | null => {
    const settings = readDataset(db).settings;
    return (
      query?.trim() ||
      settingStr(settings, SETTING_KEYS.JIRA_PROJECT_KEY) ||
      config.jira.projectKey ||
      null
    );
  };

  const discoveryPath = () => config.dbPath === ':memory:' ? null : resolve(dirname(resolve(config.dbPath)), 'cache', 'jira-board-discovery.json');
  const readDiscovery = () => {
    const path = discoveryPath();
    if (!path || !existsSync(path)) throw new HttpError(404, 'No board discovery cache exists yet. Refresh it first.');
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  };

  app.get('/api/jira/board-discovery', async () => readDiscovery());
  app.post('/api/jira/board-discovery', async () => {
    const settings = readDataset(db).settings;
    const projectKey = resolveProject();
    if (!projectKey) throw new HttpError(400, 'Select a board first.');
    const configuredBoard = settingStr(settings, SETTING_KEYS.JIRA_BOARD_ID);
    const boardId = configuredBoard && /^\d+$/.test(configuredBoard) ? Number(configuredBoard) : (await client().listBoards(projectKey))[0]?.id;
    if (boardId == null) throw new HttpError(400, `No Agile board found for project ${projectKey}.`);
    const sprintField = settingStr(settings, SETTING_KEYS.JIRA_SPRINT_FIELD);
    const pointsField = settingStr(settings, SETTING_KEYS.JIRA_STORY_POINTS_FIELD);
    const issues = await client().listBoardIssues(boardId, [...new Set(['summary', 'status', 'parent', 'issuetype', 'assignee', 'issuelinks', ...(sprintField ? [sprintField] : []), ...(pointsField ? [pointsField] : [])])]);
    const countBy = (values: JiraIssue[], value: (issue: JiraIssue) => string) => Object.fromEntries([...values.reduce((counts, issue) => counts.set(value(issue), (counts.get(value(issue)) ?? 0) + 1), new Map<string, number>()).entries()].sort(([a], [b]) => a.localeCompare(b)));
    const roots = issues.filter((issue) => !issue.fields.parent);
    const snapshot = {
      version: 1,
      cachedAt: new Date().toISOString(),
      projectKey,
      boardId,
      summary: { issueCount: issues.length, issueTypes: countBy(issues, (issue) => issue.fields.issuetype?.name ?? 'Unknown'), rootIssueTypes: countBy(roots, (issue) => issue.fields.issuetype?.name ?? 'Unknown'), issuesWithParent: issues.length - roots.length },
      issues,
    };
    const path = discoveryPath();
    if (path) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`); }
    return { ...snapshot, issues: undefined, cachePath: path };
  });

  // --- Connection status (setup wizard "Connect" step) ---------------------
  // Reports whether the configured credentials actually reach Jira, plus who
  // we're authenticated as. Never returns the token.
  app.get('/api/jira/connection', async () => {
    let c: JiraClient;
    try {
      c = buildJiraClient(config.jira, jiraClient);
    } catch (err) {
      return {
        connected: false,
        baseUrl: config.jira.baseUrl,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    try {
      const me = await c.getCurrentUser();
      return {
        connected: true,
        baseUrl: config.jira.baseUrl,
        displayName: me.displayName,
        email: me.emailAddress ?? config.jira.email,
        accountId: me.accountId,
      };
    } catch (err) {
      return {
        connected: false,
        baseUrl: config.jira.baseUrl,
        error: `Jira request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });

  // --- Board typeahead -----------------------------------------------------
  app.get('/api/jira/boards', async (req) => {
    const q = (req.query ?? {}) as { q?: string };
    try {
      const query = (q.q ?? '').trim();
      const boards = await client().listBoards(undefined, query);
      return {
        boards: boards
          .filter((b) => matches(b.name, query))
          .slice(0, 25)
          .map((b) => ({ id: b.id, name: b.name, type: b.type, projectKey: b.location?.projectKey ?? null })),
      };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Jira request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // --- Epic typeahead (scoped to the selected/persisted project) -----------
  app.get('/api/jira/epics', async (req) => {
    const q = (req.query ?? {}) as { q?: string; project?: string };
    const projectKey = resolveProject(q.project);
    if (!projectKey) throw new HttpError(400, 'Select a board or set a project key first.');
    try {
      // The narrow fake JQL dialect has no `~`, so fetch epics and filter here;
      // real Jira returns a bounded set per project too.
      const res = await client().searchJql({
        jql: `project = "${projectKey}" AND issuetype = Epic ORDER BY created DESC`,
        fields: ['summary'],
        maxResults: 100,
      });
      const epics = res.issues
        .map((i) => ({ key: i.key, summary: (i.fields.summary as string | undefined) ?? i.key }))
        .filter((e) => matches(e.key, q.q) || matches(e.summary, q.q))
        .slice(0, 25);
      return { projectKey, epics };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Jira request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // --- Recent board tickets for ticket-driven field mapping ----------------
  app.get('/api/jira/recent-tickets', async (req) => {
    const q = (req.query ?? {}) as { project?: string; limit?: string };
    const projectKey = resolveProject(q.project);
    if (!projectKey) throw new HttpError(400, 'Select a board or set a project key first.');
    const parsedLimit = Number(q.limit ?? 8);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(Math.floor(parsedLimit), 20)) : 8;
    try {
      // Updated DESC is deliberate: this is a familiar, useful mapping sample,
      // rather than an arbitrary ticket from the project.
      const result = await client().searchJql({
        jql: `project = "${projectKey}" ORDER BY updated DESC`,
        fields: ['summary', 'status', 'issuetype', 'updated'],
        maxResults: limit * 3,
      });
      const tickets = result.issues
        .filter((issue) => issue.fields.issuetype?.name !== 'Epic')
        .slice(0, limit)
        .map((issue) => ({
          key: issue.key,
          summary: (issue.fields.summary as string | undefined) ?? issue.key,
          status: issue.fields.status?.name ?? 'Unknown',
          issueType: issue.fields.issuetype?.name ?? 'Issue',
          updated: typeof issue.fields.updated === 'string' ? issue.fields.updated : null,
        }));
      return { projectKey, tickets };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Jira request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // --- Current-sprint assignees, offered as roster suggestions -------------
  app.get('/api/jira/current-sprint-assignees', async (req) => {
    const settings = readDataset(db).settings;
    const projectKey = resolveProject();
    if (!projectKey) throw new HttpError(400, 'Select a board first to find current-sprint assignees.');
    const sprintField = settingStr(settings, SETTING_KEYS.JIRA_SPRINT_FIELD);
    if (!sprintField) return { currentSprint: null, users: [], reason: 'Map the Sprint field first to find current-sprint assignees.' };
    try {
      const configuredBoard = settingStr(settings, SETTING_KEYS.JIRA_BOARD_ID);
      const boardId = configuredBoard && /^\d+$/.test(configuredBoard)
        ? Number(configuredBoard)
        : (await client().listBoards(projectKey))[0]?.id;
      if (boardId == null) throw new HttpError(400, `No Agile board found for project ${projectKey}.`);
      const activeSprint = (await client().listSprints(boardId)).find((sprint) => sprint.state === 'active');
      if (!activeSprint) return { currentSprint: null, users: [], reason: 'This board has no active sprint.' };
      const issues = await client().listBoardIssues(boardId, ['assignee', sprintField]);
      const counts = new Map<string, { accountId: string; displayName: string; avatarUrl: string | null; ticketCount: number }>();
      for (const issue of issues) {
        const assignee = issue.fields.assignee;
        if (!assignee || !belongsToSprint(issue.fields[sprintField], activeSprint.id)) continue;
        const current = counts.get(assignee.accountId);
        if (current) current.ticketCount += 1;
        else counts.set(assignee.accountId, { accountId: assignee.accountId, displayName: assignee.displayName, avatarUrl: pickAvatarUrl(assignee), ticketCount: 1 });
      }
      return {
        currentSprint: { id: activeSprint.id, name: activeSprint.name },
        users: [...counts.values()].sort((a, b) => b.ticketCount - a.ticketCount || a.displayName.localeCompare(b.displayName)),
        reason: null,
      };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Jira request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // --- Active portfolio preview -------------------------------------------
  app.get('/api/jira/epic-scope/preview', async (req) => {
    const q = (req.query ?? {}) as { project?: string };
    const projectKey = resolveProject(q.project);
    if (!projectKey) throw new HttpError(400, 'Select a board or set a project key first.');
    const dataset = readDataset(db);
    const pointsField = settingStr(dataset.settings, SETTING_KEYS.JIRA_STORY_POINTS_FIELD)
      ?? config.jira.storyPointsField;
    try {
      const configuredBoardId = settingStr(dataset.settings, SETTING_KEYS.JIRA_BOARD_ID);
      const boardId = configuredBoardId && /^\d+$/.test(configuredBoardId)
        ? Number(configuredBoardId)
        : (await client().listBoards(projectKey))[0]?.id;
      if (boardId == null) throw new HttpError(400, `No Agile board found for project ${projectKey}.`);
      const boardIssues = await client().listBoardIssues(boardId, [
        'summary', 'status', 'parent', 'issuetype', ...(pointsField ? [pointsField] : []),
      ]);
      const countBy = (issues: JiraIssue[], value: (issue: JiraIssue) => string) =>
        Object.fromEntries([...issues.reduce((counts, issue) => counts.set(value(issue), (counts.get(value(issue)) ?? 0) + 1), new Map<string, number>()).entries()].sort(([a], [b]) => a.localeCompare(b)));
      const jiraEpics = boardIssues.filter((issue) => issue.fields.issuetype?.name === 'Epic');
      const referencedEpics = new Map<string, JiraIssue>();
      for (const issue of boardIssues) {
        const parent = issue.fields.parent as (JiraIssue['fields']['parent'] & { id?: string; fields?: JiraIssue['fields'] }) | null | undefined;
        if (!parent?.key || parent.fields?.issuetype?.name !== 'Epic') continue;
        referencedEpics.set(parent.key, { id: parent.id ?? parent.key, key: parent.key, fields: parent.fields });
      }
      // Boards may use Feature, Initiative, or another parentless type as the
      // planning root. Use it when Jira Epics are absent rather than hiding it.
      const rootCandidates = jiraEpics.length > 0
        ? jiraEpics.map((epic) => ({ epic, directChildrenAreWork: false }))
        : referencedEpics.size > 0
          ? [...referencedEpics.values()].map((epic) => ({ epic, directChildrenAreWork: true }))
          : boardIssues.filter((issue) => !issue.fields.parent).map((epic) => ({ epic, directChildrenAreWork: false }));
      const rootSelection = jiraEpics.length > 0 ? 'jira-epic' : referencedEpics.size > 0 ? 'referenced-jira-epic' : 'parentless-board-root';
      const previews = rootCandidates.map(({ epic, directChildrenAreWork }) => {
        const directChildren = boardIssues.filter((issue) => issue.fields.parent?.key === epic.key);
        const storyKeys = new Set(directChildren.map((issue) => issue.key));
        const nestedWork = boardIssues.filter((issue) => issue.fields.parent?.key && storyKeys.has(issue.fields.parent.key));
        const work = directChildrenAreWork ? directChildren : nestedWork.length > 0 ? nestedWork : directChildren;
        const remaining = work.filter((item) => item.fields.status?.statusCategory?.key !== 'done');
        const estimated = remaining.map((item) => pointsField ? item.fields[pointsField] : null);
        const intent = dataset.portfolioEpics?.find((row) => row.epicKey === epic.key);
        return {
          key: epic.key,
          summary: (epic.fields.summary as string | undefined) ?? epic.key,
          status: epic.fields.status?.name ?? 'Unknown',
          statusCategory: epic.fields.status?.statusCategory?.key ?? null,
          remainingItems: remaining.length,
          remainingPoints: estimated.reduce<number>((sum, raw) => {
            const value = typeof raw === 'number' ? raw : Number(raw);
            return sum + (Number.isFinite(value) ? value : 0);
          }, 0),
          unestimatedItems: estimated.filter((raw) => raw == null || raw === '' || !Number.isFinite(Number(raw))).length,
          scopeOverride: intent?.scopeOverride ?? 'auto',
          planningKind: intent?.planningKind ?? 'timeline',
          exclusion: epic.fields.status?.statusCategory?.key === 'done' ? 'root-done'
            : storyKeys.size === 0 ? 'no-direct-children'
              : work.length === 0 ? 'no-work-items'
                : remaining.length === 0 ? 'all-work-done' : null,
        };
      });
      const active = previews.filter((epic) =>
        epic.scopeOverride === 'include' ||
        (epic.scopeOverride !== 'exclude' && epic.statusCategory !== 'done' && epic.remainingItems > 0),
      );
      const activeKeys = new Set(active.map((epic) => epic.key));
      const archived = dataset.epics
        .filter((epic) => epic.active !== false && !activeKeys.has(epic.key))
        .map((epic) => ({ key: epic.key, summary: epic.title }));
      const exclusionCounts = previews.reduce((counts, preview) => {
        const reason = preview.exclusion ?? 'included'; counts[reason] = (counts[reason] ?? 0) + 1; return counts;
      }, {} as Record<string, number>);
      return {
        projectKey,
        epics: active.map(({ statusCategory: _statusCategory, exclusion: _exclusion, ...epic }) => epic),
        candidates: previews.map((epic) => ({ ...epic, tracked: epic.scopeOverride === 'include' || (epic.scopeOverride !== 'exclude' && epic.statusCategory !== 'done' && epic.remainingItems > 0) })),
        archived,
        diagnostics: {
          boardId,
          boardIssueCount: boardIssues.length,
          rootSelection,
          jiraEpicCount: jiraEpics.length,
          referencedJiraEpicCount: referencedEpics.size,
          rootCandidateCount: rootCandidates.length,
          issueTypes: countBy(boardIssues, (issue) => issue.fields.issuetype?.name ?? 'Unknown'),
          rootIssueTypes: countBy(boardIssues.filter((issue) => !issue.fields.parent), (issue) => issue.fields.issuetype?.name ?? 'Unknown'),
          exclusionCounts,
        },
      };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Jira request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // --- People-picker (member search + link) --------------------------------
  app.get('/api/jira/users', async (req) => {
    const q = (req.query ?? {}) as { q?: string };
    try {
      const users = await client().searchUsers((q.q ?? '').trim());
      return {
        users: users.slice(0, 20).map((u) => ({
          accountId: u.accountId,
          displayName: u.displayName,
          email: u.emailAddress ?? null,
          avatarUrl: pickAvatarUrl(u),
        })),
      };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Jira request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  app.get('/api/jira/sample', async (req): Promise<JiraSampleResponse> => {
    const q = (req.query ?? {}) as { project?: string; epic?: string };
    const settings = readDataset(db).settings;
    const projectKey =
      q.project?.trim() || settingStr(settings, SETTING_KEYS.JIRA_PROJECT_KEY) || config.jira.projectKey;
    if (!projectKey) {
      throw new HttpError(400, 'Set a Jira project key to load a sample.');
    }
    const epicKey = q.epic?.trim() || settingStr(settings, SETTING_KEYS.JIRA_EPIC_KEY);

    let client: JiraClient;
    try {
      client = buildJiraClient(config.jira, jiraClient);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }

    try {
      const [catalog, linkTypes] = await Promise.all([
        client.listFields(),
        client.listIssueLinkTypes(),
      ]);
      const sampleKey = await pickSample(client, projectKey, epicKey);
      const fields = sampleKey ? (await client.getIssue(sampleKey, ['*all'])).fields : null;
      return {
        projectKey,
        sampleKey,
        fields: fields as Record<string, unknown> | null,
        catalog: catalog.map((c) => ({ id: c.id, name: c.name, custom: c.custom, type: c.schema?.type ?? null })),
        linkTypes: linkTypes.map((t) => ({ id: t.id, name: t.name, inward: t.inward, outward: t.outward })),
      };
    } catch (err) {
      throw new HttpError(502, `Jira request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // --- Ticket-driven field mapping (project plan §7) -----------------------
  // Fetch one specific ticket (by key or browse URL) so the user maps fields
  // from a real, familiar issue instead of a random sample. Also analyzes how
  // that ticket represents blocking, so the UI can auto-confirm the native link
  // type (and omit the manual step) or surface a custom field when one is used.
  app.get('/api/jira/ticket', async (req): Promise<JiraTicketResponse> => {
    const q = (req.query ?? {}) as { ref?: string };
    const raw = (q.ref ?? '').trim();
    if (raw === '') throw new HttpError(400, 'Enter a Jira ticket number or URL.');
    const key = parseJiraTicketKey(raw);
    if (!key) {
      throw new HttpError(400, `“${raw}” doesn’t look like a Jira ticket. Try a key like CKT-42 or a browse URL.`);
    }

    let jira: JiraClient;
    try {
      jira = buildJiraClient(config.jira, jiraClient);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }

    let issue;
    let catalog;
    let linkTypes;
    try {
      [catalog, linkTypes] = await Promise.all([jira.listFields(), jira.listIssueLinkTypes()]);
      issue = await jira.getIssue(key, ['*all']);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A missing issue is the user's typo to fix, not a server fault.
      if (/not found|does not exist|404/i.test(message)) {
        throw new HttpError(404, `Ticket ${key} was not found in Jira.`);
      }
      throw new HttpError(502, `Jira request failed: ${message}`);
    }

    const fields = (issue.fields ?? {}) as Record<string, unknown>;
    const catalogRefs: JiraFieldRef[] = catalog.map((c) => ({
      id: c.id,
      name: c.name,
      custom: c.custom,
      type: c.schema?.type ?? null,
    }));

    // Custom fields that currently hold a finite number are story-point candidates.
    const numericFields = catalogRefs
      .filter((c) => c.custom)
      .map((c) => ({ ...c, value: fields[c.id] }))
      .filter((c): c is JiraFieldRef & { value: number } => typeof c.value === 'number' && Number.isFinite(c.value));

    // Blocking analysis: prefer a link type actually present on this ticket;
    // otherwise fall back to the catalog's blocks-semantic type.
    const links = Array.isArray(issue.fields.issuelinks) ? issue.fields.issuelinks : [];
    const blockedBy: string[] = [];
    const blocking: string[] = [];
    let presentBlocksType: string | null = null;
    for (const link of links) {
      if (!isBlocksLinkType(link.type)) continue;
      presentBlocksType = link.type.name;
      if (link.inwardIssue?.key) blockedBy.push(link.inwardIssue.key);
      if (link.outwardIssue?.key) blocking.push(link.outwardIssue.key);
    }
    const catalogBlocksType = linkTypes.find((t) => isBlocksLinkType(t))?.name ?? null;
    const customFieldCandidate =
      catalogRefs.find((c) => c.custom && /block/i.test(c.name) && fields[c.id] != null) ?? null;

    return {
      key: issue.key,
      summary: (issue.fields.summary as string | undefined) ?? null,
      status: issue.fields.status?.name ?? null,
      issueType: issue.fields.issuetype?.name ?? null,
      fields,
      catalog: catalogRefs,
      numericFields,
      linkTypes: linkTypes.map((t) => ({ id: t.id, name: t.name, inward: t.inward, outward: t.outward })),
      blocks: {
        linkType: presentBlocksType ?? catalogBlocksType,
        isNativeLink: (presentBlocksType ?? catalogBlocksType) !== null,
        blockedBy,
        blocking,
        customFieldCandidate,
      },
    };
  });
}
