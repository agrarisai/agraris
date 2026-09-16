// ============================================
// Agraris — command palette (Cmd/Ctrl+K style quick search)
// ============================================
//
// Self-contained: injects its own trigger button (next to the hamburger
// menu) and modal into every page that includes this script. Relies on
// escapeHtml / normalizeCategories / fetchAgents from app.js, which is
// loaded before this file on every page.

(function () {
  const MAX_RESULTS = 5;

  const header = document.querySelector(".site-header");
  if (!header) return;

  const menuToggle = document.getElementById("menu-toggle");
  const headerActions = document.getElementById("header-actions");

  // ---------- trigger button (header, next to hamburger) ----------

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id = "cmdk-trigger";
  trigger.className = "cmdk-trigger";
  trigger.setAttribute("aria-label", "Search agents");
  trigger.title = "Search agents (press /)";
  trigger.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="6.75" cy="6.75" r="5"/><path d="M10.5 10.5L14.5 14.5" stroke-linecap="round"/></svg>';

  // keep the trigger grouped with the hamburger so the two stay on one
  // row; fall back to inserting directly into the header if a page is
  // missing the .header-actions wrapper.
  if (headerActions && menuToggle) {
    headerActions.insertBefore(trigger, menuToggle);
  } else if (menuToggle) {
    header.insertBefore(trigger, menuToggle);
  } else {
    header.appendChild(trigger);
  }

  // ---------- modal markup ----------

  const overlay = document.createElement("div");
  overlay.id = "cmdk-overlay";
  overlay.className = "cmdk-overlay";
  overlay.innerHTML = `
    <div class="cmdk-modal" id="cmdk-modal" role="dialog" aria-modal="true" aria-label="Command palette">
      <div class="cmdk-input-row">
        <svg class="cmdk-input-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="6.75" cy="6.75" r="5"/><path d="M10.5 10.5L14.5 14.5" stroke-linecap="round"/></svg>
        <input type="text" id="cmdk-input" class="cmdk-input" placeholder="Search agents..." autocomplete="off" spellcheck="false" aria-label="Search agents" />
        <kbd class="cmdk-kbd">Esc</kbd>
      </div>
      <div class="cmdk-results" id="cmdk-results"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector("#cmdk-input");
  const resultsEl = overlay.querySelector("#cmdk-results");

  // ---------- state ----------

  let agentsPromise = null;
  let debounceTimer = null;
  let items = []; // [{ href }] — kept in sync with rendered .cmdk-result order
  let activeIndex = -1;

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    return !!el.isContentEditable;
  }

  function ensureAgents() {
    if (!agentsPromise) {
      agentsPromise = fetchAgents().catch((err) => {
        console.error("Command palette gagal memuat agent:", err);
        return [];
      });
    }
    return agentsPromise;
  }

  // ---------- rendering ----------

  function renderDefault() {
    items = [
      { href: "search.html" },
      { href: "publish.html" },
      { href: "watchlist.html" },
    ];

    resultsEl.innerHTML = `
      <div class="cmdk-section-label">Quick links</div>
      <a class="cmdk-result" href="search.html">
        <span class="cmdk-result-name">Go to Search</span>
      </a>
      <a class="cmdk-result" href="publish.html">
        <span class="cmdk-result-name">Go to Publish</span>
      </a>
      <a class="cmdk-result" href="watchlist.html">
        <span class="cmdk-result-name">Go to Watchlist</span>
      </a>
    `;

    setActive(-1);
  }

  function renderResultRow(agent) {
    const categories = normalizeCategories(agent.category);
    const cat = categories[0] || "";
    return `
      <a class="cmdk-result" href="agent.html?id=${encodeURIComponent(agent.id)}">
        <span class="cmdk-result-name">${escapeHtml(agent.name)}</span>
        ${cat ? `<span class="cmdk-result-cat">${escapeHtml(cat)}</span>` : ""}
      </a>
    `;
  }

  async function runSearch() {
    const q = input.value.trim();

    if (!q) {
      renderDefault();
      return;
    }

    resultsEl.innerHTML = `<div class="cmdk-empty">Searching…</div>`;

    const agents = await ensureAgents();

    // the input may have changed while the fetch/await above was in
    // flight — bail out so a slow response can't clobber newer results
    if (input.value.trim() !== q) return;

    const needle = q.toLowerCase();
    const matches = agents.filter(
      (a) =>
        (a.name && a.name.toLowerCase().includes(needle)) ||
        (a.description && a.description.toLowerCase().includes(needle))
    );

    const shown = matches.slice(0, MAX_RESULTS);
    items = shown.map((a) => ({ href: `agent.html?id=${encodeURIComponent(a.id)}` }));

    let html =
      shown.length > 0
        ? shown.map(renderResultRow).join("")
        : `<div class="cmdk-empty">No agents found for "${escapeHtml(q)}"</div>`;

    html += `<a class="cmdk-result cmdk-view-all" href="search.html?q=${encodeURIComponent(q)}">View all results</a>`;
    items.push({ href: `search.html?q=${encodeURIComponent(q)}` });

    resultsEl.innerHTML = html;
    setActive(items.length > 0 ? 0 : -1);
  }

  function setActive(idx) {
    activeIndex = idx;
    const els = resultsEl.querySelectorAll(".cmdk-result");
    els.forEach((el, i) => el.classList.toggle("is-active", i === idx));
    const activeEl = els[idx];
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  }

  function moveActive(delta) {
    if (items.length === 0) return;
    setActive((activeIndex + delta + items.length) % items.length);
  }

  // ---------- open / close ----------

  function isOpen() {
    return overlay.classList.contains("is-open");
  }

  function openPalette() {
    overlay.classList.add("is-open");
    document.body.classList.add("cmdk-open");
    input.value = "";
    renderDefault();
    setActive(0);
    requestAnimationFrame(() => input.focus());
  }

  function closePalette() {
    if (!isOpen()) return;
    overlay.classList.remove("is-open");
    document.body.classList.remove("cmdk-open");
  }

  // ---------- events ----------

  trigger.addEventListener("click", openPalette);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePalette();
  });

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 150);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault();
        window.location.href = items[activeIndex].href;
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (isOpen() && e.key === "Escape") {
      e.preventDefault();
      closePalette();
      return;
    }

    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isOpen()) return; // let "/" be typed normally inside the palette input
    if (isTypingTarget(document.activeElement)) return;

    e.preventDefault();
    openPalette();
  });
})();
