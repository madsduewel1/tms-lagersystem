import { Router } from 'express';
import { z } from 'zod';
import { pool, type SqlRow } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, parseId } from '../../utils/helpers.js';

const statusEnum = z.enum([
  'gemeldet',
  'pruefung',
  'reparatur',
  'ersatzteil',
  'repariert',
  'nicht_reparierbar',
]);

const createSchema = z.object({
  item_id: z.coerce.number().int().positive(),
  problem: z.string().min(1).max(200),
  description: z.string().max(8000).nullish(),
  technician_id: z.coerce.number().int().positive().nullish(),
  cost: z.coerce.number().min(0).nullish(),
  note: z.string().max(512).nullish(),
});

const updateSchema = z.object({
  problem: z.string().max(200).optional(),
  description: z.string().max(8000).nullish(),
  technician_id: z.coerce.number().int().positive().nullish(),
  status: statusEnum.optional(),
  repair: z.string().max(8000).nullish(),
  cost: z.coerce.number().min(0).nullish(),
  note: z.string().max(512).nullish(),
});

const logSchema = z.object({
  status: statusEnum.nullish(),
  note: z.string().max(512).nullish(),
});

export const maintenanceRouter = Router();
maintenanceRouter.use(requireAuth);

maintenanceRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const itemId = req.query.itemId ? Number(req.query.itemId) : undefined;
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (status) {
      clauses.push('m.status = ?');
      params.push(status);
    }
    if (itemId) {
      clauses.push('m.item_id = ?');
      params.push(itemId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT m.*, i.name, i.manufacturer, i.model, i.inventory_number, i.serial_number,
              i.kind, u.name AS technician_name, r.name AS reported_by_name
       FROM maintenance m
       JOIN items i ON i.id = m.item_id
       LEFT JOIN users u ON u.id = m.technician_id
       LEFT JOIN users r ON r.id = m.reported_by
       ${where}
       ORDER BY FIELD(m.status,'gemeldet','pruefung','reparatur','ersatzteil','repariert','nicht_reparierbar'), m.reported_at DESC`,
      params
    );
    res.json({ entries: rows });
  })
);

async function loadMaintenance(id: number) {
  const [rows] = await pool.query<SqlRow<Record<string, unknown>>[]>(
    `SELECT m.*, i.name, i.manufacturer, i.model, i.inventory_number, i.serial_number, i.kind,
            u.name AS technician_name, r.name AS reported_by_name
     FROM maintenance m
     JOIN items i ON i.id = m.item_id
     LEFT JOIN users u ON u.id = m.technician_id
     LEFT JOIN users r ON r.id = m.reported_by
     WHERE m.id = ?`,
    [id]
  );
  return rows[0] ?? null;
}

maintenanceRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const entry = await loadMaintenance(id);
    if (!entry) throw new HttpError(404, 'Wartungseintrag nicht gefunden');
    const [logs] = await pool.query(
      `SELECT l.*, u.name AS user_name FROM maintenance_logs l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE l.maintenance_id = ? ORDER BY l.created_at DESC`,
      [id]
    );
    res.json({ entry, logs });
  })
);

maintenanceRouter.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as {
      item_id: number;
      problem: string;
      description?: string | null;
      technician_id?: number | null;
      cost?: number | null;
      note?: string | null;
    };
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.query(
        `INSERT INTO maintenance (item_id, problem, description, reported_by, technician_id, cost, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          b.item_id,
          b.problem,
          b.description ?? null,
          req.user!.id,
          b.technician_id ?? null,
          b.cost ?? null,
          b.note ?? null,
        ]
      );
      const id = Number((result as { insertId: number }).insertId);
      await conn.query(
        `INSERT INTO maintenance_logs (maintenance_id, user_id, status, note)
         VALUES (?, ?, 'gemeldet', ?)`,
        [id, req.user!.id, b.problem]
      );
      await conn.query(
        "UPDATE items SET status = 'wartung' WHERE id = ? AND status NOT IN ('ausgelagert','ausser_betrieb')",
        [b.item_id]
      );
      await conn.commit();
      await writeAudit({
        userId: req.user!.id,
        action: 'maintenance_created',
        targetType: 'item',
        targetId: String(b.item_id),
        details: { problem: b.problem },
        ip: req.ip,
      });
      res.status(201).json({ id });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

maintenanceRouter.patch(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const b = req.body as Record<string, unknown>;
    const allowed = ['problem', 'description', 'technician_id', 'status', 'repair', 'cost', 'note'];
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of allowed) {
      if (b[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(b[key] === '' ? null : b[key]);
      }
    }
    if (b.status === 'repariert' || b.status === 'nicht_reparierbar') {
      fields.push('completed_at = NOW()');
    }
    if (fields.length) {
      values.push(id);
      await pool.query(`UPDATE maintenance SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    if (typeof b.status === 'string') {
      const [rows] = await pool.query<SqlRow<{ item_id: number }>[]>(
        'SELECT item_id FROM maintenance WHERE id = ?',
        [id]
      );
      const itemId = rows[0]?.item_id;
      if (itemId) {
        if (b.status === 'repariert') {
          await pool.query("UPDATE items SET status = 'verfuegbar' WHERE id = ?", [itemId]);
        } else if (b.status === 'nicht_reparierbar') {
          await pool.query("UPDATE items SET status = 'defekt' WHERE id = ?", [itemId]);
        } else {
          await pool.query("UPDATE items SET status = 'wartung' WHERE id = ?", [itemId]);
        }
      }
      await pool.query(
        `INSERT INTO maintenance_logs (maintenance_id, user_id, status, note) VALUES (?, ?, ?, ?)`,
        [id, req.user!.id, b.status, (b.note as string) ?? null]
      );
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'maintenance_updated',
      targetType: 'maintenance',
      targetId: String(id),
      details: b,
      ip: req.ip,
    });
    res.json({ entry: await loadMaintenance(id) });
  })
);

maintenanceRouter.post(
  '/:id/logs',
  validate(logSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { status, note } = req.body as { status?: string | null; note?: string | null };
    await pool.query(
      `INSERT INTO maintenance_logs (maintenance_id, user_id, status, note) VALUES (?, ?, ?, ?)`,
      [id, req.user!.id, status ?? null, note ?? null]
    );
    res.status(201).json({ ok: true });
  })
);

maintenanceRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [result] = await pool.query('DELETE FROM maintenance WHERE id = ?', [id]);
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new HttpError(404, 'Wartungseintrag nicht gefunden');
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'maintenance_deleted',
      targetType: 'maintenance',
      targetId: String(id),
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);
