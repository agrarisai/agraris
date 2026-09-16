// ============================================
// Agraris — agent detail page logic
// ============================================

function setMetaDescription(content) {
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "description");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
}

function setMetaProperty(property, content) {
  let meta = document.querySelector(`meta[property="${property}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("property", property);
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
}

function initCopyLinkButton(root) {
  const btn = root.querySelector("#copy-link-btn");
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

function initReportAgent(root, agentId) {
  const link = root.querySelector("#report-link");
  const form = root.querySelector("#report-form");
  if (!link || !form) return;

  const msgEl = form.querySelector("#report-msg");
  const submitBtn = form.querySelector("#report-submit-btn");

  link.addEventListener("click", (e) => {
    e.preventDefault();
    const expanded = !form.hidden;
    form.hidden = expanded;
    link.setAttribute("aria-expanded", String(!expanded));
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const reason = form.reason.value;
    const details = form.details.value.trim();

    submitBtn.disabled = true;
    msgEl.textContent = "";
    msgEl.className = "form-msg";

    try {
      const { error } = await supabaseClient.from("agent_reports").insert([
        {
          agent_id: agentId,
          reason,
          details: details || null,
        },
      ]);

      if (error) throw error;

      form.hidden = true;
      link.hidden = true;
      const confirm = document.createElement("p");
      confirm.className = "report-confirm";
      confirm.textContent = "Thanks — we'll take a look.";
      form.insertAdjacentElement("afterend", confirm);
    } catch (err) {
      console.error("Gagal mengirim report:", err);
      msgEl.textContent = "Something went wrong. Please try again.";
      msgEl.className = "form-msg error";
      submitBtn.disabled = false;
    }
  });
}

(async function () {
  const container = document.getElementById("agent-detail");
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (!id) {
    container.removeAttribute("aria-busy");
    container.innerHTML = renderEmptyState(
      "No agent specified",
      "Go back to the registry and pick an agent to view."
    );
    return;
  }

  try {
    const agent = await fetchAgentById(id);
    const categories = normalizeCategories(agent.category);
    const tags = categories
      .map((c) => `<span class="tag">${escapeHtml(c)}</span>`)
      .join("");
    const similarAgents = await fetchSimilarAgents(categories, agent.id, 3);

    document.title = `${agent.name} — Agraris`;
    setMetaDescription(agent.description);
    setMetaProperty("og:title", `${agent.name} — Agraris`);
    setMetaProperty("og:description", agent.description);

    container.innerHTML = `
      <div class="detail-head reveal">
        <div class="agent-row-top">
          <span class="agent-name">${escapeHtml(agent.name)}</span>
          ${renderVerifiedBadge(agent, { lg: true })}
        </div>
        <div class="agent-meta-row">
          <span class="agent-version">v${escapeHtml(agent.version)}</span>
          ${renderGithubBadgePlaceholder(agent)}
        </div>
        <div class="agent-meta">${tags}</div>
        <p class="detail-desc">${escapeHtml(agent.description)}</p>
        <div class="detail-links">
          <a class="btn btn-solid" href="${escapeHtml(agent.repo_url)}" target="_blank" rel="noopener noreferrer">View repo</a>
          ${
            agent.demo_url
              ? `<a class="btn" href="${escapeHtml(agent.demo_url)}" target="_blank" rel="noopener noreferrer">View demo</a>`
              : ""
          }
          <button type="button" class="btn" id="copy-link-btn">Copy link</button>
          ${renderWatchlistButton(agent.id, { variant: "lg" })}
        </div>
      </div>

      <div class="detail-row reveal">
        <div class="detail-row-label">Published</div>
        <div>${escapeHtml(formatDate(agent.created_at))}</div>
      </div>

      <div class="report-agent-block reveal">
        <a href="#" class="report-link" id="report-link" aria-expanded="false">Report this agent</a>
        <form class="report-form" id="report-form" hidden>
          <div class="field">
            <label for="report-reason">Reason</label>
            <select id="report-reason" name="reason" required>
              <option value="spam">Spam</option>
              <option value="misleading">Misleading information</option>
              <option value="illegal">Illegal content</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div class="field">
            <label for="report-details">Details</label>
            <textarea id="report-details" name="details" maxlength="1000" placeholder="Anything else we should know? (optional)"></textarea>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-sm" id="report-submit-btn">Submit report</button>
            <span class="form-msg" id="report-msg"></span>
          </div>
        </form>
      </div>

      ${
        similarAgents.length > 0
          ? `
            <div class="similar-agents-section reveal">
              <div class="section-head section-head--sub">
                <h2>Similar agents</h2>
              </div>
              <div class="agent-list">
                ${similarAgents.map(renderAgentRow).join("")}
              </div>
            </div>
          `
          : ""
      }
    `;
    observeReveal(container);
    loadGithubBadges([agent, ...similarAgents], container);
    initCopyLinkButton(container);
    initReportAgent(container, agent.id);
  } catch (err) {
    container.innerHTML = renderEmptyState(
      "Agent not found",
      "This agent may have been removed, or the link is incorrect.",
      { href: "index.html", label: "Back to registry", variant: "outline" }
    );
  } finally {
    container.removeAttribute("aria-busy");
  }
})();
