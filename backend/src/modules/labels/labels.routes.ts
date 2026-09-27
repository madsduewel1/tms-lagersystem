import { Router, type Request } from 'express';
import QRCode from 'qrcode';
import { pool, type SqlRow } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { asyncHandler } from '../../utils/helpers.js';
import { getSetting } from '../items/items.service.js';
import {
  collectLabels,
  generateLabelsPdf,
  LABEL_FORMATS,
  type CollectFilters,
} from './labels.service.js';

export const labelsRouter = Router();
labelsRouter.use(requireAuth);

function idsFromQuery(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function parseFilters(req: Request): CollectFilters {
  const type = req.query.type === 'location' ? 'location' : 'item';
  const filters: CollectFilters = {
    type,
    ids: idsFromQuery(req.query.ids),
  };
  if (typeof req.query.kind === 'string' && (req.query.kind === 'geraet' || req.query.kind === 'artikel')) {
    filters.kind = req.query.kind;
  }
  if (typeof req.query.categoryId === 'string') {
    const n = Number(req.query.categoryId);
    if (Number.isInteger(n) && n > 0) filters.categoryId = n;
  }
  if (typeof req.query.locationId === 'string') {
    const n = Number(req.query.locationId);
    if (Number.isInteger(n) && n > 0) filters.locationId = n;
  }
  if (typeof req.query.status === 'string' && req.query.status) {
    filters.status = req.query.status;
  }
  if (type === 'location' && req.query.all === '1') {
    filters.allLocations = true;
  }
  filters.includeCategory = req.query.includeCategories !== 'false';
  filters.includeLocation = req.query.includeLocations !== 'false';
  return filters;
}

function parseFormat(req: Request) {
  const value = req.query.format ?? req.query.size;
  const id = typeof value === 'string' ? value : '62x29';
  const format = LABEL_FORMATS.find((f) => f.id === id);
  if (!format) throw new HttpError(400, 'Unbekanntes Label-Format');
  return format;
}

async function qrBaseUrl(req: Request): Promise<string> {
  const configured = await getSetting('qr_base_url', '');
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}/lagersystem`;
}

labelsRouter.get(
  '/qr/:token',
  asyncHandler(async (req, res) => {
    const token = req.params.token;
    const base = await qrBaseUrl(req);
    let prefix = 'a';
    const [itemRows] = await pool.query<SqlRow<{ ok: number }>[]>(
      'SELECT 1 AS ok FROM items WHERE qr_token = ?',
      [token]
    );
    if (itemRows.length === 0) {
      const [locRows] = await pool.query<SqlRow<{ ok: number }>[]>(
        'SELECT 1 AS ok FROM storage_locations WHERE qr_token = ?',
        [token]
      );
      if (locRows.length === 0) {
        const [caseRows] = await pool.query<SqlRow<{ ok: number }>[]>(
          'SELECT 1 AS ok FROM cases WHERE qr_token = ?',
          [token]
        );
        if (caseRows.length === 0) {
          throw new HttpError(404, 'Token nicht gefunden');
        }
        prefix = 'c';
      } else {
        prefix = 'l';
      }
    }
    const buf = await QRCode.toBuffer(`${base}/${prefix}/${token}`, {
      width: 180,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#111111', light: '#ffffff' },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  })
);

labelsRouter.get(
  '/formats',
  asyncHandler(async (_req, res) => {
    res.json({ formats: LABEL_FORMATS });
  })
);

labelsRouter.get(
  '/preview',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req);
    const labels = await collectLabels(filters);
    res.json({
      labels,
      count: labels.length,
      format: parseFormat(req),
      qr_base_url: await qrBaseUrl(req),
    });
  })
);

labelsRouter.get(
  '/pdf',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req);
    const format = parseFormat(req);
    const labels = await collectLabels(filters);
    if (labels.length === 0) {
      res.status(400).json({ error: 'Für die Auswahl gibt es keine Labels zu drucken' });
      return;
    }
    const base = await qrBaseUrl(req);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="tms-labels-${filters.type}-${Date.now()}.pdf"`
    );
    res.setHeader('Cache-Control', 'no-cache');

    await generateLabelsPdf(
      labels,
      format,
      base,
      res as unknown as NodeJS.WritableStream
    );
  })
);