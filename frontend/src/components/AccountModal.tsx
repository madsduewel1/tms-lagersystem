import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { Modal, Field, Alert } from './ui';

export function AccountModal({
  onClose,
  initialTab = 'account',
  forcePassword = false,
}: {
  onClose: () => void;
  initialTab?: 'account' | 'password';
  forcePassword?: boolean;
}) {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [tab, setTab] = useState<'account' | 'password'>(initialTab);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveName() {
    setError('');
    setBusy(true);
    try {
      await api('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim() }),
      });
      await refresh();
      setSuccess('Name gespeichert');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    setError('');
    setSuccess('');
    if (newPassword.length < 8) {
      setError('Das neue Passwort muss mindestens 8 Zeichen haben');
      return;
    }
    if (newPassword !== repeat) {
      setError('Die Passwörter stimmen nicht überein');
      return;
    }
    setBusy(true);
    try {
      await api('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setSuccess('Passwort geändert');
      setCurrentPassword('');
      setNewPassword('');
      setRepeat('');
      if (forcePassword) {
        await refresh();
        onClose();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Änderung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={forcePassword ? 'Passwort ändern erforderlich' : 'Mein Konto'}
      onClose={onClose}
      hideClose={forcePassword}
    >
      {!forcePassword && (
        <div className="tabs">
          <button
            className={`tab${tab === 'account' ? ' active' : ''}`}
            onClick={() => {
              setTab('account');
              setError('');
              setSuccess('');
            }}
          >
            Konto
          </button>
          <button
            className={`tab${tab === 'password' ? ' active' : ''}`}
            onClick={() => {
              setTab('password');
              setError('');
              setSuccess('');
            }}
          >
            Passwort ändern
          </button>
        </div>
      )}

      {forcePassword && (
        <Alert tone="info">
          Bitte setze jetzt ein neues Passwort. Bis dahin gilt das vorläufige Passwort.
        </Alert>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      {!forcePassword && tab === 'account' ? (
        <>
          <Field label="Benutzername">
            <input className="form-input" value={user?.username ?? ''} disabled />
          </Field>
          <Field label="Rolle">
            <input
              className="form-input"
              value={user?.role === 'administrator' ? 'Administrator' : 'Techniker'}
              disabled
            />
          </Field>
          <Field label="Name">
            <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => void saveName()} disabled={busy}>
              Speichern
            </button>
          </div>
        </>
      ) : (
        <>
          <Field label={forcePassword ? 'Vorläufiges Passwort (aktuelles Passwort)' : 'Aktuelles Passwort'}>
            <input
              className="form-input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label="Neues Passwort" hint="Mindestens 8 Zeichen">
            <input
              className="form-input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Neues Passwort wiederholen">
            <input
              className="form-input"
              type="password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => void savePassword()} disabled={busy}>
              Passwort ändern
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}