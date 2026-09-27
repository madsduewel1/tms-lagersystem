import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { PageHeader, Field, Alert, Loading } from '../components/ui';
import type { StorageLocation } from '../types';

type LocType = 'lager' | 'regal' | 'fach';
const typeLabels: Record<LocType, string> = { lager: 'Lager', regal: 'Regal', fach: 'Fach' };

export default function LocationFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editId = params.get('id');

  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState<LocType>(
    (params.get('type') as LocType) || (params.get('parent') ? 'fach' : 'lager')
  );
  const [parentId, setParentId] = useState(params.get('parent') ?? '');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(editId));

  const isEdit = Boolean(editId);

  const load = useCallback(async () => {
    try {
      const data = await api<{ locations: StorageLocation[] }>('/api/storage-locations');
      setLocations(data.locations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!editId) return;
    api<{ location: StorageLocation }>(`/api/storage-locations/${Number(editId)}`)
      .then((data) => {
        const loc = data.location;
        setName(loc.name);
        setCode(loc.code ?? '');
        setType((loc.type as LocType) ?? 'regal');
        setParentId(loc.parent_id ? String(loc.parent_id) : '');
        setDescription(loc.description ?? '');
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
        parent_id: parentId ? Number(parentId) : null,
        type,
        name: name.trim(),
        code: code.trim() || null,
        description: description.trim() || null,
      };
      if (isEdit) {
        await api<{ ok: true }>(`/api/storage-locations/${Number(editId)}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        const data = await api<{ id: number }>('/api/storage-locations', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        navigate(`/lagerorte/detail?id=${data.id}`, { replace: true });
        return;
      }
      navigate(`/lagerorte/detail?id=${editId}`, { replace: true });
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
        title={isEdit ? 'Lagerort bearbeiten' : 'Neuer Lagerort'}
        subtitle={isEdit ? `Bearbeiten von #${editId}` : `${typeLabels[type]} anlegen`}
        backTo="/lagerorte"
        actions={
          <button
            className="btn"
            disabled={busy}
            onClick={() => void handleSubmit()}
          >
            {busy ? 'Speichert …' : isEdit ? 'Speichern' : 'Anlegen'}
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card form-card" style={{ maxWidth: 900 }}>
        <Field label="Name">
          <input
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="form-grid-2">
          <Field label="Typ">
            <select
              className="form-select"
              value={type}
              onChange={(e) => setType(e.target.value as LocType)}
            >
              <option value="lager">Lager</option>
              <option value="regal">Regal</option>
              <option value="fach">Fach</option>
            </select>
          </Field>
          <Field label="Code">
            <input
              className="form-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="z. B. HL-2-B"
            />
          </Field>
        </div>
        <Field label="Übergeordneter Lagerort">
          <select
            className="form-select"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">– kein, als Hauptlager –</option>
            {locations
              .filter((l) => l.id !== (editId ? Number(editId) : null))
              .map((l) => (
                <option key={l.id} value={String(l.id)}>
                  {l.name}
                  {l.code ? ` (${l.code})` : ''}
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