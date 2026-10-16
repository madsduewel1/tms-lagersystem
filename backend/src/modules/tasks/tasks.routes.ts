import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireModule } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { notify } from '../notifications/notifications.service.js';
import { asyncHandler, parseId } from '../../utils/helpers.js';

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(8000).nullish(),
  status: z.enum(['offen', 'in_arbeit', 'erledigt', 'abgebrochen']).optional(),
  priority: z.enum(['niedrig', 'normal', 'hoch']).optional(),
  assignee_id: z.number().int().positive().nullish(),
  due_at: z.string().max(40).nullish(),
  item_id: z.number().int().positive().nullish(),
  event_id: z.number().int().positive().nullish(),
});

const updateSchema = createSchema.partial();

const SELECT_TASK = `
  SELECT t.*, ua.name AS assignee_name, uc.name AS created_by_name,
         ux.name AS completed_by_name,
         i.name AS item_name, e.name AS event_name
  FROM tasks t
  LEFT JOIN users ua ON ua.id = t.assignee_id
  LEFT JOIN users uc ON uc.id = t.created_by
  LEFT JOIN users ux ON ux.id = t.completed_by
  LEFT JOIN items i ON i.id = t.item_id
  LEFT JOIN events e ON e.id = t.event_id`;

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

tasksRouter.use(requireModule('tasks.view', 'tasks.manage'));
tasksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const where: string[] = [];
    const values: unknown[] = [];
    const { status, assignee, q, event_id, item_id } = req.query;

    if (status) {
      where.push('t.status = ?');
      values.push(String(status));
    }
    if (assignee === 'me') {
      where.push('t.assignee_id = ?');
      values.push(req.user!.id);
    } else if (assignee === 'unassigned') {
      where.push('t.assignee_id IS NULL');
    } else if (assignee) {
      where.push('t.assignee_id = ?');
      values.push(parseId(String(assignee), 'Benutzer-ID'));
    }
    if (q) {
      where.push('(t.title LIKE ? OR t.description LIKE ?)');
      values.push(`%${q}%`, `%${q}%`);
    }
    if (event_id) {
      where.push('t.event_id = ?');
      values.push(parseId(String(event_id), 'Event-ID'));
    }
    if (item_id) {
      where.push('t.item_id = ?');
      values.push(parseId(String(item_id), 'Item-ID'));
    }

    const sql = `${SELECT_TASK} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY
        (t.status IN ('erledigt','abgebrochen')) ASC,
        (t.due_at IS NULL) ASC,
        t.due_at ASC,
        t.created_at DESC`;
    const [rows] = await pool.query(sql, values);
    res.json({ tasks: rows });
  })
);

tasksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query(`${SELECT_TASK} WHERE t.id = ?`, [id]);
    const task = (rows as unknown[])[0];
    if (!task) throw new HttpError(404, 'Aufgabe nicht gefunden');
    res.json({ task });
  })
);

tasksRouter.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    const [result] = await pool.query(
      `INSERT INTO tasks (title, description, status, priority, assignee_id, created_by, due_at, item_id, event_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.title,
        b.description ?? null,
        b.status ?? 'offen',
        b.priority ?? 'normal',
        b.assignee_id ?? null,
        req.user!.id,
        b.due_at ? new Date(b.due_at) : null,
        b.item_id ?? null,
        b.event_id ?? null,
      ]
    );
    const id = Number((result as { insertId: number }).insertId);
    if (b.assignee_id && b.assignee_id !== req.user!.id) {
      await notify({
        userId: b.assignee_id,
        type: 'task',
        title: 'Neue Aufgabe zugewiesen',
        body: b.title,
        link: '/aufgaben',
      });
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'task_created',
      targetType: 'task',
      targetId: String(id),
      details: { title: b.title },
      ip: req.ip,
    });
    res.status(201).json({ id });
  })
);

tasksRouter.patch(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const b = req.body as z.infer<typeof updateSchema>;

    const [existingRows] = await pool.query(
      'SELECT assignee_id, created_by, status, title FROM tasks WHERE id = ?',
      [id]
    );
    const existing = (existingRows as Array<{
      assignee_id: number | null;
      created_by: number | null;
      status: string;
      title: string;
    }>)[0];
    if (!existing) throw new HttpError(404, 'Aufgabe nicht gefunden');

    const isAdmin = req.user!.isAdmin;
    const mayEdit =
      isAdmin || existing.created_by === req.user!.id || existing.assignee_id === req.user!.id;
    if (!mayEdit) throw new HttpError(403, 'Keine Berechtigung für diese Aufgabe');

    const fields: string[] = [];
    const values: unknown[] = [];
    const map: Record<string, unknown> = {
      title: b.title,
      description: b.description,
      status: b.status,
      priority: b.priority,
      assignee_id: b.assignee_id,
      item_id: b.item_id,
      event_id: b.event_id,
      due_at: b.due_at ? new Date(b.due_at) : b.due_at === null ? null : undefined,
    };
    for (const [key, value] of Object.entries(map)) {
      if (value !== undefined) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (b.status !== undefined) {
      if (b.status === 'erledigt') {
        fields.push('completed_at = NOW()', 'completed_by = ?');
        values.push(req.user!.id);
      } else if (existing.status === 'erledigt') {
        fields.push('completed_at = NULL', 'completed_by = NULL');
      }
    }

    if (fields.length) {
      values.push(id);
      await pool.query(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    if (
      b.assignee_id !== undefined &&
      b.assignee_id &&
      b.assignee_id !== existing.assignee_id &&
      b.assignee_id !== req.user!.id
    ) {
      await notify({
        userId: b.assignee_id,
        type: 'task',
        title: 'Aufgabe zugewiesen',
        body: b.title ?? existing.title,
        link: '/aufgaben',
      });
    }

    await writeAudit({
      userId: req.user!.id,
      action: 'task_updated',
      targetType: 'task',
      targetId: String(id),
      details: b,
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);

tasksRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query('SELECT created_by FROM tasks WHERE id = ?', [id]);
    const row = (rows as Array<{ created_by: number | null }>)[0];
    if (!row) throw new HttpError(404, 'Aufgabe nicht gefunden');
    if (row.created_by !== req.user!.id && !req.user!.isAdmin) {
      throw new HttpError(403, 'Nur der Ersteller oder ein Administrator darf löschen');
    }
    await pool.query('DELETE FROM tasks WHERE id = ?', [id]);
    await writeAudit({
      userId: req.user!.id,
      action: 'task_deleted',
      targetType: 'task',
      targetId: String(id),
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);
