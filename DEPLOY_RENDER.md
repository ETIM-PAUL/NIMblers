# Deploying to Render (free tier)

Chosen over the Oracle Cloud route in DEPLOY.md because Oracle's Always Free
compute capacity is currently exhausted in this account's region for both
free shapes — a known, common, and unpredictable issue with no fixed
timeline. Render's free plan has no capacity roulette and no budget ceiling
(unlike Railway's $1/month credit), at the cost of an ephemeral disk and a
sleep-after-15-minutes-idle behavior. The disk problem is solved by using a
hosted database (Turso) instead of a local file — see step 3 and "About the
database" below; the sleep/cold-start behavior is addressed separately in
step 5.

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
- `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` — see "About the database"
  below for where these come from

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

Render's free plan has **no persistent disk** — a local file like
`server/db/data.sqlite` would live on the container's own ephemeral storage
and be wiped on every redeploy or sleep→wake cycle. `server/db/client.ts`
avoids that by talking to a hosted [Turso](https://turso.tech) (libSQL)
database instead whenever `TURSO_DATABASE_URL` is set, so duel/leaderboard/
history data survives restarts and cold starts like any normal production
database.

To set one up:

```bash
curl -sSfL https://get.tur.so/install.sh | bash   # installs the Turso CLI
turso auth login                                  # opens a browser
turso db create nimblers
turso db show nimblers --url                      # -> TURSO_DATABASE_URL
turso db tokens create nimblers                   # -> TURSO_AUTH_TOKEN
```

Add both values in Render's **Environment** tab (step 3). The build command
in `render.yaml` already runs `npm run db:migrate`, which applies the schema
to whichever database `TURSO_DATABASE_URL` points at.

Local dev and `npm test` need none of this — leaving `TURSO_DATABASE_URL`
unset falls back to a local SQLite file (or `:memory:` for tests), so there's
nothing to configure just to run the app on your own machine.

## Redeploying after a code change

Render redeploys automatically on every push to the branch it's tracking —
just `git push`. No manual step needed, unlike the Oracle VM route.
