import { Router } from 'express';
import { z } from 'zod';
import type { PoolConnection } from 'mysql2/promise';
import { pool, type SqlRow } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, parseId, parseIntParam } from '../../utils/helpers.js';

import { recordMovement } from '../items/items.service.js';

const checkoutSchema = z.object({
  item_id: z.coerce.number().int().positive(),
  event_id: z.coerce.number().int().positive().nullish(),
  quantity: z.coerce.number().int().min(1).default(1),
  condition_out: z.enum(['neu', 'gut', 'gebraucht', 'defekt']).nullish(),
  due_at: z.string().max(32).nullish(),
  note: z.string().max(512).nullish(),
});

const returnSchema = z.object({
  condition_in: z.enum(['neu', 'gut', 'gebraucht', 'defekt']).nullish(),
  note: z.string().max(512).nullish(),
});

export const checkoutsRouter = Router();
checkoutsRouter.use(requireAuth);

async function performCheckout(
  conn: PoolConnection,
  opts: {
    itemId: number;
    eventId: number | null;
    quantity: number;
    userId: number;
    conditionOut?: string | null;
    dueAt?: string | null;
    note?: string | null;
  }
): Promise<number> {
  const [rows] = await conn.query(
    `SELECT id, kind, name, status, quantity FROM items WHERE id = ? FOR UPDATE`,
    [opts.itemId]
  );
  const item = (rows as Array<{
    id: number;
    kind: string;
    name: string;
    status: string;
    quantity: number;
  }>)[0];
  if (!item) throw new HttpError(404, 'Asset nicht gefunden');

  if (item.kind === 'geraet') {
    if (item.status !== 'verfuegbar') {
      throw new HttpError(409, `${item.name} ist nicht verfügbar (Status: ${item.status})`);
    }
    await conn.query(
      "UPDATE items SET status = 'ausgelagert', current_event_id = ? WHERE id = ?",
      [opts.eventId, opts.itemId]
    );
    await recordMovement(conn, {
      itemId: opts.itemId,
      userId: opts.userId,
      eventId: opts.eventId,
      type: 'ausgabe',
      quantity: 1,
      before: 0,
      after: 1,
      condition: opts.conditionOut ?? null,
      note: opts.note ?? null,
    });
    const [result] = await conn.query(
      `INSERT INTO checkouts (item_id, event_id, user_id, quantity, due_at, condition_out, note)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
      [opts.itemId, opts.eventId, opts.userId, opts.dueAt ?? null, opts.conditionOut ?? null, opts.note ?? null]
    );
    await conn.query(
      "UPDATE event_devices SET status = 'ausgegeben' WHERE event_id = ? AND item_id = ?",
      [opts.eventId, opts.itemId]
    );
    return Number((result as { insertId: number }).insertId);
  }

  if (item.quantity < opts.quantity) {
    throw new HttpError(
      409,
      `Nur ${item.quantity} Stück von ${item.name} verfügbar`
    );
  }
  const before = item.quantity;
  const after = before - opts.quantity;
  await conn.query('UPDATE items SET quantity = ? WHERE id = ?', [after, opts.itemId]);
  await recordMovement(conn, {
    itemId: opts.itemId,
    userId: opts.userId,
    eventId: opts.eventId,
    type: 'abgang',
    quantity: opts.quantity,
    before,
    after,
    condition: opts.conditionOut ?? null,
    note: opts.note ?? null,
  });
  const [result] = await conn.query(
    `INSERT INTO checkouts (item_id, event_id, user_id, quantity, due_at, condition_out, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.itemId,
      opts.eventId,
      opts.userId,
      opts.quantity,
      opts.dueAt ?? null,
      opts.conditionOut ?? null,
      opts.note ?? null,
    ]
  );
  await conn.query(
    `UPDATE event_items SET status = 'ausgegeben' WHERE event_id = ? AND item_id = ?`,
    [opts.eventId, opts.itemId]
  );
  return Number((result as { insertId: number }).insertId);
}

checkoutsRouter.get(
  '/open',
  asyncHandler(async (req, res) => {
    const eventId = req.query.eventId ? Number(req.query.eventId) : undefined;
    const params: unknown[] = [];
    let where = "WHERE c.status = 'offen'";
    if (eventId) {
      where += ' AND c.event_id = ?';
      params.push(eventId);
    }
    const [rows] = await pool.query(
      `SELECT c.*, i.name, i.manufacturer, i.model, i.inventory_number, i.serial_number,
              i.kind, i.unit, e.name AS event_name, u.name AS user_name
       FROM checkouts c
       JOIN items i ON i.id = c.item_id
       LEFT JOIN events e ON e.id = c.event_id
       LEFT JOIN users u ON u.id = c.user_id
       ${where} ORDER BY c.checked_out_at DESC`,
      params
    );
    res.json({ checkouts: rows });
  })
);

checkoutsRouter.get(
  '/history',
  asyncHandler(async (req, res) => {
    const limit = parseIntParam(req.query.limit, 100, 1, 200);

    const [rows] = await pool.query(
      `SELECT r.*, i.name, i.inventory_number, i.kind, i.unit,
              e.name AS event_name, u.name AS user_name
       FROM returns r
       JOIN items i ON i.id = r.item_id
       LEFT JOIN events e ON e.id = r.event_id
       LEFT JOIN users u ON u.id = r.user_id
       ORDER BY r.returned_at DESC LIMIT ?`,
      [limit]
    );
    res.json({ returns: rows });
  })
);

checkoutsRouter.post(
  '/',
  validate(checkoutSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as {
      item_id: number;
      event_id?: number | null;
      quantity: number;
      condition_out?: string | null;
      due_at?: string | null;
      note?: string | null;
    };
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const id = await performCheckout(conn, {
        itemId: b.item_id,
        eventId: b.event_id ?? null,
        quantity: b.quantity,
        userId: req.user!.id,
        conditionOut: b.condition_out,
        dueAt: b.due_at,
        note: b.note,
      });
      await conn.commit();
      await writeAudit({
        userId: req.user!.id,
        action: 'checkout',
        targetType: 'item',
        targetId: String(b.item_id),
        details: { event_id: b.event_id ?? null, quantity: b.quantity },
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

checkoutsRouter.post(
  '/event/:eventId',
  asyncHandler(async (req, res) => {
    const eventId = parseId(req.params.eventId, 'Event-ID');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        `SELECT ed.item_id FROM event_devices ed
         JOIN items i ON i.id = ed.item_id
         WHERE ed.event_id = ? AND ed.status = 'geplant' AND i.status = 'verfuegbar'`,
        [eventId]
      );
      let count = 0;
      for (const row of rows as Array<{ item_id: number }>) {
        await performCheckout(conn, {
          itemId: row.item_id,
          eventId,
          quantity: 1,
          userId: req.user!.id,
        });
        count += 1;
      }
      const [itemRows] = await conn.query(
        `SELECT ei.item_id, ei.quantity FROM event_items ei
         JOIN items i ON i.id = ei.item_id
         WHERE ei.event_id = ? AND ei.status = 'geplant'`,
        [eventId]
      );
      for (const row of itemRows as Array<{ item_id: number; quantity: number }>) {
        await performCheckout(conn, {
          itemId: row.item_id,
          eventId,
          quantity: row.quantity,
          userId: req.user!.id,
        });
        count += 1;
      }
      await conn.commit();
      await writeAudit({
        userId: req.user!.id,
        action: 'event_checkout',
        targetType: 'event',
        targetId: String(eventId),
        details: { count },
        ip: req.ip,
      });
      res.json({ ok: true, count });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

checkoutsRouter.post(
  '/:id/return',
  validate(returnSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id, 'Ausgabe-ID');
    const { condition_in, note } = req.body as {
      condition_in?: string | null;
      note?: string | null;
    };
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        'SELECT * FROM checkouts WHERE id = ? FOR UPDATE',
        [id]
      );
      const checkout = (rows as Array<{
        id: number;
        item_id: number;
        event_id: number | null;
        quantity: number;
        status: string;
      }>)[0];
      if (!checkout) throw new HttpError(404, 'Ausgabe nicht gefunden');
      if (checkout.status !== 'offen') throw new HttpError(400, 'Bereits zurückgegeben');

      const [itemRows] = await conn.query(
        'SELECT kind, quantity, status FROM items WHERE id = ? FOR UPDATE',
        [checkout.item_id]
      );
      const item = (itemRows as Array<{ kind: string; quantity: number; status: string }>)[0];
if (!item) throw new HttpError(404, 'Asset nicht gefunden');

      const damaged = condition_in === 'defekt';
      if (item.kind === 'geraet') {
        const newStatus = damaged ? 'defekt' : 'verfuegbar';
        await conn.query(
          'UPDATE items SET status = ?, current_event_id = NULL WHERE id = ?',
          [newStatus, checkout.item_id]
        );
      } else {
        const before = item.quantity;
        const after = before + checkout.quantity;
        await conn.query('UPDATE items SET quantity = ? WHERE id = ?', [after, checkout.item_id]);
        await recordMovement(conn, {
          itemId: checkout.item_id,
          userId: req.user!.id,
          eventId: checkout.event_id,
          type: 'rueckgabe',
          quantity: checkout.quantity,
          before,
          after,
          condition: condition_in ?? null,
          note: note ?? null,
        });
      }

      await conn.query(
        `UPDATE checkouts SET status = 'zurueck', returned_at = NOW(), condition_in = ?
         WHERE id = ?`,
        [condition_in ?? null, id]
      );
      await conn.query(
        `INSERT INTO returns (checkout_id, item_id, event_id, user_id, quantity, \`condition\`, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          checkout.item_id,
          checkout.event_id,
          req.user!.id,
          checkout.quantity,
          condition_in ?? null,
          note ?? null,
        ]
      );
      if (checkout.event_id) {
        await conn.query(
          `UPDATE event_devices SET status = 'zurueck' WHERE event_id = ? AND item_id = ?`,
          [checkout.event_id, checkout.item_id]
        );
        await conn.query(
          `UPDATE event_items SET status = 'zurueck' WHERE event_id = ? AND item_id = ?`,
          [checkout.event_id, checkout.item_id]
        );
      }
      await conn.commit();
      await writeAudit({
        userId: req.user!.id,
        action: 'return',
        targetType: 'item',
        targetId: String(checkout.item_id),
        details: { checkout_id: id, condition_in: condition_in ?? null },
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

export type { SqlRow };
