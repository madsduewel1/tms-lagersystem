import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, downloadFile, fileUrl } from '../api/client';
import { PageHeader, Alert, Loading } from '../components/ui';
import { Icon } from '../components/Icon';
import type { Category, LabelFormat, LabelPreview, Item, StorageLocation } from '../types';

type LabelType = 'item' | 'location';

export default function LabelsPage() {
  const [type, setType] = useState<LabelType>('item');
  const [formats, setFormats] = useState<LabelFormat[]>([]);
  const [formatId, setFormatId] = useState('62x29');

  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState<'alle' | 'geraet' | 'artikel'>('alle');

  const [preview, setPreview] = useState<LabelPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeCategories, setIncludeCategories] = useState(true);
  const [includeLocations, setIncludeLocations] = useState(true);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadBase = useCallback(async () => {
    try {
      const [fmt, dev, art, cat, loc] = await Promise.all([
        api<{ formats: LabelFormat[] }>('/api/labels/formats'),
        api<{ items: Item[] }>('/api/devices?pageSize=300'),
        api<{ items: Item[] }>('/api/articles?pageSize=300'),
        api<{ categories: Category[] }>('/api/categories'),
        api<{ locations: StorageLocation[] }>('/api/storage-locations'),
      ]);
      setFormats(fmt.formats);
      setItems([...dev.items, ...art.items]);
      setCategories(cat.categories);
      setLocations(loc.locations);
      if (fmt.formats.length > 0) setFormatId(fmt.formats[0].id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  const filteredItems = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items
      .filter((i) => (kind === 'alle' ? true : i.kind === kind))
      .filter((i) => !categoryId || String(i.category_id) === categoryId)
      .filter((i) => !status || i.status === status)
      .filter((i) =>
        query
          ? [i.name, i.inventory_number, i.serial_number, i.manufacturer, i.model]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(query)
          : true
      )
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? 'de'));
  }, [items, q, categoryId, status, kind]);

  useEffect(() => {
    void fetchPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, kind, categoryId, status, q, includeCategories, includeLocations]);

  useEffect(() => {
    if (preview) {
      setSelected(new Set(preview.labels.map((l) => String(l.id))));
    }
  }, [preview]);

  async function fetchPreview() {
    setError('');
    const params = new URLSearchParams();
    params.set('type', type);
    params.set('includeCategories', includeCategories ? 'true' : 'false');
    params.set('includeLocations', includeLocations ? 'true' : 'false');
    if (type === 'item' && filteredItems.length > 0) {
      params.set('ids', filteredItems.map((i) => String(i.id)).join(','));
    } else if (type === 'location' && locations.length > 0) {
      params.set('ids', locations.map((l) => String(l.id)).join(','));
    }
    try {
      const data = await api<LabelPreview>(`/api/labels/preview?${params.toString()}`);
      setPreview(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Vorschau konnte nicht geladen werden');
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(on: boolean) {
    setSelected(on && preview ? new Set(preview.labels.map((l) => String(l.id))) : new Set());
  }

  async function downloadPdf() {
    if (selected.size === 0) {
      setError('Bitte mindestens ein Label auswählen');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await downloadFile(
        `/api/labels/pdf?type=${type}&ids=${[...selected].join(',')}&format=${formatId}`,
        `labels-${type}-${Date.now()}.pdf`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Download fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;

  const visibleLabels = preview?.labels ?? [];

  return (
    <>
      <PageHeader
        title="Labels"
        subtitle="QR-Labels für Assets und Lagerorte als PDF erstellen"
        actions={
          <>
            <select className="form-select" value={formatId} onChange={(e) => setFormatId(e.target.value)}>
              {formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={busy} onClick={() => void downloadPdf()}>
              <Icon name={busy ? 'refresh' : 'download'} size={16} />
              {busy ? 'Erstellt …' : 'PDF herunterladen'}
            </button>
          </>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card filter-bar">
        <div className="segmented">
          <button className={`segment${type === 'item' ? ' active' : ''}`} onClick={() => setType('item')}>
            Asset-Labels
          </button>
          <button
            className={`segment${type === 'location' ? ' active' : ''}`}
            onClick={() => setType('location')}
          >
            Lagerort-Labels
          </button>
        </div>

        {type === 'item' && (
          <>
            <div className="segmented">
              {(['alle', 'geraet', 'artikel'] as const).map((k) => (
                <button key={k} className={`segment${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
                  {k === 'alle' ? 'Alle' : k === 'geraet' ? 'Geräte' : 'Artikel'}
                </button>
              ))}
            </div>
            <input
              className="form-input"
              style={{ maxWidth: 220 }}
              placeholder="Suchen …"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select className="form-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Alle Kategorien</option>
              {categories.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
            <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Alle Status</option>
              <option value="verfuegbar">Verfügbar</option>
              <option value="ausgelagert">Ausgelagert</option>
              <option value="defekt">Defekt</option>
              <option value="wartung">In Wartung</option>
              <option value="verloren">Verloren</option>
            </select>
          </>
        )}
      </div>

      <div className="card label-options">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={includeCategories}
            onChange={(e) => setIncludeCategories(e.target.checked)}
          />
          Kategorie auf dem Label anzeigen
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={includeLocations}
            onChange={(e) => setIncludeLocations(e.target.checked)}
          />
          Lagerort auf dem Label anzeigen
        </label>
      </div>

      <div className="label-toolbar">
        <span>
          <strong>{visibleLabels.length}</strong> {type === 'item' ? 'Assets' : 'Lagerorte'} verfügbar,
          <strong> {selected.size}</strong> ausgewählt
        </span>
        <span>
          <button className="btn" onClick={() => toggleAll(true)}>Alle</button>
          <button className="btn" onClick={() => toggleAll(false)}>Keine</button>
        </span>
      </div>

      <div className="label-grid">
        {visibleLabels.map((l) => (
          <label key={`${l.type}-${l.id}`} className="card label-card">
            <input
              type="checkbox"
              className="label-check"
              checked={selected.has(String(l.id))}
              onChange={() => toggleSelect(String(l.id))}
            />
            <div className="label-card-qr">
              <img
                src={fileUrl(`/api/labels/qr/${l.qr_token}`)}
                alt="QR-Code"
                width={52}
                height={52}
              />
            </div>
            <div className="label-card-body">
              <strong>{l.label_text}</strong>
              {l.sub_text && <span className="label-card-sub">{l.sub_text}</span>}
              <span className="label-card-path">{l.location_path ?? l.name}</span>
            </div>
          </label>
        ))}
        {visibleLabels.length === 0 && (
          <div className="empty-row" style={{ gridColumn: '1 / -1' }}>
            Keine passenden Einträge – bitte Filter anpassen.
          </div>
        )}
      </div>

      {visibleLabels.length > 0 && (
        <p className="label-hint">
          Die QR-Codes auf dem Label führen nach dem Scannen zur Detailseite im
          Lagerprotal (Anmeldung erforderlich).
        </p>
      )}
    </>
  );
}