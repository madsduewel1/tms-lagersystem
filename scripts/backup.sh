#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${APP_DIR}/backend"
FRONTEND_DIR="${APP_DIR}/frontend"
DB_NAME="${TMS_DB_NAME:-}"

# shellcheck source=scripts/lib/common.sh
source "${APP_DIR}/scripts/lib/common.sh"

QUIET=false
for arg in "$@"; do
  case "${arg}" in
    -q|--quiet) QUIET=true ;;
    -h|--help)
      printf 'Verwendung: sudo ./scripts/backup.sh [--quiet]\n'
      printf '  --quiet   nur Warnungen und Fehler ausgeben (für den Backup-Timer)\n'
      exit 0
      ;;
    *) fail "Unbekannte Option: ${arg} (erlaubt: -q/--quiet, -h/--help)" ;;
  esac
done

require_root "backup.sh"

if [[ "${QUIET}" == true ]]; then
  info() { :; }
  log()  { :; }
fi

db_server_available || fail "MariaDB läuft nicht – Backup abgebrochen."

load_env_defaults
info "TMS Lager – Backup (${DB_NAME}) nach ${BACKUP_DIR}"

run_backup "manuell"
