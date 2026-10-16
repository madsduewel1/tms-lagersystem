import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireModule } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { notify, notifyMany } from '../notifications/notifications.service.js';
import { asyncHandler, parseId } from '../../utils/helpers.js';

const postSchema = z.object({
  title: z.string().max(200).nullish(),
  body: z.string().min(1).max(20000),
  pinned: z.boolean().optional(),
});
const postUpdateSchema = postSchema.partial();
const commentSchema = z.object({ body: z.string().min(1).max(8000) });

export const boardRouter = Router();
boardRouter.use(requireAuth);

boardRouter.use(requireModule('board.view', 'board.manage'));
async function activeUserIds(): Promise<number[]> {
  const [rows] = await pool.query('SELECT id FROM users WHERE active = 1');
  return (rows as Array<{ id: number }>).map((r) => r.id);
}

boardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = req.query.q ? String(req.query.q) : '';
    const params: unknown[] = [];
    let where = '';
    if (q) {
      where = 'WHERE p.title LIKE ? OR p.body LIKE ?';
      params.push(`%${q}%`, `%${q}%`);
    }
    const [rows] = await pool.query(
      `SELECT p.*, u.name AS author_name,
              (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id) AS comment_count
       FROM posts p
       LEFT JOIN users u ON u.id = p.author_id
       ${where}
       ORDER BY p.pinned DESC, p.created_at DESC`,
      params
    );
    res.json({ posts: rows });
  })
);

boardRouter.post(
  '/',
  validate(postSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof postSchema>;
    const [result] = await pool.query(
      `INSERT INTO posts (author_id, title, body, pinned) VALUES (?, ?, ?, ?)`,
      [req.user!.id, b.title ?? null, b.body, b.pinned ? 1 : 0]
    );
    const id = Number((result as { insertId: number }).insertId);
    const recipients = (await activeUserIds()).filter((uid) => uid !== req.user!.id);
    await notifyMany(recipients, {
      type: 'board',
      title: 'Neuer Beitrag auf der Pinnwand',
      body: b.title ?? b.body.slice(0, 120),
      link: '/pinnwand',
    });
    await writeAudit({
      userId: req.user!.id,
      action: 'post_created',
      targetType: 'post',
      targetId: String(id),
      ip: req.ip,
    });
    res.status(201).json({ id });
  })
);

boardRouter.patch(
  '/:id',
  validate(postUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const b = req.body as z.infer<typeof postUpdateSchema>;
    const [rows] = await pool.query('SELECT author_id FROM posts WHERE id = ?', [id]);
    const row = (rows as Array<{ author_id: number | null }>)[0];
    if (!row) throw new HttpError(404, 'Beitrag nicht gefunden');
    if (row.author_id !== req.user!.id && !req.user!.isAdmin) {
      throw new HttpError(403, 'Keine Berechtigung');
    }
    const fields: string[] = [];
    const values: unknown[] = [];
    if (b.title !== undefined) {
      fields.push('title = ?');
      values.push(b.title);
    }
    if (b.body !== undefined) {
      fields.push('body = ?');
      values.push(b.body);
    }
    if (b.pinned !== undefined) {
      fields.push('pinned = ?');
      values.push(b.pinned ? 1 : 0);
    }
    if (fields.length) {
      values.push(id);
      await pool.query(`UPDATE posts SET ${fields.join(', ')} WHERE id = ?`, values);
    }
    res.json({ ok: true });
  })
);

boardRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query('SELECT author_id FROM posts WHERE id = ?', [id]);
    const row = (rows as Array<{ author_id: number | null }>)[0];
    if (!row) throw new HttpError(404, 'Beitrag nicht gefunden');
    if (row.author_id !== req.user!.id && !req.user!.isAdmin) {
      throw new HttpError(403, 'Keine Berechtigung');
    }
    await pool.query('DELETE FROM posts WHERE id = ?', [id]);
    await writeAudit({
      userId: req.user!.id,
      action: 'post_deleted',
      targetType: 'post',
      targetId: String(id),
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);

boardRouter.get(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query(
      `SELECT c.*, u.name AS author_name
       FROM post_comments c
       LEFT JOIN users u ON u.id = c.author_id
       WHERE c.post_id = ?
       ORDER BY c.created_at ASC`,
      [id]
    );
    res.json({ comments: rows });
  })
);

boardRouter.post(
  '/:id/comments',
  validate(commentSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const b = req.body as z.infer<typeof commentSchema>;
    const [rows] = await pool.query('SELECT author_id, title FROM posts WHERE id = ?', [id]);
    const post = (rows as Array<{ author_id: number | null; title: string | null }>)[0];
    if (!post) throw new HttpError(404, 'Beitrag nicht gefunden');
    const [result] = await pool.query(
      'INSERT INTO post_comments (post_id, author_id, body) VALUES (?, ?, ?)',
      [id, req.user!.id, b.body]
    );
    const commentId = Number((result as { insertId: number }).insertId);
    if (post.author_id && post.author_id !== req.user!.id) {
      await notify({
        userId: post.author_id,
        type: 'board',
        title: 'Neuer Kommentar zu deinem Beitrag',
        body: b.body.slice(0, 120),
        link: '/pinnwand',
      });
    }
    res.status(201).json({ id: commentId });
  })
);

boardRouter.delete(
  '/:id/comments/:commentId',
  asyncHandler(async (req, res) => {
    const commentId = parseId(req.params.commentId, 'Kommentar-ID');
    const [rows] = await pool.query(
      `SELECT c.author_id, p.author_id AS post_author
       FROM post_comments c JOIN posts p ON p.id = c.post_id
       WHERE c.id = ?`,
      [commentId]
    );
    const row = (rows as Array<{ author_id: number | null; post_author: number | null }>)[0];
    if (!row) throw new HttpError(404, 'Kommentar nicht gefunden');
    const isAdmin = req.user!.isAdmin;
    if (
      row.author_id !== req.user!.id &&
      row.post_author !== req.user!.id &&
      !isAdmin
    ) {
      throw new HttpError(403, 'Keine Berechtigung');
    }
    await pool.query('DELETE FROM post_comments WHERE id = ?', [commentId]);
    res.json({ ok: true });
  })
);
