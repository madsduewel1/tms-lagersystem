import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { asyncHandler, parseId, parseIntParam } from '../../utils/helpers.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const onlyUnread = req.query.unread === '1';
    const limit = parseIntParam(req.query.limit, 50, 1, 200);
    const [rows] = await pool.query(
      `SELECT id, type, title, body, link, read_at, created_at
       FROM notifications
       WHERE user_id = ?${onlyUnread ? ' AND read_at IS NULL' : ''}
       ORDER BY created_at DESC
       LIMIT ?`,
      [req.user!.id, limit]
    );
    res.json({ notifications: rows });
  })
);

notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL',
      [req.user!.id]
    );
    res.json({ count: (rows as Array<{ count: number }>)[0]?.count ?? 0 });
  })
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await pool.query(
      'UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL',
      [req.user!.id]
    );
    res.json({ ok: true });
  })
);

notificationsRouter.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [result] = await pool.query(
      'UPDATE notifications SET read_at = NOW() WHERE id = ? AND user_id = ? AND read_at IS NULL',
      [id, req.user!.id]
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      // Existiert die Benachrichtigung überhaupt für diesen Benutzer?
      const [rows] = await pool.query(
        'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
        [id, req.user!.id]
      );
      if ((rows as unknown[]).length === 0) {
        throw new HttpError(404, 'Benachrichtigung nicht gefunden');
      }
    }
    res.json({ ok: true });
  })
);

notificationsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [result] = await pool.query(
      'DELETE FROM notifications WHERE id = ? AND user_id = ?',
      [id, req.user!.id]
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new HttpError(404, 'Benachrichtigung nicht gefunden');
    }
    res.json({ ok: true });
  })
);
