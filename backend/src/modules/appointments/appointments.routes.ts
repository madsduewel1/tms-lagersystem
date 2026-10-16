import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireModule } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, parseId } from '../../utils/helpers.js';

const schema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(8000).nullish(),
  location: z.string().max(200).nullish(),
  starts_at: z.string().min(1).max(40),
  ends_at: z.string().max(40).nullish(),
  all_day: z.boolean().optional(),
});
const updateSchema = schema.partial();

const SELECT_APPT = `
  SELECT a.*, u.name AS created_by_name
  FROM appointments a
  LEFT JOIN users u ON u.id = a.created_by`;

export const appointmentsRouter = Router();
appointmentsRouter.use(requireAuth);

appointmentsRouter.use(requireModule('calendar.view', 'calendar.manage'));
appointmentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const from = req.query.from ? String(req.query.from) : '1970-01-01';
    const to = req.query.to ? String(req.query.to) : '2999-12-31';
    const [rows] = await pool.query(
      `${SELECT_APPT}
       WHERE a.starts_at BETWEEN ? AND ?
       ORDER BY a.starts_at ASC`,
      [from, to]
    );
    res.json({ appointments: rows });
  })
);

appointmentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query(`${SELECT_APPT} WHERE a.id = ?`, [id]);
    const appointment = (rows as unknown[])[0];
    if (!appointment) throw new HttpError(404, 'Termin nicht gefunden');
    res.json({ appointment });
  })
);

appointmentsRouter.post(
  '/',
  validate(schema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof schema>;
    const [result] = await pool.query(
      `INSERT INTO appointments (title, description, location, starts_at, ends_at, all_day, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        b.title,
        b.description ?? null,
        b.location ?? null,
        new Date(b.starts_at),
        b.ends_at ? new Date(b.ends_at) : null,
        b.all_day ? 1 : 0,
        req.user!.id,
      ]
    );
    const id = Number((result as { insertId: number }).insertId);
    await writeAudit({
      userId: req.user!.id,
      action: 'appointment_created',
      targetType: 'appointment',
      targetId: String(id),
      details: { title: b.title },
      ip: req.ip,
    });
    res.status(201).json({ id });
  })
);

appointmentsRouter.patch(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const b = req.body as z.infer<typeof updateSchema>;
    const [rows] = await pool.query('SELECT created_by FROM appointments WHERE id = ?', [id]);
    const row = (rows as Array<{ created_by: number | null }>)[0];
    if (!row) throw new HttpError(404, 'Termin nicht gefunden');
    if (row.created_by !== req.user!.id && !req.user!.isAdmin) {
      throw new HttpError(403, 'Keine Berechtigung');
    }
    const fields: string[] = [];
    const values: unknown[] = [];
    const map: Record<string, unknown> = {
      title: b.title,
      description: b.description,
      location: b.location,
      all_day: b.all_day === undefined ? undefined : b.all_day ? 1 : 0,
      starts_at: b.starts_at ? new Date(b.starts_at) : undefined,
      ends_at: b.ends_at ? new Date(b.ends_at) : b.ends_at === null ? null : undefined,
    };
    for (const [key, value] of Object.entries(map)) {
      if (value !== undefined) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length) {
      values.push(id);
      await pool.query(`UPDATE appointments SET ${fields.join(', ')} WHERE id = ?`, values);
    }
    res.json({ ok: true });
  })
);

appointmentsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query('SELECT created_by FROM appointments WHERE id = ?', [id]);
    const row = (rows as Array<{ created_by: number | null }>)[0];
    if (!row) throw new HttpError(404, 'Termin nicht gefunden');
    if (row.created_by !== req.user!.id && !req.user!.isAdmin) {
      throw new HttpError(403, 'Keine Berechtigung');
    }
    await pool.query('DELETE FROM appointments WHERE id = ?', [id]);
    res.json({ ok: true });
  })
);
