PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE alineaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  
  
  
  article_id INTEGER,
  result_id INTEGER,
  
  
  
  equipo TEXT NOT NULL,
  
  
  
  escudo_url TEXT,
  
  
  
  formacion TEXT NOT NULL DEFAULT '4-3-3',
  
  
  
  
  
  
  jugadores TEXT NOT NULL DEFAULT '[]',
  
  
  autor_id INTEGER,
  autor_nombre TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE CASCADE,
  FOREIGN KEY (autor_id) REFERENCES users(id)
);
CREATE TABLE porras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reader_id INTEGER NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
  resultado_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  goles_local_predicho INTEGER NOT NULL,
  goles_visitante_predicho INTEGER NOT NULL,
  
  
  
  
  
  
  
  puntos_obtenidos INTEGER,
  
  
  
  
  
  resultado_acierto TEXT NOT NULL DEFAULT 'pendiente',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  
  
  UNIQUE (reader_id, resultado_id)
);
DELETE FROM sqlite_sequence;
CREATE INDEX idx_alineaciones_article ON alineaciones(article_id);
CREATE INDEX idx_alineaciones_result ON alineaciones(result_id);
CREATE INDEX idx_porras_reader ON porras(reader_id);
CREATE INDEX idx_porras_resultado ON porras(resultado_id);