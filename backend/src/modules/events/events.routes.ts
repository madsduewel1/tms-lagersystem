import { Router } from 'express';
import { z } from 'zod';
import { pool, type SqlRow } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, parseId } from '../../utils/helpers.js';

const eventSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(8000).nullish(),
  location: z.string().max(200).nullish(),
  contact_name: z.string().max(160).nullish(),
  starts_at: z.string().max(32).nullish(),
  ends_at: z.string().max(32).nullish(),
  status: z
    .enum(['entwurf', 'geplant', 'vorbereitung', 'aktiv', 'abgeschlossen', 'abgesagt'])
    .optional(),
  notes: z.string().max(8000).nullish(),
  editorIds: z.array(z.coerce.number().int().positive()).optional(),
});
const updateSchema = eventSchema.partial();

const planItemSchema = z.object({
  item_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).default(1),
  note: z.string().max(512).nullish(),
});

const planDeviceSchema = z.object({
  item_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(9999).default(1),
  note: z.string().max(512).nullish(),
});

const planCaseSchema = z.object({
  case_id: z.coerce.number().int().positive(),
  note: z.string().max(512).nullish(),
});

async function setPlannedDevicesStatus(eventId: number, status: string): Promise<void> {
  await pool.query(
    `UPDATE items i
     JOIN event_devices ed ON ed.item_id = i.id
     SET i.status = ?, i.current_event_id = IF(? = 'verfuegbar', NULL, ed.event_id)
     WHERE ed.event_id = ?`,
    [status, status, eventId]
  );
}

async function clearPlannedDevices(eventId: number): Promise<void> {
  await pool.query(
    `UPDATE items i
     JOIN event_devices ed ON ed.item_id = i.id
     SET i.status = 'verfuegbar', i.current_event_id = NULL
     WHERE ed.event_id = ? AND i.current_event_id = ?`,
    [eventId, eventId]
  );
}

async function setPlannedCasesStatus(eventId: number, status: string): Promise<void> {
  await pool.query(
    `UPDATE cases c JOIN event_cases ec ON ec.case_id = c.id
     SET c.status = ? WHERE ec.event_id = ?`,
    [status, eventId]
  );
}

async function clearPlannedCases(eventId: number): Promise<void> {
  await pool.query(
    `UPDATE cases c JOIN event_cases ec ON ec.case_id = c.id
     SET c.status = 'verfuegbar' WHERE ec.event_id = ?`,
    [eventId]
  );
}

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

type RoleName = 'administrator' | 'techniker';

async function loadEditors(eventId: number): Promise<Array<Record<string, unknown>>> {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.username, r.name AS role
     FROM event_editors ee
     JOIN users u ON u.id = ee.user_id
     JOIN roles r ON r.id = u.role_id
     WHERE ee.event_id = ?
     ORDER BY u.name`,
    [eventId]
  );
  return rows as Array<Record<string, unknown>>;
}

async function isEditor(eventId: number, userId: number): Promise<boolean> {
  const [rows] = await pool.query<SqlRow<{ n: number }>[]>(
    'SELECT COUNT(*) AS n FROM event_editors WHERE event_id = ? AND user_id = ?',
    [eventId, userId]
  );
  return (rows[0]?.n ?? 0) > 0;
}

async function canEditEvent(eventId: number, userId: number, role: RoleName): Promise<boolean> {
  if (role === 'administrator') return true;
  const [rows] = await pool.query<SqlRow<{ created_by: number | null }>[]>(
    'SELECT created_by FROM events WHERE id = ?',
    [eventId]
  );
  const createdBy = rows[0]?.created_by;
  if (createdBy !== null && createdBy !== undefined && Number(createdBy) === userId) return true;
  return isEditor(eventId, userId);
}

async function replaceEditors(eventId: number, userIds: number[]): Promise<void> {
  await pool.query('DELETE FROM event_editors WHERE event_id = ?', [eventId]);
  if (userIds.length === 0) return;
  const values = userIds.map((uid) => [eventId, uid] as const);
  await pool.query('INSERT IGNORE INTO event_editors (event_id, user_id) VALUES ?', [values]);
}

async function requireEventPermission(
  eventId: number,
  userId: number,
  role: RoleName
): Promise<boolean> {
  const editable = await canEditEvent(eventId, userId, role);
  if (!editable) {
    throw new HttpError(403, 'Keine Berechtigung: Nur Ersteller, Bearbeiter oder Admins dürfen dieses Event ändern');
  }
  return true;
}

eventsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const params: unknown[] = [req.user!.id];
    let where = '';
    if (status) {
      where = 'WHERE e.status = ?';
      params.push(status);
    }
    const [rows] = await pool.query(
      `SELECT e.*, u.name AS created_by_name,
        (SELECT COUNT(*) FROM event_items ei WHERE ei.event_id = e.id) AS item_plan_count,
        (SELECT COALESCE(SUM(ed.quantity), 0) FROM event_devices ed WHERE ed.event_id = e.id) AS device_plan_count,
        (SELECT COUNT(*) FROM event_cases ec WHERE ec.event_id = e.id) AS case_plan_count,
        (SELECT COUNT(*) FROM checkouts c WHERE c.event_id = e.id AND c.status = 'offen') AS open_checkouts,
        (SELECT COUNT(*) FROM event_editors ee WHERE ee.event_id = e.id AND ee.user_id = ?) AS user_editor_count
       FROM events e
       LEFT JOIN users u ON u.id = e.created_by
       ${where}
       ORDER BY e.starts_at DESC, e.created_at DESC`,
      params
    );
    const data = rows as Array<Record<string, unknown>>;
    const events = data.map((row) => {
      const canEdit =
        req.user!.role === 'administrator' ||
        (typeof row.created_by === 'number' && row.created_by === req.user!.id) ||
        Number(row.user_editor_count ?? 0) > 0;
      const { user_editor_count: _drop, ...rest } = row;
      return { ...rest, can_edit: canEdit };
    });
    res.json({ events });
  })
);

eventsRouter.post(
  '/',
  validate(eventSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const [result] = await pool.query(
      `INSERT INTO events (name, description, location, contact_name, starts_at, ends_at, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.name,
        b.description ?? null,
        b.location ?? null,
        b.contact_name ?? null,
        b.starts_at ?? null,
        b.ends_at ?? null,
        b.status ?? 'entwurf',
        b.notes ?? null,
        req.user!.id,
      ]
    );
    const id = Number((result as { insertId: number }).insertId);
    const editorIds = (b.editorIds as number[] | undefined) ?? [];
    if (editorIds.length) {
      await replaceEditors(id, editorIds);
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'event_created',
      targetType: 'event',
      targetId: String(id),
      details: { name: b.name, editorIds },
      ip: req.ip,
    });
    res.status(201).json({ id });
  })
);

async function loadEvent(id: number) {
  const [rows] = await pool.query<SqlRow<Record<string, unknown>>[]>(
    `SELECT e.*, u.name AS created_by_name FROM events e
     LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ?`,
    [id]
  );
  return rows[0] ?? null;
}

eventsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const event = await loadEvent(id);
    if (!event) throw new HttpError(404, 'Event nicht gefunden');

    const [items] = await pool.query(
      `SELECT ei.id, ei.item_id, ei.quantity, ei.status, ei.note,
              i.name, i.manufacturer, i.model, i.quantity AS stock, i.unit,
              i.inventory_number
       FROM event_items ei JOIN items i ON i.id = ei.item_id
       WHERE ei.event_id = ? ORDER BY i.name`,
      [id]
    );
    const [devices] = await pool.query(
      `SELECT ed.id, ed.item_id, ed.status, ed.note, ed.quantity,
              i.name, i.manufacturer, i.model, i.inventory_number, i.serial_number, i.status AS device_status,
              i.category_id, c.name AS category_name
       FROM event_devices ed JOIN items i ON i.id = ed.item_id
       LEFT JOIN categories c ON c.id = i.category_id
       WHERE ed.event_id = ? ORDER BY c.name, i.name`,
      [id]
    );
    const [checkouts] = await pool.query(
      `SELECT c.*, i.name, i.inventory_number, i.unit
       FROM checkouts c JOIN items i ON i.id = c.item_id
       WHERE c.event_id = ? ORDER BY c.checked_out_at DESC`,
      [id]
    );
    const [cases] = await pool.query(
      `SELECT ec.id, ec.case_id, ec.status, ec.note,
              k.name, k.code, k.status AS case_status,
              CONCAT_WS(' / ', lpp.name, lp.name, l.name) AS location_path,
              (SELECT COUNT(*) FROM case_items ci WHERE ci.case_id = k.id) AS item_count
       FROM event_cases ec
       JOIN cases k ON k.id = ec.case_id
       LEFT JOIN storage_locations l ON l.id = k.storage_location_id
       LEFT JOIN storage_locations lp ON lp.id = l.parent_id
       LEFT JOIN storage_locations lpp ON lpp.id = lp.parent_id
       WHERE ec.event_id = ? ORDER BY k.name`,
      [id]
    );
    const editors = await loadEditors(id);
    const canEdit = await canEditEvent(id, req.user!.id, req.user!.role as RoleName);
    res.json({ event, items, devices, checkouts, cases, editors, can_edit: canEdit });
  })
);

eventsRouter.patch(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    await requireEventPermission(id, req.user!.id, req.user!.role as RoleName);
    const b = req.body as Record<string, unknown>;
    const allowed = [
      'name',
      'description',
      'location',
      'contact_name',
      'starts_at',
      'ends_at',
      'status',
      'notes',
    ];
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of allowed) {
      if (b[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(b[key] === '' ? null : b[key]);
      }
    }
    if (fields.length) {
      values.push(id);
      await pool.query(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    const newStatus = (b as { status?: string }).status;
    if (newStatus === 'aktiv') {
      await setPlannedDevicesStatus(id, 'ausgelagert');
      await setPlannedCasesStatus(id, 'ausgelagert');
    } else if (newStatus === 'abgeschlossen' || newStatus === 'abgesagt') {
      await clearPlannedDevices(id);
      await clearPlannedCases(id);
    }

    const editorIds = b.editorIds as number[] | undefined;
    if (editorIds !== undefined) {
      const isAdmin = req.user!.role === 'administrator';
      const cur = await loadEvent(id);
      const isCreator = !!cur && typeof cur.created_by === 'number' && cur.created_by === req.user!.id;
      if (!isAdmin && !isCreator) {
        throw new HttpError(403, 'Nur Ersteller oder Admins dürfen die Bearbeitungsrechte ändern');
      }
      await replaceEditors(id, editorIds);
    }

    await writeAudit({
      userId: req.user!.id,
      action: 'event_updated',
      targetType: 'event',
      targetId: String(id),
      details: b,
      ip: req.ip,
    });
    res.json({ event: await loadEvent(id), editors: await loadEditors(id) });
  })
);

eventsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    await requireEventPermission(id, req.user!.id, req.user!.role as RoleName);
    const [result] = await pool.query('DELETE FROM events WHERE id = ?', [id]);
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new HttpError(404, 'Event nicht gefunden');
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'event_deleted',
      targetType: 'event',
      targetId: String(id),
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);

eventsRouter.post(
  '/:id/items',
  validate(planItemSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    await requireEventPermission(id, req.user!.id, req.user!.role as RoleName);
    const { item_id, quantity, note } = req.body as {
      item_id: number;
      quantity: number;
      note?: string | null;
    };
    const [items] = await pool.query<SqlRow<{ kind: string }>[]>(
      'SELECT kind FROM items WHERE id = ?',
      [item_id]
    );
    if (!items[0]) throw new HttpError(404, 'Artikel nicht gefunden');
    if (items[0].kind !== 'artikel') {
      throw new HttpError(400, 'Für Einzelgeräte bitte die Geräteplanung verwenden');
    }
    await pool.query(
      `INSERT INTO event_items (event_id, item_id, quantity, note) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), note = VALUES(note)`,
      [id, item_id, quantity, note ?? null]
    );
    await writeAudit({
      userId: req.user!.id,
      action: 'event_item_planned',
      targetType: 'event',
      targetId: String(id),
      details: { item_id, quantity },
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);

eventsRouter.delete(
  '/:id/items/:itemId',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const itemId = parseId(req.params.itemId, 'Artikel-ID');
    await requireEventPermission(id, req.user!.id, req.user!.role as RoleName);
    await pool.query('DELETE FROM event_items WHERE event_id = ? AND item_id = ?', [id, itemId]);
    res.json({ ok: true });
  })
);

eventsRouter.post(
  '/:id/devices',
  validate(planDeviceSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    await requireEventPermission(id, req.user!.id, req.user!.role as RoleName);
    const { item_id, quantity, note } = req.body as {
      item_id: number;
      quantity: number;
      note?: string | null;
    };
    const [items] = await pool.query<SqlRow<{ kind: string }>[]>(
      'SELECT kind FROM items WHERE id = ?',
      [item_id]
    );
    if (!items[0]) throw new HttpError(404, 'Gerät nicht gefunden');
    if (items[0].kind !== 'geraet') {
      throw new HttpError(400, 'Für Mengenartikel bitte die Mengenplanung verwenden');
    }
    await pool.query(
      `INSERT INTO event_devices (event_id, item_id, quantity, note) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), note = VALUES(note)`,
      [id, item_id, quantity, note ?? null]
    );
    const [evStatus] = await pool.query<SqlRow<{ status: string }>[]>(
      'SELECT status FROM events WHERE id = ?',
      [id]
    );
    if (evStatus[0] && evStatus[0].status !== 'abgeschlossen' && evStatus[0].status !== 'abgesagt') {
      await pool.query('UPDATE items SET current_event_id = ? WHERE id = ?', [id, item_id]);
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'event_device_planned',
      targetType: 'event',
      targetId: String(id),
      details: { item_id },
      ip: req.ip,
    });
    res.json({ ok: true, event: await loadEvent(id) });
  })
);

eventsRouter.delete(
  '/:id/devices/:itemId',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const itemId = parseId(req.params.itemId, 'Geräte-ID');
    await requireEventPermission(id, req.user!.id, req.user!.role as RoleName);
    await pool.query('DELETE FROM event_devices WHERE event_id = ? AND item_id = ?', [id, itemId]);
    await pool.query(
      `UPDATE items SET current_event_id = NULL, status = 'verfuegbar'
       WHERE id = ? AND current_event_id = ?`,
      [itemId, id]
    );
    res.json({ ok: true, event: await loadEvent(id) });
  })
);

eventsRouter.patch(
  '/:id/devices/:itemId',
  validate(z.object({ quantity: z.coerce.number().int().min(1).max(9999) })),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const itemId = parseId(req.params.itemId, 'Geräte-ID');
    await requireEventPermission(id, req.user!.id, req.user!.role as RoleName);
    const { quantity } = req.body as { quantity: number };
    const [result] = await pool.query(
      'UPDATE event_devices SET quantity = ? WHERE event_id = ? AND item_id = ?',
      [quantity, id, itemId]
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      const [check] = await pool.query<SqlRow<{ n: number }>[]>(
        'SELECT COUNT(*) AS n FROM event_devices WHERE event_id = ? AND item_id = ?',
        [id, itemId]
      );
      if ((check[0]?.n ?? 0) === 0) {
        throw new HttpError(404, 'Geplantes Gerät nicht gefunden');
      }
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'event_device_quantity_updated',
      targetType: 'event',
      targetId: String(id),
      details: { item_id: itemId, quantity },
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);

async function planCaseAssets(eventId: number, caseId: number): Promise<void> {
  const [assets] = await pool.query<SqlRow<{ item_id: number; quantity: number; note: string | null; kind: string }>[]>(
    `SELECT ci.item_id, ci.quantity, ci.note, i.kind
     FROM case_items ci JOIN items i ON i.id = ci.item_id
     WHERE ci.case_id = ?`,
    [caseId]
  );
  const [evStatus] = await pool.query<SqlRow<{ status: string }>[]>(
    'SELECT status FROM events WHERE id = ?',
    [eventId]
  );
  const markCurrent = !!evStatus[0] && evStatus[0].status !== 'abgeschlossen' && evStatus[0].status !== 'abgesagt';
  for (const asset of assets) {
    if (asset.kind === 'geraet') {
      await pool.query(
        `INSERT INTO event_devices (event_id, item_id, note) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE note = VALUES(note)`,
        [eventId, asset.item_id, asset.note ?? null]
      );
      if (markCurrent) {
        await pool.query('UPDATE items SET current_event_id = ? WHERE id = ?', [eventId, asset.item_id]);
      }
    } else {
      await pool.query(
        `INSERT INTO event_items (event_id, item_id, quantity, note) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), note = VALUES(note)`,
        [eventId, asset.item_id, asset.quantity, asset.note ?? null]
      );
    }
  }
}

eventsRouter.post(
  '/:id/cases',
  validate(planCaseSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    await requireEventPermission(id, req.user!.id, req.user!.role as RoleName);
    const { case_id, note } = req.body as { case_id: number; note?: string | null };
    const [cases] = await pool.query<SqlRow<{ ok: number }>[]>(
      'SELECT 1 AS ok FROM cases WHERE id = ?',
      [case_id]
    );
    if (cases.length === 0) throw new HttpError(404, 'Case nicht gefunden');
    await pool.query(
      `INSERT INTO event_cases (event_id, case_id, note) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE note = VALUES(note)`,
      [id, case_id, note ?? null]
    );
    await planCaseAssets(id, case_id);
    await writeAudit({
      userId: req.user!.id,
      action: 'event_case_planned',
      targetType: 'event',
      targetId: String(id),
      details: { case_id },
      ip: req.ip,
    });
    res.json({ ok: true, event: await loadEvent(id) });
  })
);

eventsRouter.delete(
  '/:id/cases/:caseId',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const caseId = parseId(req.params.caseId, 'Case-ID');
    await requireEventPermission(id, req.user!.id, req.user!.role as RoleName);
    await pool.query('DELETE FROM event_cases WHERE event_id = ? AND case_id = ?', [id, caseId]);
    res.json({ ok: true, event: await loadEvent(id) });
  })
);
