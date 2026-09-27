import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, downloadFileQuiet } from '../api/client';
import { PageHeader, Alert, EmptyState, Loading, Badge } from '../components/ui';
import { Icon } from '../components/Icon';
import type { StorageLocation } from '../types';

type LocType = 'lager' | 'regal' | 'fach';

const typeLabels: Record<LocType, string> = { lager: 'Lager', regal: 'Regal', fach: 'Fach' };

function LocationNode({ loc }: { loc: StorageLocation }) {
  const [open, setOpen] = useState(true);
  const hasChildren = (loc.children?.length ?? 0) > 0;

  return (
    <div className="tree-node">
      <div className="tree-row">
        {hasChildren ? (
          <button className="tree-toggle" onClick={() => setOpen((o) => !o)} aria-label="Auf-/zuklappen">
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={15} />
          </button>
        ) : (
          <span className="tree-toggle placeholder" />
        )}
        <Link to={`/lagerorte/detail?id=${loc.id}`} className="tree-link">
          <Icon name={'layers'} size={16} />
          <span className="tree-name">{loc.name}</span>
          {loc.code && <span className="mono hint-inline">{loc.code}</span>}
          <span className="badge badge-muted">{typeLabels[loc.type as LocType] ?? loc.type}</span>
          {typeof loc.item_count === 'number' && loc.item_count > 0 && (
            <span className="badge badge-accent">{loc.item_count} {loc.item_count === 1 ? 'Asset' : 'Assets'}</span>
          )}
        </Link>
        <button
          className="icon-btn"
          title="Label drucken"
          onClick={() => downloadFileQuiet(`/api/labels/pdf?type=location&ids=${loc.id}`, `label-${loc.code ?? loc.id}.pdf`)}
        >
          <Icon name="qr" size={15} />
        </button>
      </div>
      {open && hasChildren && (
        <div className="tree-children">
          {loc.children!.map((child) => (
            <LocationNode key={child.id} loc={child} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function LocationsPage() {
  const navigate = useNavigate();
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ locations: StorageLocation[] }>('/api/storage-locations');
      setLocations(data.locations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const roots = locations.filter((l) => !l.parent_id);
  const count = locations.length;

  async function removeLoc(loc: StorageLocation) {
    setError('');
    if (!window.confirm(`Lagerplatz „${loc.name}“ wirklich löschen?`)) return;
    try {
      await api(`/api/storage-locations/${loc.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.message}${loc.item_count ? ' – Es sind noch Assets hinterlegt.' : ''}`
          : 'Löschen fehlgeschlagen'
      );
    }
  }

  return (
    <>
      <PageHeader
        title="Lagerorte"
        subtitle={`${count} Lager, Regale & Fächer`}
        actions={
          <button className="btn btn-primary" onClick={() => navigate('/lagerorte/new')}>
            <Icon name="plus" size={16} />
            Neuer Lagerort
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <Loading />
      ) : roots.length === 0 ? (
        <EmptyState
          icon="grid"
          title="Noch keine Lagerorte"
          hint="Lege zuerst ein Hauptlager an, danach kannst du Regale und Fächer verschachteln."
          action={
            <button className="btn btn-primary" onClick={() => navigate('/lagerorte/new')}>
              <Icon name="plus" size={16} />
              Lager anlegen
            </button>
          }
        />
      ) : (
        <div className="card">
          <div className="tree">
            {roots.map((loc) => (
              <LocationNode key={loc.id} loc={loc} />
            ))}
          </div>
        </div>
      )}

      <section className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title">Alle Lagerorte</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Bezeichnung</th>
                <th>Typ</th>
                <th>Code</th>
                <th>Assets</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link to={`/lagerorte/detail?id=${l.id}`} className="table-link">
                      <Icon name="map-pin" size={16} />
                      <strong>{l.name}</strong>
                    </Link>
                  </td>
                  <td><Badge tone="muted">{typeLabels[l.type] ?? l.type}</Badge></td>
                  <td className="mono">{l.code ?? '–'}</td>
                  <td>{l.item_count ?? 0}</td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" title="Label drucken"
                        onClick={() => downloadFileQuiet(`/api/labels/pdf?type=location&ids=${l.id}`, `label-${l.code ?? l.id}.pdf`, setError)}>
                        <Icon name="qr" size={16} />
                      </button>
                      <button className="icon-btn" title="Bearbeiten" onClick={() => navigate(`/lagerorte/new?id=${l.id}`)}>
                        <Icon name="edit" size={16} />
                      </button>
                      <button className="icon-btn danger" title="Löschen" onClick={() => void removeLoc(l)}>
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}