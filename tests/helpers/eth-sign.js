// Helper tes: membuat tanda tangan personal_sign dengan private key ACAK
// (bukan kunci asli) memakai perhitungan kurva dari scripts/eth-lib.js.
// Hanya untuk tes; skrip produksi tidak pernah menandatangani apa pun.

const crypto = require("crypto");
const eth = require("../../scripts/eth-lib.js");


function modN(a) {
  const r = a % eth.N;
  return r >= 0n ? r : r + eth.N;
}

function invN(a) {
  let [t, newT, r, newR] = [0n, 1n, eth.N, modN(a)];
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  return modN(t);
}

function randomScalar() {
  for (;;) {
    const k = BigInt(`0x${crypto.randomBytes(32).toString("hex")}`);
    if (k > 0n && k < eth.N) return k;
  }
}

function hex32(n) {
  return n.toString(16).padStart(64, "0");
}

// ECDSA atas hash 32 byte → "0x" r s v (v 27/28), low-s seperti wallet.
function signHash(hash, d) {
  for (;;) {
    const k = randomScalar();
    const R = eth.pointFromScalar(k);
    const r = modN(R.x);
    if (r === 0n || R.x >= eth.N) continue;
    const e = modN(BigInt(`0x${hash.toString("hex")}`));
    let s = modN(invN(k) * (e + r * d));
    if (s === 0n) continue;
    let recid = Number(R.y & 1n);
    if (s > eth.N / 2n) {
      s = eth.N - s;
      recid ^= 1;
    }
    return `0x${hex32(r)}${hex32(s)}${(27 + recid).toString(16)}`;
  }
}

function newWallet() {
  const d = randomScalar();
  return { d, address: eth.addressFromPoint(eth.pointFromScalar(d)) };
}

function personalSign(message, wallet) {
  return signHash(eth.personalMessageHash(message), wallet.d);
}

module.exports = { hex32, newWallet, personalSign, signHash };
