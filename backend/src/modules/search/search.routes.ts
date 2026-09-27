import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/helpers.js';

export const searchRouter = Router();
searchRouter.use(requireAuth);

searchRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 1) {
      res.json({ items: [], locations: [], events: [], suppliers: [] });
      return;
    }
    const like = `%${q}%`;

    const [items] = await pool.query(
      `SELECT i.id, i.kind, i.name, i.manufacturer, i.model, i.inventory_number,
              i.serial_number, i.quantity, i.unit, i.status,
              CONCAT_WS(' / ', lpp.name, lp.name, l.name) AS location_path
       FROM items i
       LEFT JOIN storage_locations l ON l.id = i.storage_location_id
       LEFT JOIN storage_locations lp ON lp.id = l.parent_id
       LEFT JOIN storage_locations lpp ON lpp.id = lp.parent_id
       WHERE i.name LIKE ? OR i.manufacturer LIKE ? OR i.model LIKE ?
          OR i.inventory_number LIKE ? OR i.serial_number LIKE ? OR i.article_number LIKE ?
       ORDER BY i.name LIMIT 20`,
      [like, like, like, like, like, like]
    );

    const [locations] = await pool.query(
      `SELECT l.id, l.type, l.name, l.code,
              CONCAT_WS(' / ', lpp.name, lp.name, l.name) AS path
       FROM storage_locations l
       LEFT JOIN storage_locations lp ON lp.id = l.parent_id
       LEFT JOIN storage_locations lpp ON lpp.id = lp.parent_id
       WHERE l.name LIKE ? OR l.code LIKE ? ORDER BY l.name LIMIT 10`,
      [like, like]
    );

    const [events] = await pool.query(
      `SELECT id, name, location, status, starts_at FROM events
       WHERE name LIKE ? OR location LIKE ? ORDER BY starts_at DESC LIMIT 10`,
      [like, like]
    );

    const [suppliers] = await pool.query(
      `SELECT id, name, contact_name, email FROM suppliers
       WHERE name LIKE ? OR contact_name LIKE ? OR email LIKE ? ORDER BY name LIMIT 10`,
      [like, like, like]
    );

    res.json({ items, locations, events, suppliers });
  })
);
