import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, type SqlRow } from '../db/pool.js';
import { resolveUploadsFile } from './uploads.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Reporoot (oberhalb von backend/dist/utils)
const APP_ROOT = path.resolve(__dirname, '../../..');
const BRANDING_DIR = path.join(APP_ROOT, 'assets', 'branding');

const LOGO_FILENAMES = [
  'tms-logo-label.png',
  'tms-logo.png',
  'tms-technik-logo.png',
  'tms-logo.jpeg',
  'tms-technik-logo.jpeg',
  'tms-logo.jpg',
  'tms-technik-logo.jpg',
];

/**
 * Ermittelt den Pfad zu einem verwendbaren Logo für Labels/PDF.
 * Reihenfolge: hochgeladenes Logo (uploads) > assets/branding > Frontend-Public-Logo.
 */
export async function resolveBrandingLogo(): Promise<string | null> {
  try {
    const [rows] = await pool.query<SqlRow<{ setting_value: string | null }>[]>(
      'SELECT setting_value FROM settings WHERE setting_key = ?',
      ['logo_file']
    );
    const file = rows[0]?.setting_value;
    if (file) {
      // Nicht vertrauenswürdig (stammt aus der DB) – resolveUploadsFile
      // verhindert, dass beliebige Serverdateien in Labels/PDFs landen.
      const candidate = resolveUploadsFile(file);
      if (candidate) return candidate;
    }
  } catch {
    // settings-Tabelle ggf. noch nicht vorhanden
  }

  if (fs.existsSync(BRANDING_DIR)) {
    for (const name of LOGO_FILENAMES) {
      const candidate = path.join(BRANDING_DIR, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  const publicLogo = path.join(APP_ROOT, 'frontend', 'public', 'tms-logo.png');
  if (fs.existsSync(publicLogo)) return publicLogo;

  return null;
}

export { BRANDING_DIR };