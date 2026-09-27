-- ===========================================================================
-- Migration 0008 – Event-Rechte, Stückzahlen an Geräten, Passwort-Erzwingung
-- Idempotent. Wird von update.sh automatisch angewendet.
-- ===========================================================================

-- 1) Wer zusätzlich zum Ersteller + Admin ein Event bearbeiten darf
CREATE TABLE IF NOT EXISTS event_editors (
  event_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (event_id, user_id),
  CONSTRAINT fk_event_editors_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_editors_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Stückzahl an geplanten Einzelgeräten (Bedarf, nicht Anzahl Einträge)
SET @has_device_qty := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'event_devices' AND column_name = 'quantity'
);

SET @device_qty_sql := IF(@has_device_qty = 0,
  'ALTER TABLE event_devices ADD COLUMN quantity INT NOT NULL DEFAULT 1 AFTER status',
  'DO 0'
);

PREPARE device_qty_stmt FROM @device_qty_sql;
EXECUTE device_qty_stmt;
DEALLOCATE PREPARE device_qty_stmt;

-- 3) Kennzeichen: Benutzer muss beim nächsten Login das Passwort ändern
SET @has_must_change := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'must_change_password'
);

SET @must_change_sql := IF(@has_must_change = 0,
  'ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER active',
  'DO 0'
);

PREPARE must_change_stmt FROM @must_change_sql;
EXECUTE must_change_stmt;
DEALLOCATE PREPARE must_change_stmt;