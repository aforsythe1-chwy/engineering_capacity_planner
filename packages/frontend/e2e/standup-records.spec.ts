import { expect, test } from '@playwright/test';
import type { DomainDataset, StandupSession } from '@ecp/shared';
import type { StandupAggregate } from '../src/data/api';
import fixture from '../src/fixtures/dataset.json' with { type: 'json' };

const capturedAt = '2026-08-30T09:00:00.000Z';

function session(id: string, teamId: string, date: string, status: StandupSession['status']): StandupSession {
  return { id, teamId, date, sprintId: 'sprint-1', sprintName: 'Synthetic sprint', status, startedAt: capturedAt, updatedAt: capturedAt, completedAt: status === 'completed' ? capturedAt : null, revision: 1 };
}

test('groups standup records into Monday-first cards and opens a historical record', async ({ page }) => {
  const dataset = structuredClone(fixture) as DomainDataset;
  const team = dataset.teams[0];
  if (!team) throw new Error('The fixture needs a team.');
  let sessions = [
    session('record-active', team.id, '2026-09-01', 'active'),
    session('record-completed', team.id, '2026-08-30', 'completed'),
    session('record-post', team.id, '2026-08-29', 'post_standup'),
    session('record-monday', team.id, '2026-08-24', 'completed'),
  ];
  const aggregate: StandupAggregate = { session: sessions[1]!, participants: [], notes: [], checkIns: [] };
  let starts = 0; let deleted = false;

  await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
  await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic', jiraRequestDebug: false, databaseMode: 'test-copy' } }));
  await page.route('**/api/standups/start', (route) => { starts += 1; return route.fulfill({ json: aggregate }); });
  await page.route('**/api/standups**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/standups') return route.fulfill({ json: { sessions } });
    if (pathname === '/api/standups/record-completed') {
      return route.fulfill({ json: aggregate });
    }
    if (pathname === '/api/standups/record-active' && route.request().method() === 'DELETE') { deleted = true; sessions = sessions.filter((item) => item.id !== 'record-active'); return route.fulfill({ status: 204 }); }
    return route.fallback();
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?tab=standup');

  const records = page.locator('.standup-session-list');
  await expect(records.getByRole('heading', { name: 'Standup records' })).toBeVisible();
  await expect(records.getByText('Complete', { exact: true })).toBeVisible();
  await expect(records.getByText('Incomplete', { exact: true })).toBeVisible();
  await expect(records.locator('.standup-records-week')).toHaveCount(2);
  await expect(records.getByTestId('standup-record-week-2026-08-31')).toBeVisible();
  await expect(records.getByTestId('standup-record-week-2026-08-24')).toBeVisible();
  await expect(records.getByTestId('standup-record-record-active')).toHaveAttribute('aria-label', /Tue Sep 1, 2026\. In progress\./);
  await expect(records.getByTestId('standup-record-record-post')).toHaveAttribute('aria-label', /Sat Aug 29, 2026\. Needs finishing\./);
  await expect(records.getByTestId('standup-record-record-completed')).toHaveAttribute('aria-label', /Sun Aug 30, 2026\. Completed\./);
  await expect(records.locator('.standup-record-card.is-complete')).toHaveCount(2);
  await expect(records.locator('.standup-record-card.is-incomplete')).toHaveCount(2);
  await expect(records.locator('.standup-record-card > svg')).toHaveCount(4);

  const completed = records.getByTestId('standup-record-record-completed');
  await completed.focus();
  await expect(completed).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Standup' })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('2026-08-30', { exact: false })).toBeVisible();
  expect(starts).toBe(0);

  await page.getByRole('button', { name: 'Close standup' }).click();
  const postStandup = records.getByTestId('standup-record-record-post');
  await postStandup.click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Actions for Sat Aug 29, 2026' })).toBeVisible();
  await page.keyboard.press('Escape');
  const active = records.getByTestId('standup-record-record-active');
  await active.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions for Tue Sep 1, 2026' });
  await expect(menu.getByRole('menuitem', { name: 'Delete standup' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await menu.getByRole('menuitem', { name: 'Delete standup' }).click();
  await expect.poll(() => deleted).toBe(true);
  await expect(active).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const scrollRegion = records.getByRole('region', { name: 'Standup records by week' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await scrollRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
});

test('keeps a record card in place and reports an error when its aggregate cannot load', async ({ page }) => {
  const dataset = structuredClone(fixture) as DomainDataset;
  const team = dataset.teams[0];
  if (!team) throw new Error('The fixture needs a team.');
  const sessions = [session('record-failure', team.id, '2026-08-24', 'completed')];

  await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
  await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic', jiraRequestDebug: false } }));
  await page.route('**/api/standups**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/standups') return route.fulfill({ json: { sessions } });
    if (pathname === '/api/standups/record-failure') return route.fulfill({ status: 500, json: { error: 'Standup record is temporarily unavailable.' } });
    return route.fallback();
  });

  await page.goto('/?tab=standup');
  const record = page.getByTestId('standup-record-record-failure');
  await record.click();
  await expect(record).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Standup record is temporarily unavailable.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('hides weekend columns and cards when the backend is not in test mode', async ({ page }) => {
  const dataset = structuredClone(fixture) as DomainDataset;
  const team = dataset.teams[0];
  if (!team) throw new Error('The fixture needs a team.');
  const sessions = [
    session('record-friday', team.id, '2026-08-28', 'completed'),
    session('record-saturday', team.id, '2026-08-29', 'post_standup'),
    session('record-sunday', team.id, '2026-08-30', 'active'),
  ];

  await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
  await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic', jiraRequestDebug: false, databaseMode: 'persistent' } }));
  await page.route('**/api/standups**', (route) => route.fulfill({ json: { sessions } }));

  await page.goto('/?tab=standup');
  const records = page.locator('.standup-session-list');
  const weekdays = records.locator('.standup-records-weekdays');
  await expect(weekdays.getByText('Mon', { exact: true })).toBeVisible();
  await expect(weekdays.getByText('Fri', { exact: true })).toBeVisible();
  await expect(weekdays.getByText('Sat', { exact: true })).toHaveCount(0);
  await expect(weekdays.getByText('Sun', { exact: true })).toHaveCount(0);
  await expect(records.getByTestId('standup-record-record-friday')).toBeVisible();
  await expect(records.getByTestId('standup-record-record-saturday')).toHaveCount(0);
  await expect(records.getByTestId('standup-record-record-sunday')).toHaveCount(0);
});

test('keeps an unfinished record and reports a protected-delete error from its right-click menu', async ({ page }) => {
  const dataset = structuredClone(fixture) as DomainDataset;
  const team = dataset.teams[0];
  if (!team) throw new Error('The fixture needs a team.');
  const sessions = [session('record-protected', team.id, '2026-08-24', 'post_standup')];

  await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
  await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic', jiraRequestDebug: false } }));
  await page.route('**/api/standups**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/standups') return route.fulfill({ json: { sessions } });
    if (pathname === '/api/standups/record-protected' && route.request().method() === 'DELETE') return route.fulfill({ status: 409, json: { error: 'This standup cannot be deleted because it has intake awareness history.' } });
    return route.fallback();
  });

  await page.goto('/?tab=standup');
  const record = page.getByTestId('standup-record-record-protected');
  await record.click({ button: 'right' });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('menuitem', { name: 'Delete standup' }).click();
  await expect(record).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('This standup cannot be deleted because it has intake awareness history.');
});
