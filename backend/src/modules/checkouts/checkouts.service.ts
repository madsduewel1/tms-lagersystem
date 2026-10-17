import type { PoolConnection } from 'mysql2/promise';
import { HttpError } from '../../middleware/error.js';

import { recordMovement } from '../items/items.service.js';

export interface CheckoutOptions {
  itemId: number;
  eventId: number | null;
  quantity: number;
  userId: number;
  conditionOut?: string | null;
  dueAt?: string | null;
  note?: string | null;
}

export async function performCheckout(
  conn: PoolConnection,
  opts: CheckoutOptions
): Promise<number> {
  const [rows] = await conn.query(
    `SELECT id, kind, name, status, quantity FROM items WHERE id = ? FOR UPDATE`,
    [opts.itemId]
  );
  const item = (rows as Array<{
    id: number;
    kind: string;
    name: string;
    status: string;
    quantity: number;
  }>)[0];
  if (!item) throw new HttpError(404, 'Asset nicht gefunden');

  if (item.kind === 'geraet') {
    if (item.status !== 'verfuegbar') {
      throw new HttpError(409, `${item.name} ist nicht verfügbar (Status: ${item.status})`);
    }
    await conn.query(
      "UPDATE items SET status = 'ausgelagert', current_event_id = ? WHERE id = ?",
      [opts.eventId, opts.itemId]
    );
    await recordMovement(conn, {
      itemId: opts.itemId,
      userId: opts.userId,
      eventId: opts.eventId,
      type: 'ausgabe',
      quantity: 1,
      before: 0,
      after: 1,
      condition: opts.conditionOut ?? null,
      note: opts.note ?? null,
    });
    const [result] = await conn.query(
      `INSERT INTO checkouts (item_id, event_id, user_id, quantity, due_at, condition_out, note)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
      [opts.itemId, opts.eventId, opts.userId, opts.dueAt ?? null, opts.conditionOut ?? null, opts.note ?? null]
    );
    await conn.query(
      "UPDATE event_devices SET status = 'ausgegeben' WHERE event_id = ? AND item_id = ?",
      [opts.eventId, opts.itemId]
    );
    return Number((result as { insertId: number }).insertId);
  }

  if (item.quantity < opts.quantity) {
    throw new HttpError(409, `${item.name}: nur ${item.quantity} verfügbar`);
  }
  const before = item.quantity;
  const after = before - opts.quantity;
  await conn.query('UPDATE items SET quantity = ? WHERE id = ?', [after, opts.itemId]);
  await recordMovement(conn, {
    itemId: opts.itemId,
    userId: opts.userId,
    eventId: opts.eventId,
    type: 'abgang',
    quantity: opts.quantity,
    before,
    after,
    condition: opts.conditionOut ?? null,
    note: opts.note ?? null,
  });
  const [result] = await conn.query(
    `INSERT INTO checkouts (item_id, event_id, user_id, quantity, due_at, condition_out, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.itemId,
      opts.eventId,
      opts.userId,
      opts.quantity,
      opts.dueAt ?? null,
      opts.conditionOut ?? null,
      opts.note ?? null,
    ]
  );
  await conn.query(
    `UPDATE event_items SET status = 'ausgegeben' WHERE event_id = ? AND item_id = ?`,
    [opts.eventId, opts.itemId]
  );
  return Number((result as { insertId: number }).insertId);
}

// Gibt alle noch geplanten Geräte/Artikel eines Events aus. Geräte, die noch
// nicht ausgegeben wurden, müssen verfügbar sein; Mengen werden gegen den
// Bestand geprüft. Liefert die Anzahl erzeugter Ausgaben.
export async function checkoutEvent(
  conn: PoolConnection,
  eventId: number,
  userId: number
): Promise<number> {
  const [deviceRows] = await conn.query(
    `SELECT ed.item_id FROM event_devices ed
     JOIN items i ON i.id = ed.item_id
     WHERE ed.event_id = ? AND ed.status = 'geplant' AND i.status = 'verfuegbar'`,
    [eventId]
  );
  let count = 0;
  for (const row of rows(deviceRows) as Array<{ item_id: number }>) {
    await performCheckout(conn, { itemId: row.item_id, eventId, quantity: 1, userId });
    count += 1;
  }
  const [itemRows] = await conn.query(
    `SELECT ei.item_id, ei.quantity FROM event_items ei
     JOIN items i ON i.id = ei.item_id
     WHERE ei.event_id = ? AND ei.status = 'geplant'`,
    [eventId]
  );
  for (const row of itemRows as Array<{ item_id: number; quantity: number }>) {
    await performCheckout(conn, {
      itemId: row.item_id,
      eventId,
      quantity: row.quantity,
      userId,
    });
    count += 1;
  }
  return count;
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return (Array.isArray(value) ? value : []) as Array<Record<string, unknown>>;
}
