import { expect, test } from '@playwright/test';

// A local visual harness: no database, Jira request, current locale, or clock is involved.
// The cloned epics deliberately exercise risk, incomplete planning, long names, and dense lists.
function visualDataset() {
  const data = {
    teams: [{ id: 'platform', name: 'Platform team', sprintLengthDays: 14, sprintStartWeekday: 1, sprintAnchorDate: '2026-08-03', workingDays: [1, 2, 3, 4, 5] }],
    members: [{ id: 'ada', teamId: 'platform', name: 'Ada', baseVelocity: 20, active: true }, { id: 'ben', teamId: 'platform', name: 'Ben', baseVelocity: 16, active: true }],
    velocityOverrides: [], pto: [], oncall: [], epics: [], milestones: [], stories: [], workItems: [], dependencies: [], sprints: [], placements: [], settings: [{ key: 'planning_today', scope: 'global', scopeId: null, value: '"2026-08-16"' }], portfolioEpics: [],
  };
  for (const [key, title, target, estimated] of [
    ['NF-123', 'Checkout reliability and customer experience resilience program', '2026-08-20', true],
    ['NF-124', 'New fulfillment flow with a deliberately long title for responsive wrapping', '2026-09-06', false],
    ['OPS-21', 'Platform observability improvements', null, true],
    ['WEB-8', 'Mobile checkout cleanup', '2026-12-01', true],
    ['API-7', 'Customer account preference migration', '2026-10-10', true],
  ] as const) {
    data.epics.push({ key, title, teamId: 'platform' });
    data.stories.push({ key: `${key}-S1`, epicKey: key, title: `${title} delivery` });
    data.workItems.push({ key: `${key}-1`, storyKey: `${key}-S1`, title: 'Implementation', points: key === 'NF-123' ? 90 : 12, isEstimated: estimated, status: 'To Do', assigneeId: 'ada' });
    data.workItems.push({ key: `${key}-2`, storyKey: `${key}-S1`, title: 'Validation', points: 5, isEstimated: true, status: 'To Do', assigneeId: 'ben' });
    if (target) data.milestones.push({ id: `visual-${key}`, epicKey: key, name: 'Launch readiness', date: target, isGating: true });
  }
  return data;
}

test.beforeEach(async ({ page }) => {
  const data = visualDataset();
  await page.route('**/api/dataset', (route) => route.fulfill({ json: data }));
  await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic' } }));
});

test('captures deterministic portfolio and Calendar states', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByTestId('portfolio-overview')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/portfolio-screenshots/portfolio-default.png', fullPage: true });

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.screenshot({ path: 'test-results/portfolio-screenshots/portfolio-dense.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/portfolio-screenshots/portfolio-mobile.png', fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByTestId('tab-timeline').click();
  await expect(page).toHaveURL(/tab=timeline/);
  await expect(page.getByTestId('portfolio-calendar')).toBeVisible();
  await page.screenshot({ path: 'test-results/portfolio-screenshots/calendar-all.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/portfolio-screenshots/calendar-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const picker = page.getByRole('combobox', { name: 'Epic filter' });
  await picker.fill('nf123');
  await expect(page.getByRole('option', { name: /NF-123/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/portfolio-screenshots/portfolio-picker-open.png', fullPage: true });
  await picker.press('Enter');
  await expect(page).toHaveURL(/tab=timeline&epics=NF-123/);
  await page.screenshot({ path: 'test-results/portfolio-screenshots/calendar-filtered.png', fullPage: true });

  await page.getByRole('combobox', { name: 'Epic filter' }).fill('does-not-exist');
  await expect(page.getByText('No matching active epics.')).toBeVisible();
  await page.screenshot({ path: 'test-results/portfolio-screenshots/portfolio-no-match.png', fullPage: true });
});
