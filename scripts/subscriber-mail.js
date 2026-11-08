// Menyusun email untuk pelanggan: konfirmasi dan digest mingguan.
// Fungsi murni (tanpa jaringan) supaya mudah dites. Teks tidak menyebut
// token atau harga. Listing bukan endorsement.

const SITE_URL = "https://agraris.xyz";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function link(action, token) {
  if (!UUID_PATTERN.test(String(token))) throw new Error("Invalid token");
  return `${SITE_URL}/follow.html?a=${action}&t=${token}`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function oneLine(s, max = 160) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  // Potong di batas kata supaya tidak berhenti di tengah kata.
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "") + "…";
}

function listingUrl(id) {
  if (!UUID_PATTERN.test(String(id))) return SITE_URL;
  return `${SITE_URL}/agent.html?id=${id}`;
}

function wrapHtml(bodyHtml) {
  return (
    '<div style="font-family:Georgia,serif;color:#4a3426;max-width:520px;margin:0 auto;padding:8px">' +
    bodyHtml +
    "</div>"
  );
}

function buildConfirmEmail(token) {
  const url = link("confirm", token);
  const text =
    "Confirm your subscription to Agraris updates.\n\n" +
    "One email a week: new listings and the most active agents and tools on Robinhood Chain.\n\n" +
    `Confirm: ${url}\n\n` +
    "If you didn't ask for this, ignore this email and nothing will be sent.\n";
  const html = wrapHtml(
    "<h2>Confirm your subscription</h2>" +
      "<p>One email a week: new listings and the most active agents and tools on Robinhood Chain.</p>" +
      `<p><a href="${esc(url)}" style="background:#2e6b40;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none">Confirm subscription</a></p>` +
      "<p style=\"color:#8a7458\">If you didn't ask for this, ignore this email and nothing will be sent.</p>"
  );
  return { subject: "Confirm your Agraris subscription", text, html };
}

// newListings / mostActive: [{ id, name, kind, description, c7? }]
function buildDigestEmail({ newListings, mostActive, token }) {
  const unsub = link("unsub", token);
  const lines = ["Agraris weekly", ""];
  const html = ["<h2>Agraris weekly</h2>"];

  if (newListings.length) {
    lines.push("New this week", "");
    html.push("<h3>New this week</h3><ul>");
    for (const x of newListings) {
      const kind = x.kind === "tool" ? "Tool" : "Agent";
      lines.push(`- ${oneLine(x.name, 80)} (${kind})`, `  ${oneLine(x.description)}`, `  ${listingUrl(x.id)}`, "");
      html.push(
        `<li><a href="${esc(listingUrl(x.id))}"><b>${esc(oneLine(x.name, 80))}</b></a> (${kind})<br>${esc(oneLine(x.description))}</li>`
      );
    }
    html.push("</ul>");
  }

  if (mostActive.length) {
    lines.push("Most active this week (commits in the last 7 days)", "");
    html.push("<h3>Most active this week</h3><ul>");
    for (const x of mostActive) {
      lines.push(`- ${oneLine(x.name, 80)}: ${x.c7} commits`, `  ${listingUrl(x.id)}`);
      html.push(`<li><a href="${esc(listingUrl(x.id))}">${esc(oneLine(x.name, 80))}</a>: ${esc(x.c7)} commits</li>`);
    }
    lines.push("");
    html.push("</ul>");
  }

  lines.push(
    "Code activity only. A listing is not an endorsement.",
    "",
    `Browse everything: ${SITE_URL}`,
    `Unsubscribe: ${unsub}`
  );
  html.push(
    '<p style="color:#8a7458">Code activity only. A listing is not an endorsement.</p>' +
      `<p><a href="${esc(SITE_URL)}">Browse everything</a> · <a href="${esc(unsub)}">Unsubscribe</a></p>`
  );

  return {
    subject: "Agraris weekly: new listings and most active",
    text: lines.join("\n"),
    html: wrapHtml(html.join("")),
    unsubscribeUrl: unsub,
  };
}

module.exports = { buildConfirmEmail, buildDigestEmail, link, UUID_PATTERN };
