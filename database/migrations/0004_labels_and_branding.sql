-- ===========================================================================
-- Migration 0004 – Label-Druck, QR-Basis-URL und Support-Kontakt
--
-- Ergänzt die neuen Einstellungen (idempotent).
-- ===========================================================================

INSERT INTO settings (setting_key, setting_value) VALUES
  ('support_email', ''),
  ('label_format', '62x29'),
  ('qr_base_url', '')
  ON DUPLICATE KEY UPDATE setting_key = setting_key;