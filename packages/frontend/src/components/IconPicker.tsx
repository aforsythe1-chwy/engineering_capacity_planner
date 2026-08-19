import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { fuzzyScore, normalizeFuzzyText } from '../lib/fuzzySearch';
import { Typeahead, type TypeaheadOption } from './Typeahead';

export interface IconPickerOption<K extends string> extends TypeaheadOption { id: K; keywords: readonly string[]; }
export interface IconPickerProps<K extends string> {
  label: string; value: K | null; options: readonly IconPickerOption<K>[]; renderIcon: (key: K, className?: string) => ReactNode;
  onChange: (key: K | null) => void; disabled?: boolean; placeholder?: string; testId?: string;
}

/** Reusable local fuzzy icon picker with an explicit committed selection. */
export function IconPicker<K extends string>({ label, value, options, renderIcon, onChange, disabled = false, placeholder = 'Search icons', testId }: IconPickerProps<K>) {
  const selected = options.find((option) => option.id === value) ?? null;
  const [text, setText] = useState(() => selected?.label ?? '');
  const [openedValue, setOpenedValue] = useState<K | null>(value);
  useEffect(() => { if (value !== null) setText(selected?.label ?? ''); }, [selected?.label, value]);
  const search = useCallback(async (query: string): Promise<IconPickerOption<K>[]> => {
    const normalized = normalizeFuzzyText(query); if (!normalized) return [...options];
    return options.map((option, catalogIndex) => {
      const primary = fuzzyScore(`${option.label} ${option.id}`, normalized);
      const aliases = option.keywords.map((keyword) => fuzzyScore(keyword, normalized)).filter((score): score is number => score !== null);
      const alias = aliases.length ? Math.min(...aliases) + 20 : null;
      const score = primary === null ? alias : alias === null ? primary : Math.min(primary, alias);
      return { option, score, catalogIndex };
    }).filter((entry): entry is { option: IconPickerOption<K>; score: number; catalogIndex: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score || a.catalogIndex - b.catalogIndex).map((entry) => entry.option);
  }, [options]);
  return <div className="icon-picker"><span className="icon-picker-label">{label}</span><Typeahead value={text} disabled={disabled} inputType="search" placeholder={placeholder} testId={testId} search={search} searchOnEmpty debounceMs={0} showLoading={false} selectedId={value} searchAllOnFocus selectValueOnFocus portalMenu emptyLabel="No matching icons"
    inputLeading={selected ? renderIcon(selected.id, 'icon-picker-input-icon') : undefined}
    renderOptionLeading={(option) => renderIcon(option.id as K, 'icon-picker-option-icon')}
    onFocus={() => setOpenedValue(value)} onChange={(next) => { setText(next); onChange(null); }} onSelect={(option) => { setText(option.label); onChange(option.id as K); }}
    onDismiss={() => { setText(options.find((option) => option.id === openedValue)?.label ?? ''); onChange(openedValue); }} /></div>;
}
