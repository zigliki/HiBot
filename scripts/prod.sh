#!/usr/bin/env bash
# prod.sh {stop|start} — pause or resume the prod fly machine(s) (HIB-26).
# Used directly (npm run prod:pause / prod:resume) and by staging.sh.
# stop/start are idempotent: stopping an already-stopped machine is a no-op.
set -euo pipefail

APP=zigliki-hi-bot
action="${1:-}"
case "$action" in
  stop|start) ;;
  *) echo "usage: prod.sh {stop|start}" >&2; exit 2 ;;
esac

MACHINES=$(fly machine list -a "$APP" --json | jq -r '.[].id')
if [[ -z "$MACHINES" ]]; then
  echo "No machines found for $APP — nothing to $action." >&2
  exit 0
fi

for id in $MACHINES; do
  fly machine "$action" "$id" -a "$APP"
done
echo "prod ($APP): $action complete."
