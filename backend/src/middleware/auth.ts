import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { pool } from '../db/pool.js';
import type { AuthedUser, RoleName } from '../types/index.js';

const TOKEN_COOKIE = 'tms_token';

export interface JwtPayload {
  sub: number;
  username: string;
  role: RoleName;
}

export function signToken(user: AuthedUser): string {
  return jwt.sign(
    { username: user.username, role: user.role },
    config.jwtSecret,
    { subject: String(user.id), expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] }
  );
}

export function setTokenCookie(res: Response, token: string): void {
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearTokenCookie(res: Response): void {
  res.clearCookie(TOKEN_COOKIE, { path: '/' });
}

export async function loadUserById(id: number): Promise<AuthedUser | null> {
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.name, u.email, u.active, u.must_change_password, r.name AS role
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = ?`,
    [id]
  );
  const row = (rows as Array<{
    id: number;
    username: string;
    name: string;
    email: string | null;
    active: number;
    must_change_password: number;
    role: RoleName;
  }>)[0];
  if (!row || !row.active) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email,
    role: row.role,
    must_change_password: !!row.must_change_password,
  };
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.cookies?.[TOKEN_COOKIE];
    if (!token) {
      res.status(401).json({ error: 'Nicht angemeldet' });
      return;
    }
    const payload = jwt.verify(token, config.jwtSecret) as unknown as JwtPayload;
    const user = await loadUserById(Number(payload.sub));
    if (!user) {
      res.status(401).json({ error: 'Benutzer nicht gefunden oder deaktiviert' });
      return;
    }
    req.user = user;

    // Solange das Passwort nicht gewechselt wurde, sind nur die Endpunkte
    // unterhalb erlaubt. Das Flag war vorher rein kosmetisch und wurde nur im
    // Frontend ausgewertet – mit `curl` konnte es ignoriert werden.
    if (user.must_change_password && !PASSWORD_CHANGE_ALLOWED.has(req.path)) {
      res.status(403).json({
        error: 'Bitte setze zuerst ein neues Passwort',
        code: 'must_change_password',
      });
      return;
    }

    next();

  } catch {
    res.status(401).json({ error: 'Sitzung abgelaufen, bitte erneut anmelden' });
  }
}

export function requireRole(...roles: RoleName[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Keine Berechtigung für diese Aktion' });
      return;
    }
    next();
  };
}

/**
 * Endpunkte, die auch mit offenem `must_change_password` erreichbar bleiben
 * müssen – sonst könnte ein Benutzer mit temporärem Passwort sein Passwort
 * gar nicht erst ändern. `req.path` ist hier relativ zum Router-Mount.
 */
const PASSWORD_CHANGE_ALLOWED = new Set(['/me', '/password', '/logout', '/csrf']);

