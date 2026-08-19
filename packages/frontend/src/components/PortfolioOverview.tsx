import { useMemo } from 'react';
import type { DomainDataset } from '@ecp/shared';
import type { PortfolioProjection } from '@ecp/engine';
import { JiraKeyLink } from './JiraLink';
import { formatDate } from '../lib/format';
import { buildPortfolioOverview } from '../lib/portfolioOverview';

const healthLabel = (health: string) => health.replaceAll('-', ' ');

export function PortfolioOverview({ dataset, projection, onSelect, selectedKeys = [] }: { dataset: DomainDataset; projection: PortfolioProjection; onSelect: (key: string) => void; selectedKeys?: string[] }) {
  const model = useMemo(() => buildPortfolioOverview(dataset, projection), [dataset, projection]);
  return <main data-testid="portfolio-overview">
    <section className="portfolio-intro">
      <div><p className="eyebrow">Shared capacity plan</p><h2>Portfolio</h2><p>Capacity is allocated once across all active epics. Start with exceptions, then inspect the weeks where the team is tight.</p></div>
      <span className="portfolio-active-count">{model.activeEpicCount} active epic{model.activeEpicCount === 1 ? '' : 's'}</span>
    </section>
    <section className="portfolio-summary" aria-label="Portfolio summary">
      <SummaryMetric label="Modeled work remaining" value={`${model.remainingPoints} pts`} />
      <SummaryMetric label="Needs estimates" value={`${model.unestimatedItems} items`} warning={model.unestimatedItems > 0} />
      <SummaryMetric label="Peak utilization" value={`${Math.round(model.peakUtilization * 100)}%`} warning={model.peakUtilization >= 0.85} />
      <SummaryMetric label="Overloaded weeks" value={String(model.overloadedWeekCount)} danger={model.overloadedWeekCount > 0} />
    </section>
    <section className="portfolio-section" aria-labelledby="epic-health-heading">
      <div className="portfolio-section-heading"><div><p className="eyebrow">Exception first</p><h2 id="epic-health-heading">Epic health</h2></div><span>{model.rows.filter((row) => row.health !== 'green' && row.health !== 'ongoing').length} need attention</span></div>
      <div className="portfolio-list">
        {model.rows.filter((row) => !selectedKeys.length || selectedKeys.includes(row.epicKey)).map((row) => <article className={`portfolio-card health-${row.health}`} key={row.epicKey}>
          <div className="portfolio-card-heading"><span className={`health-marker health-${row.health}`} aria-label={`Health: ${healthLabel(row.health)}`}>●</span><div><div className="portfolio-card-title"><JiraKeyLink jiraKey={row.epicKey} /> <h3>{row.title}</h3></div><p>{row.teamName}</p></div><span className={`health-pill health-${row.health}`}>{healthLabel(row.health)}</span></div>
          <div className="portfolio-card-metrics">
            <Metric label={row.health === 'ongoing' ? 'Planning kind' : row.targetDate ? row.targetName ?? 'Gating target' : 'Planning input'} value={row.health === 'ongoing' ? 'Ongoing' : row.targetDate ? formatDate(row.targetDate) : 'Needs target'} />
            <Metric label="Projected completion" value={row.health === 'ongoing' ? 'Not applicable' : row.projectedDevCompleteDate ? formatDate(row.projectedDevCompleteDate) : 'Not forecast'} />
            <Metric label="Buffer" value={row.health === 'ongoing' ? 'Not applicable' : row.bufferWorkingDays === null ? '—' : `${row.bufferWorkingDays} working days`} />
            <Metric label="Modeled remaining" value={`${row.jiraEstimatedRemainingPoints} Jira + ${row.unrefinedRemainingPoints} unrefined = ${row.modeledRemainingPoints} pts`} />
          </div>
          {row.estimateReviewRequired && <p className="estimate-review-warning" role="status">Estimate review needed — Jira work changed since the last acknowledgment.</p>}
          <div className="portfolio-planning"><div className="portfolio-planning-label"><span>Planning placement</span><span>{row.placedPoints} placed / {row.unplannedPoints} unplanned</span></div><div className="portfolio-progress" aria-label={`${row.placedPoints} placed points and ${row.unplannedPoints} unplanned points`}><span style={{ width: `${row.remainingPoints ? Math.round(row.placedPoints / row.remainingPoints * 100) : 100}%` }} /></div></div>
          <div className="portfolio-card-footer"><p title={row.reason}>{row.reason}</p><span className="portfolio-owners">{row.assigneeNames.length ? row.assigneeNames.slice(0, 3).join(', ') : 'No assignees'}</span><button type="button" className="portfolio-open" onClick={() => onSelect(row.epicKey)}>Show only this epic <span aria-hidden="true">→</span></button></div>
        </article>)}
        {!model.rows.length && <div className="portfolio-empty"><h3>No active epics</h3><p>Sync Jira or include an epic in the portfolio to start planning shared capacity.</p></div>}
      </div>
    </section>
    <section className="portfolio-section capacity-section" aria-labelledby="shared-capacity-heading">
      <div className="portfolio-section-heading"><div><p className="eyebrow">Allocation by real week</p><h2 id="shared-capacity-heading">Shared capacity</h2></div><span>Yellow at 85% · red above capacity</span></div>
      {model.weeks.length ? <><div className="capacity-bars">{model.weeks.map((week) => { const utilization = week.capacity ? week.load / week.capacity : 0; const state = utilization > 1 ? 'red' : utilization >= .85 ? 'yellow' : 'green'; const filteredLoad = week.contributions.filter((entry) => selectedKeys.includes(entry.epicKey)).reduce((total, entry) => total + entry.load, 0); return <div className="capacity-week" key={week.start} tabIndex={0} title={week.contributions.map((entry) => `${entry.epicKey}: ${entry.load} pts`).join('\n')}><div className="capacity-week-label"><strong>{formatDate(week.start)}</strong><span>{week.load} / {week.capacity} pts{selectedKeys.length ? ` · ${filteredLoad} pts selected` : ''}</span></div><div className="capacity-track"><span className={`capacity-fill ${state}`} style={{ width: `${Math.min(utilization * 100, 100)}%` }} /></div><div className={`capacity-slack ${state}`}>{week.slack < 0 ? `${Math.abs(week.slack)} pts over` : `${week.slack} pts slack`}</div></div>; })}</div><table className="capacity-table"><thead><tr><th>Week</th><th>Planned</th><th>Capacity</th><th>Slack</th><th>Contributing epics</th></tr></thead><tbody>{model.weeks.map((week) => <tr key={week.start}><td>{formatDate(week.start)} – {formatDate(week.end)}</td><td>{week.load}{selectedKeys.length ? ` (${week.contributions.filter((entry) => selectedKeys.includes(entry.epicKey)).reduce((total, entry) => total + entry.load, 0)} selected)` : ''}</td><td>{week.capacity}</td><td>{week.slack}</td><td>{week.contributions.map((entry) => entry.epicKey).join(', ') || '—'}</td></tr>)}</tbody></table></> : <div className="portfolio-empty"><p>No scheduled estimated work yet.</p></div>}
    </section>
  </main>;
}

function SummaryMetric({ label, value, warning, danger }: { label: string; value: string; warning?: boolean; danger?: boolean }) { return <div className={`portfolio-summary-metric${danger ? ' danger' : warning ? ' warning' : ''}`}><span>{label}</span><strong>{value}</strong></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
