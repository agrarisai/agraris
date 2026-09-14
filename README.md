# Agraris — the registry for AI agents

Static site: HTML + CSS + vanilla JS, no build step. Database: Supabase.

## File structure

```
index.html          → home (hero + recent agents)
search.html          → search + category filter
publish.html         → open publish form (no login)
agent.html           → agent detail (?id=<uuid>)
css/style.css        → all styles
js/supabase-client.js→ Supabase project URL + anon key (fill this in)
js/app.js            → shared helpers (fetch, render, format)
js/home.js           → home page logic
js/search.js         → search page logic
js/publish.js        → publish form logic
js/agent.js          → detail page logic
public/logo.svg       public/logo.png → Agraris logo
supabase/migration.sql → run this in Supabase SQL Editor first
```

## Setup steps

1. **Supabase project**
   - Create a project at supabase.com (if you haven't).
   - Go to **SQL Editor** → paste the contents of `supabase/migration.sql` → Run.
   - Go to **Settings → API** → copy the **Project URL** and **anon public** key.

2. **Connect the site to Supabase**
   - Open `js/supabase-client.js`.
   - Replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` with the values from step 1.

3. **Push to GitHub**
   - Push this whole folder to the `agraris` repo (root of the repo, so `index.html` sits at the repo root).

4. **Enable GitHub Pages**
   - Repo → **Settings → Pages** → Source: deploy from branch → pick `main` / root.
   - Your site will be live at `https://<username>.github.io/agraris/`.

5. **Custom domain (later)**
   - Once `agraris.xyz` is purchased: Settings → Pages → add custom domain, then point DNS (A records / CNAME per GitHub's instructions).

6. **Virtuals Protocol verification (later)**
   - There's a commented placeholder `<meta>` tag in `index.html`'s `<head>` — uncomment and fill in when you launch the token.

## Notes

- The publish form has **no auth** by design — Row Level Security policies in `migration.sql` allow public insert + select, but block update/delete from the client, so published entries can't be edited or removed except from the Supabase dashboard.
- Out of scope for this MVP (per the brief): agent runtime, tool marketplace. Don't add these yet.
