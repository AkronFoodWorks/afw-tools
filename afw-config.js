/* ============================================================
   AFW TOOLS — CLOUD SAVE CONFIG
   ============================================================
   The only file you edit to turn cloud saving on or off.

   IS THIS KEY A SECRET?  No. Supabase calls it a PUBLISHABLE key
   precisely because it is meant to sit in public web pages. It
   can only do what the database's row-level security rules
   allow, and our rules say a person may only ever read or write
   their OWN saved work (see afw-supabase-setup.sql).
   Never put a "secret" key (sb_secret_… or service_role) in this
   file — that one bypasses every rule and would expose every
   member's data to anyone who views the page source.

   TO SWITCH CLOUD SAVING OFF: blank out SUPABASE_KEY. Every tool
   keeps working with its download/upload .json flow and the
   account bar quietly hides itself.
   ============================================================ */

window.AFW_CONFIG = {
  SUPABASE_URL: "https://pyavgjemukfiiruawdgg.supabase.co",
  SUPABASE_KEY: "sb_publishable_wJEeHViBVIsoRG9gRikpsw_SOlPWPsj",

  /* Where the emailed magic link returns people to. Resolves
     against whatever host is serving the file, so the same code
     works on GitHub Pages and on a local copy. This exact URL
     must also be listed in Supabase under
     Authentication -> URL Configuration -> Redirect URLs. */
  REDIRECT_TO: new URL("./index.html", location.href).href
};
