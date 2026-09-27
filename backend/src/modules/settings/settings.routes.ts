import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { pool, type SqlRow } from '../../db/pool.js';
import { config } from '../../config/env.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { HttpError, validate } from '../../middleware/error.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler } from '../../utils/helpers.js';
import { removeUploadsFile, resolveUploadsFile } from '../../utils/uploads.js';

const settingsKeys = new Set([
  'system_name',
  'inventory_prefix',
  'warehouse_name',
  'logo_url',
  'support_email',
  'label_format',
  'label_margin_top',
  'label_margin_right',
  'label_margin_bottom',
  'label_margin_left',
  'label_gap_x',
  'label_gap_y',
  'label_distribute',
  'qr_base_url',
  // 'logo_file' ist absichtlich NICHT schreibbar: der Wert ist ein
  // serverseitig generierter Dateiname im Upload-Verzeichnis. Wäre er über
  // PATCH /api/settings frei setzbar, könnte ein Admin einen beliebigen
  // Serverpfad hinterlegen, der anschließend unauthentifiziert ausgeliefert
  // wird. Der Wert wird ausschließlich von POST /api/settings/logo gesetzt.
]);

const updateSchema = z.object({
  settings: z
    .record(z.string().min(1).max(64), z.string().max(512).nullable())
    .refine((obj) => Object.keys(obj).every((k) => settingsKeys.has(k)), {
      message: 'Unbekannte Einstellung',
    })
    .refine(
      (obj) =>
        obj.qr_base_url === undefined ||
        obj.qr_base_url === null ||
        /^https?:\/\/[^\s"'<>]+$/i.test(obj.qr_base_url),
      { message: 'qr_base_url muss eine http(s)-URL sein' }
    ),
});

fs.mkdirSync(config.uploadsDir, { recursive: true });

// Nur echte Rasterbilder zulassen. SVG/HTML werden abgewiesen, weil die Datei
// anschließend ohne Authentifizierung ausgeliefert wird (stored XSS).
// Die Dateiendung wird ausschließlich aus dieser Tabelle abgeleitet, nie aus
// dem hochgeladenen Dateinamen.
const LOGO_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const LOGO_EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadsDir),
  filename: (_req, file, cb) => {
    const ext = LOGO_EXT_BY_MIME[file.mimetype] ?? '.png';
    cb(null, `logo-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!LOGO_EXT_BY_MIME[file.mimetype]) {
      cb(new HttpError(400, 'Logo muss ein PNG-, JPEG-, GIF- oder WebP-Bild sein'));
      return;
    }
    cb(null, true);
  },
});

export const settingsRouter = Router();

async function readSettings(): Promise<Record<string, string | null>> {
  const [rows] = await pool.query<SqlRow<{ setting_key: string; setting_value: string | null }>[]>(
    'SELECT setting_key, setting_value FROM settings'
  );
  const settings: Record<string, string | null> = {};
  for (const row of rows) settings[row.setting_key] = row.setting_value;
  return settings;
}

async function setSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await pool.query('DELETE FROM settings WHERE setting_key = ?', [key]);
  } else {
    await pool.query(
      `INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [key, value]
    );
  }
}

// Öffentliche Basisdaten für Login/Setup (ohne Anmeldung)
settingsRouter.get(
  '/public',
  asyncHandler(async (_req, res) => {
    const settings = await readSettings();
    res.json({
      system_name: settings.system_name ?? 'TMS Event-Technik Lager',
      logo_url: settings.logo_url ?? '',
      support_email: settings.support_email ?? '',
    });
  })
);

settingsRouter.get(
  '/logo',
  asyncHandler(async (_req, res) => {
    const settings = await readSettings();
    // `logo_file` stammt aus der DB und ist nicht vertrauenswürdig –
    // resolveUploadsFile verhindert Path Traversal und Unterverzeichnisse.
    const filePath = resolveUploadsFile(settings.logo_file);
    if (!filePath) {
      res.status(404).json({ error: 'Kein Logo hinterlegt' });
      return;
    }
    const mimeType = LOGO_MIME_BY_EXT[path.extname(filePath).toLowerCase()];
    if (!mimeType) {
      res.status(404).json({ error: 'Logo-Datei nicht gefunden' });
      return;
    }
    // Fester Content-Type + nosniff: verhindert, dass der Browser eine
    // hochgeladene Datei als HTML/SVG interpretiert (stored XSS).
    res.setHeader('Content-Type', mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(filePath).pipe(res);
  })
);

settingsRouter.use(requireAuth);

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ settings: await readSettings() });
  })
);

settingsRouter.patch(
  '/',
  requireRole('administrator'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const { settings } = req.body as { settings: Record<string, string | null> };
    for (const [key, value] of Object.entries(settings)) {
      await setSetting(key, value);
    }
    await writeAudit({
      userId: req.user!.id,
      action: 'settings_updated',
      details: settings,
      ip: req.ip,
    });
    res.json({ ok: true, settings: await readSettings() });
  })
);

settingsRouter.post(
  '/logo',
  requireRole('administrator'),
  logoUpload.single('logo'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Keine Datei übermittelt' });
      return;
    }
    const settings = await readSettings();
    removeUploadsFile(settings.logo_file);
    await setSetting('logo_file', req.file.filename);
    await setSetting('logo_url', '/api/settings/logo');
    await writeAudit({
      userId: req.user!.id,
      action: 'logo_updated',
      ip: req.ip,
    });
    res.json({ ok: true, logo_url: '/api/settings/logo' });
  })
);
