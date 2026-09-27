import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { NotFound } from '../components/NotFound';
import type { ResolvedQr } from '../types';

export default function QrRedirect() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<
    { status: 'loading' } |
    { status: 'error'; notFound: boolean; message: string }
  >({ status: 'loading' });

  useEffect(() => {
    if (!token) {
      setState({ status: 'error', notFound: true, message: 'QR-Code nicht gefunden.' });
      return;
    }
    api<ResolvedQr>(`/api/resolve/${token}`)
      .then((data) => navigate(data.path, { replace: true }))
      .catch((err) => {
        const notFound = err instanceof ApiError && err.status === 404;
        const message = err instanceof ApiError ? err.message : 'QR-Code konnte nicht aufgelöst werden.';
        setState({ status: 'error', notFound, message });
      });
  }, [token, navigate]);

  if (state.status === 'loading') {
    return (
      <div className="loading-row">
        <span className="spinner" />
        <span>QR-Code wird aufgelöst …</span>
      </div>
    );
  }

  return (
    <NotFound
      icon={state.notFound ? 'qr' : 'alert'}
      title={state.notFound ? 'QR-Code nicht gefunden' : 'QR-Code aufgelöst fehlgeschlagen'}
      hint={state.message}
      backTo="/"
      backLabel="Zur Startseite"
    />
  );
}