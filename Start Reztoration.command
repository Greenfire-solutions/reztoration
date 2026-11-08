#!/bin/zsh
cd "$(dirname "$0")"
URL=http://localhost:8600
WHO=$(curl -s --max-time 2 $URL/api/whoami)
if [[ "$WHO" == *'"app":"reztoration"'* ]]; then open $URL; exit 0; fi
if [[ -n "$WHO" ]] || lsof -nP -iTCP:8600 -sTCP:LISTEN >/dev/null 2>&1; then echo "Port 8600 belongs to something else. Not opening it."; exit 3; fi
[[ -d node_modules ]] || npm install
nohup node server.mjs > /tmp/reztoration.log 2>&1 &
for i in {1..20}; do sleep 0.3; curl -s $URL/api/whoami | grep -q reztoration && break; done
open $URL
