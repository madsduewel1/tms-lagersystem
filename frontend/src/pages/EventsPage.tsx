import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { PageHeader, Alert, EmptyState, Loading, StatusBadge } from '../components/ui';
import { Icon } from '../components/Icon';
import type { EventRow, EventStatus } from '../types';
import { eventStatusLabels, formatDateTime } from '../utils/format';

const statuses: EventStatus[] = [
  'entwurf',
  'geplant',
  'vorbereitung',
  'aktiv',
  'abgeschlossen',
  'abgesagt',
];

export default function EventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ events: EventRow[] }>(
        `/api/events${statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''}`
      );
      setEvents(data.events);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeEvent(ev: EventRow) {
    setError('');
    if (!window.confirm(`Event „${ev.name}“ wirklich löschen?`)) return;
    try {
      await api(`/api/events/${ev.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen');
    }
  }

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="Veranstaltungen planen und ausrüsten"
        actions={
          <button className="btn btn-primary" onClick={() => navigate('/events/new')}>
            <Icon name="calendar-plus" size={16} />
            Neues Event
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card filter-bar">
        <select
          className="form-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Alle Status</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {eventStatusLabels[s]}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <Loading />
      ) : events.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="Keine Events"
          hint="Lege dein erstes Event an und plane anschließend Geräte und Artikel."
          action={
            <button className="btn btn-primary" onClick={() => navigate('/events/new')}>
              <Icon name="calendar-plus" size={16} />
              Neues Event
            </button>
          }
        />
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Zeitraum</th>
                  <th>Ort</th>
                  <th>Status</th>
                  <th>Geplant</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <td>
                      <Link to={`/events/detail?id=${ev.id}`} className="table-link">
                        <Icon name="calendar" size={16} />
                        <strong>{ev.name}</strong>
                      </Link>
                      {ev.contact_name && (
                        <div className="cell-sub">Kontakt: {ev.contact_name}</div>
                      )}
                    </td>
                    <td>
                      {ev.starts_at ? formatDateTime(ev.starts_at) : '–'}
                      {ev.ends_at ? `\nbis ${formatDateTime(ev.ends_at)}` : ''}
                    </td>
                    <td>{ev.location ?? '–'}</td>
                    <td>
                      <StatusBadge status={ev.status} label={eventStatusLabels[ev.status]} />
                    </td>
                    <td>
                      {ev.device_plan_count} Geräte · {ev.item_plan_count} Artikel
                      {ev.case_plan_count > 0 ? ` · ${ev.case_plan_count} Koffer` : ''}
                      {!ev.can_edit && <span className="badge-soft">nur lesbar</span>}
                    </td>
                    <td>
                      {ev.can_edit && (
                        <button className="icon-btn danger" title="Löschen" onClick={() => void removeEvent(ev)}>
                          <Icon name="trash" size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}