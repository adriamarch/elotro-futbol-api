-- Posa el correu a l'usuari xian_fabril (#102)
UPDATE users
SET email = 'xianmigueztroncoso@gmail.com'
WHERE id = 102 AND username = 'xian_fabril';

-- Comprovació
SELECT id, username, nombre, email, primer_acceso_at FROM users WHERE id = 102;
