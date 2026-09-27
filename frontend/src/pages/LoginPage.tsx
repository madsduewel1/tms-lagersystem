import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePublicSettings } from '../hooks/usePublicSettings';
import { ApiError, fileUrl } from '../api/client';
import { Icon } from '../components/Icon';

const tmsLogo = import.meta.env.BASE_URL + 'tms-logo.png';

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const settings = usePublicSettings();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from;
  const logoUrl = settings.logo_url ? fileUrl(settings.logo_url) : tmsLogo;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
      navigate(from && from.startsWith('/') ? from : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Anmeldung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <div className="auth-brand">
          <img className="auth-logo" src={logoUrl} alt={`${settings.system_name} Logo`} />
        </div>

        <div className="card auth-card">
          <div className="auth-head">
            <h1 className="auth-title">Anmelden</h1>
            <p className="auth-sub">
              Willkommen bei <strong>{settings.system_name}</strong>
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="username">
                Benutzername oder E-Mail
              </label>
              <input
                id="username"
                className="form-input auth-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>
            <div className="form-group">
              <div className="form-label-row">
                <label className="form-label" htmlFor="password">
                  Passwort
                </label>
              </div>
              <input
                id="password"
                className="form-input auth-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {error && <div className="form-error">{error}</div>}
            <button className="btn btn-primary auth-btn" type="submit" disabled={busy}>
              {busy ? (
                <>
                  <span className="spinner spinner-light" />
                  Anmelden …
                </>
              ) : (
                <>
                  Anmelden
                  <Icon name="arrow-right" size={16} />
                </>
              )}
            </button>
          </form>
        </div>

        {settings.support_email && (
          <div className="auth-info">
            <div className="auth-info-inner">
              <span className="auth-info-icon">
                <Icon name="info" size={18} />
              </span>
              <p className="auth-info-text">
                Probleme beim Anmelden? Wende dich an:{' '}
                <a className="auth-info-mail" href={`mailto:${settings.support_email}`}>
                  {settings.support_email}
                </a>
              </p>
            </div>
          </div>
        )}

        <p className="auth-footer">
          TMS Event-Technik · Lagerverwaltung für deine Veranstaltungstechnik
        </p>
      </div>
    </div>
  );
}

export default LoginPage;