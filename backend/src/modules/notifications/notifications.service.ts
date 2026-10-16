import { pool } from '../../db/pool.js';

export interface NotificationInput {
  userId: number;
  type?: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/**
 * Legt eine Benachrichtigung an. Fehler dürfen den auslösenden Vorgang nicht
 * scheitern lassen (z. B. wenn der Empfänger gelöscht wurde).
 */
export async function notify(entry: NotificationInput): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, link)
       VALUES (?, ?, ?, ?, ?)`,
      [
        entry.userId,
        entry.type ?? 'system',
        entry.title,
        entry.body ?? null,
        entry.link ?? null,
      ]
    );
  } catch (err) {
    console.error('Benachrichtigung konnte nicht angelegt werden:', err);
  }
}

export async function notifyMany(
  userIds: number[],
  entry: Omit<NotificationInput, 'userId'>
): Promise<void> {
  const unique = [...new Set(userIds.filter((id) => Number.isInteger(id)))];
  await Promise.all(
    unique.map((userId) => notify({ ...entry, userId }))
  );
}
