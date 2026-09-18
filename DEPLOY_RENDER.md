# Deploying to Render (free tier)

Chosen over the Oracle Cloud route in DEPLOY.md because Oracle's Always Free
compute capacity is currently exhausted in this account's region for both
free shapes — a known, common, and unpredictable issue with no fixed
timeline. Render's free plan has no capacity roulette and no budget ceiling
(unlike Railway's $1/month credit), at the cost of an ephemeral disk and a
sleep-after-15-minutes-idle behavior — both addressed below, and both fine
for a hackathon demo where nobody needs duel history to survive for weeks.

This deploys the API and the built frontend as **one Render Web Service** —
the server now serves `dist/` directly (see `server/http/router.ts`'s
`staticDir` option) instead of needing a separate reverse proxy, so there's
nothing extra to configure for routing.

## 1. Push your code

Render deploys from a GitHub repo. Commit and push whatever's currently
staged, if you haven't already:

```bash
git push origin master
```

## 2. Create the service

1. Go to [dashboard.render.com](https://dashboard.render.com) and sign up
   (GitHub login is easiest) — no card required for the free plan.
2. **New → Blueprint**, and point it at this repo. Render will read
   `render.yaml` (already in the repo root) and propose one service:
   `nimblers`, free plan, build command `npm ci && npm run build && npm run
   db:migrate`, start command `npm run server`.
3. Click **Apply** to create it. The first build takes a few minutes.

## 3. Set your secrets

`render.yaml` deliberately leaves these blank (`sync: false`) so no real
key ever gets committed. In the service's **Environment** tab, add:

- `ESCROW_PRIVATE_KEY`
- `NIMIQ_RPC_URL`
- `NIMIQ_RPC_USERNAME` (if your RPC node needs one)
- `NIMIQ_RPC_PASSWORD` (if your RPC node needs one)

Same values as your local `.env` — see `.env.example` for what each one is.
Saving these triggers a redeploy automatically.

## 4. Confirm it's live

Render gives you a URL like `https://nimblers.onrender.com`. Open it —
first load after a cold start can take 30-60 seconds, that's expected (see
below). You should land on the app's landing page.

Sanity-check the API directly:

```bash
curl https://nimblers.onrender.com/api/health
# {"ok":true}
```

## 5. Keep it from sleeping (do this — judges show up unannounced)

Render's free web services spin down after 15 minutes with no traffic, and
the next request pays a ~30-60s cold-start penalty. Since you can't predict
when a judge will test it, set up a free external ping so the service never
goes to sleep:

1. Sign up at [cron-job.org](https://cron-job.org) or
   [uptimerobot.com](https://uptimerobot.com) (both free, no card).
2. Create a job hitting `https://<your-service>.onrender.com/api/health`
   every **10 minutes**.

That single change removes the cold-start problem entirely for the
duration of the judging period.

## About the database on Render's free tier

Render's free plan has **no persistent disk** — `server/db/data.sqlite`
lives on the container's own ephemeral storage and resets on redeploy or on
a sleep→wake cycle. As long as the uptime pinger above keeps it awake, nothing
resets while it's actively being demoed; a real reset only happens if you
push a new deploy or the service happens to restart. For a hackathon demo
that doesn't need weeks of accumulated duel history, this is a non-issue —
if you later want the data to genuinely persist long-term, that's what the
Oracle VM route (DEPLOY.md) or Render's paid tier with a disk are for.

## Redeploying after a code change

Render redeploys automatically on every push to the branch it's tracking —
just `git push`. No manual step needed, unlike the Oracle VM route.
