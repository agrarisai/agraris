// ============================================
// Agraris — contract owner signature: verifikasi di server
// ============================================
// Dua mode:
//   node scripts/owner-proof.js verify   — .github/workflows/owner-proof.yml
//       (tiap 15 menit + manual). Memeriksa tanda tangan yang dikirim lewat
//       status.html (owner_proof_challenges berstatus submitted).
//   node scripts/owner-proof.js recheck  — langkah di
//       .github/workflows/live-check.yml (tiap 6 jam). Membaca ulang
//       owner() untuk setiap bukti dan menghapus bukti kalau owner berubah.
//
// Sebuah tanda tangan diterima HANYA kalau semuanya benar:
//   - permintaan masih berstatus submitted (nonce sekali pakai) dan
//     tanda tangannya dikirim sebelum expires_at;
//   - listing masih approved dan contract_address-nya sama dengan yang ada
//     di pesan;
//   - pesan yang tersimpan sama persis dengan buildMessage() (domain
//     agraris.xyz, listing id, kontrak, chain ID 4663, nonce, kedaluwarsa);
//   - alamat yang dipulihkan dari tanda tangan EIP-191 = owner() kontrak
//     saat itu, dibaca lewat RPC yang chain ID-nya 4663;
//   - owner() adalah wallet biasa (tidak punya kode). Kontrak tanpa owner(),
//     owner nol, atau owner berupa kontrak lain (mis. multisig) ditolak
//     dengan alasan yang jelas. Deployer tidak pernah dipakai sebagai
//     tebakan.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — Actions secrets
//   ROBINHOOD_CHAIN_RPC_URL — Actions secret: endpoint RPC publik Robinhood
//     Chain mainnet dari dokumentasi resmi
//     (https://docs.robinhood.com/chain/connecting). Tidak ditulis di repo
//     dan tidak pernah dicetak ke log (bisa memuat API key).
//
// Keamanan: log hanya mencetak id listing, alamat kontrak (publik), dan
// kode alasan. Tidak mencetak env var, tanda tangan, atau objek error mentah.

const { recoverPersonalSigner, ADDRESS_PATTERN, OWNER_SELECTOR, decodeAddressWord } = require("./eth-lib");

const DOMAIN = "agraris.xyz";
const CHAIN_ID = 4663;
const CHAIN_ID_HEX = `0x${CHAIN_ID.toString(16)}`;
const RPC_TIMEOUT_MS = 10000;
// Tanda tangan yang tidak bisa diperiksa karena RPC gagal dicoba lagi di
// run berikutnya, paling lama selama ini.
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 50;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

// Alasan yang membuat permintaan ditolak permanen. Status page punya
// kalimat untuk masing-masing (status.js).
const REASONS = [
  "accepted",
  "expired",
  "listing_unavailable",
  "contract_changed",
  "message_mismatch",
  "bad_signature",
  "not_a_contract",
  "no_owner",
  "owner_is_contract",
  "not_owner",
  "check_failed",
  "owner_changed",
];

class RetryableError extends Error {}

function log(message) {
  console.log(`[owner-proof] ${message}`);
}

function logError(message) {
  console.error(`[owner-proof] ${message}`);
}

// ---------- pesan ----------

function formatExpiry(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// HARUS sama persis dengan pesan di request_owner_proof()
// (supabase/migration-owner-proof.sql).
function buildMessage({ listingId, contract, nonce, expiresAt }) {
  return [
    `${DOMAIN} asks you to sign this message to show that this wallet is the owner() of the contract below.`,
    "",
    `Domain: ${DOMAIN}`,
    `Listing ID: ${String(listingId).toLowerCase()}`,
    `Contract: ${String(contract).toLowerCase()}`,
    `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Expires at: ${formatExpiry(expiresAt)}`,
    "",
    "Signing does not send a transaction.",
  ].join("\n");
}

// ---------- RPC Robinhood Chain ----------

// fetchImpl diganti di tes. Error JSON-RPC (mis. "execution reverted")
// dikembalikan sebagai { error }, kegagalan jaringan dilempar sebagai
// RetryableError.
function createRpc(url, fetchImpl = fetch) {
  let id = 0;
  let chainIdCache = null;

  async function call(method, params) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
    } catch {
      throw new RetryableError(`RPC ${method} unreachable`);
    }
    if (!res.ok) throw new RetryableError(`RPC ${method} failed (HTTP ${res.status})`);
    let body;
    try {
      body = await res.json();
    } catch {
      throw new RetryableError(`RPC ${method} returned invalid JSON`);
    }
    if (body && body.error) return { error: body.error };
    if (!body || !("result" in body)) throw new RetryableError(`RPC ${method} returned no result`);
    return { result: body.result };
  }

  async function strict(method, params) {
    const r = await call(method, params);
    if (r.error) throw new RetryableError(`RPC ${method} error`);
    return r.result;
  }

  return {
    async chainId() {
      if (chainIdCache === null) chainIdCache = String(await strict("eth_chainId", [])).toLowerCase();
      return chainIdCache;
    },
    getCode: (address) => strict("eth_getCode", [address, "latest"]),
    callOwner: (contract) => call("eth_call", [{ to: contract, data: OWNER_SELECTOR }, "latest"]),
  };
}

function hasCode(code) {
  return typeof code === "string" && /^0x[0-9a-fA-F]+$/.test(code) && !/^0x0*$/.test(code);
}

function isRevert(error) {
  const message = error && typeof error.message === "string" ? error.message : "";
  return (error && error.code === 3) || /revert/i.test(message);
}

// → { ok: true, owner } | { ok: false, reason }. Lempar RetryableError
// kalau RPC tidak bisa dipakai saat ini (coba lagi nanti).
async function readOwner(contract, rpc) {
  if ((await rpc.chainId()) !== CHAIN_ID_HEX) {
    // RPC yang dikonfigurasi bukan Robinhood Chain mainnet: jangan pernah
    // memutuskan apa pun dengan data dari chain lain.
    throw new RetryableError("RPC is not chain ID 4663");
  }
  if (!hasCode(await rpc.getCode(contract))) return { ok: false, reason: "not_a_contract" };

  const call = await rpc.callOwner(contract);
  if (call.error) {
    if (isRevert(call.error)) return { ok: false, reason: "no_owner" };
    throw new RetryableError("RPC eth_call error");
  }
  const owner = decodeAddressWord(call.result);
  if (!owner || owner === ZERO_ADDRESS) return { ok: false, reason: "no_owner" };
  if (hasCode(await rpc.getCode(owner))) return { ok: false, reason: "owner_is_contract" };
  return { ok: true, owner };
}

// ---------- keputusan (tanpa I/O database) ----------

// challenge: baris owner_proof_challenges; listing: { id, approved,
// contract_address } atau null. Hasil:
//   { action: "skip" }                         — bukan submitted (replay)
//   { action: "retry" }                        — RPC gagal, coba lagi nanti
//   { action: "reject", reason }
//   { action: "accept", proof }
async function decideChallenge({ challenge, listing, rpc, now = new Date() }) {
  if (!challenge || challenge.status !== "submitted") return { action: "skip" };

  const submittedAt = new Date(challenge.submitted_at);
  const expiresAt = new Date(challenge.expires_at);
  if (Number.isNaN(submittedAt.getTime()) || Number.isNaN(expiresAt.getTime()) || submittedAt > expiresAt) {
    return { action: "reject", reason: "expired" };
  }

  if (!listing || listing.approved !== true) return { action: "reject", reason: "listing_unavailable" };
  const contract = String(listing.contract_address || "").toLowerCase();
  if (!ADDRESS_PATTERN.test(contract) || contract !== challenge.contract_address) {
    return { action: "reject", reason: "contract_changed" };
  }

  const expected = buildMessage({
    listingId: listing.id,
    contract,
    nonce: challenge.nonce,
    expiresAt: challenge.expires_at,
  });
  if (expected !== challenge.message) return { action: "reject", reason: "message_mismatch" };

  const signer = recoverPersonalSigner(challenge.message, challenge.signature);
  if (!signer) return { action: "reject", reason: "bad_signature" };

  let owner;
  try {
    owner = await readOwner(contract, rpc);
  } catch (err) {
    if (!(err instanceof RetryableError)) throw err;
    if (now - submittedAt > RETRY_WINDOW_MS) return { action: "reject", reason: "check_failed" };
    return { action: "retry" };
  }
  if (!owner.ok) return { action: "reject", reason: owner.reason };
  if (owner.owner !== signer) return { action: "reject", reason: "not_owner" };

  return {
    action: "accept",
    proof: {
      agent_id: listing.id,
      signer,
      signed_at: submittedAt.toISOString(),
      owner_at_check: owner.owner,
      nonce: challenge.nonce,
      contract_address: contract,
      checked_at: now.toISOString(),
    },
  };
}

// proof: baris owner_proofs; listing: { contract_address } atau null.
//   { action: "keep", owner }   — owner() masih = signer
//   { action: "revoke", reason } — owner berubah / tidak bisa dibuktikan lagi
//   { action: "retry" }          — RPC gagal; bukti dibiarkan apa adanya
async function decideRecheck({ proof, listing, rpc }) {
  const contract = String((listing && listing.contract_address) || "").toLowerCase();
  if (!listing || contract !== proof.contract_address) return { action: "revoke", reason: "contract_changed" };

  let owner;
  try {
    owner = await readOwner(contract, rpc);
  } catch (err) {
    if (err instanceof RetryableError) return { action: "retry" };
    throw err;
  }
  if (!owner.ok) return { action: "revoke", reason: owner.reason };
  if (owner.owner !== proof.signer) return { action: "revoke", reason: "owner_changed" };
  return { action: "keep", owner: owner.owner };
}

// ---------- database (service role, scripts/review-lib.js) ----------

function db() {
  const { rest, filter } = require("./review-lib");
  return { rest, filter };
}

async function fetchListings(ids) {
  if (ids.length === 0) return new Map();
  const { rest } = db();
  const query = [`select=id,approved,contract_address`, `id=in.(${ids.map(encodeURIComponent).join(",")})`].join("&");
  const { data } = await rest("GET", "agents", query);
  return new Map((Array.isArray(data) ? data : []).map((row) => [String(row.id), row]));
}

async function expireOpenChallenges(now) {
  const { rest, filter } = db();
  const query = [filter("status", "eq", "open"), filter("expires_at", "lt", now.toISOString()), "select=id"].join("&");
  const { data } = await rest("PATCH", "owner_proof_challenges", query, {
    body: { status: "expired", reason: "expired", checked_at: now.toISOString() },
    prefer: "return=representation",
  });
  return Array.isArray(data) ? data.length : 0;
}

async function finishChallenge(id, status, reason, now) {
  const { rest, filter } = db();
  // Filter status=submitted: setiap nonce hanya bisa diputuskan sekali.
  const query = [filter("id", "eq", id), filter("status", "eq", "submitted"), "select=id"].join("&");
  const { data } = await rest("PATCH", "owner_proof_challenges", query, {
    body: { status, reason, checked_at: now.toISOString() },
    prefer: "return=representation",
  });
  return Array.isArray(data) && data.length === 1;
}

async function saveProof(proof) {
  const { rest } = db();
  await rest("POST", "owner_proofs", "on_conflict=agent_id", {
    body: proof,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

async function runVerify(rpc, now = new Date()) {
  const { rest, filter } = db();
  const expired = await expireOpenChallenges(now);

  const query = [
    "select=id,agent_id,contract_address,nonce,message,expires_at,signature,submitted_at,status",
    filter("status", "eq", "submitted"),
    "order=submitted_at.asc",
    `limit=${MAX_PER_RUN}`,
  ].join("&");
  const { data } = await rest("GET", "owner_proof_challenges", query);
  const challenges = Array.isArray(data) ? data : [];
  const listings = await fetchListings([...new Set(challenges.map((c) => String(c.agent_id)))]);

  const counts = { accepted: 0, rejected: 0, retry: 0 };
  for (const challenge of challenges) {
    const decision = await decideChallenge({ challenge, listing: listings.get(String(challenge.agent_id)) || null, rpc, now });
    if (decision.action === "retry") {
      counts.retry++;
      log(`${challenge.agent_id}: RPC unavailable, will retry`);
      continue;
    }
    if (decision.action === "skip") continue;

    if (decision.action === "accept") {
      if (!(await finishChallenge(challenge.id, "accepted", "accepted", now))) continue;
      await saveProof(decision.proof);
      counts.accepted++;
      log(`${challenge.agent_id}: accepted (contract ${decision.proof.contract_address})`);
    } else {
      if (!(await finishChallenge(challenge.id, "rejected", decision.reason, now))) continue;
      counts.rejected++;
      log(`${challenge.agent_id}: rejected (${decision.reason})`);
    }
  }
  log(`Verify done: ${counts.accepted} accepted, ${counts.rejected} rejected, ${counts.retry} to retry, ${expired} expired unsigned.`);
  return counts;
}

async function runRecheck(rpc, now = new Date()) {
  const { rest, filter } = db();
  const { data } = await rest("GET", "owner_proofs", "select=agent_id,signer,nonce,contract_address&order=checked_at.asc&limit=500");
  const proofs = Array.isArray(data) ? data : [];
  const listings = await fetchListings(proofs.map((p) => String(p.agent_id)));

  const counts = { kept: 0, revoked: 0, retry: 0 };
  for (const proof of proofs) {
    const decision = await decideRecheck({ proof, listing: listings.get(String(proof.agent_id)) || null, rpc });
    const match = [filter("agent_id", "eq", proof.agent_id), filter("nonce", "eq", proof.nonce)].join("&");
    if (decision.action === "keep") {
      await rest("PATCH", "owner_proofs", match, {
        body: { owner_at_check: decision.owner, checked_at: now.toISOString() },
        prefer: "return=minimal",
      });
      counts.kept++;
    } else if (decision.action === "revoke") {
      await rest("DELETE", "owner_proofs", match, { prefer: "return=minimal" });
      await rest("PATCH", "owner_proof_challenges", [filter("nonce", "eq", proof.nonce), filter("status", "eq", "accepted")].join("&"), {
        body: { status: "revoked", reason: decision.reason, checked_at: now.toISOString() },
        prefer: "return=minimal",
      });
      counts.revoked++;
      log(`${proof.agent_id}: signature removed (${decision.reason})`);
    } else {
      counts.retry++;
    }
  }
  log(`Recheck done: ${counts.kept} still valid, ${counts.revoked} removed, ${counts.retry} skipped (RPC unavailable).`);
  return counts;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const mode = argv[0];
  if (mode !== "verify" && mode !== "recheck") throw new Error("Usage: node scripts/owner-proof.js verify|recheck");

  const { requireEnv, rest } = require("./review-lib");
  requireEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

  // Pemeriksaan ulang ikut workflow Live check. Selama secret RPC belum
  // diisi dan belum ada bukti sama sekali, langkah itu dilewati tanpa
  // membuat run merah. Kalau sudah ada bukti, secret wajib ada.
  if (mode === "recheck" && !env.ROBINHOOD_CHAIN_RPC_URL) {
    const { data } = await rest("GET", "owner_proofs", "select=agent_id&limit=1");
    if (!Array.isArray(data) || data.length === 0) {
      log("ROBINHOOD_CHAIN_RPC_URL is not set and there are no owner signatures yet; nothing to recheck.");
      return { kept: 0, revoked: 0, retry: 0 };
    }
  }
  // Hanya NAMA env var yang dicetak, tidak pernah nilainya.
  if (!env.ROBINHOOD_CHAIN_RPC_URL) throw new Error("Missing environment variable(s): ROBINHOOD_CHAIN_RPC_URL");
  let rpcUrl;
  try {
    rpcUrl = new URL(env.ROBINHOOD_CHAIN_RPC_URL);
  } catch {
    throw new Error("ROBINHOOD_CHAIN_RPC_URL is not a valid URL.");
  }
  if (rpcUrl.protocol !== "https:") throw new Error("ROBINHOOD_CHAIN_RPC_URL must use https.");

  const rpc = createRpc(rpcUrl.href);
  return mode === "verify" ? runVerify(rpc) : runRecheck(rpc);
}

if (require.main === module) {
  main().catch((err) => {
    logError(`Failed: ${err && err.message ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DOMAIN,
  CHAIN_ID,
  REASONS,
  RetryableError,
  buildMessage,
  formatExpiry,
  createRpc,
  readOwner,
  decideChallenge,
  decideRecheck,
  runVerify,
  runRecheck,
  main,
};
