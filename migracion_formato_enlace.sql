ALTER TABLE articles ADD COLUMN usa_url_bonita INTEGER NOT NULL DEFAULT 1;
UPDATE articles SET usa_url_bonita = 0;
