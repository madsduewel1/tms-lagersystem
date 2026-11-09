from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_file, flash
from flask_cors import CORS
from markupsafe import Markup
from db_mysql import get_users_conn, get_lager_conn, drop_lager_db, lager_db_exists
import os
import random
import string
from datetime import datetime
import qrcode
import io
import base64
import shutil
import csv
from werkzeug.utils import secure_filename
from docx import Document
from docx.shared import Inches, Pt, Cm
from io import BytesIO
import json
import re
from docx.oxml import parse_xml
from docx.oxml.ns import qn
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ROW_HEIGHT_RULE
from docx.enum.text import WD_ALIGN_PARAGRAPH
import time
import zipfile
import base64
from pathlib import Path

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image as RLImage
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from PIL import Image as PILImage
import requests
from concurrent.futures import ThreadPoolExecutor
import threading

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)
app.secret_key = 'your-secret-key'

VERSION = "5.0"
LATEST_VERSION = None
UPDATE_AVAILABLE = False
SYSTEM_BACKUP_FORMAT = 'dms-full-system-backup'
SYSTEM_BACKUP_VERSION = 1
SYSTEM_BACKUP_MAX_BYTES = 512 * 1024 * 1024

# Environment
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass


def check_version():
    global LATEST_VERSION, UPDATE_AVAILABLE
    try:
        response = requests.get("https://raw.githubusercontent.com/Matti-Krebelder/DMS/refs/heads/main/version.txt", timeout=5)
        if response.status_code == 200:
            latest_version = response.text.strip()
            LATEST_VERSION = latest_version
            if latest_version != VERSION:
                UPDATE_AVAILABLE = True
                print(f"Version {VERSION} ist veraltet. Aktuelle Version: {latest_version}")
            else:
                UPDATE_AVAILABLE = False
                print(f"Version {VERSION} ist aktuell.")
        else:
            print("Fehler beim Abrufen der Version.")
    except Exception as e:
        print(f"Fehler beim Überprüfen der Version: {e}")

from werkzeug.security import generate_password_hash, check_password_hash

def init_user_db():
    conn = get_users_conn()
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (id VARCHAR(100) PRIMARY KEY, name VARCHAR(255) NOT NULL,
                  password VARCHAR(255), role VARCHAR(20) NOT NULL DEFAULT 'user')''')
    try:
        c.execute("ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'")
    except Exception:
        pass
    try:
        c.execute("ALTER TABLE users ADD COLUMN created_by VARCHAR(100)")
    except Exception:
        pass
    c.execute('''CREATE TABLE IF NOT EXISTS lager
                 (id VARCHAR(100) PRIMARY KEY, name VARCHAR(255) NOT NULL, created_by VARCHAR(100),
                   access_users TEXT, system_type VARCHAR(50) DEFAULT 'personal')''')
    c.execute('''CREATE TABLE IF NOT EXISTS user_groups
                 (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                  name VARCHAR(255) NOT NULL UNIQUE,
                  created_by VARCHAR(100))''')
    try:
        c.execute("ALTER TABLE user_groups ADD COLUMN created_by VARCHAR(100)")
    except Exception:
        pass
    c.execute('''CREATE TABLE IF NOT EXISTS user_group_members
                 (group_id INTEGER NOT NULL,
                  user_id VARCHAR(100) NOT NULL,
                  PRIMARY KEY (group_id, user_id))''')
    c.execute("INSERT IGNORE INTO users (id, name, password, role) VALUES (%s, %s, %s, %s)",
              ('TMS-T', 'TMS Technik', generate_password_hash('TMS-T'), 'admin'))
    c.execute("UPDATE users SET role = 'admin' WHERE id = 'TMS-T'")
    c.execute("UPDATE users SET password = %s WHERE id = 'TMS-T' AND (password IS NULL OR password = '')",
              (generate_password_hash('TMS-T'),))
    conn.commit()
    conn.close()
    init_events_db()


def init_events_db():
    conn = get_users_conn()
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS events
                 (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                  name VARCHAR(255) NOT NULL,
                  organizer VARCHAR(255),
                  description TEXT,
                  lager_id VARCHAR(100) NOT NULL,
                  start_at DATETIME NULL,
                  end_at DATETIME NULL,
                  created_by VARCHAR(100) NOT NULL,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS event_permissions
                 (event_id INTEGER NOT NULL,
                  user_id VARCHAR(100) NOT NULL,
                  role VARCHAR(20) NOT NULL DEFAULT 'viewer',
                  PRIMARY KEY (event_id, user_id))''')
    c.execute('''CREATE TABLE IF NOT EXISTS event_cases
                 (event_id INTEGER NOT NULL,
                  lager_id VARCHAR(100) NOT NULL,
                  case_id INTEGER NOT NULL,
                  PRIMARY KEY (event_id, lager_id, case_id))''')
    c.execute('''CREATE TABLE IF NOT EXISTS event_devices
                 (event_id INTEGER NOT NULL,
                  lager_id VARCHAR(100) NOT NULL,
                  device_id INTEGER NOT NULL,
                  case_id INTEGER NULL,
                  quantity INTEGER NOT NULL DEFAULT 1,
                  PRIMARY KEY (event_id, lager_id, device_id))''')
    c.execute('''CREATE TABLE IF NOT EXISTS event_lagers
                 (event_id INTEGER NOT NULL,
                  lager_id VARCHAR(100) NOT NULL,
                  PRIMARY KEY (event_id, lager_id))''')
    # Migrate older single-lager event assignment tables without discarding rows.
    for table in ('event_cases', 'event_devices'):
        c.execute(f"SHOW COLUMNS FROM {table} LIKE 'lager_id'")
        if not c.fetchone():
            c.execute(f"ALTER TABLE {table} ADD COLUMN lager_id VARCHAR(100) NULL")
            c.execute(f"UPDATE {table} item JOIN events e ON e.id = item.event_id SET item.lager_id = e.lager_id")
            c.execute(f"ALTER TABLE {table} DROP PRIMARY KEY, ADD PRIMARY KEY (event_id, lager_id, {'case_id' if table == 'event_cases' else 'device_id'})")
    c.execute("INSERT IGNORE INTO event_lagers (event_id, lager_id) SELECT id, lager_id FROM events")
    c.execute('''CREATE TABLE IF NOT EXISTS event_contacts
                 (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                  event_id INTEGER NOT NULL,
                  name VARCHAR(255) NOT NULL,
                  email VARCHAR(255))''')
    c.execute('''CREATE TABLE IF NOT EXISTS event_attachments
                 (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                  event_id INTEGER NOT NULL,
                  filename VARCHAR(255) NOT NULL,
                  mimetype VARCHAR(150),
                  data LONGBLOB NOT NULL,
                  uploaded_by VARCHAR(100),
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS app_settings
                 (setting_key VARCHAR(100) PRIMARY KEY,
                  setting_value TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS event_requests
                 (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                  event_name VARCHAR(255) NOT NULL,
                  organizer VARCHAR(255),
                  contact_name VARCHAR(255) NOT NULL,
                  email VARCHAR(255),
                  phone VARCHAR(100),
                  location VARCHAR(255),
                  start_at DATETIME NULL,
                  end_at DATETIME NULL,
                  description TEXT,
                  status VARCHAR(20) NOT NULL DEFAULT 'new',
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  ip_address VARCHAR(64))''')
    conn.commit()

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    c.execute("SELECT DISTINCT e.id FROM events e WHERE e.end_at IS NULL OR e.end_at >= ?", (now,))
    active_events = [row[0] for row in c.fetchall()]
    assignments = []
    for active_event_id in active_events:
        c.execute("SELECT lager_id, device_id FROM event_devices WHERE event_id = ?", (active_event_id,))
        devices_by_lager = {}
        for lager_id, device_id in c.fetchall():
            devices_by_lager.setdefault(lager_id, []).append(device_id)
        c.execute("SELECT lager_id, case_id FROM event_cases WHERE event_id = ?", (active_event_id,))
        cases_by_lager = {}
        for lager_id, case_id in c.fetchall():
            cases_by_lager.setdefault(lager_id, []).append(case_id)
        for lager_id in set(devices_by_lager) | set(cases_by_lager):
            assignments.append((lager_id, devices_by_lager.get(lager_id, []), cases_by_lager.get(lager_id, [])))
    conn.close()

    for lager_id, device_ids, case_ids in assignments:
        if lager_db_exists(lager_id):
            refresh_event_item_statuses(lager_id, device_ids, case_ids)


EVENT_ROLE_RANK = {'viewer': 1, 'editor': 2, 'host': 3}
EVENT_ROLE_LABELS = {'viewer': 'Teilnehmer', 'editor': 'Bearbeiter', 'host': 'Veranstalter'}

STATUS_LABELS = {
    'verfügbar': 'Verfügbar',
    'defekt': 'Defekt',
    'ausgeliehen': 'Ausgeliehen',
    'zugewiesen': 'Zugewiesen',
}
CASE_STATUS_VALUES = set(STATUS_LABELS)
CASE_TYPE_VALUES = ('Case', 'Koffer', 'Eurokiste', 'Rack', 'Sonstiges')
DEVICE_MANUAL_STATUSES = ('verfügbar', 'defekt')


def get_user_groups():
    conn = get_users_conn()
    c = conn.cursor()
    c.execute("""SELECT g.id, g.name, g.created_by, COALESCE(u.name, g.created_by)
                 FROM user_groups g
                 LEFT JOIN users u ON u.id = g.created_by
                 ORDER BY g.name""")
    groups = c.fetchall()
    c.execute("SELECT group_id, user_id FROM user_group_members")
    members = {}
    for group_id, user_id in c.fetchall():
        members.setdefault(group_id, []).append(user_id)
    conn.close()
    return [{'id': group_id, 'name': name, 'created_by': created_by,
             'created_by_name': created_by_name, 'member_ids': members.get(group_id, [])}
            for group_id, name, created_by, created_by_name in groups]


def get_admin_users():
    conn = get_users_conn()
    c = conn.cursor()
    c.execute("""SELECT u.id, u.name, u.role, u.password IS NOT NULL AND u.password != '' AS has_password,
                        COALESCE(c.name, u.created_by) AS created_by_name
                 FROM users u
                 LEFT JOIN users c ON c.id = u.created_by
                 ORDER BY u.name""")
    users = c.fetchall()
    conn.close()
    return users


def get_setting(key, default=None):
    conn = get_users_conn()
    c = conn.cursor()
    c.execute("SELECT setting_value FROM app_settings WHERE setting_key = ?", (key,))
    row = c.fetchone()
    conn.close()
    return row[0] if row else default


def set_setting(key, value):
    conn = get_users_conn()
    c = conn.cursor()
    c.execute("""INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)""", (key, value))
    conn.commit()
    conn.close()


def event_requests_enabled():
    return get_setting('event_requests_enabled', '0') == '1'


def active_event_assignment_exists(lager_id, item_id, kind):
    conn = get_users_conn()
    c = conn.cursor()
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    if kind == 'case':
        c.execute("""SELECT 1 FROM event_cases ec
                     JOIN events e ON e.id = ec.event_id
                     WHERE ec.lager_id = ? AND ec.case_id = ?
                       AND (e.end_at IS NULL OR e.end_at >= ?)
                     LIMIT 1""", (lager_id, item_id, now))
    else:
        c.execute("""SELECT 1 FROM event_devices ed
                     JOIN events e ON e.id = ed.event_id
                     WHERE ed.lager_id = ? AND ed.device_id = ?
                       AND (e.end_at IS NULL OR e.end_at >= ?)
                     LIMIT 1""", (lager_id, item_id, now))
    row = c.fetchone()
    conn.close()
    return row is not None


def event_assignment_conflicts(lager_id, item_id, kind, start_at, end_at, event_id=None):
    assignment_table, item_column = ('event_cases', 'case_id') if kind == 'case' else ('event_devices', 'device_id')
    conn = get_users_conn()
    c = conn.cursor()
    c.execute(f"""SELECT e.start_at, e.end_at
                  FROM {assignment_table} assignment
                  JOIN events e ON e.id = assignment.event_id
                  WHERE assignment.lager_id = ? AND assignment.{item_column} = ? AND e.id != ?""",
              (lager_id, item_id, event_id or -1))
    existing_intervals = c.fetchall()
    conn.close()

    def normalize(value):
        if value is None:
            return None
        return str(value).replace('T', ' ')[:19]

    start_at = normalize(start_at)
    end_at = normalize(end_at)
    for existing_start, existing_end in existing_intervals:
        existing_start = normalize(existing_start)
        existing_end = normalize(existing_end)
        starts_before_new_end = end_at is None or existing_start is None or existing_start < end_at
        ends_after_new_start = start_at is None or existing_end is None or existing_end > start_at
        if starts_before_new_end and ends_after_new_start:
            return True
    return False


def active_borrow_quantity(lager_id, device_id):
    """Return the quantity currently checked out for one tracked device row."""
    conn = get_db_connection(lager_id)
    c = conn.cursor()
    c.execute("""SELECT COALESCE(SUM(ad.quantity), 0)
                 FROM ausleih_details ad
                 JOIN ausleihen a ON a.ausleih_id = ad.ausleih_id
                 WHERE ad.geraet_id = ? AND a.status = 'ausgeliehen'""", (device_id,))
    quantity = c.fetchone()[0] or 0
    conn.close()
    return quantity


def refresh_case_status(lager_id, case_id, conn=None):
    should_close = False
    if conn is None:
        conn = get_db_connection(lager_id)
        should_close = True
    try:
        c = conn.cursor()
        c.execute("SELECT status FROM cases WHERE id = ?", (case_id,))
        row = c.fetchone()
        if not row:
            return
        current = row[0]
        if current == 'defekt':
            return
        if active_event_assignment_exists(lager_id, case_id, 'case'):
            new_status = 'zugewiesen'
        elif current == 'zugewiesen':
            new_status = 'verfügbar'
        else:
            new_status = current or 'verfügbar'
        c.execute("UPDATE cases SET status = ? WHERE id = ?", (new_status, case_id))
        if should_close:
            conn.commit()
    finally:
        if should_close and conn:
            conn.close()


def refresh_event_item_statuses(lager_id, device_ids, case_ids):
    device_ids = set(device_ids)
    case_ids = set(case_ids)
    if not device_ids and not case_ids:
        return
    conn = get_db_connection(lager_id)
    try:
        for device_id in device_ids:
            update_device_status(lager_id, device_id, conn)
        for case_id in case_ids:
            refresh_case_status(lager_id, case_id, conn)
        conn.commit()
    finally:
        conn.close()


def get_event_role(event_id, user_id):
    conn = get_users_conn()
    c = conn.cursor()
    c.execute("SELECT role FROM event_permissions WHERE event_id = ? AND user_id = ?", (event_id, user_id))
    row = c.fetchone()
    conn.close()
    return row[0] if row else None


def event_can_view(event_id, user_id):
    return EVENT_ROLE_RANK.get(get_event_role(event_id, user_id), 0) >= 1


def event_can_edit(event_id, user_id):
    return EVENT_ROLE_RANK.get(get_event_role(event_id, user_id), 0) >= 2


def event_is_host(event_id, user_id):
    return get_event_role(event_id, user_id) == 'host'


def get_accessible_lagers(user_id, admin=False):
    conn = get_users_conn()
    c = conn.cursor()
    if admin:
        c.execute("SELECT id, name FROM lager ORDER BY name")
    else:
        c.execute("SELECT id, name FROM lager WHERE created_by = ? OR FIND_IN_SET(?, access_users) > 0 ORDER BY name",
                  (user_id, user_id))
    rows = c.fetchall()
    conn.close()
    return rows


def user_has_lager_access(lager_id, user_id, admin=False):
    conn = get_users_conn()
    c = conn.cursor()
    if admin:
        c.execute("SELECT id FROM lager WHERE id = ?", (lager_id,))
    else:
        c.execute("SELECT id FROM lager WHERE id = ? AND (created_by = ? OR FIND_IN_SET(?, access_users) > 0)",
                  (lager_id, user_id, user_id))
    row = c.fetchone()
    conn.close()
    return row is not None


def get_lager_name(lager_id):
    conn = get_users_conn()
    c = conn.cursor()
    c.execute("SELECT name FROM lager WHERE id = ?", (lager_id,))
    row = c.fetchone()
    conn.close()
    return row[0] if row else lager_id


def load_event_lager_data(lager_id):
    create_warehouse_db(lager_id)
    conn = get_db_connection(lager_id)
    c = conn.cursor()
    c.execute("SELECT id, name, barcode, status FROM cases ORDER BY name")
    case_rows = c.fetchall()
    c.execute("""SELECT g.id, g.name, g.barcode, g.quantity, g.status, cd.case_id, c.name
                 FROM geraete g
                 LEFT JOIN case_devices cd ON cd.geraet_id = g.id
                 LEFT JOIN cases c ON c.id = cd.case_id
                 ORDER BY g.name""")
    device_rows = c.fetchall()
    conn.close()

    case_device_map = {row[0]: [] for row in case_rows}
    devices = []
    for row in device_rows:
        device = {
            'id': row[0],
            'name': row[1],
            'barcode': row[2],
            'quantity': row[3] or 1,
            'status': row[4] or 'verfügbar',
            'case_id': row[5],
            'case_name': row[6],
        }
        devices.append(device)
        if row[5] is not None and row[5] in case_device_map:
            case_device_map[row[5]].append(device['id'])

    device_status_by_id = {device['id']: device['status'] for device in devices}
    cases = [{'id': row[0], 'name': row[1], 'barcode': row[2],
              'status': row[3] or 'verfügbar',
              'device_ids': case_device_map.get(row[0], []),
              'has_defect': any(device_status_by_id.get(device_id) == 'defekt'
                                for device_id in case_device_map.get(row[0], []))}
             for row in case_rows]
    return cases, devices


def parse_event_datetime(value):
    value = (value or '').strip()
    if not value:
        return None
    value = value.replace('T', ' ')
    if len(value) == 16:
        value += ':00'
    if len(value) == 10:
        value += ' 00:00:00'
    return value


def datetime_for_input(value):
    if not value:
        return ''
    return str(value).replace(' ', 'T')[:16]


def get_user_events(user_id, limit=None):
    conn = get_users_conn()
    c = conn.cursor()
    query = """SELECT e.id, e.name, e.organizer, e.description, e.lager_id,
                      e.start_at, e.end_at, e.created_by, e.created_at,
                      COALESCE((SELECT GROUP_CONCAT(l2.name ORDER BY l2.name SEPARATOR ', ')
                                FROM event_lagers el2 JOIN lager l2 ON l2.id = el2.lager_id
                                WHERE el2.event_id = e.id), l.name), ep.role,
                      (SELECT COALESCE(SUM(ed.quantity), 0) FROM event_devices ed WHERE ed.event_id = e.id)
               FROM events e
               JOIN event_permissions ep ON ep.event_id = e.id AND ep.user_id = ?
               LEFT JOIN lager l ON l.id = e.lager_id
               ORDER BY (e.start_at IS NULL), e.start_at, e.id DESC"""
    params = [user_id]
    if limit:
        query += " LIMIT %s"
        params.append(int(limit))
    c.execute(query, tuple(params))
    rows = c.fetchall()
    conn.close()
    events = []
    for row in rows:
        events.append({
            'id': row[0], 'name': row[1], 'organizer': row[2], 'description': row[3],
            'lager_id': row[4], 'start_at': str(row[5]) if row[5] else None,
            'end_at': str(row[6]) if row[6] else None, 'created_by': row[7],
            'created_at': str(row[8]) if row[8] else None,
            'lager_name': row[9] or row[4], 'role': row[10],
            'device_quantity': row[11] or 0,
        })
    return events


def is_admin():
    return session.get('role') == 'admin'


def require_login():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return None


def require_admin():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    if not is_admin():
        return redirect(url_for('dashboard'))
    return None


def _backup_json_value(value):
    if isinstance(value, (bytes, bytearray)):
        return {'__dms_binary__': base64.b64encode(bytes(value)).decode('ascii')}
    if hasattr(value, 'isoformat'):
        return value.isoformat(sep=' ') if isinstance(value, datetime) else value.isoformat()
    return str(value) if value is not None and not isinstance(value, (str, int, float, bool)) else value


def _restore_json_value(value):
    if isinstance(value, dict) and set(value) == {'__dms_binary__'}:
        return base64.b64decode(value['__dms_binary__'], validate=True)
    return value


def _safe_sql_identifier(identifier):
    identifier = str(identifier)
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', identifier):
        raise ValueError('Ungültiger Tabellenname in der Sicherungsdatei.')
    return f'`{identifier}`'


def _snapshot_database(connection):
    cursor = connection.cursor()
    cursor.execute('SHOW TABLES')
    table_names = sorted(row[0] for row in cursor.fetchall())
    snapshot = {}
    for table_name in table_names:
        quoted = _safe_sql_identifier(table_name)
        cursor.execute(f'SHOW COLUMNS FROM {quoted}')
        columns = [row[0] for row in cursor.fetchall()]
        cursor.execute(f'SELECT * FROM {quoted}')
        rows = [[_backup_json_value(value) for value in row] for row in cursor.fetchall()]
        snapshot[table_name] = {'columns': columns, 'rows': rows}
    connection.close()
    return snapshot


def _build_system_backup():
    users_conn = get_users_conn()
    users_cursor = users_conn.cursor()
    users_cursor.execute('SELECT id FROM lager ORDER BY id')
    lager_ids = [row[0] for row in users_cursor.fetchall()]
    users_snapshot = _snapshot_database(users_conn)

    warehouses = {}
    for lager_id in lager_ids:
        warehouse_conn = get_db_connection(lager_id)
        warehouses[str(lager_id)] = _snapshot_database(warehouse_conn)

    payload = {
        'format': SYSTEM_BACKUP_FORMAT,
        'format_version': SYSTEM_BACKUP_VERSION,
        'app_version': VERSION,
        'created_at': datetime.now().isoformat(timespec='seconds'),
        'users_database': users_snapshot,
        'warehouses': warehouses,
    }
    archive = BytesIO()
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as zipped:
        zipped.writestr('backup.json', json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    archive.seek(0)
    return archive


def _validate_system_backup(payload):
    if not isinstance(payload, dict) or payload.get('format') != SYSTEM_BACKUP_FORMAT:
        raise ValueError('Die Datei ist kein vollständiger DMS-Systemexport.')
    if payload.get('format_version') != SYSTEM_BACKUP_VERSION:
        raise ValueError('Diese Version des Systemexports wird nicht unterstützt.')
    if not isinstance(payload.get('users_database'), dict) or not isinstance(payload.get('warehouses'), dict):
        raise ValueError('Die Sicherungsdatei enthält keine vollständigen Benutzer- und Lagerdaten.')
    if 'users' not in payload['users_database'] or 'lager' not in payload['users_database']:
        raise ValueError('Die Sicherungsdatei enthält keine Benutzer- oder Lagerliste.')
    for lager_id, tables in payload['warehouses'].items():
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', str(lager_id)) or not isinstance(tables, dict):
            raise ValueError('Die Sicherungsdatei enthält eine ungültige Lager-ID.')
    for database in [payload['users_database'], *payload['warehouses'].values()]:
        for table_name, table_data in database.items():
            _safe_sql_identifier(table_name)
            if (not isinstance(table_data, dict) or not isinstance(table_data.get('columns'), list)
                    or not isinstance(table_data.get('rows'), list)):
                raise ValueError('Die Sicherungsdatei enthält ungültige Tabellendaten.')
            if any(not isinstance(row, list) or len(row) != len(table_data['columns']) for row in table_data['rows']):
                raise ValueError(f'Die Sicherungsdatei enthält ungültige Zeilen in {table_name}.')


def _replace_database_contents(connection, snapshot):
    cursor = connection.cursor()
    cursor.execute('SHOW TABLES')
    target_tables = {row[0] for row in cursor.fetchall()}
    missing_tables = set(snapshot) - target_tables
    if missing_tables:
        raise ValueError('Zieldatenbank hat fehlende Tabellen: ' + ', '.join(sorted(missing_tables)))

    target_columns = {}
    auto_increment_tables = set()
    for table_name in target_tables:
        quoted = _safe_sql_identifier(table_name)
        cursor.execute(f'SHOW COLUMNS FROM {quoted}')
        details = cursor.fetchall()
        target_columns[table_name] = {row[0] for row in details}
        if any('auto_increment' in str(row[5]).lower() for row in details):
            auto_increment_tables.add(table_name)

    for table_name, table_data in snapshot.items():
        if not set(table_data['columns']).issubset(target_columns[table_name]):
            raise ValueError(f'Die Zieldatenbank hat eine inkompatible Tabellenstruktur bei {table_name}.')

    try:
        # MariaDB schemas used by the application have no foreign-key constraints.
        # Clear all target tables so target-only tables cannot retain stale data.
        for table_name in sorted(target_tables):
            cursor.execute(f'DELETE FROM {_safe_sql_identifier(table_name)}')
        for table_name in sorted(auto_increment_tables):
            cursor.execute(f'ALTER TABLE {_safe_sql_identifier(table_name)} AUTO_INCREMENT = 1')

        for table_name, table_data in snapshot.items():
            if not table_data['rows']:
                continue
            columns = table_data['columns']
            quoted_columns = ', '.join(_safe_sql_identifier(column) for column in columns)
            placeholders = ', '.join('?' for _ in columns)
            sql = f'INSERT INTO {_safe_sql_identifier(table_name)} ({quoted_columns}) VALUES ({placeholders})'
            for row in table_data['rows']:
                cursor.execute(sql, tuple(_restore_json_value(value) for value in row))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

def create_warehouse_db(lager_id):
    conn = get_lager_conn(lager_id)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS geraete
                 (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                   name TEXT NOT NULL,
                   barcode VARCHAR(255) UNIQUE NOT NULL,
                   lagerplatz TEXT NOT NULL,
                   status TEXT DEFAULT 'verfügbar',
                   beschreibung TEXT,
                   seriennummer TEXT,
                   modell TEXT,
                   instrumentenart TEXT,
                   inventarnummer TEXT,
                   kaufdatum TEXT,
                   preis REAL,
                   quantity INTEGER DEFAULT 1,
                   hersteller TEXT,
                   lagerort TEXT,
                   mietpreis REAL,
                   dmx_universum INTEGER,
                   dmx_startadresse INTEGER,
                   dmx_kanaele INTEGER,
                   dmx_belegung LONGTEXT,
                   bild_mimetype VARCHAR(100),
                   bild_daten LONGBLOB)''')
    for definition in (
        'lagerort TEXT', 'mietpreis REAL', 'dmx_universum INTEGER',
        'dmx_startadresse INTEGER', 'dmx_kanaele INTEGER', 'dmx_belegung LONGTEXT',
        'bild_mimetype VARCHAR(100)', 'bild_daten LONGBLOB',
    ):
        try:
            c.execute(f"ALTER TABLE geraete ADD COLUMN {definition}")
        except Exception as exc:
            if 'duplicate column' not in str(exc).lower():
                conn.close()
                raise
    c.execute('''CREATE TABLE IF NOT EXISTS ausleihen
                 (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                   ausleih_id VARCHAR(255) NOT NULL,
                   mitarbeiter_id VARCHAR(255) NOT NULL,
                   mitarbeiter_name TEXT NOT NULL,
                   zielort TEXT NOT NULL,
                   datum TEXT NOT NULL,
                   rueckgabe_qr TEXT NOT NULL,
                   status TEXT DEFAULT 'ausgeliehen',
                   email TEXT,
                   klasse TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS ausleih_details
                 (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                   ausleih_id VARCHAR(255) NOT NULL,
                   geraet_id INTEGER NOT NULL,
                   geraet_barcode VARCHAR(255) NOT NULL,
                   quantity INTEGER DEFAULT 1,
                   INDEX idx_ausleih_id (ausleih_id),
                   INDEX idx_geraet_id (geraet_id))''')
    c.execute('''CREATE TABLE IF NOT EXISTS label_layouts
                 (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                   name TEXT NOT NULL,
                   layout_data LONGTEXT NOT NULL,
                   is_default INTEGER DEFAULT 0,
                   created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                   updated_at TEXT DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS cases
                 (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                   name VARCHAR(255) NOT NULL,
                   barcode VARCHAR(255) UNIQUE,
                   status TEXT DEFAULT 'verfügbar',
                   beschreibung TEXT,
                   lagerplatz TEXT,
                   lagerort TEXT,
                   gewicht REAL,
                   created_at TEXT DEFAULT CURRENT_TIMESTAMP)''')
    try:
        c.execute("ALTER TABLE cases ADD COLUMN lagerort TEXT")
    except Exception as exc:
        if 'duplicate column' not in str(exc).lower():
            conn.close()
            raise
    try:
        c.execute("ALTER TABLE cases ADD COLUMN status TEXT DEFAULT 'verfügbar'")
    except Exception as exc:
        if 'duplicate column' not in str(exc).lower():
            conn.close()
            raise
    try:
        c.execute("ALTER TABLE cases ADD COLUMN case_type VARCHAR(50) DEFAULT 'Case'")
    except Exception as exc:
        if 'duplicate column' not in str(exc).lower():
            conn.close()
            raise
    try:
        c.execute("ALTER TABLE cases ADD COLUMN gewicht REAL")
    except Exception as exc:
        if 'duplicate column' not in str(exc).lower():
            conn.close()
            raise
    c.execute("UPDATE cases SET case_type = 'Case' WHERE case_type IS NULL OR case_type = ''")
    c.execute("""UPDATE geraete g
                 SET status = CASE
                     WHEN EXISTS (
                         SELECT 1 FROM ausleih_details ad
                         JOIN ausleihen a ON ad.ausleih_id = a.ausleih_id
                         WHERE ad.geraet_id = g.id AND a.status = 'ausgeliehen'
                     ) THEN 'ausgeliehen'
                     ELSE 'verfügbar'
                 END
                 WHERE g.status IS NULL
                    OR g.status NOT IN ('verfügbar', 'defekt', 'ausgeliehen', 'zugewiesen')""")
    c.execute('''CREATE TABLE IF NOT EXISTS case_devices
                 (case_id INTEGER NOT NULL,
                   geraet_id INTEGER NOT NULL,
                   PRIMARY KEY (case_id, geraet_id),
                   UNIQUE KEY uq_case_device (geraet_id),
                   INDEX idx_case_id (case_id))''')
    conn.commit()
    conn.close()

import shutil
from datetime import datetime

def migrate_warehouse_db(lager_id):
    create_warehouse_db(lager_id)

def generate_random_id(length=6):
    return ''.join(random.choices(string.digits, k=length))

def get_db_connection(lager_id):
    return get_lager_conn(lager_id)

def generate_qr_code(data):
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    img_str = base64.b64encode(buffer.getvalue()).decode()
    return f"data:image/png;base64,{img_str}"

def get_lager_system_type(lager_id):
    conn = get_users_conn()
    c = conn.cursor()
    c.execute("SELECT system_type FROM lager WHERE id = ?", (lager_id,))
    result = c.fetchone()
    conn.close()
    return result[0] if result else 'personal'


def backup_db(lager_id, operation):
    # MySQL/MariaDB data is managed by the database server; no file copy needed.
    return None


def _read_uploaded_device_image(upload):
    if not upload or not upload.filename:
        return None, None
    raw = upload.stream.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError('Das Bild darf höchstens 8 MB groß sein.')
    try:
        with PILImage.open(BytesIO(raw)) as source:
            if source.format not in ('JPEG', 'PNG', 'WEBP'):
                raise ValueError('Erlaubte Bildformate sind JPG, PNG und WebP.')
            source.verify()
        with PILImage.open(BytesIO(raw)) as source:
            source = source.convert('RGB')
            source.thumbnail((1400, 1400))
            output = BytesIO()
            source.save(output, format='JPEG', quality=86, optimize=True)
            return 'image/jpeg', output.getvalue()
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError('Die Bilddatei konnte nicht gelesen werden.') from exc


def _parse_dmx_channel_map(form):
    channels = form.getlist('dmx_channel')
    functions = form.getlist('dmx_function')
    mapping = []
    seen = set()
    for raw_channel, raw_function in zip(channels, functions):
        raw_channel = (raw_channel or '').strip()
        raw_function = (raw_function or '').strip()
        if not raw_channel and not raw_function:
            continue
        try:
            channel = int(raw_channel)
        except (TypeError, ValueError):
            raise ValueError('Jede DMX-Funktion benötigt eine gültige Kanalnummer von 1 bis 512.')
        if not 1 <= channel <= 512:
            raise ValueError('DMX-Kanalnummern müssen zwischen 1 und 512 liegen.')
        if channel in seen:
            raise ValueError(f'DMX-Kanal {channel} ist mehrfach eingetragen.')
        if not raw_function:
            raise ValueError(f'Für DMX-Kanal {channel} fehlt die Funktion.')
        if len(raw_function) > 100:
            raise ValueError('Eine DMX-Funktionsbeschreibung darf höchstens 100 Zeichen lang sein.')
        seen.add(channel)
        mapping.append({'channel': channel, 'function': raw_function})
    return json.dumps(sorted(mapping, key=lambda item: item['channel']), ensure_ascii=False) if mapping else None


def _decode_dmx_channel_map(raw_value):
    if not raw_value:
        return []
    try:
        mapping = json.loads(raw_value)
        if isinstance(mapping, list):
            cleaned = []
            for entry in mapping:
                if not isinstance(entry, dict) or not isinstance(entry.get('function'), str):
                    continue
                try:
                    channel = int(entry.get('channel'))
                except (TypeError, ValueError):
                    continue
                if 1 <= channel <= 512:
                    cleaned.append({'channel': channel, 'function': entry['function'][:100]})
            return sorted(cleaned, key=lambda item: item['channel'])
    except (TypeError, ValueError):
        pass
    return []

@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user_id = (request.form.get('user_id') or '').strip()
        password = request.form.get('password') or ''
        conn = get_users_conn()
        c = conn.cursor()
        c.execute("SELECT name, password, role FROM users WHERE id = %s", (user_id,))
        user = c.fetchone()
        conn.close()
        if user:
            stored = user[1]
            if stored:
                try:
                    valid = check_password_hash(stored, password)
                except Exception:
                    valid = False
            else:
                valid = True
            if valid:
                session.clear()
                session['user_id'] = user_id
                session['user_name'] = user[0]
                session['role'] = user[2] or 'user'
                return redirect(url_for('dashboard'))
        return redirect(url_for('login'))
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    return render_template('login.html', title="Login")


@app.route('/login', methods=['GET', 'POST'])
def do_login():
    return login()

@app.route('/dashboard', methods=['GET', 'POST'])
def dashboard():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    conn = get_users_conn()
    c = conn.cursor()
    c.execute("SELECT id, name FROM lager WHERE created_by = ? OR FIND_IN_SET(?, access_users) > 0 ORDER BY name",
              (session['user_id'], session['user_id']))
    lagers = c.fetchall()
    c.execute("""SELECT id, event_name, organizer, contact_name, email, phone, location,
                        start_at, end_at, description, created_at
                 FROM event_requests
                 WHERE status = 'new'
                 ORDER BY created_at DESC
                 LIMIT 10""")
    event_requests = c.fetchall()
    conn.close()
    events = get_user_events(session['user_id'], limit=6)
    return render_template('dashboard.html', title="Dashboard", lagers=lagers, events=events,
                           event_requests=event_requests,
                           is_admin=is_admin(), update_available=UPDATE_AVAILABLE,
                           latest_version=LATEST_VERSION, current_version=VERSION)


@app.route('/create_lager', methods=['GET', 'POST'])
def create_lager():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    if not is_admin():
        return redirect(url_for('dashboard'))
    if request.method == 'POST':
        name = request.form['name'].strip()
        access_users = request.form.getlist('access_users')
        if session['user_id'] not in access_users:
            access_users.append(session['user_id'])
        system_type = request.form.get('system_type', 'personal')
        lager_id = generate_random_id(8)
        conn = get_users_conn()
        c = conn.cursor()
        while True:
            c.execute("SELECT id FROM lager WHERE id = ?", (lager_id,))
            if not c.fetchone():
                break
            lager_id = generate_random_id(8)
        c.execute("INSERT INTO lager (id, name, created_by, access_users, system_type) VALUES (?, ?, ?, ?, ?)",
                  (lager_id, name, session['user_id'], ','.join(access_users), system_type))
        conn.commit()
        conn.close()
        create_warehouse_db(lager_id)
        return redirect(url_for('warehouse', lager_id=lager_id))
    conn = get_users_conn()
    c = conn.cursor()
    c.execute("SELECT id, name FROM users ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, name",
              (session['user_id'],))
    users = c.fetchall()
    conn.close()
    return render_template('create_lager.html', title="Neues Lager", users=users)


@app.route('/lager/<lager_id>')
def warehouse(lager_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))

    conn = get_users_conn()
    c = conn.cursor()
    if is_admin():
        c.execute("SELECT id FROM lager WHERE id = ?", (lager_id,))
    else:
        c.execute("SELECT id FROM lager WHERE id = ? AND (created_by = ? OR FIND_IN_SET(?, access_users) > 0)",
                  (lager_id, session['user_id'], session['user_id']))
    has_access = c.fetchone()
    conn.close()

    if not has_access:
        return redirect(url_for('dashboard'))

    create_warehouse_db(lager_id)
    session['current_lager'] = lager_id
    return render_template('warehouse.html', title="Lager", lager_id=lager_id)


@app.route('/cases')
def cases():
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))

    create_warehouse_db(session['current_lager'])
    search = (request.args.get('search') or '').strip()
    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    query = """SELECT c.id, c.name, c.barcode, c.beschreibung, c.lagerplatz, c.lagerort,
                      COUNT(cd.geraet_id), COALESCE(SUM(g.quantity), 0), c.status, c.case_type, c.gewicht
               FROM cases c
               LEFT JOIN case_devices cd ON cd.case_id = c.id
               LEFT JOIN geraete g ON g.id = cd.geraet_id
               WHERE 1=1"""
    params = []
    if search:
        query += " AND (c.name LIKE ? OR c.barcode LIKE ? OR c.case_type LIKE ? OR c.beschreibung LIKE ?)"
        params.extend([f'%{search}%'] * 4)
    query += """ GROUP BY c.id, c.name, c.barcode, c.beschreibung, c.lagerplatz, c.lagerort,
                         c.status, c.case_type, c.gewicht
                 ORDER BY c.name"""
    c.execute(query, params)
    case_list = c.fetchall()
    c.execute("SELECT COALESCE(SUM(quantity), 0) FROM geraete")
    total_devices = c.fetchone()[0]
    c.execute("""SELECT COALESCE(SUM(g.quantity), 0)
                 FROM case_devices cd
                 JOIN geraete g ON g.id = cd.geraet_id""")
    assigned_devices = c.fetchone()[0]
    conn.close()

    return render_template('cases.html', title="Cases", cases=case_list,
                           total_devices=total_devices, assigned_devices=assigned_devices,
                           search=search, case_types=CASE_TYPE_VALUES)


@app.route('/cases/create', methods=['POST'])
def create_case():
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))

    name = (request.form.get('name') or '').strip()
    beschreibung = (request.form.get('beschreibung') or '').strip()
    lagerplatz = (request.form.get('lagerplatz') or '').strip()
    lagerort = (request.form.get('lagerort') or '').strip()
    gewicht_raw = (request.form.get('gewicht') or '').strip().replace(',', '.')
    try:
        gewicht = float(gewicht_raw) if gewicht_raw else None
    except ValueError:
        gewicht = None
    status = request.form.get('status')
    if status not in CASE_STATUS_VALUES:
        status = 'verfügbar'
    case_type = request.form.get('case_type') or 'Case'
    if case_type not in CASE_TYPE_VALUES:
        case_type = 'Case'
    if not name:
        flash('Ein Name für den Case ist erforderlich.')
        return redirect(url_for('cases'))

    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    barcode = (request.form.get('barcode') or '').strip()
    if not barcode:
        while True:
            barcode = generate_random_id(6)
            c.execute("SELECT id FROM cases WHERE barcode = ?", (barcode,))
            if not c.fetchone():
                break
    c.execute("INSERT INTO cases (name, barcode, beschreibung, lagerplatz, lagerort, status, case_type, gewicht) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              (name, barcode, beschreibung, lagerplatz, lagerort, status, case_type, gewicht))
    conn.commit()
    conn.close()
    flash(f'Case „{name}" wurde angelegt.')
    return redirect(url_for('cases'))


@app.route('/cases/<int:case_id>')
def case_detail(case_id):
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))

    create_warehouse_db(session['current_lager'])
    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    c.execute("SELECT id, name, barcode, beschreibung, lagerplatz, lagerort, status, case_type, gewicht FROM cases WHERE id = ?", (case_id,))
    case = c.fetchone()
    if not case:
        conn.close()
        return redirect(url_for('cases'))

    c.execute("""SELECT g.id, g.name, g.barcode, g.lagerplatz, g.status,
                        cd.case_id, other.name, g.quantity
                 FROM geraete g
                 LEFT JOIN case_devices cd ON cd.geraet_id = g.id
                 LEFT JOIN cases other ON other.id = cd.case_id
                 ORDER BY CASE
                     WHEN cd.case_id IS NULL THEN 0
                     WHEN cd.case_id = ? THEN 1
                     ELSE 2
                 END, g.name""", (case_id,))
    devices = c.fetchall()
    conn.close()

    return render_template('case_detail.html', title=case[1], case=case, devices=devices,
                           case_types=CASE_TYPE_VALUES)


@app.route('/cases/<int:case_id>/assign', methods=['POST'])
def assign_case_devices(case_id):
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))

    selected = set()
    for value in request.form.getlist('device_ids'):
        try:
            selected.add(int(value))
        except (TypeError, ValueError):
            continue

    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    c.execute("SELECT id, name FROM cases WHERE id = ?", (case_id,))
    case = c.fetchone()
    if not case:
        conn.close()
        return redirect(url_for('cases'))

    c.execute("SELECT geraet_id FROM case_devices WHERE case_id = ?", (case_id,))
    current = {row[0] for row in c.fetchall()}

    for geraet_id in current - selected:
        c.execute("DELETE FROM case_devices WHERE case_id = ? AND geraet_id = ?", (case_id, geraet_id))

    for geraet_id in selected - current:
        c.execute("SELECT case_id FROM case_devices WHERE geraet_id = ?", (geraet_id,))
        if c.fetchone():
            continue
        c.execute("INSERT INTO case_devices (case_id, geraet_id) VALUES (?, ?)", (case_id, geraet_id))

    conn.commit()
    conn.close()
    flash(f'Zuweisung für Case „{case[1]}" gespeichert.')
    return redirect(url_for('case_detail', case_id=case_id))


@app.route('/cases/<int:case_id>/edit', methods=['POST'])
def edit_case(case_id):
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))

    name = (request.form.get('name') or '').strip()
    beschreibung = (request.form.get('beschreibung') or '').strip()
    lagerplatz = (request.form.get('lagerplatz') or '').strip()
    lagerort = (request.form.get('lagerort') or '').strip()
    gewicht_raw = (request.form.get('gewicht') or '').strip().replace(',', '.')
    try:
        gewicht = float(gewicht_raw) if gewicht_raw else None
    except ValueError:
        gewicht = None
    status = request.form.get('status')
    case_type = request.form.get('case_type')
    if name:
        conn = get_db_connection(session['current_lager'])
        c = conn.cursor()
        if status not in CASE_STATUS_VALUES or case_type not in CASE_TYPE_VALUES:
            c.execute("SELECT status, case_type FROM cases WHERE id = ?", (case_id,))
            row = c.fetchone()
            if status not in CASE_STATUS_VALUES:
                status = row[0] if row and row[0] else 'verfügbar'
            if case_type not in CASE_TYPE_VALUES:
                case_type = row[1] if row and row[1] else 'Case'
        if status not in CASE_STATUS_VALUES:
            status = 'verfügbar'
        if case_type not in CASE_TYPE_VALUES:
            case_type = 'Case'
        c.execute("UPDATE cases SET name = ?, beschreibung = ?, lagerplatz = ?, lagerort = ?, status = ?, case_type = ?, gewicht = ? WHERE id = ?",
                  (name, beschreibung, lagerplatz, lagerort, status, case_type, gewicht, case_id))
        conn.commit()
        conn.close()
    return redirect(url_for('case_detail', case_id=case_id))


@app.route('/cases/<int:case_id>/delete', methods=['POST'])
def delete_case(case_id):
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))

    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    c.execute("DELETE FROM case_devices WHERE case_id = ?", (case_id,))
    c.execute("DELETE FROM cases WHERE id = ?", (case_id,))
    conn.commit()
    conn.close()
    flash('Case wurde gelöscht.')
    return redirect(url_for('cases'))


@app.route('/events')
def events():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    event_list = get_user_events(session['user_id'])
    return render_template('events.html', title="Events", events=event_list)


@app.route('/event-requests/<int:request_id>/done', methods=['POST'])
def event_request_done(request_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))
    conn = get_users_conn()
    c = conn.cursor()
    c.execute("UPDATE event_requests SET status = 'done' WHERE id = ?", (request_id,))
    conn.commit()
    conn.close()
    flash('Event-Anfrage wurde als erledigt markiert.')
    return redirect(url_for('dashboard'))


@app.route('/events/request', methods=['GET', 'POST'])
def event_request():
    if not event_requests_enabled():
        return render_template('event_request_disabled.html', title="Event-Anfrage")

    if request.method == 'POST':
        if (request.form.get('website') or '').strip():
            return redirect(url_for('event_request', submitted=1))

        event_name = (request.form.get('event_name') or '').strip()
        organizer = (request.form.get('organizer') or '').strip()
        contact_name = (request.form.get('contact_name') or '').strip()
        email = (request.form.get('email') or '').strip()
        phone = (request.form.get('phone') or '').strip()
        location = (request.form.get('location') or '').strip()
        description = (request.form.get('description') or '').strip()
        start_at = parse_event_datetime(request.form.get('start_at'))
        end_at = parse_event_datetime(request.form.get('end_at'))

        errors = []
        if not event_name:
            errors.append('Ein Veranstaltungsname ist erforderlich.')
        if not contact_name:
            errors.append('Ein Kontaktname ist erforderlich.')
        if not email or not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
            errors.append('Eine gültige E-Mail-Adresse ist erforderlich.')
        if not start_at:
            errors.append('Ein Beginn ist erforderlich.')
        if start_at and end_at and end_at < start_at:
            errors.append('Das Ende muss nach dem Beginn liegen.')

        if errors:
            for message in errors:
                flash(message, 'error')
            return render_template('event_request.html', title="Event-Anfrage", form=request.form)

        conn = get_users_conn()
        c = conn.cursor()
        c.execute("""INSERT INTO event_requests
                     (event_name, organizer, contact_name, email, phone, location,
                      start_at, end_at, description, ip_address)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                  (event_name, organizer, contact_name, email, phone, location,
                   start_at, end_at, description, request.remote_addr))
        conn.commit()
        conn.close()
        return redirect(url_for('event_request', submitted=1))

    if request.args.get('submitted') == '1':
        return render_template('event_request_success.html', title="Event-Anfrage gesendet")
    return render_template('event_request.html', title="Event-Anfrage", form={})


@app.route('/events/create', methods=['GET', 'POST'])
def event_create():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    request_id = request.form.get('request_id', type=int) or request.args.get('request_id', type=int)
    event_request = None
    if request_id:
        conn = get_users_conn()
        c = conn.cursor()
        c.execute("""SELECT id, event_name, organizer, contact_name, email, phone, location,
                            start_at, end_at, description
                     FROM event_requests WHERE id = ? AND status = 'new'""", (request_id,))
        row = c.fetchone()
        conn.close()
        if row:
            event_request = {
                'id': row[0], 'event_name': row[1], 'organizer': row[2],
                'contact_name': row[3], 'email': row[4], 'phone': row[5],
                'location': row[6], 'start_at': row[7], 'end_at': row[8],
                'description': row[9],
            }

    lagers = get_accessible_lagers(session['user_id'], is_admin())
    if request.method == 'POST':
        return save_event(None, lagers, request_id=request_id if event_request else None)

    if event_request:
        description_parts = [event_request['description'] or '']
        if event_request['location']:
            description_parts.append(f"Ort: {event_request['location']}")
        if event_request['phone']:
            description_parts.append(f"Telefon: {event_request['phone']}")
        event = {
            'id': None,
            'name': event_request['event_name'],
            'organizer': event_request['organizer'],
            'description': '\n'.join(part for part in description_parts if part),
            'lager_id': None,
            'start_at': str(event_request['start_at']) if event_request['start_at'] else None,
            'end_at': str(event_request['end_at']) if event_request['end_at'] else None,
            'created_by': None,
            'created_at': None,
        }
        contacts = [{'name': event_request['contact_name'], 'email': event_request['email']}]
        return render_template('event_form.html', title="Event aus Anfrage erstellen", mode='create',
                               event=event, request_id=event_request['id'],
                               lagers=lagers, selected_lager_ids=[], selected_case_ids=[],
                               selected_devices={}, contacts=contacts)

    return render_template('event_form.html', title="Neues Event", mode='create', event=None,
                           request_id=None, lagers=lagers, selected_lager_ids=[],
                           selected_case_ids=[], selected_devices={}, contacts=[])


@app.route('/events/<int:event_id>/edit', methods=['GET', 'POST'])
def event_edit(event_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))
    if not event_can_edit(event_id, session['user_id']):
        flash('Du hast keine Berechtigung, dieses Event zu bearbeiten.')
        return redirect(url_for('events'))

    conn = get_users_conn()
    c = conn.cursor()
    c.execute("""SELECT id, name, organizer, description, lager_id, start_at, end_at, created_by, created_at
                 FROM events WHERE id = ?""", (event_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        return redirect(url_for('events'))

    event = {
        'id': row[0], 'name': row[1], 'organizer': row[2], 'description': row[3],
        'lager_id': row[4], 'start_at': str(row[5]) if row[5] else None,
        'end_at': str(row[6]) if row[6] else None,
        'created_by': row[7], 'created_at': str(row[8]) if row[8] else None,
    }
    c.execute("SELECT lager_id FROM event_lagers WHERE event_id = ?", (event_id,))
    selected_lager_ids = [r[0] for r in c.fetchall()] or [event['lager_id']]
    c.execute("SELECT lager_id, case_id FROM event_cases WHERE event_id = ?", (event_id,))
    selected_case_ids = [f"{r[0]}:{r[1]}" for r in c.fetchall()]
    c.execute("SELECT lager_id, device_id, quantity FROM event_devices WHERE event_id = ?", (event_id,))
    selected_devices = {f"{r[0]}:{r[1]}": r[2] for r in c.fetchall()}
    c.execute("SELECT name, email FROM event_contacts WHERE event_id = ? ORDER BY id", (event_id,))
    contacts = [{'name': r[0], 'email': r[1]} for r in c.fetchall()]
    conn.close()

    lagers = get_accessible_lagers(session['user_id'], is_admin())
    if request.method == 'POST':
        return save_event(event_id, lagers)

    return render_template('event_form.html', title="Event bearbeiten", mode='edit', event=event,
                           lagers=lagers, selected_lager_ids=selected_lager_ids,
                           selected_case_ids=selected_case_ids, selected_devices=selected_devices,
                           contacts=contacts)


def save_event(event_id, lagers, request_id=None):
    is_new_event = event_id is None

    def form_redirect():
        if is_new_event and request_id:
            return redirect(url_for('event_create', request_id=request_id))
        return redirect(request.url)

    name = (request.form.get('name') or '').strip()
    lager_ids = list(dict.fromkeys(value.strip() for value in request.form.getlist('lager_ids') if value.strip()))
    lager_id = lager_ids[0] if lager_ids else ''
    organizer = (request.form.get('organizer') or '').strip()
    description = (request.form.get('description') or '').strip()
    start_at = parse_event_datetime(request.form.get('start_at'))
    end_at = parse_event_datetime(request.form.get('end_at'))

    if start_at and end_at and end_at < start_at:
        flash('Das Event-Ende muss nach dem Beginn liegen.', 'error')
        return form_redirect()

    if not name:
        flash('Ein Veranstaltungsname ist erforderlich.')
        return form_redirect()
    accessible_ids = {str(row[0]) for row in lagers}
    if not lager_ids or any(value not in accessible_ids for value in lager_ids):
        flash('Bitte wähle mindestens ein Lager aus, auf das du Zugriff hast.')
        return form_redirect()

    selected_case_ids = []
    selected_devices = []
    all_case_ids = set()
    device_map_by_lager = {}
    cases_by_lager = {}
    for selected_lager_id in lager_ids:
        cases, devices = load_event_lager_data(selected_lager_id)
        cases_by_lager[selected_lager_id] = cases
        device_map_by_lager[selected_lager_id] = {device['id']: device for device in devices}
        all_case_ids.update((selected_lager_id, case['id']) for case in cases)

    for value in request.form.getlist('case_ids'):
        try:
            selected_lager_id, case_id_text = value.rsplit(':', 1)
            case_id = int(case_id_text)
        except (ValueError, TypeError):
            continue
        pair = (selected_lager_id, case_id)
        if selected_lager_id in lager_ids and pair in all_case_ids and pair not in selected_case_ids:
            selected_case_ids.append(pair)

    seen_devices = set()
    for value in request.form.getlist('device_ids'):
        try:
            selected_lager_id, device_id_text = value.rsplit(':', 1)
            device_id = int(device_id_text)
        except (ValueError, TypeError):
            continue
        device_map = device_map_by_lager.get(selected_lager_id, {})
        pair = (selected_lager_id, device_id)
        if pair in seen_devices or device_id not in device_map:
            continue
        seen_devices.add(pair)
        device = device_map[device_id]
        try:
            quantity = int(request.form.get(f'quantity_{selected_lager_id}_{device_id}') or device['quantity'])
        except (TypeError, ValueError):
            quantity = device['quantity']
        quantity = max(1, min(quantity, device['quantity']))
        selected_devices.append((selected_lager_id, device_id, device['case_id'], quantity))

    # Devices inside selected cases are automatically included.
    for selected_lager_id, case_id in selected_case_ids:
        case_item = next((item for item in cases_by_lager[selected_lager_id] if item['id'] == case_id), None)
        if not case_item:
            continue
        for device_id in case_item['device_ids']:
            pair = (selected_lager_id, device_id)
            if pair in seen_devices:
                continue
            device = device_map_by_lager[selected_lager_id].get(device_id)
            if device:
                seen_devices.add(pair)
                selected_devices.append((selected_lager_id, device_id, case_id, device['quantity']))

    contacts = []
    contact_names = request.form.getlist('contact_name')
    contact_emails = request.form.getlist('contact_email')
    for index, contact_name in enumerate(contact_names):
        contact_name = (contact_name or '').strip()
        contact_email = (contact_emails[index] if index < len(contact_emails) else '').strip()
        if contact_name:
            contacts.append((contact_name, contact_email or None))

    conn = get_users_conn()
    c = conn.cursor()

    old_assignments = {}
    if event_id:
        c.execute("SELECT lager_id, device_id FROM event_devices WHERE event_id = ?", (event_id,))
        for old_lager, old_id in c.fetchall():
            old_assignments.setdefault(old_lager, {'devices': set(), 'cases': set()})['devices'].add(old_id)
        c.execute("SELECT lager_id, case_id FROM event_cases WHERE event_id = ?", (event_id,))
        for old_lager, old_id in c.fetchall():
            old_assignments.setdefault(old_lager, {'devices': set(), 'cases': set()})['cases'].add(old_id)

    conflicts = []
    conflicting_devices = set()
    conflicting_cases = set()
    for selected_lager_id, device_id, _, requested_quantity in selected_devices:
        device = device_map_by_lager[selected_lager_id][device_id]
        if device['status'] == 'defekt':
            conflicts.append(f"Gerät „{device['name']}\" ist defekt und wurde nicht eingeplant.")
            conflicting_devices.add((selected_lager_id, device_id))
        elif active_borrow_quantity(selected_lager_id, device_id) + requested_quantity > device['quantity']:
            conflicts.append(f"Gerät „{device['name']}\" ist derzeit teilweise oder vollständig ausgeliehen; die angeforderte Menge wurde ausgelassen.")
            conflicting_devices.add((selected_lager_id, device_id))
        elif event_assignment_conflicts(selected_lager_id, device_id, 'device', start_at, end_at, event_id):
            conflicts.append(f"Gerät „{device['name']}\" ist bereits in einem zeitlich überschneidenden Event eingeplant und wurde ausgelassen.")
            conflicting_devices.add((selected_lager_id, device_id))
    for selected_lager_id, case_id in selected_case_ids:
        case_item = next((item for item in cases_by_lager[selected_lager_id] if item['id'] == case_id), None)
        if not case_item:
            continue
        defective_devices = [device_map_by_lager[selected_lager_id][device_id]['name']
                             for device_id in case_item['device_ids']
                             if device_id in device_map_by_lager[selected_lager_id]
                             and device_map_by_lager[selected_lager_id][device_id]['status'] == 'defekt']
        if case_item['status'] == 'defekt' or defective_devices:
            if defective_devices:
                conflicts.append(f"Case „{case_item['name']}\" enthält defekte Geräte ({', '.join(defective_devices)}) und wurde nicht eingeplant.")
            else:
                conflicts.append(f"Case „{case_item['name']}\" ist defekt und wurde nicht eingeplant.")
            conflicting_cases.add((selected_lager_id, case_id))
        elif event_assignment_conflicts(selected_lager_id, case_id, 'case', start_at, end_at, event_id):
            conflicts.append(f"Case „{case_item['name']}\" ist bereits in einem zeitlich überschneidenden Event eingeplant und wurde ausgelassen.")
            conflicting_cases.add((selected_lager_id, case_id))

    # Keep the event and all non-conflicting inventory when one selected item
    # is unavailable, instead of losing the whole submitted form.
    selected_case_ids = [pair for pair in selected_case_ids if pair not in conflicting_cases]
    selected_devices = [item for item in selected_devices
                        if (item[0], item[1]) not in conflicting_devices
                        and (item[0], item[2]) not in conflicting_cases]

    if event_id:
        c.execute("""UPDATE events SET name = ?, organizer = ?, description = ?, lager_id = ?,
                     start_at = ?, end_at = ? WHERE id = ?""",
                  (name, organizer or None, description or None, lager_id,
                   start_at, end_at, event_id))
    else:
        c.execute("""INSERT INTO events (name, organizer, description, lager_id, start_at, end_at, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?)""",
                  (name, organizer or None, description or None, lager_id,
                   start_at, end_at, session['user_id']))
        event_id = c.lastrowid
        c.execute("INSERT INTO event_permissions (event_id, user_id, role) VALUES (?, ?, 'host')",
                  (event_id, session['user_id']))

    c.execute("DELETE FROM event_cases WHERE event_id = ?", (event_id,))
    c.execute("DELETE FROM event_devices WHERE event_id = ?", (event_id,))
    c.execute("DELETE FROM event_lagers WHERE event_id = ?", (event_id,))
    c.execute("DELETE FROM event_contacts WHERE event_id = ?", (event_id,))

    for selected_lager_id in lager_ids:
        c.execute("INSERT INTO event_lagers (event_id, lager_id) VALUES (?, ?)", (event_id, selected_lager_id))
    for selected_lager_id, case_id in selected_case_ids:
        c.execute("INSERT INTO event_cases (event_id, lager_id, case_id) VALUES (?, ?, ?)",
                  (event_id, selected_lager_id, case_id))
    for selected_lager_id, device_id, case_id, quantity in selected_devices:
        c.execute("INSERT INTO event_devices (event_id, lager_id, device_id, case_id, quantity) VALUES (?, ?, ?, ?, ?)",
                  (event_id, selected_lager_id, device_id, case_id, quantity))
    for contact_name, contact_email in contacts:
        c.execute("INSERT INTO event_contacts (event_id, name, email) VALUES (?, ?, ?)",
                  (event_id, contact_name, contact_email))

    if is_new_event and request_id:
        c.execute("UPDATE event_requests SET status = 'done' WHERE id = ? AND status = 'new'",
                  (request_id,))

    conn.commit()
    conn.close()

    new_assignments = {}
    for selected_lager_id, device_id, _, _ in selected_devices:
        new_assignments.setdefault(selected_lager_id, {'devices': set(), 'cases': set()})['devices'].add(device_id)
    for selected_lager_id, case_id in selected_case_ids:
        new_assignments.setdefault(selected_lager_id, {'devices': set(), 'cases': set()})['cases'].add(case_id)
    for selected_lager_id in set(old_assignments) | set(new_assignments):
        old_items = old_assignments.get(selected_lager_id, {'devices': set(), 'cases': set()})
        new_items = new_assignments.get(selected_lager_id, {'devices': set(), 'cases': set()})
        refresh_event_item_statuses(selected_lager_id, old_items['devices'] | new_items['devices'],
                                    old_items['cases'] | new_items['cases'])

    flash(f'Event „{name}" wurde gespeichert.')
    for message in conflicts[:8]:
        flash(message, 'error')
    if len(conflicts) > 8:
        flash(f'Weitere {len(conflicts) - 8} nicht verfügbare Position(en) wurden ausgelassen.', 'error')
    return redirect(url_for('event_detail', event_id=event_id))


@app.route('/events/<int:event_id>')
def event_detail(event_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))

    role = get_event_role(event_id, session['user_id'])
    if not role:
        flash('Du hast keinen Zugriff auf dieses Event.')
        return redirect(url_for('events'))

    conn = get_users_conn()
    c = conn.cursor()
    c.execute("""SELECT id, name, organizer, description, lager_id, start_at, end_at, created_by, created_at
                 FROM events WHERE id = ?""", (event_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        return redirect(url_for('events'))

    event = {
        'id': row[0], 'name': row[1], 'organizer': row[2], 'description': row[3],
        'lager_id': row[4], 'start_at': str(row[5]) if row[5] else None,
        'end_at': str(row[6]) if row[6] else None,
        'created_by': row[7], 'created_at': str(row[8]) if row[8] else None,
    }
    c.execute("SELECT name, email FROM event_contacts WHERE event_id = ? ORDER BY id", (event_id,))
    contacts = [{'name': r[0], 'email': r[1]} for r in c.fetchall()]
    c.execute("SELECT lager_id FROM event_lagers WHERE event_id = ?", (event_id,))
    event_lager_ids = [r[0] for r in c.fetchall()] or [event['lager_id']]
    c.execute("SELECT lager_id, case_id FROM event_cases WHERE event_id = ?", (event_id,))
    selected_case_rows = c.fetchall()
    c.execute("SELECT lager_id, device_id, case_id, quantity FROM event_devices WHERE event_id = ?", (event_id,))
    selected_device_rows = c.fetchall()
    c.execute("""SELECT ep.user_id, u.name, ep.role
                 FROM event_permissions ep
                 LEFT JOIN users u ON u.id = ep.user_id
                 WHERE ep.event_id = ?""", (event_id,))
    permissions = [{'user_id': r[0], 'name': r[1] or r[0], 'role': r[2]} for r in c.fetchall()]
    permissions.sort(key=lambda p: (-EVENT_ROLE_RANK.get(p['role'], 0), (p['name'] or '').lower()))
    c.execute("SELECT id, name FROM users ORDER BY name")
    users = c.fetchall()
    c.execute("""SELECT id, filename, mimetype, uploaded_by, created_at
                 FROM event_attachments WHERE event_id = ? ORDER BY created_at DESC, id DESC""", (event_id,))
    attachments = [{'id': r[0], 'filename': r[1], 'mimetype': r[2] or '',
                    'uploaded_by': r[3], 'created_at': str(r[4]) if r[4] else ''}
                   for r in c.fetchall()]
    conn.close()

    lager_names = {lager_id: get_lager_name(lager_id) for lager_id in event_lager_ids}
    cases = []
    devices = []
    for lager_id in event_lager_ids:
        create_warehouse_db(lager_id)
        lconn = get_db_connection(lager_id)
        lc = lconn.cursor()
        lc.execute("SELECT id, name, barcode FROM cases ORDER BY name")
        all_cases = {r[0]: {'id': r[0], 'name': r[1], 'barcode': r[2]} for r in lc.fetchall()}
        selected_for_lager = [case_id for case_lager, case_id in selected_case_rows if case_lager == lager_id]
        for case_id in selected_for_lager:
            if case_id in all_cases:
                item = dict(all_cases[case_id])
                item['lager_name'] = lager_names[lager_id]
                cases.append(item)

        device_rows = [row for row in selected_device_rows if row[0] == lager_id]
        device_ids = [row[1] for row in device_rows]
        device_meta = {}
        if device_ids:
            placeholders = ','.join('?' for _ in device_ids)
            lc.execute(f"SELECT id, name, barcode, quantity FROM geraete WHERE id IN ({placeholders})",
                       tuple(device_ids))
            device_meta = {r[0]: {'id': r[0], 'name': r[1], 'barcode': r[2], 'stock_quantity': r[3] or 1}
                           for r in lc.fetchall()}
        for _, device_id, case_id, quantity in device_rows:
            meta = device_meta.get(device_id)
            if not meta:
                continue
            item = dict(meta)
            item['quantity'] = quantity
            item['case_name'] = all_cases.get(case_id, {}).get('name') if case_id else None
            item['lager_name'] = lager_names[lager_id]
            devices.append(item)
        lconn.close()

    # In event views, collapse individually tracked copies of the same item.
    # The inventory still keeps one row and one defect state per physical unit.
    grouped = {}
    for item in devices:
        key = (item['lager_name'], item['name'], item['case_name'] or '')
        group = grouped.setdefault(key, {**item, 'barcodes': [], 'quantity': 0, 'stock_quantity': 0})
        if item.get('barcode'):
            group['barcodes'].append(str(item['barcode']))
        group['quantity'] += item.get('quantity') or 1
        group['stock_quantity'] += item.get('stock_quantity') or 1
    devices = list(grouped.values())
    for item in devices:
        item['barcode'] = ', '.join(item.pop('barcodes'))

    return render_template('event_detail.html', title=event['name'], event=event,
                           contacts=contacts, cases=cases, devices=devices,
                           permissions=permissions, users=users, groups=get_user_groups(),
                           attachments=attachments, role=role,
                           role_label=EVENT_ROLE_LABELS.get(role, role),
                           can_edit=EVENT_ROLE_RANK.get(role, 0) >= 2,
                           is_host=role == 'host', lager_name=', '.join(lager_names.values()),
                           event_lager_names=list(lager_names.values()))


@app.route('/events/<int:event_id>/material.pdf')
def event_material_pdf(event_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))
    if not event_can_view(event_id, session['user_id']):
        flash('Du hast keinen Zugriff auf dieses Event.')
        return redirect(url_for('events'))

    conn = get_users_conn()
    c = conn.cursor()
    c.execute("SELECT name, lager_id FROM events WHERE id = ?", (event_id,))
    event = c.fetchone()
    if not event:
        conn.close()
        return redirect(url_for('events'))
    c.execute("SELECT lager_id FROM event_lagers WHERE event_id = ?", (event_id,))
    lager_ids = [row[0] for row in c.fetchall()] or [event[1]]
    c.execute("SELECT lager_id, case_id FROM event_cases WHERE event_id = ?", (event_id,))
    selected_cases = c.fetchall()
    c.execute("SELECT lager_id, device_id, case_id, quantity FROM event_devices WHERE event_id = ?", (event_id,))
    selected_devices = c.fetchall()
    conn.close()

    rows = [['IDs / Barcodes', 'Name', 'Anzahl', 'Lagerort / Raum', 'Lagerplatz',
             'Case / Koffer / Rack', 'Ergänzungen', '✓']]
    grouped_devices = {}
    for lager_id in lager_ids:
        # A user may request the PDF directly from an already-open event page.
        # Ensure this warehouse has the current schema before selecting room fields.
        create_warehouse_db(lager_id)
        warehouse_conn = get_db_connection(lager_id)
        wc = warehouse_conn.cursor()
        wc.execute("SELECT id, name, case_type FROM cases")
        case_lookup = {row[0]: {'name': row[1], 'type': row[2] or 'Case'} for row in wc.fetchall()}
        for case_lager, case_id in selected_cases:
            if case_lager != lager_id:
                continue
            wc.execute("SELECT barcode, name, lagerort, lagerplatz FROM cases WHERE id = ?", (case_id,))
            case_row = wc.fetchone()
            if case_row:
                case_info = case_lookup.get(case_id, {})
                rows.append([case_row[0] or str(case_id), case_row[1], '1', case_row[2] or '',
                             case_row[3] or '', case_info.get('type') or 'Case', '', ''])
        for device_lager, device_id, case_id, quantity in selected_devices:
            if device_lager != lager_id:
                continue
            wc.execute("SELECT barcode, name, lagerort, lagerplatz FROM geraete WHERE id = ?", (device_id,))
            device_row = wc.fetchone()
            if device_row:
                case_info = case_lookup.get(case_id, {})
                case_label = ''
                if case_info:
                    case_label = f"{case_info.get('type') or 'Case'}: {case_info.get('name') or ''}".strip()
                group_key = (lager_id, device_row[1], device_row[2] or '', device_row[3] or '', case_label)
                group = grouped_devices.setdefault(group_key, {'ids': [], 'quantity': 0})
                group['ids'].append(device_row[0] or str(device_id))
                group['quantity'] += quantity or 1
        warehouse_conn.close()

    for (_, name, room, shelf, case_label), group in grouped_devices.items():
        rows.append([', '.join(map(str, group['ids'])), name, str(group['quantity']), room, shelf, case_label, '', ''])

    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=20, leftMargin=20,
                            topMargin=24, bottomMargin=24)
    styles = getSampleStyleSheet()
    escaped_event_name = str(event[0]).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    story = [Paragraph(f"Materialliste – {escaped_event_name}", styles['Title']), Spacer(1, 10)]
    safe_rows = [[Paragraph(str(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'),
                            styles['BodyText']) for value in row] for row in rows]
    table = Table(safe_rows, colWidths=[64, 95, 30, 62, 55, 90, 105, 18], repeatRows=1)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#263449')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#718096')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#edf2f7')]),
        ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(table)
    doc.build(story)
    buffer.seek(0)
    return send_file(buffer, mimetype='application/pdf', as_attachment=True,
                     download_name=f"materialliste_event_{event_id}.pdf")


@app.route('/events/<int:event_id>/contract.pdf')
def event_contract_pdf(event_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))
    if not event_can_view(event_id, session['user_id']):
        flash('Du hast keinen Zugriff auf dieses Event.')
        return redirect(url_for('events'))

    conn = get_users_conn()
    c = conn.cursor()
    c.execute("""SELECT name, organizer, description, lager_id, start_at, end_at, created_by, created_at
                 FROM events WHERE id = ?""", (event_id,))
    event = c.fetchone()
    if not event:
        conn.close()
        return redirect(url_for('events'))
    c.execute("SELECT name, email FROM event_contacts WHERE event_id = ? ORDER BY id", (event_id,))
    contacts = c.fetchall()
    c.execute("SELECT lager_id FROM event_lagers WHERE event_id = ?", (event_id,))
    lager_ids = [row[0] for row in c.fetchall()] or [event[3]]
    c.execute("SELECT lager_id, case_id FROM event_cases WHERE event_id = ?", (event_id,))
    selected_cases = c.fetchall()
    c.execute("SELECT lager_id, device_id, case_id, quantity FROM event_devices WHERE event_id = ?", (event_id,))
    selected_devices = c.fetchall()
    conn.close()

    lager_names = [get_lager_name(lager_id) for lager_id in lager_ids]
    rows = [['Pos.', 'Bezeichnung', 'IDs / Barcodes', 'Case / Koffer / Rack', 'Menge']]
    position = 0
    device_groups = {}
    for lager_id in lager_ids:
        create_warehouse_db(lager_id)
        warehouse_conn = get_db_connection(lager_id)
        wc = warehouse_conn.cursor()
        wc.execute("SELECT id, name, case_type FROM cases")
        case_lookup = {row[0]: {'name': row[1], 'type': row[2] or 'Case'} for row in wc.fetchall()}
        for case_lager, case_id in selected_cases:
            if case_lager != lager_id:
                continue
            wc.execute("SELECT barcode, name, case_type FROM cases WHERE id = ?", (case_id,))
            case_row = wc.fetchone()
            if case_row:
                position += 1
                rows.append([str(position), f"{case_row[2] or 'Case'}: {case_row[1]}",
                             case_row[0] or str(case_id), '—', '1'])
        for device_lager, device_id, case_id, quantity in selected_devices:
            if device_lager != lager_id:
                continue
            wc.execute("SELECT barcode, name FROM geraete WHERE id = ?", (device_id,))
            device_row = wc.fetchone()
            if not device_row:
                continue
            case_info = case_lookup.get(case_id)
            case_label = f"{case_info.get('type') or 'Case'}: {case_info.get('name')}" if case_info else '—'
            group_key = (lager_id, device_row[1], case_label)
            group = device_groups.setdefault(group_key, {'barcodes': [], 'quantity': 0})
            group['barcodes'].append(device_row[0] or str(device_id))
            group['quantity'] += quantity or 1
        warehouse_conn.close()

    for (_, name, case_label), group in device_groups.items():
        position += 1
        rows.append([str(position), name, ', '.join(map(str, group['barcodes'])), case_label,
                     str(group['quantity'])])

    def esc(value):
        return str(value or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

    borrower = event[1] or (contacts[0][0] if contacts else event[6]) or '—'
    lender = ', '.join(name for name in lager_names if name) or 'DMS Lagersystem'
    event_period = f"{event[4] or 'nicht festgelegt'} bis {event[5] or 'offen'}"
    contact_text = ', '.join(name for name, _ in contacts) or '—'

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('ContractTitle', parent=styles['Title'], fontSize=20, leading=24,
                                 spaceAfter=14, alignment=TA_CENTER)
    heading_style = ParagraphStyle('ContractHeading', parent=styles['Heading2'], fontSize=11,
                                   leading=14, spaceBefore=12, spaceAfter=5)
    body_style = ParagraphStyle('ContractBody', parent=styles['BodyText'], fontSize=9,
                                leading=13, spaceAfter=4)
    small_style = ParagraphStyle('ContractSmall', parent=styles['BodyText'], fontSize=8, leading=10)

    story = [
        Paragraph('Verleihvertrag', title_style),
        Paragraph(f"Veranstaltung: <b>{esc(event[0])}</b>", body_style),
        Spacer(1, 6),
        Paragraph(f"<b>Verleiher:</b> {esc(lender)}", body_style),
        Paragraph(f"<b>Entleiher:</b> {esc(borrower)}", body_style),
        Paragraph(f"<b>Zeitraum:</b> {esc(event_period)}", body_style),
        Paragraph(f"<b>Kontaktpersonen:</b> {esc(contact_text)}", body_style),
        Spacer(1, 8),
        Paragraph('1. Vertragsgegenstand', heading_style),
        Paragraph('Der Verleiher überlässt dem Entleiher die nachfolgend aufgeführten Geräte und '
                  'Transportbehältnisse für die Dauer der oben genannten Veranstaltung.', body_style),
    ]

    safe_rows = []
    for row in rows:
        safe_rows.append([Paragraph(esc(value), small_style) for value in row])
    table = Table(safe_rows, colWidths=[26, 145, 145, 145, 40], repeatRows=1)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#263449')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#718096')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#edf2f7')]),
        ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(table)
    story.extend([
        Paragraph('2. Rückgabe und Nutzung', heading_style),
        Paragraph('Die Geräte sind spätestens zum vereinbarten Veranstaltungsende vollständig und '
                  'in ordnungsgemäßem Zustand zurückzugeben. Der Entleiher verpflichtet sich zu einem '
                  'sorgfältigen Umgang und darf die Geräte nicht ohne Zustimmung an Dritte weitergeben.', body_style),
        Paragraph('3. Haftung und Schäden', heading_style),
        Paragraph('Für Schäden, Verluste oder einen über die vereinbarte Nutzung hinausgehenden Gebrauch '
                  'haftet der Entleiher nach den gesetzlichen Bestimmungen. Festgestellte Schäden sind '
                  'unverzüglich zu melden.', body_style),
        Paragraph('4. Sonstiges', heading_style),
        Paragraph('Änderungen und Ergänzungen dieses Vertrags bedürfen der Schriftform. Sollten einzelne '
                  'Regelungen unwirksam sein, bleibt die Wirksamkeit der übrigen Regelungen unberührt.', body_style),
        Spacer(1, 20),
        Paragraph(f"Ort, Datum: ______________________________    {esc(datetime.now().strftime('%d.%m.%Y'))}", body_style),
        Spacer(1, 24),
        Paragraph('_______________________________<br/>Unterschrift Verleiher', body_style),
        Spacer(1, 24),
        Paragraph('_______________________________<br/>Unterschrift Entleiher', body_style),
    ])

    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=40, leftMargin=40,
                            topMargin=40, bottomMargin=40,
                            title=f'Verleihvertrag {event[0]}')
    doc.build(story)
    buffer.seek(0)
    return send_file(buffer, mimetype='application/pdf', as_attachment=True,
                     download_name=f"verleihvertrag_event_{event_id}.pdf")


@app.route('/events/<int:event_id>/attachments', methods=['POST'])
def event_attachment_upload(event_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))
    if not event_can_edit(event_id, session['user_id']):
        flash('Du hast keine Berechtigung, Anhänge hinzuzufügen.')
        return redirect(url_for('event_detail', event_id=event_id))

    upload = request.files.get('attachment')
    if not upload or not upload.filename:
        flash('Bitte wähle eine Datei aus.')
        return redirect(url_for('event_detail', event_id=event_id))

    filename = secure_filename(upload.filename) or 'anhang'
    extension = Path(filename).suffix.lower()
    if extension not in ('.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif'):
        flash('Erlaubt sind PDF-, PNG-, JPG-, WEBP- und GIF-Dateien.')
        return redirect(url_for('event_detail', event_id=event_id))

    data = upload.read()
    if not data:
        flash('Die Datei ist leer.')
        return redirect(url_for('event_detail', event_id=event_id))
    if len(data) > 20 * 1024 * 1024:
        flash('Die Datei darf maximal 20 MB groß sein.')
        return redirect(url_for('event_detail', event_id=event_id))

    mimetype = upload.mimetype or 'application/octet-stream'
    conn = get_users_conn()
    c = conn.cursor()
    c.execute("""INSERT INTO event_attachments (event_id, filename, mimetype, data, uploaded_by)
                 VALUES (?, ?, ?, ?, ?)""",
              (event_id, filename, mimetype, data, session['user_id']))
    conn.commit()
    conn.close()
    flash(f'Anhang „{filename}" wurde hochgeladen.')
    return redirect(url_for('event_detail', event_id=event_id))


@app.route('/events/<int:event_id>/attachments/<int:attachment_id>')
def event_attachment(event_id, attachment_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))
    if not event_can_view(event_id, session['user_id']):
        flash('Du hast keinen Zugriff auf dieses Event.')
        return redirect(url_for('events'))

    conn = get_users_conn()
    c = conn.cursor()
    c.execute("""SELECT filename, mimetype, data FROM event_attachments
                 WHERE id = ? AND event_id = ?""", (attachment_id, event_id))
    row = c.fetchone()
    conn.close()
    if not row:
        return '', 404
    return send_file(BytesIO(row[2]), mimetype=row[1] or 'application/octet-stream',
                     as_attachment=False, download_name=row[0])


@app.route('/events/<int:event_id>/attachments/<int:attachment_id>/delete', methods=['POST'])
def event_attachment_delete(event_id, attachment_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))
    if not event_can_edit(event_id, session['user_id']):
        flash('Du hast keine Berechtigung, Anhänge zu löschen.')
        return redirect(url_for('event_detail', event_id=event_id))

    conn = get_users_conn()
    c = conn.cursor()
    c.execute("DELETE FROM event_attachments WHERE id = ? AND event_id = ?", (attachment_id, event_id))
    conn.commit()
    conn.close()
    flash('Anhang wurde gelöscht.')
    return redirect(url_for('event_detail', event_id=event_id))


@app.route('/events/<int:event_id>/permissions', methods=['POST'])
def event_permissions(event_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))
    if not event_is_host(event_id, session['user_id']):
        flash('Nur Veranstalter können Freigaben verwalten.')
        return redirect(url_for('event_detail', event_id=event_id))

    action = request.form.get('action') or 'add'
    user_id = (request.form.get('user_id') or '').strip()
    group_id = (request.form.get('group_id') or '').strip()
    role = request.form.get('role') or 'viewer'
    if role not in EVENT_ROLE_LABELS:
        role = 'viewer'

    conn = get_users_conn()
    c = conn.cursor()

    if action == 'add' and group_id:
        c.execute("SELECT name FROM user_groups WHERE id = ?", (group_id,))
        group = c.fetchone()
        if not group:
            conn.close()
            flash('Gruppe wurde nicht gefunden.')
            return redirect(url_for('event_detail', event_id=event_id))
        c.execute("SELECT user_id FROM user_group_members WHERE group_id = ?", (group_id,))
        member_ids = [row[0] for row in c.fetchall()]
        added = 0
        for member_id in member_ids:
            c.execute("""INSERT IGNORE INTO event_permissions (event_id, user_id, role)
                         VALUES (?, ?, ?)""", (event_id, member_id, role))
            added += c.rowcount
        conn.commit()
        conn.close()
        flash(f'Gruppe „{group[0]}" wurde mit {added} Mitglied(ern) freigegeben.')
        return redirect(url_for('event_detail', event_id=event_id))

    if action in ('update', 'remove') and user_id:
        c.execute("SELECT role FROM event_permissions WHERE event_id = ? AND user_id = ?", (event_id, user_id))
        existing = c.fetchone()
        if existing and existing[0] == 'host' and (action == 'remove' or role != 'host'):
            c.execute("SELECT COUNT(*) FROM event_permissions WHERE event_id = ? AND role = 'host'", (event_id,))
            if c.fetchone()[0] <= 1:
                conn.close()
                flash('Der letzte Veranstalter kann nicht entfernt oder herabgestuft werden.')
                return redirect(url_for('event_detail', event_id=event_id))

    if action == 'remove':
        c.execute("DELETE FROM event_permissions WHERE event_id = ? AND user_id = ?", (event_id, user_id))
        flash('Freigabe wurde entfernt.')
    elif action == 'update':
        c.execute("UPDATE event_permissions SET role = ? WHERE event_id = ? AND user_id = ?",
                  (role, event_id, user_id))
        flash('Freigabe wurde aktualisiert.')
    else:
        if not user_id:
            flash('Bitte wähle einen Benutzer aus.')
        else:
            c.execute("SELECT id FROM users WHERE id = ?", (user_id,))
            if not c.fetchone():
                flash('Benutzer wurde nicht gefunden.')
            else:
                c.execute("SELECT role FROM event_permissions WHERE event_id = ? AND user_id = ?",
                          (event_id, user_id))
                current_permission = c.fetchone()
                if current_permission and current_permission[0] == 'host' and role != 'host':
                    c.execute("SELECT COUNT(*) FROM event_permissions WHERE event_id = ? AND role = 'host'", (event_id,))
                    if c.fetchone()[0] <= 1:
                        conn.close()
                        flash('Der letzte Veranstalter kann nicht herabgestuft werden.')
                        return redirect(url_for('event_detail', event_id=event_id))
                c.execute("""INSERT INTO event_permissions (event_id, user_id, role) VALUES (?, ?, ?)
                             ON DUPLICATE KEY UPDATE role = VALUES(role)""",
                          (event_id, user_id, role))
                flash('Freigabe wurde gespeichert.')

    conn.commit()
    conn.close()
    return redirect(url_for('event_detail', event_id=event_id))


@app.route('/events/<int:event_id>/delete', methods=['POST'])
def event_delete(event_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))
    if not event_is_host(event_id, session['user_id']):
        flash('Nur Veranstalter können dieses Event löschen.')
        return redirect(url_for('event_detail', event_id=event_id))

    conn = get_users_conn()
    c = conn.cursor()
    c.execute("SELECT lager_id, device_id FROM event_devices WHERE event_id = ?", (event_id,))
    device_rows = c.fetchall()
    c.execute("SELECT lager_id, case_id FROM event_cases WHERE event_id = ?", (event_id,))
    case_rows = c.fetchall()
    c.execute("DELETE FROM event_devices WHERE event_id = ?", (event_id,))
    c.execute("DELETE FROM event_cases WHERE event_id = ?", (event_id,))
    c.execute("DELETE FROM event_contacts WHERE event_id = ?", (event_id,))
    c.execute("DELETE FROM event_attachments WHERE event_id = ?", (event_id,))
    c.execute("DELETE FROM event_permissions WHERE event_id = ?", (event_id,))
    c.execute("DELETE FROM event_lagers WHERE event_id = ?", (event_id,))
    c.execute("DELETE FROM events WHERE id = ?", (event_id,))
    conn.commit()
    conn.close()

    assignments = {}
    for lager_id, device_id in device_rows:
        assignments.setdefault(lager_id, {'devices': set(), 'cases': set()})['devices'].add(device_id)
    for lager_id, case_id in case_rows:
        assignments.setdefault(lager_id, {'devices': set(), 'cases': set()})['cases'].add(case_id)
    for lager_id, items in assignments.items():
        refresh_event_item_statuses(lager_id, items['devices'], items['cases'])

    flash('Event wurde gelöscht.')
    return redirect(url_for('events'))


@app.route('/events/lager/<lager_id>/data')
def event_lager_data(lager_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Nicht angemeldet'}), 401
    if not user_has_lager_access(lager_id, session['user_id'], is_admin()):
        return jsonify({'error': 'Kein Zugriff auf dieses Lager'}), 403

    cases, devices = load_event_lager_data(lager_id)
    return jsonify({'cases': cases, 'devices': devices})


@app.route('/devices')
def devices():
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    create_warehouse_db(session['current_lager'])
    
    search = request.args.get('search', '')
    status_filters = [f for f in request.args.getlist('status') if f]
    art_filters = [f for f in request.args.getlist('art') if f]
    klasse_filters = [f for f in request.args.getlist('lagerort') if f]
    sort_by = request.args.get('sort_by', 'name')
    group_by = request.args.get('group_by', 'none')  
    
    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    
    query = """SELECT DISTINCT g.id, g.name, g.barcode, g.lagerplatz, g.status, g.beschreibung,
                      g.seriennummer, g.modell, g.instrumentenart, g.inventarnummer, g.kaufdatum,
                      g.preis, g.quantity, g.hersteller, g.lagerort, g.mietpreis,
                      g.dmx_universum, g.dmx_startadresse, g.dmx_kanaele, g.dmx_belegung, g.bild_mimetype
               FROM geraete g
               LEFT JOIN (
                    SELECT ad.geraet_id,
                           GROUP_CONCAT(DISTINCT a.mitarbeiter_name SEPARATOR ', ') AS mitarbeiter_name,
                           GROUP_CONCAT(DISTINCT a.zielort SEPARATOR ', ') AS zielort,
                           MIN(a.datum) AS datum,
                           GROUP_CONCAT(DISTINCT a.email SEPARATOR ', ') AS email,
                           GROUP_CONCAT(DISTINCT a.klasse SEPARATOR ', ') AS klasse
                    FROM ausleih_details ad JOIN ausleihen a ON a.ausleih_id = ad.ausleih_id
                    WHERE a.status = 'ausgeliehen'
                    GROUP BY ad.geraet_id
               ) a ON a.geraet_id = g.id
               WHERE 1=1"""
    params = []
    
    if search:
        query += " AND (g.name LIKE ? OR g.barcode LIKE ? OR g.lagerplatz LIKE ? OR g.lagerort LIKE ? OR g.seriennummer LIKE ? OR g.modell LIKE ? OR g.instrumentenart LIKE ?)"
        params.extend([f'%{search}%'] * 7)
    
    if status_filters:
        status_conditions = []
        if "verfügbar" in status_filters:
            status_conditions.append("g.status = 'verfügbar'")
        if "ausgeliehen" in status_filters:
            status_conditions.append("(g.status LIKE 'ausgeliehen%' OR g.status NOT IN ('verfügbar', 'defekt', 'zugewiesen'))")
        if "defekt" in status_filters:
            status_conditions.append("g.status = 'defekt'")
        if "zugewiesen" in status_filters:
            status_conditions.append("g.status = 'zugewiesen'")
        if status_conditions:
            query += f" AND ({' OR '.join(status_conditions)})"
    
    if art_filters:
        placeholders = ','.join('?' for _ in art_filters)
        query += f" AND g.instrumentenart IN ({placeholders})"
        params.extend(art_filters)
    
    if klasse_filters:
        placeholders = ','.join('?' for _ in klasse_filters)
        query += f" AND g.lagerort IN ({placeholders})"
        params.extend(klasse_filters)
    

    if sort_by in ('instrumentenart', 'category'):
        query += " ORDER BY g.instrumentenart, g.name"
    elif sort_by == 'lagerplatz':
        query += " ORDER BY g.lagerplatz, g.name"
    elif sort_by == 'status':
        query += " ORDER BY g.status, g.name"
    elif sort_by == 'model':
        query += " ORDER BY g.modell, g.name"
    else:
        query += " ORDER BY g.name"
    
    c.execute(query, params)
    devices_list = c.fetchall()
    
    # The device list represents product groups. Keep each physical copy as a
    # separate inventory row so status and labels can still be managed per ID.
    product_groups_by_key = {}
    for device in devices_list:
        product_signature = (device[1], device[3], device[5], device[7], device[8],
                             device[10], device[11], device[13], device[14], device[15],
                             device[19], device[20])
        if group_by == 'status':
            product_signature += (device[4],)
        product_groups_by_key.setdefault(product_signature, []).append(device)

    grouped_device_groups = {}
    for product_devices in product_groups_by_key.values():
        representative = product_devices[0]
        if group_by == 'model':
            section_name = representative[7] or 'Unbekanntes Modell'
        elif group_by in ('instrument', 'category'):
            section_name = representative[8] or 'Unkategorisiert'
        elif group_by == 'status':
            section_name = STATUS_LABELS.get(representative[4], representative[4] or 'Verfügbar')
        else:
            section_name = 'Alle Geräte'
        grouped_device_groups.setdefault(section_name, []).append({'devices': product_devices})
    
    c.execute("SELECT DISTINCT instrumentenart FROM geraete WHERE instrumentenart IS NOT NULL")
    instrumentenarten = [row[0] for row in c.fetchall()]
    c.execute("SELECT DISTINCT lagerort FROM geraete WHERE lagerort IS NOT NULL AND lagerort != '' ORDER BY lagerort")
    lagerorte = [row[0] for row in c.fetchall()]
    dmx_profiles = {device[0]: _decode_dmx_channel_map(device[19]) for device in devices_list if device[19]}
    conn.close()
    
    return render_template('devices.html', title="Geräte", devices=devices_list,
                         grouped_device_groups=grouped_device_groups,
                         search=search, status_filters=status_filters,
                         art_filters=art_filters, klasse_filters=klasse_filters,
                         sort_by=sort_by, group_by=group_by, instrumentenarten=instrumentenarten, lagerorte=lagerorte,
                         dmx_profiles=dmx_profiles)

@app.route('/devices/group_edit', methods=['GET', 'POST'])
def group_edit_devices():
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    create_warehouse_db(session['current_lager'])

    raw_ids = []
    for value in request.values.getlist('ids'):
        raw_ids.extend(str(value).split(','))
    device_ids = sorted({int(value) for value in raw_ids if str(value).strip().isdigit()})[:500]
    if not device_ids:
        flash('Bitte wähle eine Gerätegruppe aus.')
        return redirect(url_for('devices'))

    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    placeholders = ','.join('?' for _ in device_ids)
    c.execute(f"SELECT * FROM geraete WHERE id IN ({placeholders}) ORDER BY name, id", tuple(device_ids))
    devices = c.fetchall()
    if not devices:
        conn.close()
        flash('Keine passenden Geräte gefunden.')
        return redirect(url_for('devices'))

    if request.method == 'POST':
        def read_group_price(field):
            raw = (request.form.get(field) or '').strip().replace(',', '.')
            try:
                return float(raw) if raw else None
            except ValueError:
                return None

        submitted_name = (request.form.get('name') or '').strip()
        lagerplatz = (request.form.get('lagerplatz') or '').strip()
        lagerort = (request.form.get('lagerort') or '').strip()
        beschreibung = (request.form.get('beschreibung') or '').strip()
        modell = (request.form.get('modell') or '').strip()
        hersteller = (request.form.get('hersteller') or '').strip()
        instrumentenart = (request.form.get('instrumentenart') or '').strip()
        kaufdatum = request.form.get('kaufdatum') or None
        preis = read_group_price('kaufpreis')
        mietpreis = read_group_price('mietpreis')
        status_mode = request.form.get('status') or ''

        backup_db(session['current_lager'], 'before_group_edit_device')
        for device in devices:
            name = submitted_name or device[1]
            c.execute("""UPDATE geraete SET name = ?, lagerplatz = ?, lagerort = ?, beschreibung = ?,
                         modell = ?, hersteller = ?, instrumentenart = ?, kaufdatum = ?, preis = ?,
                         mietpreis = ? WHERE id = ?""",
                      (name, lagerplatz, lagerort, beschreibung, modell, hersteller, instrumentenart,
                       kaufdatum, preis, mietpreis, device[0]))
            if status_mode in DEVICE_MANUAL_STATUSES:
                c.execute("UPDATE geraete SET status = ? WHERE id = ?", (status_mode, device[0]))
        conn.commit()
        backup_db(session['current_lager'], 'after_group_edit_device')
        for device in devices:
            if status_mode == 'verfügbar':
                update_device_status(session['current_lager'], device[0])
        conn.close()
        flash(f'{len(devices)} Gerät(e) der Gruppe wurden aktualisiert.')
        return redirect(url_for('devices'))

    c.execute("SELECT DISTINCT instrumentenart FROM geraete WHERE instrumentenart IS NOT NULL")
    instrumentenarten = [row[0] for row in c.fetchall()]
    conn.close()
    return render_template('group_edit.html', title="Gerätegruppe bearbeiten", devices=devices,
                           instrumentenarten=instrumentenarten, device_ids=','.join(str(d[0]) for d in devices))


@app.route('/add_device', methods=['GET', 'POST'])
def add_device():
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    create_warehouse_db(session['current_lager'])

    if request.method == 'POST':
        name = (request.form.get('name') or '').strip()
        lagerplatz = (request.form.get('lagerplatz') or '').strip()
        lagerort = (request.form.get('lagerort') or '').strip()
        beschreibung = (request.form.get('beschreibung') or '').strip()
        seriennummer = (request.form.get('seriennummer') or '').strip()
        modell = (request.form.get('modell') or '').strip()
        instrumentenart = (request.form.get('instrumentenart') or '').strip()
        kaufdatum = request.form.get('kaufdatum') or None
        def read_price(field):
            raw = (request.form.get(field) or '').strip().replace(',', '.')
            try:
                return float(raw) if raw else None
            except ValueError:
                return None
        preis = read_price('kaufpreis')
        mietpreis = read_price('mietpreis')
        try:
            dmx_belegung = _parse_dmx_channel_map(request.form)
            bild_mimetype, bild_daten = _read_uploaded_device_image(request.files.get('bild'))
        except ValueError as exc:
            flash(str(exc), 'error')
            return redirect(url_for('add_device'))
        try:
            quantity = int(request.form.get('quantity') or 1) if request.form.get('quantity_enabled') == 'on' else 1
        except (TypeError, ValueError):
            quantity = 1
        quantity = max(1, min(quantity, 1000))
        individual_qr = request.form.get('individual_qr') == 'on'
        hersteller = (request.form.get('hersteller') or '').strip()

        conn = get_db_connection(session['current_lager'])
        c = conn.cursor()

        backup_db(session['current_lager'], 'before_add_device')

        def insert_device(stock_quantity):
            while True:
                barcode = generate_random_id(8)
                c.execute("SELECT id FROM geraete WHERE barcode = ?", (barcode,))
                if not c.fetchone():
                    break
            c.execute("""INSERT INTO geraete
                         (name, barcode, lagerplatz, beschreibung, seriennummer, modell, instrumentenart,
                          inventarnummer, kaufdatum, preis, quantity, hersteller, lagerort, mietpreis,
                          dmx_belegung, bild_mimetype, bild_daten)
                         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                      (name, barcode, lagerplatz, beschreibung, seriennummer, modell, instrumentenart,
                       kaufdatum, preis, stock_quantity, hersteller, lagerort, mietpreis,
                       dmx_belegung, bild_mimetype, bild_daten))

        if individual_qr:
            for _ in range(quantity):
                insert_device(1)
        else:
            insert_device(quantity)
        conn.commit()
        backup_db(session['current_lager'], 'after_add_device')
        conn.close()
        return redirect(url_for('devices'))
    
    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    c.execute("SELECT DISTINCT instrumentenart FROM geraete WHERE instrumentenart IS NOT NULL")
    instrumentenarten = [row[0] for row in c.fetchall()]
    conn.close()
    
    return render_template('add_device.html', title="Gerät hinzufügen", instrumentenarten=instrumentenarten, dmx_belegung=[])

@app.route('/edit_device/<int:device_id>', methods=['GET', 'POST'])
def edit_device(device_id):
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    create_warehouse_db(session['current_lager'])
    
    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    
    if request.method == 'POST':
        c.execute("SELECT * FROM geraete WHERE id = ?", (device_id,))
        device = c.fetchone()
        if not device:
            conn.close()
            return redirect(url_for('devices'))

        name = request.form['name']
        barcode = request.form['barcode']
        lagerplatz = (request.form.get('lagerplatz') or '').strip()
        lagerort = (request.form.get('lagerort') or '').strip()
        new_beschreibung = (request.form.get('beschreibung') or '').strip()
        seriennummer = (request.form.get('seriennummer') or '').strip()
        modell = (request.form.get('modell') or '').strip()
        instrumentenart = (request.form.get('instrumentenart') or '').strip()
        inventarnummer = device[9]
        kaufdatum = request.form.get('kaufdatum') or None
        def read_edit_price(field):
            raw = (request.form.get(field) or '').strip().replace(',', '.')
            try:
                return float(raw) if raw else None
            except ValueError:
                return None
        preis = read_edit_price('kaufpreis')
        mietpreis = read_edit_price('mietpreis')
        try:
            dmx_belegung = _parse_dmx_channel_map(request.form)
            uploaded_mimetype, uploaded_image = _read_uploaded_device_image(request.files.get('bild'))
        except ValueError as exc:
            flash(str(exc), 'error')
            conn.close()
            return redirect(url_for('edit_device', device_id=device_id))
        if request.form.get('remove_bild') == 'on':
            bild_mimetype, bild_daten = None, None
        elif uploaded_image is not None:
            bild_mimetype, bild_daten = uploaded_mimetype, uploaded_image
        else:
            bild_mimetype, bild_daten = device[20], device[21]
        quantity = device[12] or 1
        hersteller = (request.form.get('hersteller') or '').strip()
        requested_status = request.form.get('status')
        if requested_status not in DEVICE_MANUAL_STATUSES:
            requested_status = 'defekt' if request.form.get('defekt', 'off') == 'on' else 'verfügbar'

        c.execute("SELECT id FROM geraete WHERE barcode = ? AND id != ?", (barcode, device_id))
        if c.fetchone():
            conn.close()
            return redirect(url_for('edit_device', device_id=device_id))

        current_beschreibung = device[5] or ''
        if new_beschreibung != current_beschreibung:
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            user_name = session.get('user_name', 'Unknown')
            log_entry = f"[{timestamp} - {user_name}] {new_beschreibung}"
            if current_beschreibung:
                beschreibung = log_entry + "\n\n" + current_beschreibung
            else:
                beschreibung = log_entry
        else:
            beschreibung = current_beschreibung

        backup_db(session['current_lager'], 'before_edit_device')
        status = 'defekt' if requested_status == 'defekt' else 'verfügbar'
        c.execute("""UPDATE geraete SET name = ?, barcode = ?, lagerplatz = ?, beschreibung = ?, seriennummer = ?,
                     modell = ?, instrumentenart = ?, inventarnummer = ?, kaufdatum = ?, preis = ?, quantity = ?,
                     hersteller = ?, status = ?, lagerort = ?, mietpreis = ?, dmx_universum = ?,
                     dmx_startadresse = ?, dmx_kanaele = ?, dmx_belegung = ?, bild_mimetype = ?, bild_daten = ? WHERE id = ?""",
                  (name, barcode, lagerplatz, beschreibung, seriennummer, modell, instrumentenart,
                   inventarnummer, kaufdatum, preis, quantity, hersteller, status, lagerort,
                   mietpreis, device[16], device[17], device[18], dmx_belegung,
                   bild_mimetype, bild_daten, device_id))
        conn.commit()
        backup_db(session['current_lager'], 'after_edit_device')
        if requested_status != 'defekt':
            update_device_status(session['current_lager'], device_id)
        conn.close()
        return redirect(url_for('devices'))
    
    c.execute("SELECT * FROM geraete WHERE id = ?", (device_id,))
    device = c.fetchone()
    if not device:
        conn.close()
        return redirect(url_for('devices'))
    c.execute("SELECT DISTINCT instrumentenart FROM geraete WHERE instrumentenart IS NOT NULL")
    instrumentenarten = [row[0] for row in c.fetchall()]
    conn.close()
    
    beschreibung = device[5] or ''
    current_description = ''
    if beschreibung:
        entries = beschreibung.split('\n\n')
        if entries:
            latest_entry = entries[0]
            if latest_entry.startswith('[') and ']' in latest_entry:
                bracket_end = latest_entry.find(']') + 1
                current_description = latest_entry[bracket_end:].strip()
    
    return render_template('edit_device.html', title="Gerät bearbeiten", device=device, instrumentenarten=instrumentenarten,
                           current_description=current_description, dmx_belegung=_decode_dmx_channel_map(device[19]),
                           has_image=bool(device[21]))


@app.route('/device-image/<int:device_id>')
def device_image(device_id):
    if 'user_id' not in session or not session.get('current_lager'):
        return '', 404
    lager_id = session['current_lager']
    if not user_has_lager_access(lager_id, session['user_id'], is_admin()):
        return '', 404
    create_warehouse_db(lager_id)
    conn = get_db_connection(lager_id)
    c = conn.cursor()
    c.execute("SELECT bild_daten, bild_mimetype FROM geraete WHERE id = ?", (device_id,))
    row = c.fetchone()
    conn.close()
    if not row or not row[0]:
        return '', 404
    return send_file(BytesIO(row[0]), mimetype=row[1] or 'image/jpeg', max_age=3600)

@app.route('/delete_device/<int:device_id>')
def delete_device(device_id):
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    
    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    backup_db(session['current_lager'], 'before_delete_device')
    c.execute("DELETE FROM geraete WHERE id = ?", (device_id,))
    conn.commit()
    backup_db(session['current_lager'], 'after_delete_device')
    conn.close()
    return redirect(url_for('devices'))


@app.route('/admin/regenerate_missing_slips')
def admin_regenerate_missing_slips():
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    result = regenerate_missing_borrow_pdfs()
    flash(result['message'], 'success' if result['success'] else 'error')
    return redirect(url_for('borrow'))

@app.route('/admin/download_all_slips')
def admin_download_all_slips():
    return get_all_borrows()

@app.route('/borrow_success/<ausleih_id>')
def borrow_success(ausleih_id):
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    
    system_type = get_lager_system_type(session['current_lager'])
    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    
    c.execute("""SELECT a.ausleih_id, a.mitarbeiter_id, a.mitarbeiter_name, a.zielort, 
                        a.datum, a.rueckgabe_qr, a.status, a.email, a.klasse
                 FROM ausleihen a
                 WHERE a.ausleih_id = ?""", (ausleih_id,))
    borrow_row = c.fetchone()
    
    if not borrow_row:
        conn.close()
        return redirect(url_for('borrow'))
    
    borrow = {
        'ausleih_id': borrow_row[0],
        'mitarbeiter_id': borrow_row[1],
        'mitarbeiter_name': borrow_row[2],
        'zielort': borrow_row[3],
        'datum': borrow_row[4],
        'rueckgabe_qr': borrow_row[5],
        'status': borrow_row[6],
        'email': borrow_row[7],
        'klasse': borrow_row[8]
    }
    
    c.execute("""SELECT g.name, g.barcode, g.id, SUM(ad2.quantity) as total_quantity
                 FROM ausleih_details ad
                 JOIN geraete g ON ad.geraet_id = g.id
                 LEFT JOIN ausleih_details ad2 ON ad2.geraet_id = g.id
                 LEFT JOIN ausleihen a2 ON ad2.ausleih_id = a2.ausleih_id AND a2.status = 'ausgeliehen'
                 WHERE ad.ausleih_id = ?
                 GROUP BY g.id, g.name, g.barcode""", (ausleih_id,))
    devices = c.fetchall()
    conn.close()
    
    return render_template('borrow_success.html', title="Ausleihe erfolgreich", 
                         borrow=borrow, devices=devices, system_type=system_type, 
                         generate_qr_code=generate_qr_code)


@app.route('/regenerate_borrow_pdfs', methods=['POST'])
def regenerate_borrow_pdfs_route():
    """Route zum Regenerieren aller fehlenden Ausleih-PDFs"""
    if 'current_lager' not in session:
        return jsonify({'success': False, 'message': 'Kein Lager ausgewählt'})

    try:
        result = regenerate_missing_borrow_pdfs()
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'message': f'Fehler: {str(e)}'})


def get_all_borrows():
    """Generate a ZIP file containing all borrow PDFs from the folder"""
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))

    lager_id = session['current_lager']
    pdf_dir = ensure_borrow_pdfs_directory(lager_id)

    # Alle PDF-Dateien im Ordner finden
    pdf_files = list(pdf_dir.glob("ausleihe_*.pdf"))

    if not pdf_files:
        return send_file(
            io.BytesIO(b'Keine Ausleihe-PDFs gefunden.'),
            mimetype='text/plain',
            as_attachment=True,
            download_name='keine_pdfs.txt'
        )

    # ZIP-Datei erstellen
    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for pdf_file in pdf_files:
            # Dateinamen bereinigen für bessere Lesbarkeit
            clean_name = pdf_file.name
            zip_file.write(pdf_file, clean_name)

    zip_buffer.seek(0)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f'alle_ausleihen_{lager_id}_{timestamp}.zip'
    )


def _generate_borrow_pdf(self, borrow_info, devices):
    """Helper function to generate a single borrow PDF"""
    def get_base_name(name):
        match = re.match(r'^(.*?)\s*\d*$', name.strip())
        if match:
            base = match.group(1).strip()
            return base if base else name
        return name
    
    grouped_devices = {}
    for device in devices:
        device_id, name, barcode, modell, preis, seriennummer = device
        base_name = get_base_name(name)
        
        if base_name not in grouped_devices:
            grouped_devices[base_name] = {
                'name': base_name,
                'items': [],
                'count': 0,
                'total_price': 0,
                'model': modell or '',
                'image_path': None
            }
        
        grouped_devices[base_name]['items'].append({
            'id': device_id,
            'full_name': name,
            'barcode': barcode,
            'price': preis or 0,
            'seriennummer': seriennummer or ''
        })
        grouped_devices[base_name]['count'] += 1
        grouped_devices[base_name]['total_price'] += (preis or 0)
        
        if not grouped_devices[base_name]['image_path']:
            for ext in ['.jpg', '.png', '.jpeg']:
                img_path = f'images/{device_id}{ext}'
                if os.path.exists(img_path):
                    grouped_devices[base_name]['image_path'] = img_path
                    break
    
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=2*cm, bottomMargin=2*cm)
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('CustomTitle', parent=styles['Heading1'],
                                 fontSize=24, textColor=colors.HexColor('#1a1a1a'),
                                 spaceAfter=20, alignment=TA_LEFT)
    header_style = ParagraphStyle('Header', parent=styles['Normal'],
                                  fontSize=10, textColor=colors.HexColor('#666666'),
                                  spaceAfter=10)
    small_style = ParagraphStyle('Small', parent=styles['Normal'],
                                 fontSize=7, textColor=colors.HexColor('#666666'))
    
    elements = []
    elements.append(Paragraph(f"Ausleihe-Übersicht", title_style))
    elements.append(Spacer(1, 0.5*cm))
    
    info_text = f"""
    <b>Ausleihe-ID:</b> {borrow_info[0]}<br/>
    <b>Ausgeliehen an:</b> {borrow_info[1]}<br/>
    <b>Datum:</b> {borrow_info[2]}<br/>
    """
    if borrow_info[3]:
        info_text += f"<b>E-Mail:</b> {borrow_info[3]}<br/>"
    if borrow_info[4]:
        info_text += f"<b>Klasse:</b> {borrow_info[4]}<br/>"
    
    elements.append(Paragraph(info_text, header_style))
    elements.append(Spacer(1, 1*cm))
    
    table_data = [['', 'Artikel', 'S/N & QR', 'Menge', 'Preis/St.', 'Gesamt']]
    
    total_sum = 0
    for group_name, group_data in sorted(grouped_devices.items()):
        row = []
        
        if group_data['image_path']:
            try:
                img = RLImage(group_data['image_path'], width=2*cm, height=2*cm)
                row.append(img)
            except:
                row.append('')
        else:
            row.append('')
        
        name_text = f"<b>{group_data['name']}</b>"
        if group_data['model']:
            name_text += f"<br/><font size=8 color='#666666'>{group_data['model']}</font>"
        row.append(Paragraph(name_text, styles['Normal']))
        
        sn_qr_data = []
        for item in group_data['items']:
            sn = item['seriennummer'] if item['seriennummer'] else 'N/A'
            
            try:
                qr = qrcode.QRCode(version=1, box_size=3, border=1)
                qr.add_data(item['barcode'])
                qr.make(fit=True)
                qr_img = qr.make_image(fill_color="black", back_color="white")
                
                qr_buffer = BytesIO()
                qr_img.save(qr_buffer, format='PNG')
                qr_buffer.seek(0)
                
                qr_rl = RLImage(qr_buffer, width=1*cm, height=1*cm)
                
                mini_table = Table([[Paragraph(f"<font size=7>S/N: {sn}</font>", small_style), qr_rl]], 
                                   colWidths=[2*cm, 1.2*cm])
                mini_table.setStyle(TableStyle([
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 0),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                    ('TOPPADDING', (0, 0), (-1, -1), 1),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
                ]))
                sn_qr_data.append(mini_table)
            except:
                sn_qr_data.append(Paragraph(f"<font size=7>S/N: {sn}</font>", small_style))
        
        sn_qr_container = Table([[item] for item in sn_qr_data], colWidths=[3.2*cm])
        sn_qr_container.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 2),
            ('RIGHTPADDING', (0, 0), (-1, -1), 2),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ]))
        
        row.append(sn_qr_container)
        row.append(str(group_data['count']))
        
        avg_price = group_data['total_price'] / group_data['count'] if group_data['count'] > 0 else 0
        row.append(f"{avg_price:.2f} €")
        row.append(f"{group_data['total_price']:.2f} €")
        
        table_data.append(row)
        total_sum += group_data['total_price']
    
    table_data.append(['', Paragraph('<b>Summe</b>', styles['Normal']), '', '', '', f"{total_sum:.2f} €"])
    
    table = Table(table_data, colWidths=[2.5*cm, 6*cm, 3.5*cm, 1.5*cm, 2.5*cm, 2.5*cm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f0f0f0')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#333333')),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('ALIGN', (3, 0), (3, -1), 'CENTER'),
        ('ALIGN', (4, 0), (-1, -1), 'RIGHT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('TOPPADDING', (0, 0), (-1, 0), 12),
        ('GRID', (0, 0), (-1, -2), 0.5, colors.HexColor('#e0e0e0')),
        ('LINEABOVE', (0, -1), (-1, -1), 2, colors.HexColor('#333333')),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('TOPPADDING', (0, 1), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 8),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    
    elements.append(table)
    doc.build(elements)
    buffer.seek(0)
    
    return buffer


def ensure_borrow_pdfs_directory(lager_id):
    pdf_dir = Path(f'borrow_pdfs_{lager_id}')
    pdf_dir.mkdir(exist_ok=True)
    return pdf_dir

def generate_borrow_pdf(borrow_info, devices):
    def get_base_name(name):
        match = re.match(r'^(.*?)\s*\d*$', name.strip())
        if match:
            base = match.group(1).strip()
            return base if base else name
        return name
    
    grouped_devices = {}
    for device in devices:
        device_id, name, barcode, modell, preis, quantity = device
        base_name = get_base_name(name)
        
        if base_name not in grouped_devices:
            grouped_devices[base_name] = {
                'name': base_name,
                'items': [],
                'count': 0,
                'total_price': 0,
                'model': modell or '',
                'image_path': None
            }
        
        grouped_devices[base_name]['items'].append({
            'id': device_id,
            'full_name': name,
            'barcode': barcode,
            'price': preis or 0,
            'quantity': quantity
        })
        grouped_devices[base_name]['count'] += quantity
        grouped_devices[base_name]['total_price'] += (preis or 0) * quantity
        
        if not grouped_devices[base_name]['image_path']:
            for ext in ['.jpg', '.png', '.jpeg']:
                img_path = f'images/{device_id}{ext}'
                if os.path.exists(img_path):
                    grouped_devices[base_name]['image_path'] = img_path
                    break
    
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=2*cm, bottomMargin=2*cm)
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#1a1a1a'),
        spaceAfter=20,
        alignment=TA_LEFT
    )
    
    header_style = ParagraphStyle(
        'Header',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor('#666666'),
        spaceAfter=10
    )
    
    elements = []
    
    elements.append(Paragraph(f"Ausleihe-Übersicht", title_style))
    elements.append(Spacer(1, 0.5*cm))
    
    info_text = f"""
    <b>Ausleihe-ID:</b> {borrow_info[0]}<br/>
    <b>Ausgeliehen an:</b> {borrow_info[1]}<br/>
    <b>Datum:</b> {borrow_info[2]}<br/>
    """
    if borrow_info[3]:
        info_text += f"<b>E-Mail:</b> {borrow_info[3]}<br/>"
    if borrow_info[4]:
        info_text += f"<b>Klasse:</b> {borrow_info[4]}<br/>"
    
    elements.append(Paragraph(info_text, header_style))
    elements.append(Spacer(1, 1*cm))
    
    table_data = [['', 'Artikel', 'Menge', 'Preis/St.', 'Gesamt']]
    
    total_sum = 0
    for group_name, group_data in sorted(grouped_devices.items()):
        row = []
        
        if group_data['image_path']:
            try:
                img = RLImage(group_data['image_path'], width=2*cm, height=2*cm)
                row.append(img)
            except:
                row.append('')
        else:
            row.append('')
        
        name_text = f"<b>{group_data['name']}</b>"
        if group_data['model']:
            name_text += f"<br/><font size=8 color='#666666'>{group_data['model']}</font>"
        row.append(Paragraph(name_text, styles['Normal']))
        
        row.append(str(group_data['count']))
        
        avg_price = group_data['total_price'] / group_data['count'] if group_data['count'] > 0 else 0
        row.append(f"{avg_price:.2f} €")
        
        row.append(f"{group_data['total_price']:.2f} €")
        
        table_data.append(row)
        total_sum += group_data['total_price']
    
    table_data.append(['', Paragraph('<b>Summe</b>', styles['Normal']), '', '', f"{total_sum:.2f} €"])
    
    table = Table(table_data, colWidths=[3*cm, 8*cm, 2*cm, 3*cm, 3*cm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f0f0f0')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#333333')),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('ALIGN', (2, 0), (2, -1), 'CENTER'),
        ('ALIGN', (3, 0), (-1, -1), 'RIGHT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('TOPPADDING', (0, 0), (-1, 0), 12),
        ('GRID', (0, 0), (-1, -2), 0.5, colors.HexColor('#e0e0e0')),
        ('LINEABOVE', (0, -1), (-1, -1), 2, colors.HexColor('#333333')),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('TOPPADDING', (0, 1), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 8),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    
    elements.append(table)
    
    doc.build(elements)
    buffer.seek(0)
    
    return buffer

def regenerate_missing_borrow_pdfs():
    if 'current_lager' not in session:
        return {'success': False, 'message': 'Kein Lager ausgewählt'}
    
    lager_id = session['current_lager']
    pdf_dir = ensure_borrow_pdfs_directory(lager_id)
    
    conn = get_db_connection(lager_id)
    c = conn.cursor()
    
    # Get all borrow IDs
    c.execute("SELECT ausleih_id FROM ausleihen")
    borrow_ids = [row[0] for row in c.fetchall()]
    
    generated = 0
    for ausleih_id in borrow_ids:
        pdf_path = pdf_dir / f"ausleihe_{ausleih_id}.pdf"
        
        # Generate PDF
        c.execute("""SELECT a.ausleih_id, a.mitarbeiter_name, a.datum, a.email, a.klasse
                     FROM ausleihen a
                     WHERE a.ausleih_id = ?""", (ausleih_id,))
        borrow_info = c.fetchone()
        
        c.execute("""SELECT g.id, g.name, g.barcode, g.modell, g.preis, ad.quantity
                     FROM ausleih_details ad
                     JOIN geraete g ON ad.geraet_id = g.id
                     WHERE ad.ausleih_id = ?
                     ORDER BY g.name""", (ausleih_id,))
        devices = c.fetchall()
        
        buffer = generate_borrow_pdf(borrow_info, devices)
        
        with open(pdf_path, 'wb') as f:
            f.write(buffer.getvalue())
        
        generated += 1
    
    conn.close()
    
    return {'success': True, 'message': f'{generated} PDFs regeneriert'}

app._generate_borrow_pdf = lambda borrow_info, devices: _generate_borrow_pdf(None, borrow_info, devices)

@app.route('/borrow_pdf/<ausleih_id>')
def borrow_pdf(ausleih_id):
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    
    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    
    c.execute("""SELECT a.ausleih_id, a.mitarbeiter_name, a.datum, a.email, a.klasse
                 FROM ausleihen a
                 WHERE a.ausleih_id = ?""", (ausleih_id,))
    borrow_info = c.fetchone()
    
    if not borrow_info:
        conn.close()
        return redirect(url_for('dashboard'))
    
    c.execute("""SELECT g.id, g.name, g.barcode, g.modell, g.preis, ad.quantity
                 FROM ausleih_details ad
                 JOIN geraete g ON ad.geraet_id = g.id
                 WHERE ad.ausleih_id = ?
                 ORDER BY g.name""", (ausleih_id,))
    devices = c.fetchall()
    conn.close()
    
    def get_base_name(name):
        """Extract base name without trailing numbers"""
        match = re.match(r'^(.*?)\s*\d*$', name.strip())
        if match:
            base = match.group(1).strip()
            return base if base else name
        return name
    
    grouped_devices = {}
    for device in devices:
        device_id, name, barcode, modell, preis, quantity = device
        base_name = get_base_name(name)

        if base_name not in grouped_devices:
            grouped_devices[base_name] = {
                'name': base_name,
                'items': [],
                'count': 0,
                'total_price': 0,
                'model': modell or '',
                'image_path': None
            }

        grouped_devices[base_name]['items'].append({
            'id': device_id,
            'full_name': name,
            'barcode': barcode,
            'price': preis or 0,
            'quantity': quantity
        })
        grouped_devices[base_name]['count'] += quantity
        grouped_devices[base_name]['total_price'] += (preis or 0) * quantity

        if not grouped_devices[base_name]['image_path']:
            for ext in ['.jpg', '.png', '.jpeg']:
                img_path = f'images/{device_id}{ext}'
                if os.path.exists(img_path):
                    grouped_devices[base_name]['image_path'] = img_path
                    break
    
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=2*cm, bottomMargin=2*cm)
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#1a1a1a'),
        spaceAfter=20,
        alignment=TA_LEFT
    )
    
    header_style = ParagraphStyle(
        'Header',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor('#666666'),
        spaceAfter=10
    )
    
    elements = []
    
    elements.append(Paragraph(f"Ausleihe-Übersicht", title_style))
    elements.append(Spacer(1, 0.5*cm))
    

    info_text = f"""
    <b>Ausleihe-ID:</b> {borrow_info[0]}<br/>
    <b>Ausgeliehen an:</b> {borrow_info[1]}<br/>
    <b>Datum:</b> {borrow_info[2]}<br/>
    """
    if borrow_info[3]:
        info_text += f"<b>E-Mail:</b> {borrow_info[3]}<br/>"
    if borrow_info[4]:
        info_text += f"<b>Klasse:</b> {borrow_info[4]}<br/>"
    
    elements.append(Paragraph(info_text, header_style))
    elements.append(Spacer(1, 1*cm))
    
    table_data = [['', 'Artikel', 'Menge', 'Preis/St.', 'Gesamt']]
    
    total_sum = 0
    for group_name, group_data in sorted(grouped_devices.items()):
        row = []
        
        if group_data['image_path']:
            try:
                img = RLImage(group_data['image_path'], width=2*cm, height=2*cm)
                row.append(img)
            except:
                row.append('')
        else:
            row.append('')
        
        name_text = f"<b>{group_data['name']}</b>"
        if group_data['model']:
            name_text += f"<br/><font size=8 color='#666666'>{group_data['model']}</font>"
        row.append(Paragraph(name_text, styles['Normal']))
        
        row.append(str(group_data['count']))
        
        avg_price = group_data['total_price'] / group_data['count'] if group_data['count'] > 0 else 0
        row.append(f"{avg_price:.2f} €")

        row.append(f"{group_data['total_price']:.2f} €")
        
        table_data.append(row)
        total_sum += group_data['total_price']

    table_data.append(['', Paragraph('<b>Summe</b>', styles['Normal']), '', '', f"{total_sum:.2f} €"])

    table = Table(table_data, colWidths=[3*cm, 8*cm, 2*cm, 3*cm, 3*cm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f0f0f0')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#333333')),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('ALIGN', (2, 0), (2, -1), 'CENTER'),
        ('ALIGN', (3, 0), (-1, -1), 'RIGHT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('TOPPADDING', (0, 0), (-1, 0), 12),
        ('GRID', (0, 0), (-1, -2), 0.5, colors.HexColor('#e0e0e0')),
        ('LINEABOVE', (0, -1), (-1, -1), 2, colors.HexColor('#333333')),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('TOPPADDING', (0, 1), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 8),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    
    elements.append(table)
    
    doc.build(elements)
    buffer.seek(0)
    
    return send_file(buffer, mimetype='application/pdf', 
                    as_attachment=True, download_name=f'ausleihe_{ausleih_id}.pdf')

def update_device_status(lager_id, device_id, conn=None):
    """
    Update device status based on current borrows.
    If conn is provided, use it. Otherwise create a new connection.
    """
    should_close = False
    if conn is None:
        conn = get_db_connection(lager_id)
        should_close = True
    
    try:
        c = conn.cursor()

        # Get device info
        c.execute("SELECT name, quantity, status FROM geraete WHERE id = ?", (device_id,))
        device = c.fetchone()
        if not device:
            return

        device_name, max_quantity, current_status = device
        if current_status == 'defekt':
            return

        # Calculate total borrowed quantity
        c.execute("""SELECT COALESCE(SUM(ad.quantity), 0)
                     FROM ausleih_details ad
                     JOIN ausleihen a ON ad.ausleih_id = a.ausleih_id
                     WHERE ad.geraet_id = ? AND a.status = 'ausgeliehen'""", (device_id,))
        borrowed_quantity = c.fetchone()[0] or 0

        if borrowed_quantity > 0:
            status = 'ausgeliehen'
        elif active_event_assignment_exists(lager_id, device_id, 'device'):
            status = 'zugewiesen'
        else:
            status = 'verfügbar'

        c.execute("UPDATE geraete SET status = ? WHERE id = ?", (status, device_id))
        
        if should_close:
            conn.commit()
            
    finally:
        if should_close and conn:
            conn.close()

@app.route('/borrow', methods=['GET', 'POST'])
def borrow():
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    
    system_type = get_lager_system_type(session['current_lager'])
    
    if request.method == 'POST':
        if 'add_device' in request.form:
            barcode_inputs = request.form['barcode'].strip().split('\n')
            try:
                requested_quantity = int(request.form.get('borrow_quantity') or 1)
            except (TypeError, ValueError):
                requested_quantity = 1
            requested_quantity = max(1, requested_quantity)

            if 'borrow_list' not in session:
                session['borrow_list'] = []

            conn = get_db_connection(session['current_lager'])
            c = conn.cursor()

            added_units = 0
            error_messages = []

            for barcode_input in barcode_inputs:
                barcode = barcode_input.strip()
                if not barcode:
                    continue

                c.execute("SELECT id, name, barcode, quantity, status FROM geraete WHERE barcode = ?", (barcode,))
                device = c.fetchone()

                if device:
                    device_id, name, barcode_val, max_quantity, device_status = device
                    if device_status == 'defekt':
                        error_messages.append(f"Gerät '{name}' ist als defekt markiert und kann nicht ausgeliehen werden.")
                        continue
                    if device_status == 'zugewiesen':
                        error_messages.append(f"Gerät '{name}' ist einem Event zugewiesen und aktuell nicht ausleihbar.")
                        continue
                    # Check how many are already borrowed
                    c.execute("SELECT SUM(ad.quantity) FROM ausleih_details ad JOIN ausleihen a ON ad.ausleih_id = a.ausleih_id WHERE ad.geraet_id = ? AND a.status = 'ausgeliehen'", (device_id,))
                    already_borrowed = c.fetchone()[0] or 0
                    available = max_quantity - already_borrowed

                    if available <= 0:
                        error_messages.append(f"Gerät '{name}' ist nicht mehr verfügbar (alle {max_quantity} Exemplare ausgeliehen).")
                        continue

                    existing = next((d for d in session['borrow_list'] if d['id'] == device_id), None)
                    if existing:
                        room = available - existing['quantity']
                        if room <= 0:
                            error_messages.append(f"Maximale Anzahl für '{name}' bereits ausgewählt ({available}).")
                        else:
                            add_qty = min(requested_quantity, room)
                            existing['quantity'] += add_qty
                            existing['max_quantity'] = available
                            session.modified = True
                            added_units += add_qty
                            if add_qty < requested_quantity:
                                error_messages.append(f"Nur {add_qty} von {requested_quantity} Exemplar(en) für '{name}' verfügbar.")
                    else:
                        add_qty = min(requested_quantity, available)
                        session['borrow_list'].append({
                            'id': device_id, 'name': name, 'barcode': barcode_val,
                            'quantity': add_qty,
                            'max_quantity': available
                        })
                        session.modified = True
                        added_units += add_qty
                        if add_qty < requested_quantity:
                            error_messages.append(f"Nur {add_qty} von {requested_quantity} Exemplar(en) für '{name}' verfügbar.")
                else:
                    error_messages.append(f"Gerät mit Barcode '{barcode}' nicht gefunden.")

            conn.close()

            if added_units > 0:
                flash(f"{added_units} Gerät(e) erfolgreich zur Ausleihliste hinzugefügt.", "success")
            if error_messages:
                for msg in error_messages:
                    flash(msg, "error")
                
                
        elif 'complete_borrow' in request.form:
            if system_type == 'personal':
                borrower_name = session['user_name']
                borrower_id = session['user_id']
                email = klasse = None
            else:
                borrower_name = request.form['borrower_name']
                borrower_id = request.form.get('borrower_id', 'N/A')
                email = request.form.get('email')
                klasse = request.form.get('klasse')
            
            if session.get('borrow_list'):
                ausleih_id = generate_random_id(4)
                
                # BACKUP VOR dem Öffnen der Connection
                backup_db(session['current_lager'], 'before_borrow')
                
                conn = get_db_connection(session['current_lager'])
                c = conn.cursor()
                
                c.execute("INSERT INTO ausleihen (ausleih_id, mitarbeiter_id, mitarbeiter_name, zielort, datum, rueckgabe_qr, email, klasse) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                          (ausleih_id, borrower_id, borrower_name, 'N/A',
                           datetime.now().strftime('%Y-%m-%d %H:%M:%S'), ausleih_id, email, klasse))
                
                for device in session['borrow_list']:
                    c.execute("INSERT INTO ausleih_details (ausleih_id, geraet_id, geraet_barcode, quantity) VALUES (?, ?, ?, ?)",
                              (ausleih_id, device['id'], device['barcode'], device['quantity']))
                    update_device_status(session['current_lager'], device['id'], conn)
                
                conn.commit()
                conn.close()
                
                # BACKUP NACH dem Schließen der Connection
                backup_db(session['current_lager'], 'after_borrow')
                
                session['borrow_list'] = []
                session.modified = True
                return redirect(url_for('borrow_success', ausleih_id=ausleih_id))
    
    borrow_list = session.get('borrow_list', [])
    return render_template('borrow.html', title="Ausleihen", borrow_list=borrow_list, system_type=system_type)

@app.route('/return', methods=['GET', 'POST'])
def return_devices():
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    
    system_type = get_lager_system_type(session['current_lager'])
    
    if request.method == 'POST':
        if 'scan_qr' in request.form:
            qr_code = request.form['qr_code']
            return redirect(url_for('return_devices', qr=qr_code))
        elif 'complete_return' in request.form:
            ausleih_id = request.form['ausleih_id']
            device_ids = request.form.getlist('return_devices')
            
            # BACKUP VOR dem Öffnen der Connection
            backup_db(session['current_lager'], 'before_return')
            
            conn = get_db_connection(session['current_lager'])
            c = conn.cursor()
            
            for device_id in device_ids:
                c.execute("DELETE FROM ausleih_details WHERE ausleih_id = ? AND geraet_id = ?", (ausleih_id, device_id))
                update_device_status(session['current_lager'], device_id, conn)
            
            c.execute("SELECT COUNT(*) FROM ausleih_details WHERE ausleih_id = ?", (ausleih_id,))
            remaining = c.fetchone()[0]
            if remaining == 0:
                c.execute("UPDATE ausleihen SET status = 'zurückgegeben' WHERE ausleih_id = ?", (ausleih_id,))
            
            conn.commit()
            conn.close()
            
            # BACKUP NACH dem Schließen der Connection
            backup_db(session['current_lager'], 'after_return')
            
            return redirect(url_for('return_devices'))
    
    qr_code = request.args.get('qr')
    devices_to_return = []
    
    my_borrowed_devices = []
    if system_type == 'personal' and 'user_id' in session:
        conn = get_db_connection(session['current_lager'])
        c = conn.cursor()
        c.execute("""SELECT g.id, g.name, g.barcode, ad.ausleih_id, a.datum
                     FROM geraete g
                     JOIN ausleih_details ad ON g.id = ad.geraet_id
                     JOIN ausleihen a ON ad.ausleih_id = a.ausleih_id
                     WHERE a.mitarbeiter_id = ? AND a.status = 'ausgeliehen'
                     ORDER BY a.datum DESC""", (session['user_id'],))
        my_borrowed_devices = c.fetchall()
        conn.close()
    
    if qr_code:
        conn = get_db_connection(session['current_lager'])
        c = conn.cursor()
        
        if system_type == 'personal':
            c.execute("""SELECT g.id, g.name, g.barcode, ad.ausleih_id
                         FROM geraete g
                         JOIN ausleih_details ad ON g.id = ad.geraet_id
                         JOIN ausleihen a ON ad.ausleih_id = a.ausleih_id
                         WHERE a.rueckgabe_qr = ? AND a.status = 'ausgeliehen'""", (qr_code,))
        else:
            c.execute("""SELECT g.id, g.name, g.barcode, ad.ausleih_id
                         FROM geraete g
                         JOIN ausleih_details ad ON g.id = ad.geraet_id
                         JOIN ausleihen a ON ad.ausleih_id = a.ausleih_id
                         WHERE g.barcode = ? AND a.status = 'ausgeliehen'""", (qr_code,))
        
        devices_to_return = c.fetchall()
        conn.close()
    
    return render_template('return.html', title="Zurückgeben", 
                         devices_to_return=devices_to_return, 
                         my_borrowed_devices=my_borrowed_devices,
                         system_type=system_type)

@app.route('/inventory')
def inventory():
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    create_warehouse_db(session['current_lager'])
    
    search = request.args.get('search', '')
    status_filters = [f for f in request.args.getlist('status') if f]
    art_filters = [f for f in request.args.getlist('art') if f]
    klasse_filters = [f for f in request.args.getlist('lagerort') if f]
    sort_by = request.args.get('sort_by', 'name')
    group_by = request.args.get('group_by', 'none') 
    
    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()

    query = """SELECT g.id, g.name, g.barcode, g.lagerplatz, g.status, g.beschreibung,
                      g.seriennummer, g.modell, g.instrumentenart, g.inventarnummer, g.kaufdatum,
                      g.preis, g.quantity, g.hersteller,
                      a.mitarbeiter_name, a.zielort, a.datum, a.email, a.klasse, g.lagerort,
                      g.mietpreis, g.dmx_belegung, g.bild_mimetype
               FROM geraete g
               LEFT JOIN (
                    SELECT ad.geraet_id,
                           GROUP_CONCAT(DISTINCT a.mitarbeiter_name SEPARATOR ', ') AS mitarbeiter_name,
                           GROUP_CONCAT(DISTINCT a.zielort SEPARATOR ', ') AS zielort,
                           MIN(a.datum) AS datum,
                           GROUP_CONCAT(DISTINCT a.email SEPARATOR ', ') AS email,
                           GROUP_CONCAT(DISTINCT a.klasse SEPARATOR ', ') AS klasse
                    FROM ausleih_details ad JOIN ausleihen a ON a.ausleih_id = ad.ausleih_id
                    WHERE a.status = 'ausgeliehen'
                    GROUP BY ad.geraet_id
               ) a ON a.geraet_id = g.id
               WHERE 1=1"""
    params = []
    
    if search:
        query += " AND (g.name LIKE ? OR g.barcode LIKE ? OR g.lagerplatz LIKE ? OR g.lagerort LIKE ? OR g.seriennummer LIKE ? OR g.modell LIKE ? OR g.instrumentenart LIKE ?)"
        params.extend([f'%{search}%'] * 7)
    
    if status_filters:
        status_conditions = []
        if "verfügbar" in status_filters:
            status_conditions.append("g.status = 'verfügbar'")
        if "ausgeliehen" in status_filters:
            status_conditions.append("(g.status LIKE 'ausgeliehen%' OR g.status NOT IN ('verfügbar', 'defekt', 'zugewiesen'))")
        if "defekt" in status_filters:
            status_conditions.append("g.status = 'defekt'")
        if "zugewiesen" in status_filters:
            status_conditions.append("g.status = 'zugewiesen'")
        if status_conditions:
            query += f" AND ({' OR '.join(status_conditions)})"
    
    if art_filters:
        placeholders = ','.join('?' for _ in art_filters)
        query += f" AND g.instrumentenart IN ({placeholders})"
        params.extend(art_filters)
    
    if klasse_filters:
        placeholders = ','.join('?' for _ in klasse_filters)
        query += f" AND g.lagerort IN ({placeholders})"
        params.extend(klasse_filters)

    if sort_by in ('instrumentenart', 'category'):
        query += " ORDER BY g.instrumentenart, g.name"
    elif sort_by == 'lagerplatz':
        query += " ORDER BY g.lagerplatz, g.name"
    elif sort_by == 'status':
        query += " ORDER BY g.status, g.name"
    elif sort_by == 'model':
        query += " ORDER BY g.modell, g.name"
    else:
        query += " ORDER BY g.name"
    
    c.execute(query, params)
    devices_list = c.fetchall()
    
    grouped_devices = {}
    if group_by == 'model':
        for device in devices_list:
            model = device[7] or 'Unbekanntes Modell'
            if model not in grouped_devices:
                grouped_devices[model] = []
            grouped_devices[model].append(device)
    elif group_by == 'series':
        for device in devices_list:
            instrument = device[9] or 'Unbekanntes Instrument'
            if instrument not in grouped_devices:
                grouped_devices[instrument] = []
            grouped_devices[instrument].append(device)
    elif group_by == 'serial':
        for device in devices_list:
            serial = device[6] or ''
            first_letter = serial[0].upper() if serial else 'Unbekannt'
            if first_letter not in grouped_devices:
                grouped_devices[first_letter] = []
            grouped_devices[first_letter].append(device)
    elif group_by in ('instrument', 'category'):
        for device in devices_list:
            instrument = device[8] or 'Unkategorisiert'
            if instrument not in grouped_devices:
                grouped_devices[instrument] = []
            grouped_devices[instrument].append(device)
    elif group_by == 'status':
        for device in devices_list:
            status = STATUS_LABELS.get(device[4], device[4] or 'Verfügbar')
            if status not in grouped_devices:
                grouped_devices[status] = []
            grouped_devices[status].append(device)
    else:
        grouped_devices['Alle Geräte'] = devices_list

    c.execute("SELECT DISTINCT instrumentenart FROM geraete WHERE instrumentenart IS NOT NULL")
    instrumentenarten = [row[0] for row in c.fetchall()]
    c.execute("SELECT DISTINCT lagerort FROM geraete WHERE lagerort IS NOT NULL AND lagerort != '' ORDER BY lagerort")
    lagerorte = [row[0] for row in c.fetchall()]
    dmx_profiles = {device[0]: _decode_dmx_channel_map(device[21]) for device in devices_list if device[21]}
    conn.close()
    
    return render_template('inventory.html', title="Inventar", devices=devices_list, grouped_devices=grouped_devices,
                         search=search, status_filters=status_filters,
                         art_filters=art_filters, klasse_filters=klasse_filters,
                         sort_by=sort_by, group_by=group_by, instrumentenarten=instrumentenarten, lagerorte=lagerorte,
                         dmx_profiles=dmx_profiles)

@app.route('/borrow/update_quantity', methods=['POST'])
def update_borrow_quantity():
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))

    try:
        device_id = int(request.form.get('device_id'))
        quantity = int(request.form.get('quantity') or 1)
    except (TypeError, ValueError):
        return redirect(url_for('borrow'))
    quantity = max(1, quantity)

    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    c.execute("SELECT name, quantity FROM geraete WHERE id = ?", (device_id,))
    device = c.fetchone()
    available = None
    if device:
        name, max_quantity = device
        c.execute("SELECT SUM(ad.quantity) FROM ausleih_details ad JOIN ausleihen a ON ad.ausleih_id = a.ausleih_id WHERE ad.geraet_id = ? AND a.status = 'ausgeliehen'", (device_id,))
        already_borrowed = c.fetchone()[0] or 0
        available = max(1, max_quantity - already_borrowed)
    conn.close()

    if device:
        if quantity > available:
            quantity = available
            flash(f"Nur {available} Exemplar(e) für '{name}' verfügbar.", "error")
        for item in session.get('borrow_list', []):
            if item['id'] == device_id:
                item['quantity'] = quantity
                item['max_quantity'] = available
                session.modified = True
                break
    return redirect(url_for('borrow'))

@app.route('/remove_from_borrow/<int:device_id>')
def remove_from_borrow(device_id):
    if 'borrow_list' in session:
        session['borrow_list'] = [d for d in session['borrow_list'] if d['id'] != device_id]
        session.modified = True
    return redirect(url_for('borrow'))

@app.route('/manage_lager')
def manage_lager():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    if not is_admin():
        return redirect(url_for('dashboard'))

    conn = get_users_conn()
    c = conn.cursor()
    c.execute("SELECT id, name, created_by, access_users, system_type FROM lager ORDER BY name")
    lagers = c.fetchall()
    conn.close()

    return render_template('manage_lager.html', title="Lager verwalten", lagers=lagers)

@app.route('/edit_lager/<lager_id>', methods=['GET', 'POST'])
def edit_lager(lager_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))
    if not is_admin():
        return redirect(url_for('dashboard'))

    conn = get_users_conn()
    c = conn.cursor()
    
    if request.method == 'POST':
        name = request.form['name'].strip()
        access_users = request.form.getlist('access_users')
        if session['user_id'] not in access_users:
            access_users.append(session['user_id'])
        system_type = request.form.get('system_type', 'personal')
        c.execute("UPDATE lager SET name = ?, access_users = ?, system_type = ? WHERE id = ?",
                  (name, ','.join(access_users), system_type, lager_id))
        conn.commit()
        conn.close()
        return redirect(url_for('manage_lager'))
    
    c.execute("SELECT * FROM lager WHERE id = ?", (lager_id,))
    lager = c.fetchone()
    if not lager:
        conn.close()
        return redirect(url_for('manage_lager'))
    
    c.execute("SELECT id, name FROM users ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, name",
              (session['user_id'],))
    users = c.fetchall()
    conn.close()
    
    return render_template('edit_lager.html', title="Lager bearbeiten", lager=lager, users=users)

@app.route('/delete_lager/<lager_id>')
def delete_lager(lager_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))
    if not is_admin():
        return redirect(url_for('dashboard'))

    conn = get_users_conn()
    c = conn.cursor()
    c.execute("SELECT id FROM lager WHERE id = ?", (lager_id,))
    existing = c.fetchone()
    if existing:
        c.execute("DELETE FROM lager WHERE id = ?", (lager_id,))
        conn.commit()
    conn.close()

    if existing:
        drop_lager_db(lager_id)

    return redirect(url_for('manage_lager'))

@app.route('/export')
def export():
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    create_warehouse_db(session['current_lager'])
    
    format_type = request.args.get('format', 'csv')
    
    if request.method == 'POST' or request.is_json:
        filter_data = request.get_json() if request.is_json else {}
        search = filter_data.get('search', '')
        status_filters = filter_data.get('status', [])
        art_filters = filter_data.get('art', [])
        klasse_filters = filter_data.get('lagerort', filter_data.get('klasse', []))
    else:
        search = request.args.get('search', '')
        status_filters = [f for f in request.args.get('status', '').split(',') if f]
        art_filters = [f for f in request.args.get('art', '').split(',') if f]
        klasse_filters = [f for f in request.args.get('lagerort', request.args.get('klasse', '')).split(',') if f]
    
    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    
    query = """SELECT g.id, g.name, g.barcode, g.lagerplatz, g.status, g.beschreibung,
                      g.seriennummer, g.modell, g.instrumentenart, g.inventarnummer, g.kaufdatum,
                      g.preis, g.quantity, g.hersteller,
                      a.mitarbeiter_name, a.zielort, a.datum, a.email, a.klasse,
                      g.lagerort, g.mietpreis, g.dmx_universum, g.dmx_startadresse, g.dmx_kanaele,
                      g.dmx_belegung
               FROM geraete g
               LEFT JOIN (
                    SELECT ad.geraet_id,
                           GROUP_CONCAT(DISTINCT a.mitarbeiter_name SEPARATOR ', ') AS mitarbeiter_name,
                           GROUP_CONCAT(DISTINCT a.zielort SEPARATOR ', ') AS zielort,
                           MIN(a.datum) AS datum,
                           GROUP_CONCAT(DISTINCT a.email SEPARATOR ', ') AS email,
                           GROUP_CONCAT(DISTINCT a.klasse SEPARATOR ', ') AS klasse
                    FROM ausleih_details ad JOIN ausleihen a ON a.ausleih_id = ad.ausleih_id
                    WHERE a.status = 'ausgeliehen'
                    GROUP BY ad.geraet_id
               ) a ON a.geraet_id = g.id
               WHERE 1=1"""
    params = []
    
    if search:
        query += " AND (g.name LIKE ? OR g.barcode LIKE ? OR g.lagerplatz LIKE ? OR g.lagerort LIKE ? OR g.seriennummer LIKE ? OR g.modell LIKE ? OR g.instrumentenart LIKE ?)"
        params.extend([f'%{search}%'] * 7)
    
    if status_filters:
        status_conditions = []
        if "verfügbar" in status_filters:
            status_conditions.append("g.status = 'verfügbar'")
        if "ausgeliehen" in status_filters:
            status_conditions.append("(g.status LIKE 'ausgeliehen%' OR g.status NOT IN ('verfügbar', 'defekt', 'zugewiesen'))")
        if "defekt" in status_filters:
            status_conditions.append("g.status = 'defekt'")
        if "zugewiesen" in status_filters:
            status_conditions.append("g.status = 'zugewiesen'")
        if status_conditions:
            query += f" AND ({' OR '.join(status_conditions)})"
    
    if art_filters:
        placeholders = ','.join('?' for _ in art_filters)
        query += f" AND g.instrumentenart IN ({placeholders})"
        params.extend(art_filters)
    
    if klasse_filters:
        placeholders = ','.join('?' for _ in klasse_filters)
        query += f" AND g.lagerort IN ({placeholders})"
        params.extend(klasse_filters)
    
    query += " ORDER BY g.instrumentenart, g.name"
    c.execute(query, params)
    devices_list = c.fetchall()
    conn.close()

    if format_type in ('pdf_labels', 'word_labels'):
        try:
            selected_ids = {int(value) for value in request.args.getlist('device_ids')}
        except ValueError:
            selected_ids = set()
        if not selected_ids:
            flash('Markiere zuerst die Geräte, für die Etiketten erstellt werden sollen.', 'error')
            return redirect(url_for('inventory' if request.args.get('source') == 'inventory' else 'devices'))
        devices_list = [device for device in devices_list if device[0] in selected_ids]
    
    if format_type == 'csv':
        output = io.StringIO()
        writer = csv.writer(output, delimiter=';')
        writer.writerow(['ID', 'Name', 'Barcode', 'Lagerort / Raum', 'Lagerplatz', 'Status', 'Anzahl', 'Beschreibung', 'Seriennummer', 'Modell', 'Hersteller', 'Kategorie', 'Kaufdatum', 'Kaufpreis', 'Mietpreis', 'DMX-Kanalbelegung', 'Ausgeliehen an', 'Ausleihziel', 'Ausleihdatum', 'E-Mail', 'Klasse'])

        for device in devices_list:
            dmx_text = '; '.join(f"{item['channel']} = {item['function']}" for item in _decode_dmx_channel_map(device[24]))
            writer.writerow([device[0], device[1] or '', device[2] or '', device[19] or '', device[3] or '', device[4] or '', device[12] or 1, device[5] or '', device[6] or '', device[7] or '', device[13] or '', device[8] or '', device[10] or '', device[11] if device[11] is not None else '', device[20] if device[20] is not None else '', dmx_text, device[14] or '', device[15] or '', device[16] or '', device[17] or '', device[18] or ''])
        
        output.seek(0)
        return send_file(io.BytesIO(output.getvalue().encode('utf-8-sig')), 
                        mimetype='text/csv', as_attachment=True, download_name='export.csv')
    
    elif format_type == 'word_labels':
        # Printable Word labels: 3 columns, no page/cell border, fixed label size.
        doc = Document()
        section = doc.sections[0]
        section.page_width = Cm(21)
        section.page_height = Cm(29.7)
        section.top_margin = Cm(0)
        section.bottom_margin = Cm(0)
        section.left_margin = Cm(0)
        section.right_margin = Cm(0)

        table = doc.add_table(rows=0, cols=3)
        table.autofit = False
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table_borders = parse_xml(
            r'<w:tblBorders xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            r'<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/>'
            r'<w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/>'
            r'</w:tblBorders>'
        )
        table._tbl.tblPr.append(table_borders)
        cell_margins = parse_xml(
            r'<w:tblCellMar xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            r'<w:top w:w="57" w:type="dxa"/><w:left w:w="57" w:type="dxa"/>'
            r'<w:bottom w:w="57" w:type="dxa"/><w:right w:w="57" w:type="dxa"/>'
            r'</w:tblCellMar>'
        )
        table._tbl.tblPr.append(cell_margins)
        for column in table.columns:
            column.width = Cm(7)

        def label_text(value, limit):
            text = str(value or '').strip()
            return text if len(text) <= limit else text[:limit - 3].rstrip() + '...'

        for offset in range(0, len(devices_list), 3):
            row = table.add_row()
            row.height = Cm(4.95)
            row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
            for column in range(3):
                cell = row.cells[column]
                cell.width = Cm(7)
                cell.text = ''
                if offset + column >= len(devices_list):
                    continue
                device = devices_list[offset + column]
                paragraph = cell.paragraphs[0]
                paragraph.paragraph_format.space_before = Pt(0)
                paragraph.paragraph_format.space_after = Pt(0)
                paragraph.paragraph_format.line_spacing = 1
                name_run = paragraph.add_run(label_text(device[1] or 'Gerät', 34))
                name_run.bold = True
                name_run.font.size = Pt(9)
                details_run = paragraph.add_run(
                    f"\nID: {device[0]} | {label_text(device[2] or '', 24)}"
                    f"\nRaum: {label_text(device[19] or '-', 16)} | Platz: {label_text(device[3] or '-', 16)}"
                )
                details_run.font.size = Pt(7.5)

        buffer = BytesIO()
        doc.save(buffer)
        buffer.seek(0)
        return send_file(buffer, mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                         as_attachment=True, download_name='geraeteetiketten.docx')

    elif format_type == 'word':
        doc = Document()
        doc.add_heading('Geräte Export', 0)

        headers = ['ID', 'Name', 'Barcode', 'Lagerort / Raum', 'Lagerplatz',
                   'Kategorie', 'Modell', 'Seriennummer', 'Anzahl', 'Status']
        table = doc.add_table(rows=1, cols=len(headers))
        table.style = 'Table Grid'
        hdr_cells = table.rows[0].cells
        for i, header in enumerate(headers):
            hdr_cells[i].text = header

        for device in devices_list:
            row_cells = table.add_row().cells
            values = [device[0], device[1], device[2], device[19], device[3],
                      device[8], device[7], device[6], device[12] or 1, device[4]]
            for cell, value in zip(row_cells, values):
                cell.text = '' if value is None else str(value)

        buffer = BytesIO()
        doc.save(buffer)
        buffer.seek(0)
        return send_file(buffer, mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        as_attachment=True, download_name='export.docx')
    
    elif format_type == 'pdf_labels':
        conn_layout = get_db_connection(session['current_lager'])
        c_layout = conn_layout.cursor()
        c_layout.execute("SELECT layout_data FROM label_layouts WHERE is_default = 1 LIMIT 1")
        layout_result = c_layout.fetchone()
        
        if not layout_result:
            c_layout.execute("SELECT layout_data FROM label_layouts ORDER BY created_at DESC LIMIT 1")
            layout_result = c_layout.fetchone()
        
        conn_layout.close()
        
        if not layout_result:
            return send_file(io.BytesIO(b'Kein Label-Layout gefunden. Bitte erstellen Sie zuerst ein Label-Layout.'), 
                        mimetype='text/plain', as_attachment=True, download_name='error.txt')
        
        layout_data = json.loads(layout_result[0])

        label_width_mm = float(layout_data.get('labelWidth', 50))
        label_height_mm = float(layout_data.get('labelHeight', 30))

        mm_to_pt = 2.834645669
        label_width_pt = label_width_mm * mm_to_pt
        label_height_pt = label_height_mm * mm_to_pt

        page_width, page_height = A4
        margin = 0.5 * cm

        usable_width = page_width - 2 * margin
        usable_height = page_height - 2 * margin

        labels_per_row = max(1, int(usable_width / label_width_pt))
        labels_per_col = max(1, int(usable_height / label_height_pt))
        labels_per_page = labels_per_row * labels_per_col
        
        buffer = BytesIO()

        weight_conn = get_db_connection(session['current_lager'])
        weight_cursor = weight_conn.cursor()
        weight_cursor.execute("""SELECT cd.geraet_id, c.gewicht
                                 FROM case_devices cd
                                 JOIN cases c ON c.id = cd.case_id
                                 WHERE c.gewicht IS NOT NULL""")
        case_weights = {row[0]: row[1] for row in weight_cursor.fetchall()}
        weight_conn.close()

        def get_field_value(device, field_type):
            """Get the actual value for a field type from device data"""
            if field_type == 'gewicht':
                weight = case_weights.get(device[0])
                return f"{weight:g} kg" if weight is not None else ''
            field_mapping = {
                'name': device[1],
                'barcode': device[2],
                'location': device[3],
                'status': device[4],
                'beschreibung': device[5] or '',
                'seriennummer': device[6] or '',
                'modell': device[7] or '',
                'instrumentenart': device[8] or '',
                'inventarnummer': '',
                'lagerort': device[19] or '',
                'kaufdatum': device[10] or '',
                'preis': f"{device[11] or 0} €",
                'borrower_name': device[14] or '',
                'destination': device[15] or '',
                'borrow_date': device[16] or '',
                'email': device[17] or '',
                'class': device[18] or '',
                'borrower_id': '',
                'text': ''
            }
            return field_mapping.get(field_type, '')
        
        def create_qr_code_image(data, width_pt, height_pt):
            """
            Generate QR code image and return as ReportLab Image object.
            
            Args:
                data: The data to encode in the QR code (e.g., barcode)
                width_pt: Width in points for the QR code image
                height_pt: Height in points for the QR code image
            
            Returns:
                ReportLab Image object ready to be drawn on canvas
            """
            import qrcode
            from reportlab.platypus import Image as RLImage
            from io import BytesIO
            
            qr = qrcode.QRCode(
                version=1, 
                error_correction=qrcode.constants.ERROR_CORRECT_L,
                box_size=10,
                border=1,
            )
            
            qr.add_data(str(data))
            qr.make(fit=True)
            
            pil_img = qr.make_image(fill_color="black", back_color="white")
            
            img_buffer = BytesIO()
            pil_img.save(img_buffer, format='PNG')
            img_buffer.seek(0)

            return RLImage(img_buffer, width=width_pt, height=height_pt)
        
        def calculate_font_size(text, max_width_pt, max_height_pt, initial_font_size):
            """Calculate appropriate font size to fit text in given dimensions"""
            from reportlab.pdfbase.pdfmetrics import stringWidth
            
            font_size = initial_font_size
            min_font_size = 6
            
            while font_size >= min_font_size:
                text_width = stringWidth(str(text), 'Helvetica', font_size)
                
                if text_width <= (max_width_pt - 4):
                    return font_size
                
                font_size -= 1
            
            return min_font_size
        
        def create_single_label(device, canvas, x, y, width, height):
            """Draw a single label at the specified position"""
            
            canvas.setStrokeColor(colors.black)
            canvas.setLineWidth(0.5)
            canvas.rect(x, y, width, height)
            
            fields = layout_data.get('fields', [])
            
            px_to_pt = 0.75
            
            for field in fields:
                field_type = field.get('type', 'text')
                field_x_px = field.get('x', 0)
                field_y_px = field.get('y', 0)
                field_width_px = field.get('width', 100)
                field_height_px = field.get('height', 20)
                
                field_x_pt = x + (field_x_px * px_to_pt)
                field_y_pt = y + height - (field_y_px * px_to_pt) - (field_height_px * px_to_pt)
                field_width_pt = field_width_px * px_to_pt
                field_height_pt = field_height_px * px_to_pt
                rotation = float(field.get('rotation') or 0)
                center_x = field_x_pt + field_width_pt / 2
                center_y = field_y_pt + field_height_pt / 2
                canvas.saveState()
                if rotation:
                    canvas.translate(center_x, center_y)
                    canvas.rotate(rotation)
                    canvas.translate(-center_x, -center_y)
                
                if field_type == 'qr':
                    try:
                        qr_data = device[2]
                        qr_img = create_qr_code_image(qr_data, field_width_pt, field_height_pt)
                        qr_img.drawOn(canvas, field_x_pt, field_y_pt)
                    except Exception as e:
                        print(f"[v0] Error generating QR code: {e}")
                    
                else:
                    field_value = get_field_value(device, field_type)
                    
                    if field_type == 'text':
                        field_value = field.get('text', 'Text')
                    
                    if field_value:
                        font_size_raw = field.get('fontSize', '12px')
                        initial_font_size = 12
                        
                        if isinstance(font_size_raw, str):
                            match = re.search(r'(\d+)', font_size_raw)
                            if match:
                                initial_font_size = int(match.group(1))
                        elif isinstance(font_size_raw, (int, float)):
                            initial_font_size = int(font_size_raw)
                        
                        initial_font_size = max(6, min(initial_font_size, 24))
                        
                        font_size = calculate_font_size(str(field_value), field_width_pt, field_height_pt, initial_font_size)
                        
                        font_weight = field.get('fontWeight', 'normal')
                        font_name = 'Helvetica-Bold' if font_weight == 'bold' else 'Helvetica'
                        canvas.setFont(font_name, font_size)
                        

                        canvas.setFillColor(colors.black)
                        
                        text_align = field.get('textAlign', 'left')
                        
                        text_x = field_x_pt + 2 
                        if text_align == 'center':
                            text_x = field_x_pt + field_width_pt / 2
                        elif text_align == 'right':
                            text_x = field_x_pt + field_width_pt - 2
                        
                        text_y = field_y_pt + (field_height_pt / 2) - (font_size / 3)
                        
                        try:
                            if text_align == 'center':
                                canvas.drawCentredString(text_x, text_y, str(field_value))
                            elif text_align == 'right':
                                canvas.drawRightString(text_x, text_y, str(field_value))
                            else:
                                canvas.drawString(text_x, text_y, str(field_value))
                        except Exception as e:
                            print(f"[v0] Error drawing text: {e}")
                canvas.restoreState()
        
        from reportlab.pdfgen import canvas as pdfcanvas
        
        pdf_canvas = pdfcanvas.Canvas(buffer, pagesize=A4)
        
        device_count = 0
        for device in devices_list:
            label_index = device_count % labels_per_page
            
            row = label_index // labels_per_row
            col = label_index % labels_per_row
            
            label_x = margin + (col * label_width_pt)
            label_y = page_height - margin - ((row + 1) * label_height_pt)
            
            create_single_label(device, pdf_canvas, label_x, label_y, label_width_pt, label_height_pt)
            
            device_count += 1

            if device_count % labels_per_page == 0 and device_count < len(devices_list):
                pdf_canvas.showPage()
        
        pdf_canvas.save()
        buffer.seek(0)
        
        return send_file(buffer, mimetype='application/pdf', 
                        as_attachment=True, download_name='etiketten.pdf')
        
    return send_file(io.BytesIO(b'Not implemented'), mimetype='text/plain')

@app.route('/label-layout')
def label_layout():
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    
    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    c.execute("SELECT id, name, is_default, created_at FROM label_layouts ORDER BY is_default DESC, name")
    labels = c.fetchall()
    conn.close()
    
    return render_template('label_selection.html', title="Label Editor", labels=labels)

@app.route('/label-layout/edit/<int:label_id>')
def edit_label_layout(label_id):
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    
    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    c.execute("SELECT id, name, layout_data FROM label_layouts WHERE id = ?", (label_id,))
    label = c.fetchone()
    conn.close()
    
    if not label:
        return redirect(url_for('label_layout'))
    
    return render_template('label_layout.html', title=f"Label Editor - {label[1]}", 
                         label_id=label[0], label_name=label[1], layout_data=label[2])

@app.route('/label-layout/new')
def new_label_layout():
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    
    return render_template('label_layout.html', title="Neues Label erstellen", 
                         label_id=None, label_name="", layout_data="{}")

@app.route('/save-layout', methods=['POST'])
def save_layout():
    if 'current_lager' not in session:
        return jsonify({'error': 'No warehouse selected'}), 400
    
    data = request.json
    label_id = data.get('label_id')
    label_name = data.get('name', 'Unbenannt')
    layout_data = json.dumps(data.get('layout', {}))
    
    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    
    if label_id:
        c.execute("UPDATE label_layouts SET name = ?, layout_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                  (label_name, layout_data, label_id))
    else:
        c.execute("INSERT INTO label_layouts (name, layout_data) VALUES (?, ?)",
                  (label_name, layout_data))
        label_id = c.lastrowid
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'message': 'Layout gespeichert', 'label_id': label_id})

@app.route('/set-default-label/<int:label_id>', methods=['POST'])
def set_default_label(label_id):
    if 'current_lager' not in session:
        return jsonify({'error': 'No warehouse selected'}), 400
    
    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    
    c.execute("UPDATE label_layouts SET is_default = 0")
    c.execute("UPDATE label_layouts SET is_default = 1 WHERE id = ?", (label_id,))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'message': 'Standard-Label gesetzt'})

@app.route('/delete-label/<int:label_id>', methods=['POST'])
def delete_label(label_id):
    if 'current_lager' not in session:
        return jsonify({'error': 'No warehouse selected'}), 400
    
    conn = get_db_connection(session['current_lager'])
    c = conn.cursor()
    c.execute("DELETE FROM label_layouts WHERE id = ?", (label_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'message': 'Label gelöscht'})

@app.route('/info', methods=['GET', 'POST'])
def info():
    if 'current_lager' not in session:
        return redirect(url_for('dashboard'))
    
    device_info = None
    borrow_info = None
    searched = False
    searched_code = None
    
    if request.method == 'POST' and 'search_device' in request.form:
        qr_code = request.form['qr_code'].strip()
        searched = True
        searched_code = qr_code
        
        if qr_code:
            conn = get_db_connection(session['current_lager'])
            c = conn.cursor()
              

            c.execute("SELECT * FROM geraete WHERE barcode = ?", (qr_code,))
            device = c.fetchone()
            
            if device:
                device_info = {
                    'id': device[0],
                    'name': device[1],
                    'barcode': device[2],
                    'lagerplatz': device[3],
                    'status': device[4],
                    'beschreibung': device[5],
                    'seriennummer': device[6],
                    'modell': device[7],
                    'instrumentenart': device[8],
                    'inventarnummer': device[9],
                    'kaufdatum': device[10],
                    'preis': device[11],
                    'quantity': device[12]
                }
                
                if device[4] == 'ausgeliehen' or device[4] not in ('verfügbar', 'defekt', 'zugewiesen'):
                    c.execute("""SELECT a.* FROM ausleihen a
                                JOIN ausleih_details ad ON a.ausleih_id = ad.ausleih_id
                                WHERE ad.geraet_id = ? AND a.status = 'ausgeliehen'""", (device[0],))
                    borrow_data = c.fetchone()
                    
                    if borrow_data:
                        borrow_info = {
                            'ausleih_id': borrow_data[1],
                            'mitarbeiter_id': borrow_data[2],
                            'mitarbeiter_name': borrow_data[3],
                            'zielort': borrow_data[4],
                            'datum': borrow_data[5],
                            'rueckgabe_qr': borrow_data[6],
                            'email': borrow_data[8],
                            'klasse': borrow_data[9]
                        }
            
            conn.close()
    
    return render_template('info.html', title="Geräte-Info Scanner", 
                         device_info=device_info, borrow_info=borrow_info,
                         searched=searched, searched_code=searched_code)

@app.route('/update')
def update():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    try:
        import zipfile
        import tempfile
        import shutil

        # Vor jedem Update: Prüfe und lösche verschachteltes templates-Verzeichnis
        nested_templates = os.path.join('templates', 'templates')
        if os.path.exists(nested_templates):
            shutil.rmtree(nested_templates)

        response = requests.get("https://github.com/Matti-Krebelder/DMS/archive/refs/heads/main.zip")
        if response.status_code == 200:
            with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
                tmp_file.write(response.content)
                tmp_file_path = tmp_file.name

            with zipfile.ZipFile(tmp_file_path, 'r') as zip_ref:
                app_py_info = zip_ref.getinfo('DMS-main/main.py')
                if app_py_info:
                    zip_ref.extract(app_py_info, '.')
                    if os.path.exists('DMS-main/main.py'):
                        shutil.move('DMS-main/main.py', 'main.py')

                for file_info in zip_ref.filelist:
                    if file_info.filename.startswith('DMS-main/templates/'):
                        relative_path = file_info.filename.replace('DMS-main/', '', 1)
                        if relative_path:
                            zip_ref.extract(file_info, '.')
                            extracted_path = file_info.filename
                            target_path = relative_path
                            if os.path.exists(extracted_path):
                                shutil.move(extracted_path, target_path)

            os.unlink(tmp_file_path)

            if os.path.exists('DMS-main'):
                shutil.rmtree('DMS-main')

            nested_templates = os.path.join('templates', 'templates')
            if os.path.exists(nested_templates):
                shutil.rmtree(nested_templates)

        else:
            return "Fehler beim Aktualisieren", 500

        return redirect(url_for('dashboard'))
    except Exception as e:
        return f"Fehler beim Update: {str(e)}", 500

@app.route('/verwaltung', methods=['GET'])
def verwaltung():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    if not is_admin():
        return redirect(url_for('dashboard'))

    conn = get_users_conn()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM users")
    user_count = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM user_groups")
    group_count = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM event_requests WHERE status = 'new'")
    request_count = c.fetchone()[0]
    conn.close()
    return render_template('verwaltung.html', title="Verwaltung",
                           user_count=user_count, group_count=group_count,
                           request_count=request_count)


@app.route('/verwaltung/system')
def verwaltung_system():
    if 'user_id' not in session or not is_admin():
        return redirect(url_for('login'))
    return render_template('verwaltung_system.html', title="Gesamtsystem übertragen")


@app.route('/verwaltung/benutzer')
def verwaltung_benutzer():
    if 'user_id' not in session or not is_admin():
        return redirect(url_for('login'))
    return render_template('verwaltung_benutzer.html', title="Benutzer",
                           users=get_admin_users())


@app.route('/verwaltung/gruppen')
def verwaltung_gruppen():
    if 'user_id' not in session or not is_admin():
        return redirect(url_for('login'))
    return render_template('verwaltung_gruppen.html', title="Benutzergruppen",
                           users=get_admin_users(), groups=get_user_groups())


@app.route('/verwaltung/event-anfragen', methods=['GET', 'POST'])
def verwaltung_event_requests():
    if 'user_id' not in session or not is_admin():
        return redirect(url_for('login'))

    if request.method == 'POST':
        enabled = request.form.get('enabled') == '1'
        set_setting('event_requests_enabled', '1' if enabled else '0')
        flash('Event-Anfragen wurden aktiviert.' if enabled else 'Event-Anfragen wurden deaktiviert.')
        return redirect(url_for('verwaltung_event_requests'))

    conn = get_users_conn()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM event_requests WHERE status = 'new'")
    request_count = c.fetchone()[0]
    conn.close()
    return render_template('verwaltung_event_requests.html', title="Event-Anfragen",
                           enabled=event_requests_enabled(), request_count=request_count)


@app.route('/verwaltung/system-export', methods=['GET'])
def admin_system_export():
    if 'user_id' not in session or not is_admin():
        return redirect(url_for('login'))
    try:
        archive = _build_system_backup()
    except Exception as exc:
        app.logger.exception('Systemexport fehlgeschlagen')
        flash(f'Der Systemexport ist fehlgeschlagen: {exc}', 'error')
        return redirect(url_for('verwaltung_system'))
    filename = f"dms-systemexport-{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"
    return send_file(archive, mimetype='application/zip', as_attachment=True, download_name=filename)


@app.route('/verwaltung/system-import', methods=['POST'])
def admin_system_import():
    if 'user_id' not in session or not is_admin():
        return redirect(url_for('login'))
    if request.form.get('confirm_text', '').strip() != 'ERSETZEN':
        flash('Import abgebrochen: Bitte zur Bestätigung ERSETZEN eingeben.', 'error')
        return redirect(url_for('verwaltung_system'))

    upload = request.files.get('backup_file')
    if not upload or not upload.filename:
        flash('Bitte eine DMS-Systemexport-ZIP-Datei auswählen.', 'error')
        return redirect(url_for('verwaltung_system'))
    archive_bytes = upload.stream.read(SYSTEM_BACKUP_MAX_BYTES + 1)
    if len(archive_bytes) > SYSTEM_BACKUP_MAX_BYTES:
        flash('Die Sicherungsdatei ist größer als 512 MB.', 'error')
        return redirect(url_for('verwaltung_system'))

    try:
        with zipfile.ZipFile(BytesIO(archive_bytes), 'r') as archive:
            member = archive.getinfo('backup.json')
            if member.file_size > SYSTEM_BACKUP_MAX_BYTES:
                raise ValueError('Die entpackte Sicherungsdatei ist größer als 512 MB.')
            payload = json.loads(archive.read(member).decode('utf-8'))
        _validate_system_backup(payload)
    except Exception as exc:
        flash(f'Die Sicherungsdatei ist ungültig: {exc}', 'error')
        return redirect(url_for('verwaltung_system'))

    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup_dir = Path(app.root_path) / 'system_backups'
    backup_path = backup_dir / f'vor-import-{timestamp}.zip'
    try:
        backup_dir.mkdir(parents=True, exist_ok=True)
        current_backup = _build_system_backup()
        backup_path.write_bytes(current_backup.getvalue())
    except Exception as exc:
        app.logger.exception('Sicherheitsbackup vor Import fehlgeschlagen')
        flash(f'Import nicht ausgeführt: Das Sicherheitsbackup konnte nicht erstellt werden ({exc}).', 'error')
        return redirect(url_for('verwaltung_system'))

    try:
        imported_lager_ids = set(payload['warehouses'])
        existing_conn = get_users_conn()
        existing_cursor = existing_conn.cursor()
        existing_cursor.execute('SELECT id FROM lager')
        existing_lager_ids = {row[0] for row in existing_cursor.fetchall()}
        existing_conn.close()

        for lager_id, tables in payload['warehouses'].items():
            create_warehouse_db(lager_id)
            _replace_database_contents(get_db_connection(lager_id), tables)

        # Restore shared accounts, warehouse metadata, events and their relations last.
        _replace_database_contents(get_users_conn(), payload['users_database'])

        for lager_id in existing_lager_ids - imported_lager_ids:
            drop_lager_db(lager_id)

        flash(f'Import abgeschlossen. Vorherige Datenbanksicherung: {backup_path}', 'success')
    except Exception as exc:
        app.logger.exception('Systemimport fehlgeschlagen')
        flash(f'Import fehlgeschlagen. Die vorherige Sicherung liegt unter {backup_path}. Fehler: {exc}', 'error')
    return redirect(url_for('verwaltung_system'))


@app.route('/verwaltung/benutzer', methods=['POST'])
def create_user():
    if 'user_id' not in session or not is_admin():
        return redirect(url_for('login'))

    user_id = (request.form.get('user_id') or '').strip()
    name = (request.form.get('name') or '').strip()
    password = request.form.get('password') or ''
    role = request.form.get('role') or 'user'
    if role not in ('user', 'admin'):
        role = 'user'

    if user_id and name and password:
        conn = get_users_conn()
        c = conn.cursor()
        try:
            c.execute("INSERT INTO users (id, name, password, role, created_by) VALUES (?, ?, ?, ?, ?)",
                      (user_id, name, generate_password_hash(password), role, session.get('user_id')))
            conn.commit()
            flash(f'Benutzer {user_id} wurde angelegt.')
        except Exception:
            conn.rollback()
            flash(f'Benutzer {user_id} existiert bereits oder konnte nicht angelegt werden.')
        finally:
            conn.close()
    else:
        flash('Benutzer-ID, Name und Passwort sind erforderlich.')

    return redirect(url_for('verwaltung_benutzer'))


@app.route('/verwaltung/benutzer/<user_id>/name', methods=['POST'])
def update_user_name(user_id):
    if 'user_id' not in session or not is_admin():
        return redirect(url_for('login'))

    name = (request.form.get('name') or '').strip()
    if not name:
        flash('Vor- und Nachname sind erforderlich.')
        return redirect(url_for('verwaltung_benutzer'))

    conn = get_users_conn()
    c = conn.cursor()
    c.execute("UPDATE users SET name = ? WHERE id = ?", (name, user_id))
    conn.commit()
    conn.close()
    flash(f'Name von {user_id} wurde aktualisiert.')
    return redirect(url_for('verwaltung_benutzer'))


@app.route('/verwaltung/benutzer/<user_id>/passwort', methods=['POST'])
def reset_user_password(user_id):
    if 'user_id' not in session or not is_admin():
        return redirect(url_for('login'))

    password = request.form.get('password') or ''
    if password:
        conn = get_users_conn()
        c = conn.cursor()
        c.execute("UPDATE users SET password = ? WHERE id = ?",
                  (generate_password_hash(password), user_id))
        conn.commit()
        conn.close()
        flash(f'Passwort für {user_id} wurde aktualisiert.')
    return redirect(url_for('verwaltung_benutzer'))


@app.route('/verwaltung/benutzer/<user_id>/rolle', methods=['POST'])
def set_user_role(user_id):
    if 'user_id' not in session or not is_admin():
        return redirect(url_for('login'))

    role = request.form.get('role') or 'user'
    if role not in ('user', 'admin'):
        role = 'user'
    if user_id != session.get('user_id'):
        conn = get_users_conn()
        c = conn.cursor()
        c.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
        conn.commit()
        conn.close()
        flash(f'Rolle von {user_id} wurde geändert.')
    return redirect(url_for('verwaltung_benutzer'))


@app.route('/verwaltung/benutzer/<user_id>/loeschen', methods=['POST'])
def delete_user(user_id):
    if 'user_id' not in session or not is_admin():
        return redirect(url_for('login'))

    if user_id not in (session.get('user_id'), 'TMS-T'):
        conn = get_users_conn()
        c = conn.cursor()
        c.execute("DELETE FROM user_group_members WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        conn.close()
        flash(f'Benutzer {user_id} wurde gelöscht.')
    return redirect(url_for('verwaltung_benutzer'))


@app.route('/verwaltung/gruppen', methods=['POST'])
def create_user_group():
    if 'user_id' not in session or not is_admin():
        return redirect(url_for('login'))

    name = (request.form.get('name') or '').strip()
    member_ids = list(dict.fromkeys(request.form.getlist('member_ids')))
    if not name:
        flash('Ein Gruppenname ist erforderlich.')
        return redirect(url_for('verwaltung_gruppen'))

    conn = get_users_conn()
    c = conn.cursor()
    try:
        c.execute("INSERT INTO user_groups (name, created_by) VALUES (?, ?)",
                  (name, session.get('user_id')))
        group_id = c.lastrowid
        for member_id in member_ids:
            c.execute("INSERT IGNORE INTO user_group_members (group_id, user_id) VALUES (?, ?)",
                      (group_id, member_id))
        conn.commit()
        flash(f'Gruppe „{name}" wurde angelegt.')
    except Exception:
        conn.rollback()
        flash(f'Gruppe „{name}" existiert bereits oder konnte nicht angelegt werden.')
    finally:
        conn.close()
    return redirect(url_for('verwaltung_gruppen'))


@app.route('/verwaltung/gruppen/<int:group_id>/bearbeiten', methods=['POST'])
def edit_user_group(group_id):
    if 'user_id' not in session or not is_admin():
        return redirect(url_for('login'))

    name = (request.form.get('name') or '').strip()
    member_ids = list(dict.fromkeys(request.form.getlist('member_ids')))
    if not name:
        flash('Ein Gruppenname ist erforderlich.')
        return redirect(url_for('verwaltung_gruppen'))

    conn = get_users_conn()
    c = conn.cursor()
    try:
        c.execute("UPDATE user_groups SET name = ? WHERE id = ?", (name, group_id))
        c.execute("DELETE FROM user_group_members WHERE group_id = ?", (group_id,))
        for member_id in member_ids:
            c.execute("INSERT IGNORE INTO user_group_members (group_id, user_id) VALUES (?, ?)",
                      (group_id, member_id))
        conn.commit()
        flash(f'Gruppe „{name}" wurde aktualisiert.')
    except Exception:
        conn.rollback()
        flash(f'Gruppe „{name}" konnte nicht gespeichert werden.')
    finally:
        conn.close()
    return redirect(url_for('verwaltung_gruppen'))


@app.route('/verwaltung/gruppen/<int:group_id>/loeschen', methods=['POST'])
def delete_user_group(group_id):
    if 'user_id' not in session or not is_admin():
        return redirect(url_for('login'))

    conn = get_users_conn()
    c = conn.cursor()
    c.execute("DELETE FROM user_group_members WHERE group_id = ?", (group_id,))
    c.execute("DELETE FROM user_groups WHERE id = ?", (group_id,))
    conn.commit()
    conn.close()
    flash('Gruppe wurde gelöscht.')
    return redirect(url_for('verwaltung_gruppen'))


@app.route('/passwort', methods=['GET', 'POST'])
def change_password():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    if request.method == 'POST':
        current_password = request.form.get('current_password') or ''
        new_password = request.form.get('new_password') or ''
        confirm_password = request.form.get('confirm_password') or ''

        conn = get_users_conn()
        c = conn.cursor()
        c.execute("SELECT password FROM users WHERE id = ?", (session['user_id'],))
        row = c.fetchone()
        if not row:
            conn.close()
            flash('Benutzer wurde nicht gefunden.')
            return redirect(url_for('login'))

        stored = row[0]
        valid = True
        if stored:
            try:
                valid = check_password_hash(stored, current_password)
            except Exception:
                valid = False

        if not valid:
            conn.close()
            flash('Das aktuelle Passwort ist nicht korrekt.')
            return redirect(url_for('change_password'))
        if not new_password:
            conn.close()
            flash('Bitte gib ein neues Passwort ein.')
            return redirect(url_for('change_password'))
        if new_password != confirm_password:
            conn.close()
            flash('Die neuen Passwörter stimmen nicht überein.')
            return redirect(url_for('change_password'))

        c.execute("UPDATE users SET password = ? WHERE id = ?",
                  (generate_password_hash(new_password), session['user_id']))
        conn.commit()
        conn.close()
        flash('Dein Passwort wurde geändert.')
        return redirect(url_for('dashboard'))

    return render_template('password_change.html', title="Passwort ändern")


@app.route('/logoutdms')
def logout():
    session.clear()
    return redirect(url_for('login'))

if __name__ == '__main__':
    init_user_db()
    check_version()
    app.run(debug=True, host='0.0.0.0', port=5000)

from werkzeug.middleware.proxy_fix import ProxyFix

BASE_PATH = (os.environ.get('BASE_PATH') or '/lagersystem').rstrip('/')
if not BASE_PATH.startswith('/'):
    BASE_PATH = '/' + BASE_PATH
app.config['BASE_PATH'] = BASE_PATH
app.config['APPLICATION_ROOT'] = BASE_PATH or '/'
app.config['SESSION_COOKIE_PATH'] = BASE_PATH or '/'


class PrefixMiddleware:
    def __init__(self, app, prefix=BASE_PATH):
        self.app = app
        self.prefix = prefix.rstrip('/')
    def __call__(self, environ, start_response):
        forwarded = environ.get('HTTP_X_FORWARDED_PREFIX') or environ.get('HTTP_X_SCRIPT_NAME')
        script_name = (forwarded or self.prefix).rstrip('/')
        if script_name:
            environ['SCRIPT_NAME'] = script_name
            path_info = environ.get('PATH_INFO', '')
            if path_info == script_name:
                environ['PATH_INFO'] = '/'
            elif path_info.startswith(script_name + '/'):
                environ['PATH_INFO'] = path_info[len(script_name):] or '/'
        return self.app(environ, start_response)


app.wsgi_app = PrefixMiddleware(app.wsgi_app, prefix=BASE_PATH)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)


@app.context_processor
def inject_base_path():
    return dict(base_path=BASE_PATH)
