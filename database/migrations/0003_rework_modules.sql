-- ===========================================================================
-- Migration 0003 – Umbau auf das vollständige Modul-Datenmodell
--
-- Entfernt die alte, unvollständige Phase-2-Struktur, damit database/schema.sql
-- anschließend die neuen Tabellen (items mit kind, storage_locations-Baum,
-- checkouts, returns, maintenance, documents, purchases, inventory_*) anlegt.
--
-- Die Migration ist idempotent: Sie prüft, ob die items-Tabelle bereits das
-- neue Feld `kind` besitzt. Falls ja, passiert nichts (keine Datenverluste).
-- ===========================================================================

SET @has_kind := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'items' AND column_name = 'kind'
);

SET @legacy_sql := IF(@has_kind = 0,
  'SET FOREIGN_KEY_CHECKS=0;
   DROP TABLE IF EXISTS inventory_counts, inventory_items, inventories, inventory_sessions,
     returns, checkouts, event_devices, event_items, maintenance_logs, maintenance,
     documents, purchases, stock_movements, items, events, storage_locations, categories, suppliers;
   SET FOREIGN_KEY_CHECKS=1;',
  'DO 0'
);

PREPARE legacy_stmt FROM @legacy_sql;
EXECUTE legacy_stmt;
DEALLOCATE PREPARE legacy_stmt;

-- Alte Inventurtabellen (Namensschema vor dem Umbau) entfernen, falls vorhanden.
DROP TABLE IF EXISTS inventory_items;
DROP TABLE IF EXISTS inventories;
