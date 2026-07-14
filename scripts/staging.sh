#!/usr/bin/env bash
# staging.sh — "poor man's staging" for HiBot (HIB-26).
#
# There is no separate staging app or DB. This ensures the prod fly machine(s)
# are PAUSED, then runs the SAME bot locally against the SAME prod token + prod
# Atlas DB.
#
# Why pause prod: only one process can hold the bot token at a time. If prod and
# the local bot both ran, both would receive every Discord message and
# double-process it (double hi counts, double command replies).
#
# Resume behaviour (default): prod is LEFT PAUSED when the local bot exits, so you
# can iterate — run this repeatedly without prod flapping up/down each time.
# Resume prod yourself when done:  npm run prod:resume
# Set RESUME=1 to instead auto-resume prod on exit (one-shot convenience).
#
# Requires keys.env (run `npm run pull-keys` first).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/.."   # repo root

APP=zigliki-hi-bot
RESUME_ON_EXIT="${RESUME:-0}"

if [[ ! -f keys.env ]]; then
  echo "keys.env not found. Run:  npm run pull-keys" >&2
  exit 1
fi

done_once=0
on_exit() {
  [[ "$done_once" == 1 ]] && return   # guard against EXIT + signal double-fire
  done_once=1
  if [[ "$RESUME_ON_EXIT" == 1 ]]; then
    echo "→ RESUME=1: resuming prod…"
    bash "$DIR/prod.sh" start || echo "  WARN: resume failed — run 'npm run prod:resume'." >&2
  else
    echo
    echo "⚠  prod ($APP) is still PAUSED — the live bot is DOWN."
    echo "   Run more local sessions freely, then resume when done:"
    echo "     npm run prod:resume"
  fi
}
trap on_exit EXIT INT TERM

echo "→ Ensuring prod ($APP) is paused so the local bot can take over…"
bash "$DIR/prod.sh" stop

# Give Discord a moment to release the paused bot's gateway session before the
# local instance logs in, so they never briefly overlap.
sleep 3

echo "→ Starting local bot (Ctrl-C to stop)…"
node index.js
