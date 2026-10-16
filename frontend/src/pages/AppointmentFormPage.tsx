import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { PageHeader, Field, Alert, Loading } from '../components/ui';
import type { Appointment } from '../types';

function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeKey(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface FormData {
  title: string;
  description: string;
  location: string;
  date: string;
  time: string;
  endTime: string;
  all_day: boolean;
}

export default function AppointmentFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editId = params.get('id');
  const isEdit = Boolean(editId);

  const [form, setForm] = useState<FormData>({
    title: '',
    description: '',
    location: '',
    date: params.get('date') || dayKey(new Date()),
    time: '09:00',
    endTime: '',
    all_day: false,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    if (editId) {
      api<{ appointment: Appointment }>(`/api/appointments/${Number(editId)}`)
        .then(({ appointment }) =>
          setForm({
            title: appointment.title,
            description: appointment.description ?? '',
            location: appointment.location ?? '',
            date: appointment.starts_at ? dayKey(new Date(appointment.starts_at)) : dayKey(new Date()),
            time: timeKey(appointment.starts_at) || '09:00',
            endTime: timeKey(appointment.ends_at),
            all_day: Boolean(appointment.all_day),
          })
        )
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen'))
        .finally(() => setLoading(false));
    }
  }, [editId]);

  function set<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    setError('');
    if (!form.title.trim()) {
      setError('Bitte einen Titel angeben');
      return;
    }
    setBusy(true);
    const starts = new Date(`${form.date}T${form.all_day ? '00:00' : form.time}`);
    const ends = form.endTime ? new Date(`${form.date}T${form.endTime}`) : null;
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      location: form.location.trim() || null,
      starts_at: starts.toISOString(),
      ends_at: ends ? ends.toISOString() : null,
      all_day: form.all_day,
    };
    try {
      if (isEdit) {
        await api(`/api/appointments/${Number(editId)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api('/api/appointments', { method: 'POST', body: JSON.stringify(payload) });
      }
      navigate('/kalender', { replace: true });
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
        title={isEdit ? 'Termin bearbeiten' : 'Neuer Termin'}
        subtitle={isEdit ? `Bearbeiten von #${editId}` : 'Termin im Kalender anlegen'}
        backTo="/kalender"
        actions={
          <button className="btn btn-primary" disabled={busy} onClick={() => void handleSubmit()}>
            {busy ? 'Speichert …' : isEdit ? 'Speichern' : 'Termin anlegen'}
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card form-card">
        <Field label="Titel">
          <input
            className="form-input"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            autoFocus
          />
        </Field>
        <div className="form-grid-2">
          <Field label="Datum">
            <input
              type="date"
              className="form-input"
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
            />
          </Field>
          <Field label="Ort">
            <input
              className="form-input"
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
            />
          </Field>
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.all_day}
            onChange={(e) => set('all_day', e.target.checked)}
          />
          <span>Ganztägig</span>
        </label>
        {!form.all_day && (
          <div className="form-grid-2">
            <Field label="Beginn">
              <input
                type="time"
                className="form-input"
                value={form.time}
                onChange={(e) => set('time', e.target.value)}
              />
            </Field>
            <Field label="Ende (optional)">
              <input
                type="time"
                className="form-input"
                value={form.endTime}
                onChange={(e) => set('endTime', e.target.value)}
              />
            </Field>
          </div>
        )}
        <Field label="Beschreibung">
          <textarea
            className="form-textarea"
            rows={4}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
      </div>
    </>
  );
}
