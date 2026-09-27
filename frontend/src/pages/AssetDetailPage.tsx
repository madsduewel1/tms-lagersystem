import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, downloadFileQuiet } from '../api/client';
import { PageHeader, Alert, StatusBadge, Loading, Badge } from '../components/ui';
import { Icon } from '../components/Icon';
import { NotFound } from '../components/NotFound';
import type {
  AssetHistory,
  CaseAssignment,
  CaseRow,
  Category,
  DeviceStatus,
  EventRow,
  Item,
  StorageLocation,
} from '../types';
import {
  deviceStatusLabels,
  eventStatusLabels,
  formatDateTime,
  formatMoney,
  maintenanceStatusLabels,
  safeExternalUrl,
} from '../utils/format';


const statuses: DeviceStatus[] = [
  'verfuegbar',
  'ausgelagert',
  'defekt',
  'wartung',
  'verloren',
  'ausser_betrieb',
];

function flattenLocations(rows: StorageLocation[]): Array<{ id: number; label: string }> {
  const byParent = new Map<number | null, StorageLocation[]>();
  for (const r of rows) {
    const key = r.parent_id ?? null;
    const list = byParent.get(key) ?? [];
    list.push(r);
    byParent.set(key, list);
  }
  const out: Array<{ id: number; label: string }> = [];
  const visit = (parent: number | null, depth: number) => {
    for (const r of byParent.get(parent) ?? []) {
      const prefix = depth === 0 ? '' : '  '.repeat(depth);
      out.push({ id: r.id, label: `${prefix}${r.name}${r.code ? ` (${r.code})` : ''}` });
      visit(r.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

export default function AssetDetailPage() {
  const [params] = useSearchParams();
  const itemId = Number(params.get('id'));

  const [item, setItem] = useState<Item | null>(null);
  const [history, setHistory] = useState<AssetHistory | null>(null);
  const [, setCategories] = useState<Category[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [assignments, setAssignments] = useState<CaseAssignment[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  const [assignCaseId, setAssignCaseId] = useState('');
  const [assignQty, setAssignQty] = useState('1');

  // manual_url ist ein freitextliches Feld – ohne Prüfung könnte dort ein
  // javascript:-Link stehen, der beim Klick ausgeführt würde.
  const manualUrl = safeExternalUrl(item?.manual_url);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemResp, catResp, caseResp, locResp] = await Promise.all([
        api<{ item: Item }>(`/api/items/${itemId}`),
        api<{ categories: Category[] }>('/api/categories'),
        api<{ cases: CaseRow[] }>('/api/cases'),
        api<{ locations: StorageLocation[] }>('/api/storage-locations'),
      ]);
      setItem(itemResp.item);
      setCategories(catResp.categories);
      setCases(caseResp.cases);
      setLocations(locResp.locations);
      api<{ assignments: CaseAssignment[] }>(`/api/items/${itemId}/cases`)
        .then((data) => setAssignments(data.assignments))
        .catch(() => setAssignments([]));
      const kindEnd = itemResp.item.kind === 'geraet' ? '/api/devices' : '/api/articles';
      api<AssetHistory>(`${kindEnd}/${itemId}/history`)
        .then(setHistory)
        .catch(() => setHistory(null));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
      setNotFound(err instanceof ApiError && err.status === 404);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!item) return;
    api<{ events: EventRow[] }>('/api/events')
      .then((data) => setEvents(data.events))
      .catch(() => undefined);
  }, [item?.id]);

  const kindEndPoint = item ? (item.kind === 'geraet' ? '/api/devices' : '/api/articles') : '';

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setError('');
    try {
      const data = await api<{ item: Item }>(`${kindEndPoint}/${item!.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setItem(data.item);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen');
      return false;
    }
  }

  async function changeStatus(status: DeviceStatus) {
    await patch({ status });
  }

  async function changeLocation(locationId: string) {
    await patch({ storage_location_id: locationId ? Number(locationId) : null });
  }

  async function addCaseAssignment() {
    if (!assignCaseId || !item) return;
    setError('');
    try {
      await api(`/api/cases/${Number(assignCaseId)}/items`, {
        method: 'POST',
        body: JSON.stringify({
          item_id: item.id,
          quantity: Math.max(1, Number(assignQty) || 1),
        }),
      });
      setAssignCaseId('');
      setAssignQty('1');
      const data = await api<{ assignments: CaseAssignment[] }>(`/api/items/${item.id}/cases`);
      setAssignments(data.assignments);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Hinzufügen fehlgeschlagen');
    }
  }

  async function removeCaseAssignment(caseId: number) {
    if (!item) return;
    setError('');
    try {
      await api(`/api/cases/${caseId}/items/${item.id}`, { method: 'DELETE' });
      const data = await api<{ assignments: CaseAssignment[] }>(`/api/items/${item.id}/cases`);
      setAssignments(data.assignments);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Entfernen fehlgeschlagen');
    }
  }

  async function assignEvent(eventId: string) {
    if (!eventId) return;
    setError('');
    try {
      const endpoint = item!.kind === 'geraet' ? 'devices' : 'items';
      await api(`/api/events/${Number(eventId)}/${endpoint}`, {
        method: 'POST',
        body: JSON.stringify({ item_id: item!.id }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Zuordnung fehlgeschlagen');
    }
  }

  async function unassignFromEvent(eventId: number) {
    setError('');
    try {
      const endpoint = item!.kind === 'geraet' ? 'devices' : 'items';
      await api(`/api/events/${eventId}/${endpoint}/${item!.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aufheben fehlgeschlagen');
    }
  }

  const assignableEvents = useMemo(
    () => events.filter((e) => !['abgeschlossen', 'abgesagt'].includes(e.status)),
    [events]
  );

  if (loading && !item) {
    return <Loading />;
  }

  if (!item) {
    return (
      <>
        {notFound ? (
          <NotFound
            icon="device"
            title="Gerät / Artikel nicht gefunden"
            hint={error || 'Das angeforderte Asset existiert nicht (mehr).'}
            backTo="/inventar"
            backLabel="Zum Inventar"
          />
        ) : (
          <>
            {error && <Alert tone="error">{error}</Alert>}
            <NotFound
              icon="alert"
              title="Laden fehlgeschlagen"
              hint="Die Daten konnten nicht geladen werden. Bitte erneut versuchen."
              backTo="/inventar"
              backLabel="Zum Inventar"
            />
          </>
        )}
      </>
    );
  }

  const plannedEvents = [
    ...(history?.plannedEvents ?? []).map((p) => ({ ...p, who: 'Gerät', quantity: 1 })),
    ...(history?.plannedAsArtikel ?? []).map((p) => ({ ...p, who: 'Artikel', quantity: p.quantity })),
  ];
  plannedEvents.sort((a, b) => (b.event_id - a.event_id));

  const qrLink = item.qr_token
    ? `${window.location.origin}/lagersystem/a/${item.qr_token}`
    : null;

  return (
    <>
      <PageHeader
        title={
          <>
            <span className="mono">{item.inventory_number ?? ''}</span> {item.name}
          </>
        }
        subtitle={
          item.category_name ? `Kategorie: ${item.category_name}` : undefined
        }
        backTo="/inventar"
        actions={
          <>
            <StatusBadge status={item.status} label={deviceStatusLabels[item.status]} />
            <button
              className="btn"
              onClick={() =>
                downloadFileQuiet(
                  `/api/labels/pdf?type=item&ids=${item.id}`,
                  `label-${item.inventory_number ?? item.id}.pdf`,
                  setError
                )
              }
            >
              <Icon name="qr" size={16} />
              Label
            </button>
            <Link
              className="btn btn-primary"
              to={`/inventar/new?id=${item.id}`}
            >
              <Icon name="edit" size={16} />
              Bearbeiten
            </Link>
          </>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="detail-grid">
        <section className="card">
          <h2 className="section-title">Details</h2>
          <dl className="detail-list">
            <dt>Typ</dt>
            <dd>{item.kind === 'geraet' ? 'Einzelgerät' : 'Artikel / Verbrauchsmaterial'}</dd>
            <dt>Hersteller</dt>
            <dd>{item.manufacturer ?? '–'}</dd>
            <dt>Modell</dt>
            <dd>{item.model ?? '–'}</dd>
            <dt>Anzahl / Menge</dt>
            <dd>
              {item.quantity} {item.unit ?? (item.kind === 'geraet' ? 'Stück' : '')}
              {item.kind === 'artikel' && item.min_stock !== null && (
                <span className="hint-inline">Mindestbestand: {item.min_stock}</span>
              )}
            </dd>
            {item.kind === 'artikel' ? (
              <>
                <dt>Artikelnummer</dt>
                <dd className="mono">{item.article_number ?? '–'}</dd>
              </>
            ) : (
              <dt>Seriennummer</dt>
            )}
            {item.kind === 'geraet' && <dd className="mono">{item.serial_number ?? '–'}</dd>}
            <dt>Zustand</dt>
            <dd>({item.condition ?? 'keine Angabe'})</dd>
            <dt>Kaufpreis</dt>
            <dd>{formatMoney(item.purchase_price)}</dd>
            <dt>Aktueller Wert</dt>
            <dd>{formatMoney(item.current_value)}</dd>
            <dt>Kaufdatum</dt>
            <dd>{formatDateTime(item.purchase_date)}</dd>
            <dt>Garantie</dt>
            <dd>{item.warranty ?? '–'}</dd>
            {manualUrl && (
              <>
                <dt>Anleitung</dt>
                <dd>
                  <a className="qr-link" href={manualUrl} target="_blank" rel="noreferrer">
                    <Icon name="external" size={14} /> Thomann-Anleitung öffnen
                  </a>
                </dd>
              </>
            )}
          </dl>
          {(item.description || item.technical_data || item.notes) && (
            <>
              {item.description && (
                <>
                  <h3 className="section-sub">Beschreibung</h3>
                  <p className="pre-wrap">{item.description}</p>
                </>
              )}
              {item.technical_data && (
                <>
                  <h3 className="section-sub">Technische Daten</h3>
                  <p className="pre-wrap">{item.technical_data}</p>
                </>
              )}
              {item.notes && (
                <>
                  <h3 className="section-sub">Notizen</h3>
                  <p className="pre-wrap">{item.notes}</p>
                </>
              )}
            </>
          )}
        </section>

        <section className="card">
          <h2 className="section-title">Position & Status</h2>

          <div className="form-group">
            <label className="form-label">Status</label>
            <select
              className="form-select"
              value={item.status}
              onChange={(e) => void changeStatus(e.target.value as DeviceStatus)}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {deviceStatusLabels[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Lagerort</label>
            <select
              className="form-select"
              value={item.storage_location_id ? String(item.storage_location_id) : ''}
              onChange={(e) => void changeLocation(e.target.value)}
            >
              <option value="">– kein Lagerort –</option>
              {flattenLocations(locations).map((l) => (
                <option key={l.id} value={String(l.id)}>
                  {l.label}
                </option>
              ))}
            </select>
            {item.location_path && (
              <div className="form-hint">
                <Icon name="map-pin" size={13} /> {item.location_path}
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Case-Verteilung</label>
            {assignments.length > 0 ? (
              <div className="case-assign-list">
                {assignments.map((a) => (
                  <div className="case-assign-row" key={a.case_id}>
                    <Link className="table-link" to={`/cases/detail?id=${a.case_id}`}>
                      <Icon name="case" size={14} />
                      <strong>{a.case_code ? `${a.case_code} – ` : ''}{a.case_name}</strong>
                    </Link>
                    <span className="case-assign-qty">{a.quantity} Stück</span>
                    {a.location_path && <span className="case-assign-loc">{a.location_path}</span>}
                    <button
                      className="icon-btn danger"
                      title="Aus Koffer entfernen"
                      onClick={() => void removeCaseAssignment(a.case_id)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="form-hint">
                Dieses Asset ist noch keinem Koffer zugeteilt.
              </div>
            )}
            <div className="case-assign-add">
              <select
                className="form-select"
                value={assignCaseId}
                onChange={(e) => setAssignCaseId(e.target.value)}
              >
                <option value="">Koffer wählen …</option>
                {cases.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.code ? `${c.code} – ` : ''}{c.name}
                    {c.location_path ? ` (${c.location_path})` : ''}
                  </option>
                ))}
              </select>
              <input
                className="form-input"
                type="number"
                min={1}
                style={{ width: 90 }}
                value={assignQty}
                onChange={(e) => setAssignQty(e.target.value)}
              />
              <button
                className="btn btn-sm"
                disabled={!assignCaseId}
                onClick={() => void addCaseAssignment()}
              >
                <Icon name="plus" size={14} />
                Zuordnen
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Event-Zuordnung</label>
            {item.current_event_id && item.event_name ? (
              <div className="event-assign-row">
                <span>
                  <Badge tone="accent"><Icon name="calendar" size={13} /> {item.event_name}</Badge>
                </span>
                <button
                  className="btn"
                  onClick={() => void unassignFromEvent(item.current_event_id!)}
                >
                  Zuordnung lösen
                </button>
              </div>
            ) : (
              <div className="event-assign-row">
                <select
                  className="form-select"
                  value=""
                  onChange={(e) => void assignEvent(e.target.value)}
                >
                  <option value="">Event zuordnen …</option>
                  {assignableEvents.map((e) => (
                    <option key={e.id} value={String(e.id)}>
                      {e.name} ({eventStatusLabels[e.status]})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {qrLink && (
            <div className="form-group">
              <label className="form-label">QR-Code-Link</label>
              <a className="qr-link" href={qrLink} target="_blank" rel="noreferrer">
                <Icon name="external" size={14} />
                {qrLink}
              </a>
            </div>
          )}
        </section>
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title">Verlauf & Verwendung</h2>
        {plannedEvents.length > 0 && (
          <>
            <h3 className="section-sub">Eingeplant in</h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Zeitraum</th>
                    <th>Status</th>
                    <th>Plan-Status</th>
                    <th>Notiz</th>
                  </tr>
                </thead>
                <tbody>
                  {plannedEvents.map((p) => (
                    <tr key={p.event_id}>
                      <td>
                        <Link to={`/events/detail?id=${p.event_id}`} className="table-link">
                          <Icon name="calendar" size={16} />
                          <strong>{p.name}</strong>
                        </Link>
                      </td>
                      <td>
                        {p.starts_at ? formatDateTime(p.starts_at) : '–'}
                        {p.ends_at ? ` bis ${formatDateTime(p.ends_at)}` : ''}
                      </td>
                      <td>
                        <StatusBadge status={p.event_status} label={eventStatusLabels[p.event_status]} />
                      </td>
                      <td>{p.plan_status}</td>
                      <td>{p.note ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {(history?.movements ?? []).length > 0 && (
          <>
            <h3 className="section-sub">Bewegungen ({history!.movements.length})</h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Bewegung</th>
                    <th>Menge</th>
                    <th>Von → Nach</th>
                    <th>Von</th>
                    <th>Notiz</th>
                  </tr>
                </thead>
                <tbody>
                  {history!.movements.map((m) => (
                    <tr key={m.id}>
                      <td>{formatDateTime(m.created_at)}</td>
                      <td>{m.type}</td>
                      <td>{m.quantity}</td>
                      <td>
                        {item.kind === 'artikel' ? `${m.before_quantity} → ${m.after_quantity}` : '–'}
                      </td>
                      <td>{m.user_name ?? '–'}</td>
                      <td>{m.note ?? (m.event_name ? `Event: ${m.event_name}` : '–')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {(history?.checkouts ?? []).length > 0 && (
          <>
            <h3 className="section-sub">Ausleihen</h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ausgeliehen</th>
                    <th>Rückgabe</th>
                    <th>Event</th>
                    <th>Von</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history!.checkouts.map((c) => (
                    <tr key={c.id}>
                      <td>{formatDateTime(c.checked_out_at)}</td>
                      <td>{formatDateTime(c.returned_at)}</td>
                      <td>{c.event_name ?? '–'}</td>
                      <td>{c.user_name ?? '–'}</td>
                      <td>
                        <StatusBadge status={c.status} label={c.status === 'offen' ? 'Offen' : 'Zurück'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {(history?.maintenance ?? []).length > 0 && (
          <>
            <h3 className="section-sub">Wartungen</h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Gemeldet</th>
                    <th>Problem</th>
                    <th>Status</th>
                    <th>Techniker</th>
                    <th>Repare</th>
                  </tr>
                </thead>
                <tbody>
                  {history!.maintenance.map((m) => (
                    <tr key={m.id}>
                      <td>{formatDateTime(m.reported_at)}</td>
                      <td>{m.problem}</td>
                      <td>
              <StatusBadge
                status={m.status}
                label={maintenanceStatusLabels[m.status] ?? m.status}
              />
            </td>

                      <td>{m.technician_name ?? '–'}</td>
                      <td>{m.repair ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {plannedEvents.length === 0 &&
          (history?.movements ?? []).length === 0 &&
          (history?.checkouts ?? []).length === 0 &&
          (history?.maintenance ?? []).length === 0 && (
            <p className="empty-row">Noch keine Verwendung oder Bewegungen dokumentiert.</p>
          )}
      </section>
    </>
  );
}