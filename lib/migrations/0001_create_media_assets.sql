CREATE TABLE media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK (category IN ('background', 'motion', 'logo', 'lower_third')),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_media_assets_category ON media_assets(category);
