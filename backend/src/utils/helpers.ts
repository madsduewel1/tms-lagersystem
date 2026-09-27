import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { HttpError } from '../middleware/error.js';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function parseId(value: string | undefined, label = 'ID'): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `Ungültige ${label}`);
  return id;
}

/**
 * Liest eine Ganzzahl aus Query-Parametern und begrenzt sie auf [min, max].
 *
 * `Number('abc')` liefert NaN, `Number('1e999')` Infinity. Beide wurden vorher
 * ungeprüft in LIMIT/OFFSET eingesetzt – mysql2 interpoliert solche Werte
 * wörtlich ("LIMIT NaN") und die Query bricht mit einem 500er ab.
 */
export function parseIntParam(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const n = typeof value === 'number' ? value : Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function parsePagination(query: Request['query']): {
  page: number;
  pageSize: number;
  offset: number;
} {
  const page = parseIntParam(query.page, 1, 1, 1_000_000);
  const pageSize = parseIntParam(query.pageSize, 50, 1, 200);
  return { page, pageSize, offset: (page - 1) * pageSize };
}


export function newToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function nullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

export function nullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function distinct<T>(rows: T[], key: keyof T): T[] {
  const seen = new Set<unknown>();
  return rows.filter((r) => {
    const k = r[key];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
