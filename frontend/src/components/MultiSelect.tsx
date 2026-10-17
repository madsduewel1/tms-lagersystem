import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface MultiSelectOption {
  value: number;
  label: string;
  sublabel?: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: number[];
  onChange: (next: number[]) => void;
  placeholder?: string;
  disabled?: boolean;
  disabledValues?: number[];
  emptyText?: string;
}

interface PanelCoords {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Auswählen',
  disabled = false,
  disabledValues = [],
  emptyText = 'Keine Einträge gefunden.',
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PanelCoords | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const computeCoords = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mobile = vw <= 720;
    const width = mobile ? vw - 16 : Math.min(Math.max(rect.width, 240), 360);
    const left = mobile ? 8 : Math.max(8, Math.min(rect.left, vw - width - 8));
    const spaceBelow = vh - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, Math.min(320, openUp ? spaceAbove : spaceBelow));
    setCoords(
      openUp
        ? { left, width, maxHeight, bottom: vh - rect.top + 4 }
        : { left, width, maxHeight, top: rect.bottom + 4 }
    );
  }, []);

  useLayoutEffect(() => {
    if (open) computeCoords();
  }, [open, computeCoords]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', computeCoords);
    window.addEventListener('scroll', computeCoords, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', computeCoords);
      window.removeEventListener('scroll', computeCoords, true);
    };
  }, [open, computeCoords]);

  const blocked = new Set(disabledValues);
  const selectable = options.filter((o) => !blocked.has(o.value));
  const selected = new Set(value);
  const selectedLabels = options.filter((o) => selected.has(o.value)).map((o) => o.label);

  function toggle(id: number) {
    if (blocked.has(id)) return;
    const next = new Set(value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  }

  function selectAll() {
    const next = new Set(value);
    for (const o of selectable) next.add(o.value);
    onChange(Array.from(next));
  }

  function clear() {
    onChange(value.filter((id) => blocked.has(id)));
  }

  return (
    <div className="multiselect" ref={wrapRef}>
      <button
        type="button"
        ref={buttonRef}
        className="multiselect-toggle"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="multiselect-summary" title={selectedLabels.join(', ')}>
          {selectedLabels.length > 0 ? selectedLabels.join(', ') : placeholder}
        </span>
        <Icon name="chevron-down" size={15} />
      </button>
      {open &&
        !disabled &&
        coords &&
        createPortal(
          <div
            className="multiselect-panel multiselect-panel--floating"
            ref={panelRef}
            role="listbox"
            style={{
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight,
              ...(coords.top != null ? { top: coords.top } : { bottom: coords.bottom }),
            }}
          >
            <div className="multiselect-actions">
              <button className="link-btn" type="button" onClick={selectAll}>
                Alle
              </button>
              <button className="link-btn" type="button" onClick={clear}>
                Keine
              </button>
            </div>
            <div className="multiselect-list">
              {options.length === 0 && (
                <p className="form-hint" style={{ padding: '4px 8px' }}>
                  {emptyText}
                </p>
              )}
              {options.map((o) => (
                <label key={o.value} className="multiselect-item">
                  <input
                    type="checkbox"
                    checked={selected.has(o.value)}
                    disabled={blocked.has(o.value)}
                    onChange={() => toggle(o.value)}
                  />
                  <span>
                    {o.label}
                    {o.sublabel ? <span className="cell-sub">@{o.sublabel}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
