-- Welche Rollen darf der Inhaber einer Rolle an Benutzer vergeben?
-- Ein Benutzer mit dem Recht `users.manage` darf nur die Rollen zuweisen, die
-- bei seinen eigenen Rollen als "vergebbar" hinterlegt sind. Ohne Eintrag darf
-- die Rolle nichts vergeben. Die Administratorrolle umgeht die Prüfung und darf
-- immer alle Rollen vergeben.

CREATE TABLE IF NOT EXISTS role_assignable_roles (
  role_id TINYINT UNSIGNED NOT NULL,
  assignable_role_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, assignable_role_id),
  CONSTRAINT fk_rar_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rar_assignable FOREIGN KEY (assignable_role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Standard: jede Rolle darf alle Rollen außer der Administratorrolle vergeben.
INSERT IGNORE INTO role_assignable_roles (role_id, assignable_role_id)
  SELECT r.id, a.id FROM roles r CROSS JOIN roles a WHERE a.name <> 'administrator';

-- Die Administratorrolle darf zusätzlich auch die Administratorrolle vergeben.
INSERT IGNORE INTO role_assignable_roles (role_id, assignable_role_id)
  SELECT r.id, a.id FROM roles r CROSS JOIN roles a WHERE r.name = 'administrator';
