// ============================================================
// PERINGATAN: membuat data TEST di database lokal yang dibuat oleh
// tests/sql/run-owner-proof.sh. JANGAN arahkan ke Supabase asli.
// ============================================================
// 1. Pesan buatan request_owner_proof() (SQL) == buildMessage() (JS).
// 2. Alur lengkap dengan tanda tangan uji: submit_owner_proof sebagai anon
//    → decideChallenge dengan RPC tiruan (owner = penanda tangan) → bukti
//    ditulis seperti workflow → anon bisa membaca signer/signed_at.
// 3. Owner berbeda → ditolak not_owner.

const { execFileSync } = require("child_process");
const assert = require("assert/strict");
const op = require("../../scripts/owner-proof.js");
const { newWallet, personalSign } = require("../helpers/eth-sign.js");

function psql(sql, role) {
  const full = role ? `set role ${role}; ${sql}` : sql;
  return execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-qAt", "-c", full], { encoding: "utf8" }).trim();
}

function json(sql, role) {
  const out = psql(`select coalesce(json_agg(t), '[]') from (${sql}) t`, role);
  return JSON.parse(out.split("\n").pop());
}

function ok(label) {
  console.log(`OK: ${label}`);
}

const TOKEN = "f0000000-0000-4000-8000-000000000004";
const LISTING = "a0000000-0000-4000-8000-000000000004";
const CONTRACT = "0x5555555555555555555555555555555555555555";

function rpcFor(owner) {
  return {
    chainId: async () => "0x1237",
    getCode: async (a) => (a === owner ? "0x" : "0x6080"),
    callOwner: async () => ({ result: `0x${"0".repeat(24)}${owner.slice(2)}` }),
  };
}

async function round(wallet, ownerAddress) {
  const [req] = json(`select * from public.request_owner_proof('${TOKEN}')`, "anon");
  const [row] = json(`select agent_id, contract_address, nonce, message, expires_at from public.owner_proof_challenges where nonce = '${req.nonce}'`);
  const js = op.buildMessage({ listingId: row.agent_id, contract: row.contract_address, nonce: row.nonce, expiresAt: row.expires_at });
  assert.equal(js, req.message, "SQL and JS build the same message");

  const signature = personalSign(req.message, wallet);
  const [sub] = json(`select * from public.submit_owner_proof('${TOKEN}', '${req.nonce}', '${signature}')`, "anon");
  assert.equal(sub.status, "submitted");

  const [challenge] = json(`select * from public.owner_proof_challenges where nonce = '${req.nonce}'`);
  const [listing] = json(`select id, approved, contract_address from public.agents where id = '${LISTING}'`);
  return op.decideChallenge({ challenge, listing, rpc: rpcFor(ownerAddress) });
}

(async () => {
  psql(`insert into public.agents (id, name, description, version, repo_url, category, approved, contract_address, status_token)
        values ('${LISTING}', 'TEST Crosscheck', 'd', '1', 'https://github.com/x/4', '{t}', true, '${CONTRACT}', '${TOKEN}')`);

  const owner = newWallet();
  const d1 = await round(owner, owner.address);
  assert.equal(d1.action, "accept");
  ok("SQL message == buildMessage(); owner signature accepted");

  // Write it like the workflow does, then read it as the public.
  const p = d1.proof;
  psql(`insert into public.owner_proofs (agent_id, signer, signed_at, owner_at_check, nonce, contract_address, checked_at)
        values ('${p.agent_id}', '${p.signer}', '${p.signed_at}', '${p.owner_at_check}', '${p.nonce}', '${p.contract_address}', '${p.checked_at}')`);
  const pub = json(`select agent_id, signer, signed_at from public.owner_proofs where agent_id = '${LISTING}'`, "anon");
  assert.equal(pub.length, 1);
  assert.equal(pub[0].signer, owner.address);
  ok("public can read signer and signed_at of the new proof");

  const stranger = newWallet();
  const d2 = await round(stranger, owner.address);
  assert.deepEqual(d2, { action: "reject", reason: "not_owner" });
  ok("signature from another wallet → not_owner");
})().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
