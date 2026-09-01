import type { DomainDataset, PlannedPlacement, SyncChange, Team, TeamMember } from '@ecp/shared';

/**
 * What a sync did, for the API response / logs.
 */
export interface ReconcileSummary {
  epics: number;
  stories: number;
  workItems: number;
  dependencies: number;
  sprints: number;
  /** Members newly discovered from Jira assignees this sync. */
  membersAdded: number;
  membersTotal: number;
  placementsKept: number;
  /** Completed work pulled from its slot, freeing that week's capacity. */
  placementsPulledDone: number;
  /** Placements dropped because their work item no longer exists in Jira. */
  placementsDroppedMissingItem: number;
  /** Placements dropped because their sprint no longer exists in Jira. */
  placementsDroppedMissingSprint: number;
  /** Previously-unplaced work slotted from Jira sprint assignments. */
  placementsAddedFromJira: number;
  /** Jira sprint assignments that disagree with preserved local placements. */
  placementConflicts: number;
  epicsArchived: number;
  epicsReactivated: number;
}

export interface ReconcileResult {
  merged: DomainDataset;
  summary: ReconcileSummary;
  /** Itemized log of what this sync changed, for the sync-log UI. */
  changes: SyncChange[];
}

/**
 * Merge freshly-imported Jira **facts** (`incoming`) onto the local database
 * (`current`), preserving locally-owned **intent** (project plan §7):
 *
 * - **Facts (Jira owns → replaced):** epics, stories, work items, dependencies,
 *   sprints.
 * - **Intent (local owns → preserved):** PTO, on-call, velocity overrides,
 *   milestones ("relevant days"), settings/knobs, team cadence, per-member
 *   base velocity, and — the artifact the whole tool exists for — Gantt
 *   `planned_placement`s.
 *
 * Placement upkeep on sync: a placement is dropped if its work item vanished
 * from Jira or its sprint no longer exists, and a work item that comes back
 * `Done` is auto-pulled from its slot (a finished ticket needs no capacity
 * reservation). Jira-discovered people are added as inactive so only a manager
 * can make them part of the active team; a member with no current assignments
 * is kept (they carry PTO / velocity config).
 *
 * Pure and deterministic (no DB, no clock): the caller persists `merged` with
 * the usual transactional {@link import('./persist.js').writeDataset}.
 */
export function reconcileDataset(current: DomainDataset, incoming: DomainDataset, syncedAt = '1970-01-01T00:00:00.000Z'): ReconcileResult {
  const changes: SyncChange[] = [];

  // --- Team: keep local cadence/name; refresh the anchor from synced sprints.
  const currentTeamsById = new Map(current.teams.map((t) => [t.id, t]));
  const mergedTeams: Team[] = [...current.teams];
  for (const inc of incoming.teams) {
    const existing = currentTeamsById.get(inc.id);
    if (existing) {
      existing.sprintAnchorDate = inc.sprintAnchorDate;
    } else {
      mergedTeams.push(inc);
    }
  }

  // --- Members: accrete, matched by Jira account link. Existing members keep
  //     their local capacity attributes (base velocity, active, id) and local
  //     PTO/on-call; Jira only refreshes the display name. A member the user
  //     set up by hand and linked to a Jira account (jiraAccountId) absorbs the
  //     matching assignee instead of spawning a duplicate. Unmatched assignees
  //     are retained as inactive until a manager explicitly activates them.
  const mergedMembers: TeamMember[] = current.members.map((m) => ({ ...m }));
  const byAccount = new Map<string, TeamMember>();
  for (const m of mergedMembers) {
    if (m.jiraAccountId) byAccount.set(m.jiraAccountId, m);
  }
  // Jira accountId → the local member id it resolves to, for assignee remapping.
  const accountToMemberId = new Map<string, string>();
  let membersAdded = 0;
  for (const inc of incoming.members) {
    const account = inc.jiraAccountId ?? inc.id;
    // Prefer an explicit link; fall back to legacy members whose id *is* the
    // accountId (imported before the link field existed).
    const local = byAccount.get(account) ?? mergedMembers.find((m) => m.id === account);
    if (local) {
      local.name = inc.name;
      if (inc.avatarUrl) local.avatarUrl = inc.avatarUrl; // refresh from Jira
      if (!local.jiraAccountId) local.jiraAccountId = account; // backfill the link
      accountToMemberId.set(account, local.id);
    } else {
      const added: TeamMember = { ...inc, jiraAccountId: account, active: false };
      mergedMembers.push(added);
      byAccount.set(account, added);
      accountToMemberId.set(account, added.id);
      membersAdded += 1;
      changes.push({ category: 'member-added', entity: added.name, detail: `Inactive teammate ${added.name} discovered from Jira` });
    }
  }
  const memberIds = new Set(mergedMembers.map((m) => m.id));
  const memberName = (id: string | null): string =>
    (id && mergedMembers.find((m) => m.id === id)?.name) || 'Unassigned';

  // Incoming work items carry the Jira accountId as their assignee; rewrite it
  // to whatever local member that account resolved to above.
  const remappedWorkItems = incoming.workItems.map((w) => ({
    ...w,
    assigneeId: w.assigneeId ? (accountToMemberId.get(w.assigneeId) ?? null) : null,
  }));

  // --- Work items: diff facts against what we last held, for the sync log.
  const currentItems = new Map(current.workItems.map((w) => [w.key, w]));
  const incomingKeys = new Set(remappedWorkItems.map((w) => w.key));
  for (const w of remappedWorkItems) {
    const prev = currentItems.get(w.key);
    if (!prev) {
      changes.push({ category: 'item-added', entity: w.key, detail: `Added “${w.title}” (${w.points} pts, ${w.status})` });
      continue;
    }
    if (prev.status !== w.status) {
      changes.push({ category: 'status', entity: w.key, detail: `Status ${prev.status} → ${w.status}` });
    }
    if (prev.points !== w.points) {
      changes.push({ category: 'points', entity: w.key, detail: `Story points ${prev.points} → ${w.points}` });
    }
    if ((prev.isEstimated === false) !== (w.isEstimated === false)) {
      changes.push({ category: 'points', entity: w.key, detail: w.isEstimated === false ? 'Story point estimate removed' : `Story point estimate added (${w.points} pts)` });
    }
    if ((prev.assigneeId ?? null) !== (w.assigneeId ?? null)) {
      changes.push({ category: 'assignee', entity: w.key, detail: `Reassigned ${memberName(prev.assigneeId ?? null)} → ${memberName(w.assigneeId ?? null)}` });
    }
  }
  for (const w of current.workItems) {
    if (!incomingKeys.has(w.key)) {
      changes.push({ category: 'item-removed', entity: w.key, detail: `“${w.title}” is no longer in Jira` });
    }
  }

  // --- Sprints: added / removed since last sync.
  const currentSprintIds = new Set(current.sprints.map((s) => s.id));
  const incomingSprintById = new Map(incoming.sprints.map((s) => [s.id, s]));
  for (const s of incoming.sprints) {
    if (!currentSprintIds.has(s.id)) {
      changes.push({ category: 'sprint-added', entity: s.name, detail: `New sprint ${s.name} (${s.startDate} → ${s.endDate})` });
    }
  }
  for (const s of current.sprints) {
    if (!incomingSprintById.has(s.id)) {
      changes.push({ category: 'sprint-removed', entity: s.name, detail: `Sprint ${s.name} no longer exists in Jira` });
    }
  }

  // --- Placements: preserve local intent, pruning stale / completed slots, then
  //     fill unplaced work from Jira sprint assignments when available.
  const incomingItems = new Map(remappedWorkItems.map((w) => [w.key, w]));
  const incomingSprintIds = new Set(incoming.sprints.map((s) => s.id));
  const incomingJiraPlacementKeys = new Set(incoming.placements.map((p) => p.workItemKey));
  const isJiraSuggestedPlacement = (placement: PlannedPlacement): boolean =>
    placement.id.startsWith('jira-') && placement.id.endsWith('-sprint');
  const keptPlacements: PlannedPlacement[] = [];
  let placementsPulledDone = 0;
  let placementsDroppedMissingItem = 0;
  let placementsDroppedMissingSprint = 0;
  for (const p of current.placements) {
    const item = incomingItems.get(p.workItemKey);
    if (!item) {
      placementsDroppedMissingItem += 1;
      changes.push({ category: 'placement-dropped', entity: p.workItemKey, detail: 'Removed from the plan — no longer in Jira' });
    } else if (item.status === 'Done') {
      placementsPulledDone += 1;
      changes.push({ category: 'placement-pulled', entity: p.workItemKey, detail: 'Completed — pulled from its week, freeing capacity' });
    } else if (!incomingSprintIds.has(p.sprintId)) {
      placementsDroppedMissingSprint += 1;
      changes.push({ category: 'placement-dropped', entity: p.workItemKey, detail: 'Removed from the plan — its sprint no longer exists' });
    } else if (isJiraSuggestedPlacement(p)) {
      if (!incomingJiraPlacementKeys.has(p.workItemKey)) {
        changes.push({
          category: 'placement-dropped',
          entity: p.workItemKey,
          detail: 'Removed from the plan — Jira no longer assigns a sprint',
        });
      }
      // Jira-generated suggestions are replaced by the fresh incoming facts
      // below. Human-authored placements keep their existing precedence.
    } else {
      keptPlacements.push(p);
    }
  }
  const placedKeys = new Set(keptPlacements.map((p) => p.workItemKey));
  const keptPlacementByItem = new Map(keptPlacements.map((p) => [p.workItemKey, p]));
  let placementsAddedFromJira = 0;
  let placementConflicts = 0;
  for (const p of incoming.placements) {
    const item = incomingItems.get(p.workItemKey);
    if (!item || item.status === 'Done') continue;
    if (!incomingSprintIds.has(p.sprintId)) continue;
    const existing = keptPlacementByItem.get(p.workItemKey);
    if (existing) {
      if (existing.sprintId !== p.sprintId || existing.weekIndex !== p.weekIndex) {
        placementConflicts += 1;
        changes.push({
          category: 'placement-conflict',
          entity: p.workItemKey,
          detail:
            `Ticket ${p.workItemKey} has moved in Jira to sprint ${p.sprintId}, week ${p.weekIndex + 1}, ` +
            `but conflicts with local placement in sprint ${existing.sprintId}, week ${existing.weekIndex + 1}`,
        });
      }
      continue;
    }
    keptPlacements.push(p);
    placedKeys.add(p.workItemKey);
    keptPlacementByItem.set(p.workItemKey, p);
    placementsAddedFromJira += 1;
    changes.push({
      category: 'placement-added',
      entity: p.workItemKey,
      detail: `Placed from Jira sprint assignment into sprint ${p.sprintId}, week ${p.weekIndex + 1}`,
    });
  }

  // --- Local intent kept as-is (with FK safety filters).
  const incomingEpicKeys = new Set(incoming.epics.map((e) => e.key));
  let epicsArchived = 0;
  let epicsReactivated = 0;
  const now = syncedAt;
  const refreshedEpics = incoming.epics.map((epic) => {
    const was = current.epics.find((e) => e.key === epic.key);
    if (was?.active === false) { epicsReactivated += 1; changes.push({ category: 'epic-reactivated', entity: epic.key, detail: 'Epic is active in the board scope again' }); return { ...epic, active: true, archivedAt: null, lastSeenAt: now }; }
    return epic;
  });
  const archivedEpics = current.epics.filter((e) => !incomingEpicKeys.has(e.key)).map((e) => {
    if (e.active !== false) { epicsArchived += 1; changes.push({ category: 'epic-archived', entity: e.key, detail: 'Epic left the active board scope; local planning history retained' }); }
    return { ...e, active: false, archivedAt: e.archivedAt ?? now };
  });
  const allEpics = [...refreshedEpics, ...archivedEpics];
  const epicKeys = new Set(allEpics.map((e) => e.key));
  const archivedStoryKeys = new Set(current.stories.filter((s) => archivedEpics.some((e) => e.key === s.epicKey)).map((s) => s.key));
  // Fresh Jira ownership wins by globally unique Jira key. A story or ticket
  // can move out of an epic during the same sync that the old epic leaves the
  // active board scope. Preserve the rest of the archived history, but never
  // retain the stale copy under its former parent.
  const incomingStoryKeys = new Set(incoming.stories.map((s) => s.key));
  const retainedArchivedStories = current.stories.filter(
    (s) => archivedStoryKeys.has(s.key) && !incomingStoryKeys.has(s.key),
  );
  const retainedArchivedWorkItems = current.workItems.filter(
    (w) => archivedStoryKeys.has(w.storyKey) && !incomingKeys.has(w.key),
  );
  const allStories = [...incoming.stories, ...retainedArchivedStories];
  const allWorkItems = [...remappedWorkItems, ...retainedArchivedWorkItems];
  const allItemKeys = new Set(allWorkItems.map((w) => w.key));
  const allDependencies = [...incoming.dependencies, ...current.dependencies.filter((d) => allItemKeys.has(d.blockerItemKey) && allItemKeys.has(d.blockedItemKey) && !incoming.dependencies.some((x) => x.id === d.id))];
  const milestones = current.milestones.filter((m) => epicKeys.has(m.epicKey));
  const pto = current.pto.filter((p) => memberIds.has(p.memberId));
  const oncall = current.oncall.filter((o) => memberIds.has(o.memberId));
  const velocityOverrides = current.velocityOverrides.filter((v) => memberIds.has(v.memberId));
  const bandwidthCheckIns = (current.bandwidthCheckIns ?? []).filter((entry) => memberIds.has(entry.memberId));

  // --- Settings: union by identity, local edits win; add any new defaults.
  const settingKey = (s: { key: string; scope: string; scopeId: string | null }) =>
    `${s.scope}::${s.scopeId ?? ''}::${s.key}`;
  const mergedSettings = [...current.settings];
  const haveSetting = new Set(current.settings.map(settingKey));
  for (const s of incoming.settings) {
    if (!haveSetting.has(settingKey(s))) mergedSettings.push(s);
  }

  const merged: DomainDataset = {
    teams: mergedTeams,
    members: mergedMembers,
    velocityOverrides,
    pto,
    oncall,
    holidays: current.holidays ?? [],
    bandwidthCheckIns,
    epics: allEpics,
    portfolioEpics: current.portfolioEpics,
    epicEstimates: (current.epicEstimates ?? []).filter((estimate) => epicKeys.has(estimate.epicKey)),
    epicSmes: (current.epicSmes ?? []).filter((sme) => epicKeys.has(sme.epicKey) && memberIds.has(sme.memberId)),
    milestones,
    importantDates: current.importantDates ?? [],
    stories: allStories,
    workItems: allWorkItems,
    dependencies: allDependencies,
    sprints: incoming.sprints,
    placements: keptPlacements,
    settings: mergedSettings,
  };

  return {
    merged,
    changes,
    summary: {
      epics: incoming.epics.length,
      stories: incoming.stories.length,
      workItems: incoming.workItems.length,
      dependencies: incoming.dependencies.length,
      sprints: incoming.sprints.length,
      membersAdded,
      membersTotal: mergedMembers.length,
      placementsKept: keptPlacements.length,
      placementsPulledDone,
      placementsDroppedMissingItem,
      placementsDroppedMissingSprint,
      placementsAddedFromJira,
      placementConflicts,
      epicsArchived,
      epicsReactivated,
    },
  };
}
