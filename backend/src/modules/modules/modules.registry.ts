import type { RoleName } from '../../types/index.js';

export interface ModuleDef {
  key: string;
  path: string;
  label: string;
  subtitle: string;
  icon: string;
  roles: RoleName[];
}

const ALL: RoleName[] = ['administrator', 'techniker'];

export const MODULES: ModuleDef[] = [
  { key: 'lager', path: '/lager', label: 'Lager', subtitle: 'Lagerverwaltung', icon: 'warehouse', roles: ALL },
  { key: 'bestand', path: '/bestand', label: 'Bestand', subtitle: 'Geräte & Artikel', icon: 'boxes', roles: ALL },
  { key: 'inventur', path: '/inventur', label: 'Inventur', subtitle: 'Bestand erfassen', icon: 'clipboard-check', roles: ALL },
  { key: 'events', path: '/events', label: 'Events', subtitle: 'Veranstaltungen', icon: 'calendar', roles: ALL },
  { key: 'lagerplaetze', path: '/lagerplaetze', label: 'Lagerplätze', subtitle: 'Regale & Fächer', icon: 'grid', roles: ALL },
  { key: 'ausgabe', path: '/ausgabe', label: 'Ausgabe', subtitle: 'Ausgabe & Rückgabe', icon: 'transfer', roles: ALL },
  { key: 'wartung', path: '/wartung', label: 'Wartung', subtitle: 'Reparatur & Pflege', icon: 'wrench', roles: ALL },
  { key: 'dokumente', path: '/dokumente', label: 'Dokumente', subtitle: 'Rechnungen usw.', icon: 'file-text', roles: ALL },
  { key: 'geraete', path: '/geraete', label: 'Geräte', subtitle: 'Einzelgeräte', icon: 'device', roles: ALL },
  { key: 'artikel', path: '/artikel', label: 'Artikel', subtitle: 'Mengenartikel', icon: 'package', roles: ALL },
  { key: 'lieferanten', path: '/lieferanten', label: 'Lieferanten', subtitle: 'Bezugsquellen', icon: 'truck', roles: ALL },
  { key: 'beschaffung', path: '/beschaffung', label: 'Beschaffung', subtitle: 'Anschaffungen', icon: 'cart', roles: ALL },
  { key: 'kategorien', path: '/kategorien', label: 'Kategorien', subtitle: 'Strukturierung', icon: 'tags', roles: ALL },
  { key: 'qr', path: '/qr', label: 'QR-Codes', subtitle: 'Scannen & erzeugen', icon: 'qr', roles: ALL },
  {
    key: 'administration',
    path: '/administration',
    label: 'Administration',
    subtitle: 'Benutzer & System',
    icon: 'settings',
    roles: ['administrator'],
  },
];

export function modulesForRole(role: RoleName): ModuleDef[] {
  return MODULES.filter((m) => m.roles.includes(role));
}

export function canAccessModule(role: RoleName, key: string): boolean {
  const mod = MODULES.find((m) => m.key === key);
  return Boolean(mod && mod.roles.includes(role));
}
