import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { pool, type SqlRow } from '../../db/pool.js';
import { config } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, parseId } from '../../utils/helpers.js';
import { removeUploadsFile, resolveUploadsFile } from '../../utils/uploads.js';

fs.mkdirSync(config.uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 12);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
});

const DOC_TYPES = [
  'rechnung',
  'kaufbeleg',
  'anleitung',
  'datenblatt',
  'garantie',
  'reparatur',
  'sonstiges',
] as const;

const createSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  doc_type: z.enum(DOC_TYPES).optional(),
  item_id: z.coerce.number().int().positive().nullish(),
  notes: z.string().trim().max(512).nullish(),
});

/**
 * Nur diese Typen dürfen im Browser direkt angezeigt werden. Alles andere wird
 * als Attachment ausgeliefert – sonst könnte ein hochgeladenes HTML/SVG über
 * den Download-Endpoint als Skript im App-Origin laufen (stored XSS).
 */
const INLINE_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

documentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const itemId = req.query.itemId ? Number(req.query.itemId) : undefined;
    const docType = typeof req.query.docType === 'string' ? req.query.docType : undefined;
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (itemId) {
      clauses.push('d.item_id = ?');
      params.push(itemId);
    }
    if (docType) {
      clauses.push('d.doc_type = ?');
      params.push(docType);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT d.*, i.name AS item_name, i.inventory_number, u.name AS uploaded_by_name
       FROM documents d
       LEFT JOIN items i ON i.id = d.item_id
       LEFT JOIN users u ON u.id = d.uploaded_by
       ${where} ORDER BY d.created_at DESC`,
      params
    );
    res.json({ documents: rows });
  })
);

documentsRouter.post(
  '/',
  upload.single('file'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, 'Keine Datei übermittelt');
    const body = req.body as z.infer<typeof createSchema>;
    // originalname ist maximal 255 Zeichen in der DB.
    const originalName = file.originalname.slice(0, 255);
    const title = (body.title?.trim() || originalName).slice(0, 200);
    const docType = body.doc_type ?? 'sonstiges';
    const itemId = body.item_id ?? null;
    const notes = body.notes?.trim() ? body.notes.trim() : null;
    const mimeType = file.mimetype.slice(0, 128);

    const [result] = await pool.query(
      `INSERT INTO documents
        (title, doc_type, item_id, stored_name, original_name, mime_type, size_bytes, notes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        docType,
        itemId,
        file.filename,
        originalName,
        mimeType,
        file.size,
        notes,
        req.user!.id,
      ]
    );
    const id = Number((result as { insertId: number }).insertId);
    await writeAudit({
      userId: req.user!.id,
      action: 'document_uploaded',
      targetType: 'document',
      targetId: String(id),
      details: { title, doc_type: docType, item_id: itemId },
      ip: req.ip,
    });
    res.status(201).json({ id });
  })
);

documentsRouter.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query<SqlRow<Record<string, unknown>>[]>(
      'SELECT stored_name, original_name, mime_type FROM documents WHERE id = ?',
      [id]
    );
    const doc = rows[0];
    if (!doc) throw new HttpError(404, 'Dokument nicht gefunden');
    const filePath = resolveUploadsFile(doc.stored_name as string | null);
    if (!filePath) throw new HttpError(404, 'Datei nicht gefunden');

    // Der gespeicherte MIME-Typ stammt vom Client und ist nicht vertrauenswürdig.
    const stored = (doc.mime_type as string | null) ?? '';
    const inline = INLINE_MIME_TYPES.has(stored);
    res.setHeader('Content-Type', inline ? stored : 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const disposition = `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(String(doc.original_name))}"`;
    res.setHeader('Content-Disposition', disposition);
    fs.createReadStream(filePath).pipe(res);
  })
);

documentsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query<SqlRow<{ stored_name: string }>[]>(
      'SELECT stored_name FROM documents WHERE id = ?',
      [id]
    );
    const doc = rows[0];
    if (!doc) throw new HttpError(404, 'Dokument nicht gefunden');
    await pool.query('DELETE FROM documents WHERE id = ?', [id]);
    removeUploadsFile(doc.stored_name);

    await writeAudit({
      userId: req.user!.id,
      action: 'document_deleted',
      targetType: 'document',
      targetId: String(id),
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);
