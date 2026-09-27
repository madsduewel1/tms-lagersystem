import { Router } from 'express';
import { z } from 'zod';
import { pool, type SqlRow } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, newToken, parseId } from '../../utils/helpers.js';

const schema = z.object({
  parent_id: z.coerce.number().int().positive().nullish(),
  type: z.enum(['lager', 'regal', 'fach']),
  name: z.string().min(1).max(160),
  code: z.string().max(32).nullish(),
  description: z.string().max(512).nullish(),
});
const updateSchema = schema.partial();

interface LocationRow {
  id: number;
  parent_id: number | null;
  type: string;
  name: string;
  code: string | null;
  description: string | null;
  qr_token: string | null;
}

interface TreeNode extends LocationRow {
  children: TreeNode[];
}

function buildTree(rows: LocationRow[]): TreeNode[] {
  const map = new Map<number, TreeNode>();
  for (const row of rows) map.set(row.id, { ...row, children: [] });
  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export const storageRouter = Router();
storageRouter.use(requireAuth);

storageRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<SqlRow<LocationRow>[]>(
      `SELECT l.*,
         (SELECT COUNT(*) FROM items i WHERE i.storage_location_id = l.id) AS item_count
       FROM storage_locations l ORDER BY l.type, l.name`
    );
    res.json({ locations: rows });
  })
);

storageRouter.get(
  '/tree',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<SqlRow<LocationRow>[]>(
      'SELECT id, parent_id, type, name, code, description, qr_token FROM storage_locations'
    );
    res.json({ tree: buildTree(rows as LocationRow[]) });
  })
);

storageRouter.post(
  '/',
  validate(schema),
  asyncHandler(async (req, res) => {
    const b = req.body as {
      parent_id?: number | null;
      type: string;
      name: string;
      code?: string | null;
      description?: string | null;
    };
    const [result] = await pool.query(
      `INSERT INTO storage_locations (parent_id, type, name, code, description, qr_token)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [b.parent_id ?? null, b.type, b.name, b.code ?? null, b.description ?? null, newToken()]
    );
    const id = Number((result as { insertId: number }).insertId);
    await writeAudit({
      userId: req.user!.id,
      action: 'location_created',
      targetType: 'storage_location',
      targetId: String(id),
      details: { name: b.name, type: b.type },
      ip: req.ip,
    });
    res.status(201).json({ id });
  })
);

storageRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query<SqlRow<LocationRow>[]>(
      'SELECT * FROM storage_locations WHERE id = ?',
      [id]
    );
    const location = rows[0];
    if (!location) throw new HttpError(404, 'Lagerplatz nicht gefunden');
    const [items] = await pool.query(
      `SELECT i.id, i.kind, i.name, i.manufacturer, i.model, i.inventory_number, i.serial_number,
              i.quantity, i.unit, i.status, i.category_id, c.name AS category_name
       FROM items i
       LEFT JOIN categories c ON c.id = i.category_id
       WHERE i.storage_location_id = ?
       ORDER BY i.name`,
      [id]
    );
    const [children] = await pool.query(
      'SELECT id, type, name, code FROM storage_locations WHERE parent_id = ? ORDER BY name',
      [id]
    );
    res.json({ location, items, children });
  })
);

storageRouter.patch(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const b = req.body as Record<string, unknown>;
    const allowed = ['parent_id', 'type', 'name', 'code', 'description'];
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of allowed) {
      if (b[key] !== undefined) {
        if (key === 'parent_id' && Number(b[key]) === id) {
          throw new HttpError(400, 'Ein Lagerplatz kann nicht sein eigener Elternknoten sein');
        }
        fields.push(`${key} = ?`);
        values.push(b[key]);
      }
    }
    if (fields.length) {
      values.push(id);
      await pool.query(`UPDATE storage_locations SET ${fields.join(', ')} WHERE id = ?`, values);
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'location_updated',
      targetType: 'storage_location',
      targetId: String(id),
      details: b,
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);

storageRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [result] = await pool.query('DELETE FROM storage_locations WHERE id = ?', [id]);
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new HttpError(404, 'Lagerplatz nicht gefunden');
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'location_deleted',
      targetType: 'storage_location',
      targetId: String(id),
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);

storageRouter.get(
  '/:id/qr',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query<SqlRow<LocationRow>[]>(
      'SELECT id, name, qr_token FROM storage_locations WHERE id = ?',
      [id]
    );
    const loc = rows[0];
    if (!loc) throw new HttpError(404, 'Lagerplatz nicht gefunden');
    if (!loc.qr_token) {
      const token = newToken();
      await pool.query('UPDATE storage_locations SET qr_token = ? WHERE id = ?', [token, id]);
      loc.qr_token = token;
    }
    res.json({ token: loc.qr_token, path: `/lagerplatz/${id}`, label: loc.name });
  })
);
