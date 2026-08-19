import { useEffect, useRef, useState } from 'react';
import { epicOwnerId, epicSmes, effectivePortfolioEpic, SETTING_KEYS, type DomainDataset, type EpicMilestone } from '@ecp/shared';
import { resolveEpicWorkload } from '@ecp/engine';
import * as api from '../data/api';
import { memberColorMap } from '../lib/memberColors';
import { MemberAvatar } from './MemberAvatar';
import { DatePicker } from './DatePicker';
import { Typeahead, type TypeaheadOption } from './Typeahead';

type Props = {
  dataset: DomainDataset;
  editable: boolean;
  onFilter: (keys: string[]) => void;
  onReload: () => Promise<void>;
};

const normal = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
const relevantDayNameOptions = [{ id: 'production-launch', label: 'Production Launch' }, { id: 'uat-testing-start', label: 'UAT Testing Start' }, { id: 'bug-bash', label: 'Bug Bash' }] as const satisfies readonly TypeaheadOption[];
const searchRelevantDayNames = async (query: string): Promise<TypeaheadOption[]> => {
  const normalized = query.trim().toLocaleLowerCase();
  return relevantDayNameOptions.filter((option) => !normalized || option.label.toLocaleLowerCase().includes(normalized));
};
/** Deterministic local fuzzy-ish ranking shared by the board and member pickers. */
export function rankLocal<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  const needle = normal(query);
  return items.slice().map((item) => {
    const haystack = normal(text(item));
    const at = needle ? haystack.indexOf(needle) : 0;
    return { item, score: at < 0 ? Number.POSITIVE_INFINITY : at + Math.max(0, haystack.length - needle.length) / 1000 };
  }).filter((entry) => entry.score !== Number.POSITIVE_INFINITY).sort((a, b) => a.score - b.score || text(a.item).localeCompare(text(b.item))).map((entry) => entry.item);
}

export function EpicManagementSection({ dataset, editable, onFilter, onReload }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutate = async (key: string, fn: () => Promise<unknown>) => {
    setBusyKey(key); setError(null);
    try { await fn(); await onReload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusyKey(null); }
  };
  const visible = dataset.epics.filter((epic) => epic.active !== false);
  const candidates = rankLocal(visible, query, (epic) => `${epic.key} ${epic.title}`);
  const tracked = visible.filter((epic) => effectivePortfolioEpic(dataset, epic.key).tracked);
  const removed = dataset.epics.filter((epic) => effectivePortfolioEpic(dataset, epic.key).scopeOverride === 'exclude');
  return <section className="panel epic-management" aria-labelledby="epics-heading">
    <div className="section-title"><h2 id="epics-heading">Epics</h2><span className="hint">Manage portfolio membership, targets, ownership, expertise, and Gantt rules in one place.</span></div>
    {error && <p className="config-error" role="alert">⚠ {error}</p>}
    <label className="tracked-search"><span>Find a board epic</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search epic key or title" aria-label="Find a board epic" /></label>
    {query && <div className="tracked-candidates" role="listbox" aria-label="Board epic candidates">{candidates.map((epic) => {
      const intent = effectivePortfolioEpic(dataset, epic.key); const unavailable = epic.active === false;
      return <div className="tracked-epic-row" role="option" aria-selected={intent.tracked} key={epic.key}><span className="tracked-epic-summary"><strong>{epic.key} — {epic.title}</strong><span>{epic.sourceStatus ?? 'Last synced'}{unavailable ? ' · archived' : ''}</span></span>{intent.tracked ? <span className="tracked-state">Tracked</span> : <button className="btn" type="button" disabled={!editable || busyKey === epic.key} onClick={() => mutate(epic.key, () => api.updatePortfolioEpic(epic.key, { scopeOverride: unavailable ? 'include' : 'auto', planningKind: intent.planningKind }))}>{unavailable ? 'Include anyway' : 'Add to plan'}</button>}</div>;
    })}</div>}
    <div className="tracked-list" aria-label="Tracked epics">{tracked.map((epic) => <EpicRow key={epic.key} epic={epic} dataset={dataset} editable={editable} expanded={expanded === epic.key} onExpand={() => setExpanded(expanded === epic.key ? null : epic.key)} onFilter={onFilter} busy={busyKey === epic.key} mutate={mutate} />)}</div>
    {removed.length > 0 && <div className="removed-epics"><h3>Removed from plan</h3>{removed.map((epic) => <EpicRow key={epic.key} epic={epic} dataset={dataset} editable={editable} expanded={false} onExpand={() => undefined} onFilter={onFilter} busy={busyKey === epic.key} mutate={mutate} removed />)}</div>}
  </section>;
}

function EpicRow({ epic, dataset, editable, expanded, onExpand, onFilter, busy, mutate, removed = false }: { epic: DomainDataset['epics'][number]; dataset: DomainDataset; editable: boolean; expanded: boolean; onExpand: () => void; onFilter: (keys: string[]) => void; busy: boolean; mutate: (key: string, fn: () => Promise<unknown>) => Promise<void>; removed?: boolean }) {
  const intent = effectivePortfolioEpic(dataset, epic.key);
  const relevantDays = dataset.milestones.filter((milestone) => milestone.epicKey === epic.key).sort((a, b) => a.date.localeCompare(b.date));
  const relevantDaysSummary = relevantDays.length ? `Relevant days: ${relevantDays.map((day) => `${day.name} (${day.date})`).join(' · ')}` : 'Needs target';
  const ownerId = epicOwnerId(dataset, epic.key); const owner = dataset.members.find((member) => member.id === ownerId);
  const additional = Math.max(0, epicSmes(dataset, epic.key).length - (owner ? 1 : 0));
  return <div className={`tracked-epic-row epic-managed-row${removed ? ' is-removed' : ''}`}><div className="tracked-epic-summary"><div className="epic-title-row"><span className={`planning-kind-icon ${intent.planningKind}`} role="img" aria-label={`${intent.planningKind === 'ongoing' ? 'Ongoing' : 'Timeline'} epic`} title={`${intent.planningKind === 'ongoing' ? 'Ongoing' : 'Timeline'} epic`}><PlanningKindIcon planningKind={intent.planningKind} /></span><strong>{epic.key} — {epic.title}</strong></div><div className="epic-summary-meta"><span>{epic.sourceStatus ?? 'Last synced'}</span><span aria-hidden="true">·</span><span>{intent.planningKind === 'ongoing' ? 'Ongoing' : 'Timeline'}</span>{intent.planningKind === 'timeline' && <><span aria-hidden="true">·</span><span>{relevantDaysSummary}</span></>}<span aria-hidden="true">·</span><span>{owner ? `Owner: ${owner.name}` : 'Unowned'}</span>{additional > 0 && <><span aria-hidden="true">·</span><span>{additional} additional SME{additional === 1 ? '' : 's'}</span></>}</div></div>{removed ? <><span className="tracked-state">Removed from plan</span><button type="button" className="btn" disabled={!editable || busy} onClick={() => mutate(epic.key, () => api.updatePortfolioEpic(epic.key, { scopeOverride: 'include', planningKind: intent.planningKind }))}>Move back to plan</button></> : <div className="epic-row-actions"><button type="button" className="btn" onClick={onExpand} aria-haspopup="dialog">Configure</button><button type="button" className="link-btn" onClick={() => onFilter([epic.key])}>Show only this epic</button><button type="button" className="link-btn danger" disabled={!editable || busy} onClick={() => mutate(epic.key, () => api.updatePortfolioEpic(epic.key, { scopeOverride: 'exclude' }))}>Remove from plan</button></div>}{expanded && <EpicEditor epic={epic} dataset={dataset} editable={editable} mutate={mutate} onClose={onExpand} />}</div>;
}

function PlanningKindIcon({ planningKind }: { planningKind: 'timeline' | 'ongoing' }) {
  return planningKind === 'ongoing'
    ? <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 12c-1.8-3-3.4-4.5-5.2-4.5C4.1 7.5 2 9.5 2 12s2.1 4.5 4.8 4.5c1.8 0 3.4-1.5 5.2-4.5Zm0 0c1.8-3 3.4-4.5 5.2-4.5 2.7 0 4.8 2 4.8 4.5s-2.1 4.5-4.8 4.5c-1.8 0-3.4-1.5-5.2-4.5Z" /></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4m8-4v4" /></svg>;
}

function EpicEditor({ epic, dataset, editable, mutate, onClose }: { epic: DomainDataset['epics'][number]; dataset: DomainDataset; editable: boolean; mutate: (key: string, fn: () => Promise<unknown>) => Promise<void>; onClose: () => void }) {
  const intent = effectivePortfolioEpic(dataset, epic.key); const [smeOpen, setSmeOpen] = useState(false);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal epic-editor-modal" role="dialog" aria-modal="true" aria-labelledby={`epic-editor-${epic.key}`} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}><div className="modal-heading"><div><h2 id={`epic-editor-${epic.key}`}>{epic.key} — {epic.title}</h2><p className="hint">Epic planning, target dates, knowledge, and Gantt settings.</p></div><button className="link-btn" type="button" onClick={onClose}>Close</button></div><div className="epic-settings-editor"><label className="control"><span>Planning kind</span><select value={intent.planningKind} disabled={!editable} onChange={(event) => mutate(epic.key, () => api.updatePortfolioEpic(epic.key, { planningKind: event.target.value as 'timeline' | 'ongoing' }))}><option value="timeline">Timeline</option><option value="ongoing">Ongoing</option></select></label>{intent.planningKind === 'timeline' && <WorkEstimateEditor epic={epic} dataset={dataset} editable={editable} mutate={mutate} />}<SmeSummary epic={epic} dataset={dataset} onEdit={() => setSmeOpen(true)} /><RelevantDaysEditor epic={epic} dataset={dataset} editable={editable} mutate={mutate} /><LabelRules epicKey={epic.key} dataset={dataset} editable={editable} mutate={mutate} /></div>{smeOpen && <EpicSmeModal epic={epic} dataset={dataset} editable={editable} onClose={() => setSmeOpen(false)} onSave={(ids) => mutate(epic.key, async () => { await api.replaceEpicSmes(epic.key, ids); setSmeOpen(false); })} />}</div></div>;
}

function WorkEstimateEditor({ epic, dataset, editable, mutate }: { epic: DomainDataset['epics'][number]; dataset: DomainDataset; editable: boolean; mutate: (key: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const workload = resolveEpicWorkload(dataset, epic.key);
  const estimate = dataset.epicEstimates?.find((entry) => entry.epicKey === epic.key);
  const [value, setValue] = useState(estimate ? String(estimate.unrefinedPoints) : '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { setValue(estimate ? String(estimate.unrefinedPoints) : ''); setConfirmDelete(false); }, [estimate?.updatedAt, epic.key]);
  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;
  return <section className="work-estimate" aria-labelledby={`work-estimate-${epic.key}`}><div><h3 id={`work-estimate-${epic.key}`}>Work estimate</h3><p className="hint">Unrefined points cover work not already represented by pointed Jira tickets.</p></div><dl className="work-estimate-breakdown"><div><dt>Jira-estimated remaining</dt><dd>{workload.jiraEstimatedRemainingPoints} pts</dd></div><div><dt>Unestimated Jira items</dt><dd>{workload.unestimatedJiraItems}</dd></div><div><dt>Modeled remaining</dt><dd>{workload.jiraEstimatedRemainingPoints} Jira + {workload.unrefinedRemainingPoints} unrefined = {workload.modeledRemainingPoints} pts</dd></div></dl>{workload.estimateReviewRequired && <p className="estimate-review-warning" role="status">Estimate review needed: {workload.estimateReviewChanges.map((change) => change.key).join(', ')} changed in Jira.</p>}<div className="controls work-estimate-controls"><label className="control"><span>Unrefined work remaining</span><span className="number-with-unit"><input type="number" min="0" step="0.5" inputMode="decimal" value={value} disabled={!editable} onChange={(event) => setValue(event.target.value)} aria-label="Unrefined work remaining in points" /><em>pts</em></span></label><button className="btn" type="button" disabled={!editable || !valid} onClick={() => mutate(epic.key, () => api.saveEpicEstimate(epic.key, { unrefinedPoints: parsed, expectedFactSignature: workload.factSignature }))}>{estimate ? 'Update estimate' : 'Save estimate'}</button>{estimate && (confirmDelete ? <><button className="link-btn danger" type="button" disabled={!editable} onClick={() => mutate(epic.key, () => api.deleteEpicEstimate(epic.key))}>Confirm remove</button><button className="link-btn" type="button" onClick={() => setConfirmDelete(false)}>Cancel</button></> : <button className="link-btn danger" type="button" disabled={!editable} onClick={() => setConfirmDelete(true)}>Remove estimate</button>)}</div>{estimate ? <p className="hint">Last reviewed {new Date(estimate.reviewedAt).toLocaleString()}.</p> : <p className="hint">No estimate saved yet. A saved zero explicitly confirms no additional unrefined work.</p>}</section>;
}

function SmeSummary({ epic, dataset, onEdit }: { epic: DomainDataset['epics'][number]; dataset: DomainDataset; onEdit: () => void }) {
  const owner = dataset.members.find((member) => member.id === epicOwnerId(dataset, epic.key));
  const colors = memberColorMap(dataset.members); const count = Math.max(0, epicSmes(dataset, epic.key).length - (owner ? 1 : 0));
  return <div className="epic-sme-summary"><div>{owner ? <><MemberAvatar name={owner.name} color={colors.get(owner.id) ?? '#6b7280'} avatarUrl={owner.avatarUrl} /> <strong>{owner.name}</strong> <span className="hint">Owner{count ? ` · ${count} additional SME${count === 1 ? '' : 's'}` : ''}</span></> : <span className="hint">Unowned · no known SMEs</span>}</div><button className="btn" type="button" onClick={onEdit}>Edit knowledge list</button></div>;
}

function RelevantDaysEditor({ epic, dataset, editable, mutate }: { epic: DomainDataset['epics'][number]; dataset: DomainDataset; editable: boolean; mutate: (key: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const ongoing = effectivePortfolioEpic(dataset, epic.key).planningKind === 'ongoing'; const [name, setName] = useState('Production Launch'); const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  if (ongoing) return <p className="hint">Relevant days are preserved but hidden for ongoing epics.</p>;
  const milestones = dataset.milestones.filter((item) => item.epicKey === epic.key).sort((a, b) => a.date.localeCompare(b.date));
  const valid = Boolean(name.trim()) && Boolean(date);
  return <div className="relevant-days"><div className="relevant-days-heading"><h3>Relevant days</h3><p className="hint">Track launches, testing, and other dates that shape the plan.</p></div>{milestones.map((milestone) => <RelevantDayRow key={milestone.id} milestone={milestone} editable={editable} mutate={mutate} />)}<div className="config-add relevant-day-add"><label className="control"><span>Name</span><Typeahead value={name} disabled={!editable} placeholder="Production Launch" searchOnEmpty debounceMs={0} showLoading={false} search={searchRelevantDayNames} onChange={setName} onSelect={(option) => setName(option.label)} /></label><label className="control"><span>Date</span><DatePicker value={date} disabled={!editable} ariaLabel="Relevant day date" onChange={setDate} /></label><button className="btn" type="button" disabled={!editable || !valid} onClick={() => mutate(epic.key, async () => { await api.createMilestone(epic.key, { name: name.trim(), date }); setName('Production Launch'); })}>Add day</button></div></div>;
}

function RelevantDayRow({ milestone, editable, mutate }: { milestone: EpicMilestone; editable: boolean; mutate: (key: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const [name, setName] = useState(milestone.name); const [date, setDate] = useState(milestone.date); const dirty = name !== milestone.name || date !== milestone.date;
  return <div className={`relevant-day-row${milestone.isGating ? ' gating' : ''}`}><label><input type="radio" name={`gate-${milestone.epicKey}`} checked={milestone.isGating} disabled={!editable || milestone.isGating} onChange={() => mutate(milestone.epicKey, () => api.updateMilestone(milestone.id, { isGating: true }))} /> Gate</label><input aria-label={`${milestone.name} name`} value={name} disabled={!editable} onChange={(event) => setName(event.target.value)} /><DatePicker value={date} disabled={!editable} ariaLabel={`${milestone.name}${milestone.isGating ? ' gating' : ''} date`} onChange={setDate} /><button className="link-btn" type="button" disabled={!editable || !dirty || !name.trim()} onClick={() => mutate(milestone.epicKey, () => api.updateMilestone(milestone.id, { ...(name !== milestone.name ? { name: name.trim() } : {}), ...(date !== milestone.date ? { date } : {}) }))}>Save</button><button className="link-btn danger" type="button" disabled={!editable || milestone.isGating} title={milestone.isGating ? 'Mark another day as the gate first' : undefined} onClick={() => mutate(milestone.epicKey, () => api.deleteMilestone(milestone.id))}>Remove</button></div>;
}

function LabelRules({ epicKey, dataset, editable, mutate }: { epicKey: string; dataset: DomainDataset; editable: boolean; mutate: (key: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const get = <T,>(key: string, fallback: T): T => { const row = dataset.settings.find((setting) => setting.scope === 'epic' && setting.scopeId === epicKey && setting.key === key); return row ? JSON.parse(row.value) as T : fallback; };
  const [parents, setParents] = useState(get(SETTING_KEYS.GANTT_APPLY_PARENT_LABELS, false)); const [ignored, setIgnored] = useState(get<string[]>(SETTING_KEYS.GANTT_IGNORE_LABELS, []).join(', '));
  return <div className="label-rules"><h3>Gantt label rules</h3><label className="inline-check config-checkbox"><input type="checkbox" checked={parents} disabled={!editable} onChange={(event) => setParents(event.target.checked)} /> <span>Apply parent labels</span></label><label className="control"><span>Ignore labels</span><input className="label-rules-input" type="text" aria-label="Ignore labels" value={ignored} disabled={!editable} onChange={(event) => setIgnored(event.target.value)} placeholder="Comma-separated labels" /></label><button className="btn" type="button" disabled={!editable} onClick={() => mutate(epicKey, () => api.patchEpicSettings(epicKey, { [SETTING_KEYS.GANTT_APPLY_PARENT_LABELS]: parents, [SETTING_KEYS.GANTT_IGNORE_LABELS]: [...new Set(ignored.split(/[\n,]/).map((value) => value.trim()).filter(Boolean))] }))}>Save label rules</button></div>;
}

function EpicSmeModal({ epic, dataset, editable, onClose, onSave }: { epic: DomainDataset['epics'][number]; dataset: DomainDataset; editable: boolean; onClose: () => void; onSave: (ids: string[]) => Promise<void> }) {
  const [ids, setIds] = useState(() => epicSmes(dataset, epic.key).map((item) => item.memberId)); const [query, setQuery] = useState(''); const [error, setError] = useState<string | null>(null); const [dragged, setDragged] = useState<string | null>(null); const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement);
  const members = dataset.members.filter((member) => member.teamId === epic.teamId); const available = rankLocal(members.filter((member) => !ids.includes(member.id)), query, (member) => member.name); const colors = memberColorMap(members);
  useEffect(() => () => opener.current?.focus(), []);
  const move = (index: number, offset: number) => setIds((current) => { const target = index + offset; if (target < 0 || target >= current.length) return current; const next = [...current]; [next[index], next[target]] = [next[target]!, next[index]!]; return next; });
  const addFirst = () => { const member = available[0]; if (member) { setIds([...ids, member.id]); setQuery(''); } };
  const reorder = (from: string, to: string) => setIds((current) => { const source = current.indexOf(from); const target = current.indexOf(to); if (source < 0 || target < 0 || source === target) return current; const next = [...current]; next.splice(source, 1); next.splice(target, 0, from); return next; });
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal epic-sme-modal" role="dialog" aria-modal="true" aria-labelledby="sme-modal-title" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}><h2 id="sme-modal-title">Owner and subject matter experts</h2><p className="hint">Top to bottom is most to least knowledgeable. The first person is the owner. Anyone not listed is assumed to be starting from scratch.</p>{error && <p className="config-error">{error}</p>}<label className="control"><span>Add team member</span><input className="local-search-input" type="search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addFirst(); } if (event.key === 'Escape') setQuery(''); }} placeholder="Search members" aria-controls="sme-member-results" /></label>{query && <div className="member-results" id="sme-member-results" role="listbox">{available.map((member) => <button type="button" role="option" key={member.id} onClick={() => { setIds([...ids, member.id]); setQuery(''); }}><MemberAvatar name={member.name} color={colors.get(member.id) ?? '#6b7280'} avatarUrl={member.avatarUrl} />{member.name}{!member.active && ' · inactive'}</button>)}</div>}<ol className="sme-list">{ids.map((id, index) => { const member = members.find((item) => item.id === id)!; return <li key={id} draggable onDragStart={() => setDragged(id)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragged) reorder(dragged, id); setDragged(null); }}><span className="drag-handle" aria-hidden="true" title="Drag to reorder">⠿</span><MemberAvatar name={member.name} color={colors.get(id) ?? '#6b7280'} avatarUrl={member.avatarUrl} /><span>{member.name}{!member.active && ' · inactive'}</span>{index === 0 && <strong className="owner-badge">Owner</strong>}<button type="button" className="link-btn" disabled={index === 0} onClick={() => move(index, -1)}>Move up</button><button type="button" className="link-btn" disabled={index === ids.length - 1} onClick={() => move(index, 1)}>Move down</button><button type="button" className="link-btn danger" onClick={() => setIds(ids.filter((value) => value !== id))}>Remove</button></li>; })}</ol><div className="modal-actions"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="button" disabled={!editable} onClick={() => onSave(ids).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}>Save</button></div></div></div>;
}
