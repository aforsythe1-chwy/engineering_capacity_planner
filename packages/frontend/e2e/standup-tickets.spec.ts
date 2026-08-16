import { expect, test } from '@playwright/test';
import type { DomainDataset, StandupMemberTicketContext } from '@ecp/shared';
import fixture from '../src/fixtures/dataset.json' with { type: 'json' };

const capturedAt = '2026-08-16T13:43:00.000Z';

function ticketContext(memberId: string): StandupMemberTicketContext {
  return {
    memberId,
    capturedAt,
    source: 'jira',
    freshness: 'fresh',
    errorMessage: null,
    truncated: false,
    tickets: [
      { key: 'PLAN-101', url: 'https://jira.example.test/browse/PLAN-101', summary: 'Implement a deliberately long ticket summary that verifies two-line clamping without causing horizontal overflow in the standup dialog.', status: 'In Progress', statusId: 'progress', statusCategory: 'indeterminate', assigneeAccountId: null, assigneeName: null, parentKey: null, parentSummary: null },
      { key: 'PLAN-102', url: 'https://jira.example.test/browse/PLAN-102', summary: 'Review the compact ticket-list treatment', status: 'In Review', statusId: 'review', statusCategory: 'indeterminate', assigneeAccountId: null, assigneeName: null, parentKey: null, parentSummary: null },
      { key: 'PLAN-103', url: null, summary: 'Unlinked ticket remains noninteractive', status: 'In Review', statusId: 'review', statusCategory: 'indeterminate', assigneeAccountId: null, assigneeName: null, parentKey: null, parentSummary: null },
      { key: 'PLAN-104', url: 'https://jira.example.test/browse/PLAN-104', summary: 'Completed delivery work', status: 'Done', statusId: 'done', statusCategory: 'done', assigneeAccountId: null, assigneeName: null, parentKey: null, parentSummary: null },
    ],
  };
}

test('renders compact, accessible standup ticket groups without responsive overflow', async ({ page }) => {
  const dataset = structuredClone(fixture) as DomainDataset;
  const [first, second] = dataset.members;
  if (!first || !second) throw new Error('The fixture needs two members for the standup harness.');
  const session = { id: 'standup-visual', teamId: first.teamId, date: '2026-08-16', sprintId: 'sprint-1', sprintName: 'Synthetic sprint', status: 'active' as const, startedAt: capturedAt, updatedAt: capturedAt, completedAt: null, revision: 1 };
  const aggregate = { session, participants: [
    { sessionId: session.id, memberId: first.id, memberName: first.name, position: 0, disposition: 'pending' as const, resolvedAt: null },
    { sessionId: session.id, memberId: second.id, memberName: second.name, position: 1, disposition: 'pending' as const, resolvedAt: null },
  ], notes: [] };

  await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
  await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic', jiraRequestDebug: false } }));
  await page.route('**/api/standups/start', (route) => route.fulfill({ json: aggregate }));
  await page.route('**/api/standups/standup-visual/participants/*/tickets**', (route) => {
    const memberId = route.request().url().split('/participants/')[1]!.split('/')[0]!;
    return route.fulfill({ json: ticketContext(memberId) });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?tab=standup');
  await page.getByRole('button', { name: 'Start Standup' }).click();

  const tickets = page.locator('.standup-tickets');
  await expect(tickets.getByRole('heading', { name: /Sprint tickets/ })).toBeVisible();
  await expect(tickets.getByRole('list')).toHaveCount(3);
  await expect(tickets.locator('li')).toHaveCount(4);
  await expect(tickets.getByRole('heading', { name: /In Review.*2 tickets/i })).toBeVisible();
  await expect(tickets.locator('time')).toHaveAttribute('dateTime', capturedAt);

  const linkedKey = tickets.getByRole('link', { name: 'PLAN-101, opens in a new tab' });
  await expect(linkedKey).toHaveAttribute('target', '_blank');
  await expect(linkedKey).toHaveAttribute('rel', 'noreferrer');
  await expect(tickets.getByRole('link', { name: /PLAN-103/ })).toHaveCount(0);
  await expect(tickets.locator('.tone-done')).toBeVisible();
  await expect(tickets.getByText(/Implement a deliberately long ticket summary/)).toHaveAttribute('title', /Implement a deliberately long ticket summary/);

  for (let index = 0; index < 20 && !await linkedKey.evaluate((element) => element === document.activeElement); index += 1) {
    await page.keyboard.press('Tab');
  }
  await expect(linkedKey).toBeFocused();
  expect(await linkedKey.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(tickets.getByRole('list')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
