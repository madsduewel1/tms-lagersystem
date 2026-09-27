import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { PageHeader, Alert, Loading, StatusBadge, Modal, Field, Badge } from '../components/ui';
import { Icon } from '../components/Icon';
import { NotFound } from '../components/NotFound';
import QrScannerModal from '../components/QrScannerModal';
import type { EventEditor, EventPlanCase, EventPlanDevice, EventPlanItem, EventRow, EventStatus, Item, ResolvedQr } from '../types';
import { eventStatusLabels, formatDateTime } from '../utils/format';

function allowedTransitions(current: EventStatus): EventStatus[] {
  switch (current) {
    case 'entwurf':
      return ['geplant', 'vorbereitung', 'abgesagt'];
    case 'geplant':
      return ['vorbereitung', 'abgesagt'];
    case 'vorbereitung':
      return ['aktiv', 'abgesagt'];
    case 'aktiv':
      return ['abgeschlossen', 'abgesagt'];
    default:
      return [];
  }
}

interface EventDetail {
  event: EventRow;
  items: EventPlanItem[];
  devices: EventPlanDevice[];
  checkouts: unknown[];
  cases: EventPlanCase[];
  editors: EventEditor[];
  can_edit: boolean;
}

export default function EventDetailPage() {
  const [params] = useSearchParams();
  const eventId = Number(params.get('id'));

  const [data, setData] = useState<EventDetail | null>(null);
  const [devices, setDevices] = useState<Item[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  const [deviceModal, setDeviceModal] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [deviceQty, setDeviceQty] = useState('1');
  const [itemModal, setItemModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState('');
  const [itemQty, setItemQty] = useState('1');
  const [caseModal, setCaseModal] = useState(false);
  const [selectedCase, setSelectedCase] = useState('');
  const [allCases, setAllCases] = useState<EventPlanCase[]>([]);
  const [deviceQtyDrafts, setDeviceQtyDrafts] = useState<Record<number, string>>({});
  const [deviceQtyBusy, setDeviceQtyBusy] = useState<number | null>(null);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [evResp, devResp, artResp, casesResp] = await Promise.all([
        api<EventDetail>(`/api/events/${eventId}`),
        api<{ items: Item[] }>('/api/devices?pageSize=500'),
        api<{ items: Item[] }>('/api/articles?pageSize=500'),
        api<{ cases: EventPlanCase[] }>('/api/cases'),
      ]);
      setData(evResp);
      setDevices(devResp.items);
      setItems(artResp.items);
      setAllCases(casesResp.cases);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
      setNotFound(err instanceof ApiError && err.status === 404);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const assignedDeviceIds = useMemo(
    () => new Set((data?.devices ?? []).map((d) => d.item_id)),
    [data]
  );

  const assignedItemIds = useMemo(
    () => new Set((data?.items ?? []).map((d) => d.item_id)),
    [data]
  );

  const assignedCaseIds = useMemo(
    () => new Set((data?.cases ?? []).map((d) => d.case_id)),
    [data]
  );

  const freeDevices = useMemo(
    () => devices.filter((d) => !assignedDeviceIds.has(d.id)),
    [devices, assignedDeviceIds]
  );

  const freeItems = useMemo(
    () => items.filter((d) => !assignedItemIds.has(d.id)),
    [items, assignedItemIds]
  );

  const freeCases = useMemo(
    () => allCases.filter((d) => !assignedCaseIds.has(d.id)),
    [allCases, assignedCaseIds]
  );

  async function changeStatus(status: EventStatus) {
    setError('');
    try {
      await api(`/api/events/${eventId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Statusänderung fehlgeschlagen');
    }
  }

  async function addDevice() {
    if (!selectedDevice) return;
    setError('');
    try {
      await api(`/api/events/${eventId}/devices`, {
        method: 'POST',
        body: JSON.stringify({
          item_id: Number(selectedDevice),
          quantity: Math.max(1, Number(deviceQty) || 1),
        }),
      });
      setDeviceModal(false);
      setSelectedDevice('');
      setDeviceQty('1');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Hinzufügen fehlgeschlagen');
    }
  }

  async function saveDeviceQty(itemId: number) {
    const raw = deviceQtyDrafts[itemId];
    if (raw === undefined) return;
    const qty = Math.max(1, Number(raw) || 1);
    setError('');
    setDeviceQtyBusy(itemId);
    try {
      await api(`/api/events/${eventId}/devices/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity: qty }),
      });
      setDeviceQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Stückzahl konnte nicht gespeichert werden');
    } finally {
      setDeviceQtyBusy(null);
    }
  }

  async function removeDevice(itemId: number) {
    setError('');
    try {
      await api(`/api/events/${eventId}/devices/${itemId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Entfernen fehlgeschlagen');
    }
  }

  async function addItem() {
    if (!selectedItem) return;
    setError('');
    try {
      await api(`/api/events/${eventId}/items`, {
        method: 'POST',
        body: JSON.stringify({
          item_id: Number(selectedItem),
          quantity: Math.max(1, Number(itemQty) || 1),
        }),
      });
      setItemModal(false);
      setSelectedItem('');
      setItemQty('1');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Hinzufügen fehlgeschlagen');
    }
  }

  async function removeItem(itemId: number) {
    setError('');
    try {
      await api(`/api/events/${eventId}/items/${itemId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Entfernen fehlgeschlagen');
    }
  }

  async function addCase() {
    if (!selectedCase) return;
    setError('');
    try {
      await api(`/api/events/${eventId}/cases`, {
        method: 'POST',
        body: JSON.stringify({ case_id: Number(selectedCase) }),
      });
      setCaseModal(false);
      setSelectedCase('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Hinzufügen fehlgeschlagen');
    }
  }

  async function removeCase(caseId: number) {
    setError('');
    try {
      await api(`/api/events/${eventId}/cases/${caseId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Entfernen fehlgeschlagen');
    }
  }

  function extractToken(text: string): string | null {
    const m = text.match(/[a-f0-9]{32}/i);
    return m ? m[0].toLowerCase() : null;
  }

  async function processScanned(text: string) {
    setScanMsg(null);
    const token = extractToken(text);
    if (!token) {
      setScanMsg({ tone: 'error', text: 'Kein gültiger QR-Code erkannt.' });
      return;
    }
    setScanBusy(true);
    try {
      const qr = await api<ResolvedQr>(`/api/resolve/${token}`);
      if (qr.type === 'location') {
        setScanMsg({
          tone: 'info',
          text: `„${qr.name}“ ist ein Lagerort – Lagerorte können nicht eingeplant werden.`,
        });
        return;
      }
      if (qr.type === 'case') {
        await api(`/api/events/${eventId}/cases`, {
          method: 'POST',
          body: JSON.stringify({ case_id: qr.id }),
        });
        setScanMsg({ tone: 'success', text: `Koffer „${qr.name}“ wurde eingeplant.` });
      } else if (qr.kind === 'geraet') {
        if (assignedDeviceIds.has(qr.id)) {
          setScanMsg({ tone: 'info', text: `Gerät „${qr.name}“ ist bereits eingeplant.` });
          return;
        }
        await api(`/api/events/${eventId}/devices`, {
          method: 'POST',
          body: JSON.stringify({ item_id: qr.id }),
        });
        setScanMsg({ tone: 'success', text: `Gerät „${qr.name}“ wurde eingeplant.` });
      } else {
        const existing = data?.items?.find((i) => i.item_id === qr.id);
        const qty = (existing?.quantity ?? 0) + 1;
        await api(`/api/events/${eventId}/items`, {
          method: 'POST',
          body: JSON.stringify({ item_id: qr.id, quantity: qty }),
        });
        setScanMsg({ tone: 'success', text: `Artikel „${qr.name}“ eingeplant (Menge ${qty}).` });
      }
      await load();
    } catch (err) {
      setScanMsg({ tone: 'error', text: err instanceof ApiError ? err.message : 'Einplanen fehlgeschlagen' });
    } finally {
      setScanBusy(false);
    }
  }

  function handleScanSubmit(e: FormEvent) {
    e.preventDefault();
    const text = scanInput.trim();
    if (!text) return;
    setScanInput('');
    void processScanned(text);
  }

  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <>
        {notFound ? (
          <NotFound
            icon="calendar"
            title="Event nicht gefunden"
            hint={error || 'Das angeforderte Event existiert nicht (mehr).'}
            backTo="/events"
            backLabel="Zu den Events"
          />
        ) : (
          <>
            {error && <Alert tone="error">{error}</Alert>}
            <NotFound
              icon="alert"
              title="Laden fehlgeschlagen"
              hint="Die Daten konnten nicht geladen werden. Bitte erneut versuchen."
              backTo="/events"
              backLabel="Zu den Events"
            />
          </>
        )}
      </>
    );
  }

  const { event: ev } = data;
  const canEdit = data.can_edit;
  const transitions = allowedTransitions(ev.status);

  return (
    <>
      <PageHeader
        title={ev.name}
        backTo="/events"
        actions={
          <div className="page-actions">
            <StatusBadge status={ev.status} label={eventStatusLabels[ev.status]} />
            {canEdit && (
              <>
                <Link className="btn btn-primary" to={`/events/new?id=${ev.id}`}>
                  <Icon name="edit" size={16} />
                  Bearbeiten
                </Link>
                {transitions.map((s) => (
                  <button
                    key={s}
                    className={`btn${s === 'abgeschlossen' || s === 'abgesagt' ? ' btn-danger' : ' btn-primary'}`}
                    onClick={() => void changeStatus(s)}
                  >
                    {s === 'aktiv' ? 'Aktivieren' : eventStatusLabels[s]}
                  </button>
                ))}
              </>
            )}
          </div>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {!canEdit && (
        <Alert tone="info">
          Dieses Event kannst du nur anschauen. Es darf nur vom Ersteller, von freigegebenen
          Bearbeitern oder von Administratoren geändert werden.
        </Alert>
      )}

      {canEdit && (
        <div className="card scan-bar">
          <Icon name="scan" size={18} />
          <strong>QR einplanen</strong>
          <form className="scan-form" onSubmit={handleScanSubmit}>
            <input
              className="form-input"
              placeholder="QR-Code scannen oder einfügen …"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              autoComplete="off"
            />
            <button className="btn" type="submit" disabled={scanBusy || !scanInput.trim()}>
              <Icon name="plus" size={16} />
              Einplanen
            </button>
          </form>
          <button className="btn" onClick={() => setScannerOpen(true)}>
            <Icon name="qr" size={16} />
            Kamera
          </button>
        </div>
      )}

      {scanMsg && <Alert tone={scanMsg.tone}>{scanMsg.text}</Alert>}

      <div className="detail-grid">
        <section className="card">
          <h2 className="section-title">Details</h2>
          <dl className="detail-list">
            <dt>Ort</dt>
            <dd>{ev.location ?? '–'}</dd>
            <dt>Kontakt</dt>
            <dd>{ev.contact_name ?? '–'}</dd>
            <dt>Beginn</dt>
            <dd>{formatDateTime(ev.starts_at)}</dd>
            <dt>Ende</dt>
            <dd>{formatDateTime(ev.ends_at)}</dd>
            <dt>Status</dt>
            <dd><StatusBadge status={ev.status} label={eventStatusLabels[ev.status]} /></dd>
            <dt>Erstellt von</dt>
            <dd>{ev.created_by_name ?? '–'}</dd>
            <dt>Bearbeitung erlaubt für</dt>
            <dd>
              {data.editors.length === 0
                ? 'Nur Ersteller & Admins'
                : data.editors.map((e) => e.name).join(', ')}
            </dd>
          </dl>
          {ev.description && (
            <>
              <h3 className="section-sub">Beschreibung</h3>
              <p className="pre-wrap">{ev.description}</p>
            </>
          )}
          {ev.notes && (
            <>
              <h3 className="section-sub">Notizen</h3>
              <p className="pre-wrap">{ev.notes}</p>
            </>
          )}
        </section>

        <section className="card">
          <h2 className="section-title">Geplante Geräte ({data.devices.length})</h2>
          {data.devices.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Gerät</th>
                    <th>Inventarnummer</th>
                    <th>Stückzahl</th>
                    <th>Kategorie</th>
                    <th>Status</th>
                    <th>Notiz</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.devices.map((d) => (
                    <tr key={d.item_id}>
                      <td>
                        <Link to={`/inventar/detail?id=${d.item_id}`} className="table-link">
                          <Icon name="device" size={16} />
                          <strong>{d.name}</strong>
                        </Link>
                      </td>
                      <td className="mono">{d.inventory_number ?? '–'}</td>
                      <td>
                        {canEdit ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              className="form-input qty-input"
                              type="number"
                              min={1}
                              value={deviceQtyDrafts[d.item_id] ?? String(d.quantity)}
                              onChange={(e) =>
                                setDeviceQtyDrafts((prev) => ({
                                  ...prev,
                                  [d.item_id]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void saveDeviceQty(d.item_id);
                              }}
                            />
                            {(deviceQtyDrafts[d.item_id] !== undefined ||
                              deviceQtyBusy === d.item_id) && (
                              <button
                                className="btn btn-sm"
                                disabled={deviceQtyBusy === d.item_id}
                                onClick={() => void saveDeviceQty(d.item_id)}
                              >
                                <Icon name="check" size={14} />
                              </button>
                            )}
                          </div>
                        ) : (
                          d.quantity
                        )}
                      </td>
                      <td>{d.category_name ?? '–'}</td>
                      <td>
                        <Badge tone={d.status === 'abgeschlossen' ? 'success' : 'accent'}>
                          {d.status}
                        </Badge>
                      </td>
                      <td>{d.note ?? '–'}</td>
                      <td>
                        {canEdit && (
                          <button
                            className="icon-btn danger"
                            title="Entfernen"
                            onClick={() => void removeDevice(d.item_id)}
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canEdit && (
            <div className="toolbar">
              <button className="btn btn-primary btn-sm" onClick={() => setDeviceModal(true)}>
                <Icon name="plus" size={16} />
                Gerät hinzufügen
              </button>
            </div>
          )}
        </section>
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title">Geplante Artikel ({data.items.length})</h2>
        {data.items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Artikel</th>
                  <th>Inventarnummer</th>
                  <th>Menge</th>
                  <th>Verfügbar</th>
                  <th>Notiz</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((d) => (
                  <tr key={d.item_id}>
                    <td>
                      <Link to={`/inventar/detail?id=${d.item_id}`} className="table-link">
                        <Icon name="package" size={16} />
                        <strong>{d.name}</strong>
                      </Link>
                    </td>
                    <td className="mono">{d.inventory_number ?? '–'}</td>
                    <td>{d.quantity}</td>
                    <td>{d.stock} {d.unit ?? ''}</td>
                    <td>{d.note ?? '–'}</td>
                    <td>
                      {canEdit && (
                        <button
                          className="icon-btn danger"
                          title="Entfernen"
                          onClick={() => void removeItem(d.item_id)}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <div className="toolbar">
            <button className="btn btn-primary btn-sm" onClick={() => setItemModal(true)}>
              <Icon name="plus" size={16} />
              Artikel hinzufügen
            </button>
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title">Geplante Koffer ({data.cases.length})</h2>
        {data.cases.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Koffer</th>
                  <th>Code</th>
                  <th>Lagerort</th>
                  <th>Assets</th>
                  <th>Notiz</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.cases.map((d) => (
                  <tr key={d.case_id}>
                    <td>
                      <Link to={`/cases/detail?id=${d.case_id}`} className="table-link">
                        <Icon name="case" size={16} />
                        <strong>{d.name}</strong>
                      </Link>
                    </td>
                    <td className="mono">{d.code ?? '–'}</td>
                    <td>{d.location_path ?? '–'}</td>
                    <td>{d.item_count} Asset{d.item_count === 1 ? '' : 's'}</td>
                    <td>{d.note ?? '–'}</td>
                    <td>
                      {canEdit && (
                        <button
                          className="icon-btn danger"
                          title="Entfernen"
                          onClick={() => void removeCase(d.case_id)}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <div className="toolbar">
            <button className="btn btn-primary btn-sm" onClick={() => setCaseModal(true)}>
              <Icon name="plus" size={16} />
              Koffer hinzufügen
            </button>
          </div>
        )}
      </section>

      {deviceModal && (
        <Modal title="Gerät hinzufügen" onClose={() => setDeviceModal(false)}>
          <Field label="Gerät auswählen">
            <select
              className="form-select"
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
            >
              <option value="">– Gerät wählen –</option>
              {freeDevices.map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d.inventory_number ? `${d.inventory_number} – ` : ''}{d.name}
                  {d.location_path ? ` (${d.location_path})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stückzahl (Bedarf)">
            <input
              className="form-input"
              type="number"
              min={1}
              value={deviceQty}
              onChange={(e) => setDeviceQty(e.target.value)}
            />
            <div className="form-hint">Wie viele Stück dieses Geräts werden benötigt.</div>
          </Field>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDeviceModal(false)}>
              Abbrechen
            </button>
            <button
              className="btn btn-primary"
              disabled={!selectedDevice}
              onClick={() => void addDevice()}
            >
              Hinzufügen
            </button>
          </div>
        </Modal>
      )}

      {itemModal && (
        <Modal title="Artikel hinzufügen" onClose={() => setItemModal(false)}>
          <Field label="Artikel auswählen">
            <select
              className="form-select"
              value={selectedItem}
              onChange={(e) => setSelectedItem(e.target.value)}
            >
              <option value="">– Artikel wählen –</option>
              {freeItems.map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d.inventory_number ? `${d.inventory_number} – ` : ''}{d.name}
                  {d.unit ? ` (${d.quantity} ${d.unit} verfügbar)` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Menge">
            <input
              className="form-input"
              type="number"
              min={1}
              value={itemQty}
              onChange={(e) => setItemQty(e.target.value)}
            />
          </Field>
          <div className="modal-actions">
            <button className="btn" onClick={() => setItemModal(false)}>
              Abbrechen
            </button>
            <button
              className="btn btn-primary"
              disabled={!selectedItem}
              onClick={() => void addItem()}
            >
              Hinzufügen
            </button>
          </div>
        </Modal>
      )}

      {caseModal && (
        <Modal title="Koffer hinzufügen" onClose={() => setCaseModal(false)}>
          <Field label="Koffer auswählen">
            <select
              className="form-select"
              value={selectedCase}
              onChange={(e) => setSelectedCase(e.target.value)}
            >
              <option value="">– Koffer wählen –</option>
              {freeCases.map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d.code ? `${d.code} – ` : ''}{d.name}
                  {d.location_path ? ` (${d.location_path})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <div className="modal-actions">
            <button className="btn" onClick={() => setCaseModal(false)}>
              Abbrechen
            </button>
            <button
              className="btn btn-primary"
              disabled={!selectedCase}
              onClick={() => void addCase()}
            >
              Hinzufügen
            </button>
          </div>
        </Modal>
      )}

      {scannerOpen && (
        <QrScannerModal
          onClose={() => setScannerOpen(false)}
          onResult={(text) => {
            setScannerOpen(false);
            void processScanned(text);
          }}
        />
      )}
    </>
  );
}