import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from '../api/client';
import type { User } from '../types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** true, wenn die Session nicht geprüft werden konnte (Netzwerk/Serverfehler). */
  connectionError: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** true, wenn der angemeldete Benutzer das angegebene Recht besitzt. */
  can: (code: string) => boolean;
  /** true, wenn der angemeldete Benutzer mindestens eines der Rechte besitzt. */
  canAny: (codes: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);

  async function refresh() {
    try {
      const data = await api<{ user: User }>('/api/auth/me');
      setUser(data.user);
      setConnectionError(false);
    } catch (err) {
      // Nur bei 401/403 ist die Sitzung wirklich ungültig. Bei 5xx oder
      // Netzwerkfehlern darf der Benutzer nicht unerwartet ausgeloggt werden.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setUser(null);
        setConnectionError(false);
      } else {
        setConnectionError(true);
      }
    }
  }

  useEffect(() => {
    refresh().then(() => setLoading(false));
  }, []);

  async function login(username: string, password: string) {
    const data = await api<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setUser(data.user);
    setConnectionError(false);
  }

  async function logout() {
    try {
      await api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
    }
  }

  const permissions = user?.permissions ?? [];
  const can = (code: string) => permissions.includes(code);
  const canAny = (codes: string[]) => codes.some((code) => permissions.includes(code));

  return (
    <AuthContext.Provider
      value={{ user, loading, connectionError, login, logout, refresh, can, canAny }}
    >
      {children}
    </AuthContext.Provider>
  );
}


export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden');
  return ctx;
}