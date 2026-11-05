# Games Dashboard

Every day a GitHub Action runs this pipeline:

1. **`npm run fetch`** reads the last 30 days of Firebase Analytics for each game in `games.json` through the GA4 Data API and writes `public/data/metrics.json`. It computes all the numbers (DAU, new users, revenue, D1/D7 retention, events, versions, countries).
2. **`npm run analyze`** sends those numbers, plus yesterday's report, to Claude. Claude writes `public/data/insights.json`: a headline, a status per game, highlights, concerns and actions. A copy goes to `history/`.
3. The Action commits both files, and Vercel redeploys the static page in `public/`, which sits behind a password.

Claude writes only the commentary. Every number comes from the fetch step, so the figures are exact.

## One-time setup

### 1. Google service account (read-only access to Analytics)

1. In [console.cloud.google.com](https://console.cloud.google.com), create a project, for example `games-dashboard`.
2. Under **APIs & Services → Library**, enable **Google Analytics Data API**.
3. Under **IAM & Admin → Service Accounts → Create**, name it `dashboard-reader` and skip the role step.
4. Open it, then go to **Keys → Add key → JSON** and download the file. Keep it private.
5. In [analytics.google.com](https://analytics.google.com), for **each** game's property, go to **Admin → Property access management → +**. Add the service account's email with the **Viewer** role.

### 2. Claude API key

Create one at [console.anthropic.com](https://console.anthropic.com) under **API Keys**. Add a little credit under **Billing**.

### 3. GitHub (runs the daily job)

1. Create a **private** repository and push this folder to it. The data files hold your revenue, so the repo must not be public.
2. In the repo, open **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `GA_SA_KEY`: the entire contents of the service-account JSON file
   - `ANTHROPIC_API_KEY`: your Claude API key. This one is optional: without it the numbers still update daily, but Claude's written report doesn't.
3. Optionally, on the **Variables** tab, add `CLAUDE_MODEL` to use a different Claude model (the default is `claude-opus-5-5`).

### 4. Vercel (hosts the page)

1. Go to **vercel.com → Add New → Project** and import the GitHub repository. `vercel.json` already sets everything; don't change the build settings.
2. Under **Environment Variables**, add `DASHBOARD_PASSWORD`. The browser will ask for it; any username works.
3. Click **Deploy**. The page shows demo data until the first daily run.

### 5. First run

In GitHub, open **Actions → Daily dashboard update → Run workflow**. After it finishes, the new commit should trigger a Vercel deploy within a minute.

If Vercel **doesn't** redeploy after the bot's commit, go to **Vercel → Project → Settings → Git → Deploy Hooks** and create a hook for the `main` branch. Add its URL as the GitHub secret `VERCEL_DEPLOY_HOOK`. The Action calls it after every run.

After that it runs on its own every day at **05:00 UTC**. To change the time, edit `cron` in `.github/workflows/daily.yml`.

## Everyday changes

- **Add a game:** add an entry to `games.json` (`id`, `name`, `ga4PropertyId`; optionally `currency`, which defaults to `USD`), then give the service account Viewer access on that property.
- **Change what Claude focuses on:** edit `SYSTEM` in `scripts/analyze.mjs`.
- **Preview locally:** run `npm run demo` for fake data, then serve `public/` with a static server, for example `python -m http.server --directory public`.
- **Run the real pipeline locally:** set the `GA_SA_KEY` and `ANTHROPIC_API_KEY` environment variables, then run `npm run daily`.

## Notes

- GA4 can revise the last day or two of data. Each run re-fetches 30 days, so older numbers correct themselves.
- Ad revenue appears only if AdMob is linked to the game's Firebase project (**Firebase → Project settings → Integrations → AdMob**).
- If one game's data fails (for example, missing access), the other games still update and the page shows the error on that game's card.
