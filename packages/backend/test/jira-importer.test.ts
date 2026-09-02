import { describe, expect, it } from 'vitest';
import { JiraImporter } from '../src/importer/jira.js';
import { FakeJiraClient } from '../src/jira/fake-client.js';
import type { JiraMapping } from '../src/jira/mapping.js';

const mapping: JiraMapping = {
  projectKey: 'CKT',
  epicKey: 'CKT-1',
  boardId: 1,
  storyPointsField: 'customfield_10016',
  sprintField: 'customfield_10020',
  labelsField: 'labels',
  blocksLinkType: 'Blocks',
  teamName: 'CKT (Jira)',
};

/** Stand up a small board in the fake and return the client. */
async function seedFake(): Promise<FakeJiraClient> {
  const jira = new FakeJiraClient();
  const epic = await jira.createIssue({
    fields: { project: { key: 'CKT' }, issuetype: { name: 'Epic' }, summary: 'Checkout Revamp' },
  });
  const story = await jira.createIssue({
    fields: {
      project: { key: 'CKT' },
      issuetype: { name: 'Story' },
      summary: 'Cart service',
      parent: { key: epic.key },
      labels: ['Parent Lane'],
    },
  });
  const a = await jira.createIssue({
    fields: {
      project: { key: 'CKT' }, issuetype: { name: 'Story' }, summary: 'Cart totals endpoint',
      parent: { key: story.key }, status: 'In Progress', labels: ['Cart'], customfield_10016: 5,
      assignee: { accountId: 'acc-ada', displayName: 'Ada' },
    },
  });
  const b = await jira.createIssue({
    fields: {
      project: { key: 'CKT' }, issuetype: { name: 'Story' }, summary: 'Tax calculation',
      parent: { key: story.key }, status: 'To Do', labels: ['Cart'], customfield_10016: 3,
      assignee: { accountId: 'acc-bjorn', displayName: 'Björn' },
    },
  });
  // a blocks b.
  await jira.createIssueLink({ type: 'Blocks', outwardKey: a.key, inwardKey: b.key });
  jira.setSprints(1, [
    { id: 21, name: 'Sprint 1', state: 'active', startDate: '2026-01-27T09:00:00.000+00:00', endDate: '2026-02-10T09:00:00.000+00:00' },
  ]);
  return jira;
}

describe('JiraImporter over the fake client', () => {
  it('imports one epic subtree into a self-consistent dataset', async () => {
    const jira = await seedFake();
    const ds = await new JiraImporter(jira, mapping).fetch();

    expect(ds.epics.map((e) => e.key)).toEqual(['CKT-1']);
    expect(ds.stories.map((s) => s.key)).toEqual(['CKT-2']);
    expect(ds.stories[0]?.labels).toEqual(['Parent Lane']);
    expect(ds.workItems.map((w) => w.key).sort()).toEqual(['CKT-3', 'CKT-4']);
    expect(ds.workItems.find((w) => w.key === 'CKT-3')).toMatchObject({ points: 5, status: 'In Progress', labels: ['Cart'] });
    expect(ds.dependencies).toEqual([
      { id: 'CKT-3__CKT-4', blockerItemKey: 'CKT-3', blockedItemKey: 'CKT-4' },
    ]);
    expect(ds.members.map((m) => m.name).sort()).toEqual(['Ada', 'Björn']);
    expect(ds.sprints).toEqual([
      { id: '21', teamId: 'team-jira-ckt', name: 'Sprint 1', startDate: '2026-01-27', endDate: '2026-02-09', state: 'active', goal: null, originBoardId: null },
    ]);
    // Referential integrity: every work item's story and assignee resolve.
    const storyKeys = new Set(ds.stories.map((s) => s.key));
    const memberIds = new Set(ds.members.map((m) => m.id));
    for (const w of ds.workItems) {
      expect(storyKeys.has(w.storyKey)).toBe(true);
      if (w.assigneeId) expect(memberIds.has(w.assigneeId)).toBe(true);
    }
  });

  it('auto-discovers the epic when none is pinned in the mapping', async () => {
    const jira = await seedFake();
    const ds = await new JiraImporter(jira, { ...mapping, epicKey: null }).fetch();
    expect(ds.epics.map((e) => e.key)).toEqual(['CKT-1']);
  });

  it('paginates search results via nextPageToken', async () => {
    const jira = new FakeJiraClient();
    const epic = await jira.createIssue({ fields: { project: { key: 'BIG' }, issuetype: { name: 'Epic' }, summary: 'Big' } });
    const story = await jira.createIssue({ fields: { project: { key: 'BIG' }, issuetype: { name: 'Story' }, summary: 'S', parent: { key: epic.key } } });
    for (let i = 0; i < 250; i++) {
      await jira.createIssue({
        fields: { project: { key: 'BIG' }, issuetype: { name: 'Story' }, summary: `w${i}`, parent: { key: story.key }, customfield_10016: 1 },
      });
    }
    const ds = await new JiraImporter(jira, { ...mapping, projectKey: 'BIG', epicKey: epic.key }).fetch();
    expect(ds.workItems).toHaveLength(250);
  });

  it('imports a two-level non-Epic board root as an epic with direct work', async () => {
    const jira = new FakeJiraClient({ boards: [{ id: 7, name: 'NF board', type: 'scrum', location: { projectKey: 'NF' } }] });
    const feature = await jira.createIssue({ fields: { project: { key: 'NF' }, issuetype: { name: 'Feature' }, summary: 'Capacity planning' } });
    const task = await jira.createIssue({
      fields: { project: { key: 'NF' }, issuetype: { name: 'Task' }, summary: 'Map capacity', parent: { key: feature.key }, status: 'In Progress', customfield_10016: 5 },
    });
    const ds = await new JiraImporter(jira, { ...mapping, projectKey: 'NF', boardId: 7, epicKey: null, epicScopeMode: 'active' }).fetch();
    expect(ds.epics).toEqual([expect.objectContaining({ key: feature.key, title: 'Capacity planning' })]);
    expect(ds.stories).toEqual([expect.objectContaining({ key: `${feature.key}-UNGROUPED` })]);
    expect(ds.workItems).toEqual([expect.objectContaining({ key: task.key, storyKey: `${feature.key}-UNGROUPED`, points: 5 })]);
  });

  it('imports Epics referenced by board issues when the board filter excludes the Epic records', async () => {
    const jira = new FakeJiraClient({ boards: [{ id: 8, name: 'NF filtered board', type: 'scrum', location: { projectKey: 'NF' } }] });
    const epic = await jira.createIssue({ fields: { project: { key: 'NF' }, issuetype: { name: 'Epic' }, summary: 'NF delivery' } });
    const story = await jira.createIssue({
      fields: { project: { key: 'NF' }, issuetype: { name: 'Story' }, summary: 'Deliver feature', parent: { key: epic.key }, status: 'In Progress', customfield_10016: 8 },
    });
    const subtask = await jira.createIssue({
      fields: { project: { key: 'NF' }, issuetype: { name: 'Sub-task' }, summary: 'Implementation detail', parent: { key: story.key }, status: 'To Do', customfield_10016: 3 },
    });
    const filteredClient = new Proxy(jira, {
      get(target, property, receiver) {
        if (property === 'listBoardIssues') {
          return async (_boardId: number, fields: string[]) => {
            const epicRecord = await target.getIssue(epic.key, ['summary', 'status', 'issuetype']);
            return (await target.listBoardIssues(8, fields))
              .filter((issue) => issue.key !== epic.key)
              .map((issue) => issue.fields.parent?.key === epic.key
                ? { ...issue, fields: { ...issue.fields, parent: { ...issue.fields.parent, id: epicRecord.id, fields: epicRecord.fields } } }
                : issue);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as FakeJiraClient;
    const ds = await new JiraImporter(filteredClient, { ...mapping, projectKey: 'NF', boardId: 8, epicKey: null, epicScopeMode: 'active' }).fetch();
    expect(ds.epics).toEqual([expect.objectContaining({ key: epic.key, title: 'NF delivery' })]);
    expect(ds.stories).toEqual([expect.objectContaining({ key: `${epic.key}-UNGROUPED` })]);
    expect(ds.workItems).toEqual([expect.objectContaining({ key: story.key, storyKey: `${epic.key}-UNGROUPED`, points: 8 })]);
    expect(ds.workItems.some((item) => item.key === subtask.key)).toBe(false);
  });
});
