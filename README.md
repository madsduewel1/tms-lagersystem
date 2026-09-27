# TMS Event-Technik Lager

Webbasiertes Lagerverwaltungssystem für Event-Technik – bewusst schlank gehalten
(statt eines großen ERP). Verwaltet Einzelgeräte, Artikelbestand, Lagerplätze,
Events und Inventuren.

## Status

Phase 1 (Grundsystem) – lauffähig:

- Projektstruktur (Backend / Frontend / Datenbank / Skripte)
- MariaDB-Schema (Benutzer, Rollen, Einstellungen, Audit-Log)
- Backend: Node.js + TypeScript + Express, JWT-Auth (httpOnly-Cookie), CSRF,
  Rate-Limiting beim Login, serverseitige Rollenprüfung, Audit-Log
- Frontend: React + TypeScript + Vite, dunkles Theme, Login, Ersteinrichtung,
  Dashboard, Benutzerverwaltung (nur Admin), Audit-Log (nur Admin),
  Systemeinstellungen (nur Admin)
- Systemdienst (`tms-lager`) per systemd, Apache2-Reverse-Proxy unter
  `/lagersystem`, automatische tägliche Backups per systemd-Timer
- install.sh / update.sh / backup.sh / uninstall.sh

## Installation

```bash
sudo ./scripts/install.sh
```

Prüft Betriebssystem, Root-Rechte, Ports, Speicherplatz; installiert
MariaDB + Node.js, legt Datenbank und Systembenutzer an, baut die Anwendung,
richtet den Systemdienst `tms-lager` sowie Apache2 mit dem Unterpfad
`/lagersystem` ein, aktiviert tägliche Backups und prüft abschließend
`/api/health`.

Beim ersten Aufruf der Webseite erscheint die **Ersteinrichtung**: Der erste
Benutzer wird automatisch zum Administrator.

`install.sh` ist nicht dafür gedacht, eine bestehende Installation zu
überschreiben – dafür `update.sh` verwenden.

### Zugriffsdaten der Datenbank

Wird kein Passwort angegeben, fragt `install.sh` danach (nur interaktiv) und
erzeugt sonst ein zufälliges, das am Ende einmalig ausgegeben wird. Bereits
vorhandene Zugangsdaten aus `backend/.env` werden unverändert übernommen.

```bash
sudo TMS_DB_NAME=tms_lager TMS_DB_USER=tms TMS_DB_PASSWORD='<geheim>' ./scripts/install.sh
```

Ohne `TMS_DB_PASSWORD` gilt der Development-Default `tms_lager_dev`; das Skript
warnt dann ausdrücklich davor.

| Variable                      | Standard                    | Wirkung                                       |
| ----------------------------- | --------------------------- | --------------------------------------------- |
| `TMS_PORT`                    | `3000`                      | Port des Backends                             |
| `TMS_DB_NAME`                 | `tms_lager`                 | Datenbankname                                 |
| `TMS_DB_USER`                 | `tms`                       | Datenbankbenutzer                            |
| `TMS_DB_PASSWORD`             | `tms_lager_dev`             | Passwort des Datenbankbenutzers               |
| `TMS_BACKUP_RETENTION_DAYS`   | `14`                        | Aufbewahrung der automatischen Backups        |
| `TMS_SKIP_UPGRADE`            | `0`                         | `1` überspringt `apt-get upgrade`             |

### HTTPS

Das Skript richtet bewusst **kein** TLS ein. TLS wird von einem vorgeschalteten
Proxy (z. B. nginx/HAProxy/Traefik) übernommen, der auf
`http://127.0.0.1:3000` bzw. `/lagersystem` weiterleitet. Für HTTPS von außen
muss im Proxy `COOKIE_SECURE=true` in `backend/.env` gesetzt werden, sonst
werden die Session-Cookies nur über HTTP akzeptiert.

## Entwicklung

```bash
# Datenbank
sudo mysql -e "CREATE DATABASE tms_lager ...; CREATE USER 'tms'@'localhost' ...; GRANT ..."   # oder: install.sh
mariadb tms_lager < database/schema.sql

# Backend
cd backend
cp ../config/.env.example .env
npm install
npm run dev          # http://localhost:3000

# Frontend (eigenes Terminal)
cd frontend
npm install
npm run dev          # http://localhost:5173 (proxyt /api ans Backend)
```

## Backups

Täglich um 02:30 Uhr legt der systemd-Timer `tms-lager-backup.timer` ein Backup
an (Datenbank-Dump plus `.env` und `schema.sql` nach `backups/`); ältere
Backups werden nach `TMS_BACKUP_RETENTION_DAYS` Tagen gelöscht.

```bash
sudo ./scripts/backup.sh              # manuell
sudo ./scripts/backup.sh --quiet      # wie vom Timer aufgerufen
systemctl list-timers tms-lager-backup.timer
systemctl status tms-lager-backup.service
```

Wiederherstellung:

```bash
sudo systemctl stop tms-lager
sudo mariadb tms_lager < backups/tms-lager_YYYYMMDD_HHMMSS.sql
sudo systemctl start tms-lager
```

## Updates

```bash
sudo ./scripts/update.sh              # mit Sicherheits-Backup
sudo ./scripts/update.sh --no-backup  # ohne
```

`update.sh` legt vor dem Update ein Backup an, spielt offene Migrationen aus
`database/migrations/` in Reihenfolge ab (bricht bei einem Fehler ab, statt ihn
zu übergehen), baut Backend und Frontend neu, gleicht `backend/.env` mit
`config/.env.example` ab, aktualisiert das Apache-Snippet, prüft
`/api/health` und richtet den Backup-Timer nach, falls er fehlt.

## Projektstruktur

```text
backend/     Node.js + TypeScript (Express, MariaDB)
frontend/    React + TypeScript (Vite)
database/    schema.sql, migrations/
scripts/     install.sh, update.sh, backup.sh, uninstall.sh, lib/common.sh
config/      .env.example, apache2-lagersystem.conf
```

## Rollen

- **Administrator**: alles inkl. Benutzer, Einstellungen, Audit-Log
- **Techniker**: Lagerarbeit (Phase 2 folgt); kein Zugriff auf Administration

## Geplante Module (ab Phase 2)

Lager/Bestand, Einzelgeräte, Kategorien, Lagerplätze, Suche/Filter, Inventur,
QR-Codes, Events, Aus-/Einlagerung.