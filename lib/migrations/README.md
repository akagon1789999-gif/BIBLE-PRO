# Migrations

Plain `.sql` files, applied once each in filename order and tracked in the
`schema_migrations` table (see [../db.js](../db.js)).

Naming convention: `NNNN_description.sql`, zero-padded and monotonically
increasing (`0001_create_media_assets.sql`, `0002_add_media_tags.sql`, ...).
Each file should be self-contained — it runs inside its own transaction, so
group related `CREATE TABLE` / `ALTER TABLE` statements that must succeed or
fail together into one file.

Never edit or delete an already-applied migration; add a new one instead.
