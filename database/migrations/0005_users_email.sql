-- ===========================================================================
-- Migration 0005 – E-Mail-Spalte für Benutzer (Login per Benutzername oder E-Mail)
-- Idempotent.
-- ===========================================================================

SET @has_email := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'email'
);

SET @legacy_sql := IF(@has_email = 0,
  'ALTER TABLE users ADD COLUMN email VARCHAR(160) NULL UNIQUE AFTER username',
  'DO 0'
);

PREPARE legacy_stmt FROM @legacy_sql;
EXECUTE legacy_stmt;
DEALLOCATE PREPARE legacy_stmt;