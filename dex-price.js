// ============================================
// Agraris — live $AGRARIS price (DEX Screener)
// ============================================

// Fills the price row inside the "Official Token" block on the home
// page from DEX Screener's public API (no key needed). Fetched once per
// page load, straight from the visitor's browser. Any failure — network
// error, token not indexed yet, empty/odd response — hides the price
// row and leaves the rest of the block untouched.

const AGRARIS_TOKEN_ADDRESS = "0x467b7a85f55bd716cb16d59f63b8ccac08852a6c";
const DEX_SCREENER_URL = `https://api.dexscreener.com/latest/dex/tokens/${AGRARIS_TOKEN_ADDRESS}`;

function toNumber(value) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// Among the pairs where $AGRARIS is the base token (so priceUsd is its
// price, not the other side's), pick the deepest by liquidity, then
// by 24h volume.
function pickBestPair(pairs) {
  if (!Array.isArray(pairs)) return null;

  const candidates = pairs.filter(
    (p) =>
      p &&
      p.baseToken &&
      typeof p.baseToken.address === "string" &&
      p.baseToken.address.toLowerCase() === AGRARIS_TOKEN_ADDRESS &&
      toNumber(p.priceUsd) !== null
  );
  if (candidates.length === 0) return null;

  const liquidity = (p) => toNumber(p.liquidity && p.liquidity.usd) || 0;
  const volume = (p) => toNumber(p.volume && p.volume.h24) || 0;

  return candidates.reduce((best, p) =>
    liquidity(p) > liquidity(best) ||
    (liquidity(p) === liquidity(best) && volume(p) > volume(best))
      ? p
      : best
  );
}

// "$0.004321", "$0.00001234", "$1.23" — about 4 significant digits for
// sub-dollar prices, 2 decimals otherwise.
function formatTokenPrice(price) {
  if (price >= 1) {
    return `$${price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (price === 0) return "$0";
  return `$${price.toLocaleString("en-US", {
    maximumSignificantDigits: 4,
    maximumFractionDigits: 12,
  })}`;
}

// "$950", "$12.3K", "$4.5M", "$1.2B"
function formatCompactUsd(value) {
  const abs = Math.abs(value);
  const units = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      return `$${(value / size).toFixed(1).replace(/\.0$/, "")}${suffix}`;
    }
  }
  return `$${Math.round(value)}`;
}

function formatPercentChange(pct) {
  const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

async function loadTokenPrice() {
  const container = document.getElementById("token-price");
  if (!container) return;

  const priceEl = document.getElementById("token-price-value");
  const mcapEl = document.getElementById("token-mcap-value");
  const changeEl = document.getElementById("token-change-value");
  const volumeEl = document.getElementById("token-volume-value");
  const updatedEl = document.getElementById("token-price-updated");

  let pair;
  try {
    const res = await fetch(DEX_SCREENER_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    pair = pickBestPair(data && data.pairs);
  } catch {
    pair = null;
  }

  const price = pair ? toNumber(pair.priceUsd) : null;
  if (price === null) {
    container.hidden = true;
    return;
  }

  priceEl.textContent = formatTokenPrice(price);

  const mcap = toNumber(pair.marketCap) ?? toNumber(pair.fdv);
  if (mcap !== null) mcapEl.textContent = formatCompactUsd(mcap);

  const change = toNumber(pair.priceChange && pair.priceChange.h24);
  if (change !== null) {
    changeEl.textContent = formatPercentChange(change);
    changeEl.classList.add(change >= 0 ? "is-up" : "is-down");
  }

  const volume = toNumber(pair.volume && pair.volume.h24);
  if (volume !== null) volumeEl.textContent = formatCompactUsd(volume);

  // Relative timestamp, kept fresh without re-fetching.
  const fetchedAt = new Date().toISOString();
  const renderUpdated = () => {
    updatedEl.textContent = formatRelativeTime(fetchedAt).replace(/^Updated/, "updated");
  };
  renderUpdated();
  setInterval(renderUpdated, 30 * 1000);
}

loadTokenPrice();
