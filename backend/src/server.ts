import { app } from './app.js';
import { config } from './config/env.js';
import { pingDatabase } from './db/pool.js';

async function start(): Promise<void> {
  try {
    await pingDatabase();
    console.log('Datenbankverbindung OK');
  } catch (err) {
    console.error('Datenbank nicht erreichbar. Läuft install.sh schon (DB angelegt)?');
    console.error(err);
    process.exit(1);
  }
  app.listen(config.port, config.host, () => {
    console.log(`TMS Lager Backend läuft auf http://${config.host}:${config.port}`);
  });
}

start();