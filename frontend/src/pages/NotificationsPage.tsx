import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { PageHeader, Alert, EmptyState, Loading } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatDateTime } from '../utils/format';
import type { AppNotification } from '../types';

export default function NotificationsPage() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ notifications: AppNotification[] }>('/api/notifications?limit=200');
      setItems(data.notifications);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markAll() {
    await api('/api/notifications/read-all', { method: 'POST' });
    await load();
  }

  async function remove(n: AppNotification) {
    try {
      await api(`/api/notifications/${n.id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((x) => x.id !== n.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen');
    }
  }

  async function markRead(n: AppNotification) {
    if (n.read_at) return;
    await api(`/api/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => {});
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
  }

  return (
    <>
      <PageHeader
        title="Benachrichtigungen"
        subtitle="Alle Mitteilungen an dich"
        actions={
          <button className="btn" onClick={() => void markAll()}>
            <Icon name="check" size={16} />
            Alle als gelesen
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState icon="bell" title="Keine Benachrichtigungen" hint="Hier erscheinen neue Aufgaben, Nachrichten und Beiträge." />
      ) : (
        <div className="card">
          <ul className="notif-list">
            {items.map((n) => (
              <li key={n.id} className={`notif-item${n.read_at ? '' : ' unread'}`}>
                <div className="notif-dot" aria-hidden="true" />
                <div className="notif-main">
                  {n.link ? (
                    <Link to={n.link} className="notif-title" onClick={() => void markRead(n)}>
                      {n.title}
                    </Link>
                  ) : (
                    <span className="notif-title">{n.title}</span>
                  )}
                  {n.body && <div className="notif-body">{n.body}</div>}
                  <div className="notif-time">{formatDateTime(n.created_at)}</div>
                </div>
                <button className="icon-btn danger" title="Löschen" onClick={() => void remove(n)}>
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
