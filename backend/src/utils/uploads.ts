import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';

/**
 * Löst einen Dateinamen innerhalb des Upload-Verzeichnisses sicher auf.
 *
 * Der Name kommt in der Regel aus der Datenbank (z. B. `settings.logo_file`) und
 * ist damit nicht vertrauenswürdig. Ohne diese Absicherung wäre ein Wert wie
 * `../../../../etc/passwd` ein Path Traversal, über den beliebige Dateien
 * ausgelesen oder in generierte PDFs eingebettet werden könnten.
 *
 * Gibt `null` zurück, wenn der Name das Upload-Verzeichnis verlassen würde,
 * auf ein Unterverzeichnis zeigt oder die Datei nicht existiert.
 */
export function resolveUploadsFile(name: string | null | undefined): string | null {
  if (typeof name !== 'string' || name.length === 0) return null;

  // Verschachtelte Pfade und Traversal-Segmente grundsätzlich ablehnen.
  if (name !== path.basename(name) || name === '.' || name === '..') return null;
  // NUL-Byte und Pfadtrenner ausschließen.
  if (name.includes('\0') || name.includes('/') || name.includes('\\')) return null;

  const root = path.resolve(config.uploadsDir);
  const resolved = path.resolve(root, name);

  // Belt-and-suspenders: das Ergebnis muss exakt im Upload-Verzeichnis liegen.
  if (path.dirname(resolved) !== root) return null;

  try {
    if (!fs.statSync(resolved).isFile()) return null;
  } catch {
    return null;
  }
  return resolved;
}

/** Löst das Logo auf und entfernt es aus `uploadsDir` (best effort). */
export function removeUploadsFile(name: string | null | undefined): void {
  const resolved = resolveUploadsFile(name);
  if (!resolved) return;
  try {
    fs.unlinkSync(resolved);
  } catch {
    // Datei war bereits entfernt oder nicht löschbar – nicht weiter relevant.
  }
}
