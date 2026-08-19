import type { DomainDataset, Importer, SyncSnapshot } from '@ecp/shared';
import { formatIso } from '@ecp/shared';
import type { JiraClient } from '../jira/client.js';
import { datasetFromJira } from '../jira/mapper.js';
import type { JiraMapping } from '../jira/mapping.js';
import { MappingError } from '../jira/mapping.js';
import {
  JIRA_SYNC_CACHE_VERSION,
  writeSyncCache,
  type JiraSyncCache,
} from '../jira/sync-cache.js';
import type { JiraIssue, JiraSprint } from '../jira/types.js';

/** Anchor used only when no imported sprint carries a start date. */
const DEFAULT_FALLBACK_ANCHOR = '2026-01-06';

/**
 * An Agile board filter commonly returns an issue's parent reference without
 * returning that parent as a board issue. NF is one such board: its Epics are
 * represented in `fields.parent` on the board's Stories/Bugs/Tasks. Promote
 * those embedded references into import roots instead of mistaking unrelated
 * parentless records for epics.
 */
function embeddedEpicRoots(boardIssues: JiraIssue[]): JiraIssue[] {
  const roots = new Map<string, JiraIssue>();
  for (const issue of boardIssues) {
    const parent = issue.fields.parent as (JiraIssue['fields']['parent'] & { id?: string; fields?: JiraIssue['fields'] }) | null | undefined;
    if (!parent?.key || parent.fields?.issuetype?.name !== 'Epic') continue;
    roots.set(parent.key, {
      id: parent.id ?? parent.key,
      key: parent.key,
      fields: parent.fields,
    });
  }
  return [...roots.values()];
}

/** Label field ids requested for any issue layer that can feed Gantt lanes. */
function labelFields(mapping: JiraMapping): string[] {
  const fields = ['labels'];
  if (mapping.labelsField !== 'labels') fields.push(mapping.labelsField);
  return [...new Set(fields)];
}

/** Issue `fields` requested for the parent story layer. */
function storyFields(mapping: JiraMapping): string[] {
  return [...new Set(['summary', 'parent', ...labelFields(mapping)])];
}

/** Issue `fields` requested for the work-item layer. */
function workItemFields(mapping: JiraMapping): string[] {
  const fields = ['summary', 'status', 'assignee', 'parent', 'issuetype', 'issuelinks'];
  fields.push(mapping.storyPointsField, ...labelFields(mapping));
  if (mapping.sprintField) fields.push(mapping.sprintField);
  return [...new Set(fields)];
}

/**
 * Jira data source (project plan §7). Implements the same {@link Importer}
 * contract the engine, timeline, and graph already consume, so swapping the
 * synthetic source for Jira changes nothing downstream.
 *
 * It orchestrates the {@link JiraClient} (real HTTP or the in-memory fake) to
 * pull one epic's subtree + the board's sprints, then hands the raw issues to
 * the pure {@link datasetFromJira} mapper. Hierarchy is read by **parent-chain
 * depth** (epic → children = stories → their children = work items) rather than
 * by issue-type names, so it works across team- and company-managed projects.
 *
 * After a successful fetch it optionally dumps the raw payload to a local
 * sync-cache file (gitignored under `./data/cache/`) for offline replay and
 * obfuscated fixture export.
 */
export class JiraImporter implements Importer {
  readonly name = 'jira';
  private readonly fallbackAnchorDate: string;
  private readonly cachePath: string | null;
  private lastCache: JiraSyncCache | null = null;

  constructor(
    private readonly client: JiraClient,
    private readonly mapping: JiraMapping,
    options: { fallbackAnchorDate?: string; cachePath?: string | null } = {},
  ) {
    this.fallbackAnchorDate = options.fallbackAnchorDate ?? DEFAULT_FALLBACK_ANCHOR;
    this.cachePath = options.cachePath ?? null;
  }

  /** Follow `nextPageToken` until the last page, collecting every issue. */
  private async searchAll(jql: string, fields: string[]): Promise<JiraIssue[]> {
    const all: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    do {
      const page = await this.client.searchJql({ jql, fields, maxResults: 100, nextPageToken });
      all.push(...page.issues);
      nextPageToken = page.isLast ? undefined : page.nextPageToken;
    } while (nextPageToken);
    return all;
  }

  private async resolveEpicKeys(): Promise<string[]> {
    if (this.mapping.epicScopeMode === 'single' && this.mapping.epicKey) return [this.mapping.epicKey];
    let epics = await this.searchAll(
      `project = "${this.mapping.projectKey}" AND issuetype = Epic ORDER BY created ASC`,
      ['summary', 'status'],
    );
    // Older cache fixtures may not include issue-type fields. Their root issue
    // is still discoverable as a project issue without a parent.
    if (epics.length === 0) {
      epics = (await this.searchAll(`project = "${this.mapping.projectKey}"`, ['summary', 'status', 'parent']))
        .filter((issue) => !issue.fields.parent);
    }
    if (epics.length === 0) {
      throw new MappingError(
        `No epic found in project "${this.mapping.projectKey}" — set an epic key in the Jira mapping.`,
      );
    }
    if (this.mapping.epicScopeMode === 'single') return [epics[0]!.key];
    return epics.filter((epic) => epic.fields.status?.statusCategory?.key !== 'done').map((epic) => epic.key);
  }

  private async resolveBoardId(): Promise<number | null> {
    let boardId = this.mapping.boardId;
    if (boardId == null) {
      const boards = await this.client.listBoards(this.mapping.projectKey);
      if (boards.length === 0) return null;
      boardId = boards[0]!.id;
    }
    return boardId;
  }

  async fetch(): Promise<DomainDataset> {
    // Compatibility for direct importer tooling. Full planner sync calls
    // fetchSyncSnapshot and persists only after its database transaction.
    const snapshot = await this.fetchSyncSnapshot();
    this.persistLastCache();
    return snapshot.dataset;
  }

  /** Called by SyncCoordinator only after the matching DB transaction commits. */
  persistLastCache(): void {
    if (this.cachePath && this.lastCache) writeSyncCache(this.cachePath, this.lastCache);
  }

  async fetchSyncSnapshot(): Promise<SyncSnapshot> {
    const boardId = await this.resolveBoardId();
    const sprints = boardId == null ? [] : await this.client.listSprints(boardId);
    const datasets: DomainDataset[] = [];
    const rawEpics: NonNullable<JiraSyncCache['epics']> = [];
    let observedEpicKeys: string[] = [];
    if (this.mapping.epicScopeMode === 'active' && boardId != null) {
      const boardIssues = await this.client.listBoardIssues(boardId, [
        ...new Set(['summary', 'status', 'parent', 'issuetype', 'assignee', 'issuelinks', ...storyFields(this.mapping), ...workItemFields(this.mapping)]),
      ]);
      const jiraEpics = boardIssues.filter((issue) => issue.fields.issuetype?.name === 'Epic');
      const referencedEpics = embeddedEpicRoots(boardIssues);
      const roots = jiraEpics.length > 0
        ? jiraEpics.map((epicIssue) => ({ epicIssue, directChildrenAreWork: false }))
        : referencedEpics.length > 0
          ? referencedEpics.map((epicIssue) => ({ epicIssue, directChildrenAreWork: true }))
          : boardIssues.filter((issue) => !issue.fields.parent).map((epicIssue) => ({ epicIssue, directChildrenAreWork: false }));
      observedEpicKeys = roots.map(({ epicIssue }) => epicIssue.key);
      for (const { epicIssue, directChildrenAreWork } of roots) {
        if (epicIssue.fields.status?.statusCategory?.key === 'done') continue;
        const directChildren = boardIssues.filter((issue) => issue.fields.parent?.key === epicIssue.key);
        const childKeys = new Set(directChildren.map((story) => story.key));
        const nestedWork = boardIssues.filter((issue) => issue.fields.parent?.key && childKeys.has(issue.fields.parent.key));
        // NF-style boards may attach deliverable work directly to the planning
        // root. In that two-level shape, map direct children as work items and
        // let the mapper create its explicit "Ungrouped" story container.
        const [storyIssues, workIssues] = directChildrenAreWork
          ? [[], directChildren]
          : nestedWork.length > 0
          ? [directChildren, nestedWork]
          : [[], directChildren];
        if (!workIssues.some((issue) => issue.fields.status?.statusCategory?.key !== 'done')) continue;
        rawEpics.push({ epicIssue, storyIssues, workIssues });
        datasets.push(datasetFromJira({ epicIssue, storyIssues, workIssues, sprints, mapping: this.mapping, fallbackAnchorDate: this.fallbackAnchorDate, placementDate: formatIso(new Date()) }));
      }
    } else {
      const epicKeys = await this.resolveEpicKeys();
      observedEpicKeys = epicKeys;
      for (const epicKey of epicKeys) {
        const epicIssue = await this.client.getIssue(epicKey, ['summary', 'status']);
        const storyIssues = await this.searchAll(`parent = "${epicKey}"`, [...new Set([...storyFields(this.mapping), ...workItemFields(this.mapping)])]);
        const inList = storyIssues.map((s) => `"${s.key}"`).join(', ');
        const nestedWork = inList ? await this.searchAll(`parent in (${inList})`, workItemFields(this.mapping)) : [];
        const [hierarchyStories, workIssues] = nestedWork.length > 0 ? [storyIssues, nestedWork] : [[], storyIssues];
        rawEpics.push({ epicIssue, storyIssues: hierarchyStories, workIssues });
        datasets.push(datasetFromJira({ epicIssue, storyIssues: hierarchyStories, workIssues, sprints, mapping: this.mapping, fallbackAnchorDate: this.fallbackAnchorDate, placementDate: formatIso(new Date()) }));
      }
    }
    const first = datasets[0];
    const dedupe = <T extends { key?: string; id?: string }>(values: T[]) => [...new Map(values.map((v) => [v.key ?? v.id!, v])).values()];
    const dataset: DomainDataset = first
      ? { ...first, members: dedupe(datasets.flatMap((d) => d.members)), epics: datasets.flatMap((d) => d.epics), stories: datasets.flatMap((d) => d.stories), workItems: datasets.flatMap((d) => d.workItems), dependencies: dedupe(datasets.flatMap((d) => d.dependencies)), placements: datasets.flatMap((d) => d.placements) }
      : { teams: [], members: [], velocityOverrides: [], pto: [], oncall: [], epics: [], milestones: [], stories: [], workItems: [], dependencies: [], sprints: [], placements: [], settings: [] };
    if (rawEpics.length) {
      const firstRaw = rawEpics[0]!;
      this.lastCache = { version: JIRA_SYNC_CACHE_VERSION, cachedAt: new Date().toISOString(), mapping: this.mapping, ...firstRaw, sprints, epics: rawEpics };
    } else {
      this.lastCache = null;
    }
    return {
      dataset,
      source: 'jira',
      scope: {
        kind: this.mapping.epicScopeMode === 'single' ? 'complete-single-epic' : 'complete-board',
        projectKey: this.mapping.projectKey,
        boardId: boardId == null ? null : String(boardId),
        observedEpicKeys,
        activeEpicKeys: dataset.epics.map((epic) => epic.key),
        complete: true,
      },
    };
  }
}
