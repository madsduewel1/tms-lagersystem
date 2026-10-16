import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { validate, HttpError } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import type { AuthedUser, RoleRef } from '../../types/index.js';

const roleIdsSchema = z
  .array(z.coerce.number().int().positive())
  .min(1, 'Mindestens eine Rolle erforderlich');

const createSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'Ungültiger Benutzername'),
  name: z.string().min(1).max(128),
  email: z.string().email('Ungültige E-Mail-Adresse').max(160).nullable().optional(),
  password: z.string().min(1).max(256).optional(),
  roleIds: roleIdsSchema,
});

const updateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  email: z.string().email('Ungültige E-Mail-Adresse').max(160).nullable().optional(),
  roleIds: roleIdsSchema.optional(),
  active: z.boolean().optional(),
  must_change_password: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(1).max(256).optional(),
});

const bulkResetSchema = z.object({
  userIds: z.array(z.coerce.number().int().positive()).min(1).max(500),
});

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  name: string;
  roles: RoleRef[];
  active: number;
  must_change_password: number;
  last_login_at: Date | null;
  created_at: Date;
}

type UserReferenceEffect = 'entfernt' | 'ohne_zuordnung';

interface UserReference {
  key: string;
  count: number;
  effect: UserReferenceEffect;
}

/**
 * Temporäres Passwort. Bewusst ohne verwechselbare Zeichen und deutlich länger
 * als die früheren 6 Ziffern (900.000 Kombinationen waren ohne Rate-Limit auf
 * dem Passwort-Endpoint praktisch brute-forcbar).
 */
export function genTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/** Wirft 400, wenn eine der angegebenen Rollen nicht existiert. */
async function assertRolesExist(ids: number[]): Promise<void> {
  if (ids.length === 0) throw new HttpError(400, 'Mindestens eine Rolle erforderlich');
  const [rows] = await pool.query('SELECT id FROM roles WHERE id IN (?)', [ids]);
  const found = new Set((rows as Array<{ id: number }>).map((r) => r.id));
  if (ids.some((id) => !found.has(id))) {
    throw new HttpError(400, 'Unbekannte Rolle');
  }
}

/** Rollen mehrerer Benutzer in einer Abfrage laden. */
async function rolesForUsers(userIds: number[]): Promise<Map<number, RoleRef[]>> {
  const map = new Map<number, RoleRef[]>();
  if (userIds.length === 0) return map;
  const [rows] = await pool.query(
    `SELECT ur.user_id, r.id, r.name, r.label
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id IN (?)
     ORDER BY r.sort, r.name`,
    [userIds]
  );
  for (const row of rows as Array<{ user_id: number; id: number; name: string; label: string }>) {
    const list = map.get(row.user_id) ?? [];
    list.push({ id: row.id, name: row.name, label: row.label });
    map.set(row.user_id, list);
  }
  return map;
}

/** Ersetzt die Rollenzuordnung eines Benutzers vollständig. */
async function replaceUserRoles(userId: number, roleIds: number[]): Promise<void> {
  await pool.query('DELETE FROM user_roles WHERE user_id = ?', [userId]);
  if (roleIds.length === 0) return;
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ?', [
    roleIds.map((roleId) => [userId, roleId]),
  ]);
}

/**
 * Rollen-IDs, die der handelnde Benutzer vergeben darf.
 *
 * Administratoren dürfen alle Rollen vergeben. Alle anderen dürfen nur die
 * Rollen zuweisen, die bei ihren eigenen Rollen als "vergebbar" hinterlegt
 * sind – die Administratorrolle ist dabei grundsätzlich ausgenommen, damit
 * sich niemand selbst zum Administrator machen kann.
 */
async function assignableRoleIdsFor(user: AuthedUser): Promise<Set<number>> {
  if (user.isAdmin) {
    const [all] = await pool.query('SELECT id FROM roles');
    return new Set((all as Array<{ id: number }>).map((r) => r.id));
  }
  const [rows] = await pool.query(
    `SELECT DISTINCT rar.assignable_role_id AS id
     FROM user_roles ur
     JOIN role_assignable_roles rar ON rar.role_id = ur.role_id
     JOIN roles r ON r.id = rar.assignable_role_id
     WHERE ur.user_id = ? AND r.name <> 'administrator'`,
    [user.id]
  );
  return new Set((rows as Array<{ id: number }>).map((r) => r.id));
}

/** Liste der Rollen, die der handelnde Benutzer vergeben darf. */
async function assignableRolesFor(user: AuthedUser): Promise<RoleRef[]> {
  const [rows] = await pool.query(
    `SELECT id, name, label FROM roles ORDER BY sort ASC, label ASC`
  );
  const roles = rows as RoleRef[];
  if (user.isAdmin) return roles;
  const allowed = await assignableRoleIdsFor(user);
  return roles.filter((r) => allowed.has(r.id));
}


// ---------------------------------------------------------------------------
// Öffentlicher (angemeldeter) Zugriff: kompakte Benutzerliste für z. B.
// die Auswahl von Event-Bearbeitern. Keine Admin-Rechte nötig.
// ---------------------------------------------------------------------------
export const usersOptionsRouter = Router();

usersOptionsRouter.use(requireAuth);

usersOptionsRouter.get('/options', async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, username, name FROM users WHERE active = 1 ORDER BY name ASC`
    );
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Admin-Verwaltung
// ---------------------------------------------------------------------------
export const usersRouter = Router();

usersRouter.use(requireAuth, requirePermission('users.manage'));

usersRouter.get('/', async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.email, u.name, u.active, u.must_change_password,
              u.last_login_at, u.created_at
       FROM users u
       ORDER BY u.name ASC`
    );
    const base = rows as Array<Omit<UserRow, 'roles'>>;
    const rolesMap = await rolesForUsers(base.map((u) => u.id));
    res.json({
      users: base.map((u) => {
        const roles = rolesMap.get(u.id) ?? [];
        return { ...u, roles, isAdmin: roles.some((r) => r.name === 'administrator') };
      }),
    });
  } catch (err) {
    next(err);
  }
});

usersRouter.get('/assignable-roles', async (req, res, next) => {
  try {
    res.json({ roles: await assignableRolesFor(req.user!) });
  } catch (err) {
    next(err);
  }
});

usersRouter.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const { username, name, email, password, roleIds } = req.body as {
      username: string;
      name: string;
      email?: string | null;
      password?: string;
      roleIds: number[];
    };
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE username = ? OR (email IS NOT NULL AND email = ?)',
      [username, email ?? '']
    );
    if ((existing as Array<{ id: number }>).length > 0) {
      throw new HttpError(409, 'Benutzername oder E-Mail ist bereits vergeben');
    }
    await assertRolesExist(roleIds);
    const allowed = await assignableRoleIdsFor(req.user!);
    if (roleIds.some((roleId) => !allowed.has(roleId))) {
      throw new HttpError(400, 'Du darfst nicht alle dieser Rollen vergeben');
    }
    const tempPassword = genTempPassword();
    const hash = await bcrypt.hash(password ?? tempPassword, 12);
    const [result] = await pool.query(
      `INSERT INTO users (username, name, email, password_hash, must_change_password)
       VALUES (?, ?, ?, ?, 1)`,
      [username, name, email ?? null, hash]
    );
    const userId = Number((result as { insertId: number }).insertId);
    await replaceUserRoles(userId, roleIds);
    await writeAudit({
      userId: req.user!.id,
      action: 'user_created',
      targetType: 'user',
      targetId: String(userId),
      // Klartext-Passwörter gehören nicht ins Audit-Log: der Eintrag ist für
      // jeden Administrator dauerhaft lesbar. Der Wert geht nur an den
      // anlegenden Admin zurück.
      details: { username, roleIds, temporaryPasswordIssued: !password },
      ip: req.ip,
    });

    res.status(201).json({ id: userId, tempPassword });
  } catch (err) {
    next(err);
  }
});

usersRouter.post('/reset', validate(bulkResetSchema), async (req, res, next) => {
  try {
    const { userIds } = req.body as { userIds: number[] };
    const results: Array<{ id: number; username: string; name: string; tempPassword: string }> = [];
    for (const id of userIds) {
      const target = await reqUserRow(id);
      if (!target) continue;
      const tempPassword = genTempPassword();
      const hash = await bcrypt.hash(tempPassword, 12);
      await pool.query(
        'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
        [hash, id]
      );
      results.push({ id, username: target.username, name: target.name, tempPassword });
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'user_password_bulk_reset',
      targetType: 'user',
      targetId: results.map((r) => r.id).join(','),
      details: { count: results.length },
      ip: req.ip,
    });
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

usersRouter.patch('/:id', validate(updateSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'Ungültige Benutzer-ID');
    const target = await reqUserRow(id);
    if (!target) throw new HttpError(404, 'Benutzer nicht gefunden');

    const body = req.body as {
      name?: string;
      email?: string | null;
      roleIds?: number[];
      active?: boolean;
      must_change_password?: boolean;
    };

    if (id === req.user!.id && body.active === false) {
      throw new HttpError(400, 'Du kannst dich nicht selbst deaktivieren');
    }
    // Rollenänderungen sind erlaubt – auch am eigenen Konto –, aber nur im
    // Rahmen der vergebbaren Rollen. Die Administratorrolle ist für
    // Nicht-Administratoren ausgenommen, ein Hochstufen ist damit unmöglich.
    if (body.roleIds !== undefined) {
      await assertRolesExist(body.roleIds);
      const allowed = await assignableRoleIdsFor(req.user!);
      const current = new Set(target.roles.map((r) => r.id));
      const next = new Set(body.roleIds);
      const changed = [
        ...body.roleIds.filter((roleId) => !current.has(roleId)),
        ...[...current].filter((roleId) => !next.has(roleId)),
      ];
      if (changed.some((roleId) => !allowed.has(roleId))) {
        throw new HttpError(400, 'Du darfst nicht alle dieser Rollen vergeben');
      }
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) {
      fields.push('name = ?');
      values.push(body.name);
    }
    if (body.email !== undefined) {
      fields.push('email = ?');
      values.push(body.email === '' ? null : body.email);
    }
    if (body.active !== undefined) {
      fields.push('active = ?');
      values.push(body.active ? 1 : 0);
    }
    if (body.must_change_password !== undefined) {
      fields.push('must_change_password = ?');
      values.push(body.must_change_password ? 1 : 0);
    }
    if (fields.length > 0) {
      values.push(id);
      await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    }
    if (body.roleIds !== undefined) {
      await replaceUserRoles(id, body.roleIds);
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'user_updated',
      targetType: 'user',
      targetId: String(id),
      details: body,
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

usersRouter.post('/:id/reset-password', validate(resetPasswordSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'Ungültige Benutzer-ID');
    const target = await reqUserRow(id);
    if (!target) throw new HttpError(404, 'Benutzer nicht gefunden');

    const { password } = req.body as { password?: string };
    const tempPassword = password ?? genTempPassword();
    const hash = await bcrypt.hash(tempPassword, 12);
    await pool.query(
      'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
      [hash, id]
    );
    await writeAudit({
      userId: req.user!.id,
      action: 'user_password_reset',
      targetType: 'user',
      targetId: String(id),
      details: { passwordReset: true },
      ip: req.ip,
    });

    res.json({ ok: true, tempPassword });
  } catch (err) {
    next(err);
  }
});

async function reqUserRow(id: number): Promise<UserRow | null> {
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.email, u.name, u.active, u.must_change_password,
            u.last_login_at, u.created_at
     FROM users u
     WHERE u.id = ?`,
    [id]
  );
  const base = (rows as Array<Omit<UserRow, 'roles'>>)[0];
  if (!base) return null;
  const rolesMap = await rolesForUsers([id]);
  return { ...base, roles: rolesMap.get(id) ?? [] };
}

/**
 * Zählt alle Datensätze, die über einen Fremdschlüssel auf den Benutzer
 * verweisen – Grundlage für die Rückfrage vor dem Löschen.
 *
 * `effect` beschreibt, was das Löschen mit den Zählern macht:
 * - `entfernt`: ON DELETE CASCADE, der Datensatz verschwindet
 * - `ohne_zuordnung`: ON DELETE SET NULL, der Datensatz bleibt, verliert aber
 *   den Bezug zum gelöschten Benutzer
 */
async function userReferences(id: number): Promise<UserReference[]> {
  const [rows] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM audit_logs        WHERE user_id       = ?) AS audit_logs,
       (SELECT COUNT(*) FROM events             WHERE created_by    = ?) AS events,
       (SELECT COUNT(*) FROM event_editors      WHERE user_id       = ?) AS event_editors,
       (SELECT COUNT(*) FROM stock_movements    WHERE user_id       = ?) AS stock_movements,
       (SELECT COUNT(*) FROM checkouts          WHERE user_id       = ?) AS checkouts,
       (SELECT COUNT(*) FROM returns            WHERE user_id       = ?) AS returns,
       (SELECT COUNT(*) FROM maintenance        WHERE reported_by    = ? OR technician_id = ?) AS maintenance,
       (SELECT COUNT(*) FROM maintenance_logs   WHERE user_id       = ?) AS maintenance_logs,
       (SELECT COUNT(*) FROM purchases          WHERE created_by    = ?) AS purchases,
       (SELECT COUNT(*) FROM documents          WHERE uploaded_by   = ?) AS documents,
       (SELECT COUNT(*) FROM inventory_sessions WHERE created_by    = ?) AS inventory_sessions,
       (SELECT COUNT(*) FROM inventory_counts   WHERE counted_by    = ?) AS inventory_counts`,
    [id, id, id, id, id, id, id, id, id, id, id, id, id]
  );
  const counts = (rows as Array<Record<string, number>>)[0] ?? {};
  return (Object.keys(counts) as Array<keyof typeof counts>).map((key) => ({
    key,
    count: Number(counts[key] ?? 0),
    // event_editors.user_id ist NOT NULL, kann also nicht auf NULL gesetzt
    // werden und ist deshalb als einziger Verweis ON DELETE CASCADE.
    effect: key === 'event_editors' ? 'entfernt' : 'ohne_zuordnung',
  }));
}

/**
 * Anzahl der aktiven Administratoren ohne den Benutzer `excludeId`.
 *
 * Inaktive Administratoren zählen nicht mit: sie können sich nicht anmelden
 * und damit auch keine Rechte vergeben. Bliebe nach dem Löschen keiner übrig,
 * wäre die Benutzerverwaltung für niemanden mehr erreichbar.
 */
async function remainingActiveAdmins(excludeId: number): Promise<number> {
  const [rows] = await pool.query(
    `SELECT COUNT(DISTINCT u.id) AS total
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE r.name = 'administrator' AND u.active = 1 AND u.id <> ?`,
    [excludeId]
  );
  return Number((rows as Array<{ total: number }>)[0]?.total ?? 0);
}

/** Sperrgrund für das Löschen – leer, wenn das Löschen erlaubt ist. */
async function deleteBlocker(target: UserRow, ownId: number): Promise<string> {
  if (target.id === ownId) {
    return 'Du kannst dein eigenes Konto nicht löschen.';
  }
  if (target.roles.some((r) => r.name === 'administrator') && (await remainingActiveAdmins(target.id)) === 0) {
    return 'Dieser Benutzer ist der letzte aktive Administrator. Ohne ihn wäre niemand mehr in der Lage, die Benutzerverwaltung zu öffnen.';
  }
  return '';
}

usersRouter.get('/:id/deletion-impact', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Ungültige Benutzer-ID');
    const target = await reqUserRow(id);
    if (!target) throw new HttpError(404, 'Benutzer nicht gefunden');

    res.json({
      user: {
        id: target.id,
        username: target.username,
        name: target.name,
        roles: target.roles,
        active: target.active,
      },
      blocked: await deleteBlocker(target, req.user!.id),
      references: await userReferences(id),
    });
  } catch (err) {
    next(err);
  }
});

usersRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Ungültige Benutzer-ID');
    const target = await reqUserRow(id);
    if (!target) throw new HttpError(404, 'Benutzer nicht gefunden');

    const blocked = await deleteBlocker(target, req.user!.id);
    if (blocked) throw new HttpError(400, blocked);

    // Zähler vor dem Löschen lesen – danach ist der Benutzer nicht mehr
    // auffindbar und die Werte landen im Audit-Eintrag.
    const references = await userReferences(id);

    // Alle Fremdschlüssel auf users(id) haben eine ON DELETE-Aktion, der
    // Datensatz lässt sich also ohne Vorwarnung entfernen. Ein Fehler aus der
    // Datenbank käme trotzdem als 500er ohne Ursache an, deshalb wird errno
    // 1451/1452 (FK verletzt) auf eine verständliche Meldung abgebildet.
    try {
      await pool.query('DELETE FROM users WHERE id = ?', [id]);
    } catch (err) {
      const errno = (err as { errno?: number }).errno;
      if (errno === 1451 || errno === 1452) {
        throw new HttpError(
          409,
          'Der Benutzer ist noch mit anderen Datensätzen verknüpft. Bitte zuerst diese Verknüpfungen prüfen.'
        );
      }
      throw err;
    }

    await writeAudit({
      userId: req.user!.id,
      action: 'user_deleted',
      targetType: 'user',
      targetId: String(id),
      // Benutzername und Name wandern mit in den Audit-Eintrag: durch
      // ON DELETE SET NULL steht dort danach nur noch eine unlesbare ID.
      details: {
        username: target.username,
        name: target.name,
        roles: target.roles.map((r) => r.name),
        references: Object.fromEntries(references.map((r) => [r.key, r.count])),
      },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});