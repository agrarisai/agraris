// ============================================
// Agraris — Supabase client configuration
// ============================================
// 1. Buka project Supabase kamu → Settings → API
// 2. Salin "Project URL" dan "anon public" key ke bawah ini
// 3. File ini aman untuk publik (anon key memang didesain untuk client-side,
//    keamanan diatur lewat Row Level Security policy di Supabase, lihat
//    supabase/migration.sql)

const SUPABASE_URL = "https://gnydurjxrynqcbpkxopd.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY"; // ganti ini dengan Publishable key kamu

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
