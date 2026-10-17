import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api, ApiError } from '../api/client';
import { Icon } from '../components/Icon';
import { PageHeader, Alert, Modal } from '../components/ui';
import { MultiSelect } from '../components/MultiSelect';
import { RolesPermissions } from '../components/RolesPermissions';
import type { Role, RoleRef, UserRow } from '../types';

interface ResetResult {
  id: number;
  username: string;
  name: string;
  tempPassword: string;
}

interface UserReference {
  key: string;
  count: number;
  effect: 'entfernt' | 'ohne_zuordnung';
}

interface DeletionImpact {
  user: { id: number; username: string; name: string; roles: RoleRef[]; active: boolean };
  blocked: string;
  references: UserReference[];
}

const referenceLabels: Record<string, string> = {
  audit_logs: 'Audit-Log-Einträge',
  events: 'Angelegte Events',
  event_editors: 'Event-Bearbeiterrechte',
  stock_movements: 'Bestandsbewegungen',
  checkouts: 'Ausgaben',
  returns: 'Rückgaben',
  maintenance: 'Wartungsvorgänge',
  maintenance_logs: 'Wartungsverlauf',
  purchases: 'Bestellungen',
  documents: 'Dokumente',
  inventory_sessions: 'Inventuren',
  inventory_counts: 'Inventurzählungen',
};

function UsersPage() {
  const { user: currentUser, can } = useAuth();
  const navigate = useNavigate();
  const canUsers = can('users.manage');
  const canRoles = can('roles.manage');

  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const validTabs = [
    ...(canUsers ? (['benutzer'] as const) : []),
    ...(canRoles ? (['rollen'] as const) : []),
  ];
  const tab: 'benutzer' | 'rollen' =
    tabParam && (validTabs as readonly string[]).includes(tabParam)
      ? (tabParam as 'benutzer' | 'rollen')
      : (validTabs[0] ?? 'benutzer');
  const setTab = (next: 'benutzer' | 'rollen') => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };

  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [assignableIds, setAssignableIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // E-Mail bearbeiten
  const [emailEdit, setEmailEdit] = useState<number | null>(null);
  const [emailDraft, setEmailDraft] = useState('');

  // Passwort zurücksetzen (einzeln / mehrere)
  const [resetResult, setResetResult] = useState<ResetResult[] | null>(null);

  // Löschen mit Rückfrage
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);

  const load = useCallback(async () => {
    if (!canUsers) return;
    try {
      const [userData, roleData, assignableData] = await Promise.all([
        api<{ users: UserRow[] }>('/api/users'),
        api<{ roles: Role[] }>('/api/roles'),
        api<{ roles: RoleRef[] }>('/api/users/assignable-roles'),
      ]);
      setUsers(userData.users);
      setRoles(roleData.roles);
      setAssignableIds(new Set(assignableData.roles.map((r) => r.id)));
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    }
  }, [canUsers]);

  useEffect(() => {
    void load();
  }, [load]);

  function flash(msg: string) {
    setSuccess(msg);
    window.setTimeout(() => setSuccess(''), 6000);
  }

  function clearSelection() {
    setSelected(new Set());
  }

  // Inaktive Administratoren zählen nicht mit: sie können sich nicht anmelden
  // und damit auch keine Rechte vergeben. Spiegelbild der Prüfung im Backend.
  const activeAdmins = users.filter(
    (u) => u.roles.some((r) => r.name === 'administrator') && u.active
  ).length;

  function isLastAdmin(u: UserRow) {
    return u.roles.some((r) => r.name === 'administrator') && u.active && activeAdmins <= 1;
  }

  async function openDelete(u: UserRow) {
    setError('');
    setDeleteTarget(u);
    setImpact(null);
    setImpactBusy(true);
    try {
      setImpact(await api<DeletionImpact>(`/api/users/${u.id}/deletion-impact`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen-Vorschau fehlgeschlagen');
      setDeleteTarget(null);
    } finally {
      setImpactBusy(false);
    }
  }

  function closeDelete() {
    setDeleteTarget(null);
    setImpact(null);
    setImpactBusy(false);
  }

  async function confirmDelete() {
    if (!deleteTarget || !impact || impact.blocked) return;
    setError('');
    setBusy(true);
    try {
      await api(`/api/users/${deleteTarget.id}`, { method: 'DELETE' });
      closeDelete();
      flash('Benutzer gelöscht');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen');
      closeDelete();
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(u: UserRow) {
    setError('');
    try {
      await api(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !u.active }),
      });
      flash(u.active ? 'Benutzer deaktiviert' : 'Benutzer aktiviert');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen');
    }
  }

  async function changeRoles(u: UserRow, roleIds: number[]) {
    const current = [...u.roles.map((r) => r.id)].sort((a, b) => a - b).join(',');
    const next = [...roleIds].sort((a, b) => a - b).join(',');
    if (current === next || roleIds.length === 0) return;
    setError('');
    try {
      await api(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ roleIds }),
      });
      flash('Rollen geändert');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen');
    }
  }

  async function toggleForcePassword(u: UserRow) {
    setError('');
    try {
      await api(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ must_change_password: !u.must_change_password }),
      });
      flash(u.must_change_password ? 'Passwort-Erzwingung entfernt' : 'Passwort-Erzwingung aktiviert');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen');
    }
  }

  async function saveEmail(u: UserRow) {
    setError('');
    setBusy(true);
    try {
      await api(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ email: emailDraft.trim() || null }),
      });
      setEmailEdit(null);
      flash('E-Mail gespeichert');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  async function resetSelected() {
    if (selected.size === 0) return;
    setError('');
    setBusy(true);
    try {
      const ids = Array.from(selected).filter((id) => id !== currentUser?.id);
      if (ids.length === 0) {
        setError('Eigenes Passwort kannst du hier nicht zurücksetzen – bitte über dein Konto.');
        return;
      }
      const data = await api<{ results: ResetResult[] }>('/api/users/reset', {
        method: 'POST',
        body: JSON.stringify({ userIds: ids }),
      });
      setResetResult(data.results);
      flash('Passwörter zurückgesetzt – 6-stellige Codes übergeben');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Zurücksetzen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  async function resetSingle(u: UserRow) {
    setError('');
    setBusy(true);
    try {
      const data = await api<{ tempPassword: string }>(`/api/users/${u.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setResetResult([
        { id: u.id, username: u.username, name: u.name, tempPassword: data.tempPassword },
      ]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Zurücksetzen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  const touchedRefs = impact?.references.filter((r) => r.count > 0) ?? [];
  const removedRefs = touchedRefs.filter((r) => r.effect === 'entfernt');
  const detachedRefs = touchedRefs.filter((r) => r.effect === 'ohne_zuordnung');

  return (
    <>
      <PageHeader
        title="Benutzer & Rollen"
        subtitle={
          tab === 'rollen'
            ? 'Rollen anlegen und Rechte zuweisen'
            : 'Benutzer anlegen, Passwörter zurücksetzen und Rollen zuweisen'
        }
        actions={
          tab === 'benutzer' && canUsers ? (
            <button className="btn btn-primary" onClick={() => navigate('/users/new')}>
              <Icon name="plus" size={16} />
              Benutzer erstellen
            </button>
          ) : undefined
        }
      />

      {validTabs.length > 1 && (
        <div className="tabs">
          {canUsers && (
            <button
              className={`tab${tab === 'benutzer' ? ' active' : ''}`}
              onClick={() => setTab('benutzer')}
            >
              Benutzer
            </button>
          )}
          {canRoles && (
            <button
              className={`tab${tab === 'rollen' ? ' active' : ''}`}
              onClick={() => setTab('rollen')}
            >
              Rollen & Rechte
            </button>
          )}
        </div>
      )}

      {tab === 'rollen' && canRoles && <RolesPermissions />}

      {tab === 'benutzer' && canUsers && (
        <>
      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      <div className="card toolbar" style={{ marginBottom: 16 }}>
        <MultiSelect
          options={users.map((u) => ({ value: u.id, label: u.name, sublabel: u.username }))}
          value={Array.from(selected)}
          onChange={(next) => setSelected(new Set(next))}
          disabledValues={currentUser?.id != null ? [currentUser.id] : []}
          placeholder="Benutzer auswählen"
        />
        <span style={{ color: 'var(--text-secondary)' }}>
          {selected.size > 0 ? `${selected.size} ausgewählt` : 'Für Massen-Aktionen auswählen'}
        </span>
        <button
          className="btn"
          disabled={selected.size === 0 || busy}
          onClick={() => void resetSelected()}
          title="6-stelliger Code als vorläufiges Passwort"
        >
          <Icon name="lock" size={16} />
          Passwort zurücksetzen (Code)
        </button>
        {selected.size > 0 && (
          <button className="btn" onClick={clearSelection} disabled={busy}>
            Auswahl aufheben
          </button>
        )}
      </div>

      <div className="card">
        {users.length === 0 ? (
          <p className="empty-row">Noch keine Benutzer angelegt.</p>
        ) : (
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>E-Mail</th>
                  <th>Rolle</th>
                  <th>Status</th>
                  <th>Passwort</th>
                  <th>Letzter Login</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.name}</strong>
                      <div className="cell-sub">@{u.username}</div>
                      {!u.email && emailEdit === u.id && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                          <input
                            className="form-input"
                            style={{ width: 180 }}
                            value={emailDraft}
                            onChange={(e) => setEmailDraft(e.target.value)}
                            placeholder="email@beispiel.de"
                            autoFocus
                          />
                          <button className="btn btn-sm" disabled={busy} onClick={() => void saveEmail(u)}>
                            OK
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      {u.email ?? (
                        <span className="badge badge-muted">keine</span>
                      )}{' '}
                      <button
                        className="icon-btn"
                        title="E-Mail bearbeiten"
                        onClick={() => {
                          setEmailEdit(emailEdit === u.id ? null : u.id);
                          setEmailDraft(u.email ?? '');
                        }}
                      >
                        <Icon name="mail" size={15} />
                      </button>
                    </td>
                    <td>
                      <MultiSelect
                        options={roles.map((r) => ({ value: r.id, label: r.label }))}
                        value={u.roles.map((r) => r.id)}
                        disabled={busy}
                        disabledValues={roles
                          .filter((r) => !assignableIds.has(r.id))
                          .map((r) => r.id)}
                        onChange={(ids) => void changeRoles(u, ids)}
                        placeholder="Keine Rolle"
                        emptyText="Keine Rollen vorhanden."
                      />
                    </td>
                    <td>
                      <span className={`badge ${u.active ? 'badge-active' : 'badge-inactive'}`}>
                        {u.active ? 'Aktiv' : 'Deaktiviert'}
                      </span>
                    </td>
                    <td>
                      {u.must_change_password ? (
                        <span className="badge badge-warning">vorläufig</span>
                      ) : (
                        <span className="badge badge-success">gesetzt</span>
                      )}
                      {currentUser?.id !== u.id && (
                        <button
                          className="icon-btn"
                          title={u.must_change_password ? 'Erzwingen deaktivieren' : 'Passwort-Erzwingung aktivieren'}
                          onClick={() => void toggleForcePassword(u)}
                        >
                          <Icon name="lock" size={15} />
                        </button>
                      )}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString('de-DE') : '–'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          className="btn"
                          onClick={() => void resetSingle(u)}
                          disabled={u.id === currentUser?.id || busy}
                          title={u.id === currentUser?.id ? 'Eigenes Passwort im Konto ändern' : '6-stelliger Code als vorläufiges Passwort'}
                        >
                          Reset
                        </button>
                        <button
                          className="btn"
                          onClick={() => void toggleActive(u)}
                          disabled={u.id === currentUser?.id}
                          title={u.id === currentUser?.id ? 'Kann sich nicht selbst deaktivieren' : undefined}
                        >
                          {u.active ? 'Deaktivieren' : 'Aktivieren'}
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() => void openDelete(u)}
                          disabled={u.id === currentUser?.id || isLastAdmin(u)}
                          title={
                            u.id === currentUser?.id
                              ? 'Kann das eigene Konto nicht löschen'
                              : isLastAdmin(u)
                                ? 'Letzter aktiver Administrator – nicht löschbar'
                                : 'Endgültig löschen'
                          }
                        >
                          <Icon name="trash" size={15} />
                          Löschen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {resetResult && (
        <Modal title="Passwort zurücksetzen" onClose={() => setResetResult(null)}>
          <Alert tone="info">
            Codes sind vorläufige Passwörter – die Benutzer werden beim Login zum Ändern aufgefordert.
          </Alert>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Benutzer</th>
                  <th>6-stelliger Code</th>
                </tr>
              </thead>
              <tbody>
                {resetResult.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                      <div className="cell-sub">@{r.username}</div>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 18, fontWeight: 700, letterSpacing: 3 }}>
                        {r.tempPassword}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => setResetResult(null)}>
              Erledigt
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Benutzer löschen" onClose={closeDelete}>
          {impactBusy && <p className="form-hint">Auswirkungen werden geprüft …</p>}

          {impact && impact.blocked && (
            <>
              <Alert tone="error">{impact.blocked}</Alert>
              <p className="form-hint" style={{ marginTop: 12 }}>
                Zum Entziehen des Zugangs reicht „Deaktivieren“ – dabei bleiben alle Daten erhalten.
              </p>
              <div className="modal-actions">
                <button className="btn btn-primary" onClick={closeDelete}>
                  Verstanden
                </button>
              </div>
            </>
          )}

          {impact && !impact.blocked && (
            <>
              <Alert tone="error">
                <strong>{impact.user.name}</strong> (@{impact.user.username}) wird endgültig gelöscht.
                Eine Wiederherstellung ist nicht möglich.
              </Alert>

              {touchedRefs.length === 0 ? (
                <p className="form-hint" style={{ marginTop: 12 }}>
                  Dieser Benutzer ist mit keinerlei Datensätzen verknüpft.
                </p>
              ) : (
                <>
                  {removedRefs.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <p className="section-title" style={{ margin: '0 0 6px' }}>Werden mitgelöscht</p>
                      <ul className="plain-list" style={{ margin: 0, paddingLeft: 20 }}>
                        {removedRefs.map((r) => (
                          <li key={r.key}>{referenceLabels[r.key] ?? r.key}: {r.count}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {detachedRefs.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <p className="section-title" style={{ margin: '0 0 6px' }}>
                        Bleiben erhalten, verlieren aber die Zuordnung
                      </p>
                      <ul className="plain-list" style={{ margin: 0, paddingLeft: 20 }}>
                        {detachedRefs.map((r) => (
                          <li key={r.key}>{referenceLabels[r.key] ?? r.key}: {r.count}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="form-hint" style={{ marginTop: 12 }}>
                    In diesen Einträgen steht danach kein Benutzername mehr. Für Nachvollziehbarkeit
                    protokolliert das Audit-Log den Löschvorgang mit Name und Benutzernamen.
                  </p>
                </>
              )}

              <div className="modal-actions">
                <button className="btn" onClick={closeDelete} disabled={busy}>
                  Abbrechen
                </button>
                <button className="btn btn-danger" onClick={() => void confirmDelete()} disabled={busy}>
                  {busy ? 'Wird gelöscht …' : 'Endgültig löschen'}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
        </>
      )}
    </>
  );
}

export default UsersPage;