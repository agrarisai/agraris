// ============================================
// Agraris — live check: apakah demo_url listing masih merespons
// ============================================
// Dijalankan oleh .github/workflows/live-check.yml (tiap 6 jam + manual
// trigger). Memeriksa demo_url listing yang approved, lalu menulis
// live_status / live_checked_at / live_fail_count lewat service role
// (supabase/migration-live-check.sql).
//
// Arti hasil: HANYA "URL demo membalas dengan HTTP 2xx/3xx". Bukan tanda
// aman, bukan endorsement.
//
// Aturan status (anti-flapping):
//   - respons 2xx/3xx  → live_status = 'up', live_fail_count = 0
//   - gagal            → live_fail_count + 1; live_status baru 'down'
//                        setelah 3 kegagalan berturut-turut, sebelum itu
//                        nilai lama dibiarkan
//   - live_checked_at selalu diperbarui
//
// Keamanan (demo_url diisi pengguna, jadi diperlakukan sebagai input
// tak tepercaya):
//   - hanya https, hanya port 443, tanpa user:pass di URL
//   - DNS di-resolve dulu; kalau SALAH SATU alamat privat / loopback /
//     link-local / metadata, URL ditolak. Koneksi lalu dipaku ke alamat
//     yang sudah diperiksa itu (lookup kustom), jadi DNS tidak bisa
//     berubah di antara pemeriksaan dan koneksi
//   - maksimal 3 redirect, setiap hop diperiksa ulang dengan aturan sama
//   - batas waktu 8 detik untuk seluruh pemeriksaan (termasuk redirect)
//   - body dibaca maksimal 64 KB lalu koneksi diputus; isinya dibuang,
//     tidak pernah disimpan atau dicetak
//   - tanpa cookie, tanpa header otorisasi, User-Agent tetap
//   - log hanya mencetak id listing dan HOST, tidak pernah URL lengkap
//     (path / query bisa berisi token)
//
// Supabase dipanggil lewat REST (scripts/review-lib.js), tanpa dependensi.
//
// Env vars yang dibutuhkan:
//   SUPABASE_URL              — Project URL Supabase
//   SUPABASE_SERVICE_ROLE_KEY — service_role key (JANGAN dipakai di client-side!)

const dns = require("dns");
const https = require("https");
const net = require("net");

const USER_AGENT = "AgrarisLiveCheck/1.0 (+https://agraris.xyz)";
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 64 * 1024;
const CONCURRENCY = 5;
const MAX_LISTINGS_PER_RUN = 100;
const FAILS_BEFORE_DOWN = 3;

// ---------- alamat yang tidak boleh dihubungi ----------

const BLOCKED = new net.BlockList();
[
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // privat
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, termasuk metadata 169.254.169.254
  ["172.16.0.0", 12], // privat
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // privat
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
].forEach(([addr, prefix]) => BLOCKED.addSubnet(addr, prefix, "ipv4"));
[
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64 (bisa menunjuk ke IPv4 privat)
  ["fc00::", 7], // unique local, termasuk fd00:ec2::254 (metadata)
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
].forEach(([addr, prefix]) => BLOCKED.addSubnet(addr, prefix, "ipv6"));

// true kalau alamat tidak boleh dihubungi. Alamat yang tidak bisa diurai
// juga dianggap terlarang.
function isBlockedAddress(address) {
  if (typeof address !== "string") return true;
  let addr = address.trim().toLowerCase();
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) → periksa sebagai IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) addr = mapped[1];
  const family = net.isIP(addr);
  if (family === 4) return BLOCKED.check(addr, "ipv4");
  if (family === 6) {
    // ::ffff:7f00:1 (bentuk hex dari IPv4-mapped)
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(addr)) return true;
    return BLOCKED.check(addr, "ipv6");
  }
  return true;
}

// ---------- hasil ----------

class CheckFailure extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

// URL → objek URL yang aman dihubungi, atau CheckFailure.
function parseTarget(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new CheckFailure("invalid_url");
  }
  if (url.protocol !== "https:") throw new CheckFailure("not_https");
  // new URL() menghapus ":443", jadi port lain selalu terisi di sini.
  if (url.port !== "" && url.port !== "443") throw new CheckFailure("port_not_allowed");
  if (url.username || url.password) throw new CheckFailure("credentials_in_url");
  if (!url.hostname) throw new CheckFailure("invalid_url");
  return url;
}

function hostOf(raw) {
  try {
    return new URL(String(raw)).hostname || "?";
  } catch {
    return "?";
  }
}

function withDeadline(promise, deadline, timers) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new CheckFailure("timeout"));
  return new Promise((resolve, reject) => {
    const t = timers.setTimeout(() => reject(new CheckFailure("timeout")), remaining);
    promise.then(
      (v) => {
        timers.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        timers.clearTimeout(t);
        reject(e);
      }
    );
  });
}

async function defaultResolve(hostname) {
  return dns.promises.lookup(hostname, { all: true, verbatim: true });
}

// Satu request GET ke `url`, dipaku ke `address`. Mengembalikan
// { status, location } setelah membaca paling banyak MAX_BODY_BYTES.
function requestOnce(url, address, { request, deadline, timers, maxBodyBytes, tls }) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(new CheckFailure("timeout"));
      return;
    }

    let settled = false;
    let req = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timer);
      fn(value);
    };
    const timer = timers.setTimeout(() => {
      finish(reject, new CheckFailure("timeout"));
      if (req) req.destroy();
    }, remaining);

    const options = {
      method: "GET",
      protocol: "https:",
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      servername: net.isIP(url.hostname) ? undefined : url.hostname,
      // Tanpa cookie / Authorization; hanya header ini.
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      },
      agent: false,
      // Koneksi hanya ke alamat yang sudah diperiksa.
      lookup: (_host, opts, cb) => {
        const callback = typeof opts === "function" ? opts : cb;
        if (opts && typeof opts === "object" && opts.all) {
          callback(null, [{ address: address.address, family: address.family }]);
        } else {
          callback(null, address.address, address.family);
        }
      },
      ...tls,
    };

    try {
      req = request(options, (res) => {
        const status = res.statusCode;
        const location = res.headers ? res.headers.location : undefined;
        let bytes = 0;
        const done = () => {
          finish(resolve, { status, location, bytes });
          res.destroy();
        };
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes >= maxBodyBytes) done();
        });
        res.on("end", done);
        res.on("close", done);
        res.on("error", () => done());
      });
    } catch {
      finish(reject, new CheckFailure("request_error"));
      return;
    }

    req.on("error", (err) => {
      const code = err && typeof err.code === "string" ? err.code : "";
      finish(reject, new CheckFailure(code ? `network_${code}` : "network_error"));
    });
    req.end();
  });
}

// Periksa satu URL. Tidak pernah melempar; mengembalikan
// { ok, reason, status, host }. `host` adalah host terakhir yang dicoba.
async function checkUrl(rawUrl, deps = {}) {
  const resolve = deps.resolve || defaultResolve;
  const request = deps.request || https.request;
  const timers = deps.timers || { setTimeout, clearTimeout };
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const maxBodyBytes = deps.maxBodyBytes ?? MAX_BODY_BYTES;
  const blocked = deps.isBlockedAddress || isBlockedAddress;
  const deadline = Date.now() + timeoutMs;

  let current = rawUrl;
  let host = hostOf(rawUrl);

  try {
    for (let hop = 0; ; hop++) {
      const url = parseTarget(current);
      host = url.hostname;

      let addresses;
      try {
        addresses = await withDeadline(Promise.resolve(resolve(url.hostname)), deadline, timers);
      } catch (err) {
        if (err instanceof CheckFailure) throw err;
        throw new CheckFailure("dns_failed");
      }
      if (!Array.isArray(addresses) || addresses.length === 0) {
        throw new CheckFailure("dns_failed");
      }
      if (addresses.some((a) => !a || blocked(a.address))) {
        throw new CheckFailure("blocked_address");
      }

      const res = await requestOnce(url, addresses[0], {
        request,
        deadline,
        timers,
        maxBodyBytes,
        tls: deps.tls,
      });

      const isRedirect = res.status >= 300 && res.status < 400 && res.location;
      if (isRedirect) {
        if (hop >= MAX_REDIRECTS) throw new CheckFailure("too_many_redirects");
        try {
          current = new URL(res.location, url).href;
        } catch {
          throw new CheckFailure("invalid_redirect");
        }
        continue;
      }

      if (res.status >= 200 && res.status < 400) {
        return { ok: true, reason: `http_${res.status}`, status: res.status, host };
      }
      return { ok: false, reason: `http_${res.status}`, status: res.status, host };
    }
  } catch (err) {
    const reason = err instanceof CheckFailure ? err.reason : "error";
    return { ok: false, reason, status: null, host };
  }
}

// ---------- status ----------

// Baris lama + hasil cek → kolom yang ditulis ke database.
function nextState(row, ok, now = new Date()) {
  const checkedAt = now.toISOString();
  if (ok) {
    return { live_status: "up", live_fail_count: 0, live_checked_at: checkedAt };
  }
  const previous = Number.isInteger(row.live_fail_count) && row.live_fail_count > 0 ? row.live_fail_count : 0;
  const fails = previous + 1;
  const status = row.live_status === "up" || row.live_status === "down" ? row.live_status : null;
  return {
    live_status: fails >= FAILS_BEFORE_DOWN ? "down" : status,
    live_fail_count: fails,
    live_checked_at: checkedAt,
  };
}

// ---------- run ----------

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// fetchRows() → baris; updateRow(row, patch) → simpan. check(url) → hasil
// checkUrl. Semua bisa diganti di tes.
async function run({ fetchRows, updateRow, check = checkUrl, log = console.log, now = () => new Date() }) {
  const rows = await fetchRows();
  let up = 0;
  let failed = 0;
  let saveErrors = 0;

  await mapLimit(rows, CONCURRENCY, async (row) => {
    const result = await check(row.demo_url);
    const patch = nextState(row, result.ok, now());
    if (result.ok) up++;
    else failed++;

    try {
      await updateRow(row, patch);
    } catch (err) {
      saveErrors++;
      log(`[live-check] ${row.id} save failed: ${err && err.message ? err.message : "error"}`);
      return;
    }

    log(
      `[live-check] ${row.id} host=${result.host} ${result.ok ? "ok" : "fail"} (${result.reason}) → ${patch.live_status ?? "null"}, fails=${patch.live_fail_count}`
    );
  });

  log(`[live-check] Checked ${rows.length} listing(s): ${up} responding, ${failed} failed, ${saveErrors} save error(s).`);
  return { checked: rows.length, up, failed, saveErrors };
}

async function main() {
  const { requireEnv, rest, filter } = require("./review-lib.js");
  requireEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

  const fetchRows = async () => {
    // Service role bypasses RLS, so pending entries must be filtered out
    // explicitly (supabase/migration-review-queue.sql).
    const query = [
      "select=id,demo_url,live_status,live_fail_count,live_checked_at",
      filter("approved", "eq", "true"),
      "demo_url=not.is.null",
      "order=live_checked_at.asc.nullsfirst,id.asc",
      `limit=${MAX_LISTINGS_PER_RUN}`,
    ].join("&");
    const { data } = await rest("GET", "agents", query);
    return (Array.isArray(data) ? data : []).filter(
      (row) => typeof row.demo_url === "string" && row.demo_url.trim() !== ""
    );
  };

  // demo_url ikut di filter: kalau builder mengganti demo saat cek sedang
  // jalan, hasil untuk URL lama tidak ditulis (trigger di database sudah
  // mengosongkan kolom live_* untuk URL baru).
  const updateRow = async (row, patch) => {
    const query = [filter("id", "eq", row.id), filter("demo_url", "eq", row.demo_url)].join("&");
    await rest("PATCH", "agents", query, { body: patch, prefer: "return=minimal" });
  };

  const summary = await run({ fetchRows, updateRow });
  if (summary.saveErrors > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[live-check] Failed: ${err && err.message ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  USER_AGENT,
  TIMEOUT_MS,
  MAX_REDIRECTS,
  MAX_BODY_BYTES,
  CONCURRENCY,
  MAX_LISTINGS_PER_RUN,
  FAILS_BEFORE_DOWN,
  isBlockedAddress,
  parseTarget,
  checkUrl,
  nextState,
  run,
};
