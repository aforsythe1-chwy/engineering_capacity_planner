import { expect, test } from '@playwright/test';
import type { DomainDataset } from '@ecp/shared';
import type { StandupAggregate } from '../src/data/api';
import fixture from '../src/fixtures/dataset.json' with { type: 'json' };

const capturedAt = '2026-08-19T20:00:00.000Z';

test('uses @ mentions and compact audience chips when adding standup notes', async ({ page }) => {
  const dataset = structuredClone(fixture) as DomainDataset;
  const [first, second] = dataset.members;
  if (!first || !second) throw new Error('The fixture needs two team members.');
  const session = { id: 'standup-notes', teamId: first.teamId, date: '2026-08-19', sprintId: 'sprint-1', sprintName: 'Synthetic sprint', status: 'active' as const, startedAt: capturedAt, updatedAt: capturedAt, completedAt: null, revision: 1 };
  let aggregate: StandupAggregate = { session, participants: [{ sessionId: session.id, memberId: first.id, memberName: first.name, position: 0, disposition: 'pending', resolvedAt: null }], notes: [{ id: 'existing-note', sessionId: session.id, body: 'Testing something here', allTeam: false, memberIds: [second.id], position: 0, createdAt: capturedAt, updatedAt: capturedAt, state: 'open', completedAt: null, deferredAt: null, sourceNoteId: null, sourceSessionDate: null, mentions: [{ kind: 'member', id: second.id, label: second.name }] }, { id: 'second-note', sessionId: session.id, body: 'Testing another follow-up', allTeam: true, memberIds: [], position: 1, createdAt: capturedAt, updatedAt: capturedAt, state: 'open', completedAt: null, deferredAt: null, sourceNoteId: null, sourceSessionDate: null, mentions: [] }], checkIns: [] };
  const noteBodies: unknown[] = [];
  const reorderBodies: unknown[] = [];

  await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
  await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic', jiraRequestDebug: false } }));
  await page.route('**/api/standups/start', (route) => route.fulfill({ json: aggregate }));
  await page.route('**/api/standups/standup-notes/participants/*/tickets**', (route) => route.fulfill({ json: { memberId: first.id, capturedAt, source: 'snapshot', freshness: 'fresh', errorMessage: null, truncated: false, tickets: [] } }));
  await page.route('**/api/standups/standup-notes/notes', async (route) => {
    noteBodies.push(route.request().postDataJSON());
    aggregate = { ...aggregate, session: { ...aggregate.session, revision: aggregate.session.revision + 1 } };
    await route.fulfill({ json: aggregate });
  });
  await page.route('**/api/standups/standup-notes/notes/order', async (route) => {
    const body = route.request().postDataJSON() as { noteIds: string[] };
    reorderBodies.push(body);
    const positions = new Map(body.noteIds.map((id, index) => [id, index]));
    aggregate = { ...aggregate, session: { ...aggregate.session, revision: aggregate.session.revision + 1 }, notes: [...aggregate.notes].sort((left, right) => (positions.get(left.id) ?? 0) - (positions.get(right.id) ?? 0)).map((note, position) => ({ ...note, position })) };
    await route.fulfill({ json: aggregate });
  });

  await page.goto('/?tab=standup');
  await page.getByRole('button', { name: 'Start Standup' }).click();
  const noteSection = page.locator('.standup-notes');
  await expect(noteSection.getByRole('heading', { name: 'Post-standup notes' })).toBeVisible();
  await expect(noteSection.locator('.standup-notes-heading .badge')).toHaveAttribute('aria-label', '2 notes');
  const existingNotes = noteSection.locator('.standup-note-list .standup-note');
  await expect(existingNotes).toHaveCount(2);
  const firstNote = existingNotes.nth(0);
  const secondNote = existingNotes.nth(1);
  await expect(firstNote.getByText('Testing something here', { exact: true })).toBeVisible();
  await expect(firstNote.getByText(`For ${second.name}`, { exact: true })).toBeVisible();
  await expect(firstNote.getByRole('button', { name: /Reorder note/ })).toBeVisible();
  await expect(noteSection.getByRole('button', { name: 'Move note up' })).toHaveCount(0);
  await expect(noteSection.getByRole('button', { name: 'Move note down' })).toHaveCount(0);
  await expect(firstNote.getByRole('button', { name: 'Delete' })).toHaveClass(/danger/);
  const composer = page.locator('.standup-note-composer');
  await expect(composer.locator('.standup-note-composer-toolbar')).toBeVisible();
  await expect(composer.locator('.standup-note-composer-status')).toHaveCount(0);
  await expect(composer.getByText('@All Team', { exact: true })).toBeVisible();
  await expect(composer.locator('input[type="checkbox"], select[multiple]')).toHaveCount(0);

  const textarea = composer.getByRole('textbox', { name: 'New post-standup note' });
  await textarea.fill('Follow up with the team');
  await composer.getByRole('button', { name: 'Add note' }).click();
  await expect.poll(() => noteBodies.length).toBe(1);
  expect(noteBodies[0]).toMatchObject({ body: 'Follow up with the team', audience: { allTeam: true }, expectedRevision: 1 });
  await expect(composer.getByRole('button', { name: 'Add note' })).toBeDisabled();

  await textarea.fill(`@${first.name.split(' ')[0]}`);
  await expect(page.getByRole('option', { name: new RegExp(first.name) })).toBeVisible();
  await page.getByRole('option', { name: new RegExp(first.name) }).click();
  await expect(composer.getByText(first.name, { exact: true })).toBeVisible();
  await expect(composer.getByText('@All Team', { exact: true })).toHaveCount(0);
  await textarea.fill('Follow up directly');
  await composer.getByRole('button', { name: 'Add note' }).click();
  await expect.poll(() => noteBodies.length).toBe(2);
  expect(noteBodies[1]).toMatchObject({ body: 'Follow up directly', audience: { allTeam: false, mentions: [{ kind: 'member', id: first.id }] }, expectedRevision: 2 });
  const dragTarget = await secondNote.boundingBox();
  if (!dragTarget) throw new Error('The second note must be visible before reordering.');
  await firstNote.locator('.standup-note-drag-handle').hover();
  await page.mouse.down();
  await page.mouse.move(dragTarget.x + dragTarget.width / 2, dragTarget.y + dragTarget.height - 4);
  await expect(secondNote.locator('.standup-note-drop-preview.after')).toHaveText('Drop note here');
  await page.mouse.up();
  await expect.poll(() => reorderBodies.length).toBe(1);
  expect(reorderBodies[0]).toMatchObject({ noteIds: ['second-note', 'existing-note'], expectedRevision: 3 });
  await expect(existingNotes.nth(0).getByText('Testing another follow-up', { exact: true })).toBeVisible();
  await existingNotes.nth(0).getByRole('button', { name: /Reorder note/ }).press('ArrowDown');
  await expect.poll(() => reorderBodies.length).toBe(2);
  expect(reorderBodies[1]).toMatchObject({ noteIds: ['existing-note', 'second-note'], expectedRevision: 4 });
  await page.setViewportSize({ width: 390, height: 844 });
  await textarea.fill('@');
  await expect(page.getByRole('listbox')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('shows the people required for open post-standup follow-ups', async ({ page }) => {
  const dataset = structuredClone(fixture) as DomainDataset;
  const [first, second] = dataset.members;
  if (!first || !second) throw new Error('The fixture needs two team members.');
  const session = { id: 'post-standup-required', teamId: first.teamId, date: '2026-08-19', sprintId: 'sprint-1', sprintName: 'Synthetic sprint', status: 'post_standup' as const, startedAt: capturedAt, updatedAt: capturedAt, completedAt: null, revision: 1 };
  const aggregate: StandupAggregate = {
    session,
    participants: [
      { sessionId: session.id, memberId: first.id, memberName: first.name, position: 0, disposition: 'completed', resolvedAt: capturedAt },
      { sessionId: session.id, memberId: second.id, memberName: second.name, position: 1, disposition: 'completed', resolvedAt: capturedAt },
    ],
    notes: [
      { id: 'direct', sessionId: session.id, body: 'Follow up directly', allTeam: false, memberIds: [second.id], position: 0, createdAt: capturedAt, updatedAt: capturedAt, state: 'open', completedAt: null, deferredAt: null, sourceNoteId: null, sourceSessionDate: null, mentions: [{ kind: 'member', id: second.id, label: second.name }] },
      { id: 'all-team', sessionId: session.id, body: 'Review as a team', allTeam: true, memberIds: [], position: 1, createdAt: capturedAt, updatedAt: capturedAt, state: 'open', completedAt: null, deferredAt: null, sourceNoteId: null, sourceSessionDate: null, mentions: [] },
      { id: 'completed', sessionId: session.id, body: 'Already handled', allTeam: false, memberIds: [first.id], position: 2, createdAt: capturedAt, updatedAt: capturedAt, state: 'completed', completedAt: capturedAt, deferredAt: null, sourceNoteId: null, sourceSessionDate: null, mentions: [{ kind: 'member', id: first.id, label: first.name }] },
    ],
    checkIns: [],
  };

  await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
  await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic', jiraRequestDebug: false } }));
  await page.route('**/api/standups/start', (route) => route.fulfill({ json: aggregate }));
  await page.goto('/?tab=standup');
  await page.getByRole('button', { name: 'Start Standup' }).click();

  const required = page.getByTestId('standup-required-people');
  await expect(required.getByRole('heading', { name: 'Required people' })).toBeVisible();
  await expect(required.getByText(second.name, { exact: true })).toBeVisible();
  await expect(required.getByText('All team', { exact: true })).toBeVisible();
  await expect(required.getByText('1 follow-up', { exact: true })).toHaveCount(2);
  await expect(required.getByText('2', { exact: true })).toHaveAttribute('aria-label', '2 required audiences');
});

test('keeps progression controls visible while Current epics absorbs sidebar overflow', async ({ page }) => {
  const dataset = structuredClone(fixture) as DomainDataset;
  const [first, second] = dataset.members;
  const sourceEpic = dataset.epics[0];
  if (!first || !second || !sourceEpic) throw new Error('The fixture needs two members and one epic.');
  dataset.epics = Array.from({ length: 18 }, (_, index) => ({
    ...sourceEpic,
    key: `SCROLL-${index + 1}`,
    title: `Current epic ${index + 1} with enough text to retain the normal card height`,
  }));
  const session = { id: 'standup-sidebar-scroll', teamId: first.teamId, date: '2026-08-19', sprintId: 'sprint-1', sprintName: 'Synthetic sprint', status: 'active' as const, startedAt: capturedAt, updatedAt: capturedAt, completedAt: null, revision: 1 };
  let aggregate: StandupAggregate = {
    session,
    participants: [
      { sessionId: session.id, memberId: first.id, memberName: first.name, position: 0, disposition: 'pending', resolvedAt: null },
      { sessionId: session.id, memberId: second.id, memberName: second.name, position: 1, disposition: 'pending', resolvedAt: null },
    ],
    notes: Array.from({ length: 3 }, (_, index) => ({
      id: `sidebar-note-${index + 1}`,
      sessionId: session.id,
      body: `Follow-up note ${index + 1} keeps the sidebar populated.`,
      allTeam: true,
      memberIds: [],
      position: index,
      createdAt: capturedAt,
      updatedAt: capturedAt,
      state: 'open' as const,
      completedAt: null,
      deferredAt: null,
      sourceNoteId: null,
      sourceSessionDate: null,
      mentions: [],
    })),
    checkIns: [],
  };

  await page.route('**/api/dataset', (route) => route.fulfill({ json: dataset }));
  await page.route('**/health', (route) => route.fulfill({ json: { dataSource: 'synthetic', jiraRequestDebug: false } }));
  await page.route('**/api/standups/start', (route) => route.fulfill({ json: aggregate }));
  await page.route('**/api/standups/standup-sidebar-scroll/participants/*/tickets**', (route) => route.fulfill({ json: { memberId: first.id, capturedAt, source: 'snapshot', freshness: 'fresh', errorMessage: null, truncated: false, tickets: [] } }));
  await page.route('**/api/standups/standup-sidebar-scroll/notes', async (route) => {
    const body = route.request().postDataJSON() as { body: string };
    aggregate = {
      ...aggregate,
      session: { ...aggregate.session, revision: aggregate.session.revision + 1 },
      notes: [...aggregate.notes, {
        id: 'sidebar-note-added', sessionId: session.id, body: body.body, allTeam: true, memberIds: [], position: aggregate.notes.length,
        createdAt: capturedAt, updatedAt: capturedAt, state: 'open', completedAt: null, deferredAt: null, sourceNoteId: null, sourceSessionDate: null, mentions: [],
      }],
    };
    await route.fulfill({ json: aggregate });
  });
  await page.route('**/api/standups/standup-sidebar-scroll/notes/order', async (route) => {
    const body = route.request().postDataJSON() as { noteIds: string[] };
    const positions = new Map(body.noteIds.map((id, index) => [id, index]));
    aggregate = {
      ...aggregate,
      session: { ...aggregate.session, revision: aggregate.session.revision + 1 },
      notes: [...aggregate.notes].sort((left, right) => (positions.get(left.id) ?? 0) - (positions.get(right.id) ?? 0)).map((note, position) => ({ ...note, position })),
    };
    await route.fulfill({ json: aggregate });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?tab=standup');
  await page.getByRole('button', { name: 'Start Standup' }).click();

  const modal = page.locator('.standup-modal.is-active-round');
  const actions = page.locator('.standup-actions');
  const epics = page.getByTestId('standup-epic-scroll-region');
  const noteList = page.getByTestId('standup-compact-note-list');
  const notes = noteList.locator('.standup-note');
  await expect(actions.getByRole('button', { name: 'Skip' })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Next' })).toBeVisible();
  await expect(notes.locator('.standup-note-position')).toHaveText(['1', '2', '3']);
  expect(await noteList.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const [initialNoteListBox, secondNoteBox] = await Promise.all([noteList.boundingBox(), notes.nth(1).boundingBox()]);
  if (!initialNoteListBox || !secondNoteBox) throw new Error('The compact note viewport and second note must be measurable.');
  expect(secondNoteBox.y + secondNoteBox.height).toBeLessThanOrEqual(initialNoteListBox.y + initialNoteListBox.height + 1);
  expect(await epics.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  const assertFooterInsideModal = async () => {
    const [modalBox, actionsBox] = await Promise.all([modal.boundingBox(), actions.boundingBox()]);
    if (!modalBox || !actionsBox) throw new Error('The active modal and footer must be measurable.');
    expect(actionsBox.y).toBeGreaterThanOrEqual(modalBox.y);
    expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(modalBox.y + modalBox.height + 1);
  };
  await assertFooterInsideModal();

  await noteList.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const finalNote = notes.nth(2);
  const [noteListBox, finalNoteBox] = await Promise.all([noteList.boundingBox(), finalNote.boundingBox()]);
  if (!noteListBox || !finalNoteBox) throw new Error('The compact note viewport and final note must be measurable.');
  expect(finalNoteBox.y + finalNoteBox.height).toBeLessThanOrEqual(noteListBox.y + noteListBox.height + 1);
  await finalNote.getByRole('button', { name: /Reorder note/ }).press('ArrowUp');
  await expect(notes.nth(1).getByText('Follow-up note 3 keeps the sidebar populated.', { exact: true })).toBeVisible();
  await expect(notes.locator('.standup-note-position')).toHaveText(['1', '2', '3']);
  await assertFooterInsideModal();

  await epics.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const finalEpic = epics.getByText('SCROLL-18', { exact: true });
  await expect(finalEpic).toBeVisible();
  const [epicBox, finalEpicBox] = await Promise.all([epics.boundingBox(), finalEpic.boundingBox()]);
  if (!epicBox || !finalEpicBox) throw new Error('The epic scroll viewport and final card must be measurable.');
  expect(finalEpicBox.y + finalEpicBox.height).toBeLessThanOrEqual(epicBox.y + epicBox.height + 1);

  const composer = page.locator('.standup-note-composer');
  await composer.getByRole('textbox', { name: 'New post-standup note' }).fill('A fourth note must not displace the participant actions.');
  await composer.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('A fourth note must not displace the participant actions.', { exact: true })).toBeVisible();
  await expect(notes.locator('.standup-note-position')).toHaveText(['1', '2', '3', '4']);
  await assertFooterInsideModal();

  await page.setViewportSize({ width: 390, height: 844 });
  await noteList.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const addedNote = notes.nth(3);
  const [narrowListBox, addedNoteBox] = await Promise.all([noteList.boundingBox(), addedNote.boundingBox()]);
  if (!narrowListBox || !addedNoteBox) throw new Error('The narrow compact note viewport and added note must be measurable.');
  expect(addedNoteBox.y + addedNoteBox.height).toBeLessThanOrEqual(narrowListBox.y + narrowListBox.height + 1);
  await composer.getByRole('button', { name: 'Add note' }).scrollIntoViewIfNeeded();
  await expect(composer.getByRole('button', { name: 'Add note' })).toBeVisible();
  await actions.scrollIntoViewIfNeeded();
  await expect(actions.getByRole('button', { name: 'Next' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
