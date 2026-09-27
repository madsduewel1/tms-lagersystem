import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

export function NotFound({
  title = 'Nicht gefunden',
  hint,
  backTo,
  backLabel = 'Zur Übersicht',
  icon = 'search',
}: {
  title?: string;
  hint?: string;
  backTo?: string;
  backLabel?: string;
  icon?: IconName;
}) {
  return (
    <div className="empty-state not-found">
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {backTo && (
        <div className="empty-action">
          <Link className="btn" to={backTo}>
            <Icon name="arrow-left" size={16} />
            {backLabel}
          </Link>
        </div>
      )}
    </div>
  );
}