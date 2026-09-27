import { Router } from 'express';
import { z } from 'zod';
import { pool, type SqlRow } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, newToken, parseId } from '../../utils/helpers.js';

const caseSchema = z.object({
  name: z.string().min(1).max(160),
  code: z.string().max(32).nullish(),
  description: z.string().max(512).nullish(),
  storage_location_id: z.coerce.number().int().positive().nullish(),
  status: z
    .enum(['verfuegbar', 'ausgelagert', 'defekt', 'ausser_betrieb'])
    .default('verfuegbar')
    .optional(),
});
const updateSchema = caseSchema.partial();

const caseItemSchema = z.object({
  item_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).default(1),
  note: z.string().max(512).nullish(),
});
const caseItemUpdateSchema = z.object({
  quantity: z.coerce.number().int().min(1).optional(),
  note: z.string().max(512).nullish(),
});

const CASE_LIST = `
  SELECT c.*,
    CONCAT_WS(' / ', lpp.name, lp.name, l.name) AS location_path,
    (SELECT COUNT(*) FROM case_items ci WHERE ci.case_id = c.id) AS item_count
  FROM cases c
  LEFT JOIN storage_locations l ON l.id = c.storage_location_id
  LEFT JOIN storage_locations lp ON lp.id = l.parent_id
  LEFT JOIN storage_locations lpp ON lpp.id = lp.parent_id`;

async function getCase(id: number) {
  const [rows] = await pool.query<SqlRow<Record<string, unknown>>[]>(
    `${CASE_LIST} WHERE c.id = ?`,
    [id]
  );
  return rows[0] ?? null;
}

export const casesRouter = Router();
casesRouter.use(requireAuth);

casesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<SqlRow<Record<string, unknown>>[]>(
      `${CASE_LIST} ORDER BY c.name`
    );
    res.json({ cases: rows });
  })
);

casesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const kas = await getCase(id);
    if (!kas) throw new HttpError(404, 'Case nicht gefunden');

    const [items] = await pool.query(
      `SELECT ci.id, ci.item_id, ci.quantity, ci.note,
              i.kind, i.name, i.manufacturer, i.model, i.inventory_number, i.unit, i.status,
              i.quantity AS stock,
              c.name AS category_name
       FROM case_items ci
       JOIN items i ON i.id = ci.item_id
       LEFT JOIN categories c ON c.id = i.category_id
       WHERE ci.case_id = ?
       ORDER BY i.kind, i.name`,
      [id]
    );

    res.json({ case: kas, items });
  })
);

casesRouter.post(
  '/',
  validate(caseSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const [result] = await pool.query(
      `INSERT INTO cases (name, code, description, storage_location_id, status, qr_token)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        b.name,
        b.code ?? null,
        b.description ?? null,
        b.storage_location_id ?? null,
        b.status ?? 'verfuegbar',
        newToken(),
      ]
    );
    const id = Number((result as { insertId: number }).insertId);
    await writeAudit({
      userId: req.user!.id,
      action: 'case_created',
      targetType: 'case',
      targetId: String(id),
      details: { name: b.name },
      ip: req.ip,
    });
    res.status(201).json({ id, case: await getCase(id) });
  })
);

casesRouter.patch(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await getCase(id))) throw new HttpError(404, 'Case nicht gefunden');
    const b = req.body as Record<string, unknown>;
    const allowed = ['name', 'code', 'description', 'storage_location_id', 'status'];
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
      await pool.query(`UPDATE cases SET ${fields.join(', ')} WHERE id = ?`, values);
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'case_updated',
      targetType: 'case',
      targetId: String(id),
      details: b,
      ip: req.ip,
    });
    res.json({ case: await getCase(id) });
  })
);

casesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [result] = await pool.query('DELETE FROM cases WHERE id = ?', [id]);
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new HttpError(404, 'Case nicht gefunden');
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'case_deleted',
      targetType: 'case',
      targetId: String(id),
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);

casesRouter.post(
  '/:id/items',
  validate(caseItemSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { item_id, quantity, note } = req.body as {
      item_id: number;
      quantity: number;
      note?: string | null;
    };
    const [items] = await pool.query<SqlRow<{ kind: string }>[]>(
      'SELECT kind FROM items WHERE id = ?',
      [item_id]
    );
    if (!items[0]) throw new HttpError(404, 'Asset nicht gefunden');
    await pool.query(
      `INSERT INTO case_items (case_id, item_id, quantity, note) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), note = VALUES(note)`,
      [id, item_id, quantity, note ?? null]
    );
    await writeAudit({
      userId: req.user!.id,
      action: 'case_item_added',
      targetType: 'case',
      targetId: String(id),
      details: { item_id, quantity },
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);

casesRouter.patch(
  '/:id/items/:itemId',
  validate(caseItemUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const itemId = parseId(req.params.itemId, 'Asset-ID');
    const b = req.body as Record<string, unknown>;
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of ['quantity', 'note']) {
      if (b[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(b[key] === '' ? null : b[key]);
      }
    }
    if (!fields.length) throw new HttpError(400, 'Keine Änderungen angegeben');
    values.push(id, itemId);
    const [result] = await pool.query(
      `UPDATE case_items SET ${fields.join(', ')} WHERE case_id = ? AND item_id = ?`,
      values
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new HttpError(404, 'Asset nicht gefunden');
    }
    res.json({ ok: true });
  })
);

casesRouter.delete(
  '/:id/items/:itemId',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const itemId = parseId(req.params.itemId, 'Asset-ID');
    await pool.query('DELETE FROM case_items WHERE case_id = ? AND item_id = ?', [id, itemId]);
    await writeAudit({
      userId: req.user!.id,
      action: 'case_item_removed',
      targetType: 'case',
      targetId: String(id),
      details: { item_id: itemId },
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);