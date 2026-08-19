import { expect, test } from '@playwright/test';
import type { DomainDataset } from '@ecp/shared';
import fixture from '../src/fixtures/dataset.json' with { type: 'json' };

test.beforeEach(async ({ page }) => {
  // Keep Calendar assertions deterministic when a local backend is running.
  await page.route('**/api/dataset', (route) => route.abort());
});

test.describe('Calendar / timeline tab', () => {
  test('keeps tab/filter routing flat and renders Calendar before Delivery outlook', async ({ page }) => {
    await page.goto('/?tab=timeline');
    await expect(page.getByTestId('tab-timeline')).toHaveText('Calendar');
    await expect(page).toHaveURL(/tab=timeline/);
    const calendar = page.getByTestId('portfolio-calendar');
    await expect(calendar).toBeVisible();
    await expect(page.getByTestId('delivery-outlook')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Delivery outlook' })).toBeVisible();
    const calendarY = await calendar.evaluate((element) => element.getBoundingClientRect().top);
    const outlookY = await page.getByTestId('delivery-outlook').evaluate((element) => element.getBoundingClientRect().top);
    expect(calendarY).toBeLessThan(outlookY);

    await page.getByRole('combobox', { name: 'Epic filter' }).fill('CKT');
    await page.getByRole('combobox', { name: 'Epic filter' }).press('Enter');
    await expect(page).toHaveURL(/tab=timeline&epics=CKT/);
    await expect(page.getByTestId('portfolio-calendar')).toBeVisible();
    await expect(page.locator('[data-testid^="delivery-outlook-"]')).toHaveCount(1);
    await page.getByTestId('tab-dependencies').click();
    await expect(page).toHaveURL(/tab=dependencies&epics=CKT/);
    await page.getByTestId('tab-timeline').click();
    await expect(page).toHaveURL(/tab=timeline&epics=CKT/);
    await page.getByRole('button', { name: 'Show all epics' }).click();
    await expect(page).toHaveURL(/\?tab=timeline$/);
  });

  test('navigates months, toggles layers, and describes shared capacity', async ({ page }) => {
    await page.goto('/?tab=timeline');
    const calendar = page.getByTestId('portfolio-calendar');
    await expect(page.getByTestId('portfolio-cal-current-month')).toHaveText('Jul 2026');
    await expect(calendar.locator('.cal-cell.is-today')).toHaveCount(1);
    const firstBand = calendar.locator('[data-testid^="portfolio-load-"]').first();
    await expect(firstBand).toBeVisible();
    await expect(firstBand).toHaveAttribute('data-total-load', /\d/);
    await expect(firstBand).toHaveAttribute('data-capacity', /\d/);

    await page.getByTestId('portfolio-cal-next').click();
    await expect(page.getByTestId('portfolio-cal-current-month')).toHaveText('Aug 2026');
    await page.getByTestId('portfolio-cal-next').click();
    await expect(page.getByTestId('portfolio-cal-current-month')).toHaveText('Sep 2026');
    await expect(calendar.locator('.cal-event.gating').first()).toBeVisible();

    await page.getByTestId('portfolio-cal-filter-btn').click();
    await page.getByTestId('portfolio-cal-filter-relevantDays').uncheck();
    await expect(calendar.locator('.cal-event.gating')).toHaveCount(0);
    await page.getByTestId('portfolio-cal-filter-relevantDays').check();
    await expect(calendar.locator('.cal-event.gating').first()).toBeVisible();
    await expect(calendar.locator('[data-testid^="portfolio-sprint-"]').first()).toBeVisible();
    await page.getByTestId('portfolio-cal-filter-sprints').uncheck();
    await expect(calendar.locator('[data-testid^="portfolio-sprint-"]')).toHaveCount(0);
    await page.getByTestId('portfolio-cal-filter-sprints').check();
    await expect(calendar.locator('[data-testid^="portfolio-sprint-"]').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('portfolio-cal-filter-menu')).toBeHidden();
    await page.getByTestId('portfolio-cal-today').click();
    await expect(page.getByTestId('portfolio-cal-current-month')).toHaveText('Jul 2026');
  });

  test('contains the seven-day grid at a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?tab=timeline');
    await expect(page.getByTestId('portfolio-calendar')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const region = page.getByRole('region', { name: /calendar grid/ });
    await expect(region).toBeVisible();
    expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  });

  test('discloses dense-day events with the keyboard and returns focus on Escape', async ({ page }) => {
    const dataset = structuredClone(fixture) as DomainDataset;
    const epicKey = dataset.epics[0]!.key;
    for (let index = 0; index < 5; index += 1) dataset.milestones.push({ id: `dense-${index}`, epicKey, name: `Dense checkpoint ${index + 1}`, date: '2026-07-20', isGating: false });
    await page.unroute('**/api/dataset');
    await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
    await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic' } }));
    await page.goto('/?tab=timeline');

    const trigger = page.getByRole('button', { name: /more/ }).first();
    await trigger.focus();
    await trigger.press('Enter');
    const dialog = page.getByRole('dialog', { name: /More events/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Dense checkpoint/).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe('Dependencies tab', () => {
  test('keeps done context out of remaining-work recommendations and can hide it', async ({ page }) => {
    const dataset = structuredClone(fixture) as DomainDataset;
    const [done, ...remaining] = dataset.workItems;
    done!.status = 'Done';
    dataset.dependencies = remaining.slice(0, 4).map((item, index) => ({
      id: `done-context-${index}`,
      blockerItemKey: done!.key,
      blockedItemKey: item.key,
    }));
    await page.unroute('**/api/dataset');
    await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
    await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic' } }));
    await page.goto('/?tab=dependencies');

    const doneNode = page.getByTestId(`graph-node-${done!.key}`);
    await expect(doneNode).toBeVisible();
    await expect(doneNode).toHaveClass(/is-done/);
    await expect(page.getByTestId(`leverage-${done!.key}`)).toHaveCount(0);

    const showDone = page.getByTestId('graph-show-done');
    await expect(showDone).toBeChecked();
    await showDone.uncheck();
    await expect(doneNode).toHaveCount(0);
    await expect(page.getByTestId(`leverage-${done!.key}`)).toHaveCount(0);

    await showDone.check();
    await expect(doneNode).toBeVisible();
  });

  test('renders the graph, highlights high-leverage blockers, and ranks them', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('tab-dependencies').click();

    // The flowchart renders with a node per ticket and at least one edge.
    const svg = page.getByTestId('dependency-svg');
    await expect(svg).toBeVisible();
    await expect(page.getByTestId('graph-show-done')).toBeChecked();
    await expect(svg.locator('.graph-node')).not.toHaveCount(0);
    await expect(svg.locator('.dependency-edge').first()).toBeVisible();

    // At least one node is flagged as high leverage.
    await expect(svg.locator('.graph-node[data-tier="high"]').first()).toBeVisible();

    // The "work these next" leaderboard lists the top blockers.
    const list = page.getByTestId('leverage-list');
    await expect(list).toBeVisible();
    await expect(list.locator('li')).not.toHaveCount(0);

    // Switching back to Calendar still works.
    await page.getByTestId('tab-timeline').click();
    await expect(page.getByTestId('portfolio-calendar')).toBeVisible();
  });

  test('clicking a leaderboard entry focuses the graph on that subtree', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-dependencies').click();

    const svg = page.getByTestId('dependency-svg');
    const before = await svg.locator('.graph-node').count();

    // Focus the top blocker via the leaderboard.
    await page.getByTestId('leverage-list').locator('.leverage-row').first().click();

    const banner = page.getByTestId('graph-focus-banner');
    await expect(banner).toBeVisible();
    // The focused view shows a strict subset of the full graph.
    await expect(svg.locator('.graph-node.is-focused')).toHaveCount(1);
    const after = await svg.locator('.graph-node').count();
    expect(after).toBeLessThan(before);

    // "Show full graph" restores the full graph without changing done visibility.
    await page.getByTestId('graph-show-all').click();
    await expect(banner).toBeHidden();
    await expect(page.getByTestId('graph-show-done')).toBeChecked();
    await expect(svg.locator('.graph-node')).toHaveCount(before);
  });
});
