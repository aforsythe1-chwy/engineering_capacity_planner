import { useEffect, useState } from 'react';
import type { TeamMember, TeamSprintOutput } from '@ecp/shared';
import * as api from '../data/api';
import { engineerSprintOutputModel } from '../lib/engineerSprintOutput';
import { MemberAvatar } from './MemberAvatar';

export function EngineerSprintOutput({ teamId, members, selectedMemberId, colors, connected }: { teamId: string; members: TeamMember[]; selectedMemberId: string; colors: Map<string, string>; connected: boolean }) {
  const [result, setResult] = useState<TeamSprintOutput | null>(null); const [loading, setLoading] = useState(false);
  const load = () => { if (!connected) return; setLoading(true); api.getCurrentSprintOutput(teamId).then(setResult).catch((error) => setResult({ teamId, sprint: null, capturedAt: new Date().toISOString(), freshness: 'unavailable', truncated: false, errorMessage: error instanceof Error ? error.message : 'Sprint output unavailable.', engineers: [], unattributed: { itemCount: 0, estimatedDoneOrReviewPoints: 0, unestimatedDoneOrReviewItems: 0 } })).finally(() => setLoading(false)); };
  useEffect(() => { setResult(null); load(); }, [teamId, connected]); // lazy component only mounts for this view
  if (!connected) return <section className="panel sprint-output"><h2>Sprint output</h2><p className="hint">Live Jira sprint output requires the backend.</p></section>;
  if (!result && loading) return <section className="panel sprint-output" role="status">Loading current Jira sprint output…</section>;
  if (!result) return null;
  const byId = new Map(members.map((member) => [member.id, member]));
  const rows = result.engineers.filter((engineer) => !selectedMemberId || engineer.memberId === selectedMemberId);
  return <section className="panel sprint-output" aria-live="polite"><div className="section-title"><div><h2>Sprint output{result.sprint ? ` — ${result.sprint.name}` : ''}</h2><span className="hint">Done and In Review points for currently assigned work compared with PTO/on-call-adjusted sprint capacity.</span></div><button type="button" className="btn" disabled={loading} onClick={load}>{loading ? 'Retrying…' : 'Retry'}</button></div>
    {result.sprint?.startDate && result.sprint.endDate && <p className="hint">{result.sprint.startDate} to {result.sprint.endDate}</p>}
    {result.errorMessage && <p className="sprint-output-warning" role="alert">{result.errorMessage}</p>}
    {result.truncated && <p className="sprint-output-warning">Jira returned a partial result; output totals are incomplete and ratios are hidden.</p>}
    {rows.map((engineer) => { const member = byId.get(engineer.memberId); if (!member) return null; const model = engineerSprintOutputModel(engineer, result.truncated); const label = !engineer.jiraLinked ? 'Jira account not linked' : model.capacity === null ? 'Capacity unavailable' : `${model.done} Done + ${model.review} In Review / ${model.capacity} available pts${model.percent === null ? '' : ` · ${model.percent}%`}`; return <article key={engineer.memberId} className="sprint-output-row" aria-label={`${member.name}: ${label}`}><div className="sprint-output-member"><MemberAvatar name={member.name} color={colors.get(member.id) ?? '#6b7280'} size={28} avatarUrl={member.avatarUrl} /><strong>{member.name}</strong></div>{!engineer.jiraLinked ? <p className="hint">Link this member to Jira in Configuration. {model.capacity ?? '—'} available pts.</p> : <><strong className="sprint-output-totals">{label}</strong>{model.capacity !== null && model.percent !== null && <div className="sprint-output-gauge" role="img" aria-label={`${member.name}: ${label}`}><span className="sprint-output-done" style={{ width: `${model.doneWidth}%` }} /><span className="sprint-output-review" style={{ left: `${model.doneWidth}%`, width: `${model.reviewWidth}%` }} /></div>}<p className="hint">{engineer.baseVelocity} base → {model.capacity ?? '—'} available{engineer.unestimatedDoneOrReviewItems ? ` · ${engineer.unestimatedDoneOrReviewItems} unestimated recognized item${engineer.unestimatedDoneOrReviewItems === 1 ? '' : 's'} excluded` : ''}</p></>}</article>; })}
    {!rows.length && !result.errorMessage && <p className="hint">No active team members match this filter.</p>}
    {result.unattributed.itemCount > 0 && <p className="sprint-output-warning">{result.unattributed.itemCount} recognized sprint item{result.unattributed.itemCount === 1 ? '' : 's'} could not be attributed to an active linked team member.</p>}
  </section>;
}
