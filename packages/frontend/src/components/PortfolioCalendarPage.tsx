import type { PortfolioProjection } from '@ecp/engine';
import type { DomainDataset, IsoDate } from '@ecp/shared';
import { useMemo, useState } from 'react';
import { buildPortfolioCalendarModel } from '../lib/portfolioCalendar';
import { DeliveryOutlookList } from './DeliveryOutlookList';
import { PortfolioMonthCalendar } from './PortfolioMonthCalendar';
import { AddRelevantDayModal } from './ImportantDatesSection';

export function PortfolioCalendarPage({ dataset, projection, selectedKeys, today, editable, onReload }: { dataset: DomainDataset; projection: PortfolioProjection; selectedKeys: readonly string[]; today: IsoDate; editable: boolean; onReload: () => Promise<void> }) {
  const model = useMemo(() => buildPortfolioCalendarModel(dataset, projection, selectedKeys, today), [dataset, projection, selectedKeys, today]);
  const [adding, setAdding] = useState(false);
  return <main className="portfolio-calendar-page" data-testid="portfolio-calendar-page"><PortfolioMonthCalendar model={model} onAddImportantDate={editable ? () => setAdding(true) : undefined} /><DeliveryOutlookList dataset={dataset} projection={projection} selectedKeys={selectedKeys} />{adding && <AddRelevantDayModal dataset={dataset} onClose={() => setAdding(false)} onReload={onReload} />}</main>;
}
