import type { PoolConnection } from 'mysql2/promise';
import { pool, type SqlRow } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { newToken } from '../../utils/helpers.js';

export type ItemKind = 'geraet' | 'artikel';

export interface ItemFilters {
  q?: string;
  categoryId?: number;
  status?: string;
  locationId?: number;
  supplierId?: number;
  kind?: ItemKind;
  lowStock?: boolean;
  sort?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export const ITEM_SELECT = `
  SELECT i.*,
    c.name AS category_name,
    s.name AS supplier_name,
    l.name AS location_name,
    CONCAT_WS(' / ', lpp.name, lp.name, l.name) AS location_path,
    cj.case_id AS case_id,
    k.name AS case_name,
    k.code AS case_code,
    CONCAT_WS(' / ', clpp.name, clp.name, cl.name) AS case_location_path,
    e.name AS event_name
  FROM items i
  LEFT JOIN categories c ON c.id = i.category_id
  LEFT JOIN suppliers s ON s.id = i.supplier_id
  LEFT JOIN storage_locations l ON l.id = i.storage_location_id
  LEFT JOIN storage_locations lp ON lp.id = l.parent_id
  LEFT JOIN storage_locations lpp ON lpp.id = lp.parent_id
  LEFT JOIN (
    SELECT ci.item_id,
           SUBSTRING_INDEX(
             GROUP_CONCAT(ci.case_id ORDER BY ci.quantity DESC, ci.id ASC),
             ',', 1) AS case_id
    FROM case_items ci
    GROUP BY ci.item_id
  ) cj ON cj.item_id = i.id
  LEFT JOIN cases k ON k.id = cj.case_id
  LEFT JOIN storage_locations cl ON cl.id = k.storage_location_id
  LEFT JOIN storage_locations clp ON clp.id = cl.parent_id
  LEFT JOIN storage_locations clpp ON clpp.id = clp.parent_id
  LEFT JOIN events e ON e.id = i.current_event_id
`;

function buildFilter(filters: ItemFilters): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.kind) {
    clauses.push('i.kind = ?');
    params.push(filters.kind);
  }
  if (filters.categoryId) {
    clauses.push('i.category_id = ?');
    params.push(filters.categoryId);
  }
  if (filters.status) {
    clauses.push('i.status = ?');
    params.push(filters.status);
  }
  if (filters.locationId) {
    clauses.push('i.storage_location_id = ?');
    params.push(filters.locationId);
  }
  if (filters.supplierId) {
    clauses.push('i.supplier_id = ?');
    params.push(filters.supplierId);
  }
  if (filters.lowStock) {
    clauses.push('i.kind = ? AND i.min_stock IS NOT NULL AND i.quantity < i.min_stock');
    params.push('artikel');
  }
  if (filters.q) {
    const like = `%${filters.q}%`;
    clauses.push(
      `(i.name LIKE ? OR i.manufacturer LIKE ? OR i.model LIKE ? OR i.inventory_number LIKE ?
        OR i.serial_number LIKE ? OR i.article_number LIKE ? OR i.description LIKE ?)`
    );
    params.push(like, like, like, like, like, like, like);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

const SORTABLE = new Set([
  'name',
  'inventory_number',
  'status',
  'quantity',
  'updated_at',
  'created_at',
  'manufacturer',
]);

export async function listItems(
  filters: ItemFilters
): Promise<{ rows: SqlRow<Record<string, unknown>>[]; total: number }> {
  const { where, params } = buildFilter(filters);
  const sortCol = SORTABLE.has(filters.sort ?? '') ? filters.sort : 'name';
  const order = filters.order === 'desc' ? 'DESC' : 'ASC';

  const [rows] = await pool.query<SqlRow<Record<string, unknown>>[]>(
    `${ITEM_SELECT} ${where} ORDER BY i.${sortCol} ${order} LIMIT ? OFFSET ?`,
    [...params, filters.limit ?? 50, filters.offset ?? 0]
  );
  const [countRows] = await pool.query<SqlRow<{ total: number }>[]>(
    `SELECT COUNT(*) AS total FROM items i ${where}`,
    params
  );
  return { rows, total: countRows[0]?.total ?? 0 };
}

export async function getItem(id: number): Promise<SqlRow<Record<string, unknown>> | null> {
  const [rows] = await pool.query<SqlRow<Record<string, unknown>>[]>(
    `${ITEM_SELECT} WHERE i.id = ?`,
    [id]
  );
  return rows[0] ?? null;
}

export interface ItemInput {
  kind: ItemKind;
  name: string;
  manufacturer?: string | null;
  model?: string | null;
  article_number?: string | null;
  category_id?: number | null;
  storage_location_id?: number | null;
  case_id?: number | null;
  quantity?: number;
  unit?: string | null;
  min_stock?: number | null;
  inventory_number?: string | null;
  serial_number?: string | null;
  status?: string | null;
  condition?: string | null;
  purchase_price?: number | null;
  purchase_date?: string | null;
  current_value?: number | null;
  warranty?: string | null;
  supplier_id?: number | null;
  description?: string | null;
  technical_data?: string | null;
  manual_url?: string | null;
  notes?: string | null;
}

const CATEGORY_CODES: Record<string, string> = {
  Audio: 'AUD',
  Licht: 'LGT',
  Video: 'VID',
  Strom: 'STR',
  Kabel: 'KBL',
  Netzwerk: 'NET',
  Cases: 'CSS',
  Stative: 'STA',
  Zubehör: 'ZUB',
  Zubehoer: 'ZUB',
  Verbrauchsmaterial: 'VER',
  Sonstiges: 'SON',
};

function categoryCode(name: string | null | undefined): string {
  if (!name) return 'GEN';
  const direct = CATEGORY_CODES[name.trim()];
  if (direct) return direct;
  const cleaned = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 3);
  return cleaned || 'GEN';
}

export async function createItem(
  input: ItemInput,
  userId: number
): Promise<number> {
  const [result] = await pool.query(
    `INSERT INTO items
      (kind, name, manufacturer, model, article_number, category_id, storage_location_id,
       quantity, unit, min_stock, inventory_number, serial_number, status, \`condition\`,
       purchase_price, purchase_date, current_value, warranty, supplier_id,
       description, technical_data, manual_url, notes, qr_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.kind,
      input.name,
      input.manufacturer ?? null,
      input.model ?? null,
      input.article_number ?? null,
      input.category_id ?? null,
      input.storage_location_id ?? null,
      input.kind === 'artikel' ? input.quantity ?? 0 : Math.max(1, input.quantity ?? 1),
      input.unit ?? 'Stk',
      input.min_stock ?? null,
      input.inventory_number ?? null,
      input.serial_number ?? null,
      input.status ?? 'verfuegbar',
      input.condition ?? null,
      input.purchase_price ?? null,
      input.purchase_date ?? null,
      input.current_value ?? null,
      input.warranty ?? null,
      input.supplier_id ?? null,
      input.description ?? null,
      input.technical_data ?? null,
      input.manual_url ?? null,
      input.notes ?? null,
      newToken(),
    ]
  );
  const id = Number((result as { insertId: number }).insertId);

  if (input.kind === 'geraet' && !input.inventory_number) {
    const prefix = await getSetting('inventory_prefix', 'TMS-');
    const [cats] = await pool.query<SqlRow<{ name: string }>[]>(
      'SELECT name FROM categories WHERE id = ?',
      [input.category_id ?? 0]
    );
    const code = categoryCode(cats[0]?.name);
    const inventoryNumber = `${prefix}${code}-${String(id).padStart(4, '0')}`;
    await pool.query('UPDATE items SET inventory_number = ? WHERE id = ?', [
      inventoryNumber,
      id,
    ]);
  }

  if (input.kind === 'artikel' && (input.quantity ?? 0) > 0) {
    await pool.query(
      `INSERT INTO stock_movements (item_id, user_id, type, quantity, before_quantity, after_quantity, note)
       VALUES (?, ?, 'zugang', ?, 0, ?, 'Anfangsbestand')`,
      [id, userId, input.quantity, input.quantity]
    );
  }

  if (input.case_id) {
    await assignToCase(id, input.case_id, input.quantity ?? 1);
  }
  return id;
}

async function assignToCase(
  itemId: number,
  caseId: number,
  quantity: number
): Promise<void> {
  const qty = Math.max(1, quantity);
  await pool.query(
    `INSERT INTO case_items (case_id, item_id, quantity, note) VALUES (?, ?, ?, NULL)`,
    [caseId, itemId, qty]
  );
}

export async function updateItem(
  id: number,
  input: Partial<ItemInput>,
  userId: number
): Promise<void> {
  const existing = await getItem(id);
  if (!existing) throw new HttpError(404, 'Asset nicht gefunden');

  const fields: string[] = [];
  const values: unknown[] = [];
  const directFields: (keyof ItemInput)[] = [
    'name',
    'manufacturer',
    'model',
    'article_number',
    'category_id',
    'storage_location_id',
    'unit',
    'min_stock',
    'inventory_number',
    'serial_number',
    'status',
    'condition',
    'purchase_price',
    'purchase_date',
    'current_value',
    'warranty',
    'supplier_id',
    'description',
    'technical_data',
    'manual_url',
    'notes',
  ];
  for (const key of directFields) {
    if (input[key] !== undefined) {
      fields.push(`\`${key}\` = ?`);
      values.push(input[key]);
    }
  }

  if (input.quantity !== undefined) {
    const before = Number(existing.quantity ?? 0);
    fields.push('quantity = ?');
    values.push(input.quantity);
    if (existing.kind === 'artikel') {
      await pool.query(
        `INSERT INTO stock_movements (item_id, user_id, type, quantity, before_quantity, after_quantity, note)
         VALUES (?, ?, 'korrektur', ?, ?, ?, 'Bestand geändert')`,
        [id, userId, Math.abs(input.quantity - before), before, input.quantity]
      );
    }
  }

  if (fields.length === 0 && input.case_id === undefined) return;

  // Case-Zuordnung verwalten (ein Asset steckt in genau einem Case)
  if (input.case_id !== undefined) {
    await pool.query('DELETE FROM case_items WHERE item_id = ?', [id]);
    if (input.case_id) {
      await assignToCase(id, input.case_id, Number(existing.quantity ?? 1));
    }
  }

  if (fields.length === 0) return;
  values.push(id);
  await pool.query(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function deleteItem(id: number): Promise<void> {
  const [result] = await pool.query('DELETE FROM items WHERE id = ?', [id]);
  if ((result as { affectedRows: number }).affectedRows === 0) {
    throw new HttpError(404, 'Asset nicht gefunden');
  }
}

export async function adjustQuantity(
  id: number,
  delta: number,
  userId: number
): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT quantity, kind FROM items WHERE id = ? FOR UPDATE', [id]);
    const row = (rows as Array<{ quantity: number; kind: string }>)[0];
    if (!row) throw new HttpError(404, 'Asset nicht gefunden');
    if (row.kind !== 'artikel') throw new HttpError(400, 'Kein Mengenartikel');
    const before = Number(row.quantity);
    const after = before + delta;
    await conn.query('UPDATE items SET quantity = ? WHERE id = ?', [after, id]);
    await conn.query(
      `INSERT INTO stock_movements (item_id, user_id, type, quantity, before_quantity, after_quantity, note)
       VALUES (?, ?, 'korrektur', ?, ?, ?, 'Bestandsänderung')`,
      [id, userId, Math.abs(delta), before, after]
    );
    await conn.commit();
    return after;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getSetting(key: string, fallback: string): Promise<string> {
  const [rows] = await pool.query<SqlRow<{ setting_value: string | null }>[]>(
    'SELECT setting_value FROM settings WHERE setting_key = ?',
    [key]
  );
  return rows[0]?.setting_value ?? fallback;
}

export async function recordMovement(
  conn: PoolConnection,
  entry: {
    itemId: number;
    userId: number | null;
    eventId?: number | null;
    type: string;
    quantity: number;
    before: number;
    after: number;
    condition?: string | null;
    note?: string | null;
  }
): Promise<void> {
  await conn.query(
    `INSERT INTO stock_movements
      (item_id, user_id, event_id, type, quantity, before_quantity, after_quantity, \`condition\`, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.itemId,
      entry.userId,
      entry.eventId ?? null,
      entry.type,
      entry.quantity,
      entry.before,
      entry.after,
      entry.condition ?? null,
      entry.note ?? null,
    ]
  );
}
