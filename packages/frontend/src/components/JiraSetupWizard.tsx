import { useEffect, useMemo, useState } from 'react';
import type { DomainDataset, TeamMember } from '@ecp/shared';
import { isMappingComplete, SETTING_KEYS } from '@ecp/shared';
import * as api from '../data/api';
import { memberColorMap } from '../lib/memberColors';
import { MemberAvatar } from './MemberAvatar';
import { TicketFieldModal } from './TicketFieldModal';
import { Typeahead } from './Typeahead';
import type { RuntimeDataSource } from '../data/loadDataset';

/** Read a JSON-encoded global setting, or `fallback` when absent. */
function settingValue<T>(dataset: DomainDataset, key: string, fallback: T): T {
  const row = dataset.settings.find((s) => s.scope === 'global' && s.key === key);
  return row ? (JSON.parse(row.value) as T) : fallback;
}

type Run = (fn: () => Promise<unknown>) => Promise<void>;

interface WizardProps {
  dataset: DomainDataset;
  teamId: string | null;
  members: TeamMember[];
  disabled: boolean;
  run: Run;
  onReload: () => Promise<void>;
  dataSource: RuntimeDataSource;
}

type StepId = 'connect' | 'board' | 'scope' | 'fields' | 'members' | 'review';

const STEPS: Array<{ id: StepId; title: string }> = [
  { id: 'connect', title: 'Connect' },
  { id: 'board', title: 'Board' },
  { id: 'scope', title: 'Epic scope' },
  { id: 'fields', title: 'Fields' },
  { id: 'members', title: 'Members' },
  { id: 'review', title: 'Review' },
];

/**
 * Guided "Connect to Jira" flow (project plan §7). Walks an empty install from
 * credentials → board → epic → field mapping → team members, driving live Jira
 * search under the hood (typeaheads) so the user points at real things instead
 * of typing opaque ids. Each choice persists to settings / the members table and
 * reloads, so the rest of the app (and the nav Sync button) react immediately.
 */
export function JiraSetupWizard({ dataset, teamId, members, disabled, run, onReload, dataSource }: WizardProps) {
  const projectKey = settingValue<string | null>(dataset, SETTING_KEYS.JIRA_PROJECT_KEY, null);
  const boardId = settingValue<string | null>(dataset, SETTING_KEYS.JIRA_BOARD_ID, null);
  const epicKey = settingValue<string | null>(dataset, SETTING_KEYS.JIRA_EPIC_KEY, null);
  const scopeMode = settingValue<'single' | 'active' | null>(dataset, SETTING_KEYS.JIRA_EPIC_SCOPE_MODE, null)
    ?? (epicKey ? 'single' : 'active');
  const mapped = isMappingComplete(dataset.settings);

  const done: Record<StepId, boolean> = {
    connect: false, // filled from the live connection check below
    board: boardId !== null,
    scope: scopeMode === 'active',
    fields: mapped,
    members: teamId !== null && members.some((m) => m.jiraAccountId),
    review: boardId !== null && scopeMode === 'active' && mapped,
  };

  // First unfinished step is the natural landing spot.
  const [step, setStep] = useState<StepId>(() => {
    if (!boardId) return 'board';
    if (scopeMode !== 'active') return 'scope';
    if (!mapped) return 'fields';
    return 'connect';
  });

  return (
    <section className="panel jira-wizard" data-testid="jira-wizard">
      <div className="section-title">
        <h2>Connect to Jira</h2>
        <span className="hint">Wire up your board, review its active epics, and map fields — no ids to memorize.</span>
      </div>

      <div className={`jira-mode ${dataSource === 'jira' ? 'active' : 'inactive'}`} data-testid="jira-mode">
        <strong>{dataSource === 'jira' ? 'Jira sync mode is active' : 'Jira sync mode is not active'}</strong>
        <p>
          {dataSource === 'jira'
            ? 'The Sync button will import all active epics and the shared sprint schedule from Jira.'
            : 'Your choices below can be saved now, but Sync will not read Jira until the backend is restarted with ECP_DATA_SOURCE=jira.'}
        </p>
        {dataSource !== 'jira' && (
          <code>ECP_DATA_SOURCE=jira npm run dev</code>
        )}
      </div>

      <ol className="wizard-steps" data-testid="wizard-steps">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              className={`wizard-step${step === s.id ? ' active' : ''}${done[s.id] ? ' done' : ''}`}
              data-testid={`wizard-step-${s.id}`}
              onClick={() => setStep(s.id)}
            >
              <span className="wizard-step-num">{done[s.id] ? '✓' : i + 1}</span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>

      <div className="wizard-body">
        {step === 'connect' && <ConnectStep />}
        {step === 'board' && (
          <BoardStep dataset={dataset} projectKey={projectKey} boardId={boardId} disabled={disabled} run={run} onNext={() => setStep('scope')} />
        )}
        {step === 'scope' && (
          <EpicScopeStep projectKey={projectKey} scopeMode={scopeMode} legacyEpicKey={epicKey} disabled={disabled} run={run} onNext={() => setStep('fields')} />
        )}
        {step === 'fields' && (
          <FieldsStep
            dataset={dataset}
            projectKey={projectKey}
            disabled={disabled}
            run={run}
            onNext={() => setStep('members')}
          />
        )}
        {step === 'members' && (
          <MembersStep teamId={teamId} members={members} disabled={disabled} run={run} onReload={onReload} onNext={() => setStep('review')} />
        )}
        {step === 'review' && <ReviewStep dataset={dataset} members={members} dataSource={dataSource} projectKey={projectKey} boardId={boardId} />}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------
function ConnectStep() {
  const [conn, setConn] = useState<api.JiraConnection | null>(null);
  const [loading, setLoading] = useState(true);

  const check = () => {
    setLoading(true);
    api
      .getJiraConnection()
      .then(setConn)
      .catch((e) => setConn({ connected: false, baseUrl: null, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => setLoading(false));
  };
  useEffect(check, []);

  return (
    <div data-testid="wizard-connect">
      {loading && <p className="hint">Checking connection…</p>}
      {!loading && conn?.connected && (
        <div className="conn-card ok" data-testid="wizard-connect-ok">
          <strong>● Connected</strong>
          <div className="hint">
            {conn.baseUrl ?? 'your Jira site'} — signed in as <strong>{conn.displayName}</strong>
            {conn.email ? ` (${conn.email})` : ''}.
          </div>
        </div>
      )}
      {!loading && conn && !conn.connected && (
        <div className="conn-card bad" data-testid="wizard-connect-bad">
          <strong>○ Not connected</strong>
          <div className="hint">{conn.error ?? 'No Jira credentials found.'}</div>
          <p className="hint">
            Credentials are read from the environment (never stored in the shared database). Set
            these where the backend runs, then re-check:
          </p>
          <pre className="env-block">
JIRA_BASE_URL=https://your-org.atlassian.net{'\n'}JIRA_EMAIL=you@your-org.com{'\n'}JIRA_API_TOKEN=…{'\n'}ECP_DATA_SOURCE=jira
          </pre>
        </div>
      )}
      <div className="wizard-nav">
        <button type="button" className="btn" onClick={check} data-testid="wizard-connect-recheck">Re-check connection</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------
function BoardStep({ dataset, projectKey, boardId, disabled, run, onNext }: {
  dataset: DomainDataset; projectKey: string | null; boardId: string | null; disabled: boolean; run: Run; onNext: () => void;
}) {
  const [text, setText] = useState('');
  const currentName = settingValue<string | null>(dataset, SETTING_KEYS.JIRA_BOARD_NAME, null);
  const clearBoard = () => {
    setText('');
    run(() =>
      api.patchSettings({
        [SETTING_KEYS.JIRA_BOARD_ID]: null,
        [SETTING_KEYS.JIRA_BOARD_NAME]: null,
        [SETTING_KEYS.JIRA_PROJECT_KEY]: null,
        [SETTING_KEYS.JIRA_EPIC_KEY]: null,
        [SETTING_KEYS.JIRA_EPIC_SCOPE_MODE]: 'active',
        [SETTING_KEYS.JIRA_STORY_POINTS_FIELD]: null,
        [SETTING_KEYS.JIRA_SPRINT_FIELD]: null,
        [SETTING_KEYS.JIRA_LABELS_FIELD]: null,
      }),
    );
  };

  return (
    <div data-testid="wizard-board">
      <p className="hint wizard-help">Search your Agile boards and pick the one this plan tracks.</p>
      {boardId && (
        <div className="wizard-current" data-testid="wizard-board-current">
          <span>
            Selected board: <strong>{currentName ?? `#${boardId}`}</strong>
            {projectKey ? <> · project <code>{projectKey}</code></> : null}
          </span>
          <button
            type="button"
            className="wizard-clear"
            aria-label="Clear selected board"
            disabled={disabled}
            onClick={clearBoard}
          >
            ×
          </button>
        </div>
      )}
      {!boardId && (
        <Typeahead
          value={text}
          onChange={setText}
          disabled={disabled}
          searchOnEmpty
          placeholder="Search boards…"
          testId="wizard-board-search"
          search={(q) =>
            api.searchJiraBoards(q).then((r) =>
              r.boards.map((b) => ({ id: String(b.id), label: b.name, hint: b.projectKey ?? b.type, board: b })),
            )
          }
          onSelect={(opt) => {
            const b = (opt as { board: api.JiraBoardOption }).board;
            setText('');
            run(() =>
              api.patchSettings({
                [SETTING_KEYS.JIRA_BOARD_ID]: String(b.id),
                [SETTING_KEYS.JIRA_BOARD_NAME]: b.name,
                [SETTING_KEYS.JIRA_EPIC_SCOPE_MODE]: 'active',
                [SETTING_KEYS.JIRA_EPIC_KEY]: null,
                // A board carries its project; setting it unlocks epic + sample.
                ...(b.projectKey ? { [SETTING_KEYS.JIRA_PROJECT_KEY]: b.projectKey } : {}),
              }),
            );
          }}
        />
      )}
      <div className="wizard-nav">
        <button type="button" className="btn" disabled={!boardId} onClick={onNext} data-testid="wizard-board-next">
          Next: review epic scope →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Epic scope
// ---------------------------------------------------------------------------
function EpicScopeStep({ projectKey, scopeMode, legacyEpicKey, disabled, run, onNext }: {
  projectKey: string | null; scopeMode: 'single' | 'active'; legacyEpicKey: string | null; disabled: boolean; run: Run; onNext: () => void;
}) {
  const [preview, setPreview] = useState<api.JiraEpicScopePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = () => {
    if (!projectKey) return;
    setLoading(true); setError(null);
    api.previewJiraEpicScope(projectKey).then(setPreview).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false));
  };
  const refreshFromJira = () => {
    if (!projectKey) return;
    setLoading(true); setError(null);
    api.refreshJiraCache().then(load).catch((e) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false); });
  };
  useEffect(load, [projectKey]);
  const useActiveScope = () => run(() => api.patchSettings({
    [SETTING_KEYS.JIRA_EPIC_SCOPE_MODE]: 'active',
    [SETTING_KEYS.JIRA_EPIC_KEY]: null,
  }));
  return (
    <div data-testid="wizard-epic-scope">
      <p className="hint wizard-help">
        The selected board defines the portfolio. Every unresolved epic with remaining work is imported
        and competes for one shared team-capacity schedule.
      </p>
      {!projectKey && <div className="config-error">Pick a board first so its epic scope can be discovered.</div>}
      {scopeMode === 'single' && (
        <div className="jira-mode inactive" data-testid="wizard-legacy-epic-scope">
          <strong>Legacy single-epic scope{legacyEpicKey ? `: ${legacyEpicKey}` : ''}</strong>
          <p>This database will keep its current behavior until you explicitly switch it to the active portfolio.</p>
          <button type="button" className="btn primary" disabled={disabled || !projectKey} onClick={useActiveScope}>Use all active epics</button>
        </div>
      )}
      {scopeMode === 'active' && <div className="wizard-current"><strong>All active epics</strong><span> · no single epic selection required</span></div>}
      {loading && <p className="hint">Discovering active epics…</p>}
      {error && <div className="config-error">{error}</div>}
      {preview && (
        <div className="config-list" data-testid="wizard-epic-preview">
          {preview.epics.map((epic) => (
            <div className="config-row" key={epic.key}>
              <code>{epic.key}</code><span className="config-primary">{epic.summary}</span>
              <span className="unit">{epic.status}</span>
              <span className="unit">{epic.remainingItems} remaining · {epic.remainingPoints} pts{epic.unestimatedItems ? ` · ${epic.unestimatedItems} unestimated` : ''}</span>
            </div>
          ))}
          {preview.epics.length === 0 && <div className="config-notice" data-testid="wizard-epic-preview-diagnostics"><strong>No roots are currently importable.</strong><p>Board {preview.diagnostics.boardId} returned {preview.diagnostics.boardIssueCount} issues. Root selection: {preview.diagnostics.rootSelection === 'jira-epic' ? 'Jira issue type “Epic”' : preview.diagnostics.rootSelection === 'referenced-jira-epic' ? 'Jira Epics referenced by board issues' : 'parentless board records (no Jira Epics found)'}.</p><p>Parentless issue types: {Object.entries(preview.diagnostics.rootIssueTypes).map(([type, count]) => `${type} (${count})`).join(', ') || 'none'}.</p><p>Candidate outcomes: {Object.entries(preview.diagnostics.exclusionCounts).map(([reason, count]) => `${reason.replaceAll('-', ' ')} (${count})`).join(', ')}.</p><p className="hint">Both root → work and root → child record → work hierarchies are supported. This list shows why none of the detected roots qualified.</p></div>}
          {preview.archived.length > 0 && <div className="hint">Will archive: {preview.archived.map((e) => e.key).join(', ')}</div>}
        </div>
      )}
      <div className="wizard-nav">
        <button type="button" className="btn" disabled={scopeMode !== 'active' || !projectKey} onClick={onNext} data-testid="wizard-epic-scope-next">
          Next: map fields →
        </button>
        <button type="button" className="link-btn" disabled={!projectKey || loading} onClick={load}>Refresh preview (cache)</button>
        <button type="button" className="link-btn" disabled={!projectKey || loading} onClick={refreshFromJira}>Refresh from Jira</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------
function FieldsStep({ dataset, projectKey, disabled, run, onNext }: {
  dataset: DomainDataset; projectKey: string | null; disabled: boolean; run: Run; onNext: () => void;
}) {
  const [ticketRef, setTicketRef] = useState<string | null>(null);
  const [recent, setRecent] = useState<api.JiraRecentTicket[]>([]);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const loadRecent = () => {
    if (!projectKey) return;
    setLoadingRecent(true); setRecentError(null);
    api.getRecentJiraTickets(projectKey).then((result) => setRecent(result.tickets)).catch((error) => setRecentError(error instanceof Error ? error.message : String(error))).finally(() => setLoadingRecent(false));
  };
  useEffect(loadRecent, [projectKey]);
  return (
    <div data-testid="wizard-fields">
      <p className="hint wizard-help">
        Point the roles below at the fields your board actually uses. Story points and the
        “blocks” link type are required before you can sync.
      </p>

      <div className="ticket-cta" data-testid="wizard-ticket-cta">
        <div>
          <strong>Choose a recent ticket from this board</strong>
          <div className="hint">Pick a familiar issue and we’ll open its fields for mapping.</div>
        </div>
        <button type="button" className="link-btn" disabled={disabled || loadingRecent || !projectKey} onClick={loadRecent}>
          {loadingRecent ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {!projectKey && <div className="config-error">Select a board first to load its tickets.</div>}
      {recentError && <div className="config-error">{recentError}</div>}
      {projectKey && <div className="recent-ticket-list" data-testid="wizard-recent-tickets">
        {recent.map((ticket) => <button type="button" className="recent-ticket-row" key={ticket.key} disabled={disabled} onClick={() => setTicketRef(ticket.key)}>
          <code>{ticket.key}</code><span className="recent-ticket-summary">{ticket.summary}</span><span className="jira-field-badge">{ticket.issueType}</span><span className="unit">{ticket.status}</span><span className="recent-ticket-action">Map fields →</span>
        </button>)}
        {!loadingRecent && recent.length === 0 && <p className="hint">No recent non-epic tickets were found on this board.</p>}
      </div>}
      <button type="button" className="link-btn" data-testid="wizard-open-ticket" disabled={disabled} onClick={() => setTicketRef('')}>
        Enter a ticket key or URL instead
      </button>

      <div className="wizard-nav">
        <button type="button" className="btn" onClick={onNext}>Next: team members →</button>
      </div>

      {ticketRef !== null && (
        <TicketFieldModal
          dataset={dataset}
          disabled={disabled}
          run={run}
          initialRef={ticketRef}
          autoLoad={ticketRef !== ''}
          onClose={() => setTicketRef(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
function MembersStep({ teamId, members, disabled, run, onReload, onNext }: {
  teamId: string | null; members: TeamMember[]; disabled: boolean; run: Run; onReload: () => Promise<void>; onNext: () => void;
}) {
  const colors = useMemo(() => memberColorMap(members), [members]);
  const [addText, setAddText] = useState('');
  const [sprintSuggestions, setSprintSuggestions] = useState<api.JiraCurrentSprintAssignees | null>(null);
  const [sprintError, setSprintError] = useState<string | null>(null);
  const memberControlsDisabled = disabled || teamId === null;
  const addSuggestedMember = (user: api.JiraCurrentSprintAssignees['users'][number]) => {
    if (teamId === null) return;
    run(async () => {
      await api.createMember({ teamId, name: user.displayName, baseVelocity: 10, jiraAccountId: user.accountId, avatarUrl: user.avatarUrl });
      await onReload();
    });
  };
  const loadSprintSuggestions = () => {
    setSprintError(null);
    api.getCurrentSprintAssignees().then(setSprintSuggestions).catch((error) => setSprintError(error instanceof Error ? error.message : String(error)));
  };
  useEffect(loadSprintSuggestions, []);
  const unlinkedSuggestions = sprintSuggestions?.users.filter((user) => !members.some((member) => member.jiraAccountId === user.accountId)) ?? [];

  return (
    <div data-testid="wizard-members">
      <p className="hint wizard-help">
        Search Jira for teammates to add, or link people you already created to their Jira account so
        their assigned work maps onto them.
      </p>
      {teamId === null && (
        <div className="wizard-current" data-testid="wizard-members-pending">
          Team members become editable after the first Jira sync creates the local team.
        </div>
      )}

      <section className="sprint-member-suggestions" data-testid="wizard-sprint-assignees">
        <div className="sprint-member-heading"><div><strong>Assigned in the current sprint</strong><span className="hint">{sprintSuggestions?.currentSprint ? ` · ${sprintSuggestions.currentSprint.name}` : ''}</span></div><button type="button" className="link-btn" disabled={disabled} onClick={loadSprintSuggestions}>Refresh</button></div>
        {sprintError && <div className="config-error">{sprintError}</div>}
        {sprintSuggestions?.reason && <p className="hint">{sprintSuggestions.reason}</p>}
        {unlinkedSuggestions.map((user) => <div className="sprint-member-row" key={user.accountId}><MemberAvatar name={user.displayName} color="#5b8cff" size={24} avatarUrl={user.avatarUrl} /><span>{user.displayName}</span><span className="unit">{user.ticketCount} assigned ticket{user.ticketCount === 1 ? '' : 's'}</span><button type="button" className="btn btn-tiny" disabled={memberControlsDisabled} onClick={() => addSuggestedMember(user)}>Add to team</button></div>)}
        {sprintSuggestions && !sprintSuggestions.reason && unlinkedSuggestions.length === 0 && <p className="hint">Everyone assigned in the current sprint is already linked to this team.</p>}
        {!sprintSuggestions && !sprintError && <p className="hint">Loading current-sprint assignees…</p>}
      </section>

      <div className="control">
        <label>Search all Jira users</label>
        <Typeahead
          value={addText}
          onChange={setAddText}
          disabled={memberControlsDisabled}
          searchOnEmpty
          placeholder="Search people…"
          testId="wizard-member-search"
          search={(q) =>
            api.searchJiraUsers(q).then((r) =>
              r.users
                // Hide people already linked to a member.
                .filter((u) => !members.some((m) => m.jiraAccountId === u.accountId))
                .map((u) => ({ id: u.accountId, label: u.displayName, hint: u.email ?? undefined, imageUrl: u.avatarUrl })),
          )
          }
          onSelect={(opt) => {
            if (teamId === null) return;
            setAddText('');
            run(async () => {
              await api.createMember({ teamId, name: opt.label, baseVelocity: 10, jiraAccountId: opt.id, avatarUrl: opt.imageUrl ?? null });
              await onReload();
            });
          }}
        />
      </div>

      <div className="config-list" data-testid="wizard-member-list">
        {members.map((m) => (
          <MemberLinkRow key={m.id} member={m} color={colors.get(m.id) ?? '#6b7280'} disabled={disabled} run={run} onReload={onReload} />
        ))}
        {members.length === 0 && <div className="hint">No team members yet — search above to add some.</div>}
      </div>
      <div className="wizard-nav"><button type="button" className="btn" onClick={onNext}>Next: review →</button></div>
    </div>
  );
}

function ReviewStep({ dataset, members, dataSource, projectKey, boardId }: {
  dataset: DomainDataset; members: TeamMember[]; dataSource: RuntimeDataSource; projectKey: string | null; boardId: string | null;
}) {
  const boardName = settingValue<string | null>(dataset, SETTING_KEYS.JIRA_BOARD_NAME, null);
  const mapped = isMappingComplete(dataset.settings);
  return <div data-testid="wizard-review">
    <p className="hint wizard-help">Review the portfolio setup before syncing.</p>
    <div className="config-list">
      <div className="config-row"><strong>Board</strong><span className="config-primary">{boardName ?? (boardId ? `#${boardId}` : 'Not selected')}</span>{projectKey && <code>{projectKey}</code>}</div>
      <div className="config-row"><strong>Epic scope</strong><span className="config-primary">All active epics with remaining work</span></div>
      <div className="config-row"><strong>Capacity</strong><span className="config-primary">One shared team pool across the portfolio</span></div>
      <div className="config-row"><strong>Fields</strong><span className="config-primary">{mapped ? 'Required mappings complete' : 'Required mappings incomplete'}</span></div>
      <div className="config-row"><strong>Members</strong><span className="config-primary">{members.filter((m) => m.jiraAccountId).length} connected</span></div>
      <div className="config-row"><strong>Backend</strong><span className="config-primary">{dataSource === 'jira' ? 'Jira sync mode active' : 'Restart with ECP_DATA_SOURCE=jira before syncing'}</span></div>
    </div>
  </div>;
}

function MemberLinkRow({ member, color, disabled, run, onReload }: {
  member: TeamMember; color: string; disabled: boolean; run: Run; onReload: () => Promise<void>;
}) {
  const [linkText, setLinkText] = useState('');
  const [linking, setLinking] = useState(false);
  return (
    <div className="config-row" data-testid={`wizard-member-${member.id}`}>
      <MemberAvatar name={member.name} color={color} size={22} avatarUrl={member.avatarUrl} />
      <span className="config-primary">{member.name}</span>
      {member.jiraAccountId ? (
        <>
          <span className="jira-field-badge" title={member.jiraAccountId}>🔗 linked</span>
          <button type="button" className="link-btn danger" disabled={disabled}
            onClick={() => run(async () => { await api.updateMember(member.id, { jiraAccountId: null }); await onReload(); })}>
            unlink
          </button>
        </>
      ) : linking ? (
        <div className="member-link-picker">
          <Typeahead
            value={linkText}
            onChange={setLinkText}
            disabled={disabled}
            searchOnEmpty
            placeholder="Find Jira user…"
            testId={`wizard-member-link-${member.id}`}
            search={(q) => api.searchJiraUsers(q).then((r) => r.users.map((u) => ({ id: u.accountId, label: u.displayName, hint: u.email ?? undefined, imageUrl: u.avatarUrl })))}
            onSelect={(opt) => {
              setLinking(false);
              setLinkText('');
              run(async () => { await api.updateMember(member.id, { jiraAccountId: opt.id, avatarUrl: opt.imageUrl ?? null }); await onReload(); });
            }}
          />
          <button type="button" className="link-btn" onClick={() => setLinking(false)}>cancel</button>
        </div>
      ) : (
        <>
          <span className="unit">local</span>
          <button type="button" className="link-btn" disabled={disabled}
            data-testid={`wizard-member-link-btn-${member.id}`} onClick={() => setLinking(true)}>
            link to Jira
          </button>
        </>
      )}
    </div>
  );
}
