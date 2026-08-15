import type { PortfolioHealth } from '@ecp/engine';
import type { IsoDate } from '@ecp/shared';

export interface EpicPickerOption {
  key: string;
  title: string;
  health: PortfolioHealth;
  targetDate: IsoDate | null;
  remainingPoints: number;
}

export function normalizeEpicSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Pure local ranker. Lower scores are more relevant; the final key sort is stable. */
export function scoreEpicOption(option: EpicPickerOption, query: string): number | null {
  const needle = normalizeEpicSearch(query);
  if (!needle) return 5;
  const key = normalizeEpicSearch(option.key);
  const title = normalizeEpicSearch(option.title);
  const compactNeedle = needle.replace(/ /g, '');
  const compactKey = key.replace(/ /g, '');
  if (compactKey === compactNeedle) return 0;
  if (compactKey.startsWith(compactNeedle)) return 1;
  if (title.split(' ').some((word) => word.startsWith(needle))) return 2;
  let at = 0;
  for (const char of needle.replace(/ /g, '')) {
    at = title.indexOf(char, at);
    if (at < 0) break;
    at += 1;
  }
  if (at >= 0) return 3;
  if (title.includes(needle)) return 4;
  return null;
}

export function rankEpicOptions(options: EpicPickerOption[], query: string): EpicPickerOption[] {
  return options
    .map((option, index) => ({ option, index, score: scoreEpicOption(option, query) }))
    .filter((entry): entry is { option: EpicPickerOption; index: number; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index || a.option.key.localeCompare(b.option.key))
    .map((entry) => entry.option);
}
