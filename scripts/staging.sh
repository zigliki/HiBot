#!/usr/bin/env bash
# staging.sh — run the bot locally as the separate staging bot (HIB-26, HIB-41).
#
# Staging has its own Discord bot token and its own MongoDB database, both in
# keys.staging.env, so prod keeps running while this does (no pausing).
#
# The bot itself only reads real environment variables (like on fly); this script
# loads keys.staging.env for it with `node --env-file`, and never loads keys.env.
# scripts/stagingGuard.js refuses to start if the staging file reuses prod's bot
# token, database host or health check (compared with keys.env, when it exists).
#
# Requires keys.staging.env with LOGIN and MONGO_URI (see CLAUDE.md).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/.."   # repo root

if [[ ! -f keys.staging.env ]]; then
  echo "keys.staging.env not found. Create it with LOGIN (the staging bot's token) and MONGO_URI." >&2
  exit 1
fi

node scripts/stagingGuard.js keys.staging.env keys.env

echo "→ Starting the staging bot (Ctrl-C to stop)…"
node --env-file=keys.staging.env src/index.js
