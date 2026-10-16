import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader, Alert, EmptyState, Loading, Badge } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatDateTime } from '../utils/format';
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
const priorityTone: Record<TaskPriority, 'muted' | 'accent' | 'danger'> = {
  niedrig: 'muted',
  normal: 'accent',
  hoch: 'danger',
};
const statusTone: Record<TaskStatus, 'warning' | 'accent' | 'success' | 'muted'> = {
  offen: 'warning',
  in_arbeit: 'accent',
  erledigt: 'success',
  abgebrochen: 'muted',
};

export default function TasksPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (assigneeFilter) params.set('assignee', assigneeFilter);
    if (q) params.set('q', q);
    try {
      const data = await api<{ tasks: Task[] }>(`/api/tasks?${params.toString()}`);
      setTasks(data.tasks);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, assigneeFilter, q]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api<{ users: UserOption[] }>('/api/users/options')
      .then((d) => setUsers(d.users))
      .catch(() => setUsers([]));
  }, []);

  const counts = useMemo(() => {
    const open = tasks.filter((t) => t.status === 'offen' || t.status === 'in_arbeit');
    const overdue = open.filter((t) => t.due_at && new Date(t.due_at).getTime() < Date.now());
    return { open: open.length, overdue: overdue.length };
  }, [tasks]);

  async function toggleDone(task: Task) {
    const next: TaskStatus = task.status === 'erledigt' ? 'offen' : 'erledigt';
    try {
      await api(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: next } : t)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktualisieren fehlgeschlagen');
    }
  }

  async function remove(task: Task) {
    if (!window.confirm(`Aufgabe „${task.title}“ wirklich löschen?`)) return;
    try {
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen');
    }
  }

  return (
    <>
      <PageHeader
        title="Aufgaben"
        subtitle={`${counts.open} offen${counts.overdue ? ` · ${counts.overdue} überfällig` : ''}`}
        actions={
          <button className="btn btn-primary" onClick={() => navigate('/aufgaben/new')}>
            <Icon name="plus" size={16} />
            Neue Aufgabe
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card filter-bar">
        <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Alle Status</option>
          {(Object.keys(statusLabels) as TaskStatus[]).map((s) => (
            <option key={s} value={s}>
              {statusLabels[s]}
            </option>
          ))}
        </select>
        <select className="form-select" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
          <option value="">Alle Personen</option>
          <option value="me">Mir zugewiesen</option>
          <option value="unassigned">Nicht zugewiesen</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <input
          className="form-input"
          placeholder="Suchen …"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading ? (
        <Loading />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon="check-square"
          title="Keine Aufgaben"
          hint="Lege eine Aufgabe an und weise sie einer Person zu."
          action={
            <button className="btn btn-primary" onClick={() => navigate('/aufgaben/new')}>
              <Icon name="plus" size={16} />
              Neue Aufgabe
            </button>
          }
        />
      ) : (
        <div className="task-list">
          {tasks.map((task) => {
            const overdue =
              task.status !== 'erledigt' &&
              task.status !== 'abgebrochen' &&
              task.due_at !== null &&
              new Date(task.due_at).getTime() < Date.now();
            return (
              <div key={task.id} className={`card task-card${task.status === 'erledigt' ? ' done' : ''}`}>
                <button
                  className={`task-check${task.status === 'erledigt' ? ' checked' : ''}`}
                  onClick={() => void toggleDone(task)}
                  aria-label={task.status === 'erledigt' ? 'Als offen markieren' : 'Als erledigt markieren'}
                >
                  {task.status === 'erledigt' && <Icon name="check" size={14} />}
                </button>
                <div className="task-main">
                  <div className="task-title-row">
                    <strong>{task.title}</strong>
                    <Badge tone={priorityTone[task.priority]}>{priorityLabels[task.priority]}</Badge>
                    {task.status !== 'offen' && (
                      <Badge tone={statusTone[task.status]}>{statusLabels[task.status]}</Badge>
                    )}
                  </div>
                  {task.description && <p className="task-desc">{task.description}</p>}
                  <div className="task-meta">
                    <span className={overdue ? 'task-overdue' : ''}>
                      <Icon name="clock" size={14} />
                      {task.due_at ? formatDateTime(task.due_at) : 'keine Frist'}
                    </span>
                    <span>
                      <Icon name="user" size={14} />
                      {task.assignee_name ?? 'nicht zugewiesen'}
                    </span>
                    {task.event_name && (
                      <span>
                        <Icon name="calendar" size={14} />
                        {task.event_name}
                      </span>
                    )}
                    {task.item_name && (
                      <span>
                        <Icon name="boxes" size={14} />
                        {task.item_name}
                      </span>
                    )}
                  </div>
                </div>
                <div className="task-actions">
                  <button
                    className="icon-btn"
                    title="Bearbeiten"
                    onClick={() => navigate(`/aufgaben/edit?id=${task.id}`)}
                  >
                    <Icon name="edit" size={16} />
                  </button>
                  {(task.created_by === user?.id || user?.isAdmin) && (
                    <button className="icon-btn danger" title="Löschen" onClick={() => void remove(task)}>
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
