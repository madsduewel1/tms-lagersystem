import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, fileUrl } from '../api/client';
import { PageHeader, Alert, Loading, Modal, Field, Badge } from '../components/ui';
import { Icon } from '../components/Icon';
import { NotFound } from '../components/NotFound';
import type { CaseItem, CaseRow, Item } from '../types';
import { deviceStatusLabels, formatDate } from '../utils/format';

export default function CaseDetailPage() {
  const [params] = useSearchParams();
  const caseId = Number(params.get('id'));

  const [data, setData] = useState<{ case: CaseRow; items: CaseItem[] } | null>(null);
  const [devices, setDevices] = useState<Item[]>([]);
  const [articles, setArticles] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  const [itemModal, setItemModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState('');
  const [itemQty, setItemQty] = useState('1');
  const [itemNote, setItemNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [resp, devResp, artResp] = await Promise.all([
        api<{ case: CaseRow; items: CaseItem[] }>(`/api/cases/${caseId}`),
        api<{ items: Item[] }>('/api/devices?pageSize=500'),
        api<{ items: Item[] }>('/api/articles?pageSize=500'),
      ]);
      setData(resp);
      setDevices(devResp.items);
      setArticles(artResp.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
      setNotFound(err instanceof ApiError && err.status === 404);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const assignedIds = useMemo(
    () => new Set((data?.items ?? []).map((d) => d.item_id)),
    [data]
  );

  const freeAssets = useMemo(
    () => [
      ...devices.filter((d) => !assignedIds.has(d.id)).map((d) => ({ ...d, _kindLabel: 'Gerät' })),
      ...articles.filter((d) => !assignedIds.has(d.id)).map((d) => ({ ...d, _kindLabel: 'Artikel' })),
    ],
    [devices, articles, assignedIds]
  );

  async function addItem() {
    if (!selectedItem) return;
    setError('');
    try {
      await api(`/api/cases/${caseId}/items`, {
        method: 'POST',
        body: JSON.stringify({
          item_id: Number(selectedItem),
          quantity: Math.max(1, Number(itemQty) || 1),
          note: itemNote.trim() || null,
        }),
      });
      setItemModal(false);
      setSelectedItem('');
      setItemQty('1');
      setItemNote('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Hinzufügen fehlgeschlagen');
    }
  }

  async function removeItem(itemId: number) {
    setError('');
    try {
      await api(`/api/cases/${caseId}/items/${itemId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Entfernen fehlgeschlagen');
    }
  }

  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <>
        {notFound ? (
          <NotFound
            icon="case"
            title="Case nicht gefunden"
            hint={error || 'Der angeforderte Case existiert nicht (mehr).'}
            backTo="/cases"
            backLabel="Zu den Cases"
          />
        ) : (
          <>
            {error && <Alert tone="error">{error}</Alert>}
            <NotFound
              icon="alert"
              title="Laden fehlgeschlagen"
              hint="Die Daten konnten nicht geladen werden. Bitte erneut versuchen."
              backTo="/cases"
              backLabel="Zu den Cases"
            />
          </>
        )}
      </>
    );
  }

  const cas = data.case;
  const caseStatusLabels: Record<string, string> = deviceStatusLabels;

  return (
    <>
      <PageHeader
        title={cas.name}
        backTo="/cases"
        actions={
          <div className="page-actions">
            <Badge tone={
              cas.status === 'verfuegbar' ? 'success' :
              cas.status === 'ausgelagert' ? 'accent' :
              cas.status === 'defekt' ? 'danger' : 'muted'
            }>
              {caseStatusLabels[cas.status]}
            </Badge>
            <a
              className="btn"
              href={cas.qr_token ? fileUrl(`/api/labels/qr/${cas.qr_token}`) : undefined}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="qr" size={16} />
              Label
            </a>
            <Link className="btn btn-primary" to={`/cases/new?id=${cas.id}`}>
              <Icon name="edit" size={16} />
              Bearbeiten
            </Link>
          </div>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="detail-grid">
        <section className="card">
          <h2 className="section-title">Details</h2>
          <dl className="detail-list">
            <dt>Code</dt>
            <dd className="mono">{cas.code ?? '–'}</dd>
            <dt>Lagerort</dt>
            <dd>{cas.location_path ?? '–'}</dd>
            <dt>Assets</dt>
            <dd>{cas.item_count} Asset{cas.item_count === 1 ? '' : 's'}</dd>
            {cas.qr_token && (
              <>
                <dt>QR-Code</dt>
                <dd>
                  <a
                    className="qr-link"
                    href={`${window.location.origin}/lagersystem/c/${cas.qr_token}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon name="qr" size={16} />
                    Label öffnen
                  </a>
                </dd>
              </>
            )}
            <dt>Angelegt</dt>
            <dd>{formatDate(cas.created_at)}</dd>
          </dl>
          {cas.description && (
            <>
              <h3 className="section-sub">Beschreibung</h3>
              <p className="pre-wrap">{cas.description}</p>
            </>
          )}
        </section>

        <section className="card">
          <h2 className="section-title">Inhalt ({data.items.length})</h2>
          {data.items.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Inventarnummer</th>
                    <th>Kategorie</th>
                    <th>Menge</th>
                    <th>Notiz</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((d) => (
                    <tr key={d.item_id}>
                      <td>
                        <Link to={`/inventar/detail?id=${d.item_id}`} className="table-link">
                          <Icon name={d.kind === 'geraet' ? 'device' : 'package'} size={16} />
                          <strong>{d.name}</strong>
                        </Link>
                      </td>
                      <td className="mono">{d.inventory_number ?? '–'}</td>
                      <td>{d.category_name ?? '–'}</td>
                      <td>{d.quantity} {d.unit ?? ''}</td>
                      <td>{d.note ?? '–'}</td>
                      <td>
                        <button
                          className="icon-btn danger"
                          title="Entfernen"
                          onClick={() => void removeItem(d.item_id)}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-row">Noch keine Assets im Koffer.</p>
          )}
          <div className="toolbar">
            <button className="btn btn-primary btn-sm" onClick={() => setItemModal(true)}>
              <Icon name="plus" size={16} />
              Asset hinzufügen
            </button>
          </div>
        </section>
      </div>

      {itemModal && (
        <Modal title="Asset hinzufügen" onClose={() => setItemModal(false)}>
          <Field label="Asset auswählen">
            <select
              className="form-select"
              value={selectedItem}
              onChange={(e) => setSelectedItem(e.target.value)}
            >
              <option value="">– Asset wählen –</option>
              {freeAssets.map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d._kindLabel}: {d.inventory_number ? `${d.inventory_number} – ` : ''}{d.name}
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
          <Field label="Notiz">
            <input
              className="form-input"
              value={itemNote}
              onChange={(e) => setItemNote(e.target.value)}
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
    </>
  );
}