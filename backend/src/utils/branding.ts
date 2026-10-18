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
 * Ermittelt das fest im Repo liegende Logo (assets/branding, dann Frontend-Public).
 * Das Label-PNG steht bewusst an erster Stelle.
 */
function resolveStaticLogo(): string | null {
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

/**
 * Ermittelt den Pfad zu einem verwendbaren Logo für Label/PDF.
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

  return resolveStaticLogo();
}

/**
 * Logo ausschließlich für Etiketten: nutzt immer das Label-PNG aus
 * `assets/branding`, unabhängig von einem in den Einstellungen hochgeladenen
 * Logo. Ein hochgeladenes Logo gilt damit nur für Login/Anmeldeseite.
 */
export function resolveLabelLogo(): string | null {
  const labelLogo = path.join(BRANDING_DIR, 'tms-logo-label.png');
  if (fs.existsSync(labelLogo)) return labelLogo;
  return resolveStaticLogo();
}

export { BRANDING_DIR };