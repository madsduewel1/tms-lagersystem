import type { DeviceStatus, EventStatus, MaintenanceStatus, PurchaseStatus } from '../types';

export function formatDate(value: string | null | undefined): string {
  if (!value) return '–';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '–';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '–';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

export const deviceStatusLabels: Record<DeviceStatus, string> = {
  verfuegbar: 'Verfügbar',
  ausgelagert: 'Ausgelagert',
  defekt: 'Defekt',
  wartung: 'In Wartung',
  verloren: 'Verloren',
  ausser_betrieb: 'Außer Betrieb',
};

export const eventStatusLabels: Record<EventStatus, string> = {
  entwurf: 'Entwurf',
  geplant: 'Geplant',
  vorbereitung: 'Vorbereitung',
  aktiv: 'Aktiv',
  abgeschlossen: 'Abgeschlossen',
  abgesagt: 'Abgesagt',
};

export const maintenanceStatusLabels: Record<MaintenanceStatus, string> = {
  gemeldet: 'Gemeldet',
  pruefung: 'In Prüfung',
  reparatur: 'In Reparatur',
  ersatzteil: 'Wartet auf Ersatzteil',
  repariert: 'Repariert',
  nicht_reparierbar: 'Nicht reparierbar',
};

export const purchaseStatusLabels: Record<PurchaseStatus, string> = {
  geplant: 'Geplant',
  bestellt: 'Bestellt',
  geliefert: 'Geliefert',
  abgeschlossen: 'Abgeschlossen',
  storniert: 'Storniert',
};

export const conditionLabels: Record<string, string> = {
  neu: 'Neu',
  gut: 'Gut',
  gebraucht: 'Gebraucht',
  defekt: 'Defekt',
};

export const documentTypeLabels: Record<string, string> = {
  rechnung: 'Rechnung',
  kaufbeleg: 'Kaufbeleg',
  anleitung: 'Bedienungsanleitung',
  datenblatt: 'Datenblatt',
  garantie: 'Garantieunterlagen',
  reparatur: 'Reparaturbeleg',
  sonstiges: 'Sonstiges',
};

export function statusTone(status: string): 'success' | 'warning' | 'danger' | 'muted' | 'accent' {
  switch (status) {
    case 'verfuegbar':
    case 'repariert':
    case 'abgeschlossen':
    case 'aktiv':
      return 'success';
    case 'ausgelagert':
    case 'vorbereitung':
    case 'bestellt':
      return 'accent';
    case 'wartung':
    case 'reparatur':
    case 'pruefung':
    case 'ersatzteil':
    case 'geplant':
    case 'entwurf':
      return 'warning';
    case 'defekt':
    case 'verloren':
    case 'nicht_reparierbar':
    case 'abgesagt':
    case 'storniert':
      return 'danger';
    default:
      return 'muted';
  }
}

export function relativeDate(value: string | null | undefined): string {
  if (!value) return '–';
  const d = new Date(value).getTime();
  const diff = Date.now() - d;
  const day = 86400000;
  if (diff < 0) return formatDate(value);
  if (diff < day) return 'heute';
  if (diff < 2 * day) return 'gestern';
  if (diff < 30 * day) return `vor ${Math.floor(diff / day)} Tagen`;
  return formatDate(value);
}

/**
 * Prüft, ob ein Nutzer-eingegebener Wert als Link verwendet werden darf.
 *
 * Ohne diese Prüfung würde ein `javascript:`-Wert in einem href vom Browser
 * ausgeführt (stored XSS). React 18 blockt das nur mit einer Dev-Warnung.
 * Gibt null zurück, wenn die URL nicht http(s) ist – der Aufrufer blendet
 * den Link dann ganz aus.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
