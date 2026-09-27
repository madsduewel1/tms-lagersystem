import { Router } from 'express';
import { z } from 'zod';
import type { PoolConnection } from 'mysql2/promise';
import { pool } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, newToken, parseId } from '../../utils/helpers.js';
import { getSetting, recordMovement } from '../items/items.service.js';

const statusEnum = z.enum(['geplant', 'bestellt', 'geliefert', 'abgeschlossen', 'storniert']);

const schema = z.object({
  title: z.string().min(1).max(200),
  item_id: z.coerce.number().int().positive().nullish(),
  quantity: z.coerce.number().int().min(1).default(1),
  supplier_id: z.coerce.number().int().positive().nullish(),
  planned_price: z.coerce.number().min(0).nullish(),
  actual_price: z.coerce.number().min(0).nullish(),
  status: statusEnum.optional(),
  notes: z.string().max(8000).nullish(),
});
const updateSchema = schema.partial();

const deliverSchema = z.object({
  apply_to_stock: z.boolean().default(false),
  category_id: z.coerce.number().int().positive().nullish(),
  storage_location_id: z.coerce.number().int().positive().nullish(),
  kind: z.enum(['artikel', 'geraet']).default('artikel'),
});

async function applyToStock(
  conn: PoolConnection,
  purchase: {
    id: number;
    title: string;
    item_id: number | null;
    quantity: number;
    supplier_id: number | null;
    planned_price: number | null;
    actual_price: number | null;
  },
  opts: {
    category_id?: number | null;
    storage_location_id?: number | null;
    kind: 'artikel' | 'geraet';
    userId: number;
  }
): Promise<void> {
  if (purchase.item_id) {
    const [rows] = await conn.query(
      'SELECT kind, quantity FROM items WHERE id = ? FOR UPDATE',
      [purchase.item_id]
    );
    const item = (rows as Array<{ kind: string; quantity: number }>)[0];
    if (!item) throw new HttpError(404, 'Verknüpfter Artikel nicht gefunden');
    if (item.kind === 'artikel') {
      const before = item.quantity;
      const after = before + purchase.quantity;
      await conn.query('UPDATE items SET quantity = ? WHERE id = ?', [after, purchase.item_id]);
      await recordMovement(conn, {
        itemId: purchase.item_id,
        userId: opts.userId,
        type: 'zugang',
        quantity: purchase.quantity,
        before,
        after,
        note: `Beschaffung: ${purchase.title}`,
      });
    }
    return;
  }

  const prefix = await getSetting('inventory_prefix', 'TMS-');
  const price = purchase.actual_price ?? purchase.planned_price;
  if (opts.kind === 'artikel') {
    const [result] = await conn.query(
      `INSERT INTO items (kind, name, category_id, storage_location_id, quantity, unit,
         purchase_price, supplier_id, qr_token)
       VALUES ('artikel', ?, ?, ?, ?, 'Stk', ?, ?, ?)`,
      [
        purchase.title,
        opts.category_id ?? null,
        opts.storage_location_id ?? null,
        purchase.quantity,
        price,
        purchase.supplier_id,
        newToken(),
      ]
    );
    const itemId = Number((result as { insertId: number }).insertId);
    await recordMovement(conn, {
      itemId,
      userId: opts.userId,
      type: 'zugang',
      quantity: purchase.quantity,
      before: 0,
      after: purchase.quantity,
      note: `Beschaffung: ${purchase.title}`,
    });
    await conn.query('UPDATE purchases SET item_id = ? WHERE id = ?', [itemId, purchase.id]);
  } else {
    for (let i = 0; i < purchase.quantity; i += 1) {
      const [result] = await conn.query(
        `INSERT INTO items (kind, name, category_id, storage_location_id, status,
           purchase_price, supplier_id, qr_token)
         VALUES ('geraet', ?, ?, ?, 'verfuegbar', ?, ?, ?)`,
        [
          purchase.title,
          opts.category_id ?? null,
          opts.storage_location_id ?? null,
          price,
          purchase.supplier_id,
          newToken(),
        ]
      );
      const itemId = Number((result as { insertId: number }).insertId);
      await conn.query('UPDATE items SET inventory_number = ? WHERE id = ?', [
        `${prefix}${String(itemId).padStart(5, '0')}`,
        itemId,
      ]);
    }
  }
}

export const purchasesRouter = Router();
purchasesRouter.use(requireAuth);

purchasesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query(
      `SELECT p.*, i.name AS item_name, i.inventory_number, s.name AS supplier_name,
              u.name AS created_by_name
       FROM purchases p
       LEFT JOIN items i ON i.id = p.item_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN users u ON u.id = p.created_by
       ORDER BY p.created_at DESC`
    );
    res.json({ purchases: rows });
  })
);

purchasesRouter.post(
  '/',
  validate(schema),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const [result] = await pool.query(
      `INSERT INTO purchases (title, item_id, quantity, supplier_id, planned_price, actual_price, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.title,
        b.item_id ?? null,
        b.quantity ?? 1,
        b.supplier_id ?? null,
        b.planned_price ?? null,
        b.actual_price ?? null,
        b.status ?? 'geplant',
        b.notes ?? null,
        req.user!.id,
      ]
    );
    const id = Number((result as { insertId: number }).insertId);
    await writeAudit({
      userId: req.user!.id,
      action: 'purchase_created',
      targetType: 'purchase',
      targetId: String(id),
      details: { title: b.title },
      ip: req.ip,
    });
    res.status(201).json({ id });
  })
);

purchasesRouter.patch(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const b = req.body as Record<string, unknown>;
    const allowed = [
      'title',
      'item_id',
      'quantity',
      'supplier_id',
      'planned_price',
      'actual_price',
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
    if (b.status === 'bestellt') fields.push('ordered_at = NOW()');
    if (b.status === 'geliefert' || b.status === 'abgeschlossen') {
      fields.push('delivered_at = NOW()');
    }
    if (fields.length) {
      values.push(id);
      await pool.query(`UPDATE purchases SET ${fields.join(', ')} WHERE id = ?`, values);
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'purchase_updated',
      targetType: 'purchase',
      targetId: String(id),
      details: b,
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);

purchasesRouter.post(
  '/:id/deliver',
  validate(deliverSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const opts = req.body as {
      apply_to_stock: boolean;
      category_id?: number | null;
      storage_location_id?: number | null;
      kind: 'artikel' | 'geraet';
    };
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query('SELECT * FROM purchases WHERE id = ? FOR UPDATE', [id]);
      const purchase = (
        rows as Array<{
          id: number;
          title: string;
          item_id: number | null;
          quantity: number;
          supplier_id: number | null;
          planned_price: number | null;
          actual_price: number | null;
        }>
      )[0];
      if (!purchase) throw new HttpError(404, 'Beschaffung nicht gefunden');

      if (opts.apply_to_stock) {
        await applyToStock(conn, purchase, { ...opts, userId: req.user!.id });
      }
      await conn.query(
        "UPDATE purchases SET status = 'abgeschlossen', delivered_at = NOW() WHERE id = ?",
        [id]
      );
      await conn.commit();
      await writeAudit({
        userId: req.user!.id,
        action: 'purchase_delivered',
        targetType: 'purchase',
        targetId: String(id),
        details: { apply_to_stock: opts.apply_to_stock },
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

purchasesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [result] = await pool.query('DELETE FROM purchases WHERE id = ?', [id]);
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new HttpError(404, 'Beschaffung nicht gefunden');
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'purchase_deleted',
      targetType: 'purchase',
      targetId: String(id),
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);
