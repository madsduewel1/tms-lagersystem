import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import { config } from '../config/env.js';

const CSRF_COOKIE = 'tms_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfCookie(res: Response): string {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, {
    // Muss für das Frontend lesbar sein (Double-Submit), daher nicht httpOnly.
    httpOnly: false,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: '/',
  });
  return token;
}

export function csrfProtect(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];
  if (
    typeof cookieToken !== 'string' ||
    typeof headerToken !== 'string' ||
    cookieToken.length !== headerToken.length ||
    !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))
  ) {
    res.status(403).json({ error: 'CSRF-Validierung fehlgeschlagen' });
    return;
  }
  next();
}
