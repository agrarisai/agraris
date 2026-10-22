// Tes vektor untuk scripts/eth-lib.js (yang memakai @noble/curves dan
// @noble/hashes). Jalankan dari root repo: node --test
//
// tests/fixtures/ethers-personal-sign-vectors.json berisi tanda tangan
// personal_sign buatan ethers@6.13.4 dengan kunci acak sekali pakai,
// termasuk pesan dengan format Agraris yang sebenarnya. Setiap vektor juga
// punya "malleable": tanda tangan yang sama dengan s diganti n - s dan v
// dibalik. ethers menolaknya; kita juga harus menolaknya.

const test = require("node:test");
const assert = require("node:assert/strict");

const eth = require("../scripts/eth-lib.js");
const op = require("../scripts/owner-proof.js");
const { vectors } = require("./fixtures/ethers-personal-sign-vectors.json");

const HALF_N = eth.N >> 1n;

function parts(sig) {
  return {
    r: BigInt(`0x${sig.slice(2, 66)}`),
    s: BigInt(`0x${sig.slice(66, 130)}`),
    v: parseInt(sig.slice(130), 16),
  };
}

function withV(sig, v) {
  return `${sig.slice(0, 130)}${v.toString(16).padStart(2, "0")}`;
}

test("vectors file is present and non-trivial", () => {
  assert.ok(vectors.length >= 5);
  assert.ok(vectors.some((v) => v.message.startsWith("agraris.xyz asks you to sign")));
  assert.ok(vectors.some((v) => v.message === ""));
});

test("EIP-191 hash matches ethers.hashMessage", () => {
  for (const v of vectors) {
    assert.equal(`0x${eth.personalMessageHash(v.message).toString("hex")}`, v.hash);
  }
});

test("signatures made by ethers recover the signer address", () => {
  for (const v of vectors) {
    assert.equal(eth.recoverPersonalSigner(v.message, v.signature), v.address);
    // Same signature with v as 0/1 instead of 27/28.
    assert.equal(eth.recoverPersonalSigner(v.message, withV(v.signature, parts(v.signature).v - 27)), v.address);
  }
});

test("a signature never recovers its signer for a different message", () => {
  for (const v of vectors) {
    assert.notEqual(eth.recoverPersonalSigner(`${v.message} `, v.signature), v.address);
  }
});

test("malleable signatures (high s) are rejected", () => {
  for (const v of vectors) {
    const m = parts(v.malleable);
    assert.ok(m.s > HALF_N, "fixture really has a high s");
    // It is a real ECDSA twin: the low-level recovery gives the same key...
    const pt = eth.recoverPoint(eth.personalMessageHash(v.message), m.r, m.s, m.v - 27);
    assert.equal(eth.addressFromPoint(pt), v.address);
    // ...but personal_sign verification refuses it.
    assert.equal(eth.recoverPersonalSigner(v.message, v.malleable), null);
    assert.equal(eth.parseSignature(v.malleable), null);
  }
});

test("low-s boundary: s = n/2 parses, s = n/2 + 1 does not", () => {
  const r = `${"1".padStart(64, "0")}`;
  const ok = `0x${r}${HALF_N.toString(16).padStart(64, "0")}1b`;
  const high = `0x${r}${(HALF_N + 1n).toString(16).padStart(64, "0")}1b`;
  assert.ok(eth.parseSignature(ok));
  assert.equal(eth.parseSignature(high), null);
});

test("invalid v values are rejected", () => {
  const v = vectors[0];
  for (const bad of [2, 3, 26, 29, 30, 35, 36, 37, 38, 0x7f, 0xff]) {
    assert.equal(eth.recoverPersonalSigner(v.message, withV(v.signature, bad)), null, `v = ${bad}`);
  }
});

test("broken signatures are rejected", () => {
  const v = vectors[0];
  const { r, s } = parts(v.signature);
  const hex = (n) => n.toString(16).padStart(64, "0");
  const tail = v.signature.slice(130);
  const broken = [
    null,
    undefined,
    42,
    "",
    "0x",
    v.signature.slice(0, -2),
    `${v.signature}00`,
    v.signature.replace("0x", "0X"),
    v.signature.replace("0x", ""),
    `0x${"g".repeat(130)}`,
    `0x${hex(0n)}${hex(s)}${tail}`,
    `0x${hex(r)}${hex(0n)}${tail}`,
    `0x${hex(eth.N)}${hex(s)}${tail}`,
    `0x${hex(r)}${hex(eth.N)}${tail}`,
    `0x${"f".repeat(64)}${hex(s)}${tail}`,
  ];
  for (const sig of broken) {
    assert.equal(eth.recoverPersonalSigner(v.message, sig), null, `rejected: ${String(sig).slice(0, 24)}`);
  }
});

test("the server decision accepts the ethers signature and refuses its malleable twin", async () => {
  const v = vectors.find((x) => x.message.startsWith("agraris.xyz asks you to sign"));
  const fields = {
    listingId: "a0000000-0000-4000-8000-000000000001",
    contract: "0x467b7a85f55bd716cb16d59f63b8ccac08852a6d",
    nonce: "0123456789abcdef0123456789abcdef",
    expiresAt: "2026-10-22T10:10:00Z",
  };
  assert.equal(op.buildMessage(fields), v.message, "fixture uses the real Agraris message format");
  const rpc = {
    chainId: async () => "0x1237",
    getCode: async (a) => (a === v.address ? "0x" : "0x6080"),
    callOwner: async () => ({ result: `0x${"0".repeat(24)}${v.address.slice(2)}` }),
  };
  const challenge = {
    id: 1,
    agent_id: fields.listingId,
    contract_address: fields.contract,
    nonce: fields.nonce,
    message: v.message,
    expires_at: fields.expiresAt,
    signature: v.signature,
    submitted_at: "2026-10-22T10:05:00Z",
    status: "submitted",
  };
  const listing = { id: fields.listingId, approved: true, contract_address: fields.contract };
  const now = new Date("2026-10-22T10:20:00Z");
  const accepted = await op.decideChallenge({ challenge, listing, rpc, now });
  assert.equal(accepted.action, "accept");
  assert.equal(accepted.proof.signer, v.address);
  const refused = await op.decideChallenge({ challenge: { ...challenge, signature: v.malleable }, listing, rpc, now });
  assert.deepEqual(refused, { action: "reject", reason: "bad_signature" });
});
