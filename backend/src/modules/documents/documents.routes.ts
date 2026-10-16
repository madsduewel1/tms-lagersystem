import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { pool, type SqlRow } from '../../db/pool.js';
import { config } from '../../config/env.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
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

/**
 * Erlaubte Dokumenttypen. Bewusst als Allowlist: bisher wurde jede Datei bis
 * 25 MB abgelegt (Malware-Ablage, Speicherfüllung).
 */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.csv',
  '.doc', '.docx', '.xls', '.xlsx', '.zip',
]);

/**
 * Magic-Byte-Prüfung: `file.mimetype` und Dateiendung stammen vom Client und
 * sind frei wählbar. Ein abgelegtes HTML/SVG, das sich als PNG ausgibt, wäre
 * über einen Fehler im Download-Pfad trotzdem gefährlich – deshalb muss der
 * Dateianfang wirklich zum gemeldeten Typ passen.
 */
function matchesMagicBytes(header: Buffer, mime: string): boolean {
  const starts = (...bytes: number[]) => bytes.every((b, i) => header[i] === b);
  switch (mime) {
    case 'application/pdf':
      return header.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47);
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'image/gif':
      return header.subarray(0, 6).toString('latin1') === 'GIF87a' ||
        header.subarray(0, 6).toString('latin1') === 'GIF89a';
    case 'image/webp':
      return header.subarray(0, 4).toString('latin1') === 'RIFF' &&
        header.subarray(8, 12).toString('latin1') === 'WEBP';
    case 'application/zip':
    case 'application/msword':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.ms-excel':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      // DOC (altes OLE2) beginnt mit D0 CF 11 E0, DOCX/XLSX/ZIP mit PK.
      return starts(0x50, 0x4b) || starts(0xd0, 0xcf, 0x11, 0xe0);
    case 'text/plain':
    case 'text/csv':
      // Text darf keine NUL-Bytes enthalten (sonst binär getarnt).
      return !header.includes(0x00);
    default:
      return false;
  }
}

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
      cb(new HttpError(400, `Dateityp nicht erlaubt (erlaubt: PDF, Bilder, Office, TXT, CSV, ZIP)`));
      return;
    }
    cb(null, true);
  },
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

documentsRouter.use(requirePermission('documents.manage'));
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

function headerBytes(filePath: string): Buffer {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

documentsRouter.post(
  '/',
  upload.single('file'),
  // Validierung läuft nach dem Schreiben der Datei. Schlägt sie fehl, blieb
  // die Datei bisher liegen (Disk-Erschöpfung durch wiederholte Requests).
  (req, res, next) => {
    validate(createSchema)(req, res, (err) => {
      if (err && req.file) removeUploadsFile(req.file.filename);
      next(err);
    });
  },
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, 'Keine Datei übermittelt');
    try {
      if (!matchesMagicBytes(headerBytes(file.path), file.mimetype)) {
        throw new HttpError(400, 'Dateiinhalt passt nicht zum angegebenen Dateityp');
      }
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
    } catch (err) {
      // DB- oder Validierungsfehler nach dem Schreiben: Datei nicht hängenlassen.
      removeUploadsFile(file.filename);
      throw err;
    }
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
