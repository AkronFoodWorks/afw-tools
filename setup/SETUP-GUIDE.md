# AFW Tools — Cloud Save Setup Guide

Turn the existing single-file HTML tools into hosted tools with optional member login and cloud save. One-time setup is roughly an afternoon; converting each tool afterward takes minutes.

**What stays true after this:** every tool still works with no account, JSON export/import remains the offline fallback, and no tool's internal data schema changes.

---

## Part 1 — Supabase project (~20 min)

1. Create a free account at supabase.com and create a new project (name it `afw-tools`; pick the closest region, e.g. US East). Save the database password somewhere safe — you won't need it day-to-day.
2. **Run the database setup:** Dashboard → SQL Editor → New query → paste the contents of `supabase-setup.sql` → Run. This creates the one `tool_data` table and the security rules.
3. **Get your keys:** Project Settings → API. Copy the **Project URL** and the **anon public** key into `afw-config.js`. (The anon key is meant to be public — the SQL you just ran is what protects member data.)
4. **Allow your site's redirect URLs:** Authentication → URL Configuration.
   - Site URL: `https://tools.akronfoodworks.org` (or whatever the final subdomain is)
   - Redirect URLs: add `https://tools.akronfoodworks.org/**` and, for testing, `http://localhost:8000/**`
   Magic links only redirect to URLs on this list — if a sign-in link ever "does nothing," check here first.
5. **Email sending — important:** Supabase's built-in email is for testing only and is rate-limited to a few messages per hour. Before members use this for real, connect custom SMTP: Authentication → Emails → SMTP Settings. Since AFW runs on Microsoft 365, you can use M365 SMTP with a mailbox like `tools@` your domain, or a free transactional sender like Resend. Also customize the magic-link email template here (Authentication → Emails) so it reads as Akron Food Works, not a generic app.

## Part 2 — GitHub repo + Pages (~20 min)

1. Create a GitHub account/organization for AFW if one doesn't exist, then a repository, e.g. `afw-tools`. Keep it **public** (required for free GitHub Pages; the files are client-side code with no secrets — the anon key is public by design).
2. Add the files: `afw-config.js` (filled in), `afw-cloud.js`, `demo-tool.html`, and eventually every tool HTML file. An `index.html` copy of the Tool Hub makes the root URL the hub.
3. Repository → Settings → Pages → Source: **Deploy from a branch** → `main` → `/ (root)` → Save. In a minute or two the site is live at `https://<account>.github.io/afw-tools/`.
4. **Custom subdomain:** in Settings → Pages, enter `tools.akronfoodworks.org` as the custom domain and check **Enforce HTTPS** (available once DNS verifies). Then have whoever manages DNS add one record:
   - `CNAME`  |  host: `tools`  |  value: `<account>.github.io`
5. Once the subdomain resolves, update the Site URL and Redirect URLs in Supabase (Part 1, step 4) to match.

## Part 3 — Test the demo (~10 min)

1. Open `https://tools.akronfoodworks.org/demo-tool.html` (or the github.io URL while DNS propagates).
2. Fill in a field → confirm nothing breaks while signed out (public mode).
3. Enter your email → "Email me a sign-in link" → open the link **on the same device/browser**.
4. Type in a field → status should flip "Saving…" → "Saved ✓".
5. Reload the page, then open it on your phone and sign in with the same email — the data should follow you.
6. Test Export and Import still work signed out.

When all six pass, the foundation is proven and every tool conversion rides on it.

## Part 4 — Converting an existing tool (~15 min each)

Each tool already has functions that gather and apply its full state (used by JSON export/import). The conversion is four small additions — the tool's schema and everything else stay untouched:

1. Before `</body>`, add:
   ```html
   <script src="afw-config.js"></script>
   <script src="afw-cloud.js"></script>
   ```
2. Add an empty `<div id="afw-account-bar"></div>` near the top of the page.
3. After the tool's own script, initialize:
   ```js
   AFWCloud.init({
     toolId: 'food-cost-builder',          // unique, permanent per tool
     mount: '#afw-account-bar',
     getData: collectState,                // the tool's existing export function
     onData: (data) => applyState(data),   // the tool's existing import function
   });
   ```
4. Call `AFWCloud.scheduleSave()` wherever the tool's state changes (usually the same place any "recalculate" or input handler already fires).

`toolId` values, once chosen, should never change — they're the key member data is filed under. Suggested set: `hours-that-pay`, `food-cost-builder`, `sop-builder`, `readiness-inventory`, `first-order-sprint`.

**Hours-That-Pay (public tool):** identical integration. Signed-out visitors get the full calculator with nothing gated; the account bar simply offers "save your scenario" to anyone who wants it. Public and member modes are the same code path.

## Ongoing costs & limits

- GitHub Pages: free.
- Supabase free tier: 500 MB database and 50,000 monthly active users — AFW's data (small JSON blobs per member per tool) will use a fraction of a percent of this for years.
- The only real operational dependency is the SMTP sender for magic-link emails.

## Later (not now)

- **Staff view:** a second table + policy can later let AFW staff see member tool data (with consent) — useful for the facilitated Readiness check-ins. Deliberately out of scope for v1.
- **Salesforce:** the `tool_data` table exports cleanly (Supabase → CSV/API) whenever program logic is finalized.
- **Normalizing the data:** stays as one JSON blob per tool until the unified data spine is designed. Don't normalize early.
