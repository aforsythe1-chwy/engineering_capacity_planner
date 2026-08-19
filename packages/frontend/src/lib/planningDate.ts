import { globalStringSetting, SETTING_KEYS, type DomainDataset, type IsoDate } from '@ecp/shared';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Format a Date as the browser's local calendar day, without a UTC rollover. */
export function localIsoDate(date = new Date()): IsoDate {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Use the deterministic planning date when configured, otherwise local today. */
export function effectivePlanningDate(dataset: Pick<DomainDataset, 'settings'>, now = new Date()): IsoDate {
  const configured = globalStringSetting(dataset.settings, SETTING_KEYS.PLANNING_TODAY);
  return configured && ISO_DATE.test(configured) ? configured : localIsoDate(now);
}
