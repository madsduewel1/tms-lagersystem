import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { PageHeader, Field, Alert, Loading } from '../components/ui';
import type { Category } from '../types';

export default function CategoryFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editId = params.get('id');
  const isEdit = Boolean(editId);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    if (editId) {
      api<{ categories: Category[] }>('/api/categories')
        .then(({ categories }) => {
          const category = categories.find((c) => c.id === Number(editId));
          if (!category) {
            setError('Kategorie nicht gefunden');
          } else {
            setName(category.name);
            setDescription(category.description ?? '');
          }
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen'))
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  async function handleSubmit() {
    setError('');
    if (!name.trim()) {
      setError('Bitte einen Namen angeben');
      return;
    }
    setBusy(true);
    const body = { name: name.trim(), description: description.trim() || null };
    try {
      if (isEdit) {
        await api(`/api/categories/${Number(editId)}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await api('/api/categories', { method: 'POST', body: JSON.stringify(body) });
      }
      navigate('/settings?tab=categories', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader
        title={isEdit ? 'Kategorie bearbeiten' : 'Neue Kategorie'}
        subtitle={isEdit ? `Bearbeiten von #${editId}` : 'Kategorie für Artikel anlegen'}
        backTo="/settings?tab=categories"
        actions={
          <button className="btn btn-primary" disabled={busy} onClick={() => void handleSubmit()}>
            {busy ? 'Speichert …' : isEdit ? 'Speichern' : 'Kategorie anlegen'}
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card form-card">
        <Field label="Name">
          <input
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Beschreibung">
          <textarea
            className="form-textarea"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </div>
    </>
  );
}
