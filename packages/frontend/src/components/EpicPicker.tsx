import { useId, useMemo, useRef, useState } from 'react';
import { formatDate } from '../lib/format';
import { rankEpicOptions, type EpicPickerOption } from '../lib/epicPicker';

export interface EpicPickerProps {
  epics: EpicPickerOption[];
  selectedKeys: string[];
  selectionMode: 'single' | 'multiple';
  onSelectionChange: (keys: string[]) => void;
  placeholder?: string;
  label?: string;
}

const healthLabel = (health: EpicPickerOption['health']) => health.replaceAll('-', ' ');

/** Local, keyboard-first epic selector. The plural contract is deliberate: compare mode can reuse it. */
export function EpicPicker({ epics, selectedKeys, selectionMode, onSelectionChange, placeholder = 'Find an epic…', label = 'Epic filter' }: EpicPickerProps) {
  const inputId = useId();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const results = useMemo(() => rankEpicOptions(epics, query), [epics, query]);
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = selectedKeys.map((key) => epics.find((epic) => epic.key === key)).filter((epic): epic is EpicPickerOption => Boolean(epic));
  const choose = (option: EpicPickerOption) => {
    const next = selectionMode === 'single' ? [option.key] : selectedKeys.includes(option.key) ? selectedKeys.filter((key) => key !== option.key) : [...selectedKeys, option.key];
    onSelectionChange(next);
    if (selectionMode === 'single') { setOpen(false); setQuery(''); inputRef.current?.focus(); }
  };
  const active = results[activeIndex];
  return <div className="epic-picker">
    <label htmlFor={inputId} className="epic-picker-label">{label}</label>
    {selectionMode === 'single' && <div className="epic-picker-current" role="status">
      {selected[0] ? `Showing ${selected[0].key}` : 'All active epics'}
      {selected[0] && <button type="button" className="epic-picker-clear" onClick={() => onSelectionChange([])}>Show all epics</button>}
    </div>}
    {selected.length > 0 && selectionMode === 'multiple' && <div className="epic-picker-chips">{selected.map((epic) => <span key={epic.key} className="epic-picker-chip">{epic.key}</span>)}</div>}
    <input
      ref={inputRef}
      id={inputId}
      className="epic-picker-input"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-activedescendant={open && active ? `${listboxId}-${active.key}` : undefined}
      placeholder={selected[0] && !query ? `${selected[0].key} — ${selected[0].title}` : placeholder}
      value={query}
      onFocus={() => { setOpen(true); setActiveIndex(0); }}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(index + 1, Math.max(0, results.length - 1))); }
        if (event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.max(0, index - 1)); }
        if (event.key === 'Enter' && active) { event.preventDefault(); choose(active); }
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setQuery(''); inputRef.current?.blur(); }
      }}
    />
    {open && <div id={listboxId} className="epic-picker-menu" role="listbox" aria-label={label}>
      {results.length ? results.map((epic, index) => <button key={epic.key} id={`${listboxId}-${epic.key}`} type="button" role="option" aria-selected={selectedKeys.includes(epic.key)} className={`epic-picker-option${index === activeIndex ? ' is-active' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(epic)} onMouseMove={() => setActiveIndex(index)}>
        <span className={`health-pill health-${epic.health}`}>{healthLabel(epic.health)}</span>
        <span className="epic-picker-option-title"><strong>{epic.key}</strong> {epic.title}</span>
        <span className="epic-picker-option-meta">{epic.targetDate ? `Target ${formatDate(epic.targetDate)}` : 'Needs target'} · {epic.remainingPoints} pts</span>
      </button>) : <p className="epic-picker-empty" role="status">{epics.length ? 'No matching active epics.' : 'No active epics are available.'}</p>}
    </div>}
  </div>;
}
