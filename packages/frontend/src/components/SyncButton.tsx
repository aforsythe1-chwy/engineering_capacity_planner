import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { DomainDataset } from '@ecp/shared';
import { globalStringSetting, isMappingComplete, SETTING_KEYS } from '@ecp/shared';
import type { DatasetSource } from '../data/loadDataset';
import * as api from '../data/api';
import type { RuntimeDataSource } from '../data/loadDataset';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type Freshness = 'green' | 'yellow' | 'red';

/**
 * Freshness color per the spec: green under an hour, yellow under a day, red
 * beyond a day (and red when never synced — an unsynced-but-configured board is
 * overdue).
 */
function freshnessOf(lastSyncedMs: number | null, nowMs: number): Freshness {
  if (lastSyncedMs === null) return 'red';
  const age = nowMs - lastSyncedMs;
  if (age < HOUR_MS) return 'green';
  if (age < DAY_MS) return 'yellow';
  return 'red';
}

/** "just now" / "12 min ago" / "3 h ago" / "2 d ago", or "never". */
function relativeAge(lastSyncedMs: number | null, nowMs: number): string {
  if (lastSyncedMs === null) return 'never synced';
  const age = Math.max(0, nowMs - lastSyncedMs);
  if (age < 60_000) return 'just now';
  if (age < HOUR_MS) return `${Math.floor(age / 60_000)} min ago`;
  if (age < DAY_MS) return `${Math.floor(age / HOUR_MS)} h ago`;
  return `${Math.floor(age / DAY_MS)} d ago`;
}

function missingJiraSetup(settings: DomainDataset['settings']): string[] {
  const missing: string[] = [];
  if (!globalStringSetting(settings, SETTING_KEYS.JIRA_PROJECT_KEY)) missing.push('project');
  if (!globalStringSetting(settings, SETTING_KEYS.JIRA_STORY_POINTS_FIELD)) missing.push('story points');
  if (!globalStringSetting(settings, SETTING_KEYS.JIRA_BLOCKS_LINK_TYPE)) missing.push('blocking link type');
  return missing;
}

interface SyncButtonProps {
  dataset: DomainDataset;
  source: DatasetSource;
  dataSource: RuntimeDataSource;
  onReload: () => Promise<void>;
  /** Send the user to the Jira setup flow (Configuration tab). */
  onGoToSetup: () => void;
}

/**
 * Top-nav Sync control (project plan §7). Its color reflects how long since the
 * last successful sync; it's locked until Jira setup is complete, in which case
 * clicking it explains where to finish setup instead of silently doing nothing.
 */
export function SyncButton({ dataset, source, dataSource, onReload, onGoToSetup }: SyncButtonProps) {
  // A once-a-minute tick so the color ages even with no user action.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showLocked, setShowLocked] = useState(false);
  const [reviews, setReviews] = useState<api.SyncResponse['estimateReviews']>([]);
  const syncRef = useRef<HTMLButtonElement>(null);

  // Locked until the mapping is complete against a live backend (bundled sample
  // data has no backend to sync to).
  const configured = source === 'api' && dataSource === 'jira' && isMappingComplete(dataset.settings);
  const missingSetup = source === 'api' ? missingJiraSetup(dataset.settings) : [];

  const lastIso = globalStringSetting(dataset.settings, SETTING_KEYS.LAST_SYNCED_AT);
  const lastMs = lastIso ? Date.parse(lastIso) : null;
  const lastValid = lastMs !== null && !Number.isNaN(lastMs) ? lastMs : null;
  const freshness = freshnessOf(lastValid, nowMs);
  const age = relativeAge(lastValid, nowMs);

  const sync = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.syncNow();
      const s = res.summary;
      setMsg(
        `Synced ${s.workItems ?? 0} items` +
          (s.sprints ? ` · ${s.sprints} sprints` : '') +
          (s.placementsPulledDone ? ` · pulled ${s.placementsPulledDone} done` : '') +
          (s.placementsAddedFromJira ? ` · placed ${s.placementsAddedFromJira} from Jira sprints` : '') +
          (s.placementConflicts ? ` · ${s.placementConflicts} placement conflicts` : '') +
          (s.membersAdded ? ` · +${s.membersAdded} members` : '') +
          (res.estimateReviews.length ? ` · ${res.estimateReviews.length} estimate${res.estimateReviews.length === 1 ? '' : 's'} need review` : ''),
      );
      await onReload();
      setReviews(res.estimateReviews);
    } catch (e) {
      setMsg(`⚠ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const stateClass = configured ? freshness : 'locked';
  const title = configured
    ? `Last synced ${age} — click to sync now`
    : dataSource !== 'jira'
      ? 'Backend is not in Jira mode — click for setup instructions'
      : 'Jira setup incomplete — click for help';

  return (
    <div className="sync-control">
      <button
        type="button"
        className={`sync-btn ${stateClass}`}
        data-testid="nav-sync"
        data-state={configured ? freshness : 'locked'}
        disabled={busy}
        ref={syncRef}
        title={title}
        onClick={() => (configured ? void sync() : setShowLocked(true))}
      >
        <span className="sync-dot" aria-hidden />
        {busy ? 'Syncing…' : 'Sync'}
        {configured && <span className="sync-age">{age}</span>}
      </button>
      {msg && (
        <span className="sync-msg" data-testid="nav-sync-msg">
          {msg}
        </span>
      )}

      {showLocked && (
        <div className="modal-overlay" data-testid="nav-sync-locked" onClick={() => setShowLocked(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Finish Jira setup first</h3>
            <p>
              {source !== 'api'
                ? 'You’re viewing bundled sample data. Start the backend and connect a Jira board to enable syncing.'
                : dataSource !== 'jira'
                  ? 'The backend is currently using synthetic data. Set ECP_DATA_SOURCE=jira and restart the backend before syncing.'
                : `Sync is locked until you’ve connected a board and mapped the required fields. Missing: ${missingSetup.join(', ') || 'unknown'}.`}
            </p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowLocked(false)}>
                Not now
              </button>
              <button
                type="button"
                className="btn primary"
                data-testid="nav-sync-locked-goto"
                onClick={() => {
                  setShowLocked(false);
                  onGoToSetup();
                }}
              >
                Go to Jira setup →
              </button>
            </div>
          </div>
        </div>
      )}
      {reviews.length > 0 && <EstimateReviewDialog dataset={dataset} reviews={reviews} onClose={() => { setReviews([]); syncRef.current?.focus(); }} onSaved={async (epicKey) => { await onReload(); setReviews((current) => current.filter((review) => review.epicKey !== epicKey)); }} />}
    </div>
  );
}

function EstimateReviewDialog({ dataset, reviews, onClose, onSaved }: { dataset: DomainDataset; reviews: api.SyncResponse['estimateReviews']; onClose: () => void; onSaved: (epicKey: string) => Promise<void> }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { dialog.current?.querySelector<HTMLElement>('input, button')?.focus(); }, []);
  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? [])];
    if (!items.length) return;
    const first = items[0]!; const last = items.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="modal-overlay estimate-review-overlay" role="presentation"><div className="modal estimate-review-dialog" role="dialog" aria-modal="true" aria-labelledby="estimate-review-title" ref={dialog} onKeyDown={trapFocus}><div className="modal-heading"><div><h3 id="estimate-review-title">Review Jira estimate changes</h3><p>Sync is complete. Acknowledge each changed epic when its unrefined amount still reflects the remaining work.</p></div><button type="button" className="link-btn" onClick={onClose}>Review later</button></div><div aria-live="polite">{reviews.map((review) => <EstimateReviewRow key={review.epicKey} review={review} title={dataset.epics.find((epic) => epic.key === review.epicKey)?.title ?? review.epicKey} onSaved={onSaved} />)}</div><div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Review later</button></div></div></div>;
}

function EstimateReviewRow({ review, title, onSaved }: { review: api.SyncResponse['estimateReviews'][number]; title: string; onSaved: (epicKey: string) => Promise<void> }) {
  const [value, setValue] = useState(String(review.workload.unrefinedRemainingPoints));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = Number(value); const valid = Number.isFinite(parsed) && parsed >= 0;
  const changeSummary = review.workload.estimateReviewChanges.map((change) => change.kind === 'new-item' ? `${change.key} added` : change.kind === 'newly-estimated' ? `${change.key} pointed` : `${change.key} increased`).join(', ');
  const save = async (amount: number) => {
    setBusy(true); setError(null);
    try { await api.saveEpicEstimate(review.epicKey, { unrefinedPoints: amount, expectedFactSignature: review.workload.factSignature }); await onSaved(review.epicKey); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <section className="estimate-review-row"><div><strong>{review.epicKey} — {title}</strong><p className="hint">{changeSummary}. Current modeled total: {review.workload.jiraEstimatedRemainingPoints} Jira + {review.workload.unrefinedRemainingPoints} unrefined = {review.workload.modeledRemainingPoints} pts.</p></div><div className="estimate-review-actions"><label className="control"><span>Unrefined remaining</span><span className="number-with-unit"><input type="number" min="0" step="0.5" value={value} disabled={busy} onChange={(event) => setValue(event.target.value)} /><em>pts</em></span></label><button type="button" className="btn" disabled={busy} onClick={() => void save(review.workload.unrefinedRemainingPoints)}>Keep current amount</button><button type="button" className="btn primary" disabled={busy || !valid} onClick={() => void save(parsed)}>Update estimate</button></div>{error && <p className="config-error" role="alert">{error}</p>}</section>;
}
