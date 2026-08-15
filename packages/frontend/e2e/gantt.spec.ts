import { expect, test } from '@playwright/test';
import type { DomainDataset } from '@ecp/shared';
import fixture from '../src/fixtures/dataset.json' with { type: 'json' };

async function useTwoEpicFixture(page: import('@playwright/test').Page) {
  const dataset = structuredClone(fixture) as DomainDataset;
  const sourceItem = dataset.workItems.find((item) => item.key === 'CKT-4')!;
  dataset.epics.push({
    key: 'OTH',
    title: 'Other tracked epic',
    teamId: dataset.epics[0]!.teamId,
    active: true,
  });
  dataset.stories.push({ key: 'OTH-S1', epicKey: 'OTH', title: 'Other story' });
  dataset.workItems.push({
    ...sourceItem,
    key: 'OTH-1',
    storyKey: 'OTH-S1',
    title: 'Other epic placed work',
    points: 7,
    labels: ['Other Lane'],
  });
  dataset.workItems.push({
    ...sourceItem,
    key: 'OTH-2',
    storyKey: 'OTH-S1',
    title: 'Other epic active work without a sprint',
    points: 0,
    status: 'In Progress',
    jiraSprintAssigned: false,
    labels: ['Other Lane'],
  });
  dataset.placements.push({
    id: 'OTH-P1',
    workItemKey: 'OTH-1',
    sprintId: dataset.sprints[0]!.id,
    weekIndex: 1,
  });

  const itemByKey = new Map(dataset.workItems.map((item) => [item.key, item]));
  const weekOneLoad = dataset.placements
    .filter((placement) => placement.sprintId === dataset.sprints[0]!.id && placement.weekIndex === 1)
    .reduce((sum, placement) => {
      const item = itemByKey.get(placement.workItemKey);
      return sum + (item && item.status !== 'Done' ? item.points : 0);
    }, 0);

  await page.unroute('**/api/dataset');
  await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
  await page.route('**/health', (route) =>
    route.fulfill({ json: { dataSource: 'synthetic', jiraRequestDebug: false } }),
  );
  await page.route('**/api/placements**', (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 204 })
      : route.fulfill({ json: {} }),
  );
  return { weekOneLoad, selectedCardPoints: 5 };
}

test.describe('Gantt Planner tab', () => {
  test.beforeEach(async ({ page }) => {
    // Keep these fixture-based tests deterministic when a local backend happens
    // to be running behind Vite's development proxy.
    await page.route('**/api/dataset', (route) => route.abort());
  });

  test('renders the sprint board: week columns, lanes, and the bag', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();

    await expect(page.getByTestId('gantt-board')).toBeVisible();
    await expect(page.getByTestId('gantt-sprint-select')).toBeVisible();

    // Four weeks are shown by default, grouped under their source sprints.
    await expect(page.getByTestId('gantt-week-0')).toHaveAttribute('data-verdict', /green|yellow|red/);
    await expect(page.getByTestId('gantt-week-1')).toHaveAttribute('data-verdict', /green|yellow|red/);
    await expect(page.getByTestId('gantt-week-2')).toHaveAttribute('data-verdict', /green|yellow|red/);
    await expect(page.getByTestId('gantt-week-3')).toHaveAttribute('data-verdict', /green|yellow|red/);
    await expect(page.getByTestId('gantt-sprint-header-SP1')).toBeVisible();
    await expect(page.getByTestId('gantt-sprint-header-SP2')).toBeVisible();
    await expect(page.getByTestId('gantt-horizon-select')).toHaveValue('4');

    // The seeded scenario opens with an over-committed first week.
    await expect(page.getByTestId('gantt-week-0')).toHaveAttribute('data-verdict', 'red');

    // Lanes and a populated bag are present.
    await expect(page.locator('[data-testid^="gantt-lane-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="gantt-bag-item-"]').first()).toBeVisible();
  });

  test('arrow buttons step the sprint selector forward and back', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();

    const select = page.getByTestId('gantt-sprint-select');
    const prev = page.getByTestId('gantt-sprint-prev');
    const next = page.getByTestId('gantt-sprint-next');

    // Opens on the first sprint, so "previous" is disabled and "next" is live.
    const first = await select.inputValue();
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();

    // Next advances one sprint; previous returns to the first.
    await next.click();
    const second = await select.inputValue();
    expect(second).not.toBe(first);
    await expect(prev).toBeEnabled();
    await prev.click();
    await expect(select).toHaveValue(first);
    await expect(prev).toBeDisabled();
  });

  test('can reduce the displayed horizon to one two-week sprint', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();

    await page.getByTestId('gantt-horizon-select').selectOption('2');
    await expect(page.getByTestId('gantt-week-0')).toBeVisible();
    await expect(page.getByTestId('gantt-week-1')).toBeVisible();
    await expect(page.getByTestId('gantt-week-2')).toHaveCount(0);
    await expect(page.getByTestId('gantt-sprint-header-SP1')).toBeVisible();
    await expect(page.getByTestId('gantt-sprint-header-SP2')).toHaveCount(0);
  });

  test('cards carry the title and reveal full details on hover', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();

    const card = page.getByTestId('gantt-bag-item-CKT-21');
    const title = (await card.locator('.work-card-title').innerText()).trim();
    expect(title.length).toBeGreaterThan(0);

    // Hovering surfaces a clean tooltip echoing the key and the full title.
    await card.hover();
    const tip = page.getByTestId('work-card-tooltip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('CKT-21');
    await expect(tip).toContainText(title);
  });

  test('opens the per-engineer weekly capacity modal', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();
    await page.getByTestId('gantt-engineer-strip').locator('button').first().click();
    const modal = page.getByTestId('gantt-engineer-modal');
    await expect(modal).toBeVisible();
    // One row per displayed week.
    await expect(modal.locator('.modal-weeks li')).toHaveCount(4);
  });

  // Native HTML5 drag can't be driven by Playwright's real-mouse simulation in
  // headless Chromium, so we dispatch the drag events with a shared DataTransfer
  // (Playwright's recommended pattern). This drives the exact onDragStart /
  // onDrop handlers a real drag fires.
  async function drag(page: import('@playwright/test').Page, from: string, to: string) {
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await page.getByTestId(from).dispatchEvent('dragstart', { dataTransfer: dt });
    await page.getByTestId(to).dispatchEvent('dragover', { dataTransfer: dt });
    await page.getByTestId(to).dispatchEvent('drop', { dataTransfer: dt });
  }

  test('dragging a backlog card into a week recomputes it live', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();

    const week1 = page.getByTestId('gantt-week-1');
    await expect(week1).toHaveAttribute('data-verdict', 'green');

    // Drop a 5-point card into the comfortable second week, pushing it over.
    await drag(page, 'gantt-bag-item-CKT-21', 'gantt-week-1');

    await expect(page.getByTestId('gantt-bag-item-CKT-21')).toHaveCount(0);
    await expect(page.getByTestId('gantt-chip-CKT-21')).toBeVisible();
    await expect(week1).toHaveAttribute('data-verdict', 'red');
  });

  test('dragging a placed card back to the bag frees the week', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();

    const week1 = page.getByTestId('gantt-week-1');
    await drag(page, 'gantt-bag-item-CKT-21', 'gantt-week-1');
    await expect(week1).toHaveAttribute('data-verdict', 'red');

    // Send it back to the bag; the week returns to green.
    await drag(page, 'gantt-chip-CKT-21', 'gantt-bag');
    await expect(week1).toHaveAttribute('data-verdict', 'green');
    await expect(page.getByTestId('gantt-bag-item-CKT-21')).toBeVisible();
  });

  test('epic filtering hides other cards but retains their weekly load', async ({ page }) => {
    const { weekOneLoad, selectedCardPoints } = await useTwoEpicFixture(page);
    await page.goto('/?tab=gantt&epics=CKT');

    const weekOnePoints = page.getByTestId('gantt-week-1').locator('.gantt-week-load strong');
    await expect(page.getByTestId('gantt-chip-CKT-8')).toBeVisible();
    await expect(page.getByTestId('gantt-chip-OTH-1')).toHaveCount(0);
    await expect(page.getByTestId('gantt-bag-item-OTH-1')).toHaveCount(0);
    await expect(page.getByTestId('gantt-bag-item-OTH-2')).toHaveCount(0);
    await expect(weekOnePoints).toHaveText(String(weekOneLoad));

    await drag(page, 'gantt-bag-item-CKT-21', 'gantt-week-1');
    await expect(weekOnePoints).toHaveText(String(weekOneLoad + selectedCardPoints));
    await drag(page, 'gantt-chip-CKT-21', 'gantt-bag');
    await expect(weekOnePoints).toHaveText(String(weekOneLoad));

    await page.getByRole('button', { name: 'Show all epics' }).click();
    await expect(page).toHaveURL(/tab=gantt/);
    await expect(page.getByTestId('gantt-chip-OTH-1')).toBeVisible();
    await expect(page.getByTestId('gantt-bag-item-OTH-2')).toBeVisible();
    await expect(page.getByTestId('work-card-warning-OTH-2')).toBeVisible();
    await expect(weekOnePoints).toHaveText(String(weekOneLoad));
  });
});
