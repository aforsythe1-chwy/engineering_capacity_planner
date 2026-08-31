import { expect, test } from '@playwright/test';
import type { DomainDataset, TeamSprintOutput } from '@ecp/shared';
import fixture from '../src/fixtures/dataset.json' with { type: 'json' };

function teamDataset() {
  const dataset = structuredClone(fixture) as DomainDataset;
  dataset.teams.push({ id: 'team-ops', name: 'Operations Team', sprintLengthDays: 14, sprintStartWeekday: 2, sprintAnchorDate: '2026-07-07', workingDays: [1, 2, 3, 4, 5] });
  dataset.members.push({ id: 'M-ops', teamId: 'team-ops', name: 'Olive', baseVelocity: 10, active: true });
  return dataset;
}

const sprintOutputResponse: TeamSprintOutput = {
  teamId: 'team-platform', jiraBoardUrl: null, sprint: null, capturedAt: '2026-08-29T12:00:00.000Z', freshness: 'fresh', truncated: false, errorMessage: null,
  engineers: [
    { memberId: 'M1', baseVelocity: 12, adjustedCapacity: 10, donePoints: 2, inReviewPoints: 2, inProgressPoints: 7, toDoPoints: 0, unestimatedDoneOrReviewItems: 0, matchedSprintItems: 3, availability: { ptoWorkingDays: 0, oncallWorkingDays: 0, velocityOverrideWorkingDays: 0 }, jiraLinked: true },
    { memberId: 'M2', baseVelocity: 8, adjustedCapacity: 10, donePoints: 8, inReviewPoints: 0, inProgressPoints: 0, toDoPoints: 0, unestimatedDoneOrReviewItems: 0, matchedSprintItems: 1, availability: { ptoWorkingDays: 0, oncallWorkingDays: 0, velocityOverrideWorkingDays: 0 }, jiraLinked: true },
  ],
  unattributed: { itemCount: 0, estimatedDoneOrReviewPoints: 0, unestimatedDoneOrReviewItems: 0 },
};

test('keeps Team analysis navigation, scope, and analysis-specific controls distinct', async ({ page }) => {
  const dataset = teamDataset();
  let sprintRequests = 0;
  await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic', jiraRequestDebug: false } }));
  await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
  await page.route('**/api/bandwidth-check-ins**', (route) => route.fulfill({ json: { checkIns: [] } }));
  await page.route('**/api/teams/*/current-sprint-output', (route) => { sprintRequests += 1; return route.fulfill({ json: sprintOutputResponse }); });

  await page.goto('/?tab=team');
  const tablist = page.getByRole('tablist', { name: 'Team analysis' });
  const bandwidth = tablist.getByRole('tab', { name: 'Bandwidth' });
  const availability = tablist.getByRole('tab', { name: 'Availability' });
  const sprintOutput = tablist.getByRole('tab', { name: 'Sprint output' });
  const engineer = page.getByRole('combobox', { name: 'Engineer' });

  await expect(bandwidth).toHaveAttribute('aria-selected', 'true');
  await expect(bandwidth).toHaveAttribute('tabindex', '0');
  await expect(page.getByRole('tabpanel', { name: 'Bandwidth' })).toHaveCount(1);
  expect(await page.getByRole('tabpanel').count()).toBe(1);
  expect(sprintRequests).toBe(0);

  await bandwidth.focus();
  await page.keyboard.press('ArrowRight');
  await expect(availability).toBeFocused();
  await expect(availability).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Availability' })).toHaveCount(1);
  await page.keyboard.press('End');
  await expect(sprintOutput).toBeFocused();
  await expect(sprintOutput).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Sprint output' }).getByRole('button', { name: 'Previous' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Sprint output gauge legend' })).toContainText('Done');
  await expect(page.getByRole('list', { name: 'Sprint output gauge legend' })).toContainText('In review');
  await expect(page.getByRole('list', { name: 'Sprint output gauge legend' })).toContainText('In progress');
  await expect(page.getByRole('list', { name: 'Sprint output gauge legend' })).toContainText('To do');
  await expect(page.getByText('Output % = (Done + In review) ÷ available capacity')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Sort sprint output' })).toHaveValue('jira');
  await expect(page.getByText('11 assigned / 10 available pts · 110% scoped · 1 pt over capacity')).toBeVisible();
  await page.getByRole('combobox', { name: 'Sort sprint output' }).selectOption('scope-desc');
  await expect(page.getByRole('combobox', { name: 'Sort sprint output' })).toHaveValue('scope-desc');
  await expect(page.locator('.sprint-output-row').first()).toContainText('Ada');
  await page.getByRole('combobox', { name: 'Sort sprint output' }).selectOption('output-desc');
  await expect(page.locator('.sprint-output-row').first()).toContainText('Björn');
  await expect.poll(() => sprintRequests).toBeGreaterThan(0);
  await page.keyboard.press('Home');
  await expect(bandwidth).toBeFocused();

  await engineer.focus();
  await expect(page.getByRole('option', { name: 'All engineers' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Ada' })).toBeVisible();
  await engineer.fill('Ada');
  await page.getByRole('option', { name: 'Ada' }).click();
  await expect(engineer).toHaveValue('Ada');
  await availability.click();
  await expect(engineer).toHaveValue('Ada');
  await sprintOutput.click();
  await expect(engineer).toHaveValue('Ada');

  await page.getByRole('combobox', { name: 'Team', exact: true }).selectOption('team-ops');
  await expect(engineer).toHaveValue('All engineers');
});

test('shares the selected month between Bandwidth and Availability without narrow-page overflow', async ({ page }) => {
  const dataset = teamDataset();
  await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic', jiraRequestDebug: false } }));
  await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
  await page.route('**/api/bandwidth-check-ins**', (route) => route.fulfill({ json: { checkIns: [] } }));
  await page.goto('/?tab=team');

  await page.getByRole('tabpanel', { name: 'Bandwidth' }).getByRole('button', { name: 'Previous' }).click();
  const month = await page.getByRole('tabpanel', { name: 'Bandwidth' }).getByRole('heading', { name: /^Bandwidth — / }).textContent();
  await page.getByRole('tab', { name: 'Availability' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Availability' }).getByRole('heading', { name: month?.replace('Bandwidth', 'Availability') ?? '' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
