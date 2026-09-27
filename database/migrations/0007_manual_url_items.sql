-- ===========================================================================
-- Migration 0007 – Anleitungs-Link (Thomann) an Geräten/Artikeln
-- Idempotent.
-- ===========================================================================

SET @has_manual_url := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'items' AND column_name = 'manual_url'
);

SET @legacy_sql := IF(@has_manual_url = 0,
  'ALTER TABLE items ADD COLUMN manual_url VARCHAR(500) NULL AFTER technical_data',
  'DO 0'
);

PREPARE legacy_stmt FROM @legacy_sql;
EXECUTE legacy_stmt;
DEALLOCATE PREPARE legacy_stmt;