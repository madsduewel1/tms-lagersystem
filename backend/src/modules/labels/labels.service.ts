import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { pool, type SqlRow } from '../../db/pool.js';
import { newToken } from '../../utils/helpers.js';

// ---------------------------------------------------------------------------
// Label-Formate (Definition in mm)
// ---------------------------------------------------------------------------

export interface LabelFormat {
  id: string;
  label: string;
  width: number;   // mm
  height: number;  // mm
}

export const LABEL_FORMATS: LabelFormat[] = [
  { id: '62x29', label: '62 × 29 mm (27 pro A4-Seite)', width: 62, height: 29 },
  { id: '99x34', label: '99 × 34 mm (6 pro A4-Seite)', width: 99, height: 34 },
  { id: '63x38', label: '63 × 38 mm (12 pro A4-Seite)', width: 63, height: 38 },
  { id: '49x25', label: '49 × 25 mm (30 pro A4-Seite)', width: 49, height: 25 },
  { id: '38x21', label: '38 × 21 mm (45 pro A4-Seite)', width: 38, height: 21 },
];

export const LABEL_MARGIN = 4; // mm Rand um jedes Label

// ---------------------------------------------------------------------------
// Label-Layout (Einstellbar unter „Einstellungen → Etiketten“)
// ---------------------------------------------------------------------------

export interface LabelLayout {
  /** Rand in mm zu jeder Papierkante */
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  /** Festgelegter Abstand zwischen den Labels in mm */
  gapX: number;
  gapY: number;
  /** true → freien Platz gleichmäßig als Abstand verteilen; false → fester Abstand, oben links ausrichten */
  distribute: boolean;
}

export const LABEL_LAYOUT_DEFAULTS: LabelLayout = {
  marginTop: 8,
  marginRight: 8,
  marginBottom: 8,
  marginLeft: 8,
  gapX: 2,
  gapY: 2,
  distribute: true,
};

export async function resolveLabelLayout(): Promise<LabelLayout> {
  const { getSetting } = await import('../items/items.service.js');
  const num = async (key: string, fallback: number): Promise<number> => {
    const value = await getSetting(key, '');
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    marginTop: await num('label_margin_top', LABEL_LAYOUT_DEFAULTS.marginTop),
    marginRight: await num('label_margin_right', LABEL_LAYOUT_DEFAULTS.marginRight),
    marginBottom: await num('label_margin_bottom', LABEL_LAYOUT_DEFAULTS.marginBottom),
    marginLeft: await num('label_margin_left', LABEL_LAYOUT_DEFAULTS.marginLeft),
    gapX: await num('label_gap_x', LABEL_LAYOUT_DEFAULTS.gapX),
    gapY: await num('label_gap_y', LABEL_LAYOUT_DEFAULTS.gapY),
    distribute: (await getSetting('label_distribute', '')) !== '0',
  };
}

// ---------------------------------------------------------------------------
// Labeldaten sammeln
// ---------------------------------------------------------------------------

export interface LabelRow {
  type: 'item' | 'location';
  id: number;
  name: string;
  inventory_number: string | null;
  category_name: string | null;
  code: string | null;
  location_path: string | null;
  qr_token: string;
  label_text: string;
  sub_text: string | null;
}

/**
 * Tabellenname wird in SQL interpoliert, weil MySQL dort keine Platzhalter
 * erlaubt. Deshalb hart auf die zwei verwendeten Tabellen begrenzt – so bleibt
 * die Stelle auch bei einem späteren Refactor uninjektierbar.
 */
const TOKEN_TABLES = ['items', 'storage_locations'] as const;
type TokenTable = (typeof TOKEN_TABLES)[number];

async function ensureToken(
  table: TokenTable,
  id: number,
  existing: string | null
): Promise<string> {
  if (existing) return existing;
  const token = newToken();
  await pool.query(`UPDATE ${table} SET qr_token = ? WHERE id = ?`, [token, id]);
  return token;
}


export interface CollectFilters {
  type: 'item' | 'location';
  ids?: number[];
  kind?: string;
  categoryId?: number;
  locationId?: number;
  status?: string;
  allLocations?: boolean;
  includeCategory?: boolean;
  includeLocation?: boolean;
}

export async function collectLabels(filters: CollectFilters): Promise<LabelRow[]> {
  const rows: LabelRow[] = [];

  if (filters.type === 'item') {
    const params: unknown[] = [];
    const wheres: string[] = [];
    if (filters.ids && filters.ids.length) {
      wheres.push(`i.id IN (${filters.ids.map(() => '?').join(',')})`);
      params.push(...filters.ids);
    }
    if (filters.kind) {
      wheres.push('i.kind = ?');
      params.push(filters.kind);
    }
    if (filters.categoryId) {
      wheres.push('i.category_id = ?');
      params.push(filters.categoryId);
    }
    if (filters.locationId) {
      wheres.push('i.storage_location_id = ?');
      params.push(filters.locationId);
    }
    if (filters.status) {
      wheres.push('i.status = ?');
      params.push(filters.status);
    }
    if (wheres.length === 0) {
      wheres.push('1=1');
    }
    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

    const [itemRows] = await pool.query<SqlRow<Record<string, unknown>>[]>(
      `SELECT i.id, i.name, i.inventory_number, i.kind, i.qr_token, i.status,
              c.name AS category_name,
              CONCAT_WS(' / ', lpp.name, lp.name, l.name) AS location_path
       FROM items i
       LEFT JOIN categories c ON c.id = i.category_id
       LEFT JOIN storage_locations l ON l.id = i.storage_location_id
       LEFT JOIN storage_locations lp ON lp.id = l.parent_id
       LEFT JOIN storage_locations lpp ON lpp.id = lp.parent_id
       ${where}
       ORDER BY i.name`,
      params
    );

    for (const r of itemRows) {
      const id = Number(r.id);
      const qr_token = await ensureToken('items', id, r.qr_token as string | null);
      const invNr = (r.inventory_number as string | null) ?? '';
      const includeCategory = filters.includeCategory !== false;
      const includeLocation = filters.includeLocation !== false;
      const subParts: string[] = [];
      if (invNr) subParts.push(invNr);
      if (includeCategory && r.category_name) subParts.push(String(r.category_name));
      rows.push({
        type: 'item',
        id,
        name: r.name as string,
        inventory_number: invNr || null,
        category_name: includeCategory ? ((r.category_name as string | null) ?? null) : null,
        code: null,
        location_path: includeLocation ? ((r.location_path as string | null) ?? null) : null,
        qr_token,
        label_text: r.name as string,
        sub_text: subParts.length ? subParts.join(' · ') : null,
      });
    }
  } else {
    // locations
    const params: unknown[] = [];
    const wheres: string[] = [];
    if (filters.ids && filters.ids.length) {
      wheres.push(`l.id IN (${filters.ids.map(() => '?').join(',')})`);
      params.push(...filters.ids);
    }
    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

    const [locRows] = await pool.query<SqlRow<Record<string, unknown>>[]>(
      `SELECT l.id, l.name, l.code, l.type, l.qr_token,
              CONCAT_WS(' / ', lpp.name, lp.name, l.name) AS location_path
       FROM storage_locations l
       LEFT JOIN storage_locations lp ON lp.id = l.parent_id
       LEFT JOIN storage_locations lpp ON lpp.id = lp.parent_id
       ${where}
       ORDER BY l.type, l.name`,
      params
    );

    for (const r of locRows) {
      const id = Number(r.id);
      const qr_token = await ensureToken('storage_locations', id, r.qr_token as string | null);
      rows.push({
        type: 'location',
        id,
        name: r.name as string,
        inventory_number: null,
        category_name: null,
        code: (r.code as string | null) ?? null,
        location_path: (r.location_path as string | null) ?? null,
        qr_token,
        label_text: (r.code as string | null) ? `${r.code} – ${r.name}` : (r.name as string),
        sub_text: (r.location_path as string | null) ?? null,
      });
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// QR-URL bauen
// ---------------------------------------------------------------------------

export function buildQrUrl(base: string, token: string, type: 'item' | 'location'): string {
  return `${base}/${type === 'item' ? 'a' : 'l'}/${token}`;
}

// ---------------------------------------------------------------------------
// PDF erzeugen
// ---------------------------------------------------------------------------

const MM_TO_PT = 72 / 25.4;

export function drawLabel(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  data: LabelRow,
  qrBuf: Buffer,
  logoBuf: Buffer | null,
) {
  const pad = 2 * MM_TO_PT;

  // Hintergrund + Rahmen
  doc.save();
  doc.roundedRect(x, y, w, h, 3).lineWidth(0.4).stroke('#d0d7de');

  const contentX = x + pad;
  const contentY = y + pad;
  const contentW = w - 2 * pad;
  const contentH = h - 2 * pad;

  // QR: möglichst groß, aber nie über den Rand + nie breiter als 45 % des Inhalts
  const qrSize = Math.min(
    contentW * 0.45,
    Math.max(12 * MM_TO_PT, contentH - pad),
    contentH,
  );
  const gap = 2 * MM_TO_PT;
  const textAreaW = Math.max(10, contentW - qrSize - gap);

  // QR rechts, vertikal zentriert
  doc.image(qrBuf, x + w - pad - qrSize, contentY + (contentH - qrSize) / 2, {
    width: qrSize,
    height: qrSize,
  });

  // Logo oben links – deutlich größer, proportional skaliert, nie breiter als der Textbereich
  const logoH = Math.min(12.5 * MM_TO_PT, contentH * 0.45);
  let headerEndY = contentY;
  if (logoBuf) {
    try {
      doc.image(logoBuf, contentX, headerEndY, {
        height: logoH,
        fit: [Math.min(textAreaW, logoH * 1.9), logoH],
      });
      headerEndY += logoH;

      // Dezenter grüner Trennstrich als Kopf-Trenner – nur bei ausreichender Höhe
      if (contentH >= 20 * MM_TO_PT) {
        const lineY = headerEndY + 1.2 * MM_TO_PT;
        doc
          .moveTo(contentX, lineY)
          .lineTo(contentX + textAreaW, lineY)
          .lineWidth(0.5)
          .strokeColor('#3fae6a')
          .opacity(0.8)
          .stroke();
        headerEndY = lineY + 1.4 * MM_TO_PT;
      } else {
        headerEndY += 2 * MM_TO_PT;
      }
    } catch {
      // Logo ungültig → ignorieren
      headerEndY = contentY + 1 * MM_TO_PT;
    }
  } else {
    headerEndY = contentY + 1 * MM_TO_PT;
  }

  const bottomY = contentY + contentH;
  const remainingH = Math.max(4 * MM_TO_PT, bottomY - headerEndY);

  // Haupttext (Inventarnummer / Code)
  const mainText = data.label_text || data.name;
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#0b0f14');
  const mainOpts = {
    width: textAreaW,
    height: Math.min(Math.max(9 * MM_TO_PT, remainingH * 0.6), remainingH),
    ellipsis: true,
  };
  doc.text(mainText, contentX, headerEndY, mainOpts);
  let ty = headerEndY + Math.min(mainOpts.height, doc.heightOfString(mainText, mainOpts)) + 1.2;

  // Name / Untertitel
  const sub = data.sub_text ?? data.name;
  if (sub && sub !== mainText && ty < bottomY - 5.5 * MM_TO_PT) {
    doc.fontSize(7).font('Helvetica').fillColor('#555');
    const subOpts = {
      width: textAreaW,
      height: Math.max(5.5 * MM_TO_PT, bottomY - ty - 5.5 * MM_TO_PT),
      ellipsis: true,
    };
    doc.text(sub, contentX, ty, subOpts);
    ty += Math.min(subOpts.height, doc.heightOfString(sub, subOpts));
  }

  // Ort (bei Artikeln)
  if (data.type === 'item' && data.location_path && data.location_path !== sub && ty < bottomY - 4 * MM_TO_PT) {
    doc.fontSize(6).font('Helvetica').fillColor('#888');
    const locOpts = {
      width: textAreaW,
      height: Math.max(4 * MM_TO_PT, bottomY - ty - 4 * MM_TO_PT),
      ellipsis: true,
    };
    doc.text(data.location_path, contentX, ty, locOpts);
  }

  doc.restore();
}

export async function generateLabelsPdf(
  data: LabelRow[],
  format: LabelFormat,
  qrBaseUrl: string,
  out: NodeJS.WritableStream,
): Promise<void> {
  const { width: labelW, height: labelH } = format;
  const layout = await resolveLabelLayout();
  const usableW = 210 - layout.marginLeft - layout.marginRight;
  const usableH = 297 - layout.marginTop - layout.marginBottom;

  let cols: number;
  let rows: number;
  let gapX: number;
  let gapY: number;
  if (layout.distribute) {
    // Freien Platz gleichmäßig als Abstände verteilen → Labels füllen die Seite
    cols = Math.max(1, Math.floor(usableW / labelW));
    rows = Math.max(1, Math.floor(usableH / labelH));
    gapX = (usableW - cols * labelW) / (cols + 1);
    gapY = (usableH - rows * labelH) / (rows + 1);
  } else {
    // Fester Abstand, oben links startend – Labels + Abstände bleiben innerhalb der Ränder
    cols = Math.max(1, Math.floor((usableW + layout.gapX) / (labelW + layout.gapX)));
    rows = Math.max(1, Math.floor((usableH + layout.gapY) / (labelH + layout.gapY)));
    gapX = layout.gapX;
    gapY = layout.gapY;
  }

  // Logo laden
  const { resolveBrandingLogo } = await import('../../utils/branding.js');
  const logoPath = await resolveBrandingLogo();
  let logoBuf: Buffer | null = null;
  if (logoPath) {
    try {
      const fs = await import('node:fs/promises');
      logoBuf = await fs.readFile(logoPath);
    } catch {
      logoBuf = null;
    }
  }

  // QR-Codes vorab erzeugen
  const qrBuffers: Buffer[] = [];
  for (const row of data) {
    const url = buildQrUrl(qrBaseUrl, row.qr_token, row.type);
    const buf = await QRCode.toBuffer(url, { width: 240, margin: 1, errorCorrectionLevel: 'M' });
    qrBuffers.push(buf);
  }

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(out);

  let posOnPage = 0;

  for (let i = 0; i < data.length; i++) {
    if (posOnPage === cols * rows) {
      doc.addPage({ size: 'A4', margin: 0 });
      posOnPage = 0;
    }

    const col = posOnPage % cols;
    const row = Math.floor(posOnPage / cols);
    const x = (layout.marginLeft + gapX + col * (labelW + gapX)) * MM_TO_PT;
    const y = (layout.marginTop + gapY + row * (labelH + gapY)) * MM_TO_PT;
    const w = labelW * MM_TO_PT;
    const h = labelH * MM_TO_PT;

    drawLabel(doc, x, y, w, h, data[i], qrBuffers[i], logoBuf);
    posOnPage++;
  }

  doc.end();
  await new Promise<void>((resolve) => out.on('finish', () => resolve()));
}
