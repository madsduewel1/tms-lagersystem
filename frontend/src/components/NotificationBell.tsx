import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Icon } from './Icon';
import { relativeDate } from '../utils/format';
import type { AppNotification } from '../types';

export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const fetchCount = () => {
      api<{ count: number }>('/api/notifications/unread-count')
        .then((d) => {
          if (active) setCount(d.count);
        })
        .catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 20_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      try {
        const data = await api<{ notifications: AppNotification[] }>('/api/notifications?limit=12');
        setItems(data.notifications);
      } finally {
        setLoading(false);
      }
    }
  }

  async function markAll() {
    await api('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
    setCount(0);
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
  }

  async function openItem(n: AppNotification) {
    if (!n.read_at) {
      await api(`/api/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => {});
      setCount((c) => Math.max(0, c - 1));
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button
        className={`icon-btn bell-btn${open ? ' active' : ''}`}
        onClick={() => void toggle()}
        aria-label={`Benachrichtigungen${count > 0 ? ` (${count} ungelesen)` : ''}`}
      >
        <Icon name="bell" size={19} />
        {count > 0 && <span className="bell-badge">{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="bell-menu card">
          <div className="bell-head">
            <strong>Benachrichtigungen</strong>
            {count > 0 && (
              <button className="link-btn" onClick={() => void markAll()}>
                Alle gelesen
              </button>
            )}
          </div>
          <div className="bell-list">
            {loading ? (
              <div className="bell-empty">Lädt …</div>
            ) : items.length === 0 ? (
              <div className="bell-empty">Keine Benachrichtigungen</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  className={`bell-item${n.read_at ? '' : ' unread'}`}
                  onClick={() => void openItem(n)}
                >
                  <span className="bell-item-title">{n.title}</span>
                  {n.body && <span className="bell-item-body">{n.body}</span>}
                  <span className="bell-item-time">{relativeDate(n.created_at)}</span>
                </button>
              ))
            )}
          </div>
          <Link to="/benachrichtigungen" className="bell-footer" onClick={() => setOpen(false)}>
            Alle anzeigen
          </Link>
        </div>
      )}
    </div>
  );
}
