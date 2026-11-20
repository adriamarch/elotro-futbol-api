-- Repara horas ya guardadas rotas por el corrector de formato ("16: 30" -> "16:30").
-- El fallo del corrector ya está corregido; esto arregla lo que se guardó antes.
-- Solo toca horas con minutos 00/15/30/45 entre las 7 y las 23 h, en el contenido de
-- los artículos (no toca marcadores "2: 1" ni decimales "1, 85": esos no se pueden
-- distinguir con seguridad desde SQL). Es idempotente: ejecutarla dos veces no cambia nada más.
--   D1: wrangler d1 execute elotrofutbol --remote --file=worker/migracion_reparar_horas_corrector.sql
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '7: 00', '7:00'), '7: 15', '7:15'), '7: 30', '7:30'), '7: 45', '7:45') WHERE contenido LIKE '%7: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '8: 00', '8:00'), '8: 15', '8:15'), '8: 30', '8:30'), '8: 45', '8:45') WHERE contenido LIKE '%8: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '9: 00', '9:00'), '9: 15', '9:15'), '9: 30', '9:30'), '9: 45', '9:45') WHERE contenido LIKE '%9: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '10: 00', '10:00'), '10: 15', '10:15'), '10: 30', '10:30'), '10: 45', '10:45') WHERE contenido LIKE '%10: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '11: 00', '11:00'), '11: 15', '11:15'), '11: 30', '11:30'), '11: 45', '11:45') WHERE contenido LIKE '%11: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '12: 00', '12:00'), '12: 15', '12:15'), '12: 30', '12:30'), '12: 45', '12:45') WHERE contenido LIKE '%12: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '13: 00', '13:00'), '13: 15', '13:15'), '13: 30', '13:30'), '13: 45', '13:45') WHERE contenido LIKE '%13: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '14: 00', '14:00'), '14: 15', '14:15'), '14: 30', '14:30'), '14: 45', '14:45') WHERE contenido LIKE '%14: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '15: 00', '15:00'), '15: 15', '15:15'), '15: 30', '15:30'), '15: 45', '15:45') WHERE contenido LIKE '%15: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '16: 00', '16:00'), '16: 15', '16:15'), '16: 30', '16:30'), '16: 45', '16:45') WHERE contenido LIKE '%16: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '17: 00', '17:00'), '17: 15', '17:15'), '17: 30', '17:30'), '17: 45', '17:45') WHERE contenido LIKE '%17: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '18: 00', '18:00'), '18: 15', '18:15'), '18: 30', '18:30'), '18: 45', '18:45') WHERE contenido LIKE '%18: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '19: 00', '19:00'), '19: 15', '19:15'), '19: 30', '19:30'), '19: 45', '19:45') WHERE contenido LIKE '%19: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '20: 00', '20:00'), '20: 15', '20:15'), '20: 30', '20:30'), '20: 45', '20:45') WHERE contenido LIKE '%20: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '21: 00', '21:00'), '21: 15', '21:15'), '21: 30', '21:30'), '21: 45', '21:45') WHERE contenido LIKE '%21: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '22: 00', '22:00'), '22: 15', '22:15'), '22: 30', '22:30'), '22: 45', '22:45') WHERE contenido LIKE '%22: %';
UPDATE articles SET contenido = REPLACE(REPLACE(REPLACE(REPLACE(contenido, '23: 00', '23:00'), '23: 15', '23:15'), '23: 30', '23:30'), '23: 45', '23:45') WHERE contenido LIKE '%23: %';
