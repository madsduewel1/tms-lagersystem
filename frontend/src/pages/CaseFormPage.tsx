import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { PageHeader, Field, Alert, Loading } from '../components/ui';
import type { CaseRow, CaseStatus, StorageLocation } from '../types';
import { deviceStatusLabels } from '../utils/format';

const statuses: CaseStatus[] = ['verfuegbar', 'ausgelagert', 'defekt', 'ausser_betrieb'];

interface FlatLocation extends StorageLocation {
  path: string;
}

function flattenTree(nodes: StorageLocation[], prefix = ''): FlatLocation[] {
  const out: FlatLocation[] = [];
  for (const node of nodes) {
    const path = prefix ? `${prefix} / ${node.name}` : node.name;
    out.push({ ...node, path });
    if (node.children?.length) out.push(...flattenTree(node.children, path));
  }
  return out;
}

export default function CaseFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editId = params.get('id');

  const [locations, setLocations] = useState<FlatLocation[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [locationId, setLocationId] = useState('');
  const [status, setStatus] = useState<CaseStatus>('verfuegbar');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(editId));

  const isEdit = Boolean(editId);

  const loadLocations = useCallback(async () => {
    try {
      const data = await api<{ tree: StorageLocation[] }>('/api/storage-locations/tree');
      setLocations(flattenTree(data.tree));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lagerorte konnten nicht geladen werden');
    }
  }, []);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  useEffect(() => {
    if (!editId) return;
    api<{ case: CaseRow }>(`/api/cases/${Number(editId)}`)
      .then((data) => {
        const cas = data.case;
        setName(cas.name);
        setCode(cas.code ?? '');
        setDescription(cas.description ?? '');
        setLocationId(cas.storage_location_id ? String(cas.storage_location_id) : '');
        setStatus(cas.status);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen'))
      .finally(() => setLoading(false));
  }, [editId]);

  async function handleSubmit() {
    setError('');
    if (!name.trim()) {
      setError('Bitte einen Namen angeben');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        code: code.trim() || null,
        description: description.trim() || null,
        storage_location_id: locationId ? Number(locationId) : null,
        status,
      };
      if (isEdit) {
        await api<{ case: CaseRow }>(`/api/cases/${Number(editId)}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        navigate(`/cases/detail?id=${editId}`, { replace: true });
      } else {
        const data = await api<{ id: number }>('/api/cases', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        navigate(`/cases/detail?id=${data.id}`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader
        title={isEdit ? 'Case bearbeiten' : 'Neuer Koffer'}
        subtitle={isEdit ? `Bearbeiten von #${editId}` : 'Assets bündeln und im Lager verstauen'}
        backTo="/cases"
        actions={
          <button className="btn" disabled={busy} onClick={() => void handleSubmit()}>
            {busy ? 'Speichert …' : isEdit ? 'Speichern' : 'Koffer anlegen'}
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card form-card" style={{ maxWidth: 720 }}>
        <Field label="Name">
          <input
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Audio-Set Kompakt"
          />
        </Field>
        <div className="form-grid-2">
          <Field label="Code" hint="Optional, z. B. CASE-001">
            <input className="form-input" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Status">
            <select
              className="form-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as CaseStatus)}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {deviceStatusLabels[s]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Lagerort" hint="Wo der Koffer gelagert wird">
          <select
            className="form-select"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">– Kein Lagerort –</option>
            {locations.map((l) => (
              <option key={l.id} value={String(l.id)}>
                {l.path}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Beschreibung">
          <textarea
            className="form-textarea"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </div>
    </>
  );
}