import { expect, test } from '@playwright/test';

test.describe('Increment Planner tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/dataset', (route) => route.fulfill({ status: 503, json: { error: 'Use bundled fixture' } }));
    await page.route('**/health', (route) => route.fulfill({ status: 503, json: { error: 'Use bundled fixture' } }));
  });

  test('opens with the PDF-inspired sample and supports local planning edits', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/?tab=increments');

    await expect(page.getByTestId('increment-planner')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ops Task Manager delivery map' })).toBeVisible();
    await expect(page.locator('.react-flow__node-increment')).toHaveCount(10);
    await expect(page.locator('.react-flow__node-sprint')).toHaveCount(4);
    await expect(page.locator('.react-flow__edge')).not.toHaveCount(0);
    await expect(page.locator('.increment-route-edge')).toHaveCount(12);
    await expect(page.getByText('blocks', { exact: true })).toHaveCount(0);
    await expect(page.getByText('proposed', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('jira-key-link-NF-2771')).toBeVisible();

    await page.locator('.react-flow__edge-interaction').first().dispatchEvent('click');
    await expect(page.locator('.increment-edge-badge')).toBeVisible();

    await page.locator('.react-flow__node-increment').filter({ hasText: 'Login & Page Access' }).dispatchEvent('click');
    await expect(page.locator('.increment-inspector input').first()).toHaveValue('Login & Page Access');
    await page.getByRole('button', { name: 'Place' }).first().click();
    await expect(page.getByTestId('jira-key-link-NF-2772').last()).toBeVisible();

    await page.getByRole('button', { name: '＋ Add increment' }).click();
    await expect(page.locator('.react-flow__node-increment')).toHaveCount(11);
    await expect(page.locator('.increment-inspector input').first()).toHaveValue('New increment');

    await page.getByRole('button', { name: 'Reset local sample' }).click();
    await expect(page.locator('.react-flow__node-increment')).toHaveCount(10);
  });

  test('renders the canvas cleanly at desktop and narrow widths', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/?tab=increments');
    await expect(page.getByTestId('increment-canvas')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/increment-planner/desktop.png', fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('increment-canvas')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/increment-planner/narrow.png', fullPage: true });
  });
});
