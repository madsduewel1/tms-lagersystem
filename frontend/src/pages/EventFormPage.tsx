import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader, Field, Alert, Loading } from '../components/ui';
import type { EventEditor, EventRow, EventStatus, UserOption } from '../types';
import { eventStatusLabels } from '../utils/format';

const statuses: EventStatus[] = [
  'entwurf',
  'geplant',
  'vorbereitung',
  'aktiv',
  'abgeschlossen',
  'abgesagt',
];

interface EventFormData {
  name: string;
  location: string;
  contact_name: string;
  starts_at: string;
  ends_at: string;
  status: EventStatus;
  description: string;
  notes: string;
}

const empty: EventFormData = {
  name: '',
  location: '',
  contact_name: '',
  starts_at: '',
  ends_at: '',
  status: 'entwurf',
  description: '',
  notes: '',
};

function toForm(ev: EventRow): EventFormData {
  return {
    name: ev.name,
    location: ev.location ?? '',
    contact_name: ev.contact_name ?? '',
    starts_at: ev.starts_at ? ev.starts_at.slice(0, 16) : '',
    ends_at: ev.ends_at ? ev.ends_at.slice(0, 16) : '',
    status: ev.status,
    description: ev.description ?? '',
    notes: ev.notes ?? '',
  };
}

export default function EventFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const editId = params.get('id');

  const [form, setForm] = useState<EventFormData>(empty);
  const [editorIds, setEditorIds] = useState<number[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(editId));

  const isEdit = Boolean(editId);
  const [canManageEditors, setCanManageEditors] = useState(!isEdit);

  useEffect(() => {
    if (editId) {
      api<{ event: EventRow; editors: EventEditor[] }>(`/api/events/${Number(editId)}`)
        .then((data) => {
          setForm(toForm(data.event));
          setEditorIds(data.editors.map((e) => e.id));
          setCanManageEditors(
            user?.role === 'administrator' || Number(data.event.created_by) === user?.id
          );
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen'))
        .finally(() => setLoading(false));
    }
    api<{ users: UserOption[] }>('/api/users/options')
      .then((data) => setUsers(data.users))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  function toggleEditor(id: number) {
    setEditorIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function set<K extends keyof EventFormData>(key: K, value: EventFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    setError('');
    if (!form.name.trim()) {
      setError('Bitte einen Namen angeben');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        location: form.location.trim() || null,
        contact_name: form.contact_name.trim() || null,
        starts_at: form.starts_at || null,
        ends_at: form.ends_at || null,
        status: form.status,
        description: form.description.trim() || null,
        notes: form.notes.trim() || null,
        ...(canManageEditors ? { editorIds } : {}),
      };
      if (isEdit) {
        await api<{ event: EventRow }>(`/api/events/${Number(editId)}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        navigate(`/events/detail?id=${editId}`, { replace: true });
      } else {
        const data = await api<{ id: number }>('/api/events', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        navigate(`/events/detail?id=${data.id}`, { replace: true });
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
        title={isEdit ? 'Event bearbeiten' : 'Neues Event'}
        subtitle={isEdit ? `Bearbeiten von #${editId}` : 'Veranstaltung planen und ausrüsten'}
        backTo="/events"
        actions={
          <button
            className="btn"
            disabled={busy}
            onClick={() => void handleSubmit()}
          >
            {busy ? 'Speichert …' : isEdit ? 'Speichern' : 'Event anlegen'}
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card form-card" style={{ maxWidth: 980 }}>
        <Field label="Name">
          <input
            className="form-input"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            autoFocus
          />
        </Field>
        <div className="form-grid-2">
          <Field label="Beginn">
            <input
              className="form-input"
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => set('starts_at', e.target.value)}
            />
          </Field>
          <Field label="Ende">
            <input
              className="form-input"
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => set('ends_at', e.target.value)}
            />
          </Field>
        </div>
        <div className="form-grid-2">
          <Field label="Ort">
            <input
              className="form-input"
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
              placeholder="z. B. Aula"
            />
          </Field>
          <Field label="Kontakt">
            <input
              className="form-input"
              value={form.contact_name}
              onChange={(e) => set('contact_name', e.target.value)}
            />
          </Field>
        </div>
        <Field label="Status">
          <select
            className="form-select"
            value={form.status}
            onChange={(e) => set('status', e.target.value as EventStatus)}
          >
            {statuses.map((s) => (
              <option key={s} value={s}>
                {eventStatusLabels[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Beschreibung">
          <textarea
            className="form-textarea"
            rows={2}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
        <Field label="Notizen">
          <textarea
            className="form-textarea"
            rows={2}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </Field>
        {canManageEditors && (
          <Field label="Bearbeitung erlauben für" hint="Nur die Ersteller und Admins können dieses Event außerdem bearbeiten. Freigeschaltete Nutzer können das Event mitplanen, aber nicht die Rechte ändern.">
            <div className="check-grid">
              {users.length === 0 && <span className="form-hint">Keine aktiven Benutzer gefunden.</span>}
              {users.map((u) => (
                <label key={u.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={editorIds.includes(u.id)}
                    onChange={() => toggleEditor(u.id)}
                  />
                  <span>{u.name || u.username}</span>
                  <span className="check-row-sub">{u.username}</span>
                </label>
              ))}
            </div>
          </Field>
        )}
      </div>
    </>
  );
}