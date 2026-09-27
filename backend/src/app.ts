import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config, isProduction } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { csrfProtect } from './middleware/csrf.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { setupRouter } from './modules/setup/setup.routes.js';
import { usersRouter, usersOptionsRouter } from './modules/users/users.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { modulesRouter } from './modules/modules/modules.routes.js';
import { categoriesRouter } from './modules/categories/categories.routes.js';
import { suppliersRouter } from './modules/suppliers/suppliers.routes.js';
import { storageRouter } from './modules/storage/storage.routes.js';
import { casesRouter } from './modules/cases/cases.routes.js';
import { devicesRouter, articlesRouter, itemsLookupRouter } from './modules/items/items.routes.js';
import { searchRouter } from './modules/search/search.routes.js';
import { inventoryRouter } from './modules/inventory/inventory.routes.js';
import { eventsRouter } from './modules/events/events.routes.js';
import { checkoutsRouter } from './modules/checkouts/checkouts.routes.js';
import { maintenanceRouter } from './modules/maintenance/maintenance.routes.js';
import { documentsRouter } from './modules/documents/documents.routes.js';
import { purchasesRouter } from './modules/purchases/purchases.routes.js';
import { labelsRouter } from './modules/labels/labels.routes.js';
import { resolveRouter } from './modules/resolve/resolve.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, '../../frontend/dist');

export const app = express();

// X-Forwarded-For nur von Reverse-Proxys im gleichen Host akzeptieren. Mit dem
// pauschalen `trust proxy: 1` könnte jeder den Login-Rate-Limit umgehen und
// Audit-Log-IPs fälschen, indem er den Header selbst setzt.
if (config.trustProxy !== false) {
  app.set('trust proxy', config.trustProxy);
}

// HSTS nur aktivieren, wenn die App wirklich hinter TLS läuft. Sonst blockiert
// der Browser nach dem ersten Besuch dauerhaft den Aufruf über http://.
app.use(
  helmet({
    contentSecurityPolicy: false,
    strictTransportSecurity: config.hstsMaxAge > 0
      ? { maxAge: config.hstsMaxAge, includeSubDomains: true }
      : false,
  })
);

app.use(
  cors({
    origin: isProduction ? false : config.frontendOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.use(csrfProtect);

app.use('/api/auth', authRouter);
app.use('/api/setup', setupRouter);
app.use('/api/users', usersOptionsRouter, usersRouter);
app.use('/api/audit', auditRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/modules', modulesRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/storage-locations', storageRouter);
app.use('/api/cases', casesRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/items', itemsLookupRouter);
app.use('/api/search', searchRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/events', eventsRouter);
app.use('/api/checkouts', checkoutsRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/labels', labelsRouter);
app.use('/api/resolve', resolveRouter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
  app.use(express.static(frontendDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);
