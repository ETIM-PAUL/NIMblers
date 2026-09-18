#!/usr/bin/env bash
# Bootstraps (or redeploys) NIMblers on a fresh Ubuntu VM. Idempotent —
# safe to re-run after `git pull` to pick up a new commit. See DEPLOY.md.
#
# Usage: sudo bash deploy/setup.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo: sudo bash deploy/setup.sh" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${SUDO_USER:-ubuntu}"

echo "==> Installing Node 22 (if missing)"
if ! command -v node >/dev/null || [[ "$(node --version)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Installing nginx and ufw (if missing)"
apt-get update -y
apt-get install -y nginx ufw

echo "==> Installing dependencies and building the frontend"
cd "$REPO_DIR"
sudo -u "$APP_USER" npm ci
sudo -u "$APP_USER" npm run build

echo "==> Running database migrations"
sudo -u "$APP_USER" npm run db:migrate

if [[ ! -f "$REPO_DIR/.env" ]]; then
  echo "==> No .env found — copying .env.example. You MUST fill in real values before the API will work:"
  echo "    nano $REPO_DIR/.env"
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
  chown "$APP_USER:$APP_USER" "$REPO_DIR/.env"
fi

echo "==> Installing systemd units"
cp "$REPO_DIR/deploy/nimblers-api.service" /etc/systemd/system/nimblers-api.service
cp "$REPO_DIR/deploy/nimblers-sweep.service" /etc/systemd/system/nimblers-sweep.service
cp "$REPO_DIR/deploy/nimblers-sweep.timer" /etc/systemd/system/nimblers-sweep.timer
# The unit files assume /home/ubuntu/NIMblers and the ubuntu user — patch
# them if this checkout lives somewhere else or runs as a different user.
sed -i "s#/home/ubuntu/NIMblers#$REPO_DIR#g; s#User=ubuntu#User=$APP_USER#g" \
  /etc/systemd/system/nimblers-api.service /etc/systemd/system/nimblers-sweep.service

systemctl daemon-reload
systemctl enable --now nimblers-api.service
systemctl enable --now nimblers-sweep.timer

echo "==> Installing nginx config"
sed "s#/home/ubuntu/NIMblers#$REPO_DIR#g" "$REPO_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/nimblers
ln -sf /etc/nginx/sites-available/nimblers /etc/nginx/sites-enabled/nimblers
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

echo "==> Opening firewall ports"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Restarting the API (picks up any .env changes)"
systemctl restart nimblers-api.service

echo
echo "Done. Check status with:"
echo "  systemctl status nimblers-api"
echo "  systemctl status nimblers-sweep.timer"
echo "  curl http://localhost:8787/api/duels/history?nimAddress=test"
