const fs = require("fs");
const path = require("path");
const db = require("./db");

const CATEGORIES = ["background", "motion", "logo", "lower_third"];

const insertStmt = db.prepare(`
  INSERT INTO media_assets (category, kind, filename, original_name, label, url, created_at)
  VALUES (@category, @kind, @filename, @originalName, @label, @url, @createdAt)
`);
const getStmt = db.prepare("SELECT * FROM media_assets WHERE id = ?");
const deleteStmt = db.prepare("DELETE FROM media_assets WHERE id = ?");

function assertCategory(category) {
  if (!CATEGORIES.includes(category)) throw new Error(`Invalid media category: ${category}`);
}

function toAsset(row) {
  return { id: `db:${row.id}`, category: row.category, kind: row.kind, label: row.label, url: row.url, deletable: true };
}

function createAsset({ category, kind, filename, originalName, url, label }) {
  assertCategory(category);
  const info = insertStmt.run({
    category,
    kind,
    filename,
    originalName,
    label: label || originalName,
    url,
    createdAt: Date.now(),
  });
  return toAsset(getStmt.get(info.lastInsertRowid));
}

// Escapes SQLite LIKE wildcards so a search term like "50%" or "a_b" is
// matched literally rather than as a pattern.
function escapeLike(str) {
  return str.replace(/[\\%_]/g, "\\$&");
}

function listAssets(category, search) {
  assertCategory(category);
  let query = "SELECT * FROM media_assets WHERE category = ?";
  const params = [category];
  if (search) {
    query += " AND label LIKE ? ESCAPE '\\'";
    params.push(`%${escapeLike(search)}%`);
  }
  query += " ORDER BY created_at DESC";
  return db.prepare(query).all(...params).map(toAsset);
}

// id is either "db:<n>" (a real row, deletable) or an opaque id from a
// non-database source (e.g. folder-scanned motion videos) that this module
// knows nothing about and can't delete.
function deleteAsset(id, uploadsDir) {
  const match = /^db:(\d+)$/.exec(id);
  if (!match) return false;
  const row = getStmt.get(Number(match[1]));
  if (!row) return false;
  deleteStmt.run(row.id);
  try {
    fs.unlinkSync(path.join(uploadsDir, row.filename));
  } catch {}
  return true;
}

module.exports = { CATEGORIES, createAsset, listAssets, deleteAsset };
