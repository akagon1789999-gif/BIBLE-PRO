function formatTimestamp(ts) {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildTranscriptText({ transcript, verses, startedAt }) {
  const lines = [];
  lines.push("SERMON EXPORT — Projector Bible");
  if (startedAt) lines.push(`Service started: ${formatTimestamp(startedAt)}`);
  lines.push(`Exported: ${formatTimestamp(Date.now())}`);
  lines.push("");

  if (verses.length) {
    lines.push("SCRIPTURE REFERENCES SHOWN");
    lines.push("=".repeat(40));
    for (const v of verses) {
      lines.push(`${v.ref} (${v.translation})  —  ${formatTimestamp(v.timestamp)}`);
      if (v.text) lines.push(`"${v.text}"`);
      lines.push("");
    }
  }

  lines.push("FULL TRANSCRIPT");
  lines.push("=".repeat(40));
  if (!transcript.length) {
    lines.push("(no transcript recorded this session)");
  } else {
    for (const t of transcript) {
      lines.push(`[${formatTimestamp(t.timestamp)}] ${t.text}`);
    }
  }

  return lines.join("\n");
}

function buildTranscriptPdf(doc, { transcript, verses, startedAt }) {
  doc.fontSize(20).font("Helvetica-Bold").text("Sermon Export", { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica").fillColor("#555555");
  if (startedAt) doc.text(`Service started: ${formatTimestamp(startedAt)}`, { align: "center" });
  doc.text(`Exported: ${formatTimestamp(Date.now())}`, { align: "center" });
  doc.fillColor("#000000");
  doc.moveDown(1.5);

  if (verses.length) {
    doc.fontSize(15).font("Helvetica-Bold").text("Scripture References Shown");
    doc.moveDown(0.5);
    for (const v of verses) {
      doc.fontSize(12).font("Helvetica-Bold").fillColor("#000000").text(`${v.ref} (${v.translation})`);
      doc.fontSize(9).font("Helvetica").fillColor("#666666").text(formatTimestamp(v.timestamp));
      if (v.text) {
        doc.fontSize(11).font("Helvetica-Oblique").fillColor("#000000").text(`"${v.text}"`);
      }
      doc.moveDown(0.8);
    }
    doc.moveDown(0.5);
  }

  doc.fontSize(15).font("Helvetica-Bold").fillColor("#000000").text("Full Transcript");
  doc.moveDown(0.5);
  if (!transcript.length) {
    doc.fontSize(11).font("Helvetica").fillColor("#666666").text("(no transcript recorded this session)");
  } else {
    for (const t of transcript) {
      doc.fontSize(9).font("Helvetica").fillColor("#888888").text(formatTimestamp(t.timestamp));
      doc.fontSize(11).fillColor("#000000").text(t.text);
      doc.moveDown(0.4);
    }
  }
}

module.exports = { buildTranscriptText, buildTranscriptPdf };
