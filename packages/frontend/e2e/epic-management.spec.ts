import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Keep the bundled fixture in use when a local API happens to be running.
  await page.route('**/api/dataset', (route) => route.abort());
});

test('a selected epic does not open its configuration dialog until Configure is clicked', async ({ page }) => {
  await page.goto('/?tab=configuration&epics=CKT');

  const dialog = page.getByRole('dialog', { name: /CKT.*Checkout Revamp/i });
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Configure', exact: true }).first().click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  await expect(dialog).toBeHidden();
});
