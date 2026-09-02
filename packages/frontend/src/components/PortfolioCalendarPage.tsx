import type { PortfolioProjection } from '@ecp/engine';
import type { DomainDataset, IsoDate, TeamHoliday } from '@ecp/shared';
import { useMemo, useState } from 'react';
import { buildPortfolioCalendarModel } from '../lib/portfolioCalendar';
import { DeliveryOutlookList } from './DeliveryOutlookList';
import { PortfolioMonthCalendar } from './PortfolioMonthCalendar';
import { AddRelevantDayModal } from './ImportantDatesSection';
import { HolidayRuleModal, TrackedHolidays } from './HolidayManagement';
import * as api from '../data/api';

export function PortfolioCalendarPage({ dataset, projection, selectedKeys, today, editable, onReload }: { dataset: DomainDataset; projection: PortfolioProjection; selectedKeys: readonly string[]; today: IsoDate; editable: boolean; onReload: () => Promise<void> }) {
  const model = useMemo(() => buildPortfolioCalendarModel(dataset, projection, selectedKeys, today), [dataset, projection, selectedKeys, today]);
  const [adding, setAdding] = useState(false);
  const [holidayEditor, setHolidayEditor] = useState<TeamHoliday | 'new' | null>(null);
  const holidayById = useMemo(() => new Map((dataset.holidays ?? []).map((holiday) => [holiday.id, holiday])), [dataset.holidays]);
  const moveEvent = async (event: ReturnType<typeof buildPortfolioCalendarModel>['events'][number], date: IsoDate) => { if (event.kind === 'important-date') await api.updateImportantDate(event.sourceId, { date }); else if (event.kind === 'gating' || event.kind === 'milestone') await api.updateMilestone(event.sourceId, { date }); else return; await onReload(); };
  return <main className="portfolio-calendar-page" data-testid="portfolio-calendar-page"><PortfolioMonthCalendar model={model} onAddImportantDate={editable ? () => setAdding(true) : undefined} onEditHoliday={editable ? (id) => setHolidayEditor(holidayById.get(id) ?? null) : undefined} onMoveEvent={editable ? moveEvent : undefined} /><TrackedHolidays dataset={dataset} editable={editable} onAdd={() => setHolidayEditor('new')} onEdit={setHolidayEditor} /><DeliveryOutlookList dataset={dataset} projection={projection} selectedKeys={selectedKeys} />{adding && <AddRelevantDayModal dataset={dataset} onClose={() => setAdding(false)} onReload={onReload} />}{holidayEditor && <HolidayRuleModal dataset={dataset} holiday={holidayEditor === 'new' ? null : holidayEditor} onClose={() => setHolidayEditor(null)} onSaved={onReload} />}</main>;
}
