import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, downloadFile } from '../api/client';
import { PageHeader, Alert, EmptyState, StatusBadge, Loading } from '../components/ui';
import { Icon } from '../components/Icon';
import type { Category, DeviceStatus, Item, StorageLocation } from '../types';
import { deviceStatusLabels } from '../utils/format';

const statuses: DeviceStatus[] = [
  'verfuegbar',
  'ausgelagert',
  'defekt',
  'wartung',
  'verloren',
  'ausser_betrieb',
];

export default function InventoryPage() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<Item[]>([]);
  const [articles, setArticles] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [, setLocations] = useState<StorageLocation[]>([]);
  const [tab, setTab] = useState<'alle' | 'geraet' | 'artikel'>('alle');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [devResp, artResp, catResp, locResp] = await Promise.all([
        api<{ items: Item[]; total: number }>('/api/devices?pageSize=300'),
        api<{ items: Item[]; total: number }>('/api/articles?pageSize=300'),
        api<{ categories: Category[] }>('/api/categories'),
        api<{ locations: StorageLocation[] }>('/api/storage-locations'),
      ]);
      setDevices(devResp.items);
      setArticles(artResp.items);
      setCategories(catResp.categories);
      setLocations(locResp.locations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const all: Item[] = useMemo(() => [...devices, ...articles], [devices, articles]);
  const catMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories]
  );

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return all
      .filter((it) => (tab === 'alle' ? true : it.kind === tab))
      .filter((it) => !categoryId || String(it.category_id) === categoryId)
      .filter((it) => !status || it.status === status)
      .filter((it) =>
        query
          ? [it.name, it.inventory_number, it.serial_number, it.manufacturer, it.model]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(query)
          : true
      )
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? 'de'));
  }, [all, tab, q, categoryId, status]);

  const hasFilters = Boolean(q || categoryId || status);

  async function removeItem(it: Item) {
    setError('');
    if (!window.confirm(`„${it.name}“ wirklich löschen?`)) return;
    try {
      await api(`/api/${it.kind === 'geraet' ? 'devices' : 'articles'}/${it.id}`, {
        method: 'DELETE',
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen');
    }
  }

  return (
    <>
      <PageHeader
        title="Inventar"
        subtitle="Geräte und Artikel verwalten"
        actions={
          <button className="btn btn-primary" onClick={() => navigate('/inventar/new')}>
            <Icon name="plus" size={16} />
            Neues Asset
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card filter-bar">
        <div className="segmented">
          {(['alle', 'geraet', 'artikel'] as const).map((t) => (
            <button
              key={t}
              className={`segment${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'alle' ? 'Alle' : t === 'geraet' ? 'Geräte' : 'Artikel'}
            </button>
          ))}
        </div>
        <input
          className="form-input"
          style={{ maxWidth: 260 }}
          placeholder="Suchen …"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="form-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Alle Kategorien</option>
          {categories.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Alle Status</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {deviceStatusLabels[s]}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="boxes"
          title="Keine Assets gefunden"
          hint={hasFilters ? 'Die Filter ergeben keine Treffer.' : 'Lege dein erstes Gerät oder deinen ersten Artikel an.'}
          action={
            !hasFilters ? (
              <button className="btn btn-primary" onClick={() => navigate('/inventar/new')}>
                <Icon name="plus" size={16} />
                Neues Asset
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Inventarnummer</th>
                  <th>Kategorie</th>
                  <th>Case</th>
                  <th>Lagerort</th>
                  <th>Status</th>
                  <th>Menge</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <Link to={`/inventar/detail?id=${it.id}`} className="table-link">
                        <Icon name={it.kind === 'geraet' ? 'device' : 'package'} size={16} />
                        <strong>{it.name}</strong>
                      </Link>
                    </td>
                    <td className="mono">{it.inventory_number || '–'}</td>
                    <td>{it.category_id ? (catMap.get(it.category_id) ?? '–') : '–'}</td>
                    <td>
                      {it.case_name ? (
                        <Link to={`/cases/detail?id=${it.case_id}`} className="table-link">
                          <Icon name="case" size={14} />
                          <span>{it.case_code ? `${it.case_code} – ` : ''}{it.case_name}</span>
                        </Link>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td>{it.location_path ?? '–'}</td>
                    <td>
                      <StatusBadge status={it.status} label={deviceStatusLabels[it.status]} />
                    </td>
                    <td>{it.quantity} {it.unit ?? (it.kind === 'geraet' ? 'Stück' : '')}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-btn"
                          title="Label drucken"
                          onClick={() =>
                            void downloadFile(
                              `/api/labels/pdf?type=item&ids=${it.id}`,
                              `label-${it.inventory_number ?? it.id}.pdf`
                            )
                          }
                        >
                          <Icon name="qr" size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Bearbeiten"
                          onClick={() => navigate(`/inventar/new?id=${it.id}`)}
                        >
                          <Icon name="edit" size={16} />
                        </button>
                        <button
                          className="icon-btn danger"
                          title="Löschen"
                          onClick={() => void removeItem(it)}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}