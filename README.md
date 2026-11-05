# Games Dashboard

Charts and numbers from Firebase Analytics for each game in `games.json`, updated every day.

1. **`npm run fetch`** reads the last 30 days of each game's GA4 data and writes `public/data/metrics.json`. That covers DAU, new users, revenue, retention, events, app versions, countries and platforms.
2. A GitHub Action runs this daily at 05:00 UTC and commits the new file. Vercel then redeploys the static page in `public/`, which sits behind a password.

## One-time setup

### 1. Google service account (read-only access to Analytics)

1. In [console.cloud.google.com](https://console.cloud.google.com), create a project and enable **Google Analytics Data API** (under **APIs & Services → Library**).
2. Under **IAM & Admin → Service Accounts → Create**, add a service account and download a **JSON key** for it.
3. In [analytics.google.com](https://analytics.google.com), add the service account's email as a **Viewer** on each game's property (**Admin → Property access management**).

### 2. GitHub (runs the daily fetch)

Open the repo's **Settings → Secrets and variables → Actions → New repository secret**. Add `GA_SA_KEY`, containing the entire contents of the service-account JSON file.

Never commit the key file itself. `service-account*.json` is in `.gitignore`.

### 3. Vercel (hosts the page)

1. Go to **vercel.com → Add New → Project** and import this repository. `vercel.json` already sets the build, so leave the defaults.
2. Under **Environment Variables**, add `DASHBOARD_PASSWORD`. The browser asks for it; any username works.
3. Click **Deploy**.

### 4. First run

In GitHub, open **Actions → Daily dashboard update → Run workflow**. Its commit triggers a new Vercel deploy.

If Vercel doesn't redeploy after the bot's commit, go to **Vercel → Settings → Git → Deploy Hooks** and create a hook for `main`. Add its URL as the GitHub secret `VERCEL_DEPLOY_HOOK`.

## Everyday changes

- **Add a game:** add an entry to `games.json` (`id`, `name`, `ga4PropertyId`, and optionally `currency`, which defaults to `USD`). Then give the service account Viewer access on that property.
- **Fetch locally:** save the key as `service-account.json` in this folder and run `npm run fetch`.
- **Preview locally:** serve the page with `python -m http.server --directory public`. Run `npm run demo` first if you want fake data.

## Notes

- GA4 can revise the last day or two of data. Each run re-fetches 30 days, so older numbers correct themselves.
- Retention averages use only install days with at least 20 installs.
- Ad revenue shows only if AdMob is linked to the game's Firebase project.
- If one game fails (for example, missing access), the others still update and that game's card shows the error.
