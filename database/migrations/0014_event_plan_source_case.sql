-- Herkunft materialisierter Koffer-Assets nachvollziehen, damit beim Entfernen
-- eines Koffers nur die daraus stammenden (noch nicht ausgegebenen) Planungen
-- wieder zurückgenommen werden.
ALTER TABLE event_devices
  ADD COLUMN IF NOT EXISTS source_case_id INT UNSIGNED NULL AFTER note,
  ADD INDEX IF NOT EXISTS idx_event_devices_source_case (source_case_id);

ALTER TABLE event_items
  ADD COLUMN IF NOT EXISTS source_case_id INT UNSIGNED NULL AFTER note,
  ADD INDEX IF NOT EXISTS idx_event_items_source_case (source_case_id);
