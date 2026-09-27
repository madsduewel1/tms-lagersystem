#!/usr/bin/env bash
# Gemeinsame Hilfsfunktionen für install.sh, update.sh und backup.sh.
# Wird ausschließlich per "source" eingebunden.
#
# Erwartet von der aufrufenden Datei:
#   APP_DIR, BACKEND_DIR, FRONTEND_DIR

TMS_SERVICE="${TMS_SERVICE:-tms-lager}"
TMS_USER="${TMS_USER:-tms}"
TMS_PORT="${TMS_PORT:-3000}"
DB_NAME="${TMS_DB_NAME:-}"
DB_USER="${TMS_DB_USER:-}"
DB_PASSWORD="${TMS_DB_PASSWORD:-}"
NODE_MAJOR="${NODE_MAJOR:-20}"
DB_DEV_PASSWORD="tms_lager_dev"

FRONTEND_DEPLOY_DIR="${FRONTEND_DEPLOY_DIR:-/opt/lagersystem}"
APACHE_SNIPPET="/etc/apache2/lagersystem-snippet.conf"
APACHE_SNIPPET_SOURCE="${APP_DIR}/config/apache2-lagersystem.conf"
BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/backups}"
BACKUP_RETENTION_DAYS="${TMS_BACKUP_RETENTION_DAYS:-14}"
ENV_EXAMPLE="${APP_DIR}/config/.env.example"
ENV_FILE="${BACKEND_DIR}/.env"

info() { printf '\033[1;36m%s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }
log()  { printf '    %s\n' "$*"; }

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "$1 muss mit root-Rechten ausgeführt werden: sudo ./scripts/$1"
  fi
}

db_root() {
  mariadb --protocol=socket -uroot "$@"
}

mariadb_unit() {
  if systemctl list-unit-files 2>/dev/null | grep -qE '^mysql\.service[[:space:]]'; then
    printf 'mysql\n'
  else
    printf 'mariadb\n'
  fi
}

mariadb_installed() {
  systemctl list-unit-files 2>/dev/null | grep -qE '^(mariadb|mysql)\.service[[:space:]]'
}

mariadb_active() {
  systemctl is-active --quiet "$(mariadb_unit)"
}

db_server_available() {
  command -v mariadb >/dev/null 2>&1 && mariadb_active
}

db_query() {
  local db="$1"; shift
  db_root -N -B "${db}" "$@"
}

read_env_value() {
  local file="$1" key="$2" line
  [[ -f "${file}" ]] || return 1
  line=$(grep -E "^[[:space:]]*${key}=" "${file}" | tail -n 1) || return 1
  [[ -n "${line}" ]] || return 1
  line="${line#*=}"
  line="${line%"${line##*[![:space:]]}"}"
  line="${line#\"}"; line="${line%\"}"
  line="${line#\'}"; line="${line%\'}"
  printf '%s\n' "${line}"
}

ensure_trailing_newline() {
  local file="$1"
  [[ -s "${file}" ]] || return 0
  if [[ -n "$(tail -c 1 "${file}")" ]]; then
    printf '\n' >> "${file}"
  fi
}

set_env_value() {
  local file="$1" key="$2" value="$3" escaped
  escaped=$(printf '%s' "${value}" | sed -e 's/[&|\\]/\\&/g')
  if grep -qE "^[[:space:]]*${key}=" "${file}"; then
    sed -i -E "s|^[[:space:]]*${key}=.*|${key}=${escaped}|" "${file}"
  else
    ensure_trailing_newline "${file}"
    printf '%s=%s\n' "${key}" "${escaped}" >> "${file}"
  fi
}

env_append_missing_from_example() {
  local file="$1" example="$2" key value added=0
  [[ -f "${example}" ]] || return 0
  ensure_trailing_newline "${file}"
  while IFS= read -r line; do
    [[ "${line}" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    if ! grep -qE "^[[:space:]]*${key}=" "${file}"; then
      printf '%s=%s\n' "${key}" "${value}" >> "${file}"
      added=$((added + 1))
    fi
  done < "${example}"
  printf '%s\n' "${added}"
}

load_env_defaults() {
  local file="${1:-${ENV_FILE}}"
  if [[ -f "${file}" ]]; then
    [[ -z "${DB_NAME}" ]]     && DB_NAME="$(read_env_value "${file}" DB_NAME || true)"
    [[ -z "${DB_USER}" ]]     && DB_USER="$(read_env_value "${file}" DB_USER || true)"
    [[ -z "${DB_PASSWORD}" ]] && DB_PASSWORD="$(read_env_value "${file}" DB_PASSWORD || true)"
    local port
    port="$(read_env_value "${file}" PORT || true)"
    [[ -z "${port}" || "${port}" == "${TMS_PORT}" ]] || TMS_PORT="${port}"
  fi
  DB_NAME="${DB_NAME:-tms_lager}"
  DB_USER="${DB_USER:-tms}"
  DB_PASSWORD="${DB_PASSWORD:-${DB_DEV_PASSWORD}}"
}

sync_env_file() {
  local port="$1" db_name="$2" db_user="$3" db_password="$4" jwt_secret added
  mkdir -p "$(dirname "${ENV_FILE}")"
  if [[ -f "${ENV_FILE}" ]]; then
    cp -p "${ENV_FILE}" "${ENV_FILE}.bak"
  else
    [[ -f "${ENV_EXAMPLE}" ]] || fail "config/.env.example fehlt – keine Konfiguration möglich."
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
  fi
  ensure_trailing_newline "${ENV_FILE}"

  local secret
  secret="$(read_env_value "${ENV_FILE}" JWT_SECRET || true)"
  if [[ -z "${secret}" || "${secret}" == "please-change-me" || "${secret}" == "insecure-dev-secret" ]]; then
    set_env_value "${ENV_FILE}" JWT_SECRET "$(openssl rand -hex 32)"
    ok "JWT_SECRET erzeugt"
  fi
  set_env_value "${ENV_FILE}" DB_USER "${db_user}"
  set_env_value "${ENV_FILE}" DB_PASSWORD "${db_password}"
  set_env_value "${ENV_FILE}" DB_NAME "${db_name}"
  set_env_value "${ENV_FILE}" PORT "${port}"
  set_env_value "${ENV_FILE}" NODE_ENV "production"

  added="$(env_append_missing_from_example "${ENV_FILE}" "${ENV_EXAMPLE}")"
  if [[ "${added}" -gt 0 ]]; then
    ok "${added} fehlende Konfigurationsschlüssel aus .env.example ergänzt"
  fi
  chmod 640 "${ENV_FILE}" "${ENV_FILE}.bak"
  chown "${TMS_USER}:${TMS_USER}" "${ENV_FILE}" "${ENV_FILE}.bak" 2>/dev/null || true
  ok "backend/.env synchronisiert"
}

ensure_database() {
  local db_name="$1" db_user="$2" db_password="$3"
  db_root <<SQL || fail "Datenbank '${db_name}' konnte nicht angelegt werden."
CREATE DATABASE IF NOT EXISTS \`${db_name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${db_user}'@'localhost' IDENTIFIED BY '${db_password}';
ALTER USER '${db_user}'@'localhost' IDENTIFIED BY '${db_password}';
GRANT ALL PRIVILEGES ON \`${db_name}\`.* TO '${db_user}'@'localhost';
FLUSH PRIVILEGES;
SQL
  ok "Datenbank '${db_name}' und Benutzer '${db_user}'@'localhost' bereit"
}

ensure_migration_table() {
  db_root "$1" <<'SQL' || fail "Migrationstabelle konnte nicht angelegt werden."
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(128) NOT NULL PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL
}

migration_files() {
  find "${APP_DIR}/database/migrations" -maxdepth 1 -name '*.sql' 2>/dev/null | sort
}

migration_is_applied() {
  local db="$1" version="$2" count
  count=$(db_query "${db}" -e "SELECT COUNT(*) FROM schema_migrations WHERE version='${version}'" 2>/dev/null) || count=0
  printf '%s\n' "${count:-0}"
}

record_migration() {
  local db="$1" version="$2"
  db_root "${db}" -e "INSERT IGNORE INTO schema_migrations (version) VALUES ('${version}')" \
    || fail "Version '${version}' konnte nicht in schema_migrations vermerkt werden."
}

apply_migrations() {
  local db="$1" migration version applied count
  ensure_migration_table "${db}"

  count=$(db_query "${db}" -e "SELECT COUNT(*) FROM schema_migrations" 2>/dev/null) || count=0

  if [[ "${count:-0}" -eq 0 ]]; then
    log "Frische Datenbank – vollständiges Schema wird eingespielt."
    db_root "${db}" < "${APP_DIR}/database/schema.sql" \
      || fail "database/schema.sql konnte nicht eingespielt werden."
    while IFS= read -r migration; do
      [[ -n "${migration}" ]] || continue
      record_migration "${db}" "$(basename "${migration}")"
    done < <(migration_files)
    ok "Datenbankschema eingespielt (frische Installation)"
    return 0
  fi

  while IFS= read -r migration; do
    [[ -n "${migration}" ]] || continue
    version="$(basename "${migration}")"
    applied="$(migration_is_applied "${db}" "${version}")"
    if [[ "${applied}" -eq 0 ]]; then
      log "Migration ${version} wird ausgeführt …"
      db_root "${db}" < "${migration}" || fail "Migration ${version} fehlgeschlagen – Update abgebrochen. Backup: ${last_backup_file:-siehe backups/}"
      record_migration "${db}" "${version}"
      ok "Migration installiert: ${version}"
    fi
  done < <(migration_files)

  db_root "${db}" < "${APP_DIR}/database/schema.sql" \
    || fail "database/schema.sql konnte nicht angewendet werden – Update abgebrochen."
  ok "Datenbankschema aktualisiert"
}

last_backup_file=""

run_backup() {
  local label="${1:-manuell}" stamp sql_dump archive keep
  command -v mariadb-dump >/dev/null 2>&1 || fail "mariadb-dump fehlt – Backup nicht möglich."

  mkdir -p "${BACKUP_DIR}"
  chmod 700 "${BACKUP_DIR}"
  stamp="$(date +%Y%m%d_%H%M%S)"
  if [[ -e "${BACKUP_DIR}/tms-lager_${stamp}.sql" ]]; then
    stamp="${stamp}-${RANDOM}"
  fi
  sql_dump="${BACKUP_DIR}/tms-lager_${stamp}.sql"
  archive="${BACKUP_DIR}/tms-lager_${stamp}.tar.gz"

  umask 077
  mariadb-dump --single-transaction --routines "${DB_NAME}" > "${sql_dump}" \
    || fail "Datenbank-Dump fehlgeschlagen."
  [[ -s "${sql_dump}" ]] || fail "Datenbank-Dump ist leer – Abbruch."
  ok "Datenbank gesichert: ${sql_dump} ($(du -h "${sql_dump}" | cut -f1))"

  if [[ -f "${ENV_FILE}" ]]; then
    tar -czf "${archive}" -C "${APP_DIR}" backend/.env database/schema.sql
  else
    tar -czf "${archive}" -C "${APP_DIR}" database/schema.sql
  fi
  ok "Konfiguration gesichert: ${archive}"

  keep="${BACKUP_RETENTION_DAYS}"
  if [[ "${keep}" =~ ^[0-9]+$ ]] && [[ "${keep}" -gt 0 ]]; then
    find "${BACKUP_DIR}" -maxdepth 1 -type f \
      \( -name 'tms-lager_*.sql' -o -name 'tms-lager_*.tar.gz' \) \
      -mtime "+${keep}" -print -delete >/dev/null
    log "Aufbewahrung: ${keep} Tage (ältere Backups entfernt)"
  fi

  last_backup_file="${sql_dump}"
  log "Wiederherstellung: mariadb ${DB_NAME} < ${sql_dump}"
}

install_backup_timer() {
  local service_unit="/etc/systemd/system/${TMS_SERVICE}-backup.service"
  local timer_unit="/etc/systemd/system/${TMS_SERVICE}-backup.timer"

  cat > "${service_unit}" <<UNITEOF
[Unit]
Description=TMS Lager – automatisches Backup (${DB_NAME})
After=mariadb.service

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash ${APP_DIR}/scripts/backup.sh --quiet
UNITEOF

  cat > "${timer_unit}" <<UNITEOF
[Unit]
Description=TMS Lager – tägliches Backup

[Timer]
OnCalendar=*-*-* 02:30:00
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
UNITEOF

  systemctl daemon-reload
  systemctl enable --now "${TMS_SERVICE}-backup.timer" >/dev/null 2>&1 \
    || warn "Backup-Timer konnte nicht aktiviert werden – bitte manuell prüfen."
  ok "Tägliches Backup um 02:30 Uhr (Timer ${TMS_SERVICE}-backup.timer, Aufbewahrung ${BACKUP_RETENTION_DAYS} Tage)"
}

database_has_tables() {
  local db="$1" count
  count=$(db_query "${db}" \
    -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${db}'" 2>/dev/null) || count=0
  [[ "${count:-0}" -gt 0 ]]
}

backup_before_schema_change() {
  local db="$1" label="${2:-vor Schema-Änderung}"
  if database_has_tables "${db}"; then
    info "Sicherheits-Backup ${label}"
    run_backup "${label}"
  else
    log "Datenbank ist leer – kein Backup nötig."
  fi
}

write_service_unit() {
  local unit="/etc/systemd/system/${TMS_SERVICE}.service"
  cat > "${unit}" <<UNITEOF
[Unit]
Description=TMS Event-Technik Lager
After=network.target mariadb.service

[Service]
Type=simple
User=${TMS_USER}
WorkingDirectory=${BACKEND_DIR}
EnvironmentFile=${BACKEND_DIR}/.env
ExecStart=/usr/bin/node ${BACKEND_DIR}/dist/server.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNITEOF
  systemctl daemon-reload
}

build_project() {
  local dir="$1" name="$2"
  local stage="${dir}/.dist-stage"
  local old="${dir}/.dist-old"
  rm -rf "${stage}" "${old}"
  if ! npm --prefix "${dir}" run build -- --outDir "${stage}" >/dev/null; then
    rm -rf "${stage}"
    fail "Build von ${name} fehlgeschlagen – der bisherige Stand in ${dir}/dist bleibt unverändert."
  fi
  if [[ -e "${dir}/dist" ]] && ! mv "${dir}/dist" "${old}" 2>/dev/null; then
    rm -rf "${stage}"
    fail "${dir}/dist konnte nicht ersetzt werden (falsche Eigentümer?) – Build verworfen."
  fi
  if ! mv "${stage}" "${dir}/dist" 2>/dev/null; then
    mv "${old}" "${dir}/dist" 2>/dev/null || true
    fail "Neuer Build konnte nicht aktiviert werden – der bisherige Stand wurde wiederhergestellt."
  fi
  rm -rf "${old}" 2>/dev/null \
    || warn "Alter Build nicht restlos entfernbar (falsche Eigentümer?): ${old}"
  ok "${name} gebaut"
}

deploy_frontend() {
  rm -rf "${FRONTEND_DEPLOY_DIR}/frontend/dist"
  install -d -m 0755 "${FRONTEND_DEPLOY_DIR}/frontend"
  cp -r "${FRONTEND_DIR}/dist" "${FRONTEND_DEPLOY_DIR}/frontend/"
  chmod -R a+rX "${FRONTEND_DEPLOY_DIR}/frontend/dist"
  ok "Frontend nach ${FRONTEND_DEPLOY_DIR}/frontend/dist deployiert"
}

refresh_apache_config() {
  local changed=false f
  [[ -f "${APACHE_SNIPPET_SOURCE}" ]] \
    || fail "config/apache2-lagersystem.conf fehlt – Apache für /lagersystem kann nicht eingerichtet werden."
  if [[ ! -f "${APACHE_SNIPPET}" ]] || ! cmp -s "${APACHE_SNIPPET_SOURCE}" "${APACHE_SNIPPET}"; then
    cp "${APACHE_SNIPPET_SOURCE}" "${APACHE_SNIPPET}"
    changed=true
    ok "Apache-Snippet ${APACHE_SNIPPET} aktualisiert"
  fi

  local included=false
  for f in /etc/apache2/sites-enabled/*.conf; do
    [[ -e "${f}" ]] || continue
    if ! grep -q "lagersystem-snippet.conf" "${f}"; then
      printf 'Include %s\n' "${APACHE_SNIPPET}" >> "${f}"
      changed=true
    fi
    included=true
  done
  if [[ "${included}" == false ]]; then
    cat > /etc/apache2/sites-enabled/${TMS_SERVICE}.conf <<VEOF
<VirtualHost *:80>
    Include ${APACHE_SNIPPET}
</VirtualHost>
VEOF
    changed=true
  fi

  if [[ "${changed}" == true ]]; then
    if apache2ctl configtest >/dev/null 2>&1; then
      systemctl reload apache2 || systemctl restart apache2
      ok "Apache2 neu geladen – /lagersystem bereit"
    else
      warn "apache2ctl configtest schlug fehl – Apache-Konfiguration manuell prüfen."
    fi
  else
    log "Apache-Konfiguration unverändert"
  fi
}

wait_for_api() {
  local url="$1" attempts="${2:-20}" i response
  for ((i = 1; i <= attempts; i++)); do
    response="$(curl -fsS --max-time 5 "${url}" 2>/dev/null || true)"
    if [[ "${response}" == *'"ok":true'* ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

check_api() {
  local url="$1"
  if wait_for_api "${url}"; then
    ok "API erreichbar: ${url}"
  else
    journalctl -u "${TMS_SERVICE}" --no-pager -n 30 || true
    fail "API nicht erreichbar: ${url} – siehe journalctl -u ${TMS_SERVICE}"
  fi
}
