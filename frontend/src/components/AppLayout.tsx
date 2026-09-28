import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePublicSettings } from '../hooks/usePublicSettings';
import { fileUrl } from '../api/client';
import { Icon, type IconName } from './Icon';
import { AccountModal } from './AccountModal';

const tmsLogo = import.meta.env.BASE_URL + 'tms-logo.png';

interface NavDef {
  to: string;
  label: string;
  icon: IconName;
  adminOnly?: boolean;
}

const nav: NavDef[] = [
  { to: '/inventar', label: 'Inventar', icon: 'boxes' },
  { to: '/lagerorte', label: 'Lagerorte', icon: 'grid' },
  { to: '/cases', label: 'Cases', icon: 'case' },
  { to: '/labels', label: 'Labels', icon: 'qr' },
  { to: '/events', label: 'Events', icon: 'calendar' },
  { to: '/users', label: 'Benutzer', icon: 'user', adminOnly: true },
  { to: '/settings', label: 'Einstellungen', icon: 'settings', adminOnly: true },
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function AppLayout() {
  const { user, logout } = useAuth();
  const settings = usePublicSettings();
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountTab, setAccountTab] = useState<'account' | 'password' | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (navRef.current && !navRef.current.contains(t)) setNavOpen(false);
      if (menuRef.current && !menuRef.current.contains(t)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const isAdmin = user?.role === 'administrator';
  const areas = nav.filter((n) => !n.adminOnly);
  const adminNav = nav.filter((n) => n.adminOnly && isAdmin);
  const logoUrl = settings.logo_url ? fileUrl(settings.logo_url) : tmsLogo;
  const forcePassword = Boolean(user?.must_change_password);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="topbar-brand" title="Startseite">
          <img className="tms-logo" src={logoUrl} alt="TMS Event-Technik Logo" />
          <em>{settings.system_name}</em>
        </Link>

        <div className="topbar-mod-wrap" ref={navRef}>
          <button
            className={`topbar-mod-btn${navOpen ? ' active' : ''}`}
            onClick={() => setNavOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={navOpen}
          >
            <Icon name="menu" size={18} />
            <span>Module</span>
            <Icon name="chevron-down" size={14} />
          </button>
          {navOpen && (
            <div className="module-menu card" role="menu">
              <p className="module-menu-label">Bereiche</p>
              {areas.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  role="menuitem"
                  className={({ isActive }) =>
                    `module-menu-item${isActive ? ' active' : ''}`
                  }
                  onClick={() => setNavOpen(false)}
                >
                  <span className="module-menu-ico">
                    <Icon name={n.icon} size={18} />
                  </span>
                  <span>{n.label}</span>
                </NavLink>
              ))}
              {adminNav.length > 0 && (
                <>
                  <p className="module-menu-label">Administration</p>
                  {adminNav.map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      role="menuitem"
                      className={({ isActive }) =>
                        `module-menu-item${isActive ? ' active' : ''}`
                      }
                      onClick={() => setNavOpen(false)}
                    >
                      <span className="module-menu-ico">
                        <Icon name={n.icon} size={18} />
                      </span>
                      <span>{n.label}</span>
                    </NavLink>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        <div className="topbar-spacer" />
        <div className="avatar-wrap" ref={menuRef}>
          <button
            className={`avatar-btn${menuOpen ? ' active' : ''}`}
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Konto ${user?.name ?? user?.username ?? ''}`}
          >
            <span className="avatar-btn-name">{user?.name ?? user?.username}</span>
            <Icon name="chevron-down" size={16} />
          </button>
          {menuOpen && (
            <div className="avatar-menu card">
              <div className="avatar-menu-head">
                <span className="avatar avatar-lg">{initialsOf(user?.name ?? user?.username ?? '')}</span>
                <div className="avatar-menu-id">
                  <strong>{user?.name}</strong>
                  <span>{user?.username}</span>
                  <span className="role-label">
                    {isAdmin ? 'Administrator' : 'Techniker'}
                  </span>
                </div>
              </div>
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