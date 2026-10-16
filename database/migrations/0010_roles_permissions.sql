-- ===========================================================================
-- 0010 – Rollen & Rechte (RBAC)
-- ===========================================================================
-- Erweitert die Rolle-Tabelle um Anzeige-Metadaten und führt einen
-- Rechte-Katalog (permissions) sowie die Zuordnung Rolle↔Recht
-- (role_permissions) ein.
--
-- Die Standardrollen Administrator und Techniker sind systemweit geschützt
-- (is_system = 1) und werden mit den passenden Rechten vorbelegt.
-- ===========================================================================

-- roles um Anzeige-Metadaten erweitern
ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS label VARCHAR(64) NOT NULL DEFAULT '' AFTER name,
  ADD COLUMN IF NOT EXISTS description VARCHAR(255) NULL AFTER label,
  ADD COLUMN IF NOT EXISTS is_system TINYINT(1) NOT NULL DEFAULT 0 AFTER description,
  ADD COLUMN IF NOT EXISTS sort SMALLINT NOT NULL DEFAULT 0 AFTER is_system;

-- Bestehende Rollen mit sinnvollen Standardwerten befüllen
UPDATE roles SET label = 'Administrator', description = 'Vollzugriff auf alle Bereiche',
  is_system = 1, sort = 1 WHERE name = 'administrator' AND (label = '' OR label IS NULL);
UPDATE roles SET label = 'Techniker', description = 'Operative Rechte ohne Administration',
  is_system = 1, sort = 2 WHERE name = 'techniker' AND (label = '' OR label IS NULL);

-- AUTO_INCREMENT für neu anzulegende Rollen
ALTER TABLE roles MODIFY COLUMN id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT;

-- Rechte-Katalog
CREATE TABLE IF NOT EXISTS permissions (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  label VARCHAR(96) NOT NULL,
  category VARCHAR(48) NOT NULL,
  sort SMALLINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO permissions (code, label, category, sort) VALUES
  ('tasks.view', 'Aufgaben ansehen', 'Team & Organisation', 10),
  ('tasks.manage', 'Aufgaben verwalten', 'Team & Organisation', 11),
  ('board.view', 'Pinnwand ansehen', 'Team & Organisation', 20),
  ('board.manage', 'Pinnwand verwalten', 'Team & Organisation', 21),
  ('calendar.view', 'Kalender ansehen', 'Team & Organisation', 30),
  ('calendar.manage', 'Termine verwalten', 'Team & Organisation', 31),
  ('messages.use', 'Nachrichten nutzen', 'Team & Organisation', 40),
  ('inventory.view', 'Inventar ansehen', 'Technik', 110),
  ('inventory.manage', 'Inventar verwalten', 'Technik', 111),
  ('locations.view', 'Lagerorte ansehen', 'Technik', 120),
  ('locations.manage', 'Lagerorte verwalten', 'Technik', 121),
  ('cases.view', 'Cases ansehen', 'Technik', 130),
  ('cases.manage', 'Cases verwalten', 'Technik', 131),
  ('events.view', 'Events ansehen', 'Technik', 140),
  ('events.manage', 'Events verwalten', 'Technik', 141),
  ('labels.print', 'Labels drucken', 'Technik', 150),
  ('maintenance.view', 'Wartung ansehen', 'Technik', 160),
  ('maintenance.manage', 'Wartung verwalten', 'Technik', 161),
  ('documents.manage', 'Dokumente verwalten', 'Technik', 170),
  ('purchases.manage', 'Bestellungen verwalten', 'Technik', 180),
  ('suppliers.manage', 'Lieferanten verwalten', 'Technik', 190),
  ('checkouts.manage', 'Ausgaben & Rückgaben verwalten', 'Technik', 200),
  ('users.manage', 'Benutzer verwalten', 'Administration', 310),
  ('roles.manage', 'Rollen & Rechte verwalten', 'Administration', 320),
  ('settings.manage', 'Einstellungen verwalten', 'Administration', 330),
  ('categories.manage', 'Kategorien verwalten', 'Administration', 340),
  ('audit.view', 'Audit-Log ansehen', 'Administration', 350)
  ON DUPLICATE KEY UPDATE
    label = VALUES(label),
    category = VALUES(category),
    sort = VALUES(sort);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TINYINT UNSIGNED NOT NULL,
  permission_id SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'administrator';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
  WHERE r.name = 'techniker'
    AND p.code NOT IN ('users.manage', 'roles.manage', 'settings.manage', 'categories.manage', 'audit.view');
