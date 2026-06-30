#!/usr/bin/env bash
# Remote provisioning for the admin dashboard. Runs ON the droplet (invoked by the
# GitHub Actions deploy workflow over SSH). Idempotent: safe to re-run every deploy.
#
# Expects these env vars (the workflow exports them):
#   APP_DIR                /opt/admin-dashboard
#   ACCOUNTS_ROOT          /opt/accounts
#   SUPABASE_SERVICE_KEY   service_role key (may be empty -> content-only mode)
#   BASIC_USER BASIC_PASS  HTTP basic-auth credentials
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
# redeploy: 2026-06-30 — pick up SUPABASE_SERVICE_KEY for live data (run 4 - repo secret)

APP_DIR="${APP_DIR:-/opt/admin-dashboard}"
ACCOUNTS_ROOT="${ACCOUNTS_ROOT:-/opt/accounts}"
SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_KEY:-}"
BASIC_USER="${BASIC_USER:-root}"
BASIC_PASS="${BASIC_PASS:-BotMadhouse123!K}"

echo "==> Node 20"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
command -v nginx >/dev/null 2>&1 || apt-get install -y nginx
command -v htpasswd >/dev/null 2>&1 || apt-get install -y apache2-utils

echo "==> env file"
umask 077
cat > "$APP_DIR/.env" <<ENV
PORT=8787
HOST=127.0.0.1
SUPABASE_URL=https://vvnefkexzhfgvuusavvl.supabase.co/rest/v1
SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY
ACCOUNTS_ROOT=$ACCOUNTS_ROOT
ENV
umask 022

echo "==> npm deps"
cd "$APP_DIR"
if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

echo "==> systemd unit"
cat > /etc/systemd/system/admin-dashboard.service <<UNIT
[Unit]
Description=Vedametric multi-account admin dashboard
After=network.target

[Service]
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable admin-dashboard >/dev/null 2>&1 || true
systemctl restart admin-dashboard

echo "==> nginx basic-auth + vhost"
htpasswd -bc /etc/nginx/.htpasswd-dashboard "$BASIC_USER" "$BASIC_PASS"

# ensure sites-enabled is wired (some images only ship conf.d)
if [ ! -d /etc/nginx/sites-enabled ]; then
  mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
  grep -q 'sites-enabled/\*' /etc/nginx/nginx.conf || \
    sed -i '/http {/a \    include /etc/nginx/sites-enabled/*;' /etc/nginx/nginx.conf
fi
# drop only the stock placeholder; never remove other vhosts (e.g. n8n)
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# only claim default_server if no other vhost already does on :80
DEFAULT="default_server"
if nginx -T 2>/dev/null | grep -qE 'listen[[:space:]]+80[[:space:]]+default_server'; then DEFAULT=""; fi

cat > /etc/nginx/sites-available/admin-dashboard <<NGINX
server {
    listen 80 $DEFAULT;
    server_name _;

    auth_basic "Vedametric Admin";
    auth_basic_user_file /etc/nginx/.htpasswd-dashboard;
    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_buffering off;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/admin-dashboard /etc/nginx/sites-enabled/admin-dashboard
nginx -t
systemctl reload nginx || systemctl restart nginx

echo "==> verify"
sleep 2
echo "  app  $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/healthz)"
echo "  noauth $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/api/accounts)"
echo "  auth   $(curl -s -o /dev/null -w '%{http_code}' -u "$BASIC_USER:$BASIC_PASS" http://127.0.0.1/api/accounts)"
systemctl is-active admin-dashboard
echo "==> done"
