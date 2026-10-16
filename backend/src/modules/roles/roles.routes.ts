import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requirePermission, requireAnyPermission } from '../../middleware/auth.js';
import { validate, HttpError } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, parseId } from '../../utils/helpers.js';

interface RoleRow {
  id: number;
  name: string;
  label: string;
  description: string | null;
  is_system: number;
  sort: number;
  user_count: number;
}

interface PermissionRow {
  id: number;
  code: string;
  label: string;
  category: string;
  sort: number;
}

async function loadRolesWithPermissions(): Promise<
  Array<RoleRow & { permissions: string[]; assignable_role_ids: number[] }>
> {
  const [roleRows] = await pool.query(
    `SELECT r.id, r.name, r.label, r.description, r.is_system, r.sort,
            (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count
     FROM roles r
     ORDER BY r.sort ASC, r.label ASC`
  );
  const roles = roleRows as RoleRow[];

  const [permRows] = await pool.query(
    `SELECT rp.role_id, p.code
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id`
  );
  const byRole = new Map<number, string[]>();
  for (const row of permRows as Array<{ role_id: number; code: string }>) {
    const list = byRole.get(row.role_id) ?? [];
    list.push(row.code);
    byRole.set(row.role_id, list);
  }

  const [assignRows] = await pool.query(
    `SELECT role_id, assignable_role_id FROM role_assignable_roles`
  );
  const assignable = new Map<number, number[]>();
  for (const row of assignRows as Array<{ role_id: number; assignable_role_id: number }>) {
    const list = assignable.get(row.role_id) ?? [];
    list.push(row.assignable_role_id);
    assignable.set(row.role_id, list);
  }

  return roles.map((role) => ({
    ...role,
    permissions: byRole.get(role.id) ?? [],
    assignable_role_ids: assignable.get(role.id) ?? [],
  }));
}

const assignableRoleIdsSchema = z.array(z.coerce.number().int().positive());

const roleSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z][a-z0-9._-]*$/, 'Nur Kleinbuchstaben, Ziffern, Punkt, Bindestrich, Unterstrich'),
  label: z.string().min(1).max(64),
  description: z.string().max(255).nullable().optional(),
  permissions: z.array(z.string().min(1).max(64)).optional(),
  assignableRoleIds: assignableRoleIdsSchema.optional(),
});

const updateSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z][a-z0-9._-]*$/, 'Nur Kleinbuchstaben, Ziffern, Punkt, Bindestrich, Unterstrich')
    .optional(),
  label: z.string().min(1).max(64).optional(),
  description: z.string().max(255).nullable().optional(),
  permissions: z.array(z.string().min(1).max(64)).optional(),
  assignableRoleIds: assignableRoleIdsSchema.optional(),
});

async function assertPermissionCodes(codes: string[]): Promise<void> {
  if (codes.length === 0) return;
  const [rows] = await pool.query('SELECT code FROM permissions WHERE code IN (?)', [codes]);
  const found = new Set((rows as Array<{ code: string }>).map((r) => r.code));
  const unknown = codes.filter((c) => !found.has(c));
  if (unknown.length > 0) {
    throw new HttpError(400, `Unbekannte Rechte: ${unknown.join(', ')}`);
  }
}

async function setRolePermissions(roleId: number, codes: string[]): Promise<void> {
  await assertPermissionCodes(codes);
  await pool.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
  if (codes.length > 0) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT ?, id FROM permissions WHERE code IN (?)`,
      [roleId, codes]
    );
  }
}

/** Administrator besitzt immer alle Rechte – die Zuordnung ist nicht reduzierbar. */
async function grantAllPermissions(roleId: number): Promise<void> {
  await pool.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT ?, id FROM permissions`,
    [roleId]
  );
}

/** Wirft 400, wenn eine der angegebenen Rollen-IDs nicht existiert. */
async function assertRolesExist(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const [rows] = await pool.query('SELECT id FROM roles WHERE id IN (?)', [ids]);
  const found = new Set((rows as Array<{ id: number }>).map((r) => r.id));
  if (ids.some((id) => !found.has(id))) {
    throw new HttpError(400, 'Unbekannte Rolle');
  }
}

/** Setzt, welche Rollen der Inhaber dieser Rolle vergeben darf. */
async function setAssignableRoles(roleId: number, roleIds: number[]): Promise<void> {
  await assertRolesExist(roleIds);
  await pool.query('DELETE FROM role_assignable_roles WHERE role_id = ?', [roleId]);
  if (roleIds.length === 0) return;
  await pool.query(
    `INSERT INTO role_assignable_roles (role_id, assignable_role_id) VALUES ?`,
    [roleIds.map((id) => [roleId, id])]
  );
}

/** Administrator darf immer alle Rollen vergeben – die Zuordnung ist nicht reduzierbar. */
async function grantAllAssignableRoles(roleId: number): Promise<void> {
  await pool.query('DELETE FROM role_assignable_roles WHERE role_id = ?', [roleId]);
  await pool.query(
    `INSERT INTO role_assignable_roles (role_id, assignable_role_id)
     SELECT ?, id FROM roles`,
    [roleId]
  );
}

// ---------------------------------------------------------------------------
// Rechte-Katalog (schreibgeschützt)
// ---------------------------------------------------------------------------

export const permissionsRouter = Router();
permissionsRouter.use(requireAuth, requirePermission('roles.manage'));

permissionsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query(
      'SELECT id, code, label, category, sort FROM permissions ORDER BY sort ASC, code ASC'
    );
    res.json({ permissions: rows as PermissionRow[] });
  })
);

// ---------------------------------------------------------------------------
// Rollenverwaltung
// ---------------------------------------------------------------------------

export const rolesRouter = Router();
rolesRouter.use(requireAuth);

// Liste ist auch für die Benutzerverwaltung nötig (Rollen-Auswahl).
rolesRouter.get(
  '/',
  requireAnyPermission('roles.manage', 'users.manage'),
  asyncHandler(async (_req, res) => {
    res.json({ roles: await loadRolesWithPermissions() });
  })
);

rolesRouter.post(
  '/',
  requirePermission('roles.manage'),
  validate(roleSchema),
  asyncHandler(async (req, res) => {
    const { name, label, description, permissions, assignableRoleIds } =
      req.body as z.infer<typeof roleSchema>;

    const [existing] = await pool.query('SELECT id FROM roles WHERE name = ?', [name]);
    if ((existing as Array<{ id: number }>).length > 0) {
      throw new HttpError(409, `Eine Rolle mit dem Namen „${name}“ existiert bereits`);
    }

    // Vor dem Anlegen prüfen, damit kein Teil-Datensatz entsteht.
    if (permissions) await assertPermissionCodes(permissions);

    const [maxRows] = await pool.query('SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM roles');
    const nextSort = Number((maxRows as Array<{ next: number }>)[0]?.next ?? 100);

    const [result] = await pool.query(
      'INSERT INTO roles (name, label, description, is_system, sort) VALUES (?, ?, ?, 0, ?)',
      [name, label, description ?? null, nextSort]
    );
    const id = Number((result as { insertId: number }).insertId);
    if (permissions) await setRolePermissions(id, permissions);
    if (assignableRoleIds !== undefined) {
      await setAssignableRoles(id, assignableRoleIds);
    } else {
      // Standard: alle Rollen außer der Administratorrolle.
      await pool.query(
        `INSERT INTO role_assignable_roles (role_id, assignable_role_id)
         SELECT ?, id FROM roles WHERE name <> 'administrator'`,
        [id]
      );
    }

    await writeAudit({
      userId: req.user!.id,
      action: 'role_created',
      targetType: 'role',
      targetId: String(id),
      details: { name, label },
      ip: req.ip,
    });
    res.status(201).json({ id });
  })
);

rolesRouter.patch(
  '/:id',
  requirePermission('roles.manage'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = req.body as z.infer<typeof updateSchema>;

    const [rows] = await pool.query('SELECT id, name, is_system FROM roles WHERE id = ?', [id]);
    const role = (rows as Array<{ id: number; name: string; is_system: number }>)[0];
    if (!role) throw new HttpError(404, 'Rolle nicht gefunden');

    // Rechte vor jeder Änderung validieren, damit kein Teil-Update entsteht.
    if (body.permissions !== undefined && role.name !== 'administrator') {
      await assertPermissionCodes(body.permissions);
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined && body.name !== role.name) {
      const [dup] = await pool.query('SELECT id FROM roles WHERE name = ? AND id <> ?', [body.name, id]);
      if ((dup as Array<{ id: number }>).length > 0) {
        throw new HttpError(409, `Eine Rolle mit dem Namen „${body.name}“ existiert bereits`);
      }
      fields.push('name = ?');
      values.push(body.name);
    }
    if (body.label !== undefined) {
      fields.push('label = ?');
      values.push(body.label);
    }
    if (body.description !== undefined) {
      fields.push('description = ?');
      values.push(body.description === '' ? null : body.description);
    }
    if (fields.length > 0) {
      values.push(id);
      await pool.query(`UPDATE roles SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    if (body.permissions !== undefined) {
      // Der Administrator behält immer sämtliche Rechte.
      if (role.name === 'administrator') {
        await grantAllPermissions(id);
      } else {
        await setRolePermissions(id, body.permissions);
      }
    }

    if (body.assignableRoleIds !== undefined) {
      if (role.name === 'administrator') {
        // Der Administrator darf immer alle Rollen vergeben.
        await grantAllAssignableRoles(id);
      } else {
        await setAssignableRoles(id, body.assignableRoleIds);
      }
    }

    await writeAudit({
      userId: req.user!.id,
      action: 'role_updated',
      targetType: 'role',
      targetId: String(id),
      details: { name: body.name, label: body.label, permissionCount: body.permissions?.length },
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);

rolesRouter.delete(
  '/:id',
  requirePermission('roles.manage'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query('SELECT id, name, is_system FROM roles WHERE id = ?', [id]);
    const role = (rows as Array<{ id: number; name: string; is_system: number }>)[0];
    if (!role) throw new HttpError(404, 'Rolle nicht gefunden');
    if (role.is_system) {
      throw new HttpError(400, 'Systemrollen können nicht gelöscht werden');
    }
    const [used] = await pool.query('SELECT COUNT(*) AS total FROM user_roles WHERE role_id = ?', [id]);
    if (Number((used as Array<{ total: number }>)[0]?.total ?? 0) > 0) {
      throw new HttpError(400, 'Diese Rolle ist noch Benutzern zugewiesen und kann nicht gelöscht werden');
    }
    await pool.query('DELETE FROM roles WHERE id = ?', [id]);
    await writeAudit({
      userId: req.user!.id,
      action: 'role_deleted',
      targetType: 'role',
      targetId: String(id),
      details: { name: role.name },
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);
