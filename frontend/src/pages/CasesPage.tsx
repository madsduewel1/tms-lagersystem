import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, fileUrl } from '../api/client';
import { PageHeader, Alert, EmptyState, Loading, StatusBadge } from '../components/ui';
import { Icon } from '../components/Icon';
import type { CaseRow, CaseStatus } from '../types';

const statuses: CaseStatus[] = ['verfuegbar', 'ausgelagert', 'defekt', 'ausser_betrieb'];

const caseStatusLabels: Record<CaseStatus, string> = {
  verfuegbar: 'Verfügbar',
  ausgelagert: 'Ausgelagert',
  defekt: 'Defekt',
  ausser_betrieb: 'Außer Betrieb',
};

export default function CasesPage() {
  const navigate = useNavigate();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ cases: CaseRow[] }>('/api/cases');
      setCases(
        statusFilter
          ? data.cases.filter((c) => c.status === statusFilter)
          : data.cases
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeCase(cas: CaseRow) {
    setError('');
    if (!window.confirm(`Case „${cas.name}“ wirklich löschen?`)) return;
    try {
      await api(`/api/cases/${cas.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen');
    }
  }

  return (
    <>
      <PageHeader
        title="Cases"
        subtitle="Koffer mit Assets bündeln, im Lager lagern und für Events planen"
        actions={
          <button className="btn btn-primary" onClick={() => navigate('/cases/new')}>
            <Icon name="plus" size={16} />
            Neuer Koffer
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
              {caseStatusLabels[s]}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <Loading />
      ) : cases.length === 0 ? (
        <EmptyState
          icon="case"
          title="Keine Cases"
          hint="Lege einen Koffer an und packe anschließend Assets hinein."
          action={
            <button className="btn btn-primary" onClick={() => navigate('/cases/new')}>
              <Icon name="plus" size={16} />
              Neuer Koffer
            </button>
          }
        />
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Koffer</th>
                  <th>Code</th>
                  <th>Lagerort</th>
                  <th>Assets</th>
                  <th>Status</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((cas) => (
                  <tr key={cas.id}>
                    <td>
                      <Link to={`/cases/detail?id=${cas.id}`} className="table-link">
                        <Icon name="case" size={16} />
                        <strong>{cas.name}</strong>
                      </Link>
                      {cas.description && (
                        <div className="cell-sub">{cas.description}</div>
                      )}
                    </td>
                    <td className="mono">{cas.code ?? '–'}</td>
                    <td>{cas.location_path ?? '–'}</td>
                    <td>{cas.item_count} Asset{cas.item_count === 1 ? '' : 's'}</td>
                    <td>
                      <StatusBadge status={cas.status} label={caseStatusLabels[cas.status]} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <a
                          className="icon-btn"
                          title="Label anzeigen"
                          href={cas.qr_token ? fileUrl(`/api/labels/qr/${cas.qr_token}`) : undefined}
                          target="_blank"
                          rel="noreferrer"
                          aria-disabled={!cas.qr_token}
                        >
                          <Icon name="qr" size={16} />
                        </a>
                        <Link className="icon-btn" title="Bearbeiten" to={`/cases/new?id=${cas.id}`}>
                          <Icon name="edit" size={16} />
                        </Link>
                        <button
                          className="icon-btn danger"
                          title="Löschen"
                          onClick={() => void removeCase(cas)}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
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