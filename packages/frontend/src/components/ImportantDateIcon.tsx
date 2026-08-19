import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle, Bell, Bookmark, Briefcase, Bug, Cake, CalendarDays, CheckCircle2,
  CircleDollarSign, Clock3, Cloud, Code2, Database, FileText, Flag, Gift, Globe2,
  Heart, KeyRound, Lightbulb, Link, LockKeyhole, MapPin, Megaphone, Package, Plane,
  Presentation, Rocket, Shield, Star, Target, Trophy, Users, Wrench, Zap,
} from 'lucide-react';
import { IMPORTANT_DATE_ICON_KEYS, type ImportantDateIconKey } from '@ecp/shared';

export interface ImportantDateIconDefinition {
  key: ImportantDateIconKey;
  label: string;
  keywords: readonly string[];
  Icon: LucideIcon;
}

export const IMPORTANT_DATE_ICON_CATALOG = [
  { key: 'calendar', label: 'Calendar', keywords: ['event', 'date', 'schedule'], Icon: CalendarDays },
  { key: 'star', label: 'Star', keywords: ['important', 'favorite', 'highlight'], Icon: Star },
  { key: 'flag', label: 'Flag', keywords: ['milestone', 'deadline', 'marker'], Icon: Flag },
  { key: 'rocket', label: 'Rocket', keywords: ['launch', 'release', 'deploy'], Icon: Rocket },
  { key: 'megaphone', label: 'Megaphone', keywords: ['announcement', 'comms', 'communication'], Icon: Megaphone },
  { key: 'shield', label: 'Shield', keywords: ['security', 'freeze', 'protection'], Icon: Shield },
  { key: 'users', label: 'Users', keywords: ['team', 'people', 'group'], Icon: Users },
  { key: 'alert-triangle', label: 'Alert Triangle', keywords: ['incident', 'risk', 'warning'], Icon: AlertTriangle },
  { key: 'bell', label: 'Bell', keywords: ['notification', 'reminder', 'alert'], Icon: Bell },
  { key: 'bookmark', label: 'Bookmark', keywords: ['save', 'reference'], Icon: Bookmark },
  { key: 'briefcase', label: 'Briefcase', keywords: ['business', 'work'], Icon: Briefcase },
  { key: 'bug', label: 'Bug', keywords: ['defect', 'issue'], Icon: Bug },
  { key: 'cake', label: 'Cake', keywords: ['celebration', 'birthday'], Icon: Cake },
  { key: 'check-circle', label: 'Check Circle', keywords: ['complete', 'approved', 'done'], Icon: CheckCircle2 },
  { key: 'circle-dollar-sign', label: 'Dollar Sign', keywords: ['budget', 'cost', 'finance'], Icon: CircleDollarSign },
  { key: 'clock', label: 'Clock', keywords: ['time', 'deadline'], Icon: Clock3 },
  { key: 'cloud', label: 'Cloud', keywords: ['cloud', 'weather'], Icon: Cloud },
  { key: 'code', label: 'Code', keywords: ['engineering', 'development'], Icon: Code2 },
  { key: 'database', label: 'Database', keywords: ['data', 'storage'], Icon: Database },
  { key: 'file-text', label: 'File Text', keywords: ['document', 'docs'], Icon: FileText },
  { key: 'gift', label: 'Gift', keywords: ['celebration', 'reward'], Icon: Gift },
  { key: 'globe', label: 'Globe', keywords: ['global', 'world'], Icon: Globe2 },
  { key: 'heart', label: 'Heart', keywords: ['care', 'favorite'], Icon: Heart },
  { key: 'key', label: 'Key', keywords: ['access', 'security'], Icon: KeyRound },
  { key: 'lightbulb', label: 'Lightbulb', keywords: ['idea', 'discovery'], Icon: Lightbulb },
  { key: 'link', label: 'Link', keywords: ['url', 'connection'], Icon: Link },
  { key: 'lock', label: 'Lock', keywords: ['security', 'freeze', 'restricted'], Icon: LockKeyhole },
  { key: 'map-pin', label: 'Map Pin', keywords: ['location', 'office'], Icon: MapPin },
  { key: 'package', label: 'Package', keywords: ['release', 'delivery'], Icon: Package },
  { key: 'plane', label: 'Plane', keywords: ['travel', 'flight'], Icon: Plane },
  { key: 'presentation', label: 'Presentation', keywords: ['demo', 'slides'], Icon: Presentation },
  { key: 'target', label: 'Target', keywords: ['goal', 'objective'], Icon: Target },
  { key: 'trophy', label: 'Trophy', keywords: ['win', 'achievement'], Icon: Trophy },
  { key: 'wrench', label: 'Wrench', keywords: ['maintenance', 'tools'], Icon: Wrench },
  { key: 'zap', label: 'Zap', keywords: ['urgent', 'energy'], Icon: Zap },
] as const satisfies readonly ImportantDateIconDefinition[];

const definitions = IMPORTANT_DATE_ICON_CATALOG.reduce((result, definition) => {
  result[definition.key] = definition;
  return result;
}, {} as Record<ImportantDateIconKey, ImportantDateIconDefinition>);

export const IMPORTANT_DATE_ICON_OPTIONS = IMPORTANT_DATE_ICON_CATALOG.map(({ key, label, keywords }) => ({ id: key, label, keywords })) as readonly { id: ImportantDateIconKey; label: string; keywords: readonly string[] }[];

export const importantDateIconLabel = (key: ImportantDateIconKey): string => definitions[key].label;
export const safeImportantDateIcon = (key: string | null | undefined): ImportantDateIconKey =>
  (IMPORTANT_DATE_ICON_KEYS as readonly string[]).includes(key ?? '') ? key as ImportantDateIconKey : 'calendar';

export function ImportantDateIcon({ iconKey, className = '' }: { iconKey: string | null | undefined; className?: string }) {
  const Icon = definitions[safeImportantDateIcon(iconKey)].Icon;
  return <Icon className={`important-date-icon ${className}`} aria-hidden="true" focusable="false" />;
}
