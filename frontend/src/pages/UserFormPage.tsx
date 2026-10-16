import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { PageHeader, Field, Alert } from '../components/ui';
import { Icon } from '../components/Icon';
import { MultiSelect } from '../components/MultiSelect';
import type { RoleRef } from '../types';

export default function UserFormPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<RoleRef[]>([]);
  const [roleIds, setRoleIds] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ username: string; name: string; tempPassword: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api<{ roles: RoleRef[] }>('/api/users/assignable-roles');
        setRoles(data.roles);
        setRoleIds((current) => {
          if (current.length > 0) return current;
          const preferred = data.roles.find((r) => r.name === 'techniker') ?? data.roles[0];
          return preferred ? [preferred.id] : [];
        });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Rollen konnten nicht geladen werden');
      }
    })();
  }, []);

  async function handleSubmit() {
    setError('');
    if (!username.trim() || !name.trim()) {
      setError('Benutzername und Name sind erforderlich');
      return;
    }
    if (roleIds.length === 0) {
      setError('Bitte mindestens eine Rolle auswählen');
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ id: number; tempPassword: string }>('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: username.trim(),
          name: name.trim(),
          email: email.trim() || null,
          roleIds,
        }),
      });
      setCreated({ username: username.trim(), name: name.trim(), tempPassword: data.tempPassword });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erstellen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <>
        <PageHeader title="Benutzer erstellt" backTo="/users" />
        <Alert tone="success">
          Benutzer {created.name || created.username} wurde angelegt.
        </Alert>
        <div className="card form-card">
          <h2 className="section-title">Vorläufiges Passwort (6-stellig)</h2>
          <p className="mono" style={{ fontSize: 34, fontWeight: 700, letterSpacing: 6, margin: '8px 0' }}>
            {created.tempPassword}
          </p>
          <p className="form-hint">
            Der Benutzer wird beim ersten Login aufgefordert, ein eigenes Passwort zu setzen.
            Bitte diesen Code jetzt weitergeben – er wird nicht erneut angezeigt.
          </p>
          <div className="page-actions" style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => navigate('/users/new', { replace: true })}>
              <Icon name="plus" size={16} />
              Weiteren Benutzer anlegen
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/users', { replace: true })}>
              Zur Benutzerliste
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Benutzer erstellen"
        subtitle="Neuen Zugang mit automatischem vorläufigem Passwort anlegen"
        backTo="/users"
        actions={
          <button className="btn btn-primary" disabled={busy} onClick={() => void handleSubmit()}>
            {busy ? 'Erstellen …' : 'Benutzer erstellen'}
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card form-card">
        <Field label="Benutzername">
          <input
            className="form-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Name">
          <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="E-Mail (optional)">
          <input
            className="form-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Rollen" hint="Mehrere Rollen möglich – die Rechte werden zusammengeführt.">
          <MultiSelect
            options={roles.map((r) => ({ value: r.id, label: r.label }))}
            value={roleIds}
            onChange={setRoleIds}
            placeholder="Rollen auswählen"
            emptyText="Keine Rollen vorhanden."
          />
        </Field>
        <p className="form-hint">
          Es wird automatisch ein 6-stelliges vorläufiges Passwort vergeben. Der Benutzer muss sich
          beim ersten Login ein neues Passwort setzen.
        </p>
      </div>
    </>
  );
}
