import { expect, test } from '@playwright/test';
import type { BandwidthCheckIn, BandwidthDay, DomainDataset } from '@ecp/shared';
import fixture from '../src/fixtures/dataset.json' with { type: 'json' };

const date = '2026-08-13';
const timestamp = '2026-08-20T12:00:00.000Z';

test('backs up multiple historical bandwidth check-ins from a calendar day and restores focus', async ({ page }) => {
  const dataset = structuredClone(fixture) as DomainDataset;
  const [first, second] = dataset.members;
  if (!first || !second) throw new Error('The fixture needs two members.');
  let checkIns: BandwidthCheckIn[] = [];
  let patchBody: unknown;
  const day = (): BandwidthDay => ({ teamId: first.teamId, date, checkIns, standup: null });

  await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic', jiraRequestDebug: false } }));
  await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
  await page.route('**/api/bandwidth-check-ins**', (route) => route.fulfill({ json: { checkIns } }));
  await page.route('**/api/teams/*/bandwidth-check-ins/*', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: day() });
    patchBody = route.request().postDataJSON();
    const body = patchBody as { upserts: Array<{ memberId: string; feeling: BandwidthCheckIn['feeling']; note?: string | null }>; deleteMemberIds: string[] };
    const retained = checkIns.filter((entry) => !body.deleteMemberIds.includes(entry.memberId));
    checkIns = [...retained.filter((entry) => !body.upserts.some((change) => change.memberId === entry.memberId)), ...body.upserts.map((change) => ({ ...change, date, sessionId: null, createdAt: timestamp, updatedAt: timestamp }))];
    return route.fulfill({ json: day() });
  });

  await page.setViewportSize({ width: 960, height: 1000 });
  await page.goto('/?tab=team');
  const dayButton = page.getByRole('button', { name: /2026-08-13:/ });
  await dayButton.click();
  const dialog = page.getByRole('dialog', { name: /Bandwidth check-ins/ });
  await expect(dialog).toContainText('0 of');

  const firstRow = dialog.locator('.bandwidth-member-row').filter({ hasText: first.name }).first();
  const secondRow = dialog.locator('.bandwidth-member-row').filter({ hasText: second.name }).first();
  const optionWidths = await firstRow.locator('.bandwidth-feeling-option').evaluateAll((options) => options.map((option) => option.getBoundingClientRect().width));
  expect(Math.min(...optionWidths)).toBeGreaterThan(120);
  await firstRow.getByRole('radio', { name: 'Yellow' }).check();
  await firstRow.getByRole('button', { name: 'Add note' }).click();
  await firstRow.getByLabel(`Note for ${first.name} (optional)`).fill('Interrupt load');
  await secondRow.getByRole('radio', { name: 'Purple' }).check();
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(dialog).toHaveCount(0);
  expect(patchBody).toEqual({
    upserts: [
      { memberId: first.id, feeling: 'yellow', note: 'Interrupt load' },
      { memberId: second.id, feeling: 'purple', note: null },
    ],
    deleteMemberIds: [],
  });
  await expect(dayButton).toBeFocused();
  await expect(dayButton).toHaveAccessibleName(/2 reports; average signal/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await dayButton.click();
  const narrowDialog = page.getByRole('dialog');
  await expect(narrowDialog).toBeVisible();
  expect(await narrowDialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('shows a Standup-managed historical day without a calendar save action', async ({ page }) => {
  const dataset = structuredClone(fixture) as DomainDataset;
  const first = dataset.members[0];
  if (!first) throw new Error('The fixture needs one member.');
  const sessionDay: BandwidthDay = { teamId: first.teamId, date, checkIns: [], standup: { sessionId: 'standup-history', status: 'completed', committedAt: timestamp } };

  await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic', jiraRequestDebug: false } }));
  await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
  await page.route('**/api/bandwidth-check-ins**', (route) => route.fulfill({ json: { checkIns: [] } }));
  await page.route('**/api/teams/*/bandwidth-check-ins/*', (route) => route.fulfill({ json: sessionDay }));

  await page.goto('/?tab=team');
  await page.getByRole('button', { name: /2026-08-13: 0 reports; Open historical check-ins/ }).click();
  const dialog = page.getByRole('dialog', { name: /Bandwidth check-ins/ });
  await expect(dialog).toContainText(/Captured in Standup/);
  await expect(dialog.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
});
