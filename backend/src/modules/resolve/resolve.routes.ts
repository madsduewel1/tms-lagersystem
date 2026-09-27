import { Router } from 'express';
import { pool, type SqlRow } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { asyncHandler } from '../../utils/helpers.js';

export const resolveRouter = Router();
resolveRouter.use(requireAuth);

// Löst einen QR-Code-Token auf (z. B. /a/<token> oder /l/<token>).
resolveRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const token = String(req.params.token ?? '');
    if (!/^[a-f0-9]{32}$/i.test(token)) {
      throw new HttpError(400, 'Ungültiger QR-Code');
    }

    const [items] = await pool.query<SqlRow<{ id: number; kind: string; name: string }>[]>(
      'SELECT id, kind, name FROM items WHERE qr_token = ?',
      [token]
    );
    if (items[0]) {
      res.json({
        type: 'item',
        id: items[0].id,
        kind: items[0].kind,
        name: items[0].name,
        path: `/inventar/detail?id=${items[0].id}`,
      });
      return;
    }

    const [locations] = await pool.query<SqlRow<{ id: number; type: string; name: string }>[]>(
      'SELECT id, type, name FROM storage_locations WHERE qr_token = ?',
      [token]
    );
    if (locations[0]) {
      res.json({
        type: 'location',
        id: locations[0].id,
        kind: locations[0].type,
        name: locations[0].name,
        path: `/lagerorte/detail?id=${locations[0].id}`,
      });
      return;
    }

    const [cases] = await pool.query<SqlRow<{ id: number; name: string; code: string | null }>[]>(
      'SELECT id, name, code FROM cases WHERE qr_token = ?',
      [token]
    );
    if (cases[0]) {
      res.json({
        type: 'case',
        id: cases[0].id,
        kind: 'case',
        name: cases[0].code ? `${cases[0].code} – ${cases[0].name}` : cases[0].name,
        path: `/cases/detail?id=${cases[0].id}`,
      });
      return;
    }

    throw new HttpError(404, 'QR-Code nicht gefunden');
  })
);