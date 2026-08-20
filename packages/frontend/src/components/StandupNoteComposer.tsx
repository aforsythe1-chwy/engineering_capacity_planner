import { type CSSProperties, type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SETTING_KEYS, type DomainDataset, type StandupPseudogroup } from '@ecp/shared';
import { TypeaheadMenu } from './Typeahead';
import { buildStandupMentionOptions, findMentionTrigger, removeStandupAudience, replaceMentionTrigger, selectStandupAudience, standupAudiencePayload, type StandupMentionOption } from '../lib/standupNoteMentions';

export function StandupNoteComposer({ dataset, teamId, sessionId, expectedRevision, compact = false, onSave }: {
  dataset: DomainDataset; teamId: string; sessionId: string; expectedRevision: number; compact?: boolean;
  onSave: (body: string, audience: NonNullable<ReturnType<typeof standupAudiencePayload>>, sessionId: string, expectedRevision: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(''); const [selection, setSelection] = useState({ start: 0, end: 0 }); const [selected, setSelected] = useState<StandupMentionOption[]>(() => buildStandupMentionOptions('', [], []).slice(0, 1));
  const [activeIndex, setActiveIndex] = useState(0); const [dismissedSignature, setDismissedSignature] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLDivElement>(null); const textareaRef = useRef<HTMLTextAreaElement>(null); const menuRef = useRef<HTMLDivElement>(null); const listboxId = useId(); const [position, setPosition] = useState<CSSProperties>({});
  const members = useMemo(() => dataset.members.filter((member) => member.teamId === teamId && member.active).sort((a, b) => a.name.localeCompare(b.name)), [dataset.members, teamId]);
  const groups = useMemo(() => { try { const row = dataset.settings.find((setting) => setting.scope === 'team' && setting.scopeId === teamId && setting.key === SETTING_KEYS.STANDUP_PSEUDOGROUPS); const value = row ? JSON.parse(row.value) : null; return value?.groups ?? []; } catch { return []; } }, [dataset.settings, teamId]) as StandupPseudogroup[];
  const trigger = useMemo(() => findMentionTrigger(draft, selection.start, selection.end), [draft, selection]);
  const signature = trigger ? `${trigger.start}:${trigger.end}` : null;
  const open = Boolean(trigger && signature !== dismissedSignature);
  const options = useMemo(() => trigger ? buildStandupMentionOptions(trigger.query, groups, members) : [], [trigger, groups, members]);
  const audience = standupAudiencePayload(selected);

  useEffect(() => { setActiveIndex(0); }, [trigger?.query, trigger?.start]);
  useEffect(() => { if (!signature) setDismissedSignature(null); }, [signature]);
  const updatePosition = () => {
    const rect = textareaRef.current?.getBoundingClientRect(); if (!rect) return;
    const upward = window.innerHeight - rect.bottom < 270 && rect.top > window.innerHeight - rect.bottom;
    setPosition({ position: 'fixed', left: rect.left, width: Math.max(rect.width, 250), ...(upward ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) });
  };
  useLayoutEffect(() => {
    if (!open) return; updatePosition(); const refresh = () => updatePosition(); window.addEventListener('resize', refresh); document.addEventListener('scroll', refresh, true);
    return () => { window.removeEventListener('resize', refresh); document.removeEventListener('scroll', refresh, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!composerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setDismissedSignature(signature); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open, signature]);
  useEffect(() => { if (open && options[activeIndex]) document.getElementById(`${listboxId}-${options[activeIndex]!.id}`)?.scrollIntoView({ block: 'nearest' }); }, [activeIndex, listboxId, open, options]);

  const syncSelection = () => { const textarea = textareaRef.current; if (textarea) setSelection({ start: textarea.selectionStart, end: textarea.selectionEnd }); };
  const choose = (option: StandupMentionOption) => {
    if (!trigger) return;
    const replaced = replaceMentionTrigger(draft, trigger); setDraft(replaced.body); setSelection({ start: replaced.caret, end: replaced.caret }); setSelected((current) => selectStandupAudience(current, option)); setDismissedSignature(`${trigger.start}:${trigger.end}`);
    requestAnimationFrame(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(replaced.caret, replaced.caret); });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, Math.max(0, options.length - 1))); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
    else if (event.key === 'Home') { event.preventDefault(); setActiveIndex(0); }
    else if (event.key === 'End') { event.preventDefault(); setActiveIndex(Math.max(0, options.length - 1)); }
    else if (event.key === 'Enter' && options[activeIndex]) { event.preventDefault(); choose(options[activeIndex]!); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissedSignature(signature); }
  };
  const save = async () => {
    if (!draft.trim() || !audience || saving) return;
    setSaving(true); setError(null);
    try { await onSave(draft, audience, sessionId, expectedRevision); setDraft(''); setSelection({ start: 0, end: 0 }); setSelected(buildStandupMentionOptions('', [], []).slice(0, 1)); setDismissedSignature(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save note. Your draft is still here.'); }
    finally { setSaving(false); }
  };
  const active = options[activeIndex];
  const menu = open ? <div ref={menuRef}><TypeaheadMenu listboxId={listboxId} options={options} activeIndex={activeIndex} onActiveIndexChange={setActiveIndex} onSelect={choose} selectedId={null} style={position} portal /></div> : null;
  return <div className={`standup-note-composer${compact ? ' compact' : ''}`} ref={composerRef}>
    <textarea ref={textareaRef} aria-label="New post-standup note" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listboxId : undefined} aria-activedescendant={open && active ? `${listboxId}-${active.id}` : undefined} value={draft} maxLength={4000} onChange={(event) => { const textarea = event.currentTarget; setDraft(textarea.value); setSelection({ start: textarea.selectionStart, end: textarea.selectionEnd }); setDismissedSignature(null); requestAnimationFrame(() => setSelection({ start: textarea.selectionStart, end: textarea.selectionEnd })); }} onClick={syncSelection} onKeyUp={syncSelection} onSelect={syncSelection} onKeyDown={onKeyDown} placeholder="Add a follow-up note… Type @ to choose who it’s for." />
    <div className="standup-note-composer-toolbar"><div className="standup-note-audience" aria-label="Note audience">{selected.map((item) => <span className="standup-note-chip" key={item.id}><span>{item.label}</span><button type="button" aria-label={`Remove ${item.label}`} onClick={() => setSelected((current) => removeStandupAudience(current, item.id))}>×</button></span>)}{!selected.length && <span className="hint">Type @ to choose an audience.</span>}</div><button className="btn primary" disabled={!draft.trim() || !audience || saving} onClick={() => void save()}>{saving ? 'Adding…' : 'Add note'}</button></div>
    {(saving || error) && <div className="standup-note-composer-status" aria-live="polite">{error ? <span role="alert">{error}</span> : 'Adding…'}</div>}
    {menu && createPortal(menu, document.body)}
  </div>;
}
