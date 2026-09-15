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

## Agent suggestion system (semi-automatic discovery)

To help find new agents to list without opening up public submissions to
spam, there's a semi-automatic pipeline that searches GitHub on a schedule
and drops candidates into a **private** staging table for manual review —
nothing here ever reaches the public site automatically.

**How it works**

1. `.github/workflows/find-agents.yml` runs every Monday at 09:00 UTC (and
   can be triggered manually from the Actions tab).
2. It runs `scripts/fetch-agent-suggestions.js`, which searches the GitHub
   Search API for public repos mentioning `robinhood-chain` together with
   `agent` or `mcp`.
3. Repos matching an obvious blacklist (sniper bots, bundlers,
   volume/pump bots, honeypots, etc.) are skipped, as are repos whose
   `repo_url` already exists in either the public `agents` table or the
   `agent_suggestions` table (no duplicates).
4. Everything else is inserted into `agent_suggestions` using the
   Supabase **service_role** key (from the `SUPABASE_SERVICE_ROLE_KEY`
   GitHub Actions secret) — this table has RLS enabled with **no**
   anon/public policies at all, so it cannot be read or written from the
   public site, only from the Actions workflow or the Supabase dashboard.

**How to review candidates**

1. Open the Supabase Dashboard → **Table Editor** → `agent_suggestions`.
2. Go through the rows one by one (`status = 'pending'`):
   - **Looks legit and worth listing** → copy its `name`, `description`
     and `repo_url` into the normal Publish form on the site (or insert a
     row into `agents` directly via the SQL Editor), then mark the
     suggestion row `status = 'approved'` (or just delete it).
   - **Not worth listing / spam / irrelevant** → delete the row, or set
     `status = 'rejected'` to keep a record.
3. Nothing in `agent_suggestions` ever shows up on the public site —
   moving a candidate to `agents` is always a manual, deliberate step.

**Setup**

- Run `supabase/migration-suggestions.sql` in the Supabase SQL Editor once
  (in addition to `migration.sql`) to create the `agent_suggestions` table.
- Add two repo secrets under **Settings → Secrets and variables →
  Actions**: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (found under
  Supabase **Settings → API** — the service_role key, *not* the anon key).
  Never put the service_role key in client-side code.
