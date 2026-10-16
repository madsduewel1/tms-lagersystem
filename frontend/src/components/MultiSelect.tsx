import { useEffect, useRef, useState } from 'react';
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

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
    <div className="multiselect" ref={ref}>
      <button
        type="button"
        className="multiselect-toggle"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
      >
        <span className="multiselect-summary" title={selectedLabels.join(', ')}>
          {selectedLabels.length > 0 ? selectedLabels.join(', ') : placeholder}
        </span>
        <Icon name="chevron-down" size={15} />
      </button>
      {open && !disabled && (
        <div className="multiselect-panel">
          <div className="multiselect-actions">
            <button className="link-btn" type="button" onClick={selectAll}>
              Alle
            </button>
            <button className="link-btn" type="button" onClick={clear}>
              Keine
            </button>
          </div>
          <div className="multiselect-list">
            {options.length === 0 && <p className="form-hint" style={{ padding: '4px 8px' }}>{emptyText}</p>}
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
        </div>
      )}
    </div>
  );
}

export default MultiSelect;
