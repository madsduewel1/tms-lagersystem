import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

/**
 * `trust proxy` akzeptiert Boolean, Zahl oder IP-Subnetzliste.
 * Ohne explizite Konfiguration vertrauen wir in Produktion nur Loopback-
 * Verbindungen (der Apache-Reverse-Proxy läuft auf demselben Host).
 */
function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (value === undefined || value === '') {
    return process.env.NODE_ENV === 'production' ? 'loopback' : 1;
  }
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  const asNumber = Number(value);
  return Number.isInteger(asNumber) && asNumber >= 0 ? asNumber : value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  cookieSameSite: (process.env.COOKIE_SAMESITE ?? 'strict') as 'lax' | 'strict' | 'none',
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'tms',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'tms_lager',
  },
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  // Reverse-Proxy-Vertrauen. Voreinstellung in Produktion: nur Loopback
  // (Apache/nginx auf demselben Host). 'false' deaktiviert es komplett.
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  // 0 = HSTS aus (Standard, solange kein TLS konfiguriert ist).
  hstsMaxAge: Number(process.env.HSTS_MAX_AGE ?? 0) || 0,
  uploadsDir: process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads'),
};

export const isProduction = config.nodeEnv === 'production';

/**
 * In Produktion darf es keine Rückfallwerte für Secrets geben. Ein leeres oder
 * versehentlich nicht gesetztes JWT_SECRET würde sonst bedeuten, dass jeder den
 * geheimen Schlüssel kennt und beliebige Admin-Tokens fälschen kann.
 */
function assertProductionConfig(): void {
  if (!isProduction) return;

  const problems: string[] = [];
  if (!config.jwtSecret) {
    problems.push('JWT_SECRET fehlt (erzeugen mit: openssl rand -hex 32)');
  } else if (config.jwtSecret === 'please-change-me' || config.jwtSecret.length < 32) {
    problems.push('JWT_SECRET ist zu kurz oder noch der Beispielwert aus .env.example');
  }
  if (!config.db.password) {
    problems.push('DB_PASSWORD fehlt');
  }
  if (config.cookieSameSite === 'none' && !config.cookieSecure) {
    problems.push('COOKIE_SAMESITE=none benötigt COOKIE_SECURE=true');
  }

  if (problems.length > 0) {
    throw new Error(
      `Unsichere Produktionskonfiguration:\n  - ${problems.join('\n  - ')}\n` +
        'Bitte .env prüfen (siehe config/.env.example).'
    );
  }
}

assertProductionConfig();
