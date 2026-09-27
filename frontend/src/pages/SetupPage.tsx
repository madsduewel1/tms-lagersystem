import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';

function SetupPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [username, setUsername] = useState('admin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const tmsLogo = import.meta.env.BASE_URL + 'tms-logo.jpeg';

  useEffect(() => {
    api<{ setupRequired: boolean }>('/api/setup/status')
      .then((data) => {
        if (!data.setupRequired) setBlocked(true);
      })
      .catch(() => setBlocked(true))
      .finally(() => setChecking(false));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Das Passwort muss mindestens 8 Zeichen lang sein');
      return;
    }
    if (password !== passwordRepeat) {
      setError('Die Passwörter stimmen nicht überein');
      return;
    }
    setBusy(true);
    try {
      await api('/api/setup/init', {
        method: 'POST',
        body: JSON.stringify({
          username: username.trim(),
          name: name.trim(),
          email: email.trim() || null,
          password,
        }),
      });
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Einrichtung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return <div className="auth-page" />;
  }

  if (blocked) {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <h1 className="auth-title">Ersteinrichtung abgeschlossen</h1>
          <p className="auth-sub">Bitte melde dich mit deinen Zugangsdaten an.</p>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => navigate('/login')}>
            Zum Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <h1 className="auth-title">
          <img className="auth-logo" src={tmsLogo} alt="TMS Event-Technik Logo" />
        </h1>
        <p className="auth-sub">
          Ersteinrichtung – der erste Benutzer wird automatisch Administrator.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="username">
              Benutzername
            </label>
            <input
              id="username"
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
            <div className="form-hint">Mindestens 3 Zeichen (a–z, 0–9, . _ -)</div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="email">
              E-Mail (optional)
            </label>
            <input
              id="email"
              className="form-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="max@beispiel.de"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="z. B. Max Mustermann"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="password">
              Passwort
            </label>
            <input
              id="password"
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="passwordRepeat">
              Passwort wiederholen
            </label>
            <input
              id="passwordRepeat"
              className="form-input"
              type="password"
              value={passwordRepeat}
              onChange={(e) => setPasswordRepeat(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 16, width: '100%' }}>
            {busy ? 'Einrichten …' : 'System einrichten'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default SetupPage;