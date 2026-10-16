import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { Alert, Field } from './ui';
import { Icon } from './Icon';
import type { Permission, Role } from '../types';

interface Draft {
  name: string;
  label: string;
  description: string;
  permissions: Set<string>;
  assignable: Set<number>;
}

const emptyDraft: Draft = {
  name: '',
  label: '',
  description: '',
  permissions: new Set(),
  assignable: new Set(),
};

export function RolesPermissions() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [view, setView] = useState<'rollen' | 'rechte'>('rollen');

  const load = useCallback(async () => {
    try {
      const [roleData, permData] = await Promise.all([
        api<{ roles: Role[] }>('/api/roles'),
        api<{ permissions: Permission[] }>('/api/permissions'),
      ]);
      setRoles(roleData.roles);
      setPermissions(permData.permissions);
      setSelectedId((current) => {
        if (current === 'new') return current;
        if (current != null && roleData.roles.some((r) => r.id === current)) return current;
        return roleData.roles[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => (typeof selectedId === 'number' ? roles.find((r) => r.id === selectedId) ?? null : null),
    [roles, selectedId]
  );
  const isAdminRole = selected?.name === 'administrator';
  const isNew = selectedId === 'new';

  // Entwurf neu befüllen, wenn sich die Auswahl oder die geladenen Rollen ändern.
  useEffect(() => {
    if (isNew) {
      // Standard für neue Rollen: alle Rollen außer dem Administrator vergeben.
      setDraft({
        ...emptyDraft,
        permissions: new Set(),
        assignable: new Set(roles.filter((r) => r.name !== 'administrator').map((r) => r.id)),
      });
    } else if (selected) {
      setDraft({
        name: selected.name,
        label: selected.label,
        description: selected.description ?? '',
        permissions: new Set(selected.permissions),
        assignable: new Set(selected.assignable_role_ids),
      });
    }
  }, [selectedId, selected, isNew, roles]);

  const permissionGroups = useMemo(() => {
    const groups = new Map<string, Permission[]>();
    for (const perm of permissions) {
      const list = groups.get(perm.category) ?? [];
      list.push(perm);
      groups.set(perm.category, list);
    }
    return Array.from(groups.entries());
  }, [permissions]);

  const rolesByCode = useMemo(() => {
    const map = new Map<string, Role[]>();
    for (const role of roles) {
      for (const code of role.permissions) {
        const list = map.get(code) ?? [];
        list.push(role);
        map.set(code, list);
      }
    }
    return map;
  }, [roles]);

  function flash(msg: string) {
    setSuccess(msg);
    window.setTimeout(() => setSuccess(''), 4000);
  }

  function togglePermission(code: string) {
    setDraft((prev) => {
      const next = new Set(prev.permissions);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return { ...prev, permissions: next };
    });
  }

  function toggleCategory(codes: string[], checked: boolean) {
    setDraft((prev) => {
      const next = new Set(prev.permissions);
      for (const code of codes) {
        if (checked) next.add(code);
        else next.delete(code);
      }
      return { ...prev, permissions: next };
    });
  }

  function toggleAssignable(roleId: number) {
    setDraft((prev) => {
      const next = new Set(prev.assignable);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return { ...prev, assignable: next };
    });
  }

  async function save() {
    setError('');
    if (!draft.name.trim() || !draft.label.trim()) {
      setError('Name und Bezeichnung sind erforderlich');
      return;
    }
    setBusy(true);
    try {
      if (isNew) {
        await api<{ id: number }>('/api/roles', {
          method: 'POST',
          body: JSON.stringify({
            name: draft.name.trim(),
            label: draft.label.trim(),
            description: draft.description.trim() || null,
            permissions: Array.from(draft.permissions),
            assignableRoleIds: Array.from(draft.assignable),
          }),
        });
        flash('Rolle angelegt');
      } else if (selected) {
        await api(`/api/roles/${selected.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: isAdminRole ? undefined : draft.name.trim(),
            label: draft.label.trim(),
            description: draft.description.trim() || null,
            permissions: Array.from(draft.permissions),
            assignableRoleIds: isAdminRole ? undefined : Array.from(draft.assignable),
          }),
        });
        flash('Rolle gespeichert');
      }
      await load();
      if (isNew) setSelectedId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected || selected.is_system) return;
    if (!window.confirm(`Rolle „${selected.label}“ wirklich löschen?`)) return;
    setError('');
    setBusy(true);
    try {
      await api(`/api/roles/${selected.id}`, { method: 'DELETE' });
      flash('Rolle gelöscht');
      setSelectedId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="form-hint">Rollen werden geladen …</p>;

  return (
    <>
      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      <div className="subtabs">
        <button
          className={`subtab${view === 'rollen' ? ' active' : ''}`}
          onClick={() => setView('rollen')}
        >
          Rollen
        </button>
        <button
          className={`subtab${view === 'rechte' ? ' active' : ''}`}
          onClick={() => setView('rechte')}
        >
          Rechte
        </button>
      </div>

      {view === 'rechte' ? (
        <div className="permission-catalog">
          {permissionGroups.map(([category, perms]) => (
            <div key={category} className="card permission-group">
              <h3 className="section-title" style={{ marginTop: 0 }}>{category}</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Recht</th>
                      <th>Code</th>
                      <th>Rollen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perms.map((perm) => {
                      const holders = rolesByCode.get(perm.code) ?? [];
                      return (
                        <tr key={perm.code}>
                          <td><strong>{perm.label}</strong></td>
                          <td><span className="mono cell-sub">{perm.code}</span></td>
                          <td>
                            {holders.length === 0 ? (
                              <span className="badge badge-muted">keine</span>
                            ) : (
                              <span>{holders.map((r) => r.label).join(', ')}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="roles-layout">
        <aside className="card role-list">
          <div className="role-list-head">
            <h2 className="section-title" style={{ margin: 0 }}>Rollen</h2>
            <button
              className="btn btn-sm"
              onClick={() => setSelectedId('new')}
              title="Neue Rolle anlegen"
            >
              <Icon name="plus" size={15} />
              Neu
            </button>
          </div>
          {isNew && (
            <button className="role-item active" onClick={() => setSelectedId('new')}>
              <span className="role-item-body">
                <strong>Neue Rolle</strong>
                <span className="cell-sub">noch nicht gespeichert</span>
              </span>
            </button>
          )}
          {roles.map((role) => (
            <button
              key={role.id}
              className={`role-item${selectedId === role.id ? ' active' : ''}`}
              onClick={() => setSelectedId(role.id)}
            >
              <span className="role-item-body">
                <strong>{role.label}</strong>
                <span className="cell-sub">
                  {role.name} · {role.user_count} {role.user_count === 1 ? 'Benutzer' : 'Benutzer'}
                </span>
              </span>
              {role.is_system ? <Icon name="lock" size={14} /> : null}
            </button>
          ))}
        </aside>

        <section className="card role-editor">
          {selectedId == null ? (
            <p className="empty-row">Rolle auswählen oder eine neue anlegen.</p>
          ) : (
            <>
              <div className="role-editor-head">
                <h2 className="section-title" style={{ margin: 0 }}>
                  {isNew ? 'Neue Rolle' : `Rolle: ${selected?.label}`}
                </h2>
                {!isNew && !selected?.is_system && (
                  <button className="btn btn-danger btn-sm" onClick={() => void remove()} disabled={busy}>
                    <Icon name="trash" size={15} />
                    Löschen
                  </button>
                )}
              </div>

              <Field label="Bezeichnung">
                <input
                  className="form-input"
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  placeholder="z. B. Lagerleitung"
                />
              </Field>
              <Field label="Technischer Name" hint={isAdminRole || selected?.is_system ? 'Systemrollen können nicht umbenannt werden.' : 'Nur Kleinbuchstaben, Ziffern, Punkt, Bindestrich, Unterstrich.'}>
                <input
                  className="form-input"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  disabled={isNew ? false : Boolean(selected?.is_system)}
                  placeholder="z. B. lagerleitung"
                />
              </Field>
              <Field label="Beschreibung (optional)">
                <input
                  className="form-input"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </Field>

              <h3 className="section-title" style={{ marginTop: 8 }}>Rechte</h3>
              {isAdminRole && (
                <p className="form-hint" style={{ marginBottom: 12 }}>
                  Der Administrator besitzt immer alle Rechte.
                </p>
              )}
              <div className="permission-groups">
                {permissionGroups.map(([category, perms]) => {
                  const codes = perms.map((p) => p.code);
                  const allChecked =
                    isAdminRole || codes.every((code) => draft.permissions.has(code));
                  return (
                    <div key={category} className="permission-group">
                      <label className="permission-group-head">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          disabled={isAdminRole}
                          onChange={(e) => toggleCategory(codes, e.target.checked)}
                        />
                        <strong>{category}</strong>
                      </label>
                      <div className="permission-items">
                        {perms.map((perm) => (
                          <label key={perm.code} className="permission-item">
                            <input
                              type="checkbox"
                              checked={isAdminRole || draft.permissions.has(perm.code)}
                              disabled={isAdminRole}
                              onChange={() => togglePermission(perm.code)}
                            />
                            <span>{perm.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <h3 className="section-title" style={{ marginTop: 20 }}>Vergebbare Rollen</h3>
              {isAdminRole ? (
                <p className="form-hint" style={{ marginBottom: 12 }}>
                  Der Administrator darf immer alle Rollen vergeben.
                </p>
              ) : (
                <>
                  <p className="form-hint" style={{ marginBottom: 12 }}>
                    Nur diese Rollen darf ein Benutzer mit dieser Rolle an andere Benutzer
                    vergeben. Die Administratorrolle lässt sich hier nicht vergeben.
                  </p>
                  <div className="permission-items">
                    {roles
                      .filter((r) => r.name !== 'administrator')
                      .map((r) => (
                        <label key={r.id} className="permission-item">
                          <input
                            type="checkbox"
                            checked={draft.assignable.has(r.id)}
                            onChange={() => toggleAssignable(r.id)}
                          />
                          <span>{r.label}</span>
                        </label>
                      ))}
                  </div>
                </>
              )}

              <div className="page-actions" style={{ marginTop: 16 }}>
                <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
                  {busy ? 'Speichern …' : isNew ? 'Rolle anlegen' : 'Speichern'}
                </button>
                {isNew && (
                  <button className="btn" onClick={() => setSelectedId(null)} disabled={busy}>
                    Abbrechen
                  </button>
                )}
              </div>
            </>
          )}
        </section>
        </div>
      )}
    </>
  );
}

export default RolesPermissions;
