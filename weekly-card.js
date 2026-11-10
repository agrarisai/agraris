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
  const upFrom = rising && a.p7 !== null && a.p7 !== undefined ? `up from ${a.p7}` : null;
  const url = `https://agraris.xyz/agent.html?id=${agent.id}`;
  return {
    name: String(agent.name || ""),
    meta,
    bigNumber: c7Text,
    unit: `${noun} this week`,
    rising: !!rising,
    upFrom,
    bars: Array.isArray(a.d) ? a.d.slice(0, 7) : [],
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

function drawWeeklyCard(canvas, spec, bg) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  const DISPLAY = '"Fraunces", Georgia, serif';
  const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
  const GREEN = "#2f6b3f";
  const INK = "#3b2d22";

  ctx.fillStyle = "#efe4cf";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  if (bg && bg.naturalWidth) {
    const s = Math.max(CARD_W / bg.naturalWidth, CARD_H / bg.naturalHeight);
    const w = bg.naturalWidth * s;
    const h = bg.naturalHeight * s;
    ctx.drawImage(bg, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h);
  }
  ctx.fillStyle = "rgba(246,239,224,0.78)";
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // panel
  roundRectPath(ctx, 56, 56, CARD_W - 112, CARD_H - 112, 36);
  ctx.fillStyle = "rgba(255,253,247,0.94)";
  ctx.fill();
  ctx.strokeStyle = "rgba(59,45,34,0.18)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const L = 112;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = GREEN;
  ctx.font = `500 20px ${MONO}`;
  ctx.fillText("THIS WEEK ON AGRARIS", L, 128);

  ctx.fillStyle = INK;
  ctx.font = `700 60px ${DISPLAY}`;
  ctx.fillText(fitText(ctx, spec.name, 780), L, 202);

  ctx.fillStyle = "rgba(59,45,34,0.62)";
  ctx.font = `400 22px ${MONO}`;
  ctx.fillText(fitText(ctx, spec.meta, 780), L, 246);

  // big number + unit
  ctx.fillStyle = GREEN;
  ctx.font = `800 168px ${DISPLAY}`;
  ctx.fillText(spec.bigNumber, L, 438);
  const numW = ctx.measureText(spec.bigNumber).width;
  ctx.fillStyle = INK;
  ctx.font = `500 30px ${MONO}`;
  ctx.fillText(spec.unit, L + numW + 22, 438);

  // rising chip
  if (spec.rising) {
    ctx.font = `700 24px ${MONO}`;
    const label = "RISING";
    const cw = ctx.measureText(label).width + 44;
    roundRectPath(ctx, L, 470, cw, 46, 23);
    ctx.fillStyle = "rgba(47,107,63,0.10)";
    ctx.fill();
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = GREEN;
    ctx.fillText(label, L + 22, 502);
    if (spec.upFrom) {
      ctx.fillStyle = "rgba(59,45,34,0.7)";
      ctx.font = `400 24px ${MONO}`;
      ctx.fillText(spec.upFrom, L + cw + 18, 502);
    }
  }

  // 7-day bars (oldest first, today last)
  const bars = spec.bars;
  if (bars.length) {
    const bx = 780;
    const baseY = 440;
    const maxH = 190;
    const bw = 36;
    const gap = 14;
    const max = Math.max(1, ...bars);
    bars.forEach((n, i) => {
      const h = n ? 14 + Math.round(((maxH - 14) * n) / max) : 6;
      roundRectPath(ctx, bx + i * (bw + gap), baseY - h, bw, h, Math.min(8, h / 2));
      ctx.fillStyle = n ? GREEN : "rgba(59,45,34,0.22)";
      ctx.fill();
    });
    ctx.fillStyle = "rgba(59,45,34,0.55)";
    ctx.font = `400 18px ${MONO}`;
    ctx.fillText("last 7 days", bx, baseY + 34);
  }

  // footer
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(L, 578);
  ctx.bezierCurveTo(L + 12, 556, L + 24, 556, L + 36, 574);
  ctx.bezierCurveTo(L + 48, 592, L + 60, 592, L + 72, 566);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = `700 30px ${DISPLAY}`;
  ctx.fillText("agraris.xyz", L + 92, 582);
  ctx.fillStyle = "rgba(59,45,34,0.6)";
  ctx.font = `400 18px ${MONO}`;
  ctx.textAlign = "right";
  ctx.fillText(spec.note, CARD_W - 112, 582);
  ctx.textAlign = "left";
}

function renderWeeklyCardSection(agent) {
  const a = typeof getActivity === "function" ? getActivity(agent) : null;
  const rising = a && typeof isRising === "function" ? isRising(a) : false;
  if (!buildCardSpec(agent, a, rising)) return "";
  return `
    <div class="card-section reveal" id="weekly-card">
      <div class="detail-row-label">Share this week's card</div>
      <canvas class="card-preview" id="weekly-card-canvas" width="${CARD_W}" height="${CARD_H}" aria-label="Weekly activity card"></canvas>
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
  img.src = "images/hero-light.webp";
  // Fonts load lazily; redraw once they are ready so the card matches the site.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => draw(img.complete ? img : null));

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
