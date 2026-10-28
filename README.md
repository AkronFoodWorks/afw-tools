# Akron Food Works — Tools

Live member tools for Akron Food Works, a program of The Well CDC.
Hosted on GitHub Pages · cloud save powered by Supabase · every tool is a
self-contained HTML file that works with or without an account.

## Repo layout

```
/
├── index.html            ← landing page (replace with Tool Hub when ready)
├── afw-config.js         ← Supabase project URL + anon public key (shared)
├── afw-cloud.js          ← shared login + cloud-save module (shared)
├── demo-tool.html        ← reference integration; keep for testing
├── afw-hours-that-pay.html   ← public calculator
├── ...one file per tool
├── CNAME                 ← custom domain for GitHub Pages
└── setup/
    ├── SETUP-GUIDE.md
    ├── supabase-setup.sql
    └── magic-link-email.html   ← paste into Supabase email template
```

## Rules of the road

1. **Tool IDs are permanent.** Each tool passes a `tool` key to
   `AFWCloud.mountToolBar()`. Once members have saved data under an ID, never
   change it. The same key goes in the `mountSavedWork` map at the bottom of
   `index.html`, or saved work shows up on the hub with no Open button.
   Registry:

   | tool key              | File                        | Access |
   |-----------------------|-----------------------------|--------|
   | `cloud-save-demo`     | demo-tool.html              | test   |
   | `hours-that-pay`      | afw-hours-that-pay.html     | public |
   | `food-cost`           | afw-food-cost-pricing.html  | member |
   | `sop-builder`         | afw-sop-builder.html        | member |
   | `presell-orders`      | afw-pre-sell-order-form.html| member |
   | `first-order-sprint`  | afw-path-to-first-sales.html| member |
   | `catering-proposal`   | afw-catering-proposal-builder.html | member |
   | `prep-list`           | afw-prep-list-builder.html  | member |
   | `readiness-inventory` | (pending)                   | member |

2. **Login is always optional, and available everywhere.** No tool gates
   anything behind an account. Every tool's save bar shows the same email
   sign-in form the hub does, so an account can be started from whichever
   page a member happened to land on, and the emailed link brings them back
   to that page. JSON export/import stays in every tool as the offline
   fallback.

   Tools open in their own browser tab from the hub, so a member may be
   signed out in one tab and signed in in another. `afw-cloud.js` re-checks
   the session when a tab is looked at again or when another tab signs in,
   and the bars update themselves — no reload, and nothing typed is lost.

3. **One JSON blob per member per tool.** Tools keep their own schemas;
   the database doesn't know or care what's inside `data`.

## Working locally

Any static server works. From the repo folder:

```
python3 -m http.server 8000
```

Then open http://localhost:8000/demo-tool.html. Magic links work locally
as long as `http://localhost:8000/**` is in Supabase's Redirect URLs.

## Tests

`tests/` holds jsdom smoke tests for tools with real math. jsdom isn't
installed in this repo; from any scratch folder:

```
npm i jsdom
NODE_PATH=$PWD/node_modules node --test /path/to/afw-tools/tests/catering-proposal-builder.test.cjs
```

## Deploying

Push to `main`. GitHub Pages redeploys automatically in ~1 minute.
That's the whole pipeline.
