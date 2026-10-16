import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader, Alert, Loading, Badge } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatDateTime } from '../utils/format';
import type { Appointment, EventRow } from '../types';

const weekdays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function CalendarPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59);
    try {
      const [appt, ev] = await Promise.all([
        api<{ appointments: Appointment[] }>(
          `/api/appointments?from=${dayKey(first)}&to=${dayKey(last)} 23:59:59`
        ),
        api<{ events: EventRow[] }>('/api/events'),
      ]);
      setAppointments(appt.appointments);
      setEvents(ev.events);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, [cursor]);

  useEffect(() => {
    void load();
  }, [load]);

  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = (first.getDay() + 6) % 7;
    const cells: Array<{ date: Date; inMonth: boolean }> = [];
    const start = new Date(first);
    start.setDate(first.getDate() - startOffset);
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push({ date: d, inMonth: d.getMonth() === cursor.getMonth() });
    }
    return cells;
  }, [cursor]);

  const apptByDay = useMemo(() => {
    const map: Record<string, Appointment[]> = {};
    for (const a of appointments) {
      const key = dayKey(new Date(a.starts_at));
      (map[key] ??= []).push(a);
    }
    return map;
  }, [appointments]);

  const eventsByDay = useMemo(() => {
    const map: Record<string, EventRow[]> = {};
    for (const e of events) {
      if (!e.starts_at) continue;
      const key = dayKey(new Date(e.starts_at));
      (map[key] ??= []).push(e);
    }
    return map;
  }, [events]);

  async function remove(appt: Appointment) {
    if (!window.confirm(`Termin „${appt.title}“ löschen?`)) return;
    try {
      await api(`/api/appointments/${appt.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen');
    }
  }

  const monthLabel = cursor.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

  function shift(delta: number) {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
  }

  return (
    <>
      <PageHeader
        title="Kalender"
        subtitle="Termine, Events und Veranstaltungen"
        actions={
          <button
            className="btn btn-primary"
            onClick={() => navigate(`/kalender/new?date=${dayKey(today)}`)}
          >
            <Icon name="calendar-plus" size={16} />
            Neuer Termin
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card calendar-bar">
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="Vorheriger Monat">
          <Icon name="chevron-left" size={18} />
        </button>
        <strong className="calendar-month">{monthLabel}</strong>
        <button className="icon-btn" onClick={() => shift(1)} aria-label="Nächster Monat">
          <Icon name="chevron-right" size={18} />
        </button>
        <button className="btn" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>
          Heute
        </button>
      </div>

      {loading ? (
        <Loading />
      ) : (
        <div className="card calendar">
          <div className="calendar-weekdays">
            {weekdays.map((w) => (
              <div key={w} className="calendar-weekday">
                {w}
              </div>
            ))}
          </div>
          <div className="calendar-grid">
            {grid.map((cell) => {
              const key = dayKey(cell.date);
              const dayAppts = apptByDay[key] ?? [];
              const dayEvents = eventsByDay[key] ?? [];
              const isToday = key === dayKey(today);
              return (
                <div
                  key={key}
                  className={`calendar-cell${cell.inMonth ? '' : ' out'}${isToday ? ' today' : ''}`}
                  onClick={() => navigate(`/kalender/new?date=${key}`)}
                >
                  <div className="calendar-date">{cell.date.getDate()}</div>
                  <div className="calendar-items">
                    {dayEvents.slice(0, 2).map((e) => (
                      <span key={`e${e.id}`} className="calendar-chip event" title={e.name}>
                        {e.name}
                      </span>
                    ))}
                    {dayAppts.slice(0, 3).map((a) => (
                      <span key={`a${a.id}`} className="calendar-chip appt" title={a.title}>
                        {!a.all_day && `${new Date(a.starts_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} `}
                        {a.title}
                      </span>
                    ))}
                    {dayEvents.length + dayAppts.length > 5 && (
                      <span className="calendar-more">+{dayEvents.length + dayAppts.length - 5}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="section-title">Kommende Termine</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Termin</th>
                <th>Beginn</th>
                <th>Ort</th>
                <th>Erstellt von</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {appointments
                .filter((a) => new Date(a.starts_at).getTime() >= Date.now())
                .slice(0, 10)
                .map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.title}</strong>
                      {a.all_day && <Badge tone="muted">ganztägig</Badge>}
                    </td>
                    <td>{formatDateTime(a.starts_at)}</td>
                    <td>{a.location ?? '–'}</td>
                    <td>{a.created_by_name ?? '–'}</td>
                    <td>
                      {(a.created_by === user?.id || user?.isAdmin) && (
                        <div className="row-actions">
                          <button
                            className="icon-btn"
                            title="Bearbeiten"
                            onClick={() => navigate(`/kalender/edit?id=${a.id}`)}
                          >
                            <Icon name="edit" size={16} />
                          </button>
                          <button className="icon-btn danger" title="Löschen" onClick={() => void remove(a)}>
                            <Icon name="trash" size={16} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              {appointments.filter((a) => new Date(a.starts_at).getTime() >= Date.now()).length === 0 && (
                <tr>
                  <td colSpan={5} className="table-empty">
                    Keine kommenden Termine
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
