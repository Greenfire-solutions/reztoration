#!/usr/bin/env bash
# Put the latest pushed version live. Run on the server:  bash /opt/reztoration/deploy/update.sh
set -euo pipefail
APP_DIR=/opt/reztoration
sudo -u rez git -C "$APP_DIR" pull --ff-only -q
(cd "$APP_DIR" && sudo -u rez npm ci --omit=dev --no-audit --no-fund --loglevel=error --cache /tmp/rez-npm-cache)
if [[ -e "$APP_DIR/public/data/territories.json" ]]; then echo "Native Land outlines appeared in the app folder. Not restarting."; exit 1; fi
sudo systemctl restart reztoration
for i in $(seq 1 40); do curl -fsS http://127.0.0.1:8600/api/whoami 2>/dev/null | grep -q reztoration && break; sleep 0.5; done
echo "Live at version $(git -C "$APP_DIR" log -1 --format='%h %s')"
