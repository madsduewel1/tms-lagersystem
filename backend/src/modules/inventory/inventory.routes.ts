import { Router } from 'express';
import { z } from 'zod';
import { pool, type SqlRow } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, parseId } from '../../utils/helpers.js';
import { recordMovement } from '../items/items.service.js';

const createSchema = z.object({
  name: z.string().min(1).max(160),
  area_location_id: z.coerce.number().int().positive().nullish(),
  notes: z.string().max(512).nullish(),
});

const countSchema = z.object({
  item_id: z.coerce.number().int().positive(),
  counted_quantity: z.coerce.number().int().min(0),
});

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

async function descendantIds(rootId: number): Promise<number[]> {
  const [rows] = await pool.query<SqlRow<{ id: number; parent_id: number | null }>[]>(
    'SELECT id, parent_id FROM storage_locations'
  );
  const ids = new Set<number>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.parent_id && ids.has(row.parent_id) && !ids.has(row.id)) {
        ids.add(row.id);
        changed = true;
      }
    }
  }
  return [...ids];
}

inventoryRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query(
      `SELECT s.*, u.name AS user_name, l.name AS area_name,
        (SELECT COUNT(*) FROM inventory_counts c WHERE c.session_id = s.id) AS item_count,
        (SELECT COUNT(*) FROM inventory_counts c WHERE c.session_id = s.id AND c.counted_quantity IS NOT NULL) AS counted_count
       FROM inventory_sessions s
       LEFT JOIN users u ON u.id = s.created_by
       LEFT JOIN storage_locations l ON l.id = s.area_location_id
       ORDER BY s.started_at DESC`
    );
    res.json({ sessions: rows });
  })
);

inventoryRouter.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { name, area_location_id, notes } = req.body as {
      name: string;
      area_location_id?: number | null;
      notes?: string | null;
    };

    let itemRows: SqlRow<{ id: number; kind: string; quantity: number }>[];
    if (area_location_id) {
      const ids = await descendantIds(area_location_id);
      const placeholders = ids.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT id, kind, quantity FROM items WHERE storage_location_id IN (${placeholders})`,
        ids
      );
      itemRows = rows as typeof itemRows;
    } else {
      const [rows] = await pool.query('SELECT id, kind, quantity FROM items');
      itemRows = rows as typeof itemRows;
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.query(
        `INSERT INTO inventory_sessions (name, area_location_id, created_by, notes)
         VALUES (?, ?, ?, ?)`,
        [name, area_location_id ?? null, req.user!.id, notes ?? null]
      );
      const sessionId = Number((result as { insertId: number }).insertId);
      for (const item of itemRows) {
        await conn.query(
          `INSERT INTO inventory_counts (session_id, item_id, expected_quantity)
           VALUES (?, ?, ?)`,
          [sessionId, item.id, item.kind === 'artikel' ? item.quantity : 1]
        );
      }
      await conn.commit();
      await writeAudit({
        userId: req.user!.id,
        action: 'inventory_started',
        targetType: 'inventory_session',
        targetId: String(sessionId),
        details: { name, area_location_id: area_location_id ?? null },
        ip: req.ip,
      });
      res.status(201).json({ id: sessionId });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

inventoryRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [sessions] = await pool.query<SqlRow<Record<string, unknown>>[]>(
      `SELECT s.*, u.name AS user_name, l.name AS area_name
       FROM inventory_sessions s
       LEFT JOIN users u ON u.id = s.created_by
       LEFT JOIN storage_locations l ON l.id = s.area_location_id
       WHERE s.id = ?`,
      [id]
    );
    const session = sessions[0];
    if (!session) throw new HttpError(404, 'Inventur nicht gefunden');
    const [counts] = await pool.query(
      `SELECT c.*, i.name AS item_name, i.manufacturer, i.model, i.inventory_number,
              i.serial_number, i.kind, i.unit,
              CONCAT_WS(' / ', lpp.name, lp.name, l.name) AS location_path
       FROM inventory_counts c
       JOIN items i ON i.id = c.item_id
       LEFT JOIN storage_locations l ON l.id = i.storage_location_id
       LEFT JOIN storage_locations lp ON lp.id = l.parent_id
       LEFT JOIN storage_locations lpp ON lpp.id = lp.parent_id
       WHERE c.session_id = ? ORDER BY i.name`,
      [id]
    );
    res.json({ session, counts });
  })
);

inventoryRouter.post(
  '/:id/count',
  validate(countSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { item_id, counted_quantity } = req.body as {
      item_id: number;
      counted_quantity: number;
    };
    const [sessions] = await pool.query<SqlRow<{ status: string }>[]>(
      'SELECT status FROM inventory_sessions WHERE id = ?',
      [id]
    );
    if (!sessions[0]) throw new HttpError(404, 'Inventur nicht gefunden');
    if (sessions[0].status !== 'offen') throw new HttpError(400, 'Inventur ist abgeschlossen');

    const [result] = await pool.query(
      `UPDATE inventory_counts
       SET counted_quantity = ?, difference = ? - expected_quantity,
           counted_at = NOW(), counted_by = ?
       WHERE session_id = ? AND item_id = ?`,
      [counted_quantity, counted_quantity, req.user!.id, id, item_id]
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new HttpError(404, 'Position nicht in dieser Inventur');
    }
    res.json({ ok: true });
  })
);

inventoryRouter.post(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [sessions] = await conn.query(
        'SELECT status FROM inventory_sessions WHERE id = ? FOR UPDATE',
        [id]
      );
      const session = (sessions as Array<{ status: string }>)[0];
      if (!session) throw new HttpError(404, 'Inventur nicht gefunden');
      if (session.status !== 'offen') throw new HttpError(400, 'Inventur bereits abgeschlossen');

      const [counts] = await conn.query(
        `SELECT c.item_id, c.expected_quantity, c.counted_quantity, i.kind, i.quantity
         FROM inventory_counts c JOIN items i ON i.id = c.item_id
         WHERE c.session_id = ?`,
        [id]
      );

      for (const row of counts as Array<{
        item_id: number;
        expected_quantity: number;
        counted_quantity: number | null;
        kind: string;
        quantity: number;
      }>) {
        if (row.counted_quantity === null) continue;
        if (row.kind === 'artikel') {
          if (row.counted_quantity !== row.quantity) {
            await conn.query('UPDATE items SET quantity = ? WHERE id = ?', [
              row.counted_quantity,
              row.item_id,
            ]);
            await recordMovement(conn, {
              itemId: row.item_id,
              userId: req.user!.id,
              type: 'korrektur',
              quantity: Math.abs(row.counted_quantity - row.quantity),
              before: row.quantity,
              after: row.counted_quantity,
              note: 'Inventurdifferenz',
            });
          }
        } else if (row.counted_quantity < 1) {
          await conn.query("UPDATE items SET status = 'verloren' WHERE id = ?", [row.item_id]);
        } else {
          await conn.query(
            "UPDATE items SET status = 'verfuegbar' WHERE id = ? AND status = 'verloren'",
            [row.item_id]
          );
        }
      }

      await conn.query(
        "UPDATE inventory_sessions SET status = 'abgeschlossen', completed_at = NOW() WHERE id = ?",
        [id]
      );
      await conn.commit();
      await writeAudit({
        userId: req.user!.id,
        action: 'inventory_completed',
        targetType: 'inventory_session',
        targetId: String(id),
        ip: req.ip,
      });
      res.json({ ok: true });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

inventoryRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query<SqlRow<{ status: string }>[]>(
      'SELECT status FROM inventory_sessions WHERE id = ?',
      [id]
    );
    if (!rows[0]) throw new HttpError(404, 'Inventur nicht gefunden');
    if (rows[0].status === 'abgeschlossen') {
      throw new HttpError(400, 'Abgeschlossene Inventuren bleiben historisch erhalten');
    }
    await pool.query('DELETE FROM inventory_sessions WHERE id = ?', [id]);
    await writeAudit({
      userId: req.user!.id,
      action: 'inventory_deleted',
      targetType: 'inventory_session',
      targetId: String(id),
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);
