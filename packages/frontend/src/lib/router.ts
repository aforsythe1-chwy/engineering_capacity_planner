import { useCallback, useEffect, useState } from 'react';

export type PlannerTab = 'overview' | 'timeline' | 'dependencies' | 'gantt' | 'team' | 'standup' | 'configuration';
export interface PlannerRoute {
  /** Pages and epic selection are intentionally independent. `epics: []` means all active epics. */
  tab: PlannerTab;
  epics: string[];
  team: string | null;
  legacy: boolean;
  invalidKeys: string[];
}

const validTabs = new Set<PlannerTab>(['overview', 'timeline', 'dependencies', 'gantt', 'team', 'standup', 'configuration']);

export function parsePlannerRoute(search: string, validEpicKeys: Set<string>, validTeamIds = new Set<string>()): PlannerRoute {
  const params = new URLSearchParams(search);
  const legacyKey = params.get('epic');
  const rawKeys = (params.get('epics') ?? legacyKey ?? '').split(',').map((key) => key.trim()).filter(Boolean);
  const uniqueKeys = [...new Set(rawKeys)];
  // Dataset order is the canonical order; this keeps shared URLs deterministic
  // when the UI eventually permits more than one selected epic.
  const epics = [...validEpicKeys].filter((key) => uniqueKeys.includes(key));
  const tabValue = params.get('tab');
  const legacyView = params.has('view');
  const legacyEpicView = params.get('view') === 'epic';
  const rawTeam = params.get('team');
  return {
    epics,
    team: rawTeam && validTeamIds.has(rawTeam) ? rawTeam : null,
    // Old portfolio links always mean Overview. Old epic links retain their tab.
    tab: validTabs.has(tabValue as PlannerTab)
      ? tabValue as PlannerTab
      : legacyEpicView ? 'timeline' : 'overview',
    legacy: Boolean(legacyKey) || legacyView,
    invalidKeys: uniqueKeys.filter((key) => !validEpicKeys.has(key)),
  };
}

export function routeSearch(route: Omit<PlannerRoute, 'legacy' | 'invalidKeys'>): string {
  const params = new URLSearchParams();
  if (route.tab !== 'overview') params.set('tab', route.tab);
  if (route.epics.length) params.set('epics', route.epics.join(','));
  if (route.team) params.set('team', route.team);
  return `?${params.toString()}`;
}

export function usePlannerRoute(validEpicKeys: Set<string>, validTeamIds = new Set<string>()) {
  const read = useCallback(() => parsePlannerRoute(window.location.search, validEpicKeys, validTeamIds), [validEpicKeys, validTeamIds]);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onPopState = () => setRoute(read());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [read]);
  // A sync can archive an epic while the user is viewing it. Revalidate against
  // the refreshed dataset instead of silently substituting another epic.
  useEffect(() => setRoute(read()), [read]);
  useEffect(() => {
    if (route.legacy || window.location.search !== routeSearch(route)) {
      window.history.replaceState(null, '', routeSearch(route));
    }
  }, [route]);
  const navigate = useCallback((next: Omit<PlannerRoute, 'legacy' | 'invalidKeys'>) => {
    const href = routeSearch(next);
    window.history.pushState(null, '', href);
    setRoute({ ...next, legacy: false, invalidKeys: [] });
  }, []);
  return { route, navigate };
}
