// SQLite connection + migration runner, shared by every module that needs
// persistence (Phases 3-5). Migrations live in lib/migrations/*.sql, run
// once each in filename order, and are tracked in schema_migrations so
// restarts don't re-apply them.
//
// CAVEAT: on Railway, the file at DB_PATH does not survive a redeploy
// unless a Volume is attached and DB_PATH points inside its mount path.
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "app.db");
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    applied_at INTEGER NOT NULL
  )
`);

function runMigrations() {
  const applied = new Set(db.prepare("SELECT filename FROM schema_migrations").all().map((r) => r.filename));
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)").run(file, Date.now());
    })();
    console.log(`[db] applied migration ${file}`);
  }
}

runMigrations();

module.exports = db;
