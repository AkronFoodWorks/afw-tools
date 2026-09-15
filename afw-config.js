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

  /* Where the emailed magic link returns people to.

     BLANK (the default) means "the page they signed in from".
     Members can now start an account from any tool, not just the
     hub, so the link should put them back on the tool they were
     using — not send them to the front door to find their way
     back. Set a fixed URL here only if you want every sign-in to
     land on one page.

     Because that address varies by tool, Supabase needs a WILDCARD
     on its allow-list: Authentication -> URL Configuration ->
     Redirect URLs must include
         https://tools.akronfoodworks.org/**
         http://localhost:8000/**          (for testing)
     which is exactly what setup/SETUP-GUIDE.md already tells you
     to add. A URL that isn't on that list isn't an error — Supabase
     quietly falls back to the project's Site URL, so the member is
     still signed in, just not on the same page. */
  REDIRECT_TO: ""
};
