// ============================================
// Agraris — public registry stats (stats.html)
// ============================================
//
// One read-only query to `agents` with the publishable key, then every
// number is computed here in the browser. select("*") is used on
// purpose: it is a single request that still works whether or not the
// optional contract_address column exists yet.
//
// Charts are inline SVG drawn in real pixels from the measured container
// width (and redrawn on resize), so SVG text never shrinks on phones and
// nothing overflows sideways. Every chart value is also printed as text
// (bar-end labels, list values, the weekly table), so nothing depends on
// color or on hovering.
//
// Uses escapeHtml / normalizeCategories / isVerified / formatGithubStars
// from app.js. Names and categories come from the database, so they go
// through escapeHtml (HTML strings) or textContent (tooltip).

const STATS_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const CATEGORY_PREVIEW_COUNT = 12;
const LIST_COUNT = 5;
const SVG_NS = "http://www.w3.org/2000/svg";

// ---------- formatting ----------

function fmtNumber(n) {
  return Number(n).toLocaleString("en-US");
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtWeek(ts) {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtWeekLong(ts) {
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Monday 00:00 UTC of the week containing `date`.
function weekStartUtc(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const offset = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return d.getTime() - offset * DAY_MS;
}

// Round an axis max up to a clean number (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10^n)
// so the plot uses most of its height (26 → 30, not 50).
function niceMax(value) {
  if (value <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (value <= step * pow) return step * pow;
  }
  return 10 * pow;
}

// ---------- computing ----------

function computeStats(agents, now) {
  const weekAgo = now.getTime() - 7 * DAY_MS;

  const withAddress = agents.filter(
    (a) => typeof a.contract_address === "string" && STATS_ADDRESS_PATTERN.test(a.contract_address.trim())
  ).length;

  // A category is a text[]: one agent can count toward several.
  const catCounts = new Map();
  agents.forEach((a) => {
    new Set(normalizeCategories(a.category)).forEach((c) => {
      catCounts.set(c, (catCounts.get(c) || 0) + 1);
    });
  });
  const categories = [...catCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));

  // Weekly additions, every week from the first agent to now (empty
  // weeks included so gaps aren't hidden), plus a running total.
  const dated = agents
    .map((a) => new Date(a.created_at))
    .filter((d) => !Number.isNaN(d.getTime()));
  const weeks = [];
  if (dated.length > 0) {
    const first = weekStartUtc(new Date(Math.min(...dated.map((d) => d.getTime()))));
    const last = weekStartUtc(now);
    const counts = new Map();
    dated.forEach((d) => {
      const k = weekStartUtc(d);
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    let total = 0;
    for (let t = first; t <= last; t += 7 * DAY_MS) {
      const added = counts.get(t) || 0;
      total += added;
      weeks.push({ start: t, added, total });
    }
  }

  const newest = [...agents]
    .filter((a) => !Number.isNaN(new Date(a.created_at).getTime()))
    .sort((x, y) => new Date(y.created_at) - new Date(x.created_at))
    .slice(0, LIST_COUNT);

  const mostStarred = agents
    .filter((a) => typeof a.github_stars === "number")
    .sort((x, y) => y.github_stars - x.github_stars)
    .slice(0, LIST_COUNT);

  return {
    total: agents.length,
    verified: agents.filter(isVerified).length,
    lastWeek: dated.filter((d) => d.getTime() >= weekAgo).length,
    withAddress,
    categories,
    weeks,
    newest,
    mostStarred,
  };
}

// ---------- HTML sections ----------

function renderTiles(s) {
  const tiles = [
    ["Total agents", s.total],
    ["Verified agents", s.verified],
    ["Added in the last 7 days", s.lastWeek],
  ];
  // Only when at least one agent actually has an address.
  if (s.withAddress > 0) tiles.push(["With an on-chain address", s.withAddress]);

  return `
    <section class="stats-section reveal" aria-label="Registry totals">
      <div class="stats-tiles">
        ${tiles
          .map(
            ([label, value]) => `
          <div class="stats-tile">
            <span class="stats-tile-value">${fmtNumber(value)}</span>
            <span class="stats-tile-label">${escapeHtml(label)}</span>
          </div>`
          )
          .join("")}
      </div>
    </section>`;
}

function renderCategoryRow(c) {
  const label = `${c.name}: ${fmtNumber(c.count)} agent${c.count === 1 ? "" : "s"}`;
  return `
    <a class="cat-row" href="category.html?slug=${encodeURIComponent(c.name)}" aria-label="${escapeHtml(label)}" data-count="${c.count}">
      <span class="cat-label" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
      <svg class="cat-bar" aria-hidden="true" focusable="false"></svg>
      <span class="cat-value">${fmtNumber(c.count)}</span>
    </a>`;
}

function renderCategories(s) {
  const body =
    s.categories.length === 0
      ? `<p class="stats-empty">No categories yet.</p>`
      : `
        <div class="cat-chart" role="list" aria-label="Agents by category, most first">
          ${s.categories
            .map((c, i) => `<div class="cat-item" role="listitem"${i >= CATEGORY_PREVIEW_COUNT ? " hidden" : ""}>${renderCategoryRow(c)}</div>`)
            .join("")}
        </div>
        ${
          s.categories.length > CATEGORY_PREVIEW_COUNT
            ? `<button type="button" class="btn btn-sm stats-more" id="cat-more" aria-expanded="false">Show all ${fmtNumber(s.categories.length)} categories</button>`
            : ""
        }`;

  return `
    <section class="stats-section stats-card reveal" aria-labelledby="stats-cat-title">
      <h3 id="stats-cat-title">Agents by category</h3>
      ${body}
      <p class="stats-note">An agent can belong to more than one category.</p>
    </section>`;
}

function renderWeekly(s) {
  if (s.weeks.length === 0) {
    return `
      <section class="stats-section stats-card reveal" aria-labelledby="stats-week-title">
        <h3 id="stats-week-title">Agents added per week</h3>
        <p class="stats-empty">No agents yet.</p>
      </section>`;
  }

  const rows = s.weeks
    .map(
      (w) => `<tr><td>${escapeHtml(fmtWeekLong(w.start))}</td><td>${fmtNumber(w.added)}</td><td>${fmtNumber(w.total)}</td></tr>`
    )
    .join("");

  return `
    <section class="stats-section stats-card reveal" aria-labelledby="stats-week-title">
      <h3 id="stats-week-title">Agents added per week</h3>
      <p class="stats-chart-caption">Added each week (weeks start Monday, UTC)</p>
      <div class="stats-chart" id="chart-weekly"></div>
      <p class="stats-chart-caption">Total listed, cumulative</p>
      <div class="stats-chart" id="chart-cumulative"></div>
      <details class="stats-table-toggle">
        <summary>Show as table</summary>
        <div class="docs-table-wrap">
          <table class="docs-table stats-table">
            <thead><tr><th>Week of</th><th>Added</th><th>Total</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </details>
      <p class="stats-note">Includes agents added by the Agraris team after review.</p>
    </section>`;
}

function renderList(title, id, items, valueFor, note, emptyText) {
  const body =
    items.length === 0
      ? `<p class="stats-empty">${escapeHtml(emptyText)}</p>`
      : `<ol class="stats-list">
          ${items
            .map(
              (a) => `
            <li>
              <a href="agent.html?id=${encodeURIComponent(a.id)}">${escapeHtml(a.name)}</a>
              <span class="stats-list-value">${valueFor(a)}</span>
            </li>`
            )
            .join("")}
        </ol>`;

  return `
    <section class="stats-section stats-card reveal" aria-labelledby="${id}">
      <h3 id="${id}">${escapeHtml(title)}</h3>
      ${body}
      ${note ? `<p class="stats-note">${escapeHtml(note)}</p>` : ""}
    </section>`;
}

function renderFooterNote(loadedAt) {
  const asOf = loadedAt.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `
    <section class="stats-section stats-footnote reveal">
      <p>Agraris is a directory. These numbers describe the registry, not on-chain volume or traction.</p>
      <p class="stats-asof">Data as of <time datetime="${loadedAt.toISOString()}">${escapeHtml(asOf)}</time></p>
      <button type="button" class="btn btn-sm" id="copy-stats-link-btn">Copy link</button>
    </section>`;
}

// ---------- SVG charts ----------

function svgEl(tag, attrs, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

// Horizontal bar with a square baseline and a rounded data end.
function hBarPath(w, h, r) {
  if (w <= 0) return "";
  const rr = Math.min(r, w / 2, h / 2);
  return `M0,0 H${w - rr} Q${w},0 ${w},${rr} V${h - rr} Q${w},${h} ${w - rr},${h} H0 Z`;
}

// Vertical column with a square baseline and a rounded top.
function vBarPath(x, yTop, w, h, r) {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h / 2);
  const yb = yTop + h;
  return `M${x},${yb} V${yTop + rr} Q${x},${yTop} ${x + rr},${yTop} H${x + w - rr} Q${x + w},${yTop} ${x + w},${yTop + rr} V${yb} Z`;
}

function drawCategoryBars(root) {
  const rows = [...root.querySelectorAll(".cat-item:not([hidden]) .cat-row")];
  if (rows.length === 0) return;
  const max = Math.max(...[...root.querySelectorAll(".cat-row")].map((r) => Number(r.dataset.count)));
  const H = 14;

  rows.forEach((row) => {
    const svg = row.querySelector(".cat-bar");
    const W = Math.floor(svg.getBoundingClientRect().width);
    svg.setAttribute("viewBox", `0 0 ${Math.max(W, 1)} ${H}`);
    svg.setAttribute("height", H);
    svg.replaceChildren();
    if (W <= 0) return;
    const w = Math.max(2, Math.round((Number(row.dataset.count) / max) * W));
    svg.appendChild(svgEl("rect", { class: "bar-track", x: 0, y: 0, width: W, height: H, rx: 3 }));
    svg.appendChild(svgEl("path", { class: "bar-fill", d: hBarPath(w, H, 4) }));
    // Thin end line: same green as the bar in light mode (invisible),
    // #8cc29a in dark mode so the bar's end keeps contrast there.
    if (w > 8) svg.appendChild(svgEl("rect", { class: "bar-cap", x: w - 2, y: 4, width: 2, height: H - 8 }));
  });
}

// Shared tooltip for the weekly charts (text via textContent only).
let tooltipEl = null;
function showTooltip(container, text, x, y) {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "stats-tooltip";
    tooltipEl.setAttribute("role", "status");
  }
  if (tooltipEl.parentNode !== container) container.appendChild(tooltipEl);
  tooltipEl.textContent = text;
  tooltipEl.hidden = false;
  const cw = container.clientWidth;
  const tw = tooltipEl.offsetWidth;
  tooltipEl.style.left = `${Math.max(0, Math.min(cw - tw, x - tw / 2))}px`;
  tooltipEl.style.top = `${Math.max(0, y - tooltipEl.offsetHeight - 8)}px`;
}
function hideTooltip() {
  if (tooltipEl) tooltipEl.hidden = true;
}

function weekLabel(w) {
  return `Week of ${fmtWeekLong(w.start)}: ${fmtNumber(w.added)} added, ${fmtNumber(w.total)} total`;
}

// Draws one of the two weekly charts. kind = "weekly" (columns) or
// "cumulative" (line + light area). Both share the same x positions.
function drawWeekChart(container, weeks, kind) {
  const W = Math.floor(container.clientWidth);
  if (W <= 0) return;
  const H = kind === "weekly" ? 150 : 120;
  const padL = 30;
  // Same left/right padding in both charts so a week sits at the same x.
  const padR = 34;
  const padT = 18;
  const axisH = 22;
  const plotW = Math.max(10, W - padL - padR);
  const plotH = H - padT - axisH;
  const n = weeks.length;
  const band = plotW / n;
  const values = weeks.map((w) => (kind === "weekly" ? w.added : w.total));
  const yMax = niceMax(Math.max(...values, 1));
  const y = (v) => padT + plotH - (v / yMax) * plotH;
  const xCenter = (i) => padL + band * i + band / 2;

  const summary =
    kind === "weekly"
      ? `Column chart of agents added per week, ${n} week${n === 1 ? "" : "s"}, from the week of ${fmtWeekLong(weeks[0].start)}. Peak: ${fmtNumber(Math.max(...values))} in one week.`
      : `Line chart of the cumulative number of listed agents, reaching ${fmtNumber(weeks[n - 1].total)}.`;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    width: W,
    height: H,
    role: "img",
    "aria-label": summary,
  });

  // Gridlines + y ticks (0, half, max): hairline, solid, recessive.
  [0, yMax / 2, yMax].forEach((t) => {
    if (t !== 0 && !Number.isInteger(t)) return;
    svg.appendChild(svgEl("line", { class: "chart-grid", x1: padL, x2: padL + plotW, y1: y(t), y2: y(t) }));
    svg.appendChild(svgEl("text", { class: "chart-tick", x: padL - 6, y: y(t) + 4, "text-anchor": "end" }, fmtNumber(t)));
  });

  // X labels: first and last week only (the table has every week).
  const xLabels = n === 1 ? [0] : [0, n - 1];
  xLabels.forEach((i) => {
    const anchor = n === 1 ? "middle" : i === 0 ? "start" : "end";
    const x = n === 1 ? xCenter(0) : i === 0 ? padL : padL + plotW;
    svg.appendChild(svgEl("text", { class: "chart-tick", x, y: H - 6, "text-anchor": anchor }, fmtWeek(weeks[i].start)));
  });

  if (kind === "weekly") {
    const barW = Math.max(2, Math.min(24, band - 2));
    weeks.forEach((w, i) => {
      if (w.added === 0) return;
      const top = y(w.added);
      svg.appendChild(svgEl("path", { class: "bar-fill", d: vBarPath(xCenter(i) - barW / 2, top, barW, padT + plotH - top, 4) }));
      if (barW > 6) {
        svg.appendChild(svgEl("rect", { class: "bar-cap", x: xCenter(i) - barW / 2 + 3, y: top, width: barW - 6, height: 2 }));
      }
    });
    // Direct labels, selectively: the peak week and the latest week.
    const peak = values.indexOf(Math.max(...values));
    [...new Set([peak, n - 1])].forEach((i) => {
      if (values[i] === 0 && i !== n - 1) return;
      svg.appendChild(svgEl("text", { class: "chart-value", x: xCenter(i), y: y(values[i]) - 5, "text-anchor": "middle" }, fmtNumber(values[i])));
    });
  } else {
    const pts = weeks.map((w, i) => [xCenter(i), y(w.total)]);
    const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
    const base = padT + plotH;
    svg.appendChild(svgEl("path", { class: "chart-area", d: `${line} L${pts[n - 1][0].toFixed(1)},${base} L${pts[0][0].toFixed(1)},${base} Z` }));
    svg.appendChild(svgEl("path", { class: "chart-line", d: line }));
    const [ex, ey] = pts[n - 1];
    svg.appendChild(svgEl("circle", { class: "chart-dot", cx: ex, cy: ey, r: 4 }));
    svg.appendChild(svgEl("text", { class: "chart-value", x: ex + 8, y: ey + 4, "text-anchor": "start" }, fmtNumber(weeks[n - 1].total)));
  }

  // Hit targets: one full-height column per week, focusable, so hover
  // and keyboard focus show the same tooltip. Values stay in the table.
  weeks.forEach((w, i) => {
    const hit = svgEl("rect", {
      class: "chart-hit",
      x: padL + band * i,
      y: padT,
      width: Math.max(band, 1),
      height: plotH,
      tabindex: n <= 60 ? 0 : -1,
      "aria-label": weekLabel(w),
    });
    const show = () => {
      svg.querySelectorAll(".chart-hit.is-active").forEach((el) => el.classList.remove("is-active"));
      hit.classList.add("is-active");
      showTooltip(container, weekLabel(w), xCenter(i), kind === "weekly" ? y(w.added) : y(w.total));
    };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("focus", show);
    hit.addEventListener("pointerleave", () => { hit.classList.remove("is-active"); hideTooltip(); });
    hit.addEventListener("blur", () => { hit.classList.remove("is-active"); hideTooltip(); });
    svg.appendChild(hit);
  });

  container.replaceChildren(svg);
}

function drawCharts(root, stats) {
  hideTooltip();
  drawCategoryBars(root);
  const weekly = root.querySelector("#chart-weekly");
  const cumulative = root.querySelector("#chart-cumulative");
  if (weekly && stats.weeks.length) drawWeekChart(weekly, stats.weeks, "weekly");
  if (cumulative && stats.weeks.length) drawWeekChart(cumulative, stats.weeks, "cumulative");
}

// Same copy-to-clipboard pattern as the agent page's "Copy link".
function initCopyStatsLink(root) {
  const btn = root.querySelector("#copy-stats-link-btn");
  if (!btn) return;
  const defaultLabel = btn.textContent;
  btn.addEventListener("click", () => {
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => {
          btn.textContent = defaultLabel;
        }, 2000);
      })
      .catch(() => {
        // clipboard write failed (permissions, insecure context, etc.) —
        // fail silently, no error shown to the user
      });
  });
}

// ---------- main ----------

(async function () {
  const root = document.getElementById("stats-root");

  let agents;
  try {
    const { data, error } = await supabaseClient.from("agents").select("*");
    if (error) throw error;
    agents = data || [];
  } catch (err) {
    root.innerHTML = `
      <div class="stats-error" role="alert">
        <strong>Could not load stats. Try again later.</strong>
      </div>`;
    return;
  }

  const loadedAt = new Date();
  const stats = computeStats(agents, loadedAt);

  root.innerHTML = [
    renderTiles(stats),
    renderCategories(stats),
    renderWeekly(stats),
    renderList(
      "Newest agents",
      "stats-new-title",
      stats.newest,
      (a) => escapeHtml(fmtDate(a.created_at)),
      "",
      "No agents yet."
    ),
    renderList(
      "Most starred",
      "stats-star-title",
      stats.mostStarred,
      (a) => `${formatGithubStars(a.github_stars)} stars`,
      "Stars come from public GitHub repositories and are not a measure of usage.",
      "No GitHub data yet."
    ),
    renderFooterNote(loadedAt),
  ].join("");

  drawCharts(root, stats);
  observeReveal(root);
  initCopyStatsLink(root);

  const moreBtn = root.querySelector("#cat-more");
  moreBtn?.addEventListener("click", () => {
    root.querySelectorAll(".cat-item[hidden]").forEach((r) => (r.hidden = false));
    moreBtn.remove();
    drawCategoryBars(root);
  });

  let resizeTimer = null;
  let lastWidth = root.clientWidth;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (root.clientWidth === lastWidth) return;
      lastWidth = root.clientWidth;
      drawCharts(root, stats);
    }, 120);
  });
})();
