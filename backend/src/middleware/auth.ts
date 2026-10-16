import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { pool } from '../db/pool.js';
import type { AuthedUser, RoleName, RoleRef } from '../types/index.js';

const TOKEN_COOKIE = 'tms_token';

export interface JwtPayload {
  sub: number;
  username: string;
}

export function signToken(user: AuthedUser): string {
  return jwt.sign(
    { username: user.username },
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
    `SELECT u.id, u.username, u.name, u.email, u.active, u.must_change_password
     FROM users u
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
  }>)[0];
  if (!row || !row.active) return null;

  const [roleRows] = await pool.query(
    `SELECT r.id, r.name, r.label
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ?
     ORDER BY r.sort, r.name`,
    [id]
  );
  const roles = roleRows as RoleRef[];

  const [permRows] = await pool.query(
    `SELECT DISTINCT p.code
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = ?`,
    [id]
  );
  const permissions = (permRows as Array<{ code: string }>).map((p) => p.code);

  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email,
    roles,
    permissions,
    isAdmin: roles.some((r) => r.name === 'administrator'),
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
    // Algorithmus festnageln: ohne explizite Allowlist würde eine signierte
    // "alg: none"- oder RS256-Variante vom Token akzeptiert.
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
    }) as unknown as JwtPayload;
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
    if (!req.user || !req.user.roles.some((r) => roles.includes(r.name))) {
      res.status(403).json({ error: 'Keine Berechtigung für diese Aktion' });
      return;
    }
    next();
  };
}

function hasPermission(user: AuthedUser, code: string): boolean {
  return user.permissions.includes(code);
}

/**
 * Verlangt alle angegebenen Rechte. Der Administrator besitzt per Seed alle
 * Rechte, wird aber nicht gesondert behandelt – die Prüfung läuft ausschließlich
 * über die zugewiesenen Rechte.
 */
export function requirePermission(...codes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Nicht angemeldet' });
      return;
    }
    if (!codes.every((code) => hasPermission(req.user!, code))) {
      res.status(403).json({ error: 'Keine Berechtigung für diese Aktion' });
      return;
    }
    next();
  };
}

/** Verlangt mindestens eines der angegebenen Rechte. */
export function requireAnyPermission(...codes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Nicht angemeldet' });
      return;
    }
    if (!codes.some((code) => hasPermission(req.user!, code))) {
      res.status(403).json({ error: 'Keine Berechtigung für diese Aktion' });
      return;
    }
    next();
  };
}

/**
 * Modulweite Rechteprüfung: Lesende Methoden (GET/HEAD/OPTIONS) verlangen das
 * Ansehen-Recht (oder das Verwalten-Recht), schreibende Methoden das
 * Verwalten-Recht.
 */
export function requireModule(viewCode: string, manageCode: string) {
  const safe = new Set(['GET', 'HEAD', 'OPTIONS']);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Nicht angemeldet' });
      return;
    }
    if (safe.has(req.method)) {
      if (hasPermission(req.user, viewCode) || hasPermission(req.user, manageCode)) {
        next();
        return;
      }
    } else if (hasPermission(req.user, manageCode)) {
      next();
      return;
    }
    res.status(403).json({ error: 'Keine Berechtigung für diese Aktion' });
  };
}

/**
 * Endpunkte, die auch mit offenem `must_change_password` erreichbar bleiben
 * müssen – sonst könnte ein Benutzer mit temporärem Passwort sein Passwort
 * gar nicht erst ändern. `req.path` ist hier relativ zum Router-Mount.
 */
const PASSWORD_CHANGE_ALLOWED = new Set(['/me', '/password', '/logout', '/csrf']);

