#!/usr/bin/env bash
# One-time setup of Reztoration on a fresh Oracle Cloud "Always Free" machine (Ubuntu 24.04, ARM or x86).
# Run it ON the server as the default "ubuntu" user:
#
#   curl -fsSL https://raw.githubusercontent.com/Greenfire-solutions/reztoration/main/deploy/setup.sh -o setup.sh
#   bash setup.sh                      # address becomes <public-ip>.sslip.io, with free HTTPS
#   bash setup.sh map.example.org      # or your own domain, once its DNS points at this machine
#
# Safe to run again: every step checks before it changes anything.
set -euo pipefail

REPO=https://github.com/Greenfire-solutions/reztoration.git
APP_DIR=/opt/reztoration
NODE_VERSION=24.22.2   # the Node 24 LTS line, same as development; checked against nodejs.org's published SHA-256 below
PORT=8600

say() { printf '\n== %s\n' "$*"; }

[[ $(id -u) -ne 0 ]] || { echo "Run this as the ubuntu user, not root (it uses sudo where needed)."; exit 1; }

# ---- the address people will use
PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org || true)
DOMAIN=${1:-}
if [[ -z "$DOMAIN" ]]; then
  [[ -n "$PUBLIC_IP" ]] || { echo "Could not find this machine's public IP. Pass a domain: bash setup.sh map.example.org"; exit 1; }
  DOMAIN="${PUBLIC_IP//./-}.sslip.io"
fi
say "Setting up Reztoration at https://$DOMAIN"

# ---- packages
say "System packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl ca-certificates debian-keyring debian-archive-keyring apt-transport-https gnupg iptables-persistent >/dev/null

# ---- Node.js, from nodejs.org, verified
if ! node -v 2>/dev/null | grep -q "^v${NODE_VERSION}$"; then
  say "Node.js $NODE_VERSION"
  case "$(uname -m)" in aarch64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) echo "Unsupported CPU $(uname -m)"; exit 1 ;; esac
  TARBALL="node-v${NODE_VERSION}-linux-${ARCH}.tar.xz"
  TMP=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}" -o "$TMP/$TARBALL"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  (cd "$TMP" && grep " ${TARBALL}\$" SHASUMS256.txt | sha256sum -c -)
  sudo tar -xJf "$TMP/$TARBALL" -C /usr/local --strip-components=1
  rm -rf "$TMP"
fi
node -v

# ---- Caddy (web server with automatic free HTTPS), from Caddy's official package repository
if ! command -v caddy >/dev/null; then
  say "Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq caddy >/dev/null
fi

# ---- the app, as its own user with no login
say "The app"
id rez >/dev/null 2>&1 || sudo useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin rez
if [[ -d "$APP_DIR/.git" ]]; then
  sudo -u rez git -C "$APP_DIR" pull --ff-only -q
else
  sudo mkdir -p "$APP_DIR" && sudo chown rez:rez "$APP_DIR"
  sudo -u rez git clone -q --depth 1 "$REPO" "$APP_DIR"
fi
(cd "$APP_DIR" && sudo -u rez npm ci --omit=dev --no-audit --no-fund --loglevel=error --cache /tmp/rez-npm-cache)

# Native Land's homeland outlines are never on this machine: their Data Sovereignty Treaty forbids
# hosting them without written permission. The map opens without them (REZ_NO_HOMELANDS below).
if [[ -e "$APP_DIR/public/data/territories.json" || -e "$APP_DIR/data/raw/nativeland-territories.json" ]]; then
  echo "Native Land outlines found in $APP_DIR. They may not be hosted without Native Land's written permission. Remove them first."; exit 1
fi

# ---- run it as a service that restarts itself and starts on boot
say "Service"
sudo tee /etc/systemd/system/reztoration.service >/dev/null <<UNIT
[Unit]
Description=Reztoration map
After=network.target

[Service]
User=rez
WorkingDirectory=$APP_DIR
ExecStart=/usr/local/bin/node server.mjs
Environment=PORT=$PORT
Environment=NODE_ENV=production
Environment=REZ_NO_HOMELANDS=1
Environment=REZ_BEHIND_PROXY=1
Environment=REZ_API_PER_MIN=600
Restart=always
RestartSec=3
# The app only reads its own folder.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadOnlyPaths=$APP_DIR

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now reztoration >/dev/null
sudo systemctl restart reztoration

# ---- Caddy in front: HTTPS, compression, and the app stays on 127.0.0.1
say "HTTPS for $DOMAIN"
sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		Permissions-Policy "camera=(), microphone=(), geolocation=(self)"
		-Server
	}
}
CADDY
sudo systemctl reload caddy || sudo systemctl restart caddy

# ---- Oracle's Ubuntu images block everything but SSH in iptables. Open 80 and 443 here.
# (The cloud network's security list must ALSO allow them: see deploy/README.md, step 3.)
say "Firewall"
for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT 2>/dev/null && continue
  # Insert above Oracle's catch-all REJECT rule, wherever it sits; append if there is none.
  n=$(sudo iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
  if [[ -n "$n" ]]; then sudo iptables -I INPUT "$n" -p tcp --dport $p -m state --state NEW -j ACCEPT
  else sudo iptables -A INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT; fi
done
sudo netfilter-persistent save >/dev/null

# ---- prove it
say "Checking"
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/api/whoami" | grep -q reztoration && break; sleep 0.5; done
curl -fsS "http://127.0.0.1:$PORT/api/whoami" && echo
echo
echo "Done. Open https://$DOMAIN"
echo "(The first visit can take a minute while Caddy gets the HTTPS certificate.)"
echo "To update later: bash $APP_DIR/deploy/update.sh"
