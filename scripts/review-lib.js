// ============================================
// Agraris — helper bersama untuk antrean review
// ============================================
// Dipakai oleh scripts/review-notify.js dan scripts/review-action.js.
// Tanpa dependensi: Supabase dipanggil langsung lewat REST (PostgREST)
// dengan fetch bawaan Node 22.
//
// Keamanan:
// - Jangan pernah mencetak isi env var, header request, atau objek error
//   mentah. Error dari Supabase hanya membawa status code + pesan.
// - Semua isi submission (nama, repo, deskripsi) adalah teks dari
//   pengirim yang belum diperiksa. Lewatkan lewat cleanText() lalu
//   defang() sebelum masuk email, dan escapeMarkdown() sebelum masuk
//   GITHUB_STEP_SUMMARY.

const fs = require("fs");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Batas panjang nama sama dengan kebijakan INSERT (char_length(name) <= 120).
const MAX_NAME_LENGTH = 120;

// Karakter kontrol (C0, DEL, C1).
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
// Karakter tak terlihat / pembalik arah teks yang bisa dipakai untuk
// menyamarkan isi (zero-width, bidi override/isolate, BOM).
const INVISIBLE_CHARS = /[​-‏‪-‮⁠-⁩﻿]/;

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  // Hanya NAMA env var yang dicetak, tidak pernah nilainya.
  if (missing.length > 0) {
    throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);
  }
}

// ---------- Supabase REST ----------

// Panggil PostgREST dengan service role. `query` adalah string yang
// sudah dirakit dengan filter() di bawah (nilai sudah di-URL-encode).
async function rest(method, table, query, { body, prefer } = {}) {
  const base = process.env.SUPABASE_URL.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${base}/rest/v1/${table}?${query}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const detail = data && typeof data.message === "string" ? `: ${data.message}` : "";
    throw new Error(`Supabase ${method} ${table} failed (HTTP ${res.status})${detail}`);
  }

  return { data, contentRange: res.headers.get("content-range") || "" };
}

// Satu pasangan kolom=operator.nilai untuk query string PostgREST.
// Nilai selalu di-URL-encode, jadi &, =, #, spasi, dsb. tidak bisa
// keluar dari filternya.
function filter(column, op, value) {
  return `${column}=${op}.${encodeURIComponent(value)}`;
}

// "0-19/57" → 57; "*/0" → 0; tidak ada → null.
function totalFromContentRange(contentRange) {
  const match = /\/(\d+)$/.exec(contentRange || "");
  return match ? Number(match[1]) : null;
}

// ---------- teks tak tepercaya ----------

// Satu baris teks bersih: karakter kontrol & tak terlihat dibuang,
// spasi dirapatkan, lalu dipotong ke `max` karakter.
function cleanText(value, max = 200) {
  const chars = [
    ...String(value ?? "")
      .replace(new RegExp(CONTROL_CHARS.source, "g"), " ")
      .replace(new RegExp(INVISIBLE_CHARS.source, "g"), "")
      .replace(/\s+/g, " ")
      .trim(),
  ];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
}

// Supaya klien email / GitHub tidak mengubah teks pengirim menjadi
// link yang bisa diklik: "https://x.com/a" → "https[:]//x[.]com/a",
// "a@b.com" → "a[at]b[.]com".
function defang(value) {
  return String(value ?? "")
    .replace(/:\/\//g, "[:]//")
    .replace(/@/g, "[at]")
    .replace(/([A-Za-z0-9-])\.(?=[A-Za-z0-9-])/g, "$1[.]");
}

// Escape untuk Markdown GitHub (job summary): HTML di-escape dan semua
// tanda baca Markdown diberi backslash, jadi tidak bisa membentuk link,
// gambar, tabel, atau tag HTML.
function escapeMarkdown(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+\-.!|~:"']/g, "\\$&");
}

// Teks tak tepercaya → aman untuk job summary.
function safeMd(value, max = 200) {
  return escapeMarkdown(defang(cleanText(value, max)));
}

// Teks tak tepercaya → aman untuk email teks biasa.
function safeText(value, max = 200) {
  return defang(cleanText(value, max));
}

// Ganti alamat email di teks dengan "[email]" sebelum masuk log (sama
// seperti generate-digest.js).
function redactEmails(text) {
  return String(text).replace(/[^\s@()<>"']+@[^\s@()<>"']+\.[^\s@()<>"']+/g, "[email]");
}

function formatUtc(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function appendSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return false;
  fs.appendFileSync(file, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
  return true;
}

module.exports = {
  UUID_PATTERN,
  MAX_NAME_LENGTH,
  CONTROL_CHARS,
  INVISIBLE_CHARS,
  requireEnv,
  rest,
  filter,
  totalFromContentRange,
  cleanText,
  defang,
  escapeMarkdown,
  safeMd,
  safeText,
  redactEmails,
  formatUtc,
  appendSummary,
};
