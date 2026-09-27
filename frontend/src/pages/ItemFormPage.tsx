import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { PageHeader, Field, Alert, Loading } from '../components/ui';
import type { CaseRow, Category, DeviceStatus, Item, ItemKind, StorageLocation } from '../types';
import { deviceStatusLabels } from '../utils/format';

const statuses: DeviceStatus[] = [
  'verfuegbar',
  'ausgelagert',
  'defekt',
  'wartung',
  'verloren',
  'ausser_betrieb',
];

const conditionOptions = ['neu', 'gut', 'gebraucht', 'defekt'];

interface ItemFormData {
  kind: ItemKind;
  name: string;
  manufacturer: string;
  model: string;
  article_number: string;
  category_id: string;
  storage_location_id: string;
  case_id: string;
  quantity: string;
  unit: string;
  min_stock: string;
  inventory_number: string;
  serial_number: string;
  status: DeviceStatus;
  condition: string;
  purchase_price: string;
  purchase_date: string;
  current_value: string;
  warranty: string;
  description: string;
  technical_data: string;
  manual_url: string;
  notes: string;
}

const emptyForm: ItemFormData = {
  kind: 'geraet',
  name: '',
  manufacturer: '',
  model: '',
  article_number: '',
  category_id: '',
  storage_location_id: '',
  case_id: '',
  quantity: '1',
  unit: 'Stk',
  min_stock: '',
  inventory_number: '',
  serial_number: '',
  status: 'verfuegbar',
  condition: '',
  purchase_price: '',
  purchase_date: '',
  current_value: '',
  warranty: '',
  description: '',
  technical_data: '',
  manual_url: '',
  notes: '',
};

function toForm(item: Item): ItemFormData {
  return {
    kind: item.kind,
    name: item.name,
    manufacturer: item.manufacturer ?? '',
    model: item.model ?? '',
    article_number: item.article_number ?? '',
    category_id: item.category_id ? String(item.category_id) : '',
    storage_location_id: item.storage_location_id ? String(item.storage_location_id) : '',
    case_id: item.case_id ? String(item.case_id) : '',
    quantity: String(item.quantity ?? 1),
    unit: item.unit ?? '',
    min_stock: item.min_stock === null ? '' : String(item.min_stock),
    inventory_number: item.inventory_number ?? '',
    serial_number: item.serial_number ?? '',
    status: item.status,
    condition: item.condition ?? '',
    purchase_price: item.purchase_price === null ? '' : String(item.purchase_price),
    purchase_date: item.purchase_date ? item.purchase_date.slice(0, 10) : '',
    current_value: item.current_value === null ? '' : String(item.current_value),
    warranty: item.warranty ?? '',
    description: item.description ?? '',
    technical_data: item.technical_data ?? '',
    manual_url: item.manual_url ?? '',
    notes: item.notes ?? '',
  };
}

function numOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() === '' || Number.isNaN(n) ? null : n;
}

function flattenLocations(rows: StorageLocation[]): Array<{ id: number; label: string }> {
  const byParent = new Map<number | null, StorageLocation[]>();
  for (const r of rows) {
    const key = r.parent_id ?? null;
    const list = byParent.get(key) ?? [];
    list.push(r);
    byParent.set(key, list);
  }
  const out: Array<{ id: number; label: string }> = [];
  const visit = (parent: number | null, depth: number) => {
    for (const r of byParent.get(parent) ?? []) {
      const prefix = depth === 0 ? '' : '  '.repeat(depth);
      out.push({ id: r.id, label: `${prefix}${r.name}${r.code ? ` (${r.code})` : ''}` });
      visit(r.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

export default function ItemFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editId = params.get('id');
  const defaultKind = params.get('kind');

  const [categories, setCategories] = useState<Category[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [initialCaseId, setInitialCaseId] = useState('');
  const [form, setForm] = useState<ItemFormData>({
    ...emptyForm,
    kind: defaultKind === 'artikel' ? 'artikel' : 'geraet',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(editId));

  const isEdit = Boolean(editId);
  const endPoint = form.kind === 'geraet' ? '/api/devices' : '/api/articles';

  const load = useCallback(async () => {
    try {
      const [catResp, caseResp, locResp] = await Promise.all([
        api<{ categories: Category[] }>('/api/categories'),
        api<{ cases: CaseRow[] }>('/api/cases'),
        api<{ locations: StorageLocation[] }>('/api/storage-locations'),
      ]);
      setCategories(catResp.categories);
      setCases(caseResp.cases);
      setLocations(locResp.locations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!editId) return;
    api<{ item: Item }>(`/api/items/${Number(editId)}`)
      .then((data) => {
        setForm(toForm(data.item));
        setInitialCaseId(data.item.case_id ? String(data.item.case_id) : '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen'))
      .finally(() => setLoading(false));
  }, [editId]);

  function set<K extends keyof ItemFormData>(key: K, value: ItemFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    setError('');
    if (!form.name.trim()) {
      setError('Bitte einen Namen angeben');
      return;
    }
    setBusy(true);
    try {
      const caseValue = form.case_id ? Number(form.case_id) : null;
      const body = {
        name: form.name.trim(),
        manufacturer: form.manufacturer.trim() || null,
        model: form.model.trim() || null,
        article_number: form.article_number.trim() || null,
        category_id: form.category_id ? Number(form.category_id) : null,
        storage_location_id: form.storage_location_id ? Number(form.storage_location_id) : null,
        quantity: form.kind === 'geraet' ? Math.max(1, Number(form.quantity || 1)) : Number(form.quantity || 0),
        unit: form.kind === 'artikel' ? (form.unit.trim() || null) : null,
        min_stock: form.kind === 'artikel' ? numOrNull(form.min_stock) : null,
        inventory_number: form.inventory_number.trim() || null,
        serial_number: form.kind === 'geraet' ? (form.serial_number.trim() || null) : null,
        status: form.status,
        condition: (form.condition || null) as 'neu' | 'gut' | 'gebraucht' | 'defekt' | null,
        purchase_price: numOrNull(form.purchase_price),
        purchase_date: form.purchase_date || null,
        current_value: numOrNull(form.current_value),
        warranty: form.warranty.trim() || null,
        description: form.description.trim() || null,
        technical_data: form.technical_data.trim() || null,
        manual_url: form.manual_url.trim() || null,
        notes: form.notes.trim() || null,
      };
      const withCase: { case_id?: number | null } = { ...body, case_id: caseValue };
      if (isEdit) {
        withCase.case_id = form.case_id === initialCaseId ? undefined : caseValue;
      }
      const data = isEdit
        ? await api<{ item: Item }>(`${endPoint}/${Number(editId)}`, {
            method: 'PATCH',
            body: JSON.stringify(withCase),
          })
        : await api<{ item: Item }>(endPoint, {
            method: 'POST',
            body: JSON.stringify(withCase),
          });
      navigate(`/inventar/detail?id=${data.item.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader
        title={isEdit ? 'Asset bearbeiten' : 'Neues Asset anlegen'}
        subtitle={isEdit ? `Bearbeiten von #${editId}` : 'Gerät oder Artikel erfassen'}
        backTo="/inventar"
        actions={
          <button
            className="btn"
            disabled={busy}
            onClick={() => void handleSubmit()}
          >
            {busy ? 'Speichert …' : isEdit ? 'Speichern' : 'Anlegen'}
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card form-card" style={{ maxWidth: 1080 }}>
        <div className="form-grid-2">
          <Field label="Typ">
            <select
              className="form-select"
              value={form.kind}
              disabled={isEdit}
              onChange={(e) => set('kind', e.target.value as ItemKind)}
            >
              <option value="geraet">Einzelgerät</option>
              <option value="artikel">Artikel / Verbrauchsmaterial</option>
            </select>
          </Field>

          <Field label="Name">
            <input
              className="form-input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              autoFocus
            />
          </Field>

          {form.kind === 'geraet' && (
            <Field label="Hersteller">
              <input
                className="form-input"
                value={form.manufacturer}
                onChange={(e) => set('manufacturer', e.target.value)}
              />
            </Field>
          )}

          {form.kind === 'geraet' && (
            <Field label="Modell">
              <input className="form-input" value={form.model} onChange={(e) => set('model', e.target.value)} />
            </Field>
          )}

          {form.kind === 'artikel' && (
            <Field label="Artikelnummer">
              <input
                className="form-input"
                value={form.article_number}
                onChange={(e) => set('article_number', e.target.value)}
              />
            </Field>
          )}

          <Field label="Kategorie">
            <select
              className="form-select"
              value={form.category_id}
              onChange={(e) => set('category_id', e.target.value)}
            >
              <option value="">– keine –</option>
              {categories.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Case" hint={isEdit ? 'Wird das Feld geändert, wird das Asset komplett in diesen Koffer verschoben.' : 'Zuweisung zu einem Koffer'}>
            <select
              className="form-select"
              value={form.case_id}
              onChange={(e) => set('case_id', e.target.value)}
            >
              <option value="">– kein Case –</option>
              {cases.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.code ? `${c.code} – ` : ''}{c.name}
                  {c.location_path ? ` (${c.location_path})` : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Lagerort" hint="Regal, Fach oder Bereich, in dem sich das Asset befindet">
            <select
              className="form-select"
              value={form.storage_location_id}
              onChange={(e) => set('storage_location_id', e.target.value)}
            >
              <option value="">– kein Lagerort –</option>
              {flattenLocations(locations).map((l) => (
                <option key={l.id} value={String(l.id)}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>

          {form.kind === 'geraet' ? (
            <>
              <Field label="Seriennummer">
                <input
                  className="form-input"
                  value={form.serial_number}
                  onChange={(e) => set('serial_number', e.target.value)}
                />
              </Field>
              <Field label="Inventarnummer" hint="Leer lassen → wird automatisch vergeben">
                <input
                  className="form-input"
                  value={form.inventory_number}
                  onChange={(e) => set('inventory_number', e.target.value)}
                />
              </Field>
              <Field label="Anzahl / Menge" hint="Gleiche Geräte können als Menge erfasst und z. B. 4/4 auf zwei Koffer verteilt werden">
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  value={form.quantity}
                  onChange={(e) => set('quantity', e.target.value)}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Bestand / Menge">
                <input
                  className="form-input"
                  type="number"
                  min={0}
                  value={form.quantity}
                  onChange={(e) => set('quantity', e.target.value)}
                />
              </Field>
              <Field label="Einheit">
                <input
                  className="form-input"
                  value={form.unit}
                  onChange={(e) => set('unit', e.target.value)}
                  placeholder="Stk, Rolle, Pack …"
                />
              </Field>
              <Field label="Mindestbestand">
                <input
                  className="form-input"
                  type="number"
                  min={0}
                  value={form.min_stock}
                  onChange={(e) => set('min_stock', e.target.value)}
                />
              </Field>
            </>
          )}

          <Field label="Status">
            <select
              className="form-select"
              value={form.status}
              onChange={(e) => set('status', e.target.value as DeviceStatus)}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {deviceStatusLabels[s]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Zustand">
            <select
              className="form-select"
              value={form.condition}
              onChange={(e) => set('condition', e.target.value)}
            >
              <option value="">– keine Angabe –</option>
              {conditionOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Kaufpreis (EUR)">
            <input
              className="form-input"
              type="number"
              step="0.01"
              min={0}
              value={form.purchase_price}
              onChange={(e) => set('purchase_price', e.target.value)}
            />
          </Field>

          <Field label="Kaufdatum">
            <input
              className="form-input"
              type="date"
              value={form.purchase_date}
              onChange={(e) => set('purchase_date', e.target.value)}
            />
          </Field>

          <Field label="Aktueller Wert (EUR)">
            <input
              className="form-input"
              type="number"
              step="0.01"
              min={0}
              value={form.current_value}
              onChange={(e) => set('current_value', e.target.value)}
            />
          </Field>

          <Field label="Garantie">
            <input
              className="form-input"
              value={form.warranty}
              onChange={(e) => set('warranty', e.target.value)}
              placeholder="z. B. 24 Monate, bis 12/2027"
            />
          </Field>

          <div className="form-span">
            <Field label="Beschreibung">
              <textarea
                className="form-textarea"
                rows={2}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>
          </div>

          {form.kind === 'geraet' && (
            <div className="form-span">
              <Field label="Technische Daten">
                <textarea
                  className="form-textarea"
                  rows={2}
                  value={form.technical_data}
                  onChange={(e) => set('technical_data', e.target.value)}
                />
              </Field>
            </div>
          )}

          {form.kind === 'geraet' && (
            <Field label="Anleitung (z. B. Thomann-Link)">
              <input
                className="form-input"
                value={form.manual_url}
                onChange={(e) => set('manual_url', e.target.value)}
                placeholder="https://www.thomann.de/..."
              />
            </Field>
          )}

          <div className="form-span">
            <Field label="Notizen">
              <textarea
                className="form-textarea"
                rows={2}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </Field>
          </div>
        </div>
      </div>
    </>
  );
}