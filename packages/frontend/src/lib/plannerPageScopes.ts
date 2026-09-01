import type { DomainDataset } from '@ecp/shared';
import type { GanttScope } from './gantt';
import { scopeEpic, type EpicScope, type PlannerScope } from './projection';

function baseEpicScope(dataset: DomainDataset, planner: PlannerScope): EpicScope {
  const epicKey = planner.selectedEpicKeys[0] ?? planner.activeEpics[0]?.key;
  if (!epicKey) throw new Error('A planner page scope requires at least one active epic');
  return scopeEpic(dataset, epicKey);
}

/** Keep direct external dependency nodes while filtering the dependency page. */
export function makeDependencyScope(dataset: DomainDataset, planner: PlannerScope): EpicScope {
  const base = baseEpicScope(dataset, planner);
  const visibleKeys = new Set(planner.visibleWorkItems.map((item) => item.key));
  const contextKeys = new Set(visibleKeys);

  if (planner.selectedEpicKeys.length) {
    for (const edge of planner.portfolioDependencies) {
      if (visibleKeys.has(edge.blockerItemKey) || visibleKeys.has(edge.blockedItemKey)) {
        contextKeys.add(edge.blockerItemKey);
        contextKeys.add(edge.blockedItemKey);
      }
    }
  }

  const workItems = planner.portfolioWorkItems.filter((item) => contextKeys.has(item.key));
  const storyKeys = new Set(workItems.map((item) => item.storyKey));
  return {
    ...base,
    stories: dataset.stories.filter((story) => storyKeys.has(story.key)),
    workItems,
    dependencies: planner.portfolioDependencies.filter(
      (edge) => contextKeys.has(edge.blockerItemKey) && contextKeys.has(edge.blockedItemKey),
    ),
    placements: planner.portfolioPlacements,
    milestones: dataset.milestones.filter((milestone) =>
      planner.activeEpics.some((epic) => epic.key === milestone.epicKey),
    ),
  };
}

/** Build the Gantt's filtered presentation and portfolio load inputs explicitly. */
export function makeGanttScope(dataset: DomainDataset, planner: PlannerScope): GanttScope {
  const base = baseEpicScope(dataset, planner);
  const visibleItemKeys = new Set(planner.visibleWorkItems.map((item) => item.key));
  const labelConfigByEpicKey = new Map(
    planner.visibleEpics.map((epic) => [epic.key, scopeEpic(dataset, epic.key).labelConfig]),
  );

  return {
    visibleStories: planner.visibleStories,
    visibleWorkItems: planner.visibleWorkItems,
    visiblePlacements: planner.portfolioPlacements.filter((placement) =>
      visibleItemKeys.has(placement.workItemKey),
    ),
    portfolioWorkItems: planner.portfolioWorkItems,
    portfolioPlacements: planner.portfolioPlacements,
    labelConfigByEpicKey,
    team: base.team,
    members: base.members,
    pto: base.pto,
    oncall: base.oncall,
    velocityOverrides: base.velocityOverrides,
    holidays: (dataset.holidays ?? []).filter((holiday) => holiday.teamId === base.team.id),
    sprints: base.sprints,
    defaults: base.defaults,
    planningToday: base.planningToday,
  };
}
