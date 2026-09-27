import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { parseIntParam } from '../../utils/helpers.js';
import { listAudit } from './audit.service.js';

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export const auditRouter = Router();

auditRouter.use(requireAuth, requireRole('administrator'));

auditRouter.get('/', async (req, res, next) => {
  try {
    const page = parseIntParam(req.query.page, 1, 1, 1_000_000);
    const pageSize = parseIntParam(req.query.pageSize, 25, 1, 100);
    const { rows, total } = await listAudit(page, pageSize);
    res.json({
      entries: rows.map((r) => ({
        ...r,
        details:
          r.details == null
            ? null
            : typeof r.details === 'string'
              ? safeParse(r.details)
              : r.details,
      })),
      page,
      pageSize,
      total,
    });
  } catch (err) {
    next(err);
  }
});