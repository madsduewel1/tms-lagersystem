import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, parseId } from '../../utils/helpers.js';

const schema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(512).nullish(),
});
const updateSchema = schema.partial();

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

categoriesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query(
      `SELECT c.*, COUNT(i.id) AS item_count
       FROM categories c
       LEFT JOIN items i ON i.category_id = c.id
       GROUP BY c.id ORDER BY c.name ASC`
    );
    res.json({ categories: rows });
  })
);

categoriesRouter.post(
  '/',
  validate(schema),
  asyncHandler(async (req, res) => {
    const { name, description } = req.body as { name: string; description?: string };
    const [result] = await pool.query(
      'INSERT INTO categories (name, description) VALUES (?, ?)',
      [name, description ?? null]
    );
    const id = Number((result as { insertId: number }).insertId);
    await writeAudit({
      userId: req.user!.id,
      action: 'category_created',
      targetType: 'category',
      targetId: String(id),
      details: { name },
      ip: req.ip,
    });
    res.status(201).json({ id });
  })
);

categoriesRouter.patch(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = req.body as { name?: string; description?: string | null };
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) {
      fields.push('name = ?');
      values.push(body.name);
    }
    if (body.description !== undefined) {
      fields.push('description = ?');
      values.push(body.description);
    }
    if (fields.length) {
      values.push(id);
      await pool.query(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, values);
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'category_updated',
      targetType: 'category',
      targetId: String(id),
      details: body,
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);

categoriesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [result] = await pool.query('DELETE FROM categories WHERE id = ?', [id]);
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new HttpError(404, 'Kategorie nicht gefunden');
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'category_deleted',
      targetType: 'category',
      targetId: String(id),
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);
