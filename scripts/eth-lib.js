// ============================================
// Agraris — helper Ethereum kecil (hanya untuk VERIFIKASI)
// ============================================
// Dipakai scripts/owner-proof.js untuk memeriksa tanda tangan
// personal_sign (EIP-191) dari builder:
//   - keccak256          → @noble/hashes (keccak_256)
//   - personalMessageHash: keccak256("\x19Ethereum Signed Message:\n" + len + pesan)
//   - recoverAddress     → @noble/curves (secp256k1, ecrecover)
//
// Kriptografinya dari pustaka teraudit @noble/hashes dan @noble/curves.
// Versinya dipin eksak di package.json dan package-lock.json (dengan hash
// integritas), dan workflow memasangnya dengan `npm ci`, jadi versinya
// tidak bisa berubah diam-diam. Versi 1.x dipakai karena mendukung
// require() (CommonJS) seperti skrip lain di repo ini.
//
// Tidak ada fungsi untuk MEMBUAT tanda tangan atau menyimpan kunci di sini.
// Input yang aneh selalu menghasilkan null, tidak pernah alamat:
//   - panjang selain 65 byte, hex tidak sah;
//   - v selain 27/28 (atau 0/1);
//   - r atau s di luar 1..n-1;
//   - s "tinggi" (s > n/2): tanda tangan malleable, tidak pernah dibuat
//     wallet modern (EIP-2), jadi ditolak.

const { secp256k1 } = require("@noble/curves/secp256k1");
const { keccak_256 } = require("@noble/hashes/sha3");

const N = secp256k1.CURVE.n;
const HALF_N = N >> 1n;

// Buffer/Uint8Array → Buffer 32 byte.
function keccak256(data) {
  return Buffer.from(keccak_256(Uint8Array.from(Buffer.from(data))));
}

// k·G dalam bentuk affine { x, y } (BigInt).
function pointFromScalar(k) {
  const scalar = ((k % N) + N) % N;
  return secp256k1.ProjectivePoint.BASE.multiply(scalar).toAffine();
}

function hex32(n) {
  return n.toString(16).padStart(64, "0");
}

// Titik publik (affine) → alamat 0x… huruf kecil.
function addressFromPoint(pt) {
  const raw = Buffer.from(hex32(pt.x) + hex32(pt.y), "hex");
  return `0x${keccak256(raw).subarray(12).toString("hex")}`;
}

// ecrecover. hash: Buffer 32 byte. r, s: BigInt. recid: 0 | 1.
// Mengembalikan titik publik affine, atau null kalau input tidak sah.
// Tidak memeriksa low-s (itu kebijakan recoverPersonalSigner).
function recoverPoint(hash, r, s, recid) {
  if (!Buffer.isBuffer(hash) || hash.length !== 32) return null;
  if (typeof r !== "bigint" || typeof s !== "bigint") return null;
  if (r <= 0n || r >= N || s <= 0n || s >= N) return null;
  if (recid !== 0 && recid !== 1) return null;
  try {
    const point = new secp256k1.Signature(r, s).addRecoveryBit(recid).recoverPublicKey(Uint8Array.from(hash));
    point.assertValidity();
    return point.toAffine();
  } catch {
    return null;
  }
}

// ---------- EIP-191 ----------

function personalMessageHash(message) {
  const bytes = Buffer.from(String(message), "utf8");
  const prefix = Buffer.from(`\x19Ethereum Signed Message:\n${bytes.length}`, "utf8");
  return keccak256(Buffer.concat([prefix, bytes]));
}

// "0x" + 130 hex (r 32 byte, s 32 byte, v 1 byte). v 27/28 atau 0/1.
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;

// → { r, s, recid } atau null. Menolak s tinggi (malleable).
function parseSignature(sig) {
  if (typeof sig !== "string" || !SIGNATURE_PATTERN.test(sig)) return null;
  const buf = Buffer.from(sig.slice(2), "hex");
  const r = BigInt(`0x${buf.subarray(0, 32).toString("hex")}`);
  const s = BigInt(`0x${buf.subarray(32, 64).toString("hex")}`);
  let v = buf[64];
  if (v === 27 || v === 28) v -= 27;
  if (v !== 0 && v !== 1) return null;
  if (r <= 0n || r >= N || s <= 0n || s > HALF_N) return null;
  return { r, s, recid: v };
}

// Alamat penanda tangan pesan personal_sign, huruf kecil; null kalau
// tanda tangan tidak sah.
function recoverPersonalSigner(message, signature) {
  const parsed = parseSignature(signature);
  if (!parsed) return null;
  const q = recoverPoint(personalMessageHash(message), parsed.r, parsed.s, parsed.recid);
  return q ? addressFromPoint(q) : null;
}

// ---------- ABI / alamat ----------

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

// keccak256("owner()") empat byte pertama.
const OWNER_SELECTOR = `0x${keccak256(Buffer.from("owner()")).subarray(0, 4).toString("hex")}`;

// Hasil eth_call 32 byte → alamat 0x… huruf kecil; null kalau bentuknya
// bukan satu word alamat (12 byte nol di depan).
function decodeAddressWord(hex) {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  const body = hex.slice(2).toLowerCase();
  if (!/^0{24}/.test(body)) return null;
  return `0x${body.slice(24)}`;
}

module.exports = {
  N,
  keccak256,
  pointFromScalar,
  addressFromPoint,
  recoverPoint,
  personalMessageHash,
  parseSignature,
  recoverPersonalSigner,
  ADDRESS_PATTERN,
  OWNER_SELECTOR,
  decodeAddressWord,
};
