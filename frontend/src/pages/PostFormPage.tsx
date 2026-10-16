import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { PageHeader, Field, Alert } from '../components/ui';

export default function PostFormPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const canSubmit = body.trim().length > 0;

  async function handleSubmit() {
    setError('');
    if (!canSubmit) {
      setError('Bitte eine Nachricht eingeben');
      return;
    }
    setBusy(true);
    try {
      await api('/api/board', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), body: body.trim(), pinned }),
      });
      navigate('/pinnwand', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Neuer Beitrag"
        subtitle="Mitteilung mit dem Team teilen"
        backTo="/pinnwand"
        actions={
          <button className="btn btn-primary" disabled={busy || !canSubmit} onClick={() => void handleSubmit()}>
            {busy ? 'Veröffentlichen …' : 'Veröffentlichen'}
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card form-card">
        <Field label="Titel (optional)">
          <input
            className="form-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Nachricht">
          <textarea
            className="form-textarea"
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            autoFocus
          />
        </Field>
        <label className="checkbox-row">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          <span>Oben anpinnen</span>
        </label>
      </div>
    </>
  );
}
