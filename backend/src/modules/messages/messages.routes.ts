import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { notify } from '../notifications/notifications.service.js';
import { asyncHandler, parseId } from '../../utils/helpers.js';

const messageSchema = z.object({ body: z.string().min(1).max(8000) });

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

messagesRouter.use(requirePermission('messages.use'));
messagesRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.username,
              (SELECT GROUP_CONCAT(r.label ORDER BY r.sort SEPARATOR ', ')
               FROM user_roles ur JOIN roles r ON r.id = ur.role_id
               WHERE ur.user_id = u.id) AS role,
              (SELECT COUNT(*) FROM messages m
               WHERE m.sender_id = u.id AND m.recipient_id = ? AND m.read_at IS NULL) AS unread
       FROM users u
       WHERE u.active = 1 AND u.id <> ?
       ORDER BY u.name ASC`,
      [req.user!.id, req.user!.id]
    );
    res.json({ users: rows });
  })
);

messagesRouter.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const [rows] = await pool.query(
      `SELECT partner.id, partner.name, partner.username,
              (SELECT m.body FROM messages m
               WHERE (m.sender_id = ? AND m.recipient_id = partner.id)
                  OR (m.sender_id = partner.id AND m.recipient_id = ?)
               ORDER BY m.created_at DESC LIMIT 1) AS last_body,
              (SELECT m.created_at FROM messages m
               WHERE (m.sender_id = ? AND m.recipient_id = partner.id)
                  OR (m.sender_id = partner.id AND m.recipient_id = ?)
               ORDER BY m.created_at DESC LIMIT 1) AS last_at,
              (SELECT COUNT(*) FROM messages m
               WHERE m.sender_id = partner.id AND m.recipient_id = ? AND m.read_at IS NULL) AS unread
       FROM users partner
       WHERE partner.active = 1 AND partner.id <> ?
       HAVING last_at IS NOT NULL
       ORDER BY last_at DESC`,
      [me, me, me, me, me, me]
    );
    res.json({ conversations: rows });
  })
);

messagesRouter.get(
  '/:userId/messages',
  asyncHandler(async (req, res) => {
    const otherId = parseId(req.params.userId, 'Benutzer-ID');
    const me = req.user!.id;
    const afterId = req.query.after ? parseId(String(req.query.after), 'Nachrichten-ID') : 0;

    const [otherRows] = await pool.query('SELECT id, name FROM users WHERE id = ? AND active = 1', [
      otherId,
    ]);
    const other = (otherRows as Array<{ id: number; name: string }>)[0];
    if (!other) throw new HttpError(404, 'Benutzer nicht gefunden');

    const [rows] = await pool.query(
      `SELECT id, sender_id, recipient_id, body, read_at, created_at
       FROM messages
       WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
         AND id > ?
       ORDER BY created_at ASC
       LIMIT 500`,
      [me, otherId, otherId, me, afterId]
    );

    await pool.query(
      'UPDATE messages SET read_at = NOW() WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL',
      [otherId, me]
    );

    res.json({ partner: other, messages: rows });
  })
);

messagesRouter.post(
  '/:userId/messages',
  validate(messageSchema),
  asyncHandler(async (req, res) => {
    const recipientId = parseId(req.params.userId, 'Benutzer-ID');
    const b = req.body as z.infer<typeof messageSchema>;
    if (recipientId === req.user!.id) {
      throw new HttpError(400, 'Nachricht an sich selbst nicht möglich');
    }
    const [rows] = await pool.query('SELECT name FROM users WHERE id = ? AND active = 1', [
      recipientId,
    ]);
    if ((rows as unknown[]).length === 0) throw new HttpError(404, 'Benutzer nicht gefunden');

    const [result] = await pool.query(
      'INSERT INTO messages (sender_id, recipient_id, body) VALUES (?, ?, ?)',
      [req.user!.id, recipientId, b.body]
    );
    const id = Number((result as { insertId: number }).insertId);

    await notify({
      userId: recipientId,
      type: 'message',
      title: `Neue Nachricht von ${req.user!.name}`,
      body: b.body.slice(0, 120),
      link: `/nachrichten?to=${req.user!.id}`,
    });
    res.status(201).json({ id });
  })
);
