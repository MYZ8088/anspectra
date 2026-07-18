#!/usr/bin/env bash
# Aloom control-plane setup for Ubuntu 22.04 / 24.04.
# Official Web collection remains on a paired macOS or Windows computer.
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info() { echo -e "${CYAN}->${NC} $*"; }
success() { echo -e "${GREEN}OK${NC} $*"; }
fatal() { echo -e "${RED}ERROR${NC} $*" >&2; exit 1; }
header() { echo -e "\n${BOLD}$*${NC}"; }
require_cmd() { command -v "$1" >/dev/null 2>&1; }

if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  fatal "Run this script as a non-root user with sudo privileges."
fi

header "Aloom control-plane setup"
read -rp "Public app domain (for example aloom.example.com): " DOMAIN
[[ -z "$DOMAIN" ]] && fatal "A public domain is required."
read -rp "Install directory [/home/$USER/aloom]: " INSTALL_DIR
INSTALL_DIR="${INSTALL_DIR:-/home/$USER/aloom}"
read -rp "Repository URL [https://github.com/MYZ8088/aloom.git]: " REPOSITORY_URL
REPOSITORY_URL="${REPOSITORY_URL:-https://github.com/MYZ8088/aloom.git}"

header "1 / 5 - Dependencies"
if ! require_cmd docker; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  info "Docker installed. Reconnect after setup if the current shell lacks Docker access."
fi
if ! require_cmd node; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo apt-get update
sudo apt-get install -y git nginx certbot python3-certbot-nginx

header "2 / 5 - Source"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone "$REPOSITORY_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
corepack enable
corepack prepare pnpm@10.16.0 --activate
pnpm install --frozen-lockfile

header "3 / 5 - Configuration"
[[ -f .env ]] || cp .env.example .env
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}
set_env "APP_URL" "https://${DOMAIN}"
set_env "API_BASE_URL" "https://${DOMAIN}"
set_env "ALOOM_APP_MODE" "self-host"
set_env "BETTER_AUTH_SECRET" "$(openssl rand -hex 32)"
set_env "INTERNAL_CRON_SECRET" "$(openssl rand -hex 32)"

header "4 / 5 - Control plane"
pnpm self-host:build
for attempt in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:3000 >/dev/null 2>&1; then
    success "Aloom is responding on 127.0.0.1:3000"
    break
  fi
  sleep 3
  [[ "$attempt" -eq 40 ]] && fatal "Aloom did not become ready. Check docker compose logs."
done

header "5 / 5 - HTTPS"
NGINX_CONF="/etc/nginx/sites-available/aloom"
sudo tee "$NGINX_CONF" >/dev/null <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
EOF
sudo ln -sfn "$NGINX_CONF" /etc/nginx/sites-enabled/aloom
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@${DOMAIN}"
if require_cmd ufw; then
  sudo ufw allow OpenSSH
  sudo ufw allow 'Nginx Full'
  sudo ufw --force enable
fi

success "Control plane ready at https://${DOMAIN}"
echo ""
echo "Next steps on a macOS or Windows collector machine:"
echo "  1. Open Settings and configure the analysis API base URL, model ID, and API key."
echo "  2. Open Providers and create a collector pairing."
echo "  3. Set COLLECTOR_API_URL=https://${DOMAIN} and the one-time token."
echo "  4. Run pnpm camoufox:setup, pnpm camoufox:doctor, and pnpm collector."
echo ""
echo "Provider cookies and browser profiles remain on that collector machine."
