import type { DomainDataset } from '@ecp/shared';
import { describe, expect, it } from 'vitest';
import { loadBundledDataset } from '../src/data/loadDataset';
import { makeGanttScope } from '../src/lib/plannerPageScopes';
import { buildPlannerScope } from '../src/lib/projection';

const dataset = loadBundledDataset();

function twoEpicDataset(): DomainDataset {
  const sourceItem = dataset.workItems.find((item) => item.status !== 'Done')!;
  return {
    ...dataset,
    epics: [
      ...dataset.epics,
      { key: 'OTH', title: 'Other tracked epic', teamId: dataset.epics[0]!.teamId, active: true },
    ],
    stories: [
      ...dataset.stories,
      { key: 'OTH-S1', epicKey: 'OTH', title: 'Other story', labels: ['Parent Lane'] },
    ],
    workItems: [
      ...dataset.workItems,
      { ...sourceItem, key: 'OTH-1', storyKey: 'OTH-S1', title: 'Other work item' },
    ],
    placements: [
      ...(dataset.placements ?? []),
      { id: 'OTH-P1', workItemKey: 'OTH-1', sprintId: dataset.sprints![0]!.id, weekIndex: 0 },
    ],
    settings: [
      ...dataset.settings,
      { key: 'gantt_apply_parent_labels', scope: 'epic', scopeId: 'OTH', value: 'true' },
    ],
  };
}

describe('makeGanttScope', () => {
  it('separates a selected epic presentation from portfolio load collections', () => {
    const input = twoEpicDataset();
    const planner = buildPlannerScope(input, [dataset.epics[0]!.key]);
    const gantt = makeGanttScope(input, planner);

    expect(gantt.visibleWorkItems.every((item) => item.key.startsWith('CKT-'))).toBe(true);
    expect(gantt.visibleWorkItems.some((item) => item.key === 'OTH-1')).toBe(false);
    expect(gantt.visiblePlacements.some((placement) => placement.workItemKey === 'OTH-1')).toBe(false);
    expect(gantt.portfolioWorkItems.some((item) => item.key === 'OTH-1')).toBe(true);
    expect(gantt.portfolioPlacements.some((placement) => placement.workItemKey === 'OTH-1')).toBe(true);
  });

  it('makes visible and portfolio collections equivalent for an empty filter', () => {
    const input = twoEpicDataset();
    const planner = buildPlannerScope(input, []);
    const gantt = makeGanttScope(input, planner);

    expect(gantt.visibleWorkItems).toEqual(gantt.portfolioWorkItems);
    expect(gantt.visiblePlacements).toEqual(gantt.portfolioPlacements);
    expect(gantt.labelConfigByEpicKey.get('OTH')).toEqual({
      applyParentLabels: true,
      ignoreLabels: [],
    });
  });
});
