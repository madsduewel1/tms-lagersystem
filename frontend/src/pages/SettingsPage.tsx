import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, apiUpload, ApiError, fileUrl } from '../api/client';
import { PageHeader, Alert, Field, Modal } from '../components/ui';
import { AuditLog } from '../components/AuditLog';
import { Icon } from '../components/Icon';
import type { Category, LabelFormat, PublicSettings } from '../types';

const tmsLogo = import.meta.env.BASE_URL + 'tms-logo.png';

type Tab = 'general' | 'labels' | 'logo' | 'categories' | 'audit';

const labelSettingKeys = [
  'label_margin_top',
  'label_margin_right',
  'label_margin_bottom',
  'label_margin_left',
  'label_gap_x',
  'label_gap_y',
  'label_distribute',
] as const;

interface SettingsState {
  system_name: string;
  warehouse_name: string;
  inventory_prefix: string;
  support_email: string;
  qr_base_url: string;
  label_format: string;
  label_margin_top: string;
  label_margin_right: string;
  label_margin_bottom: string;
  label_margin_left: string;
  label_gap_x: string;
  label_gap_y: string;
  label_distribute: string;
}

const defaults: SettingsState = {
  system_name: 'TMS Event-Technik Lager',
  warehouse_name: 'Techniklager',
  inventory_prefix: 'TMS-',
  support_email: '',
  qr_base_url: '',
  label_format: '62x29',
  label_margin_top: '8',
  label_margin_right: '8',
  label_margin_bottom: '8',
  label_margin_left: '8',
  label_gap_x: '2',
  label_gap_y: '2',
  label_distribute: '1',
};

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general');
  const [settings, setSettings] = useState<SettingsState>(defaults);
  const [formats, setFormats] = useState<LabelFormat[]>([]);
  const [publicInfo, setPublicInfo] = useState<PublicSettings>({
    system_name: '',
    logo_url: '',
    support_email: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [catBusy, setCatBusy] = useState(false);
  const [catModal, setCatModal] = useState<{ open: boolean; category: Category | null }>({
    open: false,
    category: null,
  });
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');

  const load = useCallback(async () => {
    try {
      const [data, fmtData, pubData, catData] = await Promise.all([
        api<{ settings: Record<string, string | null> }>('/api/settings'),
        api<{ formats: LabelFormat[] }>('/api/labels/formats'),
        api<PublicSettings>('/api/settings/public'),
        api<{ categories: Category[] }>('/api/categories'),
      ]);
      setSettings({
        system_name: data.settings.system_name ?? defaults.system_name,
        warehouse_name: data.settings.warehouse_name ?? defaults.warehouse_name,
        inventory_prefix: data.settings.inventory_prefix ?? defaults.inventory_prefix,
        support_email: data.settings.support_email ?? '',
        qr_base_url: data.settings.qr_base_url ?? '',
        label_format: data.settings.label_format ?? defaults.label_format,
        label_margin_top: data.settings.label_margin_top ?? defaults.label_margin_top,
        label_margin_right: data.settings.label_margin_right ?? defaults.label_margin_right,
        label_margin_bottom: data.settings.label_margin_bottom ?? defaults.label_margin_bottom,
        label_margin_left: data.settings.label_margin_left ?? defaults.label_margin_left,
        label_gap_x: data.settings.label_gap_x ?? defaults.label_gap_x,
        label_gap_y: data.settings.label_gap_y ?? defaults.label_gap_y,
        label_distribute: data.settings.label_distribute ?? defaults.label_distribute,
      });
      setFormats(fmtData.formats);
      setPublicInfo(pubData);
      setCategories(catData.categories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function flash(msg: string) {
    setSuccess(msg);
    window.setTimeout(() => setSuccess(''), 4000);
  }

  async function saveGeneral(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ settings: { ...settings } }),
      });
      flash('Einstellungen gespeichert');
      const pub = await api<PublicSettings>('/api/settings/public');
      setPublicInfo(pub);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    setError('');
    setBusy(true);
    try {
      const form = new FormData();
      form.append('logo', file);
      await apiUpload<{ logo_url: string }>('/api/settings/logo', form);
      flash('Logo hochgeladen');
      const pub = await api<PublicSettings>('/api/settings/public');
      setPublicInfo(pub);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setBusy(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  }

  function openCatModal(category: Category | null) {
    setCatModal({ open: true, category });
    setCatName(category?.name ?? '');
    setCatDesc(category?.description ?? '');
  }

  async function saveLabels(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const label: Record<string, string | null> = {};
      for (const key of labelSettingKeys) label[key] = settings[key] ?? null;
      await api('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ settings: label }),
      });
      flash('Etiketten-Layout gespeichert');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  async function saveCategory() {
    setError('');
    if (!catName.trim()) {
      setError('Bitte einen Namen angeben');
      return;
    }
    setCatBusy(true);
    try {
      const body = { name: catName.trim(), description: catDesc.trim() || null };
      if (catModal.category) {
        await api(`/api/categories/${catModal.category.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await api('/api/categories', { method: 'POST', body: JSON.stringify(body) });
      }
      setCatModal({ open: false, category: null });
      flash('Kategorie gespeichert');
      const catData = await api<{ categories: Category[] }>('/api/categories');
      setCategories(catData.categories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setCatBusy(false);
    }
  }

  async function deleteCategory(cat: Category) {
    setError('');
    if (!window.confirm(`Kategorie „${cat.name}“ wirklich löschen?`)) return;
    try {
      await api(`/api/categories/${cat.id}`, { method: 'DELETE' });
      flash('Kategorie gelöscht');
      const catData = await api<{ categories: Category[] }>('/api/categories');
      setCategories(catData.categories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen');
    }
  }

  const logoUrl = publicInfo.logo_url ? fileUrl(publicInfo.logo_url) : tmsLogo;

  return (
    <>
      <PageHeader title="Einstellungen" subtitle="System, Logo, Audit-Log und Kategorien verwalten" />

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      <div className="tabs">
        {(
          [
            ['general', 'Allgemein'],
            ['labels', 'Etiketten'],
            ['logo', 'Logo'],
            ['categories', 'Kategorien'],
            ['audit', 'Audit-Log'],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            className={`tab${tab === key ? ' active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="card form-card" style={{ maxWidth: 960 }}>
          <form onSubmit={saveGeneral}>
            <Field label="Systemname">
              <input
                className="form-input"
                value={settings.system_name}
                onChange={(e) => setSettings({ ...settings, system_name: e.target.value })}
                required
              />
            </Field>
            <Field label="Lagername">
              <input
                className="form-input"
                value={settings.warehouse_name}
                onChange={(e) => setSettings({ ...settings, warehouse_name: e.target.value })}
              />
            </Field>
            <Field label="Inventarnummer-Präfix">
              <input
                className="form-input"
                value={settings.inventory_prefix}
                onChange={(e) => setSettings({ ...settings, inventory_prefix: e.target.value })}
                placeholder="z. B. TMS-"
              />
              <div className="form-hint">Neue Inventarnummern sehen so aus: {settings.inventory_prefix || 'TMS-'}AUD-0042</div>
            </Field>
            <Field label="Support-Kontakt (E-Mail)">
              <input
                className="form-input"
                type="email"
                value={settings.support_email}
                onChange={(e) => setSettings({ ...settings, support_email: e.target.value })}
                placeholder="mats.duevil@example.org"
              />
              <div className="form-hint">Wird auf der Login-Seite angezeigt. Leer lassen, wenn kein Kontakt gewünscht.</div>
            </Field>
            <Field label="QR-Code-Basis-URL" hint="Leer lassen → automatisch aus der Adresse dieser Installation abgeleitet.">
              <input
                className="form-input"
                value={settings.qr_base_url}
                onChange={(e) => setSettings({ ...settings, qr_base_url: e.target.value })}
                placeholder="https://tms.example.org/lagersystem"
              />
            </Field>
            <Field label="Standard-Labelformat">
              <select
                className="form-select"
                value={settings.label_format}
                onChange={(e) => setSettings({ ...settings, label_format: e.target.value })}
              >
                {formats.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Speichern
            </button>
          </form>
        </div>
      )}

      {tab === 'labels' && (
        <div className="card form-card" style={{ maxWidth: 960 }}>
          <form onSubmit={saveLabels}>
            <h2 className="section-title">Layout auf dem Papier (A4)</h2>
            <p className="form-hint" style={{ marginBottom: 16 }}>
              Legt fest, wie sich die Labels auf der Seite verhalten. Alle Angaben in Millimetern.
            </p>
            <Field label="Abstand zum Seitenrand">
              <div className="form-grid-2">
                <Field label="Oben">
                  <input
                    className="form-input"
                    type="number"
                    min={0}
                    step="0.5"
                    value={settings.label_margin_top}
                    onChange={(e) => setSettings({ ...settings, label_margin_top: e.target.value })}
                  />
                </Field>
                <Field label="Rechts">
                  <input
                    className="form-input"
                    type="number"
                    min={0}
                    step="0.5"
                    value={settings.label_margin_right}
                    onChange={(e) => setSettings({ ...settings, label_margin_right: e.target.value })}
                  />
                </Field>
                <Field label="Unten">
                  <input
                    className="form-input"
                    type="number"
                    min={0}
                    step="0.5"
                    value={settings.label_margin_bottom}
                    onChange={(e) => setSettings({ ...settings, label_margin_bottom: e.target.value })}
                  />
                </Field>
                <Field label="Links">
                  <input
                    className="form-input"
                    type="number"
                    min={0}
                    step="0.5"
                    value={settings.label_margin_left}
                    onChange={(e) => setSettings({ ...settings, label_margin_left: e.target.value })}
                  />
                </Field>
              </div>
            </Field>
            <Field label="Verteilung auf der Seite">
              <select
                className="form-select"
                value={settings.label_distribute}
                onChange={(e) => setSettings({ ...settings, label_distribute: e.target.value })}
              >
                <option value="1">Gleichmäßig verteilen (füllt die Seite)</option>
                <option value="0">Fester Abstand, oben links ausrichten</option>
              </select>
              <div className="form-hint">
                „Gleichmäßig verteilen“ nutzt den freien Platz als Abstand zwischen den Labels.
                „Fester Abstand“ platziert die Labels mit dem folgenden Abstand, beginnend oben links,
                alles bleibt innerhalb der Ränder.
              </div>
            </Field>
            <Field label="Abstand zwischen den Labels">
              <div className="form-grid-2">
                <Field label="Horizontal">
                  <input
                    className="form-input"
                    type="number"
                    min={0}
                    step="0.5"
                    disabled={settings.label_distribute === '1'}
                    value={settings.label_gap_x}
                    onChange={(e) => setSettings({ ...settings, label_gap_x: e.target.value })}
                  />
                </Field>
                <Field label="Vertikal">
                  <input
                    className="form-input"
                    type="number"
                    min={0}
                    step="0.5"
                    disabled={settings.label_distribute === '1'}
                    value={settings.label_gap_y}
                    onChange={(e) => setSettings({ ...settings, label_gap_y: e.target.value })}
                  />
                </Field>
              </div>
            </Field>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Speichern
            </button>
          </form>
        </div>
      )}

      {tab === 'logo' && (
        <div className="card form-card" style={{ maxWidth: 860 }}>
          <h2 className="section-title">Logo</h2>
          <div className="logo-preview">
            <img src={logoUrl} alt="Logo" className="logo-preview-img" />
          </div>
          <p className="form-hint" style={{ marginBottom: 16 }}>
            Das Logo wird auf Etiketten und der Anmeldeseite angezeigt. Unterstützt werden PNG, JPG und SVG (max. 4&nbsp;MB).
          </p>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadLogo(file);
            }}
          />
        </div>
      )}

      {tab === 'categories' && (
        <div className="card form-card" style={{ maxWidth: 960 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 className="section-title">Kategorien ({categories.length})</h2>
            <button className="btn btn-primary" onClick={() => openCatModal(null)}>
              <Icon name="plus" size={16} />
              Neue Kategorie
            </button>
          </div>
          {categories.length === 0 ? (
            <p className="empty-row">Noch keine Kategorien angelegt.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Beschreibung</th>
                    <th>Assets</th>
                    <th>Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.id}>
                      <td><strong>{c.name}</strong></td>
                      <td>{c.description ?? '–'}</td>
                      <td>{c.item_count}</td>
                      <td>
                        <div className="row-actions">
                          <button className="icon-btn" title="Bearbeiten" onClick={() => openCatModal(c)}>
                            <Icon name="edit" size={16} />
                          </button>
                          <button className="icon-btn danger" title="Löschen" onClick={() => void deleteCategory(c)}>
                            <Icon name="trash" size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'audit' && <AuditLog />}

      {catModal.open && (
        <Modal
          title={catModal.category ? 'Kategorie bearbeiten' : 'Neue Kategorie'}
          onClose={() => setCatModal({ open: false, category: null })}
        >
          <Field label="Name">
            <input className="form-input" value={catName} onChange={(e) => setCatName(e.target.value)} />
          </Field>
          <Field label="Beschreibung">
            <textarea
              className="form-textarea"
              rows={3}
              value={catDesc}
              onChange={(e) => setCatDesc(e.target.value)}
            />
          </Field>
          <div className="modal-actions">
            <button className="btn" onClick={() => setCatModal({ open: false, category: null })}>
              Abbrechen
            </button>
            <button className="btn btn-primary" disabled={catBusy} onClick={() => void saveCategory()}>
              Speichern
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}