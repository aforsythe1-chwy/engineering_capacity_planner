import type { StandupStatusPresentationBoard, StandupStatusPresentationEntry, StandupStatusPresentationSetting, StandupTicket } from '@ecp/shared';

export interface DiscoveredStatus {
  id: string; name: string; category: string; columnName: string | null; boardOrder: number;
}

export interface StandupTicketGroup {
  identity: string;
  sourceStatus: string;
  displayName: string;
  configured: boolean;
  tickets: StandupTicket[];
}

export type StandupTicketGroupTone = 'new' | 'active' | 'done' | 'neutral';

/**
 * Keep the visual status signal tied to Jira's category, rather than an
 * organization-specific display label. A combined display group only reads as
 * new or done when every ticket agrees; unknown and mixed groups stay quiet.
 */
export function standupTicketGroupTone(tickets: StandupTicket[]): StandupTicketGroupTone {
  if (tickets.length && tickets.every((ticket) => ticket.statusCategory === 'done')) return 'done';
  if (tickets.length && tickets.every((ticket) => ticket.statusCategory === 'new')) return 'new';
  if (tickets.some((ticket) => ticket.statusCategory === 'indeterminate')) return 'active';
  return 'neutral';
}

export function parsePresentation(value: string | undefined): StandupStatusPresentationSetting | null {
  try { const parsed = value ? JSON.parse(value) : null; return parsed?.version === 1 && Array.isArray(parsed.boards) ? parsed : null; } catch { return null; }
}

export function boardPresentation(setting: StandupStatusPresentationSetting | null, boardId: string | null): StandupStatusPresentationBoard | null {
  return boardId ? setting?.boards.find((board) => board.boardId === boardId) ?? null : null;
}

export function mergeStatusDraft(boardId: string, boardName: string, discovered: DiscoveredStatus[], saved: StandupStatusPresentationBoard | null): StandupStatusPresentationBoard {
  const current = new Map(saved?.entries.map((entry) => [entry.statusId, entry]) ?? []);
  const entries = [...discovered].sort((a, b) => a.boardOrder - b.boardOrder).map((status) => {
    const old = current.get(status.id);
    current.delete(status.id);
    return { statusId: status.id, sourceName: status.name, sourceCategory: status.category, sourceColumnName: status.columnName, friendlyName: old?.friendlyName ?? status.name };
  });
  return { boardId, boardName, entries: [...entries, ...current.values()] };
}

export function resetStatusDraft(boardId: string, boardName: string, discovered: DiscoveredStatus[], saved: StandupStatusPresentationBoard | null): StandupStatusPresentationBoard {
  const current = new Map(saved?.entries.map((entry) => [entry.statusId, entry]) ?? []);
  const entries = [...discovered].sort((a, b) => a.boardOrder - b.boardOrder).map((status) => {
    current.delete(status.id);
    return { statusId: status.id, sourceName: status.name, sourceCategory: status.category, sourceColumnName: status.columnName, friendlyName: status.name };
  });
  return { boardId, boardName, entries: [...entries, ...current.values()] };
}

export function statusDraftErrors(entries: StandupStatusPresentationEntry[]): Map<string, string> {
  const errors = new Map<string, string>();
  for (const entry of entries) if (!entry.friendlyName.trim()) errors.set(entry.statusId, 'Enter a display name');
  return errors;
}

export function groupStandupTickets(tickets: StandupTicket[], entries: StandupStatusPresentationEntry[] | undefined): StandupTicketGroup[] {
  const configured = entries ?? []; const byId = new Map(configured.map((entry) => [entry.statusId, entry])); const byName = new Map(configured.map((entry) => [entry.sourceName, entry]));
  const groups = new Map<string, { tickets: StandupTicket[]; entry?: StandupStatusPresentationEntry; status: string; category: string }>();
  for (const ticket of tickets) { const entry = (ticket.statusId ? byId.get(ticket.statusId) : undefined) ?? byName.get(ticket.status); const identity = entry ? `configured:${entry.statusId}` : `raw:${ticket.statusId ?? ticket.status}`; const group = groups.get(identity) ?? { tickets: [], entry, status: ticket.status, category: ticket.statusCategory }; group.tickets.push(ticket); groups.set(identity, group); }
  const categoryOrder = (category: string) => category === 'new' ? 0 : category === 'indeterminate' ? 1 : category === 'done' ? 3 : 2;
  const ordered: StandupTicketGroup[] = [];
  const displayGroups = new Map<string, StandupTicketGroup>();
  for (const entry of configured) {
    const group = groups.get(`configured:${entry.statusId}`); if (!group) continue;
    const displayKey = entry.friendlyName.trim().toLocaleLowerCase();
    const existing = displayGroups.get(displayKey);
    if (existing) existing.tickets.push(...group.tickets);
    else displayGroups.set(displayKey, { identity: `display:${displayKey}`, sourceStatus: group.status, displayName: entry.friendlyName, configured: true, tickets: [...group.tickets] });
  }
  ordered.push(...displayGroups.values());
  return [...ordered, ...[...groups.entries()].filter(([identity]) => !identity.startsWith('configured:')).sort(([, a], [, b]) => categoryOrder(a.category) - categoryOrder(b.category) || a.status.localeCompare(b.status)).map(([identity, group]) => ({ identity, sourceStatus: group.status, displayName: group.status, configured: false, tickets: group.tickets }))];
}
