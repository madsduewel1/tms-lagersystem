import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api, ApiError } from '../api/client';
import { Icon } from '../components/Icon';
import { PageHeader, Alert, Field, Modal } from '../components/ui';
import type { RoleName, UserRow } from '../types';

interface ResetResult {
  id: number;
  username: string;
  name: string;
  tempPassword: string;
}

function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Benutzer erstellen
  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<RoleName>('techniker');
  const [createdTemp, setCreatedTemp] = useState<{ username: string; name: string; tempPassword: string } | null>(null);

  // E-Mail bearbeiten
  const [emailEdit, setEmailEdit] = useState<number | null>(null);
  const [emailDraft, setEmailDraft] = useState('');

  // Passwort zurücksetzen (einzeln / mehrere)
  const [resetResult, setResetResult] = useState<ResetResult[] | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ users: UserRow[] }>('/api/users');
      setUsers(data.users);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function flash(msg: string) {
    setSuccess(msg);
    window.setTimeout(() => setSuccess(''), 6000);
  }

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const allSelected = users.length > 0 && users.every((u) => prev.has(u.id));
      return allSelected ? new Set() : new Set(users.map((u) => u.id));
    });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api<{ id: number; tempPassword: string }>('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: newUsername.trim(),
          name: newName.trim(),
          email: newEmail.trim() || null,
          role: newRole,
        }),
      });
      setCreatedTemp({
        username: newUsername.trim(),
        name: newName.trim(),
        tempPassword: data.tempPassword,
      });
      setNewUsername('');
      setNewName('');
      setNewEmail('');
      setNewRole('techniker');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erstellen fehlgeschlagen');
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

  async function changeRole(u: UserRow) {
    const role = u.role === 'administrator' ? 'techniker' : 'administrator';
    setError('');
    try {
      await api(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      flash('Rolle geändert');
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

  return (
    <>
      <PageHeader
        title="Benutzer"
        subtitle="Benutzer anlegen, Passwörter zurücksetzen und Rechte verwalten"
        actions={
          <button className="btn btn-primary" onClick={() => { setError(''); setCreateOpen(true); }}>
            <Icon name="plus" size={16} />
            Benutzer erstellen
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      <div className="card toolbar" style={{ marginBottom: 16 }}>
        <span style={{ color: 'var(--text-secondary)' }}>
          {selected.size > 0 ? `${selected.size} ausgewählt` : 'Benutzer per Kästchen auswählen'}
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
          <button className="btn" onClick={toggleAll} disabled={busy}>
            Auswahl aufheben
          </button>
        )}
      </div>

      <div className="card">
        {users.length === 0 ? (
          <p className="empty-row">Noch keine Benutzer angelegt.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={users.length > 0 && users.every((u) => selected.has(u.id))}
                      onChange={toggleAll}
                      title="Alle auswählen"
                    />
                  </th>
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
                      <input
                        type="checkbox"
                        checked={selected.has(u.id)}
                        onChange={() => toggleSelected(u.id)}
                      />
                    </td>
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
                      <span className={`badge ${u.role === 'administrator' ? 'badge-admin' : 'badge-techniker'}`}>
                        {u.role === 'administrator' ? 'Administrator' : 'Techniker'}
                      </span>
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
                          onClick={() => void changeRole(u)}
                          disabled={u.id === currentUser?.id}
                          title={u.id === currentUser?.id ? 'Eigene Rolle nicht änderbar' : undefined}
                        >
                          {u.role === 'administrator' ? '→ Techniker' : '→ Admin'}
                        </button>
                        <button
                          className="btn"
                          onClick={() => void resetSingle(u)}
                          disabled={u.id === currentUser?.id || busy}
                          title={u.id === currentUser?.id ? 'Eigenes Passwort im Konto ändern' : '6-stelliger Code als vorläufiges Passwort'}
                        >
                          Reset
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() => void toggleActive(u)}
                          disabled={u.id === currentUser?.id}
                          title={u.id === currentUser?.id ? 'Kann sich nicht selbst deaktivieren' : undefined}
                        >
                          {u.active ? 'Deaktivieren' : 'Aktivieren'}
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

      {createOpen && (
        <Modal title="Benutzer erstellen" onClose={() => { setCreateOpen(false); setCreatedTemp(null); }}>
          {createdTemp ? (
            <>
              <Alert tone="success">Benutzer {createdTemp.name || createdTemp.username} wurde angelegt.</Alert>
              <div className="card" style={{ margin: '12px 0', borderColor: 'var(--warning)' }}>
                <p style={{ margin: 0 }}>
                  <strong>Vorläufiges Passwort (6-stellig):</strong>
                </p>
                <p className="mono" style={{ fontSize: 26, fontWeight: 700, letterSpacing: 4, margin: '8px 0' }}>
                  {createdTemp.tempPassword}
                </p>
                <p className="form-hint" style={{ margin: 0 }}>
                  Der Benutzer wird beim ersten Login aufgefordert, ein eigenes Passwort zu setzen.
                </p>
              </div>
              <div className="modal-actions">
                <button className="btn btn-primary" onClick={() => { setCreatedTemp(null); setCreateOpen(false); }}>
                  Fertig
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={handleCreate}>
              <Field label="Benutzername">
                <input className="form-input" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} required autoFocus />
              </Field>
              <Field label="Name">
                <input className="form-input" value={newName} onChange={(e) => setNewName(e.target.value)} required />
              </Field>
              <Field label="E-Mail (optional)">
                <input className="form-input" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              </Field>
              <Field label="Rolle">
                <select className="form-select" value={newRole} onChange={(e) => setNewRole(e.target.value as RoleName)}>
                  <option value="techniker">Techniker</option>
                  <option value="administrator">Administrator</option>
                </select>
              </Field>
              <p className="form-hint">
                Es wird automatisch ein 6-stelliges vorläufiges Passwort vergeben. Der Benutzer muss sich
                beim ersten Login ein neues Passwort setzen.
              </p>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setCreateOpen(false)}>
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  Benutzer erstellen
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}

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
    </>
  );
}

export default UsersPage;