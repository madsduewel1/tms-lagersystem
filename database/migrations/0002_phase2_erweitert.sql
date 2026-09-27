-- Migration 0002 – Phase-2-Erweiterungen nach Funktions-/UI-Spezifikation
-- Für bereits bestehende Datenbanken (Fachstruktur, Gerätefelder, Status, Zustand)

-- 1) Lagerplätze: Hierarchie (Lager -> Regal -> Fach)
ALTER TABLE storage_locations
  ADD COLUMN parent_id INT UNSIGNED NULL AFTER id,
  ADD CONSTRAINT fk_storage_locations_parent
    FOREIGN KEY (parent_id) REFERENCES storage_locations(id) ON DELETE RESTRICT;

-- 2) Artikel/Geräte: technische und kaufmännische Felder
ALTER TABLE items
  ADD COLUMN manufacturer VARCHAR(160) NULL AFTER name,
  ADD COLUMN model VARCHAR(160) NULL AFTER manufacturer,
  ADD COLUMN purchase_price DECIMAL(10,2) NULL AFTER serial_number,
  ADD COLUMN purchase_date DATE NULL AFTER purchase_price,
  ADD COLUMN technical_data TEXT NULL AFTER purchase_date,
  ADD COLUMN connections TEXT NULL AFTER technical_data,
  ADD COLUMN weight VARCHAR(32) NULL AFTER connections,
  ADD COLUMN performance VARCHAR(64) NULL AFTER performance2,
  ADD COLUMN warranty VARCHAR(64) NULL AFTER performance,
  ADD COLUMN supplier VARCHAR(160) NULL AFTER warranty;

-- Korrektur voriger Zeile (sauber sortiert)
DROP TABLE IF EXISTS items_new;
CREATE TABLE items_new LIKE items;
ALTER TABLE items_new DROP COLUMN supplier, DROP COLUMN warranty, DROP COLUMN performance,
  DROP COLUMN weight, DROP COLUMN connections, DROP COLUMN technical_data,
  DROP COLUMN purchase_date, DROP COLUMN purchase_price, DROP COLUMN model,
  DROP COLUMN manufacturer;
ALTER TABLE items_new
  ADD COLUMN manufacturer VARCHAR(160) NULL AFTER name,
  ADD COLUMN model VARCHAR(160) NULL AFTER manufacturer,
  ADD COLUMN purchase_price DECIMAL(10,2) NULL AFTER serial_number,
  ADD COLUMN purchase_date DATE NULL AFTER purchase_price,
  ADD COLUMN technical_data TEXT NULL AFTER purchase_date,
  ADD COLUMN connections TEXT NULL AFTER technical_data,
  ADD COLUMN weight VARCHAR(32) NULL AFTER connections,
  ADD COLUMN performance VARCHAR(64) NULL AFTER weight,
  ADD COLUMN warranty VARCHAR(64) NULL AFTER performance,
  ADD COLUMN supplier VARCHAR(160) NULL AFTER warranty;
INSERT INTO items_new SELECT * FROM items;
RENAME TABLE items TO items_old, items_new TO items;
DROP TABLE items_old;

-- 3) Geräte-Status: AUSGELAGERT statt EINGESETZT
UPDATE items SET status = 'ausgelagert' WHERE status = 'eingesetzt';
ALTER TABLE items
  MODIFY status ENUM('verfuegbar','ausgelagert','defekt','wartung','ausgemustert')
    NOT NULL DEFAULT 'verfuegbar';

-- 4) Lagerbewegungen: Zustand bei Rückgabe
ALTER TABLE stock_movements
  ADD COLUMN condition ENUM('normal','beschaedigt','defekt') NULL AFTER type;

-- 5) Kategorieseed nach Spezifikation (Audio, Licht, Video, Strom, Kabel, Netzwerk, Cases, Stative, Zubehör, Sonstiges)
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
  ('Sonstiges', 'Sonstiges Material')
  ON DUPLICATE KEY UPDATE description = VALUES(description);