// Weekly card: a shareable 16:9 picture of one listing's last 7 days of
// commits, drawn in the browser (canvas) so there is nothing to generate or
// host. Code activity only: it says nothing about usage and is not an
// endorsement, and the card says so.

const CARD_W = 1200;
const CARD_H = 675;
const CARD_NOTE = "Code activity only. Not usage, not an endorsement.";

// Pure data for the card (testable without a canvas). `a` is the normalized
// activity ({c7, d, last, p7}); `rising` is passed in by the caller.
function buildCardSpec(agent, a, rising) {
  if (!agent || !a || !(a.c7 > 0)) return null;
  const c7Text = `${a.c7.toLocaleString("en-US")}${a.c7 >= 100 ? "+" : ""}`;
  const noun = a.c7 === 1 && a.c7 < 100 ? "commit" : "commits";
  const cats = Array.isArray(agent.category) ? agent.category : [];
  const kind = agent.kind === "tool" ? "Tool" : "Agent";
  const meta = [kind, agent.version ? `v${agent.version}` : "", cats[0] || ""].filter(Boolean).join("  ·  ");
  // At the API's 100-commit cap the daily split and the previous week are
  // unreliable, so the card shows only "100+" (no bars, no "up from").
  const capped = a.c7 >= 100;
  const upFrom = !capped && rising && a.p7 !== null && a.p7 !== undefined ? `up from ${a.p7}` : null;
  const url = `https://agraris.xyz/agent.html?id=${agent.id}`;
  return {
    name: String(agent.name || ""),
    meta,
    bigNumber: c7Text,
    unit: `${noun} this week`,
    rising: !!rising && !capped,
    upFrom,
    bars: !capped && Array.isArray(a.d) ? a.d.slice(0, 7) : [],
    note: CARD_NOTE,
    url,
    tweet: `${agent.name}: ${c7Text} ${noun} this week${upFrom ? ` (${upFrom})` : ""}. Code activity only.`,
    filename: `agraris-${String(agent.name || "listing").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-weekly.png`,
  };
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

// Fonts used on the card: Inter (loaded by agent.html) and IBM Plex Mono.
const CARD_SANS = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const CARD_MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';

function setSpacing(ctx, px) {
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${px}px`;
}

// Night-hills card, drawn at 2x for sharp text. All coordinates are in a
// 1200x675 space.
function drawWeeklyCard(canvas, spec, bg) {
  const SCALE = 2;
  canvas.width = CARD_W * SCALE;
  canvas.height = CARD_H * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  const CREAM = "#f1ead9";
  const SOFT = "rgba(241,234,217,0.82)";
  const RULE = "rgba(241,234,217,0.22)";
  const GREEN = "#8cc29a";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  ctx.fillStyle = "#0b130e";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  if (bg && bg.naturalWidth) {
    const s = Math.max(CARD_W / bg.naturalWidth, CARD_H / bg.naturalHeight);
    const w = bg.naturalWidth * s;
    const h = bg.naturalHeight * s;
    ctx.drawImage(bg, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h);
  }
  const veil = ctx.createLinearGradient(0, 0, 0, CARD_H);
  veil.addColorStop(0, "rgba(8,16,12,0.55)");
  veil.addColorStop(0.6, "rgba(8,16,12,0.62)");
  veil.addColorStop(1, "rgba(8,16,12,0.82)");
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // accent bar, label, title, meta
  ctx.fillStyle = "#6fa57c";
  ctx.fillRect(100, 100, 4, 128);
  ctx.fillStyle = "rgba(241,234,217,0.85)";
  ctx.font = `400 21px ${CARD_MONO}`;
  setSpacing(ctx, 5);
  ctx.fillText("THIS WEEK ON AGRARIS", 130, 120);
  ctx.fillStyle = CREAM;
  ctx.font = `600 78px ${CARD_SANS}`;
  setSpacing(ctx, -1.5);
  ctx.fillText(fitText(ctx, spec.name, 960), 130, 208);
  ctx.fillStyle = SOFT;
  ctx.font = `400 22px ${CARD_MONO}`;
  setSpacing(ctx, 1);
  ctx.fillText(fitText(ctx, spec.meta, 960), 130, 258);

  ctx.fillStyle = RULE;
  ctx.fillRect(100, 306, 1000, 2);

  // big number + unit
  ctx.fillStyle = CREAM;
  ctx.font = `600 150px ${CARD_SANS}`;
  setSpacing(ctx, -4);
  ctx.fillText(spec.bigNumber, 100, 468);
  const numW = ctx.measureText(spec.bigNumber).width;
  ctx.font = `500 34px ${CARD_SANS}`;
  setSpacing(ctx, 0);
  ctx.fillText(spec.unit, 100 + numW + 40, 466);

  // rising chip
  if (spec.rising) {
    roundRectPath(ctx, 100, 512, 150, 52, 12);
    ctx.fillStyle = GREEN;
    ctx.fill();
    ctx.fillStyle = "#0b130e";
    ctx.font = `500 25px ${CARD_MONO}`;
    setSpacing(ctx, 2);
    ctx.textAlign = "center";
    ctx.fillText("RISING", 175 + 1, 546);
    ctx.textAlign = "left";
    if (spec.upFrom) {
      ctx.fillStyle = "rgba(241,234,217,0.85)";
      ctx.font = `400 24px ${CARD_MONO}`;
      setSpacing(ctx, 0);
      ctx.fillText(spec.upFrom, 278, 546);
    }
  }

  // 7-day bars (oldest first, today last)
  const bars = spec.bars;
  if (bars.length) {
    ctx.fillStyle = RULE;
    ctx.fillRect(700, 338, 2, 236);
    const max = Math.max(1, ...bars);
    bars.forEach((n, i) => {
      const h = n ? 20 + Math.round((150 * n) / max) : 5;
      roundRectPath(ctx, 760 + i * 48, 522 - h, 34, h, Math.min(5, h / 2));
      ctx.fillStyle = n ? GREEN : "rgba(241,234,217,0.25)";
      ctx.fill();
    });
    ctx.fillStyle = SOFT;
    ctx.font = `400 20px ${CARD_MONO}`;
    setSpacing(ctx, 0);
    ctx.fillText("last 7 days", 760, 552);
  }

  // footer
  ctx.fillStyle = RULE;
  ctx.fillRect(100, 604, 1000, 2);
  ctx.fillStyle = CREAM;
  ctx.font = `600 28px ${CARD_SANS}`;
  setSpacing(ctx, 0);
  ctx.fillText("agraris.xyz", 100, 646);
  ctx.fillStyle = SOFT;
  ctx.font = `400 17px ${CARD_MONO}`;
  ctx.textAlign = "right";
  ctx.fillText(spec.note, 1100, 644);
  ctx.textAlign = "left";
  setSpacing(ctx, 0);
}

function renderWeeklyCardSection(agent) {
  const a = typeof getActivity === "function" ? getActivity(agent) : null;
  const rising = a && typeof isRising === "function" ? isRising(a) : false;
  if (!buildCardSpec(agent, a, rising)) return "";
  return `
    <div class="card-section reveal" id="weekly-card">
      <div class="detail-row-label">Share this week's card</div>
      <canvas class="card-preview" id="weekly-card-canvas" width="${CARD_W * 2}" height="${CARD_H * 2}" aria-label="Weekly activity card"></canvas>
      <div class="badge-code-row">
        <button type="button" class="btn btn-sm" id="card-share-btn">Share image</button>
        <button type="button" class="btn btn-sm" id="card-download-btn">Download PNG</button>
        <a class="btn btn-sm" id="card-x-btn" target="_blank" rel="noopener noreferrer" href="#">Post on X</a>
      </div>
      <p class="activity-note">The image is drawn in your browser. Code activity only.</p>
    </div>`;
}

function initWeeklyCard(root, agent) {
  const canvas = root.querySelector("#weekly-card-canvas");
  if (!canvas) return;
  const a = getActivity(agent);
  const spec = buildCardSpec(agent, a, isRising(a));
  if (!spec) return;
  const draw = (bg) => drawWeeklyCard(canvas, spec, bg);
  draw(null);
  const img = new Image();
  img.onload = () => draw(img);
  img.src = "images/hero-dark.webp";
  // Fonts load lazily; redraw once they are ready so the card matches the site.
  if (document.fonts && document.fonts.load) {
    Promise.all([
      document.fonts.load('600 78px Inter'),
      document.fonts.load('500 34px Inter'),
      document.fonts.load('400 21px "IBM Plex Mono"'),
      document.fonts.load('500 25px "IBM Plex Mono"'),
    ])
      .catch(() => {})
      .then(() => draw(img.complete && img.naturalWidth ? img : null));
  }

  const x = root.querySelector("#card-x-btn");
  if (x) x.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(spec.tweet)}&url=${encodeURIComponent(spec.url)}`;

  const toBlob = () => new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const download = async () => {
    const blob = await toBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = spec.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const dl = root.querySelector("#card-download-btn");
  if (dl) dl.addEventListener("click", download);
  const share = root.querySelector("#card-share-btn");
  if (share) {
    share.addEventListener("click", async () => {
      const blob = await toBlob();
      if (!blob) return;
      const file = new File([blob], spec.filename, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: spec.tweet, url: spec.url });
          return;
        } catch (err) {
          if (err && err.name === "AbortError") return;
        }
      }
      download();
    });
  }
}

if (typeof module !== "undefined") module.exports = { buildCardSpec, CARD_NOTE };
