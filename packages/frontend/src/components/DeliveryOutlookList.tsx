import type { PortfolioProjection } from '@ecp/engine';
import { effectivePortfolioEpic, type DomainDataset } from '@ecp/shared';
import { formatDate } from '../lib/format';

export function DeliveryOutlookList({ dataset, projection, selectedKeys }: { dataset: DomainDataset; projection: PortfolioProjection; selectedKeys: readonly string[] }) {
  const results = projection.epics.filter((result) => !selectedKeys.length || selectedKeys.includes(result.epicKey));
  return <section className="panel delivery-outlook" data-testid="delivery-outlook" aria-labelledby="delivery-outlook-title">
    <div className="section-title"><h2 id="delivery-outlook-title">Delivery outlook</h2><span className="hint">Each row uses the shared portfolio projection; filtering never grants an epic extra capacity.</span></div>
    <div className="delivery-outlook-list">{results.map((result) => {
      const epic = dataset.epics.find((entry) => entry.key === result.epicKey);
      const gate = dataset.milestones.find((item) => item.epicKey === result.epicKey && item.isGating);
      const ongoing = effectivePortfolioEpic(dataset, result.epicKey).planningKind === 'ongoing';
      return <article className={`timeline-lane health-${result.health}`} key={result.epicKey} data-testid={`delivery-outlook-${result.epicKey}`}>
        <strong>{result.epicKey} — {epic?.title}</strong>
        <span><b>{ongoing ? 'Planning' : 'Target'}</b>{ongoing ? 'Ongoing capacity work' : gate ? formatDate(gate.date) : 'Needs target'}</span>
        <span><b>Projection</b>{result.projectedDevCompleteDate ? formatDate(result.projectedDevCompleteDate) : 'Not forecast'}</span>
        <span><b>Modeled work</b>{result.jiraEstimatedRemainingPoints} Jira + {result.unrefinedRemainingPoints} unrefined = {result.modeledRemainingPoints} pts</span>
        {result.estimateReviewRequired && <span className="estimate-review-warning"><b>Estimate</b>Review needed</span>}
        <span><b>{result.bufferWorkingDays === null ? 'Status' : 'Buffer'}</b>{result.bufferWorkingDays === null ? result.reason : `${result.bufferWorkingDays} working days`}</span>
      </article>;
    })}</div>
  </section>;
}
