# Deploying to an Oracle Cloud "Always Free" VM

Two parts: things only you can do (account signup, VM creation — needs your own
identity/card verification), and things this repo now automates (server
bootstrap — one script once you have SSH access).

## Part 1 — Account and VM (you do this)

1. **Sign up.** Go to [oracle.com/cloud/free](https://www.oracle.com/cloud/free/)
   and create an account. A card is required for identity verification, but
   nothing is charged as long as you stay on Always Free resources.

2. **Create the compute instance.** In the console: **Compute → Instances →
   Create Instance**.
   - **Image**: Ubuntu (24.04 or newer), the default "Always Free-eligible" option.
   - **Shape**: click "Change shape" and pick `VM.Standard.A1.Flex` (Ampere
     ARM) — set it to 2 OCPU / 12 GB, well inside the 4 OCPU / 24 GB Always
     Free allowance, and enough headroom for this app plus nginx.
     Ampere capacity is sometimes unavailable in a given region ("Out of
     host capacity") — if that happens, either try a different Availability
     Domain, or fall back to `VM.Standard.E2.1.Micro` (a small x86 shape,
     also Always Free). Either works fine for this app; Node, Vite, and
     `node:sqlite` all support arm64 and x86_64.
   - **Networking**: let it create a new VCN (the default quick-create flow
     does this). Note the assigned **public IP**.
   - **SSH keys**: generate one if you don't have one (`ssh-keygen -t
     ed25519`) and paste the public key in, or let Oracle generate one for
     you and download it.
   - Create the instance. The boot volume itself is persistent Always Free
     storage — no separate block volume needed for this app's SQLite file.

3. **Open the firewall.** Oracle blocks inbound ports by default beyond 22.
   Go to the instance's **subnet → Security Lists** (or Network Security
   Group) and add ingress rules for:
   - `80/tcp` (HTTP) — from `0.0.0.0/0`
   - `443/tcp` (HTTPS) — from `0.0.0.0/0`, once you're ready for TLS

   Ubuntu also ships with its own firewall (`ufw`) — `deploy/setup.sh`
   (below) opens the matching ports there too.

4. **Confirm you can SSH in:**
   ```
   ssh -i /path/to/your/key ubuntu@<public-ip>
   ```

That's the whole cloud-side setup. Everything past this point runs on the VM.

## Part 2 — Server bootstrap (one script)

Once you're SSH'd into the VM:

```bash
git clone https://github.com/ETIM-PAUL/NIMblers.git
cd NIMblers
sudo bash deploy/setup.sh
```

The script (`deploy/setup.sh`) is idempotent — safe to re-run after a `git
pull` to redeploy an update. It:

1. Installs Node 22 (via NodeSource) and nginx if they're not already present.
2. Runs `npm ci`, `npm run build` (the static frontend), and `npm run
   db:migrate` (creates `server/db/data.sqlite` if it doesn't exist yet —
   your actual duel/escrow data, which then just lives on the VM's own
   persistent boot volume).
3. Installs and enables two systemd units:
   - `nimblers-api.service` — runs `npm run server` (the API), restarts
     automatically on crash or reboot.
   - `nimblers-sweep.timer` — runs the expiry-sweep job
     (`npm run expiry:sweep`) every 10 minutes, so unchallenged stakes
     actually get refunded on schedule instead of only when someone
     happens to trigger it manually.
4. Installs the nginx config (`deploy/nginx.conf`) to serve the built
   frontend (`dist/`) and reverse-proxy `/api/*` to the Node process on
   `localhost:8787` — the same split `vite.config.ts`'s dev proxy does.
5. Opens `80/tcp` (and `443/tcp`, for later) in `ufw`.

**Before the API will actually run**, set your real secrets — the script
won't touch `.env` if one already exists, so on first deploy:

```bash
nano .env
```

and fill in `ESCROW_PRIVATE_KEY`, `NIMIQ_RPC_URL`, `NIMIQ_RPC_USERNAME`,
`NIMIQ_RPC_PASSWORD` (see `.env.example` for what each one is — same values
you already have set up locally). Then:

```bash
sudo systemctl restart nimblers-api
```

Check it's actually running:

```bash
sudo systemctl status nimblers-api
curl http://localhost:8787/api/duels/history?nimAddress=test
```

Visit `http://<public-ip>` in a browser — you should see the landing page.

## HTTPS (optional, needed before real testers use Nimiq Pay's URL field)

Nimiq Pay may require or strongly prefer `https://`. Once you have a domain
pointed at the VM's IP, get a free certificate:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example
```

Certbot rewrites the nginx config in place and sets up auto-renewal.

## Redeploying after a code change

```bash
cd ~/NIMblers
git pull
sudo bash deploy/setup.sh   # re-runs build + migrate + restarts services
```

## What this does and doesn't protect against

This VM is a single point of failure for both the app and the custodial
escrow key — normal for a testnet demo, not something to carry into a real
deployment without also thinking about backups of `server/db/data.sqlite`
and secret management beyond a plain `.env` file on disk.
