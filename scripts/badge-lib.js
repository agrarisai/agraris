// Membuat SVG lencana README per listing (dua bagian: "Agraris" | status).
// Dipakai scripts/generate-badges.js dan dites di tests/badge-lib.test.js.
// Status hanya menyatakan aktivitas kode 7 hari (github_activity.c7);
// bukan bukti pemakaian dan bukan endorsement.

const HEIGHT = 22;
const LEFT_TEXT = "Agraris";
const CHAR_W = 6.6; // perkiraan lebar huruf tebal Verdana 11px
const PAD = 9;

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Teks bagian kanan. c7 > 0 -> aktif; selain itu netral.
function statusText(activity) {
  const c7 = activity && Number.isFinite(Number(activity.c7)) ? Math.floor(Number(activity.c7)) : 0;
  if (c7 > 0) return { text: `active this week · ${c7.toLocaleString("en-US")} commit${c7 === 1 ? "" : "s"}`, active: true };
  return { text: "listed · Robinhood Chain", active: false };
}

function renderBadge(activity) {
  const { text, active } = statusText(activity);
  const lw = Math.round(LEFT_TEXT.length * CHAR_W + PAD * 2);
  const dot = active ? 14 : 0;
  const rtw = Math.round(text.length * CHAR_W);
  const rw = rtw + PAD * 2 + dot;
  const w = lw + rw;
  const label = `Agraris ${text}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${HEIGHT}" viewBox="0 0 ${w} ${HEIGHT}" role="img" aria-label="${escapeXml(label)}">
  <title>${escapeXml(label)}</title>
  <clipPath id="r"><rect width="${w}" height="${HEIGHT}" rx="4"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="${HEIGHT}" fill="#3b2d22"/>
    <rect x="${lw}" width="${rw}" height="${HEIGHT}" fill="#2f6b3f"/>
  </g>
  <g font-family="Verdana, Geneva, DejaVu Sans, sans-serif" font-size="11" font-weight="600" fill="#e8dcc8">
    <text x="${PAD}" y="15" textLength="${Math.round(LEFT_TEXT.length * CHAR_W)}" lengthAdjust="spacingAndGlyphs">${LEFT_TEXT}</text>${
      active ? `\n    <circle cx="${lw + PAD + 3.5}" cy="11" r="3.5" fill="#9be28a"/>` : ""
    }
    <text x="${lw + PAD + dot}" y="15" textLength="${rtw}" lengthAdjust="spacingAndGlyphs">${escapeXml(text)}</text>
  </g>
</svg>
`;
}

module.exports = { renderBadge, statusText };
