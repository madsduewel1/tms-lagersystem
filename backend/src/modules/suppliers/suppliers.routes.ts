import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, parseId } from '../../utils/helpers.js';

const schema = z.object({
  name: z.string().min(1).max(160),
  contact_name: z.string().max(160).nullish(),
  email: z.string().max(160).nullish(),
  phone: z.string().max(64).nullish(),
  website: z.string().max(200).nullish(),
  customer_number: z.string().max(64).nullish(),
  address: z.string().max(512).nullish(),
  notes: z.string().max(4000).nullish(),
});
const updateSchema = schema.partial();

export const suppliersRouter = Router();
suppliersRouter.use(requireAuth);

suppliersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query(
      `SELECT s.*, COUNT(i.id) AS item_count
       FROM suppliers s
       LEFT JOIN items i ON i.supplier_id = s.id
       GROUP BY s.id ORDER BY s.name ASC`
    );
    res.json({ suppliers: rows });
  })
);

suppliersRouter.post(
  '/',
  validate(schema),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const [result] = await pool.query(
      `INSERT INTO suppliers (name, contact_name, email, phone, website, customer_number, address, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.name,
        b.contact_name ?? null,
        b.email ?? null,
        b.phone ?? null,
        b.website ?? null,
        b.customer_number ?? null,
        b.address ?? null,
        b.notes ?? null,
      ]
    );
    const id = Number((result as { insertId: number }).insertId);
    await writeAudit({
      userId: req.user!.id,
      action: 'supplier_created',
      targetType: 'supplier',
      targetId: String(id),
      details: { name: b.name },
      ip: req.ip,
    });
    res.status(201).json({ id });
  })
);

suppliersRouter.patch(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const b = req.body as Record<string, unknown>;
    const allowed = [
      'name',
      'contact_name',
      'email',
      'phone',
      'website',
      'customer_number',
      'address',
      'notes',
    ];
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of allowed) {
      if (b[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(b[key]);
      }
    }
    if (fields.length) {
      values.push(id);
      await pool.query(`UPDATE suppliers SET ${fields.join(', ')} WHERE id = ?`, values);
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'supplier_updated',
      targetType: 'supplier',
      targetId: String(id),
      details: b,
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);

suppliersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [result] = await pool.query('DELETE FROM suppliers WHERE id = ?', [id]);
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new HttpError(404, 'Lieferant nicht gefunden');
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'supplier_deleted',
      targetType: 'supplier',
      targetId: String(id),
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);
