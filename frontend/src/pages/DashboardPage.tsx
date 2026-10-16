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
  permission: string;
  wide?: boolean;
}

const teamTiles: TileDef[] = [
  { to: '/aufgaben', icon: 'check-square', title: 'Aufgaben', hint: 'To-dos planen & zuweisen', color: 'indigo', permission: 'tasks.view' },
  { to: '/kalender', icon: 'calendar', title: 'Kalender', hint: 'Termine & Events im Überblick', color: 'amber', permission: 'calendar.view' },
  { to: '/pinnwand', icon: 'message-square', title: 'Pinnwand', hint: 'Aushänge & Team-Infos', color: 'teal', permission: 'board.view' },
  { to: '/nachrichten', icon: 'mail', title: 'Nachrichten', hint: 'Direkter Austausch', color: 'blue', permission: 'messages.use' },
];

const technikTiles: TileDef[] = [
  { to: '/inventar', icon: 'boxes', title: 'Inventar', hint: 'Geräte, Artikel & Suchfilter', color: 'blue', permission: 'inventory.view' },
  { to: '/lagerorte', icon: 'grid', title: 'Lagerorte', hint: 'Lager & Regale in Baumansicht', color: 'teal', permission: 'locations.view' },
  { to: '/cases', icon: 'case', title: 'Cases', hint: 'Koffer mit Assets für Events', color: 'purple', permission: 'cases.view' },
  { to: '/events', icon: 'calendar', title: 'Events', hint: 'Veranstaltungen planen & ausrüsten', color: 'amber', permission: 'events.view' },
  { to: '/labels', icon: 'qr', title: 'Labels', hint: 'QR-Labels drucken', color: 'indigo', permission: 'labels.print', wide: true },
];

const adminTiles: TileDef[] = [
  { to: '/users', icon: 'user', title: 'Benutzer', hint: 'Benutzer, Rollen & Rechte verwalten', color: 'pink', permission: 'users.manage' },
  { to: '/settings', icon: 'settings', title: 'Einstellungen', hint: 'System, Logo & Kategorien', color: 'green', permission: 'settings.manage' },
];

function greetingText(date: Date): string {
  const h = date.getHours();
  if (h < 11) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

function DashboardPage() {
  const { user, can, canAny } = useAuth();
  const settings = usePublicSettings();
  const firstName = (user?.name ?? user?.username ?? '').trim().split(/\s+/)[0];

  const visible = (tiles: TileDef[]) => tiles.filter((tile) => can(tile.permission));
  const groups = [
    { key: 'team', title: 'Team & Organisation', tiles: visible(teamTiles) },
    { key: 'technik', title: 'Technik', tiles: visible(technikTiles) },
    {
      key: 'administration',
      title: 'Administration',
      tiles: adminTiles.filter(
        (tile) =>
          can(tile.permission) || (tile.to === '/users' && canAny(['users.manage', 'roles.manage']))
      ),
    },
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
