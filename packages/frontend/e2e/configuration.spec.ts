import { expect, test } from '@playwright/test';

const tracks = [
  { id: 'track-default', displayName: 'Default Anthem', originalFilename: 'default.mp3', mimeType: 'audio/mpeg', byteLength: 1024, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'track-custom', displayName: 'Custom Entrance', originalFilename: 'custom.mp3', mimeType: 'audio/mpeg', byteLength: 1024, createdAt: '2026-01-01T00:00:00.000Z' },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/dataset', (route) => route.abort());
  await page.route('**/api/standup/audio-tracks', (route) => route.fulfill({ json: tracks }));
  await page.route('**/api/teams/team-platform/standup-audio', (route) => route.fulfill({ json: {
    teamId: 'team-platform', defaultTrackId: 'track-default', memberAssignments: [
      { memberId: 'M2', mode: 'off', trackId: null },
      { memberId: 'M3', mode: 'track', trackId: 'track-custom' },
    ],
  } }));
});

test('groups configuration by responsibility and renders walk-off songs in the one team roster', async ({ page }) => {
  await page.goto('/?tab=configuration');

  await expect(page.getByRole('heading', { name: 'Portfolio planning', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Standup', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Jira and sync', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Data maintenance', exact: true })).toBeVisible();

  const roster = page.getByTestId('cfg-members');
  await expect(roster.locator('[data-testid^="cfg-member-"]')).toHaveCount(5);
  await expect(page.locator('.standup-audio-member')).toHaveCount(0);
  await expect(roster.getByText('Uses team default: Default Anthem').first()).toBeVisible();
  await expect(roster.getByText('No song')).toBeVisible();
  await expect(roster.getByText('Custom Entrance')).toBeVisible();
  await expect(page.getByTestId('team-availability-link')).toHaveCount(1);
});

test('keeps the consolidated Team panel usable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?tab=configuration');

  const availability = page.getByTestId('team-availability-link').getByRole('link', { name: 'Open Team availability' });
  await expect(availability).toBeVisible();
  const box = await availability.boundingBox();
  expect(box?.width).toBeGreaterThan(300);
  await expect(page.getByTestId('cfg-members').getByText('Custom Entrance')).toBeVisible();
});
