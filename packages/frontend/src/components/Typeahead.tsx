import { type CSSProperties, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseJiraTicketKey } from '@ecp/shared';
import { JiraKeyLink } from './JiraLink';

export interface TypeaheadOption { id: string; label: string; hint?: string; imageUrl?: string | null; }
interface TypeaheadProps<T extends TypeaheadOption> {
  value: string; onChange: (text: string) => void; search: (query: string) => Promise<T[]>; onSelect: (option: T) => void;
  placeholder?: string; disabled?: boolean; searchOnEmpty?: boolean; debounceMs?: number; showLoading?: boolean; onFocus?: () => void;
  inputType?: 'text' | 'search'; inputClassName?: string; testId?: string;
  selectedId?: string | null; renderOptionLeading?: (option: T) => ReactNode; inputLeading?: ReactNode;
  selectValueOnFocus?: boolean; searchAllOnFocus?: boolean; portalMenu?: boolean; emptyLabel?: string; onDismiss?: () => void;
}

/** A dependency-free async/local combobox with optional trusted visual adornments. */
export function Typeahead<T extends TypeaheadOption>({
  value, onChange, search, onSelect, placeholder, disabled, searchOnEmpty = false, debounceMs = 200, showLoading = true, onFocus,
  inputType = 'text', inputClassName, testId, selectedId, renderOptionLeading, inputLeading, selectValueOnFocus = false,
  searchAllOnFocus = false, portalMenu = false, emptyLabel = 'No matches', onDismiss,
}: TypeaheadProps<T>) {
  const [open, setOpen] = useState(false); const [options, setOptions] = useState<T[]>([]); const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null); const [activeIndex, setActiveIndex] = useState(0); const [focusedUnedited, setFocusedUnedited] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null); const menuRef = useRef<HTMLDivElement>(null); const inputRef = useRef<HTMLInputElement>(null); const listboxId = useId(); const seq = useRef(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const query = searchAllOnFocus && focusedUnedited ? '' : value.trim();

  useEffect(() => {
    if (disabled || !open) return;
    if (!query && !searchOnEmpty && !(searchAllOnFocus && focusedUnedited)) { setOptions([]); return; }
    const mine = ++seq.current; setLoading(true); setError(null);
    const timer = window.setTimeout(() => { search(query).then((result) => { if (mine === seq.current) setOptions(result); }).catch((reason) => {
      if (mine === seq.current) { setOptions([]); setError(reason instanceof Error ? reason.message : String(reason)); }
    }).finally(() => { if (mine === seq.current) setLoading(false); }); }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [query, open, disabled, search, searchOnEmpty, searchAllOnFocus, focusedUnedited, debounceMs]);

  useEffect(() => { setActiveIndex((index) => Math.max(0, Math.min(index, Math.max(0, options.length - 1)))); }, [options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!boxRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  });
  const updatePosition = () => {
    const rect = boxRef.current?.getBoundingClientRect(); if (!rect) return;
    const upward = window.innerHeight - rect.bottom < 270 && rect.top > window.innerHeight - rect.bottom;
    setPosition({ position: 'fixed', left: rect.left, width: Math.max(rect.width, 220), ...(upward ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) });
  };
  useLayoutEffect(() => {
    if (!open || !portalMenu) return; updatePosition(); const refresh = () => updatePosition(); window.addEventListener('resize', refresh); document.addEventListener('scroll', refresh, true);
    return () => { window.removeEventListener('resize', refresh); document.removeEventListener('scroll', refresh, true); };
  }, [open, portalMenu]);
  useEffect(() => { if (open && options[activeIndex]) document.getElementById(`${listboxId}-${options[activeIndex]!.id}`)?.scrollIntoView({ block: 'nearest' }); }, [open, activeIndex, options, listboxId]);

  const close = () => { setOpen(false); setFocusedUnedited(false); };
  const dismiss = () => { close(); onDismiss?.(); };
  const choose = (option: T) => { onSelect(option); setOpen(false); setFocusedUnedited(false); requestAnimationFrame(() => inputRef.current?.focus()); };
  const active = options[activeIndex]; const showMenu = open && !disabled && (query !== '' || searchOnEmpty || (searchAllOnFocus && focusedUnedited));
  const menu = showMenu ? <div ref={menuRef} style={portalMenu ? position : undefined} id={listboxId} className={`typeahead-menu${portalMenu ? ' typeahead-menu-portal' : ''}`} role="listbox">
    {loading && showLoading && <div className="typeahead-status">Searching…</div>}{error && <div className="typeahead-status error">⚠ {error}</div>}
    {!loading && !error && options.length === 0 && <div className="typeahead-status">{emptyLabel}</div>}
    {options.map((option, index) => <button key={option.id} id={`${listboxId}-${option.id}`} type="button" className={`typeahead-option${index === activeIndex ? ' is-active' : ''}${option.id === selectedId ? ' is-selected' : ''}`} role="option" tabIndex={-1} aria-selected={option.id === selectedId} data-testid="typeahead-option" onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)}>
      <span className="typeahead-main">{renderOptionLeading?.(option)}{option.imageUrl && <img className="typeahead-avatar" src={option.imageUrl} alt="" width={20} height={20} />}<span className="typeahead-label">{option.label}</span></span>{option.hint && <TypeaheadHint hint={option.hint} />}
    </button>)}
  </div> : null;
  return <div className={`typeahead${inputLeading ? ' has-leading' : ''}`} ref={boxRef} data-testid={testId}>
    {inputLeading && <span className="typeahead-input-leading" aria-hidden="true">{inputLeading}</span>}
    <input ref={inputRef} type={inputType} className={inputClassName} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listboxId} aria-activedescendant={open && active ? `${listboxId}-${active.id}` : undefined} value={value} disabled={disabled} placeholder={placeholder}
      onChange={(event) => { setFocusedUnedited(false); onChange(event.target.value); setOpen(true); setActiveIndex(0); }}
      onFocus={() => { onFocus?.(); setFocusedUnedited(searchAllOnFocus); setOpen(true); setActiveIndex(0); if (selectValueOnFocus) requestAnimationFrame(() => inputRef.current?.select()); }}
      onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(index + 1, Math.max(0, options.length - 1))); } else if (event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.max(index - 1, 0)); } else if (event.key === 'Home' && open) { event.preventDefault(); setActiveIndex(0); } else if (event.key === 'End' && open) { event.preventDefault(); setActiveIndex(Math.max(0, options.length - 1)); } else if (event.key === 'Enter' && active) { event.preventDefault(); choose(active); } else if (event.key === 'Escape') { event.preventDefault(); dismiss(); inputRef.current?.focus(); } }} />
    {portalMenu ? menu && createPortal(menu, document.body) : menu}
  </div>;
}
function TypeaheadHint({ hint }: { hint: string }) { const key = parseJiraTicketKey(hint); return <span className="typeahead-hint">{key === hint ? <JiraKeyLink jiraKey={hint} /> : hint}</span>; }
