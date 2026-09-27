#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${APP_DIR}/backend"
FRONTEND_DIR="${APP_DIR}/frontend"

# shellcheck source=scripts/lib/common.sh
source "${APP_DIR}/scripts/lib/common.sh"

for arg in "$@"; do
  case "${arg}" in
    -h|--help)
      printf 'Verwendung: sudo ./scripts/install.sh\n\n'
      printf 'Umgebungsvariablen:\n'
      printf '  TMS_PORT                    Port des Backends (Standard 3000)\n'
      printf '  TMS_DB_NAME/_USER/_PASSWORD Datenbank-Zugangsdaten\n'
      printf '  TMS_BACKUP_RETENTION_DAYS   Aufbewahrung täglicher Backups (Standard 14)\n'
      printf '  TMS_SKIP_UPGRADE=1          kein apt-get upgrade ausführen\n'
      exit 0
      ;;
    *) fail "Unbekannte Option: ${arg} (erlaubt: -h/--help)" ;;
  esac
done

require_root "install.sh"

apt_quiet() {
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "$@" >/dev/null
}

resolve_db_password() {
  local existing answer confirm
  if [[ -n "${TMS_DB_PASSWORD:-}" ]]; then
    return
  fi
  if [[ -f "${ENV_FILE}" ]]; then
    existing="$(read_env_value "${ENV_FILE}" DB_PASSWORD || true)"
    if [[ -n "${existing}" ]]; then
      DB_PASSWORD="${existing}"
      log "DB-Passwort aus bestehender backend/.env übernommen."
      return
    fi
  fi
  if [[ -t 0 ]]; then
    while true; do
      printf '    Passwort für DB-Benutzer %s (leer lassen = Zufallswert): ' "${DB_USER}"
      read -r -s answer
      echo
      if [[ -z "${answer}" ]]; then
        break
      fi
      printf '    Passwort wiederholen: '
      read -r -s confirm
      echo
      if [[ "${answer}" == "${confirm}" ]]; then
        DB_PASSWORD="${answer}"
        return
      fi
      warn "Die beiden Eingaben stimmen nicht überein – bitte wiederholen."
    done
  fi
  DB_PASSWORD="$(openssl rand -hex 16)"
  GENERATED_DB_PASSWORD=true
  warn "Zufälliges DB-Passwort erzeugt – es wird am Ende einmalig angezeigt."
}

port_in_use() {
  local port="$1" addrs
  command -v ss >/dev/null 2>&1 || return 1
  addrs="$(ss -ltn 2>/dev/null | awk 'NR>1 {print $4}' || true)"
  grep -qE "(:|\.)${port}\$" <<< "${addrs}"
}

info "TMS Lager – Installation"
log "Verzeichnis: ${APP_DIR}"

if [[ -s /etc/os-release ]]; then
  source /etc/os-release
fi
case "${ID:-${ID_LIKE:-}}" in
  debian|ubuntu|raspbian) : ;;
  *)
    if [[ "${ID_LIKE:-}" == *debian* || "${ID_LIKE:-}" == *ubuntu* ]]; then
      :
    else
      fail "Nur Debian/Ubuntu/Raspbian werden offiziell unterstützt (gefunden: ${PRETTY_NAME:-unbekannt})."
    fi
    ;;
esac
ok "Betriebssystem: ${PRETTY_NAME:-unbekannt}"

AVAILABLE_MB=$(df -Pm "${APP_DIR}" | awk 'NR==2 {print $4}')
if [[ "${AVAILABLE_MB}" -lt 1024 ]]; then
  fail "Zu wenig Speicherplatz: nur ${AVAILABLE_MB} MB frei (mindestens 1 GB benötigt)."
fi
ok "Speicherplatz: ${AVAILABLE_MB} MB frei"

if port_in_use "${TMS_PORT}"; then
  if systemctl is-active --quiet "${TMS_SERVICE}"; then
    fail "Dienst '${TMS_SERVICE}' läuft bereits auf Port ${TMS_PORT} – für ein Update sudo ./scripts/update.sh verwenden."
  fi
  fail "Port ${TMS_PORT} ist bereits belegt."
fi
ok "Port ${TMS_PORT} ist frei"
if port_in_use 80; then
  log "Port 80 ist belegt (evtl. bestehender Webserver) – Apache-Konfiguration wird danach geprüft."
fi

info "Systempakete aktualisieren und installieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
if [[ "${TMS_SKIP_UPGRADE:-0}" == "1" ]]; then
  log "apt-get upgrade übersprungen (TMS_SKIP_UPGRADE=1)"
else
  apt-get upgrade -y -qq --no-install-recommends >/dev/null || warn "apt-get upgrade meldete einen Fehler – fahre fort."
fi
apt_quiet curl ca-certificates openssl
ok "Werkzeuge: curl, openssl, ca-certificates"

if ! mariadb_installed; then
  apt_quiet mariadb-server
fi

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]]; then
  apt_quiet gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource.gpg.key" | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_%s.x nodistro main\n' "${NODE_MAJOR}" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt_quiet nodejs
  ok "Node.js ${NODE_MAJOR}.x installiert: $(node --version)"
else
  ok "Node.js vorhanden: $(node --version)"
fi

info "MariaDB starten"
MARIADB_UNIT="$(mariadb_unit)"
systemctl enable "${MARIADB_UNIT}" >/dev/null 2>&1 || true
systemctl start "${MARIADB_UNIT}"
mariadb_active || fail "MariaDB konnte nicht gestartet werden."
ok "MariaDB läuft (${MARIADB_UNIT})"

info "Zugangsdaten der Datenbank ermitteln"
load_env_defaults
GENERATED_DB_PASSWORD=false
resolve_db_password
log "Datenbank ${DB_NAME}, Benutzer ${DB_USER}, Backend-Port ${TMS_PORT}"
if [[ "${DB_PASSWORD}" == "${DB_DEV_PASSWORD}" ]]; then
  warn "Es wird das schwache Standard-Passwort '${DB_DEV_PASSWORD}' verwendet."
  warn "Für den Produktivbetrieb: sudo TMS_DB_PASSWORD='<geheim>' ./scripts/install.sh"
fi

info "Abhängigkeiten installieren"
if ! id "${TMS_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/tms-lager --shell /usr/sbin/nologin "${TMS_USER}"
  mkdir -p /var/lib/tms-lager
  chown "${TMS_USER}:${TMS_USER}" /var/lib/tms-lager
fi

npm --prefix "${BACKEND_DIR}" install >/dev/null 2>&1
npm --prefix "${FRONTEND_DIR}" install >/dev/null 2>&1
ok "npm-Abhängigkeiten installiert"

info "Anwendung bauen"
build_project "${BACKEND_DIR}" "Backend"
build_project "${FRONTEND_DIR}" "Frontend"

info "Datenbank einrichten"
ensure_database "${DB_NAME}" "${DB_USER}" "${DB_PASSWORD}"
backup_before_schema_change "${DB_NAME}" "vor dem Schema-Update"
apply_migrations "${DB_NAME}"

info "Konfiguration erstellen"
if [[ -f "${ENV_FILE}" ]]; then
  ok "backend/.env existiert bereits (Sicherung: ${ENV_FILE}.bak)"
else
  ok "config/.env.example nach backend/.env kopiert"
fi
sync_env_file "${TMS_PORT}" "${DB_NAME}" "${DB_USER}" "${DB_PASSWORD}"

chown -R "${TMS_USER}:${TMS_USER}" "${APP_DIR}"

info "Logo / Branding prüfen"
install -d -o "${TMS_USER}" -g "${TMS_USER}" "${APP_DIR}/assets/branding"
LOGO_SOURCE=""
for name in tms-logo.png tms-technik-logo.png tms-logo.jpeg tms-technik-logo.jpeg \
            tms-logo.jpg tms-technik-logo.jpg tms-logo-label.png; do
  if [[ -f "${APP_DIR}/assets/branding/${name}" ]]; then
    LOGO_SOURCE="${APP_DIR}/assets/branding/${name}"
    break
  fi
done
if [[ -n "${LOGO_SOURCE}" ]]; then
  install -d -o "${TMS_USER}" -g "${TMS_USER}" "${BACKEND_DIR}/uploads"
  ext="${LOGO_SOURCE##*.}"
  LOGO_FILE="logo-$(date +%s)-${RANDOM}.${ext}"
  cp "${LOGO_SOURCE}" "${BACKEND_DIR}/uploads/${LOGO_FILE}"
  chown "${TMS_USER}:${TMS_USER}" "${BACKEND_DIR}/uploads/${LOGO_FILE}" 2>/dev/null || true
  db_root "${DB_NAME}" <<SQL || warn "Logo konnte nicht in den Einstellungen hinterlegt werden."
INSERT INTO settings (setting_key, setting_value) VALUES
  ('logo_file', '${LOGO_FILE}'), ('logo_url', '/api/settings/logo')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
SQL
  ok "Logo übernommen: ${LOGO_SOURCE}"
else
  warn "Kein Logo in assets/branding/ gefunden – bitte später über die Einstellungen hochladen."
fi

info "Systemdienst einrichten"
write_service_unit
systemctl enable "${TMS_SERVICE}" >/dev/null 2>&1 || true
if ! systemctl restart "${TMS_SERVICE}"; then
  journalctl -u "${TMS_SERVICE}" --no-pager -n 30 || true
  fail "Dienst '${TMS_SERVICE}' konnte nicht gestartet werden."
fi
if systemctl is-active --quiet "${TMS_SERVICE}"; then
  ok "Dienst '${TMS_SERVICE}' läuft"
else
  journalctl -u "${TMS_SERVICE}" --no-pager -n 30 || true
  fail "Dienst '${TMS_SERVICE}' läuft nicht."
fi
check_api "http://localhost:${TMS_PORT}/api/health"

info "Webserver (Apache2) und Unterpfad /lagersystem einrichten"
if ! command -v apache2 >/dev/null 2>&1; then
  apt_quiet apache2
fi
systemctl enable apache2 >/dev/null 2>&1 || true
for module in proxy proxy_http rewrite headers; do
  a2enmod -q "${module}" >/dev/null 2>&1 || true
done
deploy_frontend
refresh_apache_config

if wait_for_api "http://localhost/lagersystem/api/health" 5; then
  ok "Unterpfad erreichbar: http://localhost/lagersystem/api/health"
else
  warn "http://localhost/lagersystem/api/health antwortet nicht – Apache/vHost bzw. Proxy prüfen."
fi

info "Automatische Backups einrichten"
install_backup_timer

WEB_HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
WEB_URL="http://${WEB_HOST:-localhost}/lagersystem/"

info "Installation abgeschlossen"
log "Weboberfläche:  ${WEB_URL}"
log "Direkt (Backend): http://localhost:${TMS_PORT}  (API: /api/health)"
log "Ersteinrichtung: beim ersten Aufruf im Browser wird der Administrator angelegt."
log "Dienst:          systemctl status ${TMS_SERVICE}"
log "Backup:          automatisch täglich 02:30 Uhr, Aufbewahrung ${BACKUP_RETENTION_DAYS} Tage"
log "Backup manuell:  sudo ./scripts/backup.sh"
log "Backups ansehen: ls -l ${BACKUP_DIR}"
log "Update:          sudo ./scripts/update.sh"
log "Deinstallation:  sudo ./scripts/uninstall.sh"
if [[ "${GENERATED_DB_PASSWORD}" == true ]]; then
  log ""
  log "Zufällig erzeugtes DB-Passwort (jetzt sicher speichern): ${DB_PASSWORD}"
  log "Später ändern: sudo mariadb -e \"ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '<neu>';\""
  log "               und in backend/.env (DB_PASSWORD) sowie im Backup-Archiv nachziehen."
fi
