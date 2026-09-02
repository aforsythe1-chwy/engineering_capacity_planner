import { expect, test } from '@playwright/test';
import type { DomainDataset } from '@ecp/shared';
import fixture from '../src/fixtures/dataset.json' with { type: 'json' };

function ceremony(kind: 'planning' | 'review') {
  return { ceremony: { id: `${kind}-1`, kind, status: 'draft', revision: 0, sprintName: 'Sprint 1' }, planItems: [], notes: [], comparisonNotes: [], snapshots: [], comparisonSnapshot: null };
}

test('opens Sprint Overview planning, keeps shared outlook visible, and fits a narrow viewport', async ({ page }) => {
  const dataset = structuredClone(fixture) as DomainDataset;
  await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic', jiraRequestDebug: false } }));
  await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
  await page.route('**/api/sprint-ceremonies/open', async (route) => route.fulfill({ json: ceremony((await route.request().postDataJSON()).kind) }));
  await page.goto('/?tab=sprints&sprintMode=planning');
  await expect(page.getByRole('tab', { name: 'Planning' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Start Planning' }).click();
  await expect(page.getByRole('heading', { name: 'Sprint commitment' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Portfolio outlook' })).toBeVisible();
  await expect(page.getByText(/Totals include every tracked epic/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
