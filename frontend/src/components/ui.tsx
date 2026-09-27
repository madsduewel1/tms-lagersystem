import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { statusTone } from '../utils/format';

export function PageHeader({
  title,
  subtitle,
  actions,
  backTo,
  onBack,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  backTo?: string;
  onBack?: () => void;
}) {
  return (
    <div className="page-head">
      <div className="page-head-main">
        {backTo && !onBack && (
          <Link
            className="icon-btn back-btn"
            to={backTo}
            aria-label="Zurück"
          >
            <Icon name="arrow-left" size={18} />
          </Link>
        )}
        {onBack && (
          <button className="icon-btn back-btn" onClick={onBack} aria-label="Zurück">
            <Icon name="arrow-left" size={18} />
          </button>
        )}
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-sub">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'success' | 'warning' | 'danger' | 'muted' | 'accent';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <Badge tone={statusTone(status)}>{label}</Badge>;
}

export function EmptyState({
  icon = 'boxes',
  title,
  hint,
  action,
}: {
  icon?: Parameters<typeof Icon>[0]['name'];
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  hideClose = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  hideClose?: boolean;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape schließt den Dialog – bisher gab es nur einen Klick auf den Backdrop.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !hideClose) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, hideClose]);

  // Fokus in den Dialog verlagern, damit Screenreader und Tastaturnavigation
  // nicht im Hintergrund der Seite landen.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <>
      <div className="backdrop overlay" onClick={hideClose ? undefined : onClose} />
      <div className="modal-layer">
        <div
          className={`card modal${wide ? ' modal-wide' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          ref={dialogRef}
        >
          <div className="modal-head">
            <h2 className="section-title" id={titleId}>
              {title}
            </h2>
            {!hideClose && (
              <button className="icon-btn" onClick={onClose} aria-label="Schließen">
                <Icon name="x" size={18} />
              </button>
            )}
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </div>
      </div>
    </>
  );
}

let fieldCounter = 0;

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  // Das Label war bisher ein freistehendes <label> ohne htmlFor und ohne das
  // Eingabefeld – dadurch hatte kein Formularfeld einen zugänglichen Namen.
  const [fieldId] = useState(() => `field-${++fieldCounter}`);

  // Wenn children ein einzelnes Formularelement ist, bekommt es die passende id.
  const linked = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, {
        id: (children as ReactElement<{ id?: string }>).props.id ?? fieldId,
      })
    : children;

  return (
    <div className="form-group">
      <label className="form-label" htmlFor={fieldId}>
        {label}
      </label>
      {linked}
      {hint && (
        <div className="form-hint" id={`${fieldId}-hint`}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" />;
}

export function Loading({ label = 'Lädt …' }: { label?: string }) {
  return (
    <div className="loading-row">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function Alert({
  tone,
  children,
  onClose,
}: {
  tone: 'error' | 'success' | 'info';
  children: ReactNode;
  onClose?: () => void;
}) {
  const icon = tone === 'error' ? 'alert' : tone === 'success' ? 'check' : 'info';
  return (
    <div
      className={`alert alert-${tone}`}
      // role="alert" sorgt dafür, dass Screenreader Fehlermeldungen vorlesen.
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon name={icon} size={16} />
      <span>{children}</span>
      {onClose && (
        <button className="icon-btn alert-close" onClick={onClose} aria-label="Schließen">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

