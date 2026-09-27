import { Router, type Request } from 'express';
import { z } from 'zod';
import { pool, type SqlRow } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, parseId, parsePagination } from '../../utils/helpers.js';
import {
  adjustQuantity,
  createItem,
  deleteItem,
  getItem,
  listItems,
  updateItem,
  type ItemKind,
} from './items.service.js';

const nullableStr = z.string().max(2000).nullish();
const optionalId = z.coerce.number().int().positive().nullish();

const itemSchema = z.object({
  name: z.string().min(1).max(160),
  manufacturer: nullableStr,
  model: nullableStr,
  article_number: nullableStr,
  category_id: optionalId,
  storage_location_id: optionalId,
  case_id: optionalId,
  quantity: z.coerce.number().int().min(0).nullish(),
  unit: z.string().max(16).nullish(),
  min_stock: z.coerce.number().int().min(0).nullish(),
  inventory_number: nullableStr,
  serial_number: nullableStr,
  status: z
    .enum(['verfuegbar', 'ausgelagert', 'defekt', 'wartung', 'verloren', 'ausser_betrieb'])
    .optional(),
  condition: z.enum(['neu', 'gut', 'gebraucht', 'defekt']).nullish(),
  purchase_price: z.coerce.number().min(0).nullish(),
  purchase_date: z.string().max(32).nullish(),
  current_value: z.coerce.number().min(0).nullish(),
  warranty: z.string().max(32).nullish(),
  supplier_id: optionalId,
  description: nullableStr,
  technical_data: nullableStr,
  manual_url: nullableStr,
  notes: nullableStr,
});

const updateSchema = itemSchema.partial();

const quantitySchema = z.object({
  delta: z.coerce.number().int().optional(),
  quantity: z.coerce.number().int().min(0).optional(),
});

const locationSchema = z.object({ storage_location_id: optionalId });

const statusSchema = z.object({
  status: z.enum(['verfuegbar', 'ausgelagert', 'defekt', 'wartung', 'verloren', 'ausser_betrieb']),
});

function queryFilters(req: Request, kind: ItemKind) {
  const { pageSize, offset } = parsePagination(req.query);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  return {
    kind,
    q: q || undefined,
    categoryId: req.query.categoryId ? Number(req.query.categoryId) : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    locationId: req.query.locationId ? Number(req.query.locationId) : undefined,
    supplierId: req.query.supplierId ? Number(req.query.supplierId) : undefined,
    lowStock: req.query.lowStock === '1' || req.query.lowStock === 'true',
    sort: typeof req.query.sort === 'string' ? req.query.sort : undefined,
    order: req.query.order === 'desc' ? ('desc' as const) : ('asc' as const),
    limit: pageSize,
    offset,
  };
}

export function createItemRouter(kind: ItemKind): Router {
  const router = Router();
  router.use(requireAuth);
  const notFoundMsg = kind === 'geraet' ? 'Gerät nicht gefunden' : 'Artikel nicht gefunden';

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { rows, total } = await listItems(queryFilters(req, kind));
      res.json({ items: rows, total });
    })
  );

  router.post(
    '/',
    validate(itemSchema),
    asyncHandler(async (req, res) => {
      const id = await createItem({ kind, ...(req.body as object) } as never, req.user!.id);
      await writeAudit({
        userId: req.user!.id,
        action: kind === 'geraet' ? 'device_created' : 'article_created',
        targetType: kind,
        targetId: String(id),
        details: { name: (req.body as { name: string }).name },
        ip: req.ip,
      });
      res.status(201).json({ id, item: await getItem(id) });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const item = await getItem(parseId(req.params.id, 'ID'));
      if (!item || item.kind !== kind) throw new HttpError(404, notFoundMsg);
      res.json({ item });
    })
  );

  router.patch(
    '/:id',
    validate(updateSchema),
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id, 'ID');
      await updateItem(id, req.body as never, req.user!.id);
      await writeAudit({
        userId: req.user!.id,
        action: kind === 'geraet' ? 'device_updated' : 'article_updated',
        targetType: kind,
        targetId: String(id),
        details: req.body,
        ip: req.ip,
      });
      res.json({ item: await getItem(id) });
    })
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id, 'ID');
      await deleteItem(id);
      await writeAudit({
        userId: req.user!.id,
        action: kind === 'geraet' ? 'device_deleted' : 'article_deleted',
        targetType: kind,
        targetId: String(id),
        ip: req.ip,
      });
      res.json({ ok: true });
    })
  );

  router.post(
    '/:id/quantity',
    validate(quantitySchema),
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id, 'ID');
      const body = req.body as { delta?: number; quantity?: number };
      let quantity: number;
      if (body.quantity !== undefined) {
        const item = await getItem(id);
        if (!item) throw new HttpError(404, notFoundMsg);
        quantity = body.quantity;
        await updateItem(id, { quantity }, req.user!.id);
      } else {
        quantity = await adjustQuantity(id, body.delta ?? 0, req.user!.id);
      }
      await writeAudit({
        userId: req.user!.id,
        action: 'quantity_changed',
        targetType: kind,
        targetId: String(id),
        details: body,
        ip: req.ip,
      });
      res.json({ quantity });
    })
  );

  router.post(
    '/:id/location',
    validate(locationSchema),
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id, 'ID');
      const { storage_location_id } = req.body as { storage_location_id: number | null };
      await updateItem(id, { storage_location_id }, req.user!.id);
      await writeAudit({
        userId: req.user!.id,
        action: 'location_changed',
        targetType: kind,
        targetId: String(id),
        details: { storage_location_id },
        ip: req.ip,
      });
      res.json({ item: await getItem(id) });
    })
  );

  router.post(
    '/:id/status',
    validate(statusSchema),
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id, 'ID');
      const { status } = req.body as { status: string };
      await updateItem(id, { status }, req.user!.id);
      await writeAudit({
        userId: req.user!.id,
        action: 'status_changed',
        targetType: kind,
        targetId: String(id),
        details: { status },
        ip: req.ip,
      });
      res.json({ item: await getItem(id) });
    })
  );

  router.get(
    '/:id/history',
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id, 'ID');
      const [movements] = await pool.query(
        `SELECT m.*, u.name AS user_name, e.name AS event_name
         FROM stock_movements m
         LEFT JOIN users u ON u.id = m.user_id
         LEFT JOIN events e ON e.id = m.event_id
         WHERE m.item_id = ? ORDER BY m.created_at DESC LIMIT 100`,
        [id]
      );
      const [checkouts] = await pool.query(
        `SELECT c.*, e.name AS event_name, u.name AS user_name
         FROM checkouts c
         LEFT JOIN events e ON e.id = c.event_id
         LEFT JOIN users u ON u.id = c.user_id
         WHERE c.item_id = ? ORDER BY c.checked_out_at DESC LIMIT 50`,
        [id]
      );
      const [maintenance] = await pool.query(
        `SELECT * FROM maintenance WHERE item_id = ? ORDER BY reported_at DESC LIMIT 50`,
        [id]
      );
      const [plannedEvents] = await pool.query(
        `SELECT ed.event_id, ed.status AS plan_status, ed.note,
                e.name, e.starts_at, e.ends_at, e.status AS event_status
         FROM event_devices ed JOIN events e ON e.id = ed.event_id
         WHERE ed.item_id = ? ORDER BY e.starts_at DESC`,
        [id]
      );
      const [plannedAsArtikel] = await pool.query(
        `SELECT ei.event_id, ei.quantity, ei.status AS plan_status, ei.note,
                e.name, e.starts_at, e.ends_at, e.status AS event_status
         FROM event_items ei JOIN events e ON e.id = ei.event_id
         WHERE ei.item_id = ? ORDER BY e.starts_at DESC`,
        [id]
      );
      res.json({ movements, checkouts, maintenance, plannedEvents, plannedAsArtikel });
    })
  );

  router.get(
    '/:id/qr',
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id, 'ID');
      const item = await getItem(id);
      if (!item || item.kind !== kind) throw new HttpError(404, notFoundMsg);
      res.json({
        token: item.qr_token,
        path: `${kind === 'geraet' ? '/geraet' : '/artikel'}/${id}`,
        label: item.inventory_number ?? item.name,
      });
    })
  );

  return router;
}

export const devicesRouter = createItemRouter('geraet');
export const articlesRouter = createItemRouter('artikel');

export const itemsLookupRouter = Router();
itemsLookupRouter.use(requireAuth);
itemsLookupRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const item = await getItem(parseId(req.params.id, 'ID'));
    if (!item) throw new HttpError(404, 'Asset nicht gefunden');
    res.json({ item });
  })
);

itemsLookupRouter.get(
  '/:id/cases',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id, 'ID');
    const [assignments] = await pool.query(
      `SELECT ci.case_id, ci.quantity, ci.note,
              k.name AS case_name, k.code AS case_code,
              k.status AS case_status,
              CONCAT_WS(' / ', clpp.name, clp.name, cl.name) AS location_path,
              (SELECT COUNT(*) FROM case_items ci2 WHERE ci2.case_id = k.id) AS item_count
       FROM case_items ci
       JOIN cases k ON k.id = ci.case_id
       LEFT JOIN storage_locations cl ON cl.id = k.storage_location_id
       LEFT JOIN storage_locations clp ON clp.id = cl.parent_id
       LEFT JOIN storage_locations clpp ON clpp.id = clp.parent_id
       WHERE ci.item_id = ?
       ORDER BY ci.quantity DESC, ci.id ASC`,
      [id]
    );
    res.json({ assignments });
  })
);

export type { SqlRow };
