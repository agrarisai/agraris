// ============================================
// Agraris — helper Ethereum kecil tanpa dependensi (hanya untuk VERIFIKASI)
// ============================================
// Dipakai scripts/owner-proof.js untuk memeriksa tanda tangan
// personal_sign (EIP-191) dari builder:
//   - keccak256          (Node punya sha3-256, tapi padding-nya berbeda
//                         dengan Keccak yang dipakai Ethereum)
//   - personalMessageHash: keccak256("\x19Ethereum Signed Message:\n" + len + pesan)
//   - recoverAddress     : ecrecover secp256k1 → alamat 0x… (huruf kecil)
//
// Tidak ada fungsi untuk MEMBUAT tanda tangan atau menyimpan kunci di sini.
// Semua input diperiksa ketat (panjang, rentang r/s, v, titik di kurva);
// input yang aneh selalu menghasilkan null, tidak pernah alamat.
//
// Diuji di tests/owner-proof.test.js terhadap vektor Keccak yang dikenal,
// alamat dari private key 1 dan 2, dan tanda tangan buatan OpenSSL (modul
// crypto Node) untuk memastikan perhitungan kurvanya benar.

// ---------- keccak256 ----------

const MASK64 = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
// Rotasi per lane (indeks x + 5y).
const ROT = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

function rotl(v, n) {
  if (n === 0) return v;
  const b = BigInt(n);
  return ((v << b) | (v >> (64n - b))) & MASK64;
}

function keccakF(s) {
  for (let round = 0; round < 24; round++) {
    // θ
    const c = new Array(5);
    for (let x = 0; x < 5; x++) c[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) s[x + y] ^= d;
    }
    // ρ + π
    const b = new Array(25);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
      }
    }
    // χ
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 25; y += 5) {
        s[x + y] = b[x + y] ^ (~b[((x + 1) % 5) + y] & MASK64 & b[((x + 2) % 5) + y]);
      }
    }
    // ι
    s[0] ^= RC[round];
  }
}

// Buffer/Uint8Array → Buffer 32 byte.
function keccak256(data) {
  const input = Buffer.from(data);
  const rate = 136; // 1088 bit untuk Keccak-256
  const padded = Buffer.alloc(Math.floor(input.length / rate + 1) * rate);
  input.copy(padded);
  padded[input.length] ^= 0x01; // padding Keccak asli (bukan 0x06 milik SHA-3)
  padded[padded.length - 1] ^= 0x80;

  const s = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) s[i] ^= padded.readBigUInt64LE(off + i * 8);
    keccakF(s);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(s[i], i * 8);
  return out;
}

// ---------- secp256k1 ----------

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};

function mod(a, m = P) {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function powMod(base, exp, m) {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

// m prima → invers lewat Fermat.
function inv(a, m) {
  if (mod(a, m) === 0n) throw new Error("no inverse");
  return powMod(a, m - 2n, m);
}

// Titik dalam koordinat Jacobian {x, y, z}; z = 0 adalah titik tak hingga.
const INF = { x: 0n, y: 1n, z: 0n };

function toJ(p) {
  return { x: p.x, y: p.y, z: 1n };
}

function fromJ(p) {
  if (p.z === 0n) return null;
  const zi = inv(p.z, P);
  const zi2 = (zi * zi) % P;
  return { x: mod(p.x * zi2), y: mod(p.y * zi2 * zi) };
}

function jDouble(p) {
  if (p.z === 0n || p.y === 0n) return INF;
  const ysq = mod(p.y * p.y);
  const s = mod(4n * p.x * ysq);
  const m = mod(3n * p.x * p.x); // a = 0 untuk secp256k1
  const x = mod(m * m - 2n * s);
  const y = mod(m * (s - x) - 8n * ysq * ysq);
  const z = mod(2n * p.y * p.z);
  return { x, y, z };
}

function jAdd(p, q) {
  if (p.z === 0n) return q;
  if (q.z === 0n) return p;
  const z1z1 = mod(p.z * p.z);
  const z2z2 = mod(q.z * q.z);
  const u1 = mod(p.x * z2z2);
  const u2 = mod(q.x * z1z1);
  const s1 = mod(p.y * q.z * z2z2);
  const s2 = mod(q.y * p.z * z1z1);
  if (u1 === u2) return s1 === s2 ? jDouble(p) : INF;
  const h = mod(u2 - u1);
  const r = mod(s2 - s1);
  const h2 = mod(h * h);
  const h3 = mod(h * h2);
  const x = mod(r * r - h3 - 2n * u1 * h2);
  const y = mod(r * (u1 * h2 - x) - s1 * h3);
  const z = mod(h * p.z * q.z);
  return { x, y, z };
}

function jMul(p, k) {
  let result = INF;
  let addend = p;
  let e = k;
  while (e > 0n) {
    if (e & 1n) result = jAdd(result, addend);
    addend = jDouble(addend);
    e >>= 1n;
  }
  return result;
}

function isOnCurve(pt) {
  return mod(pt.y * pt.y - pt.x * pt.x * pt.x - 7n) === 0n;
}

// k·G dalam bentuk affine (dipakai tes untuk mencocokkan dengan OpenSSL).
function pointFromScalar(k) {
  return fromJ(jMul(toJ(G), mod(k, N)));
}

function bufToBig(buf) {
  return BigInt(`0x${Buffer.from(buf).toString("hex") || "0"}`);
}

function bigTo32(n) {
  return Buffer.from(n.toString(16).padStart(64, "0"), "hex");
}

// Titik publik (affine) → alamat 0x… huruf kecil.
function addressFromPoint(pt) {
  const raw = Buffer.concat([bigTo32(pt.x), bigTo32(pt.y)]);
  return `0x${keccak256(raw).subarray(12).toString("hex")}`;
}

// ecrecover. hash: Buffer 32 byte. r, s: BigInt. recid: 0 | 1.
// Mengembalikan titik publik affine, atau null kalau input tidak sah.
function recoverPoint(hash, r, s, recid) {
  if (!Buffer.isBuffer(hash) || hash.length !== 32) return null;
  if (r <= 0n || r >= N || s <= 0n || s >= N) return null;
  if (recid !== 0 && recid !== 1) return null;

  // x = r (kasus r + N >= P tidak dipakai: recid hanya 0/1 dari v 27/28).
  const x = r;
  const alpha = mod(x * x * x + 7n);
  let y = powMod(alpha, (P + 1n) / 4n, P);
  if (mod(y * y) !== alpha) return null; // r bukan koordinat x di kurva
  if ((y & 1n) !== BigInt(recid)) y = P - y;
  const R = { x, y };
  if (!isOnCurve(R)) return null;

  const e = mod(bufToBig(hash), N);
  const rInv = inv(r, N);
  // Q = r⁻¹ (s·R − e·G)
  const sR = jMul(toJ(R), s);
  const eG = jMul(toJ(G), mod(-e, N));
  const q = fromJ(jMul(jAdd(sR, eG), rInv));
  if (!q || !isOnCurve(q)) return null;
  return q;
}

// ---------- EIP-191 ----------

function personalMessageHash(message) {
  const bytes = Buffer.from(String(message), "utf8");
  const prefix = Buffer.from(`\x19Ethereum Signed Message:\n${bytes.length}`, "utf8");
  return keccak256(Buffer.concat([prefix, bytes]));
}

// "0x" + 130 hex (r 32 byte, s 32 byte, v 1 byte). v 27/28 atau 0/1.
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;

function parseSignature(sig) {
  if (typeof sig !== "string" || !SIGNATURE_PATTERN.test(sig)) return null;
  const buf = Buffer.from(sig.slice(2), "hex");
  const r = bufToBig(buf.subarray(0, 32));
  const s = bufToBig(buf.subarray(32, 64));
  let v = buf[64];
  if (v === 27 || v === 28) v -= 27;
  if (v !== 0 && v !== 1) return null;
  return { r, s, recid: v };
}

// Alamat penanda tangan pesan personal_sign, huruf kecil; null kalau
// tanda tangan tidak sah.
function recoverPersonalSigner(message, signature) {
  const parsed = parseSignature(signature);
  if (!parsed) return null;
  let q;
  try {
    q = recoverPoint(personalMessageHash(message), parsed.r, parsed.s, parsed.recid);
  } catch {
    return null;
  }
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
