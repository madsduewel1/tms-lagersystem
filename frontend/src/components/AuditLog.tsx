import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AuditEntry } from '../types';

const actionLabels: Record<string, string> = {
  login: 'Anmeldung',
  logout: 'Abmeldung',
  setup_complete: 'Ersteinrichtung',
  user_created: 'Benutzer erstellt',
  user_updated: 'Benutzer geändert',
  user_deleted: 'Benutzer gelöscht',
  user_password_reset: 'Passwort zurückgesetzt',
  user_password_bulk_reset: 'Passwörter zurückgesetzt',
  profile_updated: 'Profil geändert',
  password_changed: 'Passwort geändert',
  settings_updated: 'Einstellungen geändert',
  logo_updated: 'Logo geändert',
  category_created: 'Kategorie erstellt',
  category_updated: 'Kategorie geändert',
  category_deleted: 'Kategorie gelöscht',
  supplier_created: 'Lieferant erstellt',
  supplier_updated: 'Lieferant geändert',
  supplier_deleted: 'Lieferant gelöscht',
  location_created: 'Lagerort erstellt',
  location_updated: 'Lagerort geändert',
  location_deleted: 'Lagerort gelöscht',
  case_created: 'Case erstellt',
  case_updated: 'Case geändert',
  case_deleted: 'Case gelöscht',
  case_item_added: 'Asset zu Case hinzugefügt',
  case_item_removed: 'Asset aus Case entfernt',
  event_created: 'Event erstellt',
  event_updated: 'Event geändert',
  event_deleted: 'Event gelöscht',
  event_item_planned: 'Artikel eingeplant',
  event_device_planned: 'Gerät eingeplant',
  event_device_quantity_updated: 'Geräte-Stückzahl geändert',
  event_case_planned: 'Case eingeplant',
  checkout: 'Ausgecheckt',
  event_checkout: 'Event-Ausgabe',
  return: 'Rückgabe',
  quantity_changed: 'Bestand geändert',
  location_changed: 'Lagerort geändert',
  status_changed: 'Status geändert',
  maintenance_created: 'Wartung gemeldet',
  maintenance_updated: 'Wartung geändert',
  maintenance_deleted: 'Wartung gelöscht',
  document_uploaded: 'Dokument hochgeladen',
  document_deleted: 'Dokument gelöscht',
  purchase_created: 'Bestellung erstellt',
  purchase_updated: 'Bestellung geändert',
  purchase_delivered: 'Bestellung geliefert',
  purchase_deleted: 'Bestellung gelöscht',
  inventory_started: 'Inventur gestartet',
  inventory_completed: 'Inventur abgeschlossen',
  inventory_deleted: 'Inventur gelöscht',
};

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  const load = useCallback(async (p: number) => {
    try {
      const data = await api<{ entries: AuditEntry[]; total: number; page: number }>(
        `/api/audit?page=${p}&pageSize=25`
      );
      setEntries(data.entries);
      setTotal(data.total);
      setPage(data.page);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / 25));

  return (
    <>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 16 }}>{error}</div>}

      <div className="card">
        <div className="page-head" style={{ padding: '4px 0 12px' }}>
          <p className="page-sub">Protokoll aller sicherheitsrelevanten Aktionen</p>
        </div>
        {entries.length === 0 ? (
          <p className="empty-row">Noch keine Einträge vorhanden.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Zeitpunkt</th>
                  <th>Benutzer</th>
                  <th>Aktion</th>
                  <th>Ziel</th>
                  <th>Details</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      {new Date(e.created_at).toLocaleString('de-DE')}
                    </td>
                    <td>{e.name ?? e.username ?? 'System'}</td>
                    <td>{actionLabels[e.action] ?? e.action}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      {e.target_type ? `${e.target_type}: ${e.target_id}` : '–'}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 13, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.details ? JSON.stringify(e.details) : '–'}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{e.ip ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            <button className="btn" disabled={page <= 1} onClick={() => void load(page - 1)}>
              ← Zurück
            </button>
            <span style={{ alignSelf: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
              Seite {page} / {pageCount}
            </span>
            <button className="btn" disabled={page >= pageCount} onClick={() => void load(page + 1)}>
              Weiter →
            </button>
          </div>
        )}
      </div>
    </>
  );
}