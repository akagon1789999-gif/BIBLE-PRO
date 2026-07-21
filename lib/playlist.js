const db = require("./db");

const TYPES = ["scripture", "song", "custom_text", "background"];

const insertStmt = db.prepare(
  "INSERT INTO playlist_items (position, type, label, payload, created_at) VALUES (@position, @type, @label, @payload, @createdAt)"
);
const listStmt = db.prepare("SELECT * FROM playlist_items ORDER BY position ASC");
const getStmt = db.prepare("SELECT * FROM playlist_items WHERE id = ?");
const deleteStmt = db.prepare("DELETE FROM playlist_items WHERE id = ?");
const maxPositionStmt = db.prepare("SELECT COALESCE(MAX(position), -1) AS maxPosition FROM playlist_items");
const updatePositionStmt = db.prepare("UPDATE playlist_items SET position = ? WHERE id = ?");
const deleteAllStmt = db.prepare("DELETE FROM playlist_items");

const listSavedStmt = db.prepare("SELECT id, name, items, updated_at FROM saved_playlists ORDER BY updated_at DESC");
const getSavedStmt = db.prepare("SELECT * FROM saved_playlists WHERE id = ?");
const getSavedByNameStmt = db.prepare("SELECT id FROM saved_playlists WHERE name = ?");
const insertSavedStmt = db.prepare(
  "INSERT INTO saved_playlists (name, items, created_at, updated_at) VALUES (@name, @items, @now, @now)"
);
const updateSavedStmt = db.prepare("UPDATE saved_playlists SET items = @items, updated_at = @now WHERE id = @id");
const deleteSavedStmt = db.prepare("DELETE FROM saved_playlists WHERE id = ?");

function rowToItem(row) {
  return { id: row.id, position: row.position, type: row.type, label: row.label, payload: JSON.parse(row.payload) };
}

function listItems() {
  return listStmt.all().map(rowToItem);
}

function getItem(id) {
  const row = getStmt.get(id);
  return row ? rowToItem(row) : null;
}

function addItem({ type, label, payload }) {
  if (!TYPES.includes(type)) throw new Error(`Invalid playlist item type: ${type}`);
  if (!label || !label.trim()) throw new Error("Item label is required.");
  const position = maxPositionStmt.get().maxPosition + 1;
  const info = insertStmt.run({ position, type, label: label.trim(), payload: JSON.stringify(payload || {}), createdAt: Date.now() });
  return getItem(info.lastInsertRowid);
}

function deleteItem(id) {
  return deleteStmt.run(id).changes > 0;
}

// Reassigns positions 0..n-1 to match orderedIds. Only ids that already
// exist in the table are applied — a stale/unknown id in the list is
// silently ignored rather than corrupting the rest of the ordering.
function reorder(orderedIds) {
  const existingIds = new Set(listItems().map((i) => i.id));
  db.transaction(() => {
    let position = 0;
    for (const id of orderedIds) {
      if (!existingIds.has(id)) continue;
      updatePositionStmt.run(position, id);
      position += 1;
    }
  })();
  return listItems();
}

function savedPlaylistSummary(row) {
  return { id: row.id, name: row.name, itemCount: JSON.parse(row.items).length, updatedAt: row.updated_at };
}

function listSavedPlaylists() {
  return listSavedStmt.all().map(savedPlaylistSummary);
}

// Snapshots the current live playlist (type/label/payload, in order) under
// `name` — overwrites in place if that name already exists, so re-saving
// under the same name updates it rather than erroring or duplicating.
function savePlaylistAs(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("Playlist name is required.");
  const items = listItems().map(({ type, label, payload }) => ({ type, label, payload }));
  const now = Date.now();
  const existing = getSavedByNameStmt.get(trimmed);
  if (existing) {
    updateSavedStmt.run({ id: existing.id, items: JSON.stringify(items), now });
    return savedPlaylistSummary(getSavedStmt.get(existing.id));
  }
  const info = insertSavedStmt.run({ name: trimmed, items: JSON.stringify(items), now });
  return savedPlaylistSummary(getSavedStmt.get(info.lastInsertRowid));
}

// Replaces the entire live playlist with a saved snapshot's items — fresh
// ids/positions, not a merge with whatever's currently live.
function loadSavedPlaylist(id) {
  const row = getSavedStmt.get(id);
  if (!row) return null;
  const items = JSON.parse(row.items);
  db.transaction(() => {
    deleteAllStmt.run();
    let position = 0;
    for (const item of items) {
      insertStmt.run({
        position,
        type: item.type,
        label: item.label,
        payload: JSON.stringify(item.payload || {}),
        createdAt: Date.now(),
      });
      position += 1;
    }
  })();
  return listItems();
}

function deleteSavedPlaylist(id) {
  return deleteSavedStmt.run(id).changes > 0;
}

module.exports = {
  TYPES,
  listItems,
  getItem,
  addItem,
  deleteItem,
  reorder,
  listSavedPlaylists,
  savePlaylistAs,
  loadSavedPlaylist,
  deleteSavedPlaylist,
};
