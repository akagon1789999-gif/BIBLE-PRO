const db = require("./db");

const insertSongStmt = db.prepare("INSERT INTO songs (title, artist, created_at) VALUES (@title, @artist, @createdAt)");
const insertSectionStmt = db.prepare(
  "INSERT INTO song_sections (song_id, position, label, content) VALUES (@songId, @position, @label, @content)"
);
const getSongStmt = db.prepare("SELECT * FROM songs WHERE id = ?");
const getSectionsStmt = db.prepare("SELECT * FROM song_sections WHERE song_id = ? ORDER BY position ASC");
const deleteSongStmt = db.prepare("DELETE FROM songs WHERE id = ?");

function escapeLike(str) {
  return str.replace(/[\\%_]/g, "\\$&");
}

function getSong(id) {
  const song = getSongStmt.get(id);
  if (!song) return null;
  return { ...song, sections: getSectionsStmt.all(id) };
}

function listSongs(search) {
  let query = `
    SELECT s.id, s.title, s.artist, s.created_at AS createdAt, COUNT(sec.id) AS sectionCount
    FROM songs s LEFT JOIN song_sections sec ON sec.song_id = s.id
  `;
  const params = [];
  if (search) {
    query += " WHERE s.title LIKE ? ESCAPE '\\' OR s.artist LIKE ? ESCAPE '\\'";
    const like = `%${escapeLike(search)}%`;
    params.push(like, like);
  }
  query += " GROUP BY s.id ORDER BY s.title ASC";
  return db.prepare(query).all(...params);
}

function createSong({ title, artist, sections }) {
  if (!title || !title.trim()) throw new Error("Song title is required.");
  const cleanSections = (Array.isArray(sections) ? sections : [])
    .map((s) => ({ label: (s.label || "").trim(), content: (s.content || "").trim() }))
    .filter((s) => s.label && s.content);
  if (!cleanSections.length) throw new Error("At least one section (with a label and lyrics) is required.");

  const songId = db.transaction(() => {
    const info = insertSongStmt.run({ title: title.trim(), artist: artist ? artist.trim() : null, createdAt: Date.now() });
    cleanSections.forEach((s, i) => {
      insertSectionStmt.run({ songId: info.lastInsertRowid, position: i, label: s.label, content: s.content });
    });
    return info.lastInsertRowid;
  })();

  return getSong(songId);
}

function deleteSong(id) {
  return deleteSongStmt.run(id).changes > 0;
}

module.exports = { getSong, listSongs, createSong, deleteSong };
