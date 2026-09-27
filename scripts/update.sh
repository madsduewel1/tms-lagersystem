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
      printf 'Verwendung: sudo ./scripts/update.sh [--no-backup]\n'
      printf '  --no-backup   vor dem Update kein Sicherheits-Backup anlegen\n'
      exit 0
      ;;
    --no-backup) SKIP_BACKUP=true ;;
    *) fail "Unbekannte Option: ${arg} (erlaubt: --no-backup, -h/--help)" ;;
  esac
done

require_root "update.sh"

load_env_defaults
info "TMS Lager – Update"
log "Versionen: ${APP_DIR}"

systemctl is-active --quiet "${TMS_SERVICE}" \
  || fail "Dienst '${TMS_SERVICE}' ist nicht aktiv – bitte zuerst sudo ./scripts/install.sh ausführen."

if ! db_server_available; then
  fail "MariaDB läuft nicht – Update abgebrochen."
fi
if [[ "${SKIP_BACKUP:-false}" != true ]]; then
  backup_before_schema_change "${DB_NAME}" "vor dem Update"
else
  warn "Sicherheits-Backup übersprungen (--no-backup)."
fi

info "Abhängigkeiten und Build aktualisieren"
npm --prefix "${BACKEND_DIR}" install >/dev/null 2>&1
npm --prefix "${FRONTEND_DIR}" install >/dev/null 2>&1
build_project "${BACKEND_DIR}" "Backend"
build_project "${FRONTEND_DIR}" "Frontend"

info "Konfiguration abgleichen"
if [[ -f "${ENV_FILE}" ]]; then
  sync_env_file "${TMS_PORT}" "${DB_NAME}" "${DB_USER}" "${DB_PASSWORD}"
else
  warn "backend/.env fehlt – bitte sudo ./scripts/install.sh ausführen."
fi

info "Datenbank aktualisieren"
apply_migrations "${DB_NAME}"

if [[ -d "${FRONTEND_DEPLOY_DIR}" ]]; then
  info "Frontend deployen"
  deploy_frontend
fi

if command -v apache2 >/dev/null 2>&1; then
  info "Apache-Konfiguration abgleichen"
  refresh_apache_config
fi

info "Automatische Backups prüfen"
if ! systemctl is-enabled --quiet "${TMS_SERVICE}-backup.timer" 2>/dev/null; then
  warn "Backup-Timer fehlt – wird jetzt eingerichtet."
  install_backup_timer
else
  ok "Backup-Timer aktiv (nächster Lauf: $(systemctl show -p NextElapseUSecRealtime --value "${TMS_SERVICE}-backup.timer" 2>/dev/null | sed 's/^ *//'))"
fi

info "Dienst neu starten"
write_service_unit
systemctl enable "${TMS_SERVICE}" >/dev/null 2>&1 || true
if ! systemctl restart "${TMS_SERVICE}"; then
  journalctl -u "${TMS_SERVICE}" --no-pager -n 30 || true
  fail "Dienst '${TMS_SERVICE}' konnte nicht neu gestartet werden."
fi
sleep 2
systemctl is-active --quiet "${TMS_SERVICE}" \
  || { journalctl -u "${TMS_SERVICE}" --no-pager -n 30 || true; fail "Dienst '${TMS_SERVICE}' läuft nicht mehr."; }
ok "Dienst '${TMS_SERVICE}' neu gestartet"
check_api "http://localhost:${TMS_PORT}/api/health"

ok "Update abgeschlossen"
LAST_BACKUP="$(ls -1t "${BACKUP_DIR}"/tms-lager_*.sql 2>/dev/null | head -n 1 || true)"
log "Letztes Backup: ${LAST_BACKUP:-keins}"
