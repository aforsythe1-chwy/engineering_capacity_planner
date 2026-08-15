import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Keep the bundled fixture in use when a local API happens to be running.
  await page.route('**/api/dataset', (route) => route.abort());
});

test('a selected epic configuration dialog stays closed after Close is clicked', async ({ page }) => {
  await page.goto('/?tab=configuration&epics=CKT');

  const dialog = page.getByRole('dialog', { name: /CKT.*Checkout Revamp/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  await expect(dialog).toBeHidden();
});
