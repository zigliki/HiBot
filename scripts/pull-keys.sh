#!/usr/bin/env bash
# pull-keys.sh — build a local keys.env from the prod app's live secrets (HIB-26).
#
# fly can't read secrets back via `fly secrets list` (only digests), but the
# values are present as env vars inside the running machine, so we read them over
# ssh. Requires a prod machine to be RUNNING — run this BEFORE staging.sh pauses
# prod. keys.env is gitignored.
set -euo pipefail

APP=zigliki-hi-bot
cd "$(dirname "$0")/.."   # repo root

if [[ -f keys.env ]]; then
  read -r -p "keys.env already exists — overwrite? [y/N] " ans
  [[ "$ans" == [yY] ]] || { echo "Aborted."; exit 0; }
fi

echo "Reading secrets from $APP over ssh…"
LOGIN=$(fly ssh console -a "$APP" -C "printenv LOGIN"     | tr -d '\r\n')
MONGO_PWD=$(fly ssh console -a "$APP" -C "printenv MONGO_PWD" | tr -d '\r\n')
DEV=$(fly ssh console -a "$APP" -C "printenv DEV"         | tr -d '\r\n')

if [[ -z "$LOGIN" || -z "$MONGO_PWD" || -z "$DEV" ]]; then
  echo "ERROR: one or more secrets came back empty. Is a prod machine running?" >&2
  echo "       (fly machine list -a $APP)" >&2
  exit 1
fi

umask 077   # keys.env readable only by you
cat > keys.env <<EOF
LOGIN=$LOGIN
MONGO_PWD=$MONGO_PWD
DEV=$DEV
EOF

echo "Wrote keys.env (LOGIN, MONGO_PWD, DEV) — gitignored."
