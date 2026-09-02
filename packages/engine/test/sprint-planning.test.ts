import { describe, expect, it } from 'vitest';
import { buildSprintPlanningOutlook } from '../src/sprint-planning.js';
import { generateSyntheticDataset } from '../../backend/src/importer/synthetic.js';

describe('buildSprintPlanningOutlook', () => it('uses the shared portfolio allocation and keeps selected points separate', () => {
  const dataset = generateSyntheticDataset(); const sprint = dataset.sprints[0]!; const selected = dataset.workItems.slice(0, 2).map((item) => item.key);
  const rows = buildSprintPlanningOutlook(dataset, sprint, selected);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.reduce((sum, row) => sum + row.selectedPoints, 0)).toBe(dataset.workItems.slice(0, 2).reduce((sum, item) => sum + item.points, 0));
  expect(rows.every((row) => Number.isFinite(row.requiredPoints) && Math.abs(row.gapPoints - (row.selectedPoints - row.requiredPoints)) < 0.011)).toBe(true);
}));
