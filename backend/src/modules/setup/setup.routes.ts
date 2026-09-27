import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, type SqlRow } from '../../db/pool.js';
import { validate, HttpError } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { issueCsrfCookie } from '../../middleware/csrf.js';

const initSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'Ungültiger Benutzername'),
  name: z.string().min(1).max(128),
  email: z.string().email('Ungültige E-Mail-Adresse').max(160).nullable().optional(),
  password: z.string().min(8).max(256),
});

async function userCount(): Promise<number> {
  const [rows] = await pool.query<SqlRow<{ count: number }>[]>(
    'SELECT COUNT(*) AS count FROM users'
  );
  return rows[0]?.count ?? 0;
}

export const setupRouter = Router();

setupRouter.get('/status', async (_req, res, next) => {
  try {
    res.json({ setupRequired: (await userCount()) === 0 });
  } catch (err) {
    next(err);
  }
});

setupRouter.post('/init', validate(initSchema), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const { username, name, email, password } = req.body as {
      username: string;
      name: string;
      email?: string | null;
      password: string;
    };
    const hash = await bcrypt.hash(password, 12);

    await connection.beginTransaction();
    // Namens-Sperre auf `users` serialisiert gleichzeitige Ersteinrichtungen.
    // Ohne diese Sperre konnten zwei parallele Requests beide `userCount() === 0`
    // sehen und je einen Administrator anlegen.
    // `roles` muss mitgesperrt werden: darunter liegt eine Subquery, und bei
    // aktivem LOCK TABLES ist jeder Zugriff auf eine nicht gesperrte Tabelle
    // ein Fehler ("Table 'roles' was not locked with LOCK TABLES", errno 1100).
    await connection.query('LOCK TABLES users WRITE, roles READ');
    try {
      const [countRows] = await connection.query<SqlRow<{ count: number }>[]>(
        'SELECT COUNT(*) AS count FROM users'
      );
      if ((countRows[0]?.count ?? 0) > 0) {
        throw new HttpError(403, 'Ersteinrichtung bereits abgeschlossen');
      }
      const [result] = await connection.query(
        `INSERT INTO users (username, name, email, password_hash, role_id)
         VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE name = 'administrator'))`,
        [username, name, email ?? null, hash]
      );
      const userId = Number((result as { insertId: number }).insertId);
      await connection.query('UNLOCK TABLES');
      await connection.commit();

      await writeAudit({
        userId,
        action: 'setup_complete',
        targetType: 'user',
        targetId: String(userId),
        details: { username },
        ip: req.ip,
      });
      issueCsrfCookie(res);
      res.status(201).json({ ok: true });
    } catch (err) {
      // UNLOCK TABLES würde bei einem Fehler implizit beim COMMIT/ROLLBACK
      // passieren, aber explizit ist hier sauberer.
      try {
        await connection.query('UNLOCK TABLES');
      } catch {
        // ignorieren
      }
      throw err;
    }
  } catch (err) {
    try {
      await connection.rollback();
    } catch {
      // ignorieren
    }
    next(err);
  } finally {
    connection.release();
  }
});
