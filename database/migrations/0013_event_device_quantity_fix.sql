-- Ein Einzelgerät (kind='geraet') ist einzigartig und kann pro Event nur genau
-- einmal eingeplant werden. Die Spalte `event_devices.quantity` war fälschlich
-- mehrfach belegbar (bis 9999), wodurch sich mehr Geräte planen ließen, als
-- tatsächlich vorhanden sind. Ab jetzt wird immer 1 gespeichert.
UPDATE event_devices SET quantity = 1 WHERE quantity <> 1;
