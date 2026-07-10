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
├── hours-that-pay.html   ← public calculator (add when converted)
├── ...one file per tool
├── CNAME                 ← custom domain for GitHub Pages
└── setup/
    ├── SETUP-GUIDE.md
    ├── supabase-setup.sql
    └── magic-link-email.html   ← paste into Supabase email template
```

## Rules of the road

1. **Tool IDs are permanent.** Each tool passes a `toolId` to `AFWCloud.init()`.
   Once members have saved data under an ID, never change it. Registry:

   | toolId              | File                  | Access |
   |---------------------|-----------------------|--------|
   | `cloud-save-demo`   | demo-tool.html        | test   |
   | `hours-that-pay`    | hours-that-pay.html   | public |
   | `food-cost-builder` | (pending)             | member |
   | `sop-builder`       | (pending)             | member |
   | `readiness-inventory` | (pending)           | member |
   | `first-order-sprint`  | (future)            | member |

2. **Login is always optional.** No tool gates anything behind an account.
   JSON export/import stays in every tool as the offline fallback.

3. **One JSON blob per member per tool.** Tools keep their own schemas;
   the database doesn't know or care what's inside `data`.

## Working locally

Any static server works. From the repo folder:

```
python3 -m http.server 8000
```

Then open http://localhost:8000/demo-tool.html. Magic links work locally
as long as `http://localhost:8000/**` is in Supabase's Redirect URLs.

## Deploying

Push to `main`. GitHub Pages redeploys automatically in ~1 minute.
That's the whole pipeline.
