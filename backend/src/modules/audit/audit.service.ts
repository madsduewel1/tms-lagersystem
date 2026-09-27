import type { PoolConnection } from 'mysql2/promise';
import { pool, type SqlRow } from '../../db/pool.js';

export interface AuditEntry {
  userId: number | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: unknown;
  ip?: string | null;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.userId,
        entry.action,
        entry.targetType ?? null,
        entry.targetId ?? null,
        entry.details === undefined || entry.details === null
          ? null
          : JSON.stringify(entry.details),
        entry.ip ?? null,
      ]
    );
  } catch (err) {
    console.error('Audit-Log konnte nicht geschrieben werden:', err);
  }
}

export async function writeAuditTx(
  conn: PoolConnection,
  entry: AuditEntry
): Promise<void> {
  await conn.query(
    `INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entry.userId,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      entry.details === undefined || entry.details === null
        ? null
        : JSON.stringify(entry.details),
      entry.ip ?? null,
    ]
  );
}

export interface AuditRow {
  id: number;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: string | null;
  ip: string | null;
  created_at: Date;
  username: string | null;
  name: string | null;
}

export async function listAudit(
  page: number,
  pageSize: number
): Promise<{ rows: AuditRow[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const [rows] = await pool.query(
    `SELECT a.id, a.action, a.target_type, a.target_id, a.details, a.ip,
            a.created_at, u.username, u.name
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );
  const [countRows] = await pool.query<SqlRow<{ total: number }>[]>(
    'SELECT COUNT(*) AS total FROM audit_logs'
  );
  return { rows: rows as AuditRow[], total: countRows[0]?.total ?? 0 };
}