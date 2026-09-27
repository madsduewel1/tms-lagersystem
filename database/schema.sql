-- ===========================================================================
-- TMS Event-Technik Lager – vollständiges Datenbankschema
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Benutzer, Rollen, Einstellungen, Audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  name VARCHAR(32) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles (id, name) VALUES (1, 'administrator'), (2, 'techniker')
  ON DUPLICATE KEY UPDATE name = VALUES(name);

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(160) NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_id TINYINT UNSIGNED NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(64) NOT NULL UNIQUE,
  setting_value TEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (setting_key, setting_value) VALUES
  ('system_name', 'TMS Event-Technik Lager'),
  ('inventory_prefix', 'TMS-'),
  ('warehouse_name', 'Techniklager'),
  ('logo_url', ''),
  ('support_email', ''),
  ('label_format', '62x29'),
  ('qr_base_url', '')
  ON DUPLICATE KEY UPDATE setting_key = setting_key;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(64) NULL,
  target_id VARCHAR(64) NULL,
  details JSON NULL,
  ip VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_user (user_id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Kategorien & Lieferanten
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS categories (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL UNIQUE,
  description VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS suppliers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  contact_name VARCHAR(160) NULL,
  email VARCHAR(160) NULL,
  phone VARCHAR(64) NULL,
  website VARCHAR(200) NULL,
  customer_number VARCHAR(64) NULL,
  address VARCHAR(512) NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_suppliers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Lagerstruktur: Lager -> Regal -> Fach (Baum über parent_id)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS storage_locations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  parent_id INT UNSIGNED NULL,
  type ENUM('lager','regal','fach') NOT NULL DEFAULT 'regal',
  name VARCHAR(160) NOT NULL,
  code VARCHAR(32) NULL,
  description VARCHAR(512) NULL,
  qr_token VARCHAR(64) NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_storage_parent (parent_id),
  INDEX idx_storage_type (type),
  CONSTRAINT fk_storage_parent FOREIGN KEY (parent_id) REFERENCES storage_locations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Events & Eventplanung
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS events (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  location VARCHAR(200) NULL,
  contact_name VARCHAR(160) NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  status ENUM('entwurf','geplant','vorbereitung','aktiv','abgeschlossen','abgesagt') NOT NULL DEFAULT 'entwurf',
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_events_status (status),
  INDEX idx_events_start (starts_at),
  CONSTRAINT fk_events_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- weitere Personen, die ein Event mitbearbeiten dürfen (Ersteller + Admin immer)
CREATE TABLE IF NOT EXISTS event_editors (
  event_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (event_id, user_id),
  CONSTRAINT fk_event_editors_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_editors_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Geräte & Artikel (kind = 'geraet' | 'artikel')
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('geraet','artikel') NOT NULL DEFAULT 'artikel',
  name VARCHAR(160) NOT NULL,
  manufacturer VARCHAR(160) NULL,
  model VARCHAR(160) NULL,
  article_number VARCHAR(160) NULL,
  category_id INT UNSIGNED NULL,
  storage_location_id INT UNSIGNED NULL,
  quantity INT NOT NULL DEFAULT 0,
  unit VARCHAR(16) NULL DEFAULT 'Stk',
  min_stock INT NULL,
  inventory_number VARCHAR(64) NULL,
  serial_number VARCHAR(160) NULL,
  status ENUM('verfuegbar','ausgelagert','defekt','wartung','verloren','ausser_betrieb') NOT NULL DEFAULT 'verfuegbar',
  `condition` ENUM('neu','gut','gebraucht','defekt') NULL,
  purchase_price DECIMAL(10,2) NULL,
  purchase_date DATE NULL,
  current_value DECIMAL(10,2) NULL,
  warranty DATE NULL,
  supplier_id INT UNSIGNED NULL,
  current_event_id INT UNSIGNED NULL,
  description TEXT NULL,
  technical_data TEXT NULL,
  manual_url VARCHAR(500) NULL,
  notes TEXT NULL,
  qr_token VARCHAR(64) NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_items_inventory_number (inventory_number),
  INDEX idx_items_kind (kind),
  INDEX idx_items_name (name),
  INDEX idx_items_category (category_id),
  INDEX idx_items_location (storage_location_id),
  INDEX idx_items_status (status),
  INDEX idx_items_supplier (supplier_id),
  INDEX idx_items_event (current_event_id),
  CONSTRAINT fk_items_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_items_location FOREIGN KEY (storage_location_id) REFERENCES storage_locations(id) ON DELETE SET NULL,
  CONSTRAINT fk_items_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT fk_items_event FOREIGN KEY (current_event_id) REFERENCES events(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Lagerbewegungen
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  item_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  event_id INT UNSIGNED NULL,
  type ENUM('zugang','abgang','korrektur','rueckgabe','ausgabe') NOT NULL,
  quantity INT NOT NULL,
  before_quantity INT NOT NULL,
  after_quantity INT NOT NULL,
  `condition` ENUM('neu','gut','gebraucht','defekt') NULL,
  note VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_stock_movements_item (item_id),
  INDEX idx_stock_movements_created (created_at),
  INDEX idx_stock_movements_event (event_id),
  CONSTRAINT fk_stock_movements_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  CONSTRAINT fk_stock_movements_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_stock_movements_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- geplante Mengen (Artikel)
CREATE TABLE IF NOT EXISTS event_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL,
  item_id INT UNSIGNED NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  status ENUM('geplant','ausgegeben','zurueck') NOT NULL DEFAULT 'geplant',
  note VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event_items (event_id, item_id),
  CONSTRAINT fk_event_items_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_items_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- geplante Einzelgeräte
CREATE TABLE IF NOT EXISTS event_devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL,
  item_id INT UNSIGNED NOT NULL,
  status ENUM('geplant','ausgegeben','zurueck') NOT NULL DEFAULT 'geplant',
  quantity INT NOT NULL DEFAULT 1,
  note VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event_devices (event_id, item_id),
  CONSTRAINT fk_event_devices_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_devices_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Cases (Koffer): bündeln mehrere Assets, liegen in einem Lagerort,
-- und können in Events eingeplant werden
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cases (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  code VARCHAR(32) NULL,
  description VARCHAR(512) NULL,
  storage_location_id INT UNSIGNED NULL,
  status ENUM('verfuegbar','ausgelagert','defekt','ausser_betrieb') NOT NULL DEFAULT 'verfuegbar',
  qr_token VARCHAR(64) NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cases_location (storage_location_id),
  CONSTRAINT fk_cases_location FOREIGN KEY (storage_location_id) REFERENCES storage_locations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS case_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id INT UNSIGNED NOT NULL,
  item_id INT UNSIGNED NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  note VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_case_items (case_id, item_id),
  INDEX idx_case_items_item (item_id),
  CONSTRAINT fk_case_items_case FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_case_items_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_cases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL,
  case_id INT UNSIGNED NOT NULL,
  status ENUM('geplant','ausgegeben','zurueck') NOT NULL DEFAULT 'geplant',
  note VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event_cases (event_id, case_id),
  INDEX idx_event_cases_case (case_id),
  CONSTRAINT fk_event_cases_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_cases_case FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Ausgabe & Rückgabe
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS checkouts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  item_id INT UNSIGNED NOT NULL,
  event_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NULL,
  quantity INT NOT NULL DEFAULT 1,
  checked_out_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at DATETIME NULL,
  returned_at DATETIME NULL,
  status ENUM('offen','zurueck') NOT NULL DEFAULT 'offen',
  condition_out ENUM('neu','gut','gebraucht','defekt') NULL,
  condition_in ENUM('neu','gut','gebraucht','defekt') NULL,
  note VARCHAR(512) NULL,
  INDEX idx_checkouts_item (item_id),
  INDEX idx_checkouts_event (event_id),
  INDEX idx_checkouts_status (status),
  CONSTRAINT fk_checkouts_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  CONSTRAINT fk_checkouts_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT fk_checkouts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS returns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  checkout_id BIGINT UNSIGNED NULL,
  item_id INT UNSIGNED NOT NULL,
  event_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NULL,
  quantity INT NOT NULL DEFAULT 1,
  returned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `condition` ENUM('neu','gut','gebraucht','defekt') NULL,
  note VARCHAR(512) NULL,
  INDEX idx_returns_item (item_id),
  CONSTRAINT fk_returns_checkout FOREIGN KEY (checkout_id) REFERENCES checkouts(id) ON DELETE SET NULL,
  CONSTRAINT fk_returns_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  CONSTRAINT fk_returns_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT fk_returns_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Wartung & Defekte
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS maintenance (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  item_id INT UNSIGNED NOT NULL,
  problem VARCHAR(200) NOT NULL,
  description TEXT NULL,
  reported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reported_by INT UNSIGNED NULL,
  technician_id INT UNSIGNED NULL,
  status ENUM('gemeldet','pruefung','reparatur','ersatzteil','repariert','nicht_reparierbar') NOT NULL DEFAULT 'gemeldet',
  repair TEXT NULL,
  cost DECIMAL(10,2) NULL,
  note VARCHAR(512) NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_maintenance_item (item_id),
  INDEX idx_maintenance_status (status),
  CONSTRAINT fk_maintenance_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  CONSTRAINT fk_maintenance_reported_by FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_maintenance_technician FOREIGN KEY (technician_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS maintenance_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  maintenance_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  status VARCHAR(32) NULL,
  note VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_maintenance_logs_maint (maintenance_id),
  CONSTRAINT fk_maintenance_logs_maint FOREIGN KEY (maintenance_id) REFERENCES maintenance(id) ON DELETE CASCADE,
  CONSTRAINT fk_maintenance_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Beschaffung / Anschaffungen
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS purchases (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  item_id INT UNSIGNED NULL,
  quantity INT NOT NULL DEFAULT 1,
  supplier_id INT UNSIGNED NULL,
  planned_price DECIMAL(10,2) NULL,
  actual_price DECIMAL(10,2) NULL,
  status ENUM('geplant','bestellt','geliefert','abgeschlossen','storniert') NOT NULL DEFAULT 'geplant',
  ordered_at DATETIME NULL,
  delivered_at DATETIME NULL,
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_purchases_status (status),
  CONSTRAINT fk_purchases_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL,
  CONSTRAINT fk_purchases_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT fk_purchases_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Dokumente (Metadaten; Dateien liegen im uploads-Verzeichnis)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  doc_type ENUM('rechnung','kaufbeleg','anleitung','datenblatt','garantie','reparatur','sonstiges') NOT NULL DEFAULT 'sonstiges',
  item_id INT UNSIGNED NULL,
  stored_name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(128) NULL,
  size_bytes BIGINT UNSIGNED NULL,
  notes VARCHAR(512) NULL,
  uploaded_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_documents_item (item_id),
  CONSTRAINT fk_documents_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  CONSTRAINT fk_documents_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Inventur
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inventory_sessions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  area_location_id INT UNSIGNED NULL,
  status ENUM('offen','abgeschlossen') NOT NULL DEFAULT 'offen',
  created_by INT UNSIGNED NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  notes VARCHAR(512) NULL,
  CONSTRAINT fk_inventory_sessions_area FOREIGN KEY (area_location_id) REFERENCES storage_locations(id) ON DELETE SET NULL,
  CONSTRAINT fk_inventory_sessions_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_counts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id INT UNSIGNED NOT NULL,
  item_id INT UNSIGNED NOT NULL,
  expected_quantity INT NOT NULL DEFAULT 0,
  counted_quantity INT NULL,
  difference INT NULL,
  counted_at DATETIME NULL,
  counted_by INT UNSIGNED NULL,
  UNIQUE KEY uq_inventory_counts (session_id, item_id),
  INDEX idx_inventory_counts_session (session_id),
  CONSTRAINT fk_inventory_counts_session FOREIGN KEY (session_id) REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_inventory_counts_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  CONSTRAINT fk_inventory_counts_user FOREIGN KEY (counted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Grunddaten
-- ---------------------------------------------------------------------------

INSERT INTO categories (name, description) VALUES
  ('Audio', 'Tontechnik: Mikrofone, PA, Mischpulte'),
  ('Licht', 'Beleuchtungstechnik, Scheinwerfer, Lichtsteuerung'),
  ('Video', 'Projektoren, Displays, Videotechnik'),
  ('Strom', 'Stromverteilung, Verteilungen'),
  ('Kabel', 'Kabel und Verbinder'),
  ('Netzwerk', 'Netzwerktechnik und Switches'),
  ('Cases', 'Flugcases und Transportbehälter'),
  ('Stative', 'Stative, Ständer und Montage'),
  ('Zubehör', 'Zubehör und Kleinteile'),
  ('Verbrauchsmaterial', 'Verbrauchsmaterial wie Batterien, Kabelbinder'),
  ('Sonstiges', 'Sonstiges Material')
  ON DUPLICATE KEY UPDATE description = VALUES(description);

-- Keine Beispiel-Lagerplätze, Items, Events oder Benutzer: eine frische
-- Installation startet komplett leer (Lagerstruktur wird im Inventar angelegt).
