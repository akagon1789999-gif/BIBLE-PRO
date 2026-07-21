CREATE TABLE playlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('scripture', 'song', 'custom_text', 'background')),
  label TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_playlist_items_position ON playlist_items(position);
