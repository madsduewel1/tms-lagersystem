-- ===========================================================================
-- Migration 0006: Cases (Koffer-System)
-- Ein Case bündelt mehrere Assets und wird in einem Lagerort gelagert.
-- Events können Cases planen (event_cases).
-- ===========================================================================

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