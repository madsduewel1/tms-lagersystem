import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { validate, HttpError } from '../../middleware/error.js';
import {
  requireAuth,
  setTokenCookie,
  clearTokenCookie,
  signToken,
} from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { issueCsrfCookie } from '../../middleware/csrf.js';
import type { RoleName } from '../../types/index.js';

const loginSchema = z.object({
  username: z.string().min(1).max(160),
  password: z.string().min(1).max(256),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anmeldeversuche, bitte später erneut versuchen' },
});

export const authRouter = Router();

authRouter.get('/csrf', (_req, res) => {
  const token = issueCsrfCookie(res);
  res.json({ csrfToken: token });
});

authRouter.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  async (req, res, next) => {
    try {
      const { username, password } = req.body as { username: string; password: string };
      const [rows] = await pool.query(
        `SELECT u.id, u.username, u.name, u.email, u.password_hash, u.active,
                u.last_login_at, u.must_change_password, r.name AS role
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.username = ? OR u.email = ?`,
        [username, username]
      );
      const row = (rows as Array<{
        id: number;
        username: string;
        name: string;
        email: string | null;
        password_hash: string;
        active: number;
        must_change_password: number;
        role: RoleName;
      }>)[0];

      const validPassword = row
        ? await bcrypt.compare(password, row.password_hash)
        : false;
      if (!row || !validPassword) {
        throw new HttpError(401, 'Benutzername oder Passwort falsch');
      }
      if (!row.active) {
        throw new HttpError(403, 'Benutzer ist deaktiviert');
      }

      await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [row.id]);

      const user = {
        id: row.id,
        username: row.username,
        name: row.name,
        email: row.email,
        role: row.role,
        must_change_password: !!row.must_change_password,
      };
      const token = signToken(user);
      setTokenCookie(res, token);
      await writeAudit({
        userId: row.id,
        action: 'login',
        targetType: 'user',
        targetId: String(row.id),
        ip: req.ip,
      });
      res.json({ user });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post('/logout', requireAuth, async (req, res) => {
  clearTokenCookie(res);
  await writeAudit({
    userId: req.user!.id,
    action: 'logout',
    targetType: 'user',
    targetId: String(req.user!.id),
    ip: req.ip,
  });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

const profileSchema = z.object({ name: z.string().min(1).max(128) });

authRouter.patch(
  '/profile',
  requireAuth,
  validate(profileSchema),
  async (req, res, next) => {
    try {
      const { name } = req.body as { name: string };
      await pool.query('UPDATE users SET name = ? WHERE id = ?', [name, req.user!.id]);
      await writeAudit({
        userId: req.user!.id,
        action: 'profile_updated',
        targetType: 'user',
        targetId: String(req.user!.id),
        ip: req.ip,
      });
      res.json({ user: { ...req.user!, name } });
    } catch (err) {
      next(err);
    }
  }
);

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256),
});

authRouter.post(
  '/password',
  requireAuth,
  validate(passwordSchema),
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword: string;
      };
      const [rows] = await pool.query(
        'SELECT password_hash FROM users WHERE id = ?',
        [req.user!.id]
      );
      const row = (rows as Array<{ password_hash: string }>)[0];
      if (!row || !(await bcrypt.compare(currentPassword, row.password_hash))) {
        throw new HttpError(400, 'Aktuelles Passwort ist falsch');
      }
      const hash = await bcrypt.hash(newPassword, 12);
      await pool.query(
        'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
        [hash, req.user!.id]
      );
      await writeAudit({
        userId: req.user!.id,
        action: 'password_changed',
        targetType: 'user',
        targetId: String(req.user!.id),
        ip: req.ip,
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);