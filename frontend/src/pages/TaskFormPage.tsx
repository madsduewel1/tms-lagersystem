import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { PageHeader, Field, Alert, Loading } from '../components/ui';
import type { Task, TaskPriority, TaskStatus, UserOption } from '../types';

const statusLabels: Record<TaskStatus, string> = {
  offen: 'Offen',
  in_arbeit: 'In Arbeit',
  erledigt: 'Erledigt',
  abgebrochen: 'Abgebrochen',
};
const priorityLabels: Record<TaskPriority, string> = {
  niedrig: 'Niedrig',
  normal: 'Normal',
  hoch: 'Hoch',
};

interface FormData {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string;
  due_at: string;
}

const empty: FormData = {
  title: '',
  description: '',
  status: 'offen',
  priority: 'normal',
  assignee_id: '',
  due_at: '',
};

function toInputValue(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TaskFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editId = params.get('id');
  const isEdit = Boolean(editId);

  const [form, setForm] = useState<FormData>(empty);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    if (editId) {
      api<{ task: Task }>(`/api/tasks/${Number(editId)}`)
        .then(({ task }) =>
          setForm({
            title: task.title,
            description: task.description ?? '',
            status: task.status,
            priority: task.priority,
            assignee_id: task.assignee_id ? String(task.assignee_id) : '',
            due_at: toInputValue(task.due_at),
          })
        )
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen'))
        .finally(() => setLoading(false));
    }
    api<{ users: UserOption[] }>('/api/users/options')
      .then((d) => setUsers(d.users))
      .catch(() => setUsers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      priority: form.priority,
      assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
      due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
    };
    try {
      if (isEdit) {
        await api(`/api/tasks/${Number(editId)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
      }
      navigate('/aufgaben', { replace: true });
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
        title={isEdit ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
        subtitle={isEdit ? `Bearbeiten von #${editId}` : 'To-do anlegen und einer Person zuweisen'}
        backTo="/aufgaben"
        actions={
          <button className="btn btn-primary" disabled={busy} onClick={() => void handleSubmit()}>
            {busy ? 'Speichert …' : isEdit ? 'Speichern' : 'Aufgabe anlegen'}
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
        <Field label="Beschreibung">
          <textarea
            className="form-textarea"
            rows={4}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
        <div className="form-grid-2">
          <Field label="Zugewiesen an">
            <select
              className="form-select"
              value={form.assignee_id}
              onChange={(e) => set('assignee_id', e.target.value)}
            >
              <option value="">Niemand</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.username}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fällig am">
            <input
              type="datetime-local"
              className="form-input"
              value={form.due_at}
              onChange={(e) => set('due_at', e.target.value)}
            />
          </Field>
        </div>
        <div className="form-grid-2">
          <Field label="Priorität">
            <select
              className="form-select"
              value={form.priority}
              onChange={(e) => set('priority', e.target.value as TaskPriority)}
            >
              {(Object.keys(priorityLabels) as TaskPriority[]).map((p) => (
                <option key={p} value={p}>
                  {priorityLabels[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              className="form-select"
              value={form.status}
              onChange={(e) => set('status', e.target.value as TaskStatus)}
            >
              {(Object.keys(statusLabels) as TaskStatus[]).map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
    </>
  );
}
