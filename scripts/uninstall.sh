#!/usr/bin/env bash
set -euo pipefail

TMS_SERVICE="tms-lager"
TMS_USER="tms"
DB_NAME="${TMS_DB_NAME:-tms_lager}"
DB_USER="${TMS_DB_USER:-tms}"

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APACHE_SNIPPET="/etc/apache2/lagersystem-snippet.conf"
APACHE_DEPLOY="/opt/lagersystem"

ASSUME_YES=false
for arg in "$@"; do
  case "${arg}" in
    -y|--yes) ASSUME_YES=true ;;
    *) fail "Unbekannte Option: ${arg} (erlaubt: -y/--yes)" ;;
  esac
done

info()  { printf '\033[1;36m%s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m%s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
fail()  { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }
log()   { printf '    %s\n' "$*"; }

confirm() {
  local question="$1"
  if [[ "${ASSUME_YES}" == true ]]; then
    return 0
  fi
  local answer
  while true; do
    read -r -p "    ${question} (j/N) " answer
    case "${answer}" in
      j|J|y|Y|ja|yes) return 0 ;;
      n|N|no|"") return 1 ;;
      *) echo "      Bitte 'j' oder 'n' eingeben." ;;
    esac
  done
}

if [[ "${EUID}" -ne 0 ]]; then
  fail "uninstall.sh muss mit root-Rechten ausgeführt werden: sudo ./scripts/uninstall.sh"
fi

info "TMS Lager – Deinstallation"
log "Projektverzeichnis: ${APP_DIR}"
warn "Das Projektverzeichnis '${APP_DIR}' bleibt unangetastet (Code und Daten)."

warn "Führe vorher unbedingt ein Backup durch: sudo ./scripts/backup.sh"
echo ""

# 1) Systemdienst stoppen und entfernen
if [[ -f "/etc/systemd/system/${TMS_SERVICE}.service" ]]; then
  if systemctl is-active --quiet "${TMS_SERVICE}" || \
     systemctl is-enabled --quiet "${TMS_SERVICE}" >/dev/null 2>&1; then
    if confirm "Systemdienst '${TMS_SERVICE}' stoppen, deaktivieren und Unit-Datei entfernen?"; then
      systemctl stop "${TMS_SERVICE}" >/dev/null 2>&1 || true
      systemctl disable "${TMS_SERVICE}" >/dev/null 2>&1 || true
      rm -f "/etc/systemd/system/${TMS_SERVICE}.service"
      systemctl daemon-reload
      ok "Systemdienst entfernt"
    fi
  else
    rm -f "/etc/systemd/system/${TMS_SERVICE}.service"
    systemctl daemon-reload
    ok "Systemdienst-Unit entfernt"
  fi
else
  log "Kein Systemdienst ${TMS_SERVICE} vorhanden – übersprungen."
fi

# 2) Automatische Backups (Timer) entfernen
if [[ -f "/etc/systemd/system/${TMS_SERVICE}-backup.timer" || -f "/etc/systemd/system/${TMS_SERVICE}-backup.service" ]]; then
  if confirm "Automatische Backups (Timer) deaktivieren und Units entfernen?"; then
    systemctl disable --now "${TMS_SERVICE}-backup.timer" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/${TMS_SERVICE}-backup.timer" "/etc/systemd/system/${TMS_SERVICE}-backup.service"
    systemctl daemon-reload
    ok "Backup-Timer entfernt"
  fi
else
  log "Kein Backup-Timer vorhanden – übersprungen."
fi

# 3) Apache-Konfiguration für /lagersystem entfernen
if [[ -f "${APACHE_SNIPPET}" ]]; then
  if confirm "Apache-Konfiguration für /lagersystem entfernen?"; then
    rm -f "${APACHE_SNIPPET}"
    for f in /etc/apache2/sites-enabled/*.conf; do
      [[ -w "${f}" ]] && sed -i '/lagersystem-snippet\.conf/d' "${f}" || true
    done
    if command -v apache2ctl >/dev/null 2>&1; then
      if apache2ctl configtest >/dev/null 2>&1; then
        systemctl reload apache2 || true
        ok "Apache-Konfiguration entfernt und neu geladen"
      else
        warn "apachectl configtest schlug fehl – Apache-Konfiguration prüfen!"
      fi
    fi
  fi
else
  log "Keine Apache-Konfiguration für /lagersystem vorhanden – übersprungen."
fi

# 4) Deploy-Verzeichnis entfernen
if [[ -d "${APACHE_DEPLOY}" ]]; then
  if confirm "Deploy-Verzeichnis '${APACHE_DEPLOY}' löschen?"; then
    rm -rf "${APACHE_DEPLOY}"
    ok "Deploy-Verzeichnis entfernt"
  fi
else
  log "Kein Deploy-Verzeichnis ${APACHE_DEPLOY} vorhanden – übersprungen."
fi

# 5) Datenbank und Datenbankbenutzer entfernen
if command -v mariadb >/dev/null 2>&1; then
  if confirm "Datenbank '${DB_NAME}' und Benutzer '${DB_USER}'@'localhost' UNWIDERRUFLICH löschen?"; then
    mariadb --protocol=socket -uroot <<SQL || warn "Datenbank konnte nicht gelöscht werden."
DROP DATABASE IF EXISTS \`${DB_NAME}\`;
DROP USER IF EXISTS '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
    ok "Datenbank und Benutzer entfernt"
  fi
else
  log "Kein mariadb-Client installiert – Datenbank wird nicht angefasst."
fi

# 6) Systembenutzer entfernen
if id "${TMS_USER}" >/dev/null 2>&1; then
  if confirm "Systembenutzer '${TMS_USER}' und /var/lib/tms-lager entfernen?"; then
    userdel "${TMS_USER}" >/dev/null 2>&1 || true
    rm -rf /var/lib/tms-lager
    ok "Systembenutzer entfernt"
  fi
else
  log "Systembenutzer ${TMS_USER} nicht vorhanden – übersprungen."
fi

info "Deinstallation abgeschlossen"
log "Das Projektverzeichnis '${APP_DIR}' wurde nicht gelöscht (inkl. Code und .env)."
log "Entfernt wurden: Systemdienst, Backup-Timer, Apache-Konfiguration, Deploy-Verzeichnis,"
log "Datenbank/DB-Benutzer und Systembenutzer '${TMS_USER}'."
log ""
log "Nicht entfernt (werden ggf. von anderen Diensten genutzt):"
log "  - MariaDB-Server (Dienst 'mariadb')"
log "  - Node.js samt Nodesource-Repository"
log "  - Apache/httpd (Dienst 'apache2')"
log ""
log "Backups bleiben erhalten: ${APP_DIR}/backups"
log ""
log "Optional nachkontrollieren:"
log "  systemctl status ${TMS_SERVICE}   # sollte 'could not be found' melden"
log "  ss -ltn | grep :3000              # Port sollte frei sein"
log "  curl -sI http://localhost/lagersystem/   # sollte 404 liefern"