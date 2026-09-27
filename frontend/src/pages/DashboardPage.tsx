import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePublicSettings } from '../hooks/usePublicSettings';
import { Icon, type IconName } from '../components/Icon';

interface TileDef {
  to: string;
  icon: IconName;
  title: string;
  hint: string;
  color: string;
  wide?: boolean;
}

const technikTiles: TileDef[] = [
  { to: '/inventar', icon: 'boxes', title: 'Inventar', hint: 'Geräte, Artikel & Suchfilter', color: 'blue' },
  { to: '/lagerorte', icon: 'grid', title: 'Lagerorte', hint: 'Lager & Regale in Baumansicht', color: 'teal' },
  { to: '/cases', icon: 'case', title: 'Cases', hint: 'Koffer mit Assets für Events', color: 'purple' },
  { to: '/events', icon: 'calendar', title: 'Events', hint: 'Veranstaltungen planen & ausrüsten', color: 'amber' },
  { to: '/labels', icon: 'qr', title: 'Labels', hint: 'QR-Labels drucken', color: 'indigo', wide: true },
];

const adminTiles: TileDef[] = [
  { to: '/users', icon: 'user', title: 'Benutzer', hint: 'Benutzer & Rollen verwalten', color: 'pink' },
  { to: '/settings', icon: 'settings', title: 'Einstellungen', hint: 'System, Logo, Audit-Log & Kategorien', color: 'green' },
];

function greetingText(date: Date): string {
  const h = date.getHours();
  if (h < 11) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

function DashboardPage() {
  const { user } = useAuth();
  const settings = usePublicSettings();
  const isAdmin = user?.role === 'administrator';
  const firstName = (user?.name ?? user?.username ?? '').trim().split(/\s+/)[0];
  const groups = [
    { key: 'technik', title: 'Technik', tiles: technikTiles },
    { key: 'administration', title: 'Administration', tiles: isAdmin ? adminTiles : [] },
  ].filter((g) => g.tiles.length > 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {greetingText(new Date())}, {firstName}
          </h1>
          <p className="page-sub">
            {settings.system_name} – Was möchtest du tun?
          </p>
        </div>
      </div>

      {groups.map((group) => (
        <section key={group.key} className={`module-group module-group--${group.key}`}>
          <h2 className="module-group-title">{group.title}</h2>
          <div className="module-tiles">
            {group.tiles.map((tile) => (
              <Link
                key={tile.to}
                to={tile.to}
                className={`tile card tile--${tile.color}${tile.wide ? ' tile--wide' : ''}`}
              >
                <span className="tile-icon">
                  <Icon name={tile.icon} size={tile.wide ? 20 : 26} />
                </span>
                <span className="tile-body">
                  <strong className="tile-title">{tile.title}</strong>
                  <span className="tile-hint">{tile.hint}</span>
                </span>
                <span className="tile-arrow">
                  <Icon name="chevron-right" size={18} />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export default DashboardPage;