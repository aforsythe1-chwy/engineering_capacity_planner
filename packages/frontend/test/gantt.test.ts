import { describe, expect, it } from 'vitest';
import { loadBundledDataset } from '../src/data/loadDataset';
import { scopeEpic } from '../src/lib/projection';
import { buildGanttView, ganttCell, type GanttScope } from '../src/lib/gantt';

const dataset = loadBundledDataset();
const epicScope = scopeEpic(dataset, dataset.epics[0]!.key);
const scope: GanttScope = {
  visibleStories: epicScope.stories,
  visibleWorkItems: epicScope.workItems,
  visiblePlacements: epicScope.placements,
  portfolioWorkItems: epicScope.workItems,
  portfolioPlacements: epicScope.placements,
  labelConfigByEpicKey: new Map([[epicScope.epic.key, epicScope.labelConfig]]),
  team: epicScope.team,
  members: epicScope.members,
  pto: epicScope.pto,
  oncall: epicScope.oncall,
  velocityOverrides: epicScope.velocityOverrides,
  sprints: epicScope.sprints,
  defaults: epicScope.defaults,
  planningToday: epicScope.planningToday,
};

describe('buildGanttView', () => {
  it('shows four weeks by default and groups them by sprint', () => {
    const view = buildGanttView(scope, null);
    expect(view.sprint).not.toBeNull();
    expect(view.weeks).toHaveLength(4);
    expect(view.sprintGroups.map((group) => [group.sprint.id, group.startWeekIndex, group.weekCount])).toEqual([
      [scope.sprints[0]!.id, 0, 2],
      [scope.sprints[1]!.id, 2, 2],
    ]);
    for (const w of view.weeks) expect(['green', 'yellow', 'red']).toContain(w.verdict);
  });

  it('honours the selected sprint', () => {
    const target = scope.sprints[1]!;
    const view = buildGanttView(scope, target.id);
    expect(view.sprint!.id).toBe(target.id);
    expect(view.weeks[0]!.sprintId).toBe(target.id);
  });

  it('caps Jira-style boundary slivers to the team cadence', () => {
    const jiraStyleScope = {
      ...scope,
      sprints: [
        {
          ...scope.sprints[0]!,
          id: 'jira-style',
          startDate: '2026-07-17',
          endDate: '2026-07-31',
        },
      ],
      visiblePlacements: [],
      portfolioPlacements: [],
    };

    const view = buildGanttView(jiraStyleScope, 'jira-style');

    expect(view.weeks.map((w) => [w.start, w.end])).toEqual([
      ['2026-07-17', '2026-07-23'],
      ['2026-07-24', '2026-07-30'],
    ]);
  });

  it('derives lanes from labels, biggest subdivision first', () => {
    const view = buildGanttView(scope, scope.sprints[0]!.id);
    expect(view.lanes.length).toBeGreaterThan(0);
    for (let i = 1; i < view.lanes.length; i++) {
      expect(view.lanes[i - 1]!.totalPoints).toBeGreaterThanOrEqual(view.lanes[i]!.totalPoints);
    }
  });

  it('can inherit parent story labels for lane assignment', () => {
    const item = { ...scope.visibleWorkItems[0]!, labels: [] };
    const placements = [{ id: 'p1', workItemKey: item.key, sprintId: scope.sprints[0]!.id, weekIndex: 0 }];
    const parentScope = {
      ...scope,
      visibleStories: scope.visibleStories.map((s) => (s.key === item.storyKey ? { ...s, labels: ['Parent Lane'] } : s)),
      visibleWorkItems: [item],
      visiblePlacements: placements,
      portfolioWorkItems: [item],
      portfolioPlacements: placements,
      labelConfigByEpicKey: new Map([[epicScope.epic.key, { applyParentLabels: true, ignoreLabels: [] }]]),
    };

    const view = buildGanttView(parentScope, scope.sprints[0]!.id);

    expect(view.lanes).toEqual([{ label: 'Parent Lane', totalPoints: item.points }]);
    expect(ganttCell(view, 'Parent Lane', 0)?.items).toEqual([item]);
  });

  it('ignores configured labels before choosing a lane', () => {
    const item = { ...scope.visibleWorkItems[0]!, labels: ['Noise', 'Useful'] };
    const ignoredScope = {
      ...scope,
      visibleWorkItems: [item],
      visiblePlacements: [],
      portfolioWorkItems: [item],
      portfolioPlacements: [],
      labelConfigByEpicKey: new Map([[epicScope.epic.key, { applyParentLabels: false, ignoreLabels: ['Noise'] }]]),
    };

    const view = buildGanttView(ignoredScope, scope.sprints[0]!.id);

    expect(view.lanes).toEqual([{ label: 'Useful', totalPoints: item.points }]);
  });

  it("a week's placed load equals the sum of its cells' remaining points", () => {
    const view = buildGanttView(scope, scope.sprints[0]!.id);
    view.weeks.forEach((week) => {
      const cellSum = view.lanes.reduce(
        (sum, lane) => sum + (ganttCell(view, lane.label, week.index)?.points ?? 0),
        0,
      );
      expect(cellSum).toBe(week.placedPoints);
    });
  });

  it('maps a placement in the following sprint into its own displayed column', () => {
    const view = buildGanttView(scope, scope.sprints[0]!.id, 4);
    const item = scope.visibleWorkItems.find((workItem) => workItem.key === 'CKT-13')!;

    expect(view.weeks[2]).toMatchObject({ sprintId: scope.sprints[1]!.id, sprintWeekIndex: 0 });
    expect(ganttCell(view, item.labels![0]!, 2)?.items).toContainEqual(item);
  });

  it('exposes a per-member weekly capacity breakdown for active members', () => {
    const view = buildGanttView(scope, scope.sprints[0]!.id);
    const active = scope.members.filter((m) => m.active);
    expect(view.members).toHaveLength(active.length);
    for (const mc of view.members) {
      expect(mc.perWeek).toHaveLength(view.weeks.length);
      expect(mc.total).toBeGreaterThanOrEqual(0);
    }
  });

  it('lists only unplaced, not-done work in the bag', () => {
    const view = buildGanttView(scope, scope.sprints[0]!.id);
    const placedKeys = new Set(scope.visiblePlacements.map((p) => p.workItemKey));
    for (const item of view.bag) {
      expect(placedKeys.has(item.key)).toBe(false);
      expect(item.status).not.toBe('Done');
    }
  });

  it('filters visible work while retaining other epic load in weekly capacity', () => {
    const sprintId = scope.sprints[0]!.id;
    const selectedPlaced = { ...scope.visibleWorkItems.find((item) => item.key === 'CKT-4')!, labels: ['Selected Lane'] };
    const selectedBag = { ...scope.visibleWorkItems.find((item) => item.key === 'CKT-21')!, labels: ['Selected Bag'] };
    const otherStory = { key: 'OTH-S1', epicKey: 'OTH', title: 'Other story', labels: ['Other Parent'] };
    const otherPlaced = { ...selectedPlaced, key: 'OTH-1', storyKey: otherStory.key, title: 'Hidden placed work', points: 100, labels: [] };
    const otherBag = { ...selectedBag, key: 'OTH-2', storyKey: otherStory.key, title: 'Hidden backlog work', labels: ['Other Bag'] };
    const selectedPlacement = { id: 'selected-placement', workItemKey: selectedPlaced.key, sprintId, weekIndex: 0 };
    const otherPlacement = { id: 'other-placement', workItemKey: otherPlaced.key, sprintId, weekIndex: 0 };
    const filteredScope: GanttScope = {
      ...scope,
      visibleStories: scope.visibleStories,
      visibleWorkItems: [selectedPlaced, selectedBag],
      visiblePlacements: [selectedPlacement],
      portfolioWorkItems: [selectedPlaced, selectedBag, otherPlaced, otherBag],
      portfolioPlacements: [selectedPlacement, otherPlacement],
      labelConfigByEpicKey: new Map([
        [epicScope.epic.key, { applyParentLabels: false, ignoreLabels: [] }],
        ['OTH', { applyParentLabels: true, ignoreLabels: [] }],
      ]),
    };

    const filtered = buildGanttView(filteredScope, sprintId);
    const visibleCellKeys = [...filtered.cells.values()].flatMap((cell) => cell.items.map((item) => item.key));

    expect(visibleCellKeys).toEqual([selectedPlaced.key]);
    expect(filtered.bag.map((item) => item.key)).toEqual([selectedBag.key]);
    expect(filtered.lanes.map((lane) => lane.label)).toEqual(['Selected Bag', 'Selected Lane']);
    expect(filtered.placedCount).toBe(1);
    expect(filtered.weeks[0]!.placedPoints).toBe(selectedPlaced.points + otherPlaced.points);
    expect(filtered.weeks[0]!.verdict).toBe('red');

    const selectedOnlyLoad = buildGanttView(
      { ...filteredScope, portfolioPlacements: [selectedPlacement] },
      sprintId,
    );
    expect(selectedOnlyLoad.weeks[0]!.placedPoints).toBe(selectedPlaced.points);
    expect(selectedOnlyLoad.weeks[0]!.verdict).not.toBe('red');

    const unfiltered = buildGanttView(
      {
        ...filteredScope,
        visibleStories: [...scope.visibleStories, otherStory],
        visibleWorkItems: filteredScope.portfolioWorkItems,
        visiblePlacements: filteredScope.portfolioPlacements,
      },
      sprintId,
    );
    expect([...unfiltered.cells.values()].flatMap((cell) => cell.items.map((item) => item.key))).toEqual(
      expect.arrayContaining([selectedPlaced.key, otherPlaced.key]),
    );
    expect(unfiltered.bag.map((item) => item.key)).toEqual(
      expect.arrayContaining([selectedBag.key, otherBag.key]),
    );
    expect(unfiltered.lanes.map((lane) => lane.label)).toContain('Other Parent');

    const placedSelectedBag = buildGanttView(
      {
        ...filteredScope,
        visiblePlacements: [...filteredScope.visiblePlacements, { id: 'selected-bag-placement', workItemKey: selectedBag.key, sprintId, weekIndex: 0 }],
        portfolioPlacements: [...filteredScope.portfolioPlacements, { id: 'selected-bag-placement', workItemKey: selectedBag.key, sprintId, weekIndex: 0 }],
      },
      sprintId,
    );
    expect(placedSelectedBag.weeks[0]!.placedPoints).toBe(
      selectedPlaced.points + selectedBag.points + otherPlaced.points,
    );
    expect(filtered.weeks[0]!.placedPoints).toBe(selectedPlaced.points + otherPlaced.points);
  });
});
