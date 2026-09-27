import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, downloadFileQuiet } from '../api/client';
import { PageHeader, Alert, Loading, EmptyState, StatusBadge, Badge } from '../components/ui';
import { Icon } from '../components/Icon';
import { NotFound } from '../components/NotFound';
import type { Item, StorageLocation } from '../types';
import { deviceStatusLabels } from '../utils/format';

type LocType = 'lager' | 'regal' | 'fach';
const typeLabels: Record<LocType, string> = { lager: 'Lager', regal: 'Regal', fach: 'Fach' };

export default function LocationDetailPage() {
  const [params] = useSearchParams();
  const locId = Number(params.get('id'));

  const [location, setLocation] = useState<StorageLocation | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [children, setChildren] = useState<Array<{ id: number; type: string; name: string; code: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{
        location: StorageLocation;
        items: Item[];
        children: Array<{ id: number; type: string; name: string; code: string | null }>;
      }>(`/api/storage-locations/${locId}`);
      setLocation(data.location);
      setItems(data.items);
      setChildren(data.children);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
      setNotFound(err instanceof ApiError && err.status === 404);
    } finally {
      setLoading(false);
    }
  }, [locId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !location) return <Loading />;

  if (!location) {
    return (
      <>
        {notFound ? (
          <NotFound
            icon="map-pin"
            title="Lagerort nicht gefunden"
            hint={error || 'Der angeforderte Lagerort existiert nicht (mehr).'}
            backTo="/lagerorte"
            backLabel="Zu den Lagerorten"
          />
        ) : (
          <>
            {error && <Alert tone="error">{error}</Alert>}
            <NotFound
              icon="alert"
              title="Laden fehlgeschlagen"
              hint="Die Daten konnten nicht geladen werden. Bitte erneut versuchen."
              backTo="/lagerorte"
              backLabel="Zu den Lagerorten"
            />
          </>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={location.name}
        subtitle={location.code ? `Code: ${location.code}` : undefined}
        backTo="/lagerorte"
        actions={
          <>
            <Badge tone="muted">{typeLabels[location.type as LocType] ?? location.type}</Badge>
            <button
              className="btn"
              onClick={() =>
                downloadFileQuiet(
                  `/api/labels/pdf?type=location&ids=${location.id}`,
                  `label-${location.code ?? location.id}.pdf`,
                  setError
                )
              }
            >
              <Icon name="qr" size={16} />
              Label
            </button>
            <Link className="btn btn-primary" to={`/lagerorte/new?id=${location.id}`}>
              <Icon name="edit" size={16} />
              Bearbeiten
            </Link>
          </>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {location.description && (
        <div className="card" style={{ marginBottom: 20 }}>
          <p className="pre-wrap">{location.description}</p>
        </div>
      )}

      {children.length > 0 && (
        <section className="card" style={{ marginBottom: 20 }}>
          <h2 className="section-title">Untergeordnete Lagerorte ({children.length})</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Bezeichnung</th>
                  <th>Typ</th>
                  <th>Code</th>
                </tr>
              </thead>
              <tbody>
                {children.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/lagerorte/detail?id=${c.id}`} className="table-link">
                        <Icon name="map-pin" size={16} />
                        <strong>{c.name}</strong>
                      </Link>
                    </td>
                    <td>{typeLabels[c.type as LocType] ?? c.type}</td>
                    <td className="mono">{c.code ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <h2 className="section-title">Assets an diesem Lagerort ({items.length})</h2>
        {items.length === 0 ? (
          <EmptyState icon="boxes" title="Keine Assets hinterlegt" hint="Diesem Lagerort sind noch keine Assets zugeordnet." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Inventarnummer</th>
                  <th>Status</th>
                  {items.some((i) => i.kind === 'artikel') && <th>Bestand</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <Link to={`/inventar/detail?id=${it.id}`} className="table-link">
                        <Icon name={it.kind === 'geraet' ? 'device' : 'package'} size={16} />
                        <strong>{it.name}</strong>
                      </Link>
                    </td>
                    <td className="mono">{it.inventory_number ?? '–'}</td>
                    <td>
                      <StatusBadge status={it.status} label={deviceStatusLabels[it.status]} />
                    </td>
                    {items.some((i) => i.kind === 'artikel') && (
                      <td>{it.kind === 'artikel' ? `${it.quantity} ${it.unit ?? ''}` : '–'}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}