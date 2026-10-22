// Tes untuk scripts/eth-lib.js dan scripts/owner-proof.js.
// Jalankan dari root repo: node --test
// Tanpa jaringan: RPC Robinhood Chain diganti tiruan. Tanda tangan dibuat
// di tes ini dengan private key acak (bukan kunci asli).

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const eth = require("../scripts/eth-lib.js");
const op = require("../scripts/owner-proof.js");

const { hex32, newWallet, personalSign } = require("./helpers/eth-sign.js");

// ---------- keccak256 dan alamat ----------

test("keccak256 matches known vectors", () => {
  assert.equal(eth.keccak256(Buffer.alloc(0)).toString("hex"), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(eth.keccak256(Buffer.from("abc")).toString("hex"), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  // Bukan SHA3-256 (padding berbeda).
  assert.notEqual(eth.keccak256(Buffer.from("abc")).toString("hex"), crypto.createHash("sha3-256").update("abc").digest("hex"));
});

test("function selectors match the well-known values", () => {
  assert.equal(eth.OWNER_SELECTOR, "0x8da5cb5b");
  assert.equal(eth.keccak256(Buffer.from("transfer(address,uint256)")).subarray(0, 4).toString("hex"), "a9059cbb");
});

test("addresses of private keys 1 and 2 are the well-known ones", () => {
  assert.equal(eth.addressFromPoint(eth.pointFromScalar(1n)), "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
  assert.equal(eth.addressFromPoint(eth.pointFromScalar(2n)), "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf");
});

test("curve math agrees with OpenSSL (node:crypto ECDH) for random keys", () => {
  for (let i = 0; i < 10; i++) {
    const ecdh = crypto.createECDH("secp256k1");
    ecdh.generateKeys();
    const d = BigInt(`0x${ecdh.getPrivateKey("hex")}`);
    const pub = ecdh.getPublicKey(null, "uncompressed");
    const pt = eth.pointFromScalar(d);
    assert.equal(hex32(pt.x) + hex32(pt.y), pub.subarray(1).toString("hex"));
  }
});

test("recovery works on signatures made by OpenSSL (independent signer)", () => {
  for (let i = 0; i < 10; i++) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "secp256k1" });
    const data = crypto.randomBytes(40);
    const sig = crypto.sign("sha256", data, { key: privateKey, dsaEncoding: "ieee-p1363" });
    const hash = crypto.createHash("sha256").update(data).digest();
    const r = BigInt(`0x${sig.subarray(0, 32).toString("hex")}`);
    const s = BigInt(`0x${sig.subarray(32).toString("hex")}`);
    const jwk = publicKey.export({ format: "jwk" });
    const expected = `${Buffer.from(jwk.x, "base64url").toString("hex")}${Buffer.from(jwk.y, "base64url").toString("hex")}`;
    const found = [0, 1]
      .map((recid) => eth.recoverPoint(hash, r, s, recid))
      .filter(Boolean)
      .map((pt) => hex32(pt.x) + hex32(pt.y));
    assert.ok(found.includes(expected), "one recovery id gives the OpenSSL public key");
  }
});

// ---------- EIP-191 ----------

test("personal_sign signatures recover the signer; tampering does not", () => {
  const wallet = newWallet();
  for (const message of ["hello", "", "émoji ✓ 🚀", "x".repeat(600)]) {
    const sig = personalSign(message, wallet);
    assert.equal(eth.recoverPersonalSigner(message, sig), wallet.address);
    assert.notEqual(eth.recoverPersonalSigner(`${message}.`, sig), wallet.address);
    // v sebagai 0/1 juga diterima
    const v01 = `${sig.slice(0, 130)}${(parseInt(sig.slice(130), 16) - 27).toString(16).padStart(2, "0")}`;
    assert.equal(eth.recoverPersonalSigner(message, v01), wallet.address);
  }
});

test("malformed signatures never recover an address", () => {
  const wallet = newWallet();
  const good = personalSign("m", wallet);
  const zeroR = `0x${"0".repeat(64)}${good.slice(66)}`;
  const zeroS = `${good.slice(0, 66)}${"0".repeat(64)}${good.slice(130)}`;
  const bigS = `${good.slice(0, 66)}${"f".repeat(64)}${good.slice(130)}`;
  for (const sig of [null, "", "0x", good.slice(0, -2), `${good}00`, `${good.slice(0, 130)}1d`, zeroR, zeroS, bigS, good.replace("0x", "0X"), `0x${"zz".repeat(65)}`]) {
    assert.equal(eth.recoverPersonalSigner("m", sig), null, `rejected: ${String(sig).slice(0, 20)}`);
  }
});

test("decodeAddressWord only accepts one 32-byte address word", () => {
  const a = "0x" + "0".repeat(24) + "ab".repeat(20);
  assert.equal(eth.decodeAddressWord(a), `0x${"ab".repeat(20)}`);
  assert.equal(eth.decodeAddressWord("0x"), null);
  assert.equal(eth.decodeAddressWord(`0x${"1".repeat(64)}`), null);
  assert.equal(eth.decodeAddressWord(`${a}00`), null);
});

// ---------- pesan ----------

const LISTING = "a0000000-0000-4000-8000-000000000001";
const CONTRACT = "0x467b7a85f55bd716cb16d59f63b8ccac08852a6d";
const NONCE = "0123456789abcdef0123456789abcdef";

test("message contains domain, listing id, contract, chain ID, nonce and expiry", () => {
  const m = op.buildMessage({ listingId: LISTING.toUpperCase(), contract: CONTRACT.toUpperCase().replace("0X", "0x"), nonce: NONCE, expiresAt: "2026-10-22T10:10:00+00:00" });
  assert.equal(
    m,
    [
      "agraris.xyz asks you to sign this message to show that this wallet is the owner() of the contract below.",
      "",
      "Domain: agraris.xyz",
      `Listing ID: ${LISTING}`,
      `Contract: ${CONTRACT}`,
      "Chain ID: 4663",
      `Nonce: ${NONCE}`,
      "Expires at: 2026-10-22T10:10:00Z",
      "",
      "Signing does not send a transaction.",
    ].join("\n")
  );
  assert.doesNotMatch(m, /\b(token|price|verified|trusted|recommended)\b/i);
});

// ---------- keputusan verifikasi ----------

function rpcMock({ chainId = "0x1237", contractCode = "0x6080", owner, ownerCode = "0x", ownerCall, fail = null } = {}) {
  const calls = [];
  return {
    calls,
    async chainId() {
      calls.push("chainId");
      if (fail === "chainId") throw new op.RetryableError("down");
      return chainId;
    },
    async getCode(addr) {
      calls.push(`getCode:${addr}`);
      if (fail === "getCode") throw new op.RetryableError("down");
      return addr === owner ? ownerCode : contractCode;
    },
    async callOwner() {
      calls.push("callOwner");
      if (fail === "callOwner") throw new op.RetryableError("down");
      if (ownerCall) return ownerCall;
      return { result: `0x${"0".repeat(24)}${owner.slice(2)}` };
    },
  };
}

function scenario({ signer = newWallet(), expiresInMs = 10 * 60 * 1000, submittedAfterMs = 60 * 1000, now } = {}) {
  const created = new Date("2026-10-22T10:00:00Z");
  const expiresAt = new Date(created.getTime() + expiresInMs).toISOString().replace(/\.\d{3}Z$/, "Z");
  const message = op.buildMessage({ listingId: LISTING, contract: CONTRACT, nonce: NONCE, expiresAt });
  const challenge = {
    id: 1,
    agent_id: LISTING,
    contract_address: CONTRACT,
    nonce: NONCE,
    message,
    expires_at: expiresAt,
    signature: personalSign(message, signer),
    submitted_at: new Date(created.getTime() + submittedAfterMs).toISOString(),
    status: "submitted",
  };
  const listing = { id: LISTING, approved: true, contract_address: CONTRACT };
  return { signer, challenge, listing, now: now || new Date(created.getTime() + 15 * 60 * 1000) };
}

test("accepted when the signer is the current owner()", async () => {
  const s = scenario();
  const rpc = rpcMock({ owner: s.signer.address });
  const d = await op.decideChallenge({ ...s, rpc });
  assert.equal(d.action, "accept");
  assert.deepEqual(d.proof, {
    agent_id: LISTING,
    signer: s.signer.address,
    signed_at: s.challenge.submitted_at,
    owner_at_check: s.signer.address,
    nonce: NONCE,
    contract_address: CONTRACT,
    checked_at: s.now.toISOString(),
  });
  assert.ok(rpc.calls.includes("chainId"));
});

test("rejected when the signer is not the owner (different owner)", async () => {
  const s = scenario();
  const someoneElse = newWallet();
  const d = await op.decideChallenge({ ...s, rpc: rpcMock({ owner: someoneElse.address }) });
  assert.deepEqual(d, { action: "reject", reason: "not_owner" });
});

test("replay: a challenge that is not 'submitted' is never decided again", async () => {
  const s = scenario();
  for (const status of ["accepted", "rejected", "expired", "revoked", "open"]) {
    const rpc = rpcMock({ owner: s.signer.address });
    const d = await op.decideChallenge({ ...s, challenge: { ...s.challenge, status }, rpc });
    assert.deepEqual(d, { action: "skip" }, status);
    assert.equal(rpc.calls.length, 0, "no RPC calls for a used challenge");
  }
});

test("replay: a signature for one challenge does not fit another nonce, listing or contract", async () => {
  const s = scenario();
  const rpc = rpcMock({ owner: s.signer.address });
  // Same signature, but the stored message belongs to a new nonce.
  const otherNonce = "fedcba9876543210fedcba9876543210";
  const msg2 = op.buildMessage({ listingId: LISTING, contract: CONTRACT, nonce: otherNonce, expiresAt: s.challenge.expires_at });
  let d = await op.decideChallenge({ ...s, challenge: { ...s.challenge, nonce: otherNonce, message: msg2 }, rpc });
  assert.deepEqual(d, { action: "reject", reason: "not_owner" }, "recovered address differs → not the owner");
  // Message not matching the challenge fields at all
  d = await op.decideChallenge({ ...s, challenge: { ...s.challenge, nonce: otherNonce }, rpc });
  assert.deepEqual(d, { action: "reject", reason: "message_mismatch" });
  // Another listing
  d = await op.decideChallenge({ ...s, listing: { ...s.listing, id: "a0000000-0000-4000-8000-000000000002" }, rpc });
  assert.deepEqual(d, { action: "reject", reason: "message_mismatch" });
});

test("expired: signature submitted after expires_at is rejected", async () => {
  const s = scenario({ submittedAfterMs: 11 * 60 * 1000 });
  const d = await op.decideChallenge({ ...s, rpc: rpcMock({ owner: s.signer.address }) });
  assert.deepEqual(d, { action: "reject", reason: "expired" });
});

test("submitted in time but checked later is still fine", async () => {
  const s = scenario({ now: new Date("2026-10-22T12:00:00Z") });
  const d = await op.decideChallenge({ ...s, rpc: rpcMock({ owner: s.signer.address }) });
  assert.equal(d.action, "accept");
});

test("contract changed or listing unavailable → rejected", async () => {
  const s = scenario();
  const rpc = rpcMock({ owner: s.signer.address });
  assert.deepEqual(await op.decideChallenge({ ...s, listing: { ...s.listing, contract_address: `0x${"1".repeat(40)}` }, rpc }), { action: "reject", reason: "contract_changed" });
  assert.deepEqual(await op.decideChallenge({ ...s, listing: { ...s.listing, approved: false }, rpc }), { action: "reject", reason: "listing_unavailable" });
  assert.deepEqual(await op.decideChallenge({ ...s, listing: null, rpc }), { action: "reject", reason: "listing_unavailable" });
});

test("bad signature → rejected", async () => {
  const s = scenario();
  const d = await op.decideChallenge({ ...s, challenge: { ...s.challenge, signature: `0x${"0".repeat(130)}` }, rpc: rpcMock({ owner: s.signer.address }) });
  assert.deepEqual(d, { action: "reject", reason: "bad_signature" });
});

test("contracts that can't be proved: no owner(), zero owner, owner is a contract, no code", async () => {
  const s = scenario();
  const owner = s.signer.address;
  const cases = [
    [rpcMock({ owner, ownerCall: { error: { code: 3, message: "execution reverted" } } }), "no_owner"],
    [rpcMock({ owner, ownerCall: { error: { code: -32000, message: "execution reverted" } } }), "no_owner"],
    [rpcMock({ owner, ownerCall: { result: "0x" } }), "no_owner"],
    [rpcMock({ owner, ownerCall: { result: `0x${"0".repeat(64)}` } }), "no_owner"],
    [rpcMock({ owner, ownerCode: "0x6080604052" }), "owner_is_contract"],
    [rpcMock({ owner, contractCode: "0x" }), "not_a_contract"],
  ];
  for (const [rpc, reason] of cases) {
    assert.deepEqual(await op.decideChallenge({ ...s, rpc }), { action: "reject", reason });
  }
});

test("RPC on the wrong chain or unreachable → retry, then check_failed after 24h", async () => {
  const s = scenario();
  const owner = s.signer.address;
  for (const rpc of [rpcMock({ owner, chainId: "0x1" }), rpcMock({ owner, fail: "getCode" }), rpcMock({ owner, ownerCall: { error: { code: -32603, message: "internal error" } } })]) {
    assert.deepEqual(await op.decideChallenge({ ...s, rpc }), { action: "retry" });
  }
  const late = { ...s, now: new Date(new Date(s.challenge.submitted_at).getTime() + 25 * 60 * 60 * 1000) };
  assert.deepEqual(await op.decideChallenge({ ...late, rpc: rpcMock({ owner, fail: "callOwner" }) }), { action: "reject", reason: "check_failed" });
});

// ---------- pemeriksaan ulang ----------

test("recheck keeps the proof while owner() is the signer, removes it when it changes", async () => {
  const signer = newWallet();
  const proof = { agent_id: LISTING, signer: signer.address, nonce: NONCE, contract_address: CONTRACT };
  const listing = { contract_address: CONTRACT };
  assert.deepEqual(await op.decideRecheck({ proof, listing, rpc: rpcMock({ owner: signer.address }) }), { action: "keep", owner: signer.address });
  assert.deepEqual(await op.decideRecheck({ proof, listing, rpc: rpcMock({ owner: newWallet().address }) }), { action: "revoke", reason: "owner_changed" });
  assert.deepEqual(await op.decideRecheck({ proof, listing, rpc: rpcMock({ owner: signer.address, ownerCall: { result: `0x${"0".repeat(64)}` } }) }), { action: "revoke", reason: "no_owner" });
  assert.deepEqual(await op.decideRecheck({ proof, listing: { contract_address: `0x${"2".repeat(40)}` }, rpc: rpcMock({ owner: signer.address }) }), { action: "revoke", reason: "contract_changed" });
  // RPC down → keep as is (no punishment for our own outage)
  assert.deepEqual(await op.decideRecheck({ proof, listing, rpc: rpcMock({ owner: signer.address, fail: "chainId" }) }), { action: "retry" });
});

// ---------- RPC client ----------

test("createRpc: JSON-RPC errors are returned, transport errors are retryable", async () => {
  const replies = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    replies.push(body.method);
    if (body.method === "eth_chainId") return { ok: true, json: async () => ({ result: "0x1237" }) };
    if (body.method === "eth_call") return { ok: true, json: async () => ({ error: { code: 3, message: "execution reverted" } }) };
    return { ok: false, status: 502, json: async () => ({}) };
  };
  const rpc = op.createRpc("https://rpc.example.invalid", fetchImpl);
  assert.equal(await rpc.chainId(), "0x1237");
  assert.equal(await rpc.chainId(), "0x1237");
  assert.equal(replies.filter((m) => m === "eth_chainId").length, 1, "chain id cached");
  assert.deepEqual(await rpc.callOwner(CONTRACT), { error: { code: 3, message: "execution reverted" } });
  await assert.rejects(rpc.getCode(CONTRACT), op.RetryableError);
  const down = op.createRpc("https://rpc.example.invalid", async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(down.chainId(), op.RetryableError);
});

test("main refuses a non-https RPC URL and needs the URL when proofs exist", async () => {
  const env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const origFetch = global.fetch;
  try {
    await assert.rejects(op.main(["verify"], { ...env, ROBINHOOD_CHAIN_RPC_URL: "http://plain.example" }), /must use https/);
    await assert.rejects(op.main(["nope"], env), /Usage/);
    // recheck without RPC URL: fine while there are no proofs, error when there are
    delete process.env.ROBINHOOD_CHAIN_RPC_URL;
    global.fetch = async () => ({ ok: true, headers: { get: () => "" }, text: async () => "[]" });
    assert.deepEqual(await op.main(["recheck"], env), { kept: 0, revoked: 0, retry: 0 });
    global.fetch = async () => ({ ok: true, headers: { get: () => "" }, text: async () => JSON.stringify([{ agent_id: LISTING }]) });
    await assert.rejects(op.main(["recheck"], env), /ROBINHOOD_CHAIN_RPC_URL/);
  } finally {
    global.fetch = origFetch;
    process.env = saved;
  }
});

// ---------- database flow (Supabase REST tiruan) ----------

function restMock(handler) {
  const calls = [];
  const saved = { ...process.env };
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
  const orig = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const call = { method: opts.method || "GET", table: u.pathname.replace("/rest/v1/", ""), query: decodeURIComponent(u.search.slice(1)), body: opts.body ? JSON.parse(opts.body) : undefined, prefer: opts.headers && opts.headers.Prefer };
    calls.push(call);
    const data = handler(call);
    return { ok: true, status: 200, headers: { get: () => "" }, text: async () => (data === undefined ? "" : JSON.stringify(data)) };
  };
  return {
    calls,
    restore() {
      global.fetch = orig;
      process.env = saved;
    },
  };
}

test("runVerify: claims the nonce (status=submitted filter) before writing the proof", async () => {
  const s = scenario();
  const mock = restMock((c) => {
    if (c.table === "owner_proof_challenges" && c.method === "GET") return [s.challenge];
    if (c.table === "agents") return [s.listing];
    if (c.method === "PATCH") return [{ id: 1 }];
    return undefined;
  });
  try {
    const counts = await op.runVerify(rpcMock({ owner: s.signer.address }), s.now);
    assert.deepEqual(counts, { accepted: 1, rejected: 0, retry: 0 });
    const writes = mock.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.table}`);
    assert.deepEqual(writes, ["PATCH owner_proof_challenges", "PATCH owner_proof_challenges", "POST owner_proofs"]);
    const [expire, claim, upsert] = mock.calls.filter((c) => c.method !== "GET");
    assert.match(expire.query, /status=eq\.open/);
    assert.match(expire.query, /expires_at=lt\./);
    assert.match(claim.query, /id=eq\.1/);
    assert.match(claim.query, /status=eq\.submitted/);
    assert.deepEqual({ status: claim.body.status, reason: claim.body.reason }, { status: "accepted", reason: "accepted" });
    assert.match(upsert.query, /on_conflict=agent_id/);
    assert.match(upsert.prefer, /resolution=merge-duplicates/);
    assert.equal(upsert.body.signer, s.signer.address);
    const read = mock.calls.find((c) => c.table === "owner_proof_challenges" && c.method === "GET");
    assert.match(read.query, /status=eq\.submitted/);
  } finally {
    mock.restore();
  }
});

test("runVerify: if another run already decided the nonce, no proof is written", async () => {
  const s = scenario();
  const mock = restMock((c) => {
    if (c.table === "owner_proof_challenges" && c.method === "GET") return [s.challenge];
    if (c.table === "agents") return [s.listing];
    if (c.method === "PATCH") return c.query.includes("status=eq.submitted") ? [] : [{ id: 9 }];
    return undefined;
  });
  try {
    const counts = await op.runVerify(rpcMock({ owner: s.signer.address }), s.now);
    assert.equal(counts.accepted, 0);
    assert.equal(mock.calls.some((c) => c.table === "owner_proofs"), false);
  } finally {
    mock.restore();
  }
});

test("runRecheck: owner changed → proof deleted and request marked revoked", async () => {
  const signer = newWallet();
  const proof = { agent_id: LISTING, signer: signer.address, nonce: NONCE, contract_address: CONTRACT };
  const mock = restMock((c) => {
    if (c.table === "owner_proofs" && c.method === "GET") return [proof];
    if (c.table === "agents") return [{ id: LISTING, approved: true, contract_address: CONTRACT }];
    return undefined;
  });
  try {
    const counts = await op.runRecheck(rpcMock({ owner: newWallet().address }), new Date("2026-10-22T12:00:00Z"));
    assert.deepEqual(counts, { kept: 0, revoked: 1, retry: 0 });
    const del = mock.calls.find((c) => c.method === "DELETE");
    assert.equal(del.table, "owner_proofs");
    assert.match(del.query, new RegExp(`agent_id=eq\\.${LISTING}`));
    assert.match(del.query, new RegExp(`nonce=eq\\.${NONCE}`));
    const mark = mock.calls.find((c) => c.method === "PATCH" && c.table === "owner_proof_challenges");
    assert.deepEqual({ status: mark.body.status, reason: mark.body.reason }, { status: "revoked", reason: "owner_changed" });
    assert.match(mark.query, /status=eq\.accepted/);
  } finally {
    mock.restore();
  }
});
