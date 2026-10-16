-- Mehrere Rollen pro Benutzer (n:m).
-- Bisher hatte jeder Benutzer genau eine Rolle über users.role_id. Diese
-- Einschränkung wird durch die Zuordnungstabelle user_roles ersetzt; die
-- bestehenden Einzelrollen werden übernommen.

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT UNSIGNED NOT NULL,
  role_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bestehende Rollenzuordnung übernehmen.
INSERT IGNORE INTO user_roles (user_id, role_id)
  SELECT u.id, u.role_id FROM users u;

ALTER TABLE users DROP FOREIGN KEY fk_users_role;
ALTER TABLE users DROP COLUMN role_id;
