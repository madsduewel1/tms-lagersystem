import { useEffect, useRef, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePublicSettings } from '../hooks/usePublicSettings';
import { Icon } from './Icon';
import { AccountModal } from './AccountModal';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function AppLayout() {
  const { user, logout } = useAuth();
  const settings = usePublicSettings();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountTab, setAccountTab] = useState<'account' | 'password' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(t)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const forcePassword = Boolean(user?.must_change_password);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="topbar-brand" title="Startseite">
          <Icon name="boxes" size={24} />
          <em>{settings.system_name}</em>
        </Link>

        <div className="topbar-spacer" />

        <GlobalSearch />
        <NotificationBell />
        <div className="avatar-wrap" ref={menuRef}>
          <button
            className={`avatar-btn${menuOpen ? ' active' : ''}`}
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Konto ${user?.name ?? user?.username ?? ''}`}
          >
            <span className="avatar-btn-name">{user?.name ?? user?.username}</span>
            <span className="avatar avatar-top">
              {initialsOf(user?.name ?? user?.username ?? '')}
            </span>
          </button>
          {menuOpen && (
            <div className="avatar-menu card">
              <div className="avatar-menu-head">
                <span className="avatar avatar-lg">{initialsOf(user?.name ?? user?.username ?? '')}</span>
                <div className="avatar-menu-id">
                  <strong>{user?.name}</strong>
                  <span>{user?.username}</span>
                  <span className="role-label">
                    {user?.roles.map((r) => r.label).join(', ')}
                  </span>
                </div>
              </div>
              <Link className="avatar-menu-item" to="/" onClick={() => setMenuOpen(false)}>
                <Icon name="grid" size={16} />
                <span>Übersicht</span>
              </Link>
              <button
                className="avatar-menu-item"
                onClick={() => {
                  setAccountTab('account');
                  setMenuOpen(false);
                }}
              >
                <Icon name="user" size={16} />
                <span>Mein Konto</span>
              </button>
              <button
                className="avatar-menu-item"
                onClick={() => {
                  setAccountTab('password');
                  setMenuOpen(false);
                }}
              >
                <Icon name="lock" size={16} />
                <span>Passwort ändern</span>
              </button>
              <div className="avatar-menu-sep" />
              <button
                className="avatar-menu-item danger"
                onClick={() => {
                  setMenuOpen(false);
                  void logout();
                }}
              >
                <Icon name="logout" size={16} />
                <span>Abmelden</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>

      {accountTab && (
        <AccountModal
          initialTab={accountTab}
          onClose={() => setAccountTab(null)}
        />
      )}
      {forcePassword && (
        <AccountModal forcePassword onClose={() => setAccountTab(null)} />
      )}
    </div>
  );
}

export default AppLayout;
