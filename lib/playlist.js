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

module.exports = { TYPES, listItems, getItem, addItem, deleteItem, reorder };
