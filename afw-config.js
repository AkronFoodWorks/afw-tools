/* AFW Cloud configuration — one file, shared by every tool.
   Fill these in from Supabase: Dashboard → Project Settings → API.
   The "anon public" key is designed to live in browser code; Row Level
   Security (see supabase-setup.sql) is what protects member data. */

window.AFW_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-PUBLIC-KEY',
};
