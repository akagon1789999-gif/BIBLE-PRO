// Accumulates a record of the current service for export: every finalized
// transcript chunk, and every verse actually approved/shown on the
// projector (not every suggestion — just what the congregation saw).
// In-memory and global for the server's lifetime; restart the server to
// start a fresh log for a new service.
let transcript = [];
let verses = [];
let startedAt = null;

function touch() {
  if (!startedAt) startedAt = Date.now();
}

function recordTranscript(text) {
  touch();
  transcript.push({ text, timestamp: Date.now() });
}

function recordVerse(entry) {
  touch();
  verses.push({ ...entry, timestamp: Date.now() });
}

function getLog() {
  return { transcript, verses, startedAt };
}

module.exports = { recordTranscript, recordVerse, getLog };
